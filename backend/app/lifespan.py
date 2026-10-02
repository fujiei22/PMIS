"""FastAPI 的 lifespan：程式啟動時設定 app logging、開背景排程，結束時停下。

FastAPI 規定 lifespan 是 async，所以獨立成這支小檔、列在 tests/test_async_whitelist.py 的白名單；
這裡只開關執行緒、不碰資料庫。停止要等執行緒結束，丟到 thread pool 等，不卡 event loop。
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool

from app.core.logging import setup_app_logging
from app.jobs.startup import start_background_jobs


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """啟動：設定 app logging、開背景排程（設定關掉時不開）。結束：停下背景排程。"""
    setup_app_logging()
    scheduler = start_background_jobs()
    try:
        yield
    finally:
        if scheduler is not None:
            await run_in_threadpool(scheduler.stop)
