"""資料表定義（SQLAlchemy 2）。

新增資料表：在這個檔案寫一個繼承 `Base` 的 class，然後產生 migration
（`uv run alembic revision --autogenerate -m "說明"`），逐行確認後再套用。
Alembic 從 `Base.metadata` 比對資料表變更，所以 model 一定要繼承 `Base`。

慣例（理由見 backend/README.md〈資料表與 migration〉）：
- 表名、欄名 snake_case，避開 SQL 保留字（`end` → `end_on`、`desc` → `description`，
  分類表叫 `task_groups`）。日期欄叫 `*_on`（DATE），時間點叫 `*_at`（TIMESTAMPTZ）。
- 列舉值用 TEXT ＋ CHECK，不用 PostgreSQL 的 ENUM（之後加值只要改 CHECK）。
- 「同一個專案」用複合外鍵保證：被參照的表有 `UNIQUE (id, project_id)`，
  參照端用 `(xxx_id, project_id)` 指過去；service 漏檢也寫不進跨專案的資料。
- 軟刪的表繼承 `SoftDeleteMixin`（app/core/soft_delete.py）；查詢自動排除已刪除的列。
  工作日曆的三張表（`calendar_*`）不軟刪：官方資料整年替換、例外日刪了就是刪了。
- 上層對下層的關聯（`Project.groups`、`Task.issues`…）一定要寫：ORM 靠它知道同一次 flush
  要先寫上層、再寫下層，否則可能先寫下層而違反外鍵。外鍵欄位可以直接設，不必經過關聯。
  連動刪除交給資料庫的 ON DELETE（`passive_deletes=True`），ORM 不先把下層載入。
- 這個檔只 import SQLAlchemy、標準函式庫與 `app.core`（tests/test_source_rules.py 守）。
"""

import uuid
from datetime import date, datetime
from typing import Any, ClassVar

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    MetaData,
    SmallInteger,
    Text,
    UniqueConstraint,
    column,
    false,
    func,
    true,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.core.soft_delete import SoftDeleteMixin, soft_delete_table_args

# 約束（主鍵、外鍵、唯一、檢查）與索引的命名規則。
# 名稱固定下來，之後的 migration 才能用名稱刪改它們。
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# 列舉值；跟前端 types/models.ts 同名的型別一致。
TASK_STATUSES = ("todo", "doing", "paused", "done")
PRIORITIES = ("high", "mid", "low")
ISSUE_ITEMS = ("C", "R", "F", "O")
ISSUE_LEVELS = ("A", "B", "C", "D")
ISSUE_STATUSES = ("open", "doing", "paused", "closed")
COMMENT_TARGET_KINDS = ("task", "issue")
DELETION_ROOT_KINDS = ("project", "group", "task", "issue", "comment")
# 官方辦公日曆的來源：新北市資料開放平臺、行政院人事行政總處。跟 app/imports/holiday_csv.py 的
# CalendarSource 一致（models.py 不能 import imports/，tests/imports/test_holiday_csv.py 檢查兩邊相同）。
CALENDAR_SOURCES = ("ntpc", "dgpa")


class Base(DeclarativeBase):
    """所有資料表 model 的基底。"""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    # 字串一律 TEXT（不限長度的 VARCHAR 跟 TEXT 一樣，統一寫法）；時間點一律帶時區。
    type_annotation_map: ClassVar[dict[Any, Any]] = {
        str: Text(),
        datetime: DateTime(timezone=True),
    }


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), sort_order=100)


class TimestampMixin(CreatedAtMixin):
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), sort_order=101
    )


def _one_of(name: str, values: tuple[str, ...]) -> CheckConstraint:
    """`CHECK (欄 IN ('a', 'b'))`，約束名稱 ck_<表名>_<欄名>。"""
    listed = ", ".join(f"'{value}'" for value in values)
    return CheckConstraint(f"{name} IN ({listed})", name=name)


def _max_length(name: str, limit: int) -> CheckConstraint:
    """`CHECK (char_length(欄) <= 上限)`，約束名稱 ck_<表名>_<欄名>_length。"""
    return CheckConstraint(f"char_length({name}) <= {limit}", name=f"{name}_length")


def _live_only() -> dict[str, Any]:
    """部分索引只收活著的列（已刪除的不算重複、也不佔索引）。"""
    return {"postgresql_where": column("deleted_at").is_(None)}


