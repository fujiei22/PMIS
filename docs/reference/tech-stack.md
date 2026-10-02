# 技術棧

PMIS 使用的技術與使用慣例。新加入的開發者先讀這份。

前端已建置；後端有健康檢查與工作日曆（假日表）兩支端點（見〈後端：技術一覽〉）。

## 前端：技術一覽

| 項目 | 使用 |
|---|---|
| 框架 | Vue 3（Composition API、`<script setup>`） |
| 語言 | TypeScript |
| 建置 | Vite |
| 樣式 | SFC `<style scoped>` + CSS 變數 |
| 狀態管理 | Pinia |
| 路由 | Vue Router |
| UI 元件庫 | 不使用，元件全部自行實作 |
| 單元測試 | Vitest |
| E2E 測試 | Playwright |
| 程式碼檢查 | ESLint + Prettier |

專案以 Vue 官方範本 `npm create vue@latest` 建立，勾選 TypeScript、Vue Router、Pinia、Vitest、End-to-End Testing（Playwright）、ESLint、Prettier。

## 前端：常用指令

以下指令在 `frontend/` 下執行（從 repo 根目錄先 `cd frontend`）。下表對應 `frontend/package.json` 的 `scripts`。

| 指令 | 實際執行 | 用途 |
|---|---|---|
| `npm run dev` | `vite` | 啟動本機開發伺服器（預設 <http://localhost:5174>，可用 `PLAYWRIGHT_PORT` 改），存檔即時更新 |
| `npm run build` | `run-p type-check "build-only {@}" --` | 型別檢查 + 打包並行跑，輸出到 `dist/`；任一失敗即中斷（多出來的參數轉給 `build-only`） |
| `npm run build-only` | `vite build` | 只打包，不做型別檢查 |
| `npm run type-check` | `vue-tsc --build` | 只做型別檢查（含 `e2e/` 這個 project） |
| `npm run preview` | `vite preview` | 在本機預覽打包結果 |
| `npm run lint` | `eslint . --fix --cache` | ESLint 檢查並自動修正 |
| `npm run format` | `prettier --write src/` | 用 Prettier 格式化 `src/`（產生檔列在 `.prettierignore`，不排版） |
| `npm run gen:api` | `openapi-typescript src/api/http/openapi.json -o src/api/http/schema.ts` | 由後端匯出的 OpenAPI 產生 API 型別；改了 API 才要跑，見〈後端：使用慣例〉的〈API 契約〉 |
| `npm run test:unit` | `vitest` | Vitest 單元測試（watch 模式；一次跑完用 `npm run test:unit -- --run`） |
| `npm run test:e2e` | `playwright test` | Playwright E2E 測試（自己起一份 dev server） |

注意：`npm run dev` 只轉換、不做型別檢查（Vite 只刪掉型別），型別錯誤靠編輯器提示；提交前至少跑一次 `npm run build`。

## 前端：使用慣例

### TypeScript
- 資料模型（Task、Issue、Member、Comment 等）集中定義型別，元件與 store 一律引用，不各自重寫。
- 避免 `any`；可能為空的值（例如用 id 查不到資料）要先判斷再使用。

### 樣式
- 顏色、字級、間距、圓角、陰影一律使用全域 CSS 變數（`var(--accent)`、`var(--fs-control)` …），不直接寫色碼或像素值。
- 元件樣式寫在該 `.vue` 檔的 `<style scoped>`。
- 只有執行時計算出來的值（例如甘特條的位置與寬度、進度條寬度）用 `:style` 綁定。
- 需要新的設計值時，先加進全域變數，再引用。

