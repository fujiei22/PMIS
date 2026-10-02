"""守住「一般 API 用 def，只有 SSE 與 AI 串流回應用 async def」。

FastAPI 把 `def` 端點放到 thread pool 執行，一支卡住不影響別支；`async def` 則直接跑在
唯一的 event loop 上，裡面只要呼叫同步的資料庫套件（SQLAlchemy ＋ psycopg 同步模式），
整支程式都會停住，所有使用者的請求一起等。

所以 `backend/app/` 底下出現 `async def` 的檔案必須列在 `ASYNC_ALLOWED`，
而且那些檔案裡不碰同步的資料庫存取。這支測試直接讀原始碼（`ast`）判斷，不靠執行期。
"""

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# 允許出現 async def 的檔案，路徑相對於 backend/app/、用 / 分隔，例如 "api/routes/events.py"。
# 只放 SSE（/api/events）與 AI 串流回應的模組。
ASYNC_ALLOWED: frozenset[str] = frozenset()

WHY = (
    "一般 API 請用 def。async def 裡呼叫同步的資料庫（SQLAlchemy／psycopg）會卡住整支程式，"
    "所有使用者的請求都會一起停住。只有 SSE（/api/events）與 AI 串流回應可以用 async def，"
    "而且裡面不碰同步的資料庫；確定屬於這兩類，才把檔案加進 "
    "tests/test_async_whitelist.py 的 ASYNC_ALLOWED。"
)


def async_def_lines(source: str) -> list[int]:
    """原始碼裡每個 `async def` 的行號（包含寫在 class 或函式裡面的）。"""
    return sorted(
        node.lineno
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.AsyncFunctionDef)
    )


def app_sources() -> dict[str, str]:
    """backend/app/ 底下每個 .py 檔：{相對路徑: 原始碼}。"""
    return {
        path.relative_to(APP_DIR).as_posix(): path.read_text(encoding="utf-8-sig")
        for path in sorted(APP_DIR.rglob("*.py"))
    }


def test_detector_finds_nested_async_def_and_ignores_text() -> None:
    source = '''
def handler():
    """這裡寫 async def 不算。"""
    note = "async def 也不算"


class Stream:
    async def send(self):
        pass


def outer():
    async def inner():
        pass
'''
    assert async_def_lines(source) == [8, 13]


def test_reads_app_sources() -> None:
    assert "main.py" in app_sources()


def test_async_def_only_in_whitelisted_files() -> None:
    offenders = {
        path: lines
        for path, source in app_sources().items()
        if path not in ASYNC_ALLOWED and (lines := async_def_lines(source))
    }
    listing = "\n".join(
        f"  app/{path}：第 {'、'.join(map(str, lines))} 行" for path, lines in offenders.items()
    )
    assert not offenders, f"以下檔案出現 async def，但不在 ASYNC_ALLOWED：\n{listing}\n{WHY}"


def test_whitelist_has_no_stale_entries() -> None:
    sources = app_sources()
    stale = sorted(path for path in ASYNC_ALLOWED if not async_def_lines(sources.get(path, "")))
    assert not stale, f"ASYNC_ALLOWED 裡這些檔案不存在或已經沒有 async def，請移除：{stale}"
