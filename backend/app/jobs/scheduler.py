"""背景排程：一條 daemon 執行緒，定期問每個工作「到期了沒」，到期就執行。

為什麼不用 cron 或 APScheduler：部署只有一個容器、正式環境只跑一個 worker
（docs/reference/tech-stack.md〈非同步與行程〉），內建最少設定、不加相依套件。
**開多個 worker 之前**，要先讓同一個工作只在一個 worker 上跑（例如 PostgreSQL advisory lock）。
"""

import logging
import threading
from collections.abc import Callable, Sequence
from datetime import datetime, timedelta
from typing import Protocol

from app.core.time import utc_now

logger = logging.getLogger(__name__)

# 多久檢查一次「到期了沒」。工作本身決定多久跑一次（假日表是每月），這裡只是檢查的頻率。
CHECK_EVERY = timedelta(hours=6)


class Job(Protocol):
    """排程工作：`is_due` 判斷該不該跑，`run` 執行。兩者都在背景執行緒裡呼叫。"""

    name: str

    def is_due(self, now: datetime) -> bool: ...

    def run(self, now: datetime) -> None: ...


class Scheduler:
    """`start()` 開執行緒、馬上檢查一次，之後每 `check_every` 檢查一次；`stop()` 停下。"""

    def __init__(
        self,
        jobs: Sequence[Job],
        *,
        check_every: timedelta = CHECK_EVERY,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._jobs = tuple(jobs)
        self._check_every = check_every
        self._clock = clock
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def run_pending(self) -> None:
        """到期的工作各跑一次；任何例外只記 log，不影響其他工作與之後的檢查。"""
        now = self._clock()
        for job in self._jobs:
            try:
                if job.is_due(now):
                    job.run(now)
            except Exception:
                logger.exception("背景工作 %s 失敗", job.name)

    def start(self) -> None:
        if self._thread is not None:
            raise RuntimeError("排程已經啟動")
        self._thread = threading.Thread(target=self._loop, name="pmis-scheduler", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        """要求停止並等執行緒結束，最多等 `timeout` 秒。

        正在跑的工作若沒在時限內結束（例如正在抓檔），執行緒會隨程式結束被中斷：
        該次同步的交易沒有 commit，資料庫自動 rollback，資料不會只寫一半。
        """
        self._stop.set()
        if self._thread is None:
            return
        self._thread.join(timeout)
        if self._thread.is_alive():
            logger.warning("背景排程沒有在 %s 秒內停下（可能正在抓檔），直接結束", timeout)

    def _loop(self) -> None:
        # stop() 會讓 wait 立刻返回，不必等滿 check_every
        while not self._stop.is_set():
            self.run_pending()
            self._stop.wait(self._check_every.total_seconds())
