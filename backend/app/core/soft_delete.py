"""軟刪除（回收桶）：欄位定義，以及「每支查詢都排除已刪除」的機制。

- 軟刪的表繼承 `SoftDeleteMixin`（兩個欄位），並在 `__table_args__` 放
  `*soft_delete_table_args()`（兩欄要一起有值的 CHECK、`deletion_id` 的部分索引）。
- 下面的 `do_orm_execute` 事件掛在所有 Session 上：ORM 的 SELECT、UPDATE、DELETE
  一律只碰活著的列（`deleted_at IS NULL`），寫查詢時不必自己加條件。
  做法是 SQLAlchemy 官方 recipe 的 `with_loader_criteria`，join、關聯載入也會套到。
- 要看到已刪除的列，在語句加 `.execution_options(include_deleted=True)`。只有回收桶
  （`services/trash.py`）與 30 天清除（`jobs/purge.py`）可以用（tests/test_source_rules.py 守）。
- 依 id 取單筆一律用 `app.services._live.get_live()`，不用 `session.get()`：
  `session.get()` 會先看 identity map，可能拿到同一個請求裡剛被標成已刪除的物件。

沒有經過 ORM 的寫法擋不住，所以也不准用：`text()` 寫的 SQL、直接查 `Table`（`Model.__table__`）。
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, column, event
from sqlalchemy.orm import Mapped, ORMExecuteState, Session, mapped_column, with_loader_criteria

# 語句的 execution option 名稱：設成 True 就不排除已刪除的列。
INCLUDE_DELETED = "include_deleted"


class SoftDeleteMixin:
    """回收桶的兩個欄位：刪除時間與刪除批次（`deletions` 表）。活著的列兩欄都是 NULL。"""

    # sort_order：放在每張表的最後面（建表時欄位的順序）。
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), sort_order=110)
    # 外鍵用預設的 NO ACTION（語句結束才檢查）。清除回收桶要照刪除時間由舊到新、
    # 每批由下往上刪（見 backend/README.md〈軟刪除〉），否則多層連動刪除可能被它擋下。
    deletion_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("deletions.id"), sort_order=111
    )


def soft_delete_table_args() -> tuple[CheckConstraint, Index]:
    """軟刪表的 `__table_args__` 都要放這兩個（tests/test_soft_delete.py 檢查）。"""
    return (
        CheckConstraint("(deleted_at IS NULL) = (deletion_id IS NULL)", name="soft_delete_pair"),
        # 名稱由 models.py 的命名規則產生：ix_<表名>_deletion_id。
        Index(None, "deletion_id", postgresql_where=column("deletion_id").is_not(None)),
    )


@event.listens_for(Session, "do_orm_execute")
def _exclude_deleted_rows(state: ORMExecuteState) -> None:
    if state.execution_options.get(INCLUDE_DELETED, False):
        return
    # 重新載入已經拿到的物件的欄位（例如 commit 之後讀屬性）是單純依主鍵重讀，
    # 官方文件建議不加條件：同一個請求裡剛標成已刪除的物件，屬性照樣讀得到。
    # 關聯載入（例如讀 task.issues）則照樣加條件，不管物件是怎麼拿到的。
    if state.is_column_load:
        return
    if state.is_select or state.is_update or state.is_delete:
        state.statement = state.statement.options(
            with_loader_criteria(
                SoftDeleteMixin,
                lambda cls: cls.deleted_at.is_(None),
                include_aliases=True,
            )
        )
