"""app.* 的 log 輸出。

測案：
- 沒有任何人設定 log 時（uvicorn／fastapi dev 不設 root）：加一個帶時間與等級的 handler，
  INFO 印得出來；重複呼叫（fastapi dev 重載）不會重複加。
- 已經有人設定（pytest、部署時的 --log-config）：不加 handler，交給既有的輸出，但 INFO 仍然放行。
"""

import logging
from collections.abc import Iterator

import pytest

from app.core.logging import setup_app_logging


@pytest.fixture
def app_logger(monkeypatch: pytest.MonkeyPatch) -> Iterator[logging.Logger]:
    """暫時清空 app logger 的 handler；結束時用 setLevel 還原等級（會一併清掉子 logger 的快取）。"""
    logger = logging.getLogger("app")
    monkeypatch.setattr(logger, "handlers", [])
    original = logger.level
    yield logger
    logger.setLevel(original)


def test_adds_one_handler_when_nothing_configured(
    app_logger: logging.Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(logging.getLogger(), "handlers", [])

    setup_app_logging()
    setup_app_logging()

    assert len(app_logger.handlers) == 1
    assert logging.getLogger("app.jobs.holiday_sync").isEnabledFor(logging.INFO)


def test_leaves_output_to_existing_handlers(
    app_logger: logging.Logger, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(logging.getLogger(), "handlers", [logging.NullHandler()])

    setup_app_logging()

    assert app_logger.handlers == []
    assert logging.getLogger("app.jobs.holiday_sync").isEnabledFor(logging.INFO)