class Member(TimestampMixin, Base):
    """成員：可登入的 PM，以及只是任務負責人的人。不軟刪、不實刪（舊資料要一直顯示名字）。"""

    __tablename__ = "members"
    __table_args__ = (
        CheckConstraint("account ~ '^[a-z0-9._-]{1,64}$'", name="account_format"),
        CheckConstraint("color ~ '^#[0-9a-f]{6}$'", name="color_format"),
        # 工號可以多筆是 NULL（名單指令與匯入建立的成員還沒登入過），有值的不能重複。
        Index(
            "uq_members_employee_no",
            "employee_no",
            unique=True,
            postgresql_where=column("employee_no").is_not(None),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # 工號（AD 驗證 API 回的第一個值），成員的固定識別；第一次登入時補上。
    employee_no: Mapped[str | None]
    # 小寫帳號（例如 chen_daming）；登入、可登入名單、Excel 負責人都比對這欄。
    account: Mapped[str] = mapped_column(unique=True)
    # 顯示名稱；還沒登入過的成員先等於帳號。
    name: Mapped[str]
    # AD 回的部門，wire 上叫 role。
    department: Mapped[str] = mapped_column(server_default="")
    email: Mapped[str | None]
    color: Mapped[str]
    # 在可登入名單裡；只有管理員指令能改。
    can_login: Mapped[bool] = mapped_column(server_default=false())
    # 停用 = False。第一版沒有流程會設成 False（沒有名錄同步），先把欄位與規則備好。
    active: Mapped[bool] = mapped_column(server_default=true())
    last_login_at: Mapped[datetime | None]


class Project(SoftDeleteMixin, TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint("char_length(name) BETWEEN 1 AND 100", name="name_length"),
        # 不能跟活著的專案同名；回收桶裡的不算。
        Index("uq_projects_name_live", "name", unique=True, **_live_only()),
        *soft_delete_table_args(),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]
    # 擁有者（PM）；任何登入者都能改。
    pm_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"))
    # 匯入的人。
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"))

    groups: Mapped[list["TaskGroup"]] = relationship(
        order_by=lambda: (TaskGroup.position, TaskGroup.id), passive_deletes=True
    )


class TaskGroup(SoftDeleteMixin, TimestampMixin, Base):
    """任務分類。表名不叫 groups：GROUPS 是 PostgreSQL 的關鍵字。"""

    __tablename__ = "task_groups"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        # 允許空字串：逐鍵改名時可能送出空值。
        _max_length("name", 200),
        Index("ix_task_groups_project_id_live", "project_id", **_live_only()),
        *soft_delete_table_args(),
    )

    # client 產生；server 自己建的「未分類」由 server 產生。
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str]
    # 排序鍵：重排時整份重寫成 0..n-1；不設唯一，還原回來的列可能跟別人同號。
    position: Mapped[int]

    tasks: Mapped[list["Task"]] = relationship(
        order_by=lambda: (Task.position, Task.id), passive_deletes=True
    )


class Task(SoftDeleteMixin, TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        # 分類一定在同一個專案。
        ForeignKeyConstraint(
            ["group_id", "project_id"],
            ["task_groups.id", "task_groups.project_id"],
            ondelete="CASCADE",
        ),
        _max_length("name", 200),
        _one_of("status", TASK_STATUSES),
        _one_of("priority", PRIORITIES),
        Index("ix_tasks_project_id_live", "project_id", **_live_only()),
        *soft_delete_table_args(),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    project_id: Mapped[uuid.UUID]
    group_id: Mapped[uuid.UUID] = mapped_column(index=True)
    name: Mapped[str]
    # wire 的 created；建立時由 server 填今天（app.core.time.today()），不信 client。
    created_on: Mapped[date]
    start_on: Mapped[date | None]
    end_on: Mapped[date | None]
    done_on: Mapped[date | None]
    status: Mapped[str]
    priority: Mapped[str]
    # 排序鍵：專案內的全域順序（前端 tasks 陣列的順序），規則同 TaskGroup.position。
    position: Mapped[int]

    # 負責人有順序：第一位是 upcoming 顯示的負責人。整份替換。
    assignees: Mapped[list["TaskAssignee"]] = relationship(
        order_by=lambda: TaskAssignee.position,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    issues: Mapped[list["Issue"]] = relationship(order_by=lambda: Issue.seq, passive_deletes=True)
    # overlaps：留言的 project_id 也由 Issue.comments 寫；兩邊寫的一定是同一個專案。
    comments: Mapped[list["Comment"]] = relationship(
        order_by=lambda: Comment.seq, passive_deletes=True, overlaps="comments"
    )
    # 以這個任務為起點（from）／終點（to）的相依；兩邊都會寫相依的 project_id，同上。
    outgoing_deps: Mapped[list["TaskDep"]] = relationship(
        primaryjoin=lambda: (
            (Task.id == TaskDep.from_task_id) & (Task.project_id == TaskDep.project_id)
        ),
        order_by=lambda: TaskDep.seq,
        passive_deletes=True,
        overlaps="incoming_deps",
    )
    incoming_deps: Mapped[list["TaskDep"]] = relationship(
        primaryjoin=lambda: (
            (Task.id == TaskDep.to_task_id) & (Task.project_id == TaskDep.project_id)
        ),
        order_by=lambda: TaskDep.seq,
        passive_deletes=True,
        overlaps="outgoing_deps",
    )


class TaskAssignee(Base):
    """任務的負責人。不軟刪，跟著任務。"""

    __tablename__ = "task_assignees"

    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="RESTRICT"), primary_key=True
    )
    position: Mapped[int] = mapped_column(SmallInteger)