### 狀態管理
- 多個元件共用的資料放 Pinia store；只有單一元件用到的狀態（下拉的 hover 列、卡片 hover）留在元件內部。
- store 裡的欄位分兩類，寫法不同（review M8）：
  - **UI 狀態欄位**（`ui` / `filter` / `comment` 的浮層開關、選取中的分頁、篩選條件、草稿文字…）：元件可以直接寫，例如 `ui.editing = { kind: 't', id }`、`filter.issueMode = 'has'`。這類欄位只描述畫面狀態，沒有連動規則。
  - **資料欄位**（`tasks` / `issues` / `deps` / `groups` / `comments`）：一律透過 action 改，例如 `taskStore.updateTask()`、`commentStore.send()`。它們背後有 cascade、api 呼叫與失敗還原、懸空 id 清理等連動，繞過 action 就會漏做。

#### store 分三層
依賴只能由上往下：**時鐘層** `clock`（`now` / `todayIdx` / `todayIso`，誰都能讀）→ **資料層** `task` / `issue` / `comment` / `member` / `budget` / `project`（專案資料的唯一擁有者）→ **派生層** `rows` / `filter` / `selection` / `ui`（算畫面要的東西，可讀所有層）。

資料層不知道派生層存在：新增的預設值由 `composables/useTaskActions.ts` 算好傳進去，懸空 id 由 `selection` / `ui` 各自的 `watch(flush: 'sync')` 清，錯誤條靠 `_optimistic.setErrorSink()` 注入。白名單由 `src/stores/__tests__/imports.spec.ts` 讀原始碼守著。

#### api 層
資料進出只走 `src/api/`：`types.ts` 的 `ProjectApi` 是介面（含 `subscribe` 事件），`mock/` 是記憶體實作，`index.ts` 依 `VITE_API` 挑一個。**store 與元件一律 `import { api } from '@/api'`**，不直接碰 `@/api/mock`，更不碰 `@/mocks/*`。

#### 樂觀更新
寫入一律「先改本地、再打 api、失敗還原」，共用機制在 `src/stores/_optimistic.ts`（`createTracker` / `runOptimistic`，以 id 為單位記最後已知的 server 狀態與 in-flight 計數）。拖曳每個 tick 只改本地、放開才送一次；逐鍵編輯用 `composables/useEditDraft.ts` 做 300ms debounce。事件訂閱只有 `stores/_sync.ts` 一處，啟動與錯誤 sink 注入在 `composables/useProjectBoot.ts`。

