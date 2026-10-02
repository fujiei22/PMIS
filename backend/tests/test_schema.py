"""資料庫層的約束：就算 service 漏檢，違規的資料也寫不進去。

每個測試直接寫入違規資料，斷言被預期的那條約束擋下（IntegrityError ＋ 約束名稱）。
"""

import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime

import psycopg
import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.calendar_rules import (
    CALENDAR_SOURCES,
    MAX_YEAR,
    MIN_YEAR,
    OFFICIAL_NAME_MAX,
    OVERRIDE_NAME_MAX,
    OVERRIDE_NOTE_MAX,
)
from app.core.time import today
from app.models import (
    TASK_DURATION_MAX,
    Attachment,
    CalendarOfficialDay,
    CalendarOfficialYear,
    CalendarOverride,
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
                duration_days=1,
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


# deletion_id 的外鍵延到 commit 才檢查（DEFERRABLE INITIALLY DEFERRED）。測試包在交易裡、
# 最後 rollback，不會 commit，所以用 SET CONSTRAINTS ALL IMMEDIATE 要資料庫當場檢查。
IMMEDIATE_CHECK = text("SET CONSTRAINTS ALL IMMEDIATE")


def test_deletion_batch_fk_still_rejects_missing_batch(db: Session) -> None:
    task = make_task(db)
    other = make_task(db)
    deletion = soft_delete(db, other)

    def dangling_batch() -> None:
        task.deleted_at = deletion.deleted_at
        task.deletion_id = uuid.uuid4()
        db.flush()
        db.execute(IMMEDIATE_CHECK)

    assert_rejected(db, dangling_batch, "fk_tasks_deletion_id_deletions")


def test_deleting_project_with_other_batches_is_not_blocked(db: Session) -> None:
    """直接刪整個專案：連動刪除不論先刪到 deletions 還是下層，commit 時都一致。"""
    project = make_project(db)
    group = make_group(db, project=project)
    task = make_task(db, group=group)
    issue = make_issue(db, task=task)
    comment = make_comment(db, target=issue)
    make_attachment(db, comment=comment)
    soft_delete(db, comment)  # 另一個批次裡的資料
    soft_delete(db, make_comment(db, target=task))

    db.execute(delete(Project).where(Project.id == project.id))
    db.execute(IMMEDIATE_CHECK)

    assert db.scalars(select(Deletion.id)).all() == []
    for model in (Project, TaskGroup, Task, Issue, Comment, Attachment):
        assert db.scalars(select(model.id).execution_options(include_deleted=True)).all() == []


# ---------- 工作日曆 ----------
# 邊界值一律用 app/core/calendar_rules.py 的常數：改了常數卻忘了寫 migration 改 CHECK，這裡會失敗
# （alembic check 不比對 CHECK 的內容，抓不到）。

IMPORTED_AT = datetime(2026, 10, 2, tzinfo=UTC)
DAY = date(2026, 9, 29)


def assert_accepted(db: Session, write: Callable[[], object]) -> None:
    """`write()` 寫入的資料要存得進去；寫完撤銷，不影響同一個測試接下來的寫入。"""
    savepoint = db.begin_nested()
    write()
    db.flush()
    savepoint.rollback()


def official_day(day_on: date = DAY, name: str = "中秋節") -> CalendarOfficialDay:
    return CalendarOfficialDay(day_on=day_on, is_workday=False, name=name)


def official_year(calendar_year: int = 2026, source: str = "ntpc") -> CalendarOfficialYear:
    return CalendarOfficialYear(calendar_year=calendar_year, source=source, imported_at=IMPORTED_AT)


def override(day_on: date = DAY, name: str = "颱風假", note: str = "") -> CalendarOverride:
    return CalendarOverride(day_on=day_on, is_workday=False, name=name, note=note)


DAY_TABLES = [(official_day, "calendar_official_days"), (override, "calendar_overrides")]


@pytest.mark.parametrize("source", CALENDAR_SOURCES)
def test_official_year_accepts_every_source(db: Session, source: str) -> None:
    assert_accepted(db, lambda: db.add(official_year(source=source)))


def test_official_year_source_must_be_known(db: Session) -> None:
    assert_rejected(
        db, lambda: db.add(official_year(source="excel")), "ck_calendar_official_years_source"
    )


@pytest.mark.parametrize("year", [MIN_YEAR, MAX_YEAR])
def test_official_year_range_accepts_both_ends(db: Session, year: int) -> None:
    assert_accepted(db, lambda: db.add(official_year(calendar_year=year)))


@pytest.mark.parametrize("year", [MIN_YEAR - 1, MAX_YEAR + 1])
def test_official_year_must_be_in_range(db: Session, year: int) -> None:
    assert_rejected(
        db,
        lambda: db.add(official_year(calendar_year=year)),
        "ck_calendar_official_years_calendar_year_range",
    )


@pytest.mark.parametrize(("make", "table"), DAY_TABLES)
@pytest.mark.parametrize("day", [date(MIN_YEAR, 1, 1), date(MAX_YEAR, 12, 31)])
def test_day_range_accepts_both_ends(
    db: Session, make: Callable[[date], object], table: str, day: date
) -> None:
    assert_accepted(db, lambda: db.add(make(day)))


@pytest.mark.parametrize(("make", "table"), DAY_TABLES)
@pytest.mark.parametrize("day", [date(MIN_YEAR - 1, 12, 31), date(MAX_YEAR + 1, 1, 1)])
def test_days_must_be_in_range(
    db: Session, make: Callable[[date], object], table: str, day: date
) -> None:
    """日期超出範圍時 psycopg 讀出可能出錯，整支 GET /api/calendar 會 500，所以資料庫也要擋。"""
    assert_rejected(db, lambda: db.add(make(day)), f"ck_{table}_day_on_range")


def test_official_day_name_length(db: Session) -> None:
    assert_accepted(db, lambda: db.add(official_day(name="長" * OFFICIAL_NAME_MAX)))
    assert_rejected(
        db,
        lambda: db.add(official_day(name="長" * (OFFICIAL_NAME_MAX + 1))),
        "ck_calendar_official_days_name_length",
    )


def test_calendar_year_has_no_sequence(db: Session) -> None:
    """calendar_year 是年份、不是流水號：SMALLINT 主鍵預設會變成 SMALLSERIAL，
    migration 必須保留 autoincrement=False（alembic check 不比對預設值，抓不到）。"""
    default = db.scalar(
        text(
            "SELECT column_default FROM information_schema.columns "
            "WHERE table_schema = current_schema() "
            "AND table_name = 'calendar_official_years' AND column_name = 'calendar_year'"
        )
    )
    assert default is None


@pytest.mark.parametrize("name", ["", "長" * (OVERRIDE_NAME_MAX + 1)])
def test_override_name_length(db: Session, name: str) -> None:
    assert_accepted(db, lambda: db.add(override(name="長" * OVERRIDE_NAME_MAX)))
    assert_rejected(db, lambda: db.add(override(name=name)), "ck_calendar_overrides_name_length")


def test_override_note_length(db: Session) -> None:
    assert_accepted(db, lambda: db.add(override(note="長" * OVERRIDE_NOTE_MAX)))
    assert_rejected(
        db,
        lambda: db.add(override(note="長" * (OVERRIDE_NOTE_MAX + 1))),
        "ck_calendar_overrides_note_length",
    )


# ---------- 任務的工期與計畫基準、專案的基準鎖 ----------
# 規則見 docs/reference/scheduling.md：工期是工作天（1–3650）、基準起訖成對、專案的鎖定日 NULL＝規劃中。


@pytest.mark.parametrize("days", [1, TASK_DURATION_MAX])
def test_task_duration_accepts_both_ends(db: Session, days: int) -> None:
    assert_accepted(db, lambda: make_task(db, duration_days=days))


@pytest.mark.parametrize("days", [0, TASK_DURATION_MAX + 1])
def test_task_duration_must_be_in_range(db: Session, days: int) -> None:
    assert_rejected(db, lambda: make_task(db, duration_days=days), "ck_tasks_duration_days_range")


def test_task_baseline_is_both_or_neither(db: Session) -> None:
    """基準起訖要一起有值或一起是 NULL：只有一端的基準算不出延遲。"""
    assert_accepted(
        db,
        lambda: make_task(db, baseline_start_on=date(2026, 9, 1), baseline_end_on=date(2026, 9, 5)),
    )
    assert_rejected(
        db, lambda: make_task(db, baseline_start_on=date(2026, 9, 1)), "ck_tasks_baseline_pair"
    )


def test_task_duration_has_no_server_default(db: Session) -> None:
    """migration 先用 server_default 加欄、再拿掉；alembic check 不比對預設值，這裡守。"""
    default = db.scalar(
        text(
            "SELECT column_default FROM information_schema.columns "
            "WHERE table_schema = current_schema() "
            "AND table_name = 'tasks' AND column_name = 'duration_days'"
        )
    )
    assert default is None


def test_project_baseline_lock_is_optional(db: Session) -> None:
    """鎖定日可以是 NULL（規劃中）或日期（已鎖定）。"""
    assert_accepted(db, lambda: make_project(db, baseline_locked_on=date(2026, 8, 24)))
    assert_accepted(db, lambda: make_project(db))
