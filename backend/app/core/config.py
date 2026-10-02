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


@lru_cache
def get_settings() -> Settings:
    """第一次呼叫時讀設定，之後沿用同一份；要重讀時呼叫 `get_settings.cache_clear()`。"""
    return Settings()
