"""把後端的 OpenAPI 文件匯出成 `frontend/src/api/http/openapi.json`。

改了端點、request / response model 之後，依序跑這兩個指令，兩個產物一起 commit：

    uv run python -m app.scripts.export_openapi   # 在 backend/：產生 openapi.json
    npm run gen:api                               # 在 frontend/：由 openapi.json 產生 schema.ts

忘了跑，後端的 `tests/test_openapi_snapshot.py` 或前端的
`src/api/__tests__/openapi-schema.spec.ts` 會紅。不需要資料庫。
"""

import json
import logging
from pathlib import Path

from app.main import app

# 本檔在 backend/app/scripts/，往上三層是 repo 根目錄。
REPO_ROOT = Path(__file__).resolve().parents[3]
OPENAPI_JSON = REPO_ROOT / "frontend" / "src" / "api" / "http" / "openapi.json"

logger = logging.getLogger(__name__)


def render_openapi() -> str:
    """OpenAPI 文件的固定格式：鍵排序、縮排 2、中文不跳脫、結尾換行。

    格式固定，API 沒變時重新產生的檔案一個字都不會變，diff 只出現真正的改動。
    """
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> None:
    OPENAPI_JSON.parent.mkdir(parents=True, exist_ok=True)
    # newline="\n"：Windows 上也寫 LF，跟 CI（Linux）產生的一樣。
    OPENAPI_JSON.write_text(render_openapi(), encoding="utf-8", newline="\n")
    logger.info("已寫入 %s；接著在 frontend/ 跑 npm run gen:api", OPENAPI_JSON)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
