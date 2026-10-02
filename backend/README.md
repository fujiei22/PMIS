# PMIS 後端

Python（FastAPI）＋ PostgreSQL。技術一覽與使用慣例見 [`docs/reference/tech-stack.md`](../docs/reference/tech-stack.md) 的〈後端〉各節；要實作的端點、錯誤碼與事件契約見 [`frontend/README.md` 的「怎麼接後端」](../frontend/README.md#怎麼接後端)。

## 現況

資料表與軟刪除（回收桶）機制已建好（`app/models.py`，規則見下面〈資料表與 migration〉〈軟刪除〉）。端點有 `GET /api/health`（程式有在跑、資料庫連得上就回 `{"status": "ok"}`）與 `GET /api/calendar`（工作日曆，見下面〈工作日曆（假日表）〉）；背景排程每月同步假日表。其他業務端點與登入還沒做，前端也還沒接上。

## 安裝與指令

需要 [uv](https://docs.astral.sh/uv/) 與 PostgreSQL（本機開發用 18）。Python 由 uv 依 `.python-version`（3.13）自動準備，不必另外安裝。

以下指令都在 `backend/` 下執行（從 repo 根目錄先 `cd backend`）。

### 第一次安裝

1. 安裝相依套件（建立 `.venv/`）：

   ```sh
   uv sync
   ```

2. 建立兩個資料庫：開發用 `pmis`、測試用 `pmis_test`。用 psql（`psql -U postgres`）或 pgAdmin 執行：

   ```sql
   CREATE DATABASE pmis;
   CREATE DATABASE pmis_test;
   ```

3. 複製設定檔，再把裡面的帳號密碼改成本機的：

   ```sh
   cp .env.example .env              # PowerShell：Copy-Item .env.example .env
   ```

4. 套用 migration，然後啟動：

   ```sh
   uv run alembic upgrade head
   uv run fastapi dev
   ```

   打開 <http://127.0.0.1:8000/api/health> 應該看到 `{"status":"ok"}`；API 文件在 <http://127.0.0.1:8000/api/docs>。

### 常用指令

| 指令 | 用途 |
|---|---|
| `uv sync` | 依 `uv.lock` 安裝相依套件 |
| `uv add <套件>` | 加相依套件（開發工具用 `uv add --dev`）；`pyproject.toml` 與 `uv.lock` 都會變，兩個都要 commit |
| `uv run fastapi dev` | 開發伺服器 <http://127.0.0.1:8000>，存檔自動重啟 |
| `uv run pytest` | 測試（連 `TEST_DATABASE_URL`） |
| `uv run mypy` | 型別檢查（strict） |
| `uv run ruff check` | lint；加 `--fix` 自動修正能修的 |
| `uv run ruff format` | 排版；加 `--check` 只檢查不改檔 |
| `uv run alembic upgrade head` | 套用所有 migration |
| `uv run alembic revision --autogenerate -m "說明"` | 依 `app/models.py` 的變更產生 migration |
| `uv run alembic check` | 確認 `app/models.py` 沒有漏產 migration |
| `uv run python -m app.scripts.export_openapi` | 匯出 OpenAPI 到 `frontend/src/api/http/openapi.json`（改了 API 才要跑，見〈API 契約與前端型別〉） |
| `uv run python -m app.scripts.holidays <指令>` | 假日表管理：`status`／`sync`／`import`／`add`／`remove`／`list`（`--help` 看範例），見〈工作日曆（假日表）〉 |

### 提交前

依序跑，全綠再 commit：

```sh
uv run ruff check
uv run ruff format --check
uv run mypy
uv run pytest
```

改了端點或 request / response model，另外要重新產生前端型別，見〈API 契約與前端型別〉。CI 在 Linux 上跑同樣的檢查，另外加 `alembic check`（見 `.github/workflows/ci.yml`）。

## 目錄結構

結構參照 FastAPI 官方範本 [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) 的 `backend/`。

```
backend/
├── app/
│   ├── main.py              FastAPI 進入點，所有 router 掛在 /api 底下
│   ├── lifespan.py          啟動時設定 app logging、開背景排程，結束時停下（async 白名單裡唯一的檔）
│   ├── models.py            資料表定義（SQLAlchemy 2，全部繼承 Base；目前單檔，超過約 600 行再拆）
│   ├── api/
│   │   ├── main.py          把 routes/ 的 router 集合起來
│   │   ├── deps.py          端點共用的依賴（SessionDep：每個請求一個資料庫 session）
│   │   └── routes/          端點，一個主題一個檔（health.py、calendar.py）
│   ├── schemas/             wire 格式（Pydantic model）；common.py 的 CamelModel 是共用基底
│   ├── scripts/             指令稿（export_openapi.py 開發用；holidays.py 管理員維護假日表）
│   ├── core/
│   │   ├── config.py        設定（pydantic-settings，從環境變數與 .env 讀）
│   │   ├── db.py            engine 與 session
│   │   ├── logging.py       app.* 的 log 輸出（uvicorn 不設定 root，不設的話 INFO 會被丟掉）
│   │   ├── soft_delete.py   軟刪除：SoftDeleteMixin 與「查詢自動排除已刪除」
│   │   └── time.py          today()：用設定的 TIMEZONE 算「今天」；utc_now()
│   ├── services/            商業邏輯（不 import fastapi，丟 errors.py 的例外）
│   │   ├── _live.py         get_live()：依 id 取一筆活著的資料
│   │   ├── calendar.py      工作日曆：官方日曆整年替換、查詢、例外日
│   │   └── errors.py        service 的例外（NotFound、InvalidInput…）
│   ├── imports/             匯入外部資料的純函式（不碰資料庫、不 import fastapi）：辦公日曆 CSV 解析與抓檔
│   ├── jobs/                背景排程（不 import fastapi）：scheduler.py、holiday_sync.py、startup.py
│   └── alembic/             migration：env.py、script.py.mako（新檔的範本）、versions/
├── tests/                   pytest；目錄對應 app/（tests/api/routes/ 對 app/api/routes/）
│   ├── conftest.py          測試資料庫、交易 rollback、client 與 db fixture；關背景排程、禁連外網
│   ├── db_guard.py          測試資料庫名稱檢查
│   ├── calendar_samples.py  辦公日曆的真實 CSV 樣本與「完整一年」產生器
│   ├── factories.py         測試資料工廠：make_member()、make_task()…、soft_delete()
│   ├── helpers.py           assert_no_live_orphans()：活著的資料上層一定也活著
│   ├── test_soft_delete.py  軟刪表清單；每種查詢都碰不到已刪除的資料
│   ├── test_source_rules.py 讀原始碼守住：不繞過軟刪除、分層
│   ├── test_schema.py       資料庫約束（複合外鍵、部分唯一索引、檢查約束、批次）
│   ├── test_openapi_snapshot.py  frontend/src/api/http/openapi.json 跟程式一致
│   ├── test_async_whitelist.py   async def 白名單
│   └── test_alembic_ini.py  alembic.ini 只能有 ASCII
├── alembic.ini              Alembic 設定（只能寫英文）
├── pyproject.toml           相依套件，以及 ruff、mypy、pytest 的設定
├── uv.lock                  鎖定的套件版本（進版控）
├── .python-version          Python 版本
└── .env.example             環境變數範本
```

新增一組端點：在 `app/api/routes/` 加一個檔、宣告 `router = APIRouter()`，再到 `app/api/main.py` 加一行 `include_router`；測試放 `tests/api/routes/test_<同名>.py`。

## 規則

### 設定

一律從環境變數讀，不寫死在程式裡。開發時寫在 `backend/.env`（不進版控）；同名的環境變數優先於 `.env`。新增設定要同時加進 `app/core/config.py` 的 `Settings` 與 `.env.example`。

| 環境變數 | 用途 |
|---|---|
| `DATABASE_URL` | app 與 alembic 連的資料庫 |
| `TEST_DATABASE_URL` | pytest 連的資料庫，名稱必須以 `_test` 結尾 |
| `TIMEZONE` | 「今天」用的時區，預設 `Asia/Taipei`（正式環境的容器是 UTC，不能用伺服器時區算日期） |
| `BACKGROUND_JOBS_ENABLED` | 背景排程的總開關，預設 `true`；pytest 一律關閉 |
| `HOLIDAY_SYNC_ENABLED` | 假日表每月自動同步，預設 `true`；伺服器連不到外網時設 `false`，改手動 `import` |
| `HOLIDAY_SOURCE_URL` | 自動同步抓的 CSV，只接受 https；預設新北市資料開放平臺的辦公日曆 |

連線字串格式是 `postgresql+psycopg://帳號:密碼@主機:port/資料庫名稱`；用別的開頭（例如 `postgresql://`）啟動時會直接報錯。

### def 與 async def

- 端點與一般函式一律用 `def`。只有 SSE（`/api/events`）、AI 串流回應與 lifespan（`app/lifespan.py`，FastAPI 規定要 async；只開關執行緒）用 `async def`，而且裡面不呼叫同步的資料庫（`async def` 裡做同步的資料庫存取，會讓整支程式停住，所有請求一起等）。
- `tests/test_async_whitelist.py` 讀 `app/` 的原始碼：出現 `async def` 的檔案必須列在它的 `ASYNC_ALLOWED`（目前只有 `lifespan.py`），否則測試失敗。

### API 契約與前端型別

前端呼叫 API 用的型別由後端程式產生，兩個產物都進版控、都不手改：

| 檔案 | 怎麼產生 |
|---|---|
| `frontend/src/api/http/openapi.json` | `app/scripts/export_openapi.py` 從 `app.openapi()` 匯出（鍵排序、固定縮排，API 沒變就一個字都不變；不需要資料庫） |
| `frontend/src/api/http/schema.ts` | 前端的 `npm run gen:api` 用 openapi-typescript 從上面那份產生 |

**改了端點或 request / response model（欄位、型別、預設值、端點的 docstring）之後，依序跑這兩個指令，產物連同程式一起 commit：**

```sh
# 在 backend/
uv run python -m app.scripts.export_openapi
# 在 frontend/（還沒裝過前端套件要先 npm ci）
npm run gen:api
```

忘了跑會被兩支測試擋下，CI 現有的 `backend` 與 `frontend` job 都會跑到：

- `tests/test_openapi_snapshot.py`：`app.openapi()` 跟 `openapi.json` 不同就紅（程式 → JSON）。
- `frontend/src/api/__tests__/openapi-schema.spec.ts`：由 `openapi.json` 重新產生一次，跟 `schema.ts` 不同就紅（JSON → TypeScript）。

兩個產物遇到合併衝突時不要手動合併：取任一邊後重跑上面兩個指令。

model 的寫法：

- 繼承 `app/schemas/common.py` 的 `CamelModel`：Python 寫 snake_case，回應的 JSON 與 OpenAPI 是 camelCase，跟前端的欄位名稱一致。
- 請求用的 model 另外加 `model_config = ConfigDict(extra="forbid")`：多送的欄位直接 422，這就是 PATCH 的欄位白名單。
- `app/main.py` 設了 `separate_input_output_schemas=False`：同一個 model 在請求與回應裡用同一個 schema 名稱，前端的型別名稱才穩定（`test_openapi_snapshot.py` 也檢查這個設定）。
- 422 一律用 FastAPI 標準格式（`detail` 是陣列）：查詢參數的跨欄位檢查寫在 query model 的 `model_validator`（例：`app/schemas/calendar.py` 的 `CalendarQuery`），不要手寫 `HTTPException(422, detail="字串")`——OpenAPI 只宣告標準格式，前端產生的型別處理不了字串。

### 免登入的例外

每支端點預設都要登入與授權（登入還沒做）。目前明確開放、不必登入的：

- `GET /api/health`：健康檢查
- `GET /api/calendar`：工作日曆。**暫時**開放：登入還沒做；登入完成時跟其他端點一起加上驗證。寫入只有指令稿，沒有寫入 API
- `/api/docs`、`/api/openapi.json`：FastAPI 自動產生的 API 文件

### 測試

- 只連 `TEST_DATABASE_URL`。沒設定、或資料庫名稱不是以 `_test` 結尾時，pytest 直接拒絕執行，避免動到開發或正式資料。
- 第一個用到資料庫的測試開始前，會先跑一次 `alembic upgrade head`。
- 每個測試包在一個交易裡，結束時 rollback；測試裡就算 `session.commit()`，資料也不會留下來。
- 寫 API 測試用 `client`（打 API）與 `db`（直接查資料庫）兩個 fixture，範例在 `tests/conftest.py` 開頭。
- 測試資料用 `tests/factories.py` 的 `make_xxx(db, ...)` 建（只給測試在意的欄位，上層沒給就順便建）；進回收桶用 `soft_delete(db, 主體, *連帶的列)`。
- 刪除、還原的測試最後呼叫 `tests/helpers.py` 的 `assert_no_live_orphans(db)`。

### 資料表與 migration

- 資料表變更一律寫成 Alembic migration：改 `app/models.py` → `uv run alembic revision --autogenerate -m "說明"` → **逐行看產生出來的檔** → `uv run alembic upgrade head`。
- 自動產生的 migration 要逐行確認：改欄位名稱可能被產生成「刪欄位＋加欄位」，舊資料會遺失。
- 新產生的 migration 檔會自動用 ruff 修正與排版。
- CI 跑 `alembic check`：`app/models.py` 改了卻沒有對應的 migration 就失敗。
- `alembic.ini` 只能寫英文：alembic 用系統編碼讀這個檔，Windows 上遇到中文會讀檔失敗（`tests/test_alembic_ini.py` 會檢查）。
- `deletions` 與 `projects` 互相有外鍵（回收桶批次屬於專案、專案本身也能進回收桶）。`deletions.project_id` 標了 `use_alter`，autogenerate 會把它寫進 `create_table`，但建表時會被略過；之後的 migration 若要重建這兩張表，照第一支 migration 的寫法（建完 `projects` 再 `op.create_foreign_key`）。

資料表的慣例（`app/models.py` 檔頭也有）：

- 表名、欄名 snake_case，避開 SQL 保留字（`end` → `end_on`、`desc` → `description`，分類表叫 `task_groups`）。日期欄叫 `*_on`（DATE），時間點叫 `*_at`（TIMESTAMPTZ，一律帶時區）。
- 主鍵都是 UUID。前端產生 id 的（分類、任務、相依、Issue、留言）存 client 給的值；server 產生的（成員、專案、附件、刪除批次）model 有 `default=uuid.uuid4`。
- 列舉值用 TEXT ＋ CHECK，不用 PostgreSQL 的 ENUM（之後加值只要改 CHECK）。
- 「同一個專案」用複合外鍵保證：被參照的表有 `UNIQUE (id, project_id)`，參照端用 `(xxx_id, project_id)` 指過去，跨專案的資料寫不進去。
- 要保留插入順序的表（相依、Issue、留言）有 `seq`（自動遞增）：同一個交易裡 `now()` 都一樣，不能拿 `created_at` 排序。
- 排序鍵 `position`：重排時整份重寫成 0..n-1；不設唯一（還原回來的列可能跟別人同號），讀取時 `ORDER BY position, id`。
- 上層對下層的關聯（`Project.groups`、`Task.issues`…）一定要寫：ORM 靠它決定同一次 flush 先寫上層。連動刪除交給資料庫的 `ON DELETE`。
- 結束日不早於開始日、`done` 只在完成時有值這類業務規則不在資料庫擋（那是前端的連動計算負責的）。

### 工作日曆（假日表）

前端用工作天算工期。預設規則：週六日（ISO 星期 6、7，唯一定義在 `app/imports/holiday_csv.py` 的 `WEEKEND_ISO_DAYS`）放假、其他上班；資料表只存跟預設不同、或有名稱的日子。

**讀取 API**：`GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`

- `from`、`to` 都選填，頭尾都算；不給的那一端不設限，都不給就回全部（10 年約 1,200 筆）。
- 回應有三個欄位：
  - `weekendDays`：預設週末，目前 `[6, 7]`。前端照它判斷預設規則，不要自己寫死。
  - `coveredYears`：官方日曆**完整**匯入的年份（遞增）。不在裡面的年份只套週末規則，畫面要提示「假日資料未公布」。
  - `days`：依日期遞增、同一天只有一筆，有例外日時只回例外日（`source: "override"`）。`name` 只供顯示，前端不得拿它判斷邏輯。
- `from` 晚於 `to`、日期格式錯、多餘的參數回 422。
- 前端的 wire 約定（`frontend/src/api/types.ts`）等前端接這支 API 時再補。

**三張表**（都不軟刪）：

| 表 | 內容 |
|---|---|
| `calendar_official_days` | 官方日曆的特殊日 |
| `calendar_official_years` | 完整涵蓋的年份，與每年最後一次匯入的來源、時間 |
| `calendar_overrides` | 管理員的例外日 |

**官方日曆的來源**：兩種格式自動判別，依年份整年替換；官方檔要整年匯入，不完整就整份拒絕。

- 新北市資料開放平臺：固定網址，每月自動同步。
- 行政院人事行政總處：政府資料開放平臺「[中華民國政府行政機關辦公日曆表](https://data.gov.tw/dataset/14718)」。每年網址不同，用 `import` 手動匯入；要選一般版，不是「Google 行事曆專用」版。

**解析規則**：

- 軍人節不算假日（說明是「軍人依國防部規定辦理」，一般公司照常上班）。每略過一筆都會印出來。
- 補假、沒名稱的紀念日補上名稱（「補假」「國定假日」）。
- 補班日是上班日。
- Excel 存成 Big5 的檔案會自動改讀。

**例外日**（颱風假、公司自訂假日、臨時補班）：

- 用 `add`、`remove`、`list` 維護；`add` 一定要給 `--off` 或 `--workday`，可以一次給多個日期。
- 同一天以例外日為準，重新同步不會蓋掉例外日。
- 但同一年後匯入的官方檔會蓋掉先匯入的：手動匯入的年份，下次自動同步會換回來源的資料。要長期修正某幾天請用例外日。

```sh
uv run python -m app.scripts.holidays status
uv run python -m app.scripts.holidays sync
uv run python -m app.scripts.holidays import D:\下載\辦公日曆表.csv
uv run python -m app.scripts.holidays add 2026-09-29 2026-09-30 --off --name 颱風假
uv run python -m app.scripts.holidays add 2026-12-26 --workday --name 補班
uv run python -m app.scripts.holidays remove 2026-09-29
uv run python -m app.scripts.holidays list --year 2026
```

指令在 `backend/` 下執行，相對路徑以 `backend/` 為準，建議給完整路徑。`status --check` 在資料過期或缺今年資料時回 3，可以拿來做監控。部署後在容器裡執行同一個指令（例：`docker compose exec app …`）；手動匯入的 CSV 要先放進容器（`docker compose cp`）。部署的 branch 要確認 image 裡有 uv，或改用 `python -m app.scripts.holidays`。

**自動同步**：

- 程式啟動後馬上檢查一次，之後每 6 小時檢查。
- 距上次匯入（不分來源）滿 30 天就抓。
- 失敗時保留舊資料，約 24–30 小時後再試（滿 24 小時後的下一次檢查）；重啟程式會立刻再試。
- 從沒成功過、或超過 45 天沒成功，失敗時記 ERROR。
- 本機 `uv run fastapi dev` 預設也會在背景連 `data.ntpc.gov.tw`（從沒同步過或超過 30 天時），不擋啟動。不想連外網就在 `.env` 設 `HOLIDAY_SYNC_ENABLED=false`，需要資料時跑 `holidays sync`。pytest 一律關閉背景排程，也禁止連外網。
- 走 proxy 設 `HTTPS_PROXY`。公司網路有 SSL 檢查（自簽根憑證）時設 `SSL_CERT_FILE`，指向公司根憑證。

**log 關鍵字**：

| 情況 | log 開頭 | 等級 |
|---|---|---|
| 排程啟動 | `背景排程已啟動`、`不啟動背景排程` | INFO |
| 同步成功 | `假日表已同步` | INFO |
| 同步失敗 | `假日表自動同步失敗` | WARNING；從沒成功或超過 45 天是 ERROR |
| 程式錯誤 | `背景工作 holiday-sync 失敗`，附 traceback | ERROR |
| 不到期 | `假日表不到期` | DEBUG（預設不印） |

**管理員常見錯誤**：

| 訊息 | 原因 | 怎麼辦 |
|---|---|---|
| `不是 UTF-8 也不是 Big5` | 檔案編碼不對 | 用原始下載檔 |
| `認不得的表頭` | 選錯檔（例如「Google 行事曆專用」版） | 選一般版 |
| `資料不完整` | 不是整年 | 匯入整年的官方檔；單日用 `add` |
| `抓不到` | 連不到外網，或要走 proxy | 設 `HTTPS_PROXY`，或改手動 `import` |
| `連不上資料庫` | PostgreSQL 沒開，或 `DATABASE_URL` 錯 | 檢查服務與設定 |
| `資料表不存在` | 沒跑 migration | `uv run alembic upgrade head` |
| `沒有例外日` | 日期打錯 | 先 `list` |

**多 worker**：目前正式環境只跑一個 worker。開多個 worker 前要讓排程互斥，否則每個 worker 都會同步；官方日曆的寫入已用 advisory lock 排隊，結果不會錯，只是浪費。

**新增一個背景工作**：寫一個符合 `app.jobs.scheduler.Job` 的類別，加進 `app/jobs/startup.py` 的 `default_jobs()`（必要時再加自己的開關）。測試用假的 job 呼叫 `Scheduler(...).run_pending()`，不要真的啟動執行緒或連外網。

### 軟刪除（回收桶）

刪除先進回收桶，30 天後才真的刪掉。機制在 `app/core/soft_delete.py`。

- 軟刪的表：`projects`、`task_groups`、`tasks`、`task_deps`、`issues`、`comments`、`attachments`（清單在 `tests/test_soft_delete.py` 的 `SOFT_DELETE_MODELS`）。成員不刪；負責人、處理人跟著上層。
- 每張軟刪表有 `deleted_at`（刪除時間）與 `deletion_id`（刪除批次，`deletions` 表），兩欄一起有值。一次刪除＝一個批次，連帶的資料標同一個 `deletion_id`，還原時整批回來；刪分類連任務時，每個任務是分類底下的子批次（`deletions.parent_id`），可以各自還原。
- **查詢不用自己加 `deleted_at IS NULL`**：ORM 的 `select`、`update`、`delete`（含 join、關聯載入）自動只碰活著的列。
- 依 id 取一筆用 `app.services._live.get_live(session, Model, id)`，不要用 `session.get()`（可能拿到同一個請求裡剛被刪的物件）。id 格式不對、不存在、已刪除都丟 `NotFound`（→ 404）。
- 要看已刪除的資料：語句加 `.execution_options(include_deleted=True)`。只有回收桶（`services/trash.py`）與 30 天清除（`jobs/purge.py`）可以用。
- 繞過 ORM 的寫法擋不住，所以不准用：`text()` 寫的 SQL（只有 `api/routes/health.py` 例外）、直接查 `Model.__table__`。
- 以上由 `tests/test_source_rules.py`（讀原始碼）與 `tests/test_soft_delete.py`（實際查詢）守住。
- 新增一張軟刪表：繼承 `SoftDeleteMixin`、`__table_args__` 放 `*soft_delete_table_args()`，再把它加進 `SOFT_DELETE_MODELS`。
- 不變式：活著的資料，它的上層一定也活著。刪除、還原的測試最後呼叫 `assert_no_live_orphans(db)`。
- 標記批次：先 `session.flush()` 把 `deletions` 那一列寫進去，再標各列的 `deletion_id`（兩者之間沒有 ORM 關聯，ORM 不知道誰先寫；用 `session.execute(update(...))` 標的話，執行前會自動 flush）。
- `deletion_id` 的外鍵是 `DEFERRABLE INITIALLY DEFERRED`（交易 commit 時才檢查）：PostgreSQL 的連動刪除是一層一層排隊執行，語句結束就檢查的話，直接刪一個還有其他批次資料的專案會在下層還沒刪到時被擋下。延到 commit，清除回收桶與刪整個專案就不必依賴刪除順序（`tests/test_schema.py` 有測試）。測試包在交易裡不會 commit，要驗這條外鍵時用 `SET CONSTRAINTS ALL IMMEDIATE` 當場檢查。
- 30 天清除：批次照刪除時間由舊到新（同時間的子批次先），每批由下往上刪（附件 → 留言 → Issue → 相依 → 任務 → 分類 → 專案），順序清楚、好追錯。
