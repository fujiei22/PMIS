# PMIS 後端

Python（FastAPI）＋ PostgreSQL。技術一覽與使用慣例見 [`docs/reference/tech-stack.md`](../docs/reference/tech-stack.md) 的〈後端〉各節；要實作的端點、錯誤碼與事件契約見 [`frontend/README.md` 的「怎麼接後端」](../frontend/README.md#怎麼接後端)。

## 現況

骨架：只有一支 `GET /api/health`（程式有在跑、資料庫連得上就回 `{"status": "ok"}`）。還沒有資料表、業務端點與登入，前端也還沒接上。

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

### 提交前

依序跑，全綠再 commit：

```sh
uv run ruff check
uv run ruff format --check
uv run mypy
uv run pytest
```

CI 在 Linux 上跑同樣的檢查，另外加 `alembic check`（見 `.github/workflows/ci.yml`）。

## 目錄結構

結構參照 FastAPI 官方範本 [full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) 的 `backend/`。

```
backend/
├── app/
│   ├── main.py              FastAPI 進入點，所有 router 掛在 /api 底下
│   ├── models.py            資料表定義（SQLAlchemy 2，全部繼承 Base；目前沒有資料表）
│   ├── api/
│   │   ├── main.py          把 routes/ 的 router 集合起來
│   │   ├── deps.py          端點共用的依賴（SessionDep：每個請求一個資料庫 session）
│   │   └── routes/          端點，一個主題一個檔（目前只有 health.py）
│   ├── core/
│   │   ├── config.py        設定（pydantic-settings，從環境變數與 .env 讀）
│   │   └── db.py            engine 與 session
│   └── alembic/             migration：env.py、script.py.mako（新檔的範本）、versions/
├── tests/                   pytest；目錄對應 app/（tests/api/routes/ 對 app/api/routes/）
│   ├── conftest.py          測試資料庫、交易 rollback、client 與 db fixture
│   ├── db_guard.py          測試資料庫名稱檢查
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

連線字串格式是 `postgresql+psycopg://帳號:密碼@主機:port/資料庫名稱`；用別的開頭（例如 `postgresql://`）啟動時會直接報錯。

### def 與 async def

- 端點與一般函式一律用 `def`。只有 SSE（`/api/events`）與 AI 串流回應用 `async def`，而且裡面不呼叫同步的資料庫（`async def` 裡做同步的資料庫存取，會讓整支程式停住，所有請求一起等）。
- `tests/test_async_whitelist.py` 讀 `app/` 的原始碼：出現 `async def` 的檔案必須列在它的 `ASYNC_ALLOWED`（目前是空的），否則測試失敗。

### 免登入的例外

每支端點預設都要登入與授權（登入還沒做）。目前明確開放、不必登入的：

- `GET /api/health`：健康檢查
- `/api/docs`、`/api/openapi.json`：FastAPI 自動產生的 API 文件

### 測試

- 只連 `TEST_DATABASE_URL`。沒設定、或資料庫名稱不是以 `_test` 結尾時，pytest 直接拒絕執行，避免動到開發或正式資料。
- 第一個用到資料庫的測試開始前，會先跑一次 `alembic upgrade head`。
- 每個測試包在一個交易裡，結束時 rollback；測試裡就算 `session.commit()`，資料也不會留下來。
- 寫 API 測試用 `client`（打 API）與 `db`（直接查資料庫）兩個 fixture，範例在 `tests/conftest.py` 開頭。

### 資料表與 migration

- 資料表變更一律寫成 Alembic migration：改 `app/models.py` → `uv run alembic revision --autogenerate -m "說明"` → **逐行看產生出來的檔** → `uv run alembic upgrade head`。
- 自動產生的 migration 要逐行確認：改欄位名稱可能被產生成「刪欄位＋加欄位」，舊資料會遺失。
- 新產生的 migration 檔會自動用 ruff 修正與排版。
- CI 跑 `alembic check`：`app/models.py` 改了卻沒有對應的 migration 就失敗。
- `alembic.ini` 只能寫英文：alembic 用系統編碼讀這個檔，Windows 上遇到中文會讀檔失敗（`tests/test_alembic_ini.py` 會檢查）。
