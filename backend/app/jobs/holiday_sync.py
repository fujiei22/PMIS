"""假日表每月自動同步：距上次匯入官方資料滿 30 天（或從沒匯入過）就抓一次。

來源是設定的 HOLIDAY_SOURCE_URL（預設新北市資料開放平臺）。
- 「上次匯入」不分來源：管理員手動匯入人事總處 CSV 也算新資料，30 天後才再自動抓；
  自動同步會用來源的資料蓋回同一年（user 2026-10-02 定案：後匯入的覆蓋先匯入的）。
- 失敗（連不上、格式不對、資料不完整、其他錯誤）保留舊資料、記 log，約 24 小時後再試；
  失敗時間只記在記憶體，重啟程式就重新判斷、立刻再試。
- 從沒成功過，或上次成功超過 45 天，失敗時記 ERROR（「同步已經失敗很久」要看得到）。
"""

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import create_session
from app.core.time import local_zone, today
from app.imports.holiday_csv import (
    SOURCE_LABELS,
    CalendarFormatError,
    ParsedCalendar,
    describe_skipped,
    describe_years,
    ensure_complete,
    parse_calendar_csv,
)
from app.imports.holiday_fetch import FetchError, fetch_calendar_csv
from app.services.calendar import last_synced_at, replace_official_years

logger = logging.getLogger(__name__)

SYNC_EVERY = timedelta(days=30)
RETRY_AFTER = timedelta(hours=24)
STALE_AFTER = timedelta(days=45)

type SessionScope = Callable[[], AbstractContextManager[Session]]
type Fetcher = Callable[[], bytes]


def default_fetch() -> bytes:
    """抓設定的 HOLIDAY_SOURCE_URL。"""
    return fetch_calendar_csv(get_settings().HOLIDAY_SOURCE_URL)


def sync_now(session: Session, *, fetch: Fetcher, now: datetime) -> ParsedCalendar:
    """抓檔、解析、檢查完整性、整年替換並 commit；任何一步失敗就丟例外，資料不動。"""
    parsed = parse_calendar_csv(fetch())
    ensure_complete(parsed)
    replace_official_years(session, parsed, imported_at=now)
    session.commit()
    return parsed


class HolidaySyncJob:
    """給 `Scheduler` 跑的每月同步（符合 `app.jobs.scheduler.Job`）。"""

    name = "holiday-sync"

    def __init__(
        self,
        *,
        session_scope: SessionScope = create_session,
        fetch: Fetcher = default_fetch,
        source_url: str | None = None,
    ) -> None:
        self._session_scope = session_scope
        self._fetch = fetch
        self._source_url = source_url
        self._last_failed_at: datetime | None = None
        self._last_synced: datetime | None = None

    def is_due(self, now: datetime) -> bool:
        if self._last_failed_at is not None and now - self._last_failed_at < RETRY_AFTER:
            return False
        with self._session_scope() as session:
            self._last_synced = last_synced_at(session)
        if self._last_synced is not None and now - self._last_synced < SYNC_EVERY:
            logger.debug(
                "假日表不到期：上次匯入 %s，%s 之後才會再抓",
                _local_day(self._last_synced),
                _local_day(self._last_synced + SYNC_EVERY),
            )
            return False
        return True

    def run(self, now: datetime) -> None:
        try:
            with self._session_scope() as session:
                parsed = sync_now(session, fetch=self._fetch, now=now)
        except Exception as exc:
            self._last_failed_at = now
            self._log_failure(now, exc)
            return
        self._last_failed_at = None
        self._last_synced = now
        logger.info(
            "假日表已同步：%s 年（%s），%d 個特殊日；下次約 %s 之後",
            describe_years(parsed.years),
            SOURCE_LABELS[parsed.source],
            len(parsed.days),
            _local_day(now + SYNC_EVERY),
        )
        for line in describe_skipped(parsed):
            logger.info(line)
        next_year = today(now).year + 1
        if today(now).month >= 11 and next_year not in parsed.years:
            logger.warning("同步來源還沒有明年（%d）的假日資料", next_year)

    def _log_failure(self, now: datetime, exc: Exception) -> None:
        last = self._last_synced
        since = "從沒成功過" if last is None else f"上次成功匯入是 {(now - last).days} 天前"
        stale = last is None or now - last > STALE_AFTER
        expected = isinstance(exc, FetchError | CalendarFormatError)
        logger.log(
            logging.ERROR if stale else logging.WARNING,
            "假日表自動同步失敗（%s），保留舊資料，約 24 小時後再試；%s。原因：%s。"
            "連不到外網的話設 HOLIDAY_SYNC_ENABLED=false，改用 holidays import 手動匯入",
            self._source_url or get_settings().HOLIDAY_SOURCE_URL,
            since,
            exc,
            # 預期中的失敗（抓不到、格式錯）不印 traceback；其他是程式錯誤，要看 traceback
            exc_info=not expected,
        )


def _local_day(moment: datetime) -> str:
    return moment.astimezone(local_zone()).date().isoformat()