class TaskDep(SoftDeleteMixin, TimestampMixin, Base):
    """相依：from 先完成、to 後開始。

    單獨刪除是真的 DELETE；只有因為刪任務被帶走時才軟刪（還原任務時一起回來）。
    循環在 service 檢查。
    """

    __tablename__ = "task_deps"
    __table_args__ = (
        ForeignKeyConstraint(
            ["from_task_id", "project_id"], ["tasks.id", "tasks.project_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["to_task_id", "project_id"], ["tasks.id", "tasks.project_id"], ondelete="CASCADE"
        ),
        CheckConstraint("from_task_id <> to_task_id", name="not_self"),
        # 同一對任務只能有一條活著的相依；回收桶裡的不算。
        Index(
            "uq_task_deps_from_to_live", "from_task_id", "to_task_id", unique=True, **_live_only()
        ),
        *soft_delete_table_args(),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    project_id: Mapped[uuid.UUID]
    from_task_id: Mapped[uuid.UUID]
    to_task_id: Mapped[uuid.UUID]
    # 插入順序（回傳順序）。同一個交易裡 now() 都一樣，不能拿 created_at 排序。
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True))


class Issue(SoftDeleteMixin, TimestampMixin, Base):
    __tablename__ = "issues"
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["tasks.id", "tasks.project_id"], ondelete="CASCADE"
        ),
        _max_length("title", 200),
        _one_of("item", ISSUE_ITEMS),
        _one_of("level", ISSUE_LEVELS),
        _one_of("status", ISSUE_STATUSES),
        *(_max_length(name, 200) for name in ("ptype", "pcb", "bios", "os", "solved_bios")),
        _max_length("description", 20000),
        _max_length("solution", 20000),
        *soft_delete_table_args(),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    project_id: Mapped[uuid.UUID]
    task_id: Mapped[uuid.UUID]
    # server 填今天。
    created_on: Mapped[date]
    title: Mapped[str]
    item: Mapped[str]
    level: Mapped[str]
    # 提出人（可以改），不是「誰建的」。
    creator_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"))
    status: Mapped[str]
    due_on: Mapped[date | None]
    done_on: Mapped[date | None]
    ptype: Mapped[str] = mapped_column(server_default="")
    pcb: Mapped[str] = mapped_column(server_default="")
    bios: Mapped[str] = mapped_column(server_default="")
    os: Mapped[str] = mapped_column(server_default="")
    solved_bios: Mapped[str] = mapped_column(server_default="")
    # wire 的 desc。
    description: Mapped[str] = mapped_column(server_default="")
    solution: Mapped[str] = mapped_column(server_default="")
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True))

    # 處理人，有順序、整份替換。
    owners: Mapped[list["IssueOwner"]] = relationship(
        order_by=lambda: IssueOwner.position,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    comments: Mapped[list["Comment"]] = relationship(
        order_by=lambda: Comment.seq, passive_deletes=True, overlaps="comments"
    )


class IssueOwner(Base):
    """Issue 的處理人。不軟刪，跟著 Issue。"""

    __tablename__ = "issue_owners"

    issue_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("issues.id", ondelete="CASCADE"), primary_key=True
    )
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("members.id", ondelete="RESTRICT"), primary_key=True
    )
    position: Mapped[int] = mapped_column(SmallInteger)


class Comment(SoftDeleteMixin, CreatedAtMixin, Base):
    """留言，掛在任務或 Issue 上。不能編輯，所以沒有 updated_at。

    用兩個可空的外鍵（task_id、issue_id）取代一個多型的 target_id，才有外鍵與連動刪除。
    """

    __tablename__ = "comments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["task_id", "project_id"], ["tasks.id", "tasks.project_id"], ondelete="CASCADE"
        ),
        ForeignKeyConstraint(
            ["issue_id", "project_id"], ["issues.id", "issues.project_id"], ondelete="CASCADE"
        ),
        _one_of("target_kind", COMMENT_TARGET_KINDS),
        CheckConstraint(
            "(target_kind = 'task' AND task_id IS NOT NULL AND issue_id IS NULL)"
            " OR (target_kind = 'issue' AND issue_id IS NOT NULL AND task_id IS NULL)",
            name="target",
        ),
        _max_length("body", 10000),
        *soft_delete_table_args(),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    project_id: Mapped[uuid.UUID]
    target_kind: Mapped[str]
    task_id: Mapped[uuid.UUID | None]
    issue_id: Mapped[uuid.UUID | None]
    # server 填登入者，不信 client 送的 memberId。
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"))
    # wire 的 at；server 填現在。
    posted_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # wire 的 text。
    body: Mapped[str]
    seq: Mapped[int] = mapped_column(BigInteger, Identity(always=True))

    attachments: Mapped[list["Attachment"]] = relationship(
        order_by=lambda: Attachment.position, passive_deletes=True
    )


