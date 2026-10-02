"""測試資料庫的防呆：測試只連名稱以 `_test` 結尾的資料庫。

測試會跑 migration、寫入資料；連錯資料庫就會動到開發或正式資料。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

from app.core.config import ENV_FILE

REQUIRED_SUFFIX = "_test"


class _TestDatabaseEnv(BaseSettings):
    # 跟 app 的設定一樣：先看環境變數，再看 backend/.env。
    model_config = SettingsConfigDict(
        env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore", hide_input_in_errors=True
    )

    TEST_DATABASE_URL: str = ""


def load_test_database_url() -> str:
    return _TestDatabaseEnv().TEST_DATABASE_URL


def refusal_reason(url: str) -> str | None:
    """不能拿來跑測試的原因；可以用就回 None。"""
    if not url:
        return (
            "沒有設定 TEST_DATABASE_URL。"
            "請照 backend/README.md 建立 pmis_test 資料庫，並在 backend/.env 設定 TEST_DATABASE_URL。"
        )
    try:
        name = make_url(url).database
    except ArgumentError:
        return "TEST_DATABASE_URL 不是有效的連線字串。"
    if not name or not name.endswith(REQUIRED_SUFFIX):
        return (
            f"TEST_DATABASE_URL 的資料庫名稱是「{name or '（空白）'}」，不是以 {REQUIRED_SUFFIX} 結尾。"
            "測試會跑 migration、寫入資料，為了不動到開發或正式資料，"
            f"只接受名稱以 {REQUIRED_SUFFIX} 結尾的資料庫（例如 pmis_test）。"
        )
    return None
