"""lifespan：程式啟動時開背景排程、結束時停下（main.py 漏掛 lifespan 時這支會紅）。"""

import threading
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.jobs.scheduler import Scheduler
from app.main import app


class FakeJob:
    name = "fake"

    def __init__(self) -> None:
        self.ran = threading.Event()

    def is_due(self, now: datetime) -> bool:
        return True

    def run(self, now: datetime) -> None:
        self.ran.set()


def test_lifespan_starts_and_stops_background_jobs(monkeypatch: pytest.MonkeyPatch) -> None:
    job = FakeJob()
    scheduler = Scheduler([job], check_every=timedelta(hours=6))

    def fake_start() -> Scheduler:
        scheduler.start()
        return scheduler

    monkeypatch.setattr("app.lifespan.start_background_jobs", fake_start)

    with TestClient(app):
        assert job.ran.wait(timeout=5)
        assert scheduler.is_running

    assert not scheduler.is_running
