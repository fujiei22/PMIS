"""FastAPI 進入點。`uv run fastapi dev` 會自動找到這裡的 `app`。"""

from fastapi import FastAPI

from app.api.main import api_router

app = FastAPI(
    title="PMIS",
    # 所有後端網址都在 /api 底下，其他網址之後留給前端頁面。
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url=None,
)
app.include_router(api_router, prefix="/api")