細節與後端契約（端點表、錯誤碼表、事件規則、adapter 職責）見 [`frontend/README.md` 的「怎麼接後端」](../../frontend/README.md#怎麼接後端)。

### 路由
- 每個頁面一個路由；所有專案總覽掛在 `/`，單一專案的 Dashboard 掛在 `/projects/:id`。

### 元件
- 不引入 UI 元件庫；共用的基礎元件（下拉選單、日曆、對話框等）自行實作並重複使用。

### 測試
- 純邏輯（日期計算、相依連動、篩選、排序）寫 Vitest 單元測試。
- 使用者操作流程（點選、拖曳、對話框）寫 Playwright E2E 測試。

## 後端：技術一覽

程式在 `backend/`：資料表與軟刪除機制已建，端點有 `GET /api/health` 與 `GET /api/calendar`（工作日曆，假日表由管理員用指令稿手動匯入）；其他業務端點與登入還沒做。下表的資料分析、Excel 讀寫、即時推送、登入與部署還沒導入。開工導覽見 [`backend/README.md`](../../backend/README.md)。

| 項目 | 使用 |
|---|---|
| 語言 | Python |
| 框架 | FastAPI |
| 資料驗證 | Pydantic（FastAPI 內建） |
| 資料庫 | PostgreSQL |
| 資料庫存取 | SQLAlchemy 2 |
| 資料表變更（migration） | Alembic |
| 資料分析 | pandas |
| Excel 讀寫 | openpyxl |
| 即時推送 | SSE（`/api/events`） |
| 測試 | pytest |
| 型別檢查 | mypy |
| 程式碼檢查 | ruff |
| 套件與 Python 版本管理 | uv |
| 登入 | 公司網域帳號（AD），後端經 LDAPS 驗證 |
| 部署 | Docker Compose（`app`：FastAPI 連同前端打包結果；`db`：PostgreSQL） |

部署：容器化。一支 FastAPI 程式同時提供前端打包結果（`frontend/dist/`）、`/api` 與 `/api/events`，同一個網域；不認得的網址回 `index.html`，交給 Vue Router。

## 後端：常用指令

以下指令在 `backend/` 下執行（從 repo 根目錄先 `cd backend`）。第一次安裝（建資料庫、`.env`）見 [`backend/README.md`](../../backend/README.md#第一次安裝)。

| 指令 | 設定在 | 用途 |
|---|---|---|
| `uv sync` | `pyproject.toml`、`uv.lock` | 依 `uv.lock` 安裝相依套件到 `.venv/` |
| `uv add <套件>` | `pyproject.toml`、`uv.lock` | 加相依套件（開發工具用 `uv add --dev`），兩個檔都要 commit |
| `uv run fastapi dev` | `app/main.py` | 啟動本機開發伺服器（<http://127.0.0.1:8000>），存檔自動重啟；API 文件在 `/api/docs` |
| `uv run pytest` | `[tool.pytest.ini_options]`、`tests/conftest.py` | 測試；只連 `TEST_DATABASE_URL`（名稱必須以 `_test` 結尾） |
| `uv run mypy` | `[tool.mypy]` | 型別檢查（strict ＋ pydantic plugin） |
| `uv run ruff check` | `[tool.ruff.lint]` | lint；加 `--fix` 自動修正能修的 |
| `uv run ruff format` | `[tool.ruff]` | 排版；加 `--check` 只檢查不改檔 |
| `uv run alembic upgrade head` | `alembic.ini`、`app/alembic/env.py` | 套用所有 migration（連 `DATABASE_URL`） |
| `uv run alembic revision --autogenerate -m "說明"` | 同上 | 依 `app/models.py` 的變更產生 migration |
| `uv run alembic check` | 同上 | 確認 `app/models.py` 沒有漏產 migration |
| `uv run python -m app.scripts.export_openapi` | `app/scripts/export_openapi.py` | 匯出 OpenAPI 到 `frontend/src/api/http/openapi.json`；改了 API 才要跑，見〈API 契約〉 |
| `uv run python -m app.scripts.holidays <指令>` | `app/scripts/holidays.py` | 假日表管理：`status`／`import`／`add`／`remove`／`list`（`--help` 看範例），見 [`backend/README.md`〈工作日曆（假日表）〉](../../backend/README.md#工作日曆假日表) |

`[tool.*]` 都在 `backend/pyproject.toml`。提交前至少跑一次 `ruff check`、`ruff format --check`、`mypy`、`pytest`。

## 後端：使用慣例

### 結構
- 資料夾結構參照 FastAPI 官方範本 [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) 的 `backend/`。
- 結構規則寫進 `backend/README.md` 的開工導覽，並用讀原始碼的測試守住（比照前端的 `imports.spec.ts`）。

### API 契約
- 端點、錯誤碼、事件規則以 [`frontend/README.md` 的「怎麼接後端」](../../frontend/README.md#怎麼接後端)為準。
- 前端型別由 FastAPI 產生的 OpenAPI 產生，給 `frontend/src/api/http/` 的 adapter 使用。兩個產物都進版控、不手改：後端 `uv run python -m app.scripts.export_openapi` 匯出 `frontend/src/api/http/openapi.json`，前端 `npm run gen:api` 再由它產生 `schema.ts`（openapi-typescript）。
- **改了端點或 request / response model，依序跑上面兩個指令**，產物連同程式一起 commit；忘了跑，CI 的比對測試會失敗（見〈CI〉）。細節見 [`backend/README.md` 的〈API 契約與前端型別〉](../../backend/README.md#api-契約與前端型別)。
- wire 格式的欄位名稱是 camelCase：Pydantic model 繼承 `backend/app/schemas/common.py` 的 `CamelModel`，Python 照樣寫 snake_case。
- 請求資料一律經 Pydantic model 驗證；沒列在 model 裡的欄位一律不寫入（請求用的 model 設 `extra="forbid"`，多送的欄位直接 422）。

### 即時推送
- SSE 端點是 `/api/events`，每則 `data` 是一個 `ProjectEvent` 的 JSON，事件規則見 [`frontend/README.md` 的「事件」](../../frontend/README.md#事件)。
- 建立連線時驗證登入；端點不開 CORS，只給 PMIS 自己的網域用。
- 後端定期送心跳註解（例如每 15 秒一行 `: ping`），避免閒置連線被中間設備切斷；斷線由瀏覽器的 `EventSource` 自動重連，重連後補發 `project.reloaded` 由前端 adapter 負責。
- 前面若有反向代理（nginx、IIS 等），要關閉這個端點的回應緩衝（nginx 可由後端送 `X-Accel-Buffering: no`），並建議開 HTTP/2：HTTP/1.1 下瀏覽器對同一個網域最多 6 條連線，每個開著 Dashboard 的分頁會佔掉一條。

### 金額
- 資料庫欄位用 `NUMERIC`，程式裡用 `Decimal`，不用 `float`。
- 加總、統計在資料庫（SQL）做。

### 非同步與行程
- 一般 API 用 `def`；只有 SSE 與 AI 串流回應用 `async def`，而且裡面不呼叫同步的資料庫套件。以讀原始碼的測試列白名單守住（`backend/tests/test_async_whitelist.py`）。
- 正式環境只跑一個 worker。要開多個 worker 前，先讓事件經 PostgreSQL 的 `LISTEN` / `NOTIFY` 在 worker 之間傳遞。
- 耗時的分析（例如預測）放排程的背景工作，結果寫進資料表，API 只讀結果。

### 資料庫變更
- 資料表變更一律寫成 Alembic migration。自動產生的 migration 要逐行確認，改欄位名稱可能被產生成「刪欄位＋加欄位」，舊資料會遺失。
- 正式環境的 migration 不交給 AI 直接執行。
- 資料庫每日自動備份。

### 設定與檔案
- 設定（資料庫位址、網域伺服器位址、外部 AI 服務的金鑰等）一律從環境變數讀，不寫死在程式裡。
- 附件存放的資料夾由設定指定，不寫死在程式資料夾底下。
- 程式要能在 Linux 上執行（正式環境的容器是 Linux）：路徑用 `pathlib` 組，import 與檔名的大小寫要一致。

### 安全
- 每支端點預設都要登入與授權，開放的例外要明寫。
- 外部 AI 服務的金鑰只放後端的環境變數，不進前端程式，也不進版控。

### CI
- `.github/workflows/ci.yml`：每個 PR 與每次 push 到 `main`，在 Linux（`ubuntu-latest`）上平行跑三個 job：
  - `backend`：`uv sync --locked`、`ruff check`、`ruff format --check`、`mypy`、`pytest`（連 PostgreSQL 18 容器裡的 `pmis_test`）、`alembic check`。
  - `frontend`：ESLint（只檢查、不自動修正）、Prettier（`prettier --check src/`，跟 `npm run format` 同範圍）、`npm run type-check`、`npm run test:unit -- --run`、`npm run build-only`。
  - `e2e`：Playwright（Chromium）；失敗時上傳 `playwright-report`。
- OpenAPI 型別比對：不另開 job，由上面兩個 job 的測試各擋一段。
  - `backend` 的 pytest 跑 `backend/tests/test_openapi_snapshot.py`：`app.openapi()` 的輸出跟 `frontend/src/api/http/openapi.json` 不同就失敗（程式 → JSON）。
  - `frontend` 的單元測試跑 `frontend/src/api/__tests__/openapi-schema.spec.ts`：用 openapi-typescript 的 Node API 由 `openapi.json` 重新產生一次，跟 `schema.ts` 不同就失敗（JSON → TypeScript）。
  - 產生檔 `schema.ts` 不經 ESLint（`eslint.config.ts` 的忽略清單），兩個產生檔都不經 Prettier（`frontend/.prettierignore`）。
