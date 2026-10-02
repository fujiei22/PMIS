"""讀原始碼（`ast`）守住的規則：繞過軟刪除的寫法，以及分層。

軟刪除（「每支查詢都排除已刪除」只對經過 ORM 的語句有效，見 app/core/soft_delete.py）：
- `text()` 寫的 SQL 只准在 `api/routes/health.py`。
- 依 id 取單筆不准用 `session.get()` / `session.get_one()` / `xxx.get(<Model>, ...)`，
  一律用 `app.services._live.get_live()`。
- `include_deleted`（看得到已刪除的列）只准在回收桶與 30 天清除。
- 不准直接用 `Model.__table__` 查（Core 的 Table 不經過 ORM 的條件）。
  migration（`alembic/`）不在檢查範圍：它不經過 ORM，本來就用 `sa.text()` 等寫法。

分層：
- `services/`、`auth/`、`imports/`、`jobs/` 不 import `fastapi` 與 `app.api`：service 丟自己的例外，
  由 `app/api/errors.py` 轉成 HTTP；背景工作跟網頁層無關。
- `api/routes/` 不直接查資料庫（不出現 `select(`、`.execute(`、`.scalar…(`），交給 service；
  health.py 例外。
- `models.py` 只 import SQLAlchemy、標準函式庫與 `app.core`。
"""

import ast
import sys
from collections.abc import Callable, Iterator
from pathlib import Path

from app.models import Base

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# 以下路徑都相對於 backend/app/、用 / 分隔。
TEXT_ALLOWED = frozenset({"api/routes/health.py"})
GET_ALLOWED = frozenset({"services/_live.py"})
# core/soft_delete.py 是機制本身（定義這個選項）。
INCLUDE_DELETED_ALLOWED = frozenset({"core/soft_delete.py", "services/trash.py", "jobs/purge.py"})
TABLE_ATTRIBUTE_ALLOWED = frozenset({"models.py"})
DB_ACCESS_IN_ROUTES_ALLOWED = frozenset({"api/routes/health.py"})
NO_WEB_IMPORT_DIRS = ("services/", "auth/", "imports/", "jobs/")
SKIPPED_DIRS = ("alembic/",)

MODEL_NAMES = frozenset(mapper.class_.__name__ for mapper in Base.registry.mappers)

type Finder = Callable[[ast.Module], list[int]]


def app_trees() -> dict[str, ast.Module]:
    """backend/app/ 底下每個 .py 檔（migration 除外）：{相對路徑: 語法樹}。"""
    trees = {}
    for path in sorted(APP_DIR.rglob("*.py")):
        relative = path.relative_to(APP_DIR).as_posix()
        if not relative.startswith(SKIPPED_DIRS):
            trees[relative] = ast.parse(path.read_text(encoding="utf-8-sig"))
    return trees


def _called_name(call: ast.Call) -> str | None:
    """`foo(...)` → foo；`x.foo(...)` → foo。"""
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return None


def _calls(tree: ast.Module) -> Iterator[ast.Call]:
    return (node for node in ast.walk(tree) if isinstance(node, ast.Call))


def text_calls(tree: ast.Module) -> list[int]:
    return sorted(call.lineno for call in _calls(tree) if _called_name(call) == "text")


def _looks_like_session(node: ast.expr) -> bool:
    name = node.id if isinstance(node, ast.Name) else getattr(node, "attr", "")
    return name == "db" or "session" in name.lower()


def get_by_id_calls(tree: ast.Module) -> list[int]:
    """`session.get(...)`、`session.get_one(...)`、`xxx.get(<Model>, ...)`。"""
    lines = []
    for call in _calls(tree):
        if not isinstance(call.func, ast.Attribute) or call.func.attr not in {"get", "get_one"}:
            continue
        first = call.args[0] if call.args else None
        on_session = _looks_like_session(call.func.value)
        with_model = isinstance(first, ast.Name) and first.id in MODEL_NAMES
        if on_session or with_model:
            lines.append(call.lineno)
    return sorted(lines)


