"""程式啟動時要開的背景排程（`app/lifespan.py` 呼叫）。

兩層開關：BACKGROUND_JOBS_ENABLED 關掉全部背景工作；HOLIDAY_SYNC_ENABLED 只管假日表。
新增一個背景工作：寫一個符合 `Job` 的類別，加進 `default_jobs()`（必要時再加自己的開關）。
"""

import logging
from collections.abc import Sequence
from datetime import timedelta

from app.core.config import Settings, get_settings
from app.jobs.holiday_sync import HolidaySyncJob
from app.jobs.scheduler import CHECK_EVERY, Job, Scheduler

logger = logging.getLogger(__name__)


def default_jobs(settings: Settings) -> list[Job]:
    """依設定列出要跑的背景工作。"""
    jobs: list[Job] = []
    if settings.HOLIDAY_SYNC_ENABLED:
        jobs.append(HolidaySyncJob())
    return jobs


def start_background_jobs(
    *, enabled: bool | None = None, jobs: Sequence[Job] | None = None
) -> Scheduler | None:
    """總開關開著、而且有工作要跑，就啟動排程並回傳（呼叫端負責 stop）；否則回 None。

    `enabled`、`jobs` 給測試用；平常不傳，照設定。
    """
    settings = get_settings()
    if not (settings.BACKGROUND_JOBS_ENABLED if enabled is None else enabled):
        logger.info("BACKGROUND_JOBS_ENABLED=false：不啟動背景排程")
        return None
    selected = default_jobs(settings) if jobs is None else list(jobs)
    if not selected:
        logger.info("沒有要跑的背景工作（HOLIDAY_SYNC_ENABLED=false）：不啟動背景排程")
        return None
    scheduler = Scheduler(selected)
    scheduler.start()
    logger.info(
        "背景排程已啟動：%s，每 %d 小時檢查一次",
        "、".join(job.name for job in selected),
        CHECK_EVERY // timedelta(hours=1),
    )
    return scheduler
