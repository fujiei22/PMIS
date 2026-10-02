"""日期與時間：「今天」一律用設定的 TIMEZONE 換算，不用伺服器時區。

正式環境的容器是 UTC：台灣早上 8 點以前，伺服器的「今天」還是前一天。
建立任務的 created、逾期判斷等都要用這裡的 `today()`。
"""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.core.config import get_settings


def local_zone() -> ZoneInfo:
    """設定 TIMEZONE 的時區（預設 Asia/Taipei）。"""
    return ZoneInfo(get_settings().TIMEZONE)


def today(now: datetime | None = None) -> date:
    """TIMEZONE 的今天。`now` 給測試用（必須帶時區），平常不傳，用現在。"""
    moment = now if now is not None else datetime.now(UTC)
    if moment.tzinfo is None:
        raise ValueError("now 必須帶時區")
    return moment.astimezone(local_zone()).date()


def utc_now() -> datetime:
    """現在（UTC、帶時區）。排程與指令稿的時鐘；要算「今天」用 `today(utc_now())`。"""
    return datetime.now(UTC)