def include_deleted_uses(tree: ast.Module) -> list[int]:
    """`include_deleted=`、`"include_deleted"`、`INCLUDE_DELETED` 出現的地方。"""
    lines = set()
    for node in ast.walk(tree):
        if (
            (isinstance(node, ast.keyword) and node.arg == "include_deleted")
            or (isinstance(node, ast.Constant) and node.value == "include_deleted")
            or (isinstance(node, ast.Name) and node.id.lower() == "include_deleted")
            or (isinstance(node, ast.Attribute) and node.attr.lower() == "include_deleted")
        ):
            lines.add(getattr(node, "lineno", 0))
    return sorted(lines)


def table_attribute_uses(tree: ast.Module) -> list[int]:
    return sorted(
        node.lineno
        for node in ast.walk(tree)
        if isinstance(node, ast.Attribute) and node.attr == "__table__"
    )


def db_access_calls(tree: ast.Module) -> list[int]:
    """`select(...)`、`.execute(...)`、`.scalar(...)` / `.scalars(...)` / `.scalar_one(...)`…"""
    lines = []
    for call in _calls(tree):
        name = _called_name(call) or ""
        is_select = name == "select"
        is_method = isinstance(call.func, ast.Attribute) and (
            name == "execute" or name.startswith("scalar")
        )
        if is_select or is_method:
            lines.append(call.lineno)
    return sorted(lines)


