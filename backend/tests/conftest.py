"""pytest 共用設定。

- 測試只連測試資料庫（TEST_DATABASE_URL，名稱必須以 `_test` 結尾，否則整個 pytest 拒絕執行）。
- 第一個用到資料庫的測試開始前，先跑一次 `alembic upgrade head`。
- 每個測試包在一個交易裡，結束時 rollback：測試裡就算 `session.commit()`，
  資料也不會留下來，測試之間互不影響。

寫 API 測試照這樣用（`client` 打 API，`db` 直接查資料庫，兩者在同一個交易裡）：

    def test_create_project(client: TestClient, db: Session) -> None:
        response = client.post("/api/projects", json={"name": "新專案"})
        assert response.status_code == 201
        assert db.scalar(select(func.count()).select_from(Project)) == 1
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.core.db import get_engine
from app.main import app
from tests.db_guard import REQUIRED_SUFFIX, load_test_database_url, refusal_reason

BACKEND_DIR = Path(__file__).resolve().parents[1]


def pytest_configure(config: pytest.Config) -> None:
    """收集測試之前：檢查測試資料庫，並讓整支 app 改連測試資料庫。"""
    url = load_test_database_url()
    reason = refusal_reason(url)
    if reason is not None:
        pytest.exit(f"拒絕執行測試：{reason}", returncode=pytest.ExitCode.USAGE_ERROR)

    # 環境變數優先於 backend/.env，所以 app 的設定、engine、alembic 從這裡開始都連測試資料庫。
    os.environ["DATABASE_URL"] = url
    get_settings.cache_clear()
    get_engine.cache_clear()


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    """app 使用中的 engine（已經指向測試資料庫），並套用所有 migration。"""
    engine = get_engine()
    safe_url = engine.url.render_as_string(hide_password=True)
    # 再確認一次：真正連線用的 engine 指向 _test 資料庫。
    assert (engine.url.database or "").endswith(REQUIRED_SUFFIX), safe_url

    try:
        with engine.connect():
            pass
    except OperationalError as exc:
        pytest.exit(
            f"連不上測試資料庫 {safe_url}。"
            "請確認 PostgreSQL 有在執行、資料庫已建立、帳號密碼正確（見 backend/README.md）。\n"
            f"原始錯誤：{exc.orig}",
            returncode=pytest.ExitCode.USAGE_ERROR,
        )

    alembic_config = Config(str(BACKEND_DIR / "alembic.ini"))
    alembic_config.attributes["configure_logger"] = False
    command.upgrade(alembic_config, "head")

    yield engine
    engine.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    """包在交易裡的 session，測試結束時整個 rollback。

    `join_transaction_mode="create_savepoint"`：測試或 API 裡的 `session.commit()`
    只會釋放 savepoint，外層交易仍在，最後 rollback 一併撤銷。
    """
    with engine.connect() as connection:
        transaction = connection.begin()
        session = Session(bind=connection, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            session.close()
            transaction.rollback()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    """打 API 用的 client；端點拿到的 session 就是上面的 `db`。"""

    def override_get_db() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)
