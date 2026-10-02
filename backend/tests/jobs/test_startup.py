"""依設定啟動背景排程。

測案：
- 總開關關閉時不啟動（測試環境預設就是關的：tests/conftest.py）。
- 假日表同步關閉時沒有工作、不啟動。
- 開著時啟動排程並馬上檢查一次；呼叫端負責 stop。每種情況都記一行 INFO。
"""

import logging
import threading
from datetime import datetime

import pytest

from app.core.config import get_settings
from app.jobs.holiday_sync import HolidaySyncJob
from app.jobs.startup import default_jobs, start_background_jobs


class FakeJob:
    name = "fake"

    def __init__(self) -> None:
        self.ran = threading.Event()

    def is_due(self, now: datetime) -> bool:
        return True

    def run(self, now: datetime) -> None:
        self.ran.set()


def test_disabled_in_tests_by_default(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="app.jobs.startup")
    assert start_background_jobs() is None
    assert "BACKGROUND_JOBS_ENABLED=false" in caplog.text


def test_default_jobs_follow_holiday_switch() -> None:
    on = get_settings().model_copy(update={"HOLIDAY_SYNC_ENABLED": True})
    off = get_settings().model_copy(update={"HOLIDAY_SYNC_ENABLED": False})

    assert [type(job) for job in default_jobs(on)] == [HolidaySyncJob]
    assert default_jobs(off) == []


def test_no_jobs_means_no_scheduler(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="app.jobs.startup")
    assert start_background_jobs(enabled=True, jobs=[]) is None
    assert "沒有要跑的背景工作" in caplog.text


def test_enabled_starts_scheduler(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="app.jobs.startup")
    job = FakeJob()

    scheduler = start_background_jobs(enabled=True, jobs=[job])

    assert scheduler is not None
    try:
        assert job.ran.wait(timeout=5)
    finally:
        scheduler.stop()
    assert "背景排程已啟動：fake" in caplog.text
