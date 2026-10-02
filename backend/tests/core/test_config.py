"""設定：背景排程與假日表同步。

測案：
- 沒設定時兩個開關都開、抓新北市的網址（正式環境什麼都不設就能用）。
- 來源網址只接受 https（抓回來的內容會直接落進資料庫）。
- 測試執行時背景排程一定是關的（client fixture 會跑 lifespan，開著就會在背景連外網、
  用另一條連線碰測試資料庫）。
"""

import pytest
from pydantic import ValidationError

from app.core.config import NTPC_CALENDAR_URL, Settings, get_settings

DATABASE_URL = "postgresql+psycopg://user:secret@localhost:5432/pmis"


def test_background_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("BACKGROUND_JOBS_ENABLED", "HOLIDAY_SYNC_ENABLED", "HOLIDAY_SOURCE_URL"):
        monkeypatch.delenv(name, raising=False)

    settings = Settings(_env_file=None, DATABASE_URL=DATABASE_URL)

    assert settings.BACKGROUND_JOBS_ENABLED is True
    assert settings.HOLIDAY_SYNC_ENABLED is True
    assert settings.HOLIDAY_SOURCE_URL == NTPC_CALENDAR_URL
    assert NTPC_CALENDAR_URL.startswith("https://data.ntpc.gov.tw/")


def test_holiday_source_url_must_be_https() -> None:
    with pytest.raises(ValidationError, match="https"):
        Settings(
            _env_file=None,
            DATABASE_URL=DATABASE_URL,
            HOLIDAY_SOURCE_URL="http://data.ntpc.gov.tw/calendar.csv",
        )


def test_tests_run_with_background_jobs_disabled() -> None:
    assert get_settings().BACKGROUND_JOBS_ENABLED is False
