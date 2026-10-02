"""測試共用的檢查。

`assert_no_live_orphans(db)`：回收桶的不變式「活著的資料，它的上層一定也活著」。
每個刪除、還原的測試最後都呼叫一次。
"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.core.soft_delete import SoftDeleteMixin
from app.models import Attachment, Comment, Issue, Project, Task, TaskDep, TaskGroup

# （下層 model, 指向上層的欄位, 上層 model）
PARENT_LINKS: tuple[tuple[type[SoftDeleteMixin], str, type[SoftDeleteMixin]], ...] = (
    (TaskGroup, "project_id", Project),
    (Task, "group_id", TaskGroup),
    (Task, "project_id", Project),
    (TaskDep, "from_task_id", Task),
    (TaskDep, "to_task_id", Task),
    (Issue, "task_id", Task),
    (Comment, "task_id", Task),
    (Comment, "issue_id", Issue),
    (Attachment, "comment_id", Comment),
)


def live_orphans(db: Session) -> list[str]:
    """活著、但上層已在回收桶裡的資料，每筆一行說明。"""
    problems: list[str] = []
    for child_model, column, parent_model in PARENT_LINKS:
        child: Any = aliased(child_model)
        parent: Any = aliased(parent_model)
        rows = db.execute(
            select(child.id, parent.id)
            .join(parent, getattr(child, column) == parent.id)
            .where(child.deleted_at.is_(None), parent.deleted_at.is_not(None))
            # 這裡就是要看已刪除的上層，所以不排除已刪除的列。
            .execution_options(include_deleted=True)
        ).all()
        problems.extend(
            f"{child_model.__name__} {child_id} 活著，但 {column} 指向的 "
            f"{parent_model.__name__} {parent_id} 已刪除"
            for child_id, parent_id in rows
        )
    return problems


def assert_no_live_orphans(db: Session) -> None:
    problems = live_orphans(db)
    assert not problems, "活著的資料，上層卻已刪除：\n" + "\n".join(problems)
