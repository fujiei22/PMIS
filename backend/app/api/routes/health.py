"""健康檢查：程式有在跑、資料庫連得上就回 ok。

免登入，是「每支端點都要登入」的明確例外（見 backend/README.md）。
"""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import SessionDep

router = APIRouter(tags=["health"])


class HealthStatus(BaseModel):
    status: Literal["ok"]


@router.get("/health")
def health(session: SessionDep) -> HealthStatus:
    # 連不上資料庫時這行會丟例外，回應變成 500。
    session.execute(text("SELECT 1"))
    return HealthStatus(status="ok")
