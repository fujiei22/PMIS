"""假日表每月自動同步。

測案：
- 從沒同步過 → 到期；上次 29 天前 → 不到期；30 天前 → 到期（每月一次，user 2026-10-02 定案）。
- 成功：寫入並 commit、記 INFO（含年份、來源、下次同步日、略過的特定節日），之後不到期。
- 失敗（連不上、格式錯、資料不完整、其他例外）：舊資料不動，約 24 小時內不重試，滿 24 小時再試。
  訊息帶來源網址、上次成功距今幾天、下一步；從沒成功過或超過 45 天升成 ERROR。
"""

import logging
from collections.abc import Callable
from contextlib import nullcontext
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.imports.holiday_csv import parse_calendar_csv
from app.imports.holiday_fetch import FetchError
from app.jobs.holiday_sync import HolidaySyncJob, sync_now
from app.services.calendar import get_calendar, last_synced_at, replace_official_years
from tests.calendar_samples import NTPC_2026_ROWS, NTPC_SAMPLE, ntpc_full_year

NOW = datetime(2026, 10, 2, 1, 0, tzinfo=UTC)
SOURCE = "https://example.test/calendar.csv"


def full_2026() -> bytes:
    return ntpc_full_year(2026, NTPC_2026_ROWS)


def job_for(db: Session, fetch: Callable[[], bytes]) -> HolidaySyncJob:
    return HolidaySyncJob(session_scope=lambda: nullcontext(db), fetch=fetch, source_url=SOURCE)


def unreachable() -> bytes:
    raise FetchError("抓不到 https://example.test：timed out")


def sync_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == "app.jobs.holiday_sync"]


def test_sync_now_imports_complete_file(db: Session) -> None:
    parsed = sync_now(db, fetch=full_2026, now=NOW)

    assert parsed.years == frozenset({2026})
    assert last_synced_at(db) == NOW


def test_sync_now_rejects_incomplete_file(db: Session) -> None:
    with pytest.raises(ValueError, match="資料不完整"):
        sync_now(db, fetch=lambda: NTPC_SAMPLE, now=NOW)
    assert last_synced_at(db) is None


def test_due_when_never_synced(db: Session) -> None:
    assert job_for(db, full_2026).is_due(NOW)


@pytest.mark.parametrize(("age", "due"), [(timedelta(days=29), False), (timedelta(days=30), True)])
def test_due_monthly(db: Session, age: timedelta, due: bool) -> None:
    replace_official_years(db, parse_calendar_csv(NTPC_SAMPLE), imported_at=NOW - age)

    assert job_for(db, full_2026).is_due(NOW) is due


def test_run_success(db: Session, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="app.jobs.holiday_sync")
    job = job_for(db, full_2026)

    job.run(NOW)

    years, entries = get_calendar(db, date(2026, 9, 1), date(2026, 10, 31))
    assert years == [2026]
    assert [e.day for e in entries] == [date(2026, 9, 25), date(2026, 10, 9), date(2026, 10, 10)]
    assert not job.is_due(NOW + timedelta(hours=6))
    assert "假日表已同步：2026 年（新北市）" in caplog.text
    assert "下次約 2026-11-01 之後" in caplog.text
    assert "略過 2026-09-03 軍人節" in caplog.text


def test_failure_keeps_old_data_and_backs_off(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    old = NOW - timedelta(days=40)
    replace_official_years(db, parse_calendar_csv(NTPC_SAMPLE), imported_at=old)
    job = job_for(db, unreachable)
    assert job.is_due(NOW)

    job.run(NOW)

    assert last_synced_at(db) == old
    [record] = sync_records(caplog)
    assert record.levelno == logging.WARNING
    assert SOURCE in record.getMessage()
    assert "上次成功匯入是 40 天前" in record.getMessage()
    assert "holidays import" in record.getMessage()
    assert not job.is_due(NOW + timedelta(hours=23))
    assert job.is_due(NOW + timedelta(hours=24))


def test_failure_is_error_when_never_synced(db: Session, caplog: pytest.LogCaptureFixture) -> None:
    job_for(db, unreachable).run(NOW)

    [record] = sync_records(caplog)
    assert record.levelno == logging.ERROR
    assert "從沒成功過" in record.getMessage()


def test_incomplete_file_is_a_failure(db: Session) -> None:
    job = job_for(db, lambda: NTPC_SAMPLE)

    job.run(NOW)

    assert last_synced_at(db) is None
    assert not job.is_due(NOW + timedelta(hours=1))


def test_unexpected_error_backs_off_with_traceback(
    db: Session, caplog: pytest.LogCaptureFixture
) -> None:
    def broken() -> bytes:
        raise RuntimeError("bug")

    job = job_for(db, broken)
    job.run(NOW)

    [record] = sync_records(caplog)
    assert record.exc_info is not None
    assert not job.is_due(NOW + timedelta(hours=1))
