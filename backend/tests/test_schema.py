"""資料庫層的約束：就算 service 漏檢，違規的資料也寫不進去。

每個測試直接寫入違規資料，斷言被預期的那條約束擋下（IntegrityError ＋ 約束名稱）。
"""

import uuid
from collections.abc import Callable

import psycopg
import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.time import today
from app.models import (
    Attachment,
    Comment,
    Deletion,
    Issue,
    Member,
    Project,
    Task,
    TaskDep,
    TaskGroup,
)
from tests.factories import (
    make_attachment,
    make_comment,
    make_dep,
    make_group,
    make_issue,
    make_member,
    make_project,
    make_task,
    soft_delete,
)
from tests.helpers import assert_no_live_orphans


def assert_rejected(db: Session, write: Callable[[], object], constraint: str) -> None:
    """`write()` 寫入的資料要被資料庫的 `constraint` 這條約束擋下。"""
    with pytest.raises(IntegrityError) as caught, db.begin_nested():
        write()
        db.flush()
    error = caught.value.orig
    assert isinstance(error, psycopg.Error)
    assert error.diag.constraint_name == constraint


# ---------- 複合外鍵：參照一定在同一個專案 ----------


def test_task_cannot_use_group_of_another_project(db: Session) -> None:
    other_group = make_group(db)
    project = make_project(db)

    def write() -> None:
        db.add(
            Task(
                id=uuid.uuid4(),
                project_id=project.id,
                group_id=other_group.id,
                name="跨專案的任務",
                created_on=today(),
                status="todo",
                priority="mid",
                position=0,
            )
        )

    assert_rejected(db, write, "fk_tasks_group_id_task_groups")


def test_dep_cannot_link_tasks_of_different_projects(db: Session) -> None:
    task = make_task(db)
    other_task = make_task(db)

    def write() -> None:
        db.add(
            TaskDep(
                id=uuid.uuid4(),
                project_id=task.project_id,
                from_task_id=task.id,
                to_task_id=other_task.id,
            )
        )

    assert_rejected(db, write, "fk_task_deps_to_task_id_tasks")


def test_issue_cannot_point_to_task_of_another_project(db: Session) -> None:
    other_task = make_task(db)
    project = make_project(db)

    def write() -> None:
        db.add(
            Issue(
                id=uuid.uuid4(),
                project_id=project.id,
                task_id=other_task.id,
                created_on=today(),
                title="跨專案的 Issue",
                item="C",
                level="A",
                creator_id=project.pm_id,
                status="open",
            )
        )

    assert_rejected(db, write, "fk_issues_task_id_tasks")


@pytest.mark.parametrize("target_kind", ["task", "issue"])
def test_comment_cannot_point_to_target_of_another_project(db: Session, target_kind: str) -> None:
    other_issue = make_issue(db)
    project = make_project(db)

    def write() -> None:
        db.add(
            Comment(
                id=uuid.uuid4(),
                project_id=project.id,
                target_kind=target_kind,
                task_id=other_issue.task_id if target_kind == "task" else None,
                issue_id=other_issue.id if target_kind == "issue" else None,
                author_id=project.pm_id,
                body="跨專案的留言",
            )
        )

    assert_rejected(db, write, f"fk_comments_{target_kind}_id_{target_kind}s")


def test_moving_task_to_group_of_another_project_is_rejected(db: Session) -> None:
    task = make_task(db)
    other_group = make_group(db)

    def write() -> None:
        task.group_id = other_group.id

    assert_rejected(db, write, "fk_tasks_group_id_task_groups")


# ---------- 部分唯一索引：只管活著的列 ----------


def test_live_deps_cannot_repeat(db: Session) -> None:
    group = make_group(db)
    task_a, task_b = make_task(db, group=group), make_task(db, group=group)
    make_dep(db, from_task=task_a, to_task=task_b)

    assert_rejected(
        db, lambda: make_dep(db, from_task=task_a, to_task=task_b), "uq_task_deps_from_to_live"
    )


def test_deleted_dep_does_not_block_same_pair(db: Session) -> None:
    group = make_group(db)
    task_a, task_b = make_task(db, group=group), make_task(db, group=group)
    gone = make_dep(db, from_task=task_a, to_task=task_b)
    soft_delete(db, task_a, gone)
    # 模擬任務已還原、相依還留在回收桶裡（例如還原時另一端還在別的批次）。
    task_a.deleted_at, task_a.deletion_id = None, None
    db.flush()

    make_dep(db, from_task=task_a, to_task=task_b)  # 不會撞到回收桶裡那條


def test_live_project_names_cannot_repeat(db: Session) -> None:
    make_project(db, name="同名專案")

    assert_rejected(db, lambda: make_project(db, name="同名專案"), "uq_projects_name_live")


def test_deleted_project_name_can_be_reused(db: Session) -> None:
    gone = make_project(db, name="回收桶裡的專案")
    soft_delete(db, gone)

    make_project(db, name="回收桶裡的專案")


def test_employee_no_may_be_missing_on_many_members(db: Session) -> None:
    make_member(db, employee_no=None)
    make_member(db, employee_no=None)

    missing = select(func.count()).select_from(Member).where(Member.employee_no.is_(None))
    assert db.scalar(missing) == 2


def test_employee_no_cannot_repeat(db: Session) -> None:
    make_member(db, employee_no="A0001")

    assert_rejected(db, lambda: make_member(db, employee_no="A0001"), "uq_members_employee_no")


