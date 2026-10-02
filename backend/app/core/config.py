"""應用程式設定：一律從環境變數讀，不寫死在程式裡。

開發時可以把環境變數寫在 `backend/.env`（範本是 `backend/.env.example`）；
同名的環境變數優先於 `.env`。
"""

from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

# backend/.env；用絕對路徑，從哪個資料夾執行指令都讀得到同一份。
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

DRIVER = "postgresql+psycopg"

# 新北市資料開放平臺的「政府行政機關辦公日曆表」（2018 年起，含補假、補班），固定網址的 CSV。
NTPC_CALENDAR_URL = (
    "https://data.ntpc.gov.tw/api/datasets/308dcd75-6434-45bc-a95f-584da4fed251/csv/file"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        # 設定有誤時，錯誤訊息不印出原始值（連線字串裡有密碼）。
        hide_input_in_errors=True,
    )

    # PostgreSQL 連線字串：postgresql+psycopg://帳號:密碼@主機:port/資料庫名稱
    DATABASE_URL: str

    @field_validator("DATABASE_URL")
    @classmethod
    def require_psycopg_driver(cls, value: str) -> str:
        try:
            drivername = make_url(value).drivername
        except ArgumentError as exc:
            raise ValueError("DATABASE_URL 不是有效的連線字串") from exc
        if drivername != DRIVER:
            raise ValueError(
                f"DATABASE_URL 要以 {DRIVER}:// 開頭（psycopg 3 驅動），目前是 {drivername}://"
            )
        return value

    # 「今天」用的時區（IANA 名稱）。正式環境的容器是 UTC，不能用伺服器時區算日期。
    TIMEZONE: str = "Asia/Taipei"

    @field_validator("TIMEZONE")
    @classmethod
    def require_known_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"TIMEZONE 不是認得的時區名稱（例如 Asia/Taipei）：{value}") from exc
        return value

    # 背景排程的總開關（app/jobs/startup.py）：關掉時所有背景工作都不跑。測試固定關掉（tests/conftest.py）。
    BACKGROUND_JOBS_ENABLED: bool = True

    # 假日表每月自動同步（app/jobs/holiday_sync.py）。伺服器連不到外網時設成 false，
    # 改用 `uv run python -m app.scripts.holidays import` 手動匯入。
    HOLIDAY_SYNC_ENABLED: bool = True

    # 自動同步抓的 CSV；只接受 https。
    HOLIDAY_SOURCE_URL: str = NTPC_CALENDAR_URL

    @field_validator("HOLIDAY_SOURCE_URL")
    @classmethod
    def require_https(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("HOLIDAY_SOURCE_URL 要以 https:// 開頭")
        return value


@lru_cache
def get_settings() -> Settings:
    """第一次呼叫時讀設定，之後沿用同一份；要重讀時呼叫 `get_settings.cache_clear()`。"""
    return Settings()
