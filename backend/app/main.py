"""FastAPI 進入點。`uv run fastapi dev` 會自動找到這裡的 `app`。"""

from fastapi import FastAPI

from app.api.main import api_router
from app.lifespan import lifespan

app = FastAPI(
    title="PMIS",
    # 所有後端網址都在 /api 底下，其他網址之後留給前端頁面。
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url=None,
    # 同一個 model 在請求與回應裡都用同一個 schema 名稱（不拆成 Xxx-Input / Xxx-Output），
    # 前端由 OpenAPI 產生的型別名稱才穩定（見 app/scripts/export_openapi.py）。
    separate_input_output_schemas=False,
    # 啟動時設定 app logging、開背景排程（每月同步假日表），結束時停下。
    lifespan=lifespan,
)
app.include_router(api_router, prefix="/api")