def test_account_cannot_repeat(db: Session) -> None:
    make_member(db, account="chen_daming")

    assert_rejected(db, lambda: make_member(db, account="chen_daming"), "uq_members_account")


# ---------- 檢查約束 ----------


@pytest.mark.parametrize("account", ["Chen_Daming", "chen daming", "", "a" * 65, "王小明"])
def test_member_account_format(db: Session, account: str) -> None:
    assert_rejected(db, lambda: make_member(db, account=account), "ck_members_account_format")


@pytest.mark.parametrize("color", ["#FFFFFF", "#fff", "red", "#12345g"])
def test_member_color_format(db: Session, color: str) -> None:
    assert_rejected(db, lambda: make_member(db, color=color), "ck_members_color_format")


@pytest.mark.parametrize("name", ["", "專" * 101])
def test_project_name_length(db: Session, name: str) -> None:
    assert_rejected(db, lambda: make_project(db, name=name), "ck_projects_name_length")


def test_group_name_may_be_empty(db: Session) -> None:
    make_group(db, name="")  # 逐鍵改名時可能送出空值


@pytest.mark.parametrize(("field", "value"), [("status", "blocked"), ("priority", "urgent")])
def test_task_enum_values(db: Session, field: str, value: str) -> None:
    assert_rejected(db, lambda: make_task(db, **{field: value}), f"ck_tasks_{field}")  # type: ignore[arg-type]


@pytest.mark.parametrize(("field", "value"), [("item", "X"), ("level", "E"), ("status", "done")])
def test_issue_enum_values(db: Session, field: str, value: str) -> None:
    assert_rejected(db, lambda: make_issue(db, **{field: value}), f"ck_issues_{field}")  # type: ignore[arg-type]


def test_dep_cannot_point_to_itself(db: Session) -> None:
    task = make_task(db)

    assert_rejected(db, lambda: make_dep(db, from_task=task, to_task=task), "ck_task_deps_not_self")


@pytest.mark.parametrize(
    ("target_kind", "on_task", "on_issue"),
    [("task", False, True), ("issue", True, False), ("task", True, True), ("task", False, False)],
)
def test_comment_target_must_match_kind(
    db: Session, target_kind: str, on_task: bool, on_issue: bool
) -> None:
    issue = make_issue(db)

    def write() -> None:
        db.add(
            Comment(
                id=uuid.uuid4(),
                project_id=issue.project_id,
                target_kind=target_kind,
                task_id=issue.task_id if on_task else None,
                issue_id=issue.id if on_issue else None,
                author_id=issue.creator_id,
                body="留言",
            )
        )

    assert_rejected(db, write, "ck_comments_target")


def test_attachment_size_must_be_positive(db: Session) -> None:
    attachment = make_attachment(db)

    def write() -> None:
        attachment.size_bytes = 0

    assert_rejected(db, write, "ck_attachments_size_positive")


def test_deleted_at_and_deletion_id_go_together(db: Session) -> None:
    task = make_task(db)
    other = make_task(db)
    deletion = soft_delete(db, other)

    def only_time() -> None:
        task.deleted_at = deletion.deleted_at

    def only_batch() -> None:
        task.deletion_id = deletion.id

    assert_rejected(db, only_time, "ck_tasks_soft_delete_pair")
    db.refresh(task)
    assert_rejected(db, only_batch, "ck_tasks_soft_delete_pair")


# ---------- 刪除批次 ----------


def test_removing_parent_batch_turns_children_into_top_level(db: Session) -> None:
    group = make_group(db)
    task = make_task(db, group=group)
    parent = soft_delete(db, group)
    child = soft_delete(db, task, parent=parent)
    assert child.deleted_at == parent.deleted_at

    # 還原分類（只還原分類本身）：清掉分類的刪除標記，刪掉上層批次。
    group.deleted_at, group.deletion_id = None, None
    db.flush()
    db.execute(delete(Deletion).where(Deletion.id == parent.id))
    db.refresh(child)

    assert child.parent_id is None
    assert_no_live_orphans(db)


def test_purging_project_batch_bottom_up_is_not_blocked(db: Session) -> None:
    """30 天清除的順序：舊的批次先、每批由下往上刪，最後刪專案，外鍵連動收尾。"""
    project = make_project(db)
    group = make_group(db, project=project)
    task = make_task(db, group=group, assignees=[make_member(db)])
    other_task = make_task(db, group=group)
    dep = make_dep(db, from_task=task, to_task=other_task)
    issue = make_issue(db, task=task)
    comment = make_comment(db, target=issue)
    attachment = make_attachment(db, comment=comment)
    older_comment = make_comment(db, target=task)
    older = soft_delete(db, older_comment)  # 專案被刪之前先刪掉的留言（較舊的批次）
    batch = soft_delete(db, project, group, task, other_task, dep, issue, comment, attachment)

    def purge(deletion: Deletion) -> None:
        for model in (Attachment, Comment, Issue, TaskDep, Task, TaskGroup, Project):
            db.execute(
                delete(model)
                .where(model.deletion_id == deletion.id)
                .execution_options(include_deleted=True)
            )
        db.execute(delete(Deletion).where(Deletion.id == deletion.id))

    purge(older)
    purge(batch)
    db.flush()

    assert db.scalars(select(Deletion.id)).all() == []
    for model in (Project, TaskGroup, Task, TaskDep, Issue, Comment, Attachment):
        assert db.scalars(select(model.id).execution_options(include_deleted=True)).all() == []
