"""測試資料庫的防呆與交易隔離。"""

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from tests.db_guard import refusal_reason


@pytest.mark.parametrize(
    "url",
    [
        "",
        "postgresql+psycopg://postgres:pw@localhost:5432/pmis",
        "postgresql+psycopg://postgres:pw@localhost:5432/pmis_test_copy",
        "postgresql+psycopg://postgres:pw@localhost:5432",
        "這不是連線字串",
    ],
)
def test_refuses_non_test_database(url: str) -> None:
    assert refusal_reason(url) is not None


def test_accepts_database_ending_with_test() -> None:
    assert refusal_reason("postgresql+psycopg://postgres:pw@localhost:5432/pmis_test") is None


def test_commit_inside_test_is_not_visible_outside(db: Session, engine: Engine) -> None:
    """測試裡 commit 之後，同一個 session 看得到，其他連線看不到（外層交易沒有提交）。"""
    db.execute(text("CREATE TABLE rollback_probe (id integer)"))
    db.commit()
    assert db.scalar(text("SELECT to_regclass('rollback_probe')")) is not None

    with engine.connect() as other:
        assert other.scalar(text("SELECT to_regclass('rollback_probe')")) is None