def imported_modules(tree: ast.Module) -> list[tuple[int, str]]:
    """每個 import 的完整模組名稱；`from app import api` 記成 app.api。"""
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend((node.lineno, alias.name) for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = "." * node.level + (node.module or "")
            found.append((node.lineno, module))
            found.extend((node.lineno, f"{module}.{alias.name}") for alias in node.names)
    return found


def web_imports(tree: ast.Module) -> list[int]:
    return sorted(
        {
            line
            for line, module in imported_modules(tree)
            if module.split(".")[0] == "fastapi"
            or module == "app.api"
            or module.startswith("app.api.")
        }
    )


def disallowed_model_imports(tree: ast.Module) -> list[int]:
    """models.py 只准 import SQLAlchemy、標準函式庫與 app.core（含底下的模組）。"""
    lines = set()
    for line, module in imported_modules(tree):
        top = module.split(".")[0]
        allowed = (
            top == "sqlalchemy"
            or top in sys.stdlib_module_names
            or module == "app.core"
            or module.startswith("app.core.")
        )
        if not allowed:
            lines.add(line)
    return sorted(lines)


def offenders(finder: Finder, applies: Callable[[str], bool]) -> dict[str, list[int]]:
    return {
        path: lines
        for path, tree in app_trees().items()
        if applies(path) and (lines := finder(tree))
    }


def listing(found: dict[str, list[int]]) -> str:
    return "\n".join(
        f"  app/{path}：第 {'、'.join(map(str, lines))} 行" for path, lines in found.items()
    )


# ---------- 偵測函式本身 ----------


def test_detects_text_calls() -> None:
    tree = ast.parse('note = "text()"\nsa.text("SELECT 1")\ntext("x")\nPath("a").read_text()\n')
    assert text_calls(tree) == [2, 3]


def test_detects_get_by_id() -> None:
    tree = ast.parse(
        "session.get(Task, task_id)\n"
        "self.session.get_one(Task, task_id)\n"
        "db.get(Member, member_id)\n"
        "registry.get(Project, project_id)\n"
        "headers.get('x')\n"
        "options.get(name, 0)\n"
    )
    assert get_by_id_calls(tree) == [1, 2, 3, 4]


def test_detects_include_deleted() -> None:
    tree = ast.parse(
        "stmt.execution_options(include_deleted=True)\n"
        "stmt.execution_options(**{'include_deleted': True})\n"
        "stmt.execution_options(**{INCLUDE_DELETED: True})\n"
        "soft_delete.INCLUDE_DELETED\n"
        '"""說明文字裡提到 include_deleted 不算。"""\n'
    )
    assert include_deleted_uses(tree) == [1, 2, 3, 4]


def test_detects_table_attribute() -> None:
    assert table_attribute_uses(ast.parse("select(Task.__table__)\nTask.__tablename__\n")) == [1]


def test_detects_db_access() -> None:
    tree = ast.parse(
        "select(Task)\n"
        "sa.select(Task)\n"
        "session.execute(stmt)\n"
        "session.scalars(stmt)\n"
        "session.scalar_one(stmt)\n"
        "service.list_tasks(session)\n"
    )
    assert db_access_calls(tree) == [1, 2, 3, 4, 5]


def test_detects_web_imports() -> None:
    tree = ast.parse(
        "import fastapi\n"
        "from fastapi import HTTPException\n"
        "from app.api.deps import SessionDep\n"
        "from app import api\n"
        "from app.services import tasks\n"
        "import fastapi_extra\n"
    )
    assert web_imports(tree) == [1, 2, 3, 4]


def test_detects_disallowed_model_imports() -> None:
    tree = ast.parse(
        "import uuid\n"
        "from sqlalchemy import Text\n"
        "from app.core.soft_delete import SoftDeleteMixin\n"
        "from app.services import members\n"
        "from pydantic import BaseModel\n"
        "from . import helpers\n"
    )
    assert disallowed_model_imports(tree) == [4, 5, 6]


def test_reads_app_sources() -> None:
    trees = app_trees()
    assert "models.py" in trees
    assert not any(path.startswith("alembic/") for path in trees)


# ---------- 規則 ----------


def test_text_sql_only_in_health() -> None:
    found = offenders(text_calls, lambda path: path not in TEXT_ALLOWED)
    assert not found, (
        f"以下地方用了 text() 寫 SQL：\n{listing(found)}\n"
        "text() 寫的 SQL 不會自動排除回收桶裡的資料。請改用 select() 等 ORM 寫法。"
    )


def test_no_session_get() -> None:
    found = offenders(get_by_id_calls, lambda path: path not in GET_ALLOWED)
    assert not found, (
        f"以下地方用 session.get() 之類的方式依 id 取資料：\n{listing(found)}\n"
        "session.get() 可能拿到同一個請求裡剛被刪除的物件。請改用 "
        "app.services._live.get_live(session, Model, id)。"
    )


def test_include_deleted_only_in_trash_and_purge() -> None:
    found = offenders(include_deleted_uses, lambda path: path not in INCLUDE_DELETED_ALLOWED)
    assert not found, (
        f"以下地方用了 include_deleted：\n{listing(found)}\n"
        "只有回收桶（services/trash.py）與 30 天清除（jobs/purge.py）可以看已刪除的資料。"
    )


def test_no_core_table_queries() -> None:
    found = offenders(table_attribute_uses, lambda path: path not in TABLE_ATTRIBUTE_ALLOWED)
    assert not found, (
        f"以下地方直接用了 Model.__table__：\n{listing(found)}\n"
        "Core 的 Table 不經過 ORM，不會排除回收桶裡的資料。請改用 model 寫查詢。"
    )


def test_services_do_not_import_web_layer() -> None:
    found = offenders(web_imports, lambda path: path.startswith(NO_WEB_IMPORT_DIRS))
    assert not found, (
        f"以下地方 import 了 fastapi 或 app.api：\n{listing(found)}\n"
        "service 不碰 HTTP：丟 app/services/errors.py 的例外，由 app/api/errors.py 轉成 HTTP 回應。"
    )


def test_routes_do_not_query_database() -> None:
    found = offenders(
        db_access_calls,
        lambda path: path.startswith("api/routes/") and path not in DB_ACCESS_IN_ROUTES_ALLOWED,
    )
    assert not found, (
        f"以下端點直接查了資料庫：\n{listing(found)}\n"
        "端點只負責收參數、呼叫 service、回傳；查詢寫在 app/services/。"
    )


def test_models_only_import_sqlalchemy_and_core() -> None:
    found = offenders(disallowed_model_imports, lambda path: path == "models.py")
    assert not found, f"models.py 只能 import SQLAlchemy、標準函式庫與 app.core：\n{listing(found)}"