class Attachment(SoftDeleteMixin, TimestampMixin, Base):
    """留言的附件。跟留言在同一個刪除批次。"""

    __tablename__ = "attachments"
    __table_args__ = (
        _max_length("original_name", 255),
        CheckConstraint("size_bytes > 0", name="size_positive"),
        *soft_delete_table_args(),
    )

    # server 產生；wire 的 Attachment.id 直接用它。
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comments.id", ondelete="CASCADE"))
    # 在留言裡的順序。
    position: Mapped[int] = mapped_column(SmallInteger)
    # 清理過的原檔名（只存在資料庫，不用在磁碟檔名）。
    original_name: Mapped[str]
    # 磁碟上的檔名；不含使用者給的任何字。
    stored_name: Mapped[str] = mapped_column(unique=True)
    # 伺服器判定、白名單內的值。
    content_type: Mapped[str]
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str]


class Deletion(Base):
    """回收桶的一個「刪除批次」：一次刪除標上同一個 deletion_id，還原時整批回來。

    刪分類連任務時，每個任務各是分類底下的一個子批次（parent_id），分類與任務才能各自還原。
    本身不是軟刪的表（`deleted_at` 是刪除的時間，不是這一列被刪）。
    """

    __tablename__ = "deletions"
    __table_args__ = (
        _one_of("root_kind", DELETION_ROOT_KINDS),
        Index("ix_deletions_project_id_deleted_at", "project_id", "deleted_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # projects 也有外鍵指向這張表（deletion_id），兩張表互相參照；
    # use_alter：建表時先不建這個外鍵，兩張表都建好再補（見第一支 migration）。
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE", use_alter=True)
    )
    # 上層批次；上層被還原或清除後變成 NULL，子批次自己成為最上層。
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("deletions.id", ondelete="SET NULL"), index=True
    )
    # 被刪的主體。
    root_kind: Mapped[str]
    root_id: Mapped[uuid.UUID]
    # 刪除當下的名稱（回收桶畫面顯示用）。
    root_label: Mapped[str]
    deleted_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id"))
    # 子批次跟上層同一個時間。
    deleted_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)


class CalendarOfficialDay(CreatedAtMixin, Base):
    """官方辦公日曆裡「跟預設規則不同」或「有名稱」的日子。

    預設規則：ISO 星期 6、7 放假（普通週末不存）。依年份整年替換
    （services/calendar.py 的 replace_official_years），不軟刪。
    """

    __tablename__ = "calendar_official_days"
    __table_args__ = (_one_of("source", CALENDAR_SOURCES), _max_length("name", 100))

    day_on: Mapped[date] = mapped_column(primary_key=True)
    is_workday: Mapped[bool]
    # 只供顯示；沒有名稱的列解析時已補上（補假、國定假日、補行上班日…）
    name: Mapped[str] = mapped_column(server_default="")
    source: Mapped[str]


class CalendarOfficialYear(Base):
    """官方辦公日曆**完整**涵蓋的年份，與該年最後一次匯入的來源與時間。

    每月自動同步看所有年份裡最新的 imported_at（手動匯入也算新資料）。
    """

    __tablename__ = "calendar_official_years"
    __table_args__ = (
        _one_of("source", CALENDAR_SOURCES),
        CheckConstraint("calendar_year BETWEEN 2000 AND 2200", name="calendar_year_range"),
    )

    # 年份不是流水號：SMALLINT 主鍵預設會變成 SMALLSERIAL，要明確關掉
    calendar_year: Mapped[int] = mapped_column(SmallInteger, primary_key=True, autoincrement=False)
    source: Mapped[str]
    imported_at: Mapped[datetime]


class CalendarOverride(TimestampMixin, Base):
    """管理員的例外日（颱風假、公司自訂假日、臨時補班…）。同一天以例外日為準；重新同步不會動。

    刪除是真的 DELETE（沒有回收桶）。還沒有「誰設的」：指令稿沒有登入者，登入做好再加。
    """

    __tablename__ = "calendar_overrides"
    __table_args__ = (
        CheckConstraint("char_length(name) BETWEEN 1 AND 100", name="name_length"),
        _max_length("note", 500),
    )

    day_on: Mapped[date] = mapped_column(primary_key=True)
    is_workday: Mapped[bool]
    name: Mapped[str]
    note: Mapped[str] = mapped_column(server_default="")
