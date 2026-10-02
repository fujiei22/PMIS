"""測試資料的工廠：每個函式建一筆合法的資料、flush 之後回傳。

參數只給測試在意的欄位，其他用合法的預設值；上層沒給就順便建一個：

    def test_xxx(db: Session) -> None:
        task = make_task(db)                 # 連同專案、分類、PM 一起建
        issue = make_issue(db, task=task)
        soft_delete(db, task, issue)         # 任務與 Issue 同一批進回收桶

每次呼叫都 flush，資料照呼叫順序寫進資料庫（外鍵檢查當下就會報錯）。
"""

import itertools
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.soft_delete import SoftDeleteMixin
from app.core.time import today
from app.models import (
    Attachment,
    Comment,
    Deletion,
    Issue,
    IssueOwner,
    Member,
    Project,
    Task,
    TaskAssignee,
    TaskDep,
    TaskGroup,
)

# 帳號、名稱、排序鍵用的流水號，讓每次建出來的資料都不重複。
_serial = itertools.count(1)


def make_member(
    db: Session,
    *,
    account: str | None = None,
    name: str | None = None,
    color: str = "#4c7cf0",
    can_login: bool = False,
    active: bool = True,
    employee_no: str | None = None,
    department: str = "",
) -> Member:
    if account is None:
        account = f"member_{next(_serial)}"
    member = Member(
        account=account,
        name=account if name is None else name,
        color=color,
        can_login=can_login,
        active=active,
        employee_no=employee_no,
        department=department,
    )
    db.add(member)
    db.flush()
    return member


def make_project(db: Session, *, pm: Member | None = None, name: str | None = None) -> Project:
    pm = pm or make_member(db, can_login=True)
    if name is None:
        name = f"專案 {next(_serial)}"
    project = Project(name=name, pm_id=pm.id, created_by=pm.id)
    db.add(project)
    db.flush()
    return project


def make_group(
    db: Session,
    *,
    project: Project | None = None,
    name: str | None = None,
    position: int | None = None,
) -> TaskGroup:
    project = project or make_project(db)
    serial = next(_serial)
    group = TaskGroup(
        id=uuid.uuid4(),
        project_id=project.id,
        name=f"分類 {serial}" if name is None else name,
        position=serial if position is None else position,
    )
    db.add(group)
    db.flush()
    return group


def make_task(
    db: Session,
    *,
    group: TaskGroup | None = None,
    name: str | None = None,
    status: str = "todo",
    priority: str = "mid",
    position: int | None = None,
    start_on: date | None = None,
    end_on: date | None = None,
    done_on: date | None = None,
    assignees: Sequence[Member] = (),
) -> Task:
    group = group or make_group(db)
    serial = next(_serial)
    task = Task(
        id=uuid.uuid4(),
        project_id=group.project_id,
        group_id=group.id,
        name=f"任務 {serial}" if name is None else name,
        created_on=today(),
        start_on=start_on,
        end_on=end_on,
        done_on=done_on,
        status=status,
        priority=priority,
        position=serial if position is None else position,
        assignees=[
            TaskAssignee(member_id=member.id, position=index)
            for index, member in enumerate(assignees)
        ],
    )
    db.add(task)
    db.flush()
    return task


def make_dep(db: Session, *, from_task: Task, to_task: Task) -> TaskDep:
    dep = TaskDep(
        id=uuid.uuid4(),
        project_id=from_task.project_id,
        from_task_id=from_task.id,
        to_task_id=to_task.id,
    )
    db.add(dep)
    db.flush()
    return dep


def make_issue(
    db: Session,
    *,
    task: Task | None = None,
    creator: Member | None = None,
    title: str | None = None,
    item: str = "C",
    level: str = "B",
    status: str = "open",
    owners: Sequence[Member] = (),
) -> Issue:
    task = task or make_task(db)
    creator = creator or make_member(db)
    issue = Issue(
        id=uuid.uuid4(),
        project_id=task.project_id,
        task_id=task.id,
        created_on=today(),
        title=f"Issue {next(_serial)}" if title is None else title,
        item=item,
        level=level,
        creator_id=creator.id,
        status=status,
        owners=[
            IssueOwner(member_id=member.id, position=index) for index, member in enumerate(owners)
        ],
    )
    db.add(issue)
    db.flush()
    return issue


def make_comment(
    db: Session,
    *,
    target: Task | Issue | None = None,
    author: Member | None = None,
    body: str = "留言內容",
) -> Comment:
    target = target or make_task(db)
    author = author or make_member(db)
    on_task = isinstance(target, Task)
    comment = Comment(
        id=uuid.uuid4(),
        project_id=target.project_id,
        target_kind="task" if on_task else "issue",
        task_id=target.id if on_task else None,
        issue_id=None if on_task else target.id,
        author_id=author.id,
        body=body,
    )
    db.add(comment)
    db.flush()
    return comment


def make_attachment(
    db: Session,
    *,
    comment: Comment | None = None,
    original_name: str = "截圖.png",
    position: int = 0,
) -> Attachment:
    comment = comment or make_comment(db)
    attachment_id = uuid.uuid4()
    attachment = Attachment(
        id=attachment_id,
        comment_id=comment.id,
        position=position,
        original_name=original_name,
        stored_name=str(attachment_id),
        content_type="image/png",
        size_bytes=1024,
        sha256="0" * 64,
    )
    db.add(attachment)
    db.flush()
    return attachment


# 回收桶批次的主體種類（deletions.root_kind）。
_ROOT_KINDS: dict[type[SoftDeleteMixin], str] = {
    Project: "project",
    TaskGroup: "group",
    Task: "task",
    Issue: "issue",
    Comment: "comment",
}

type DeletionRoot = Project | TaskGroup | Task | Issue | Comment


def _label_of(root: DeletionRoot) -> str:
    if isinstance(root, Issue):
        return root.title
    if isinstance(root, Comment):
        return root.body
    return root.name


def soft_delete(
    db: Session,
    root: DeletionRoot,
    *others: SoftDeleteMixin,
    deleted_by: Member | None = None,
    parent: Deletion | None = None,
) -> Deletion:
    """把 `root` 與 `others` 標成同一個刪除批次，回傳批次。

    只標給它的這幾列，不會自動帶走下層：要模擬「刪任務連同它的 Issue」就把 Issue 也傳進來。
    `parent` 給子批次用（刪分類連任務時，每個任務一個子批次），刪除時間跟上層相同。
    """
    project_id = root.id if isinstance(root, Project) else root.project_id
    if deleted_by is None:
        # 預設是專案的 PM（專案本身可能已經在回收桶裡，所以要看得到已刪除的列）。
        deleted_by_id = db.scalars(
            select(Project.pm_id)
            .where(Project.id == project_id)
            .execution_options(include_deleted=True)
        ).one()
    else:
        deleted_by_id = deleted_by.id
    deletion = Deletion(
        project_id=project_id,
        parent_id=parent.id if parent else None,
        root_kind=_ROOT_KINDS[type(root)],
        root_id=root.id,
        root_label=_label_of(root),
        deleted_by=deleted_by_id,
        deleted_at=parent.deleted_at if parent else datetime.now(UTC),
    )
    db.add(deletion)
    db.flush()
    for row in (root, *others):
        row.deleted_at = deletion.deleted_at
        row.deletion_id = deletion.id
    db.flush()
    return deletion
