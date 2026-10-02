"""守住「repo 裡的 openapi.json 跟後端程式一致」。

前端的 API 型別（`frontend/src/api/http/schema.ts`）是由 `frontend/src/api/http/openapi.json`
產生的，而那份 JSON 又是由後端程式匯出的。改了 API 卻沒有重新匯出，前端拿到的型別就是舊的，
要到串接時才會發現。這支測試在後端這一側擋：程式現在的 OpenAPI 跟 repo 裡那份不同就紅。
前端那一側（JSON → schema.ts）由 `frontend/src/api/__tests__/openapi-schema.spec.ts` 擋。
"""

from difflib import unified_diff
from itertools import islice

import pytest

from app.main import app
from app.scripts.export_openapi import OPENAPI_JSON, render_openapi

HOW_TO_FIX = (
    "改了 API，要重新產生前端用的兩個產物，連同程式一起 commit：\n"
    "  1. 在 backend/ 跑：uv run python -m app.scripts.export_openapi\n"
    "  2. 在 frontend/ 跑：npm run gen:api（沒裝過前端套件要先 npm ci）"
)

DIFF_LINES = 80


def test_openapi_json_matches_app() -> None:
    expected = render_openapi()
    if not OPENAPI_JSON.is_file():
        pytest.fail(f"找不到 {OPENAPI_JSON}。\n{HOW_TO_FIX}", pytrace=False)

    actual = OPENAPI_JSON.read_text(encoding="utf-8")
    if actual != expected:
        diff = unified_diff(
            actual.splitlines(keepends=True),
            expected.splitlines(keepends=True),
            fromfile="repo 裡的 openapi.json",
            tofile="後端程式現在的 OpenAPI",
        )
        pytest.fail(
            f"frontend/src/api/http/openapi.json 跟後端程式不一致。\n{HOW_TO_FIX}\n\n"
            f"差異（最多 {DIFF_LINES} 行）：\n{''.join(islice(diff, DIFF_LINES))}",
            pytrace=False,
        )


def test_request_and_response_share_schema_names() -> None:
    # 開著的話，同一個 model 在 OpenAPI 裡會拆成 Xxx-Input 與 Xxx-Output 兩個名稱，
    # 前端產生的型別名稱會隨「有沒有拿來當請求」而變。
    assert app.separate_input_output_schemas is False, (
        "app/main.py 的 FastAPI(...) 要設 separate_input_output_schemas=False"
    )
