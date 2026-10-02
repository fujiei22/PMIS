"""/api 底下所有 router 的掛載點。

新增 `routes/xxx.py` 後，在這裡加一行 `api_router.include_router(xxx.router)`。
"""

from fastapi import APIRouter

from app.api.routes import calendar, health

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(calendar.router)
