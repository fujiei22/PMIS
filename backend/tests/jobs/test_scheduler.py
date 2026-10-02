"""背景排程。

測案：
- 只跑到期的工作；同一次檢查裡每個工作拿到同一個時間。
- 一個工作丟例外不影響其他工作，也不讓排程停下（例外記進 log）。
- start 後馬上做第一次檢查；stop 會讓執行緒結束；不能 start 兩次；沒 start 也能 stop。
- stop 逾時（工作還在跑）要記 warning，不能悄悄結束。
"""

import threading
from datetime import UTC, datetime, timedelta
from itertools import count

import pytest

from app.jobs.scheduler import Scheduler

NOW = datetime(2026, 10, 2, 1, 0, tzinfo=UTC)


class FakeJob:
    def __init__(
        self,
        name: str,
        *,
        due: bool = True,
        error: Exception | None = None,
        block: threading.Event | None = None,
    ) -> None:
        self.name = name
        self.due = due
        self.error = error
        self.block = block
        self.runs: list[datetime] = []
        self.ran = threading.Event()

    def is_due(self, now: datetime) -> bool:
        return self.due

    def run(self, now: datetime) -> None:
        self.runs.append(now)
        self.ran.set()
        if self.block is not None:
            self.block.wait(timeout=5)
        if self.error is not None:
            raise self.error


def test_runs_only_due_jobs_with_one_timestamp() -> None:
    ticks = count()
    first = FakeJob("first")
    idle = FakeJob("idle", due=False)
    second = FakeJob("second")

    Scheduler(
        [first, idle, second], clock=lambda: NOW + timedelta(seconds=next(ticks))
    ).run_pending()

    assert first.runs == second.runs == [NOW]
    assert idle.runs == []


def test_failing_job_does_not_stop_others(caplog: pytest.LogCaptureFixture) -> None:
    broken = FakeJob("broken", error=RuntimeError("boom"))
    healthy = FakeJob("healthy")

    Scheduler([broken, healthy], clock=lambda: NOW).run_pending()

    assert healthy.runs == [NOW]
    assert "背景工作 broken 失敗" in caplog.text


def test_start_checks_immediately_and_stop_ends_thread() -> None:
    job = FakeJob("job")
    scheduler = Scheduler([job], check_every=timedelta(hours=6))

    scheduler.start()
    try:
        assert job.ran.wait(timeout=5)
        assert scheduler.is_running
    finally:
        scheduler.stop()

    assert not scheduler.is_running


def test_cannot_start_twice() -> None:
    scheduler = Scheduler([], check_every=timedelta(hours=6))
    scheduler.start()
    try:
        with pytest.raises(RuntimeError, match="已經啟動"):
            scheduler.start()
    finally:
        scheduler.stop()


def test_stop_without_start_is_harmless() -> None:
    Scheduler([]).stop()


def test_stop_timeout_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    release = threading.Event()
    job = FakeJob("slow", block=release)
    scheduler = Scheduler([job], check_every=timedelta(hours=6))
    scheduler.start()
    assert job.ran.wait(timeout=5)

    scheduler.stop(timeout=0.05)

    assert "沒有在 0.05 秒內停下" in caplog.text
    release.set()
    scheduler.stop()
