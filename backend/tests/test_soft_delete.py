"""守住「每支查詢都排除已刪除」（機制在 app/core/soft_delete.py）。

1. 軟刪的表就是 `SOFT_DELETE_MODELS` 這幾張：新增軟刪表要明確加進清單，
   而且要繼承 `SoftDeleteMixin`、`__table_args__` 放 `soft_delete_table_args()`。
2. 對每張軟刪表各造活的、刪的資料，驗證 SELECT、count、join、關聯載入、ORM UPDATE / DELETE
   都碰不到刪的；只有 `include_deleted=True` 看得到。關聯是從 model 自動列舉的，
   之後新增的關聯也會被檢查。
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import RelationshipProperty, Session, aliased, joinedload, selectinload

from app.core.soft_delete import SoftDeleteMixin
from app.models import (
    Attachment,
    Base,
    Comment,
    Deletion,
    Issue,
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
from tests.helpers import assert_no_live_orphans, live_orphans

SOFT_DELETE_MODELS: frozenset[type[SoftDeleteMixin]] = frozenset(
    {Project, TaskGroup, Task, TaskDep, Issue, Comment, Attachment}
)
# 有 deleted_at 欄、但不是軟刪表的：deletions 的 deleted_at 是「刪除的時間」，不是這一列被刪。
NOT_SOFT_DELETE: frozenset[type[Base]] = frozenset({Deletion})

MODELS_BY_NAME = sorted(SOFT_DELETE_MODELS, key=lambda model: model.__name__)


def mapped_models() -> list[type[Any]]:
    return [mapper.class_ for mapper in Base.registry.mappers]


def relationships_to_soft_delete_models() -> list[RelationshipProperty[Any]]:
    """所有指向軟刪表的關聯（例如 Task.issues）。"""
    found = [
        relationship
        for mapper in Base.registry.mappers
        for relationship in mapper.relationships
        if issubclass(relationship.mapper.class_, SoftDeleteMixin)
    ]
    return sorted(found, key=str)


# ---------- 1. 軟刪表的清單與結構 ----------


def test_soft_delete_models_are_exactly_the_expected_list() -> None:
    with_columns = {
        model
        for model in mapped_models()
        if {"deleted_at", "deletion_id"} & set(Base.metadata.tables[model.__tablename__].c.keys())
    } - NOT_SOFT_DELETE
    with_mixin = {model for model in mapped_models() if issubclass(model, SoftDeleteMixin)}
    assert with_columns == SOFT_DELETE_MODELS, (
        "有 deleted_at / deletion_id 欄的表跟 SOFT_DELETE_MODELS 不一致。"
        "新增軟刪表要繼承 SoftDeleteMixin，並加進 tests/test_soft_delete.py 的 SOFT_DELETE_MODELS"
    )
    assert with_mixin == SOFT_DELETE_MODELS


@pytest.mark.parametrize("model", MODELS_BY_NAME, ids=lambda model: model.__name__)
def test_soft_delete_tables_have_pair_check_and_index(model: type[SoftDeleteMixin]) -> None:
    table = Base.metadata.tables[model.__tablename__]  # type: ignore[attr-defined]
    assert f"ck_{table.name}_soft_delete_pair" in {c.name for c in table.constraints}, (
        f"{table.name} 的 __table_args__ 少了 *soft_delete_table_args()"
    )
    assert f"ix_{table.name}_deletion_id" in {index.name for index in table.indexes}


# ---------- 2. 查詢碰不到已刪除的資料 ----------


@dataclass
class World:
    """每張軟刪表都有活的與刪的資料；活的上層底下都同時掛著活的與刪的下層。"""

    task_a: Task
    live: dict[type[Any], set[uuid.UUID]] = field(default_factory=dict)
    deleted: dict[type[Any], set[uuid.UUID]] = field(default_factory=dict)

    def add(self, row: Any, *, alive: bool) -> None:
        bucket = self.live if alive else self.deleted
        bucket.setdefault(type(row), set()).add(row.id)


@pytest.fixture
def world(db: Session) -> World:
    pm = make_member(db, can_login=True)

    project = make_project(db, pm=pm)
    gone_project = make_project(db, pm=pm)

    group = make_group(db, project=project)
    gone_group = make_group(db, project=project)

    task_a = make_task(db, group=group, assignees=[pm])
    task_b = make_task(db, group=group)
    gone_task = make_task(db, group=group)

    dep = make_dep(db, from_task=task_a, to_task=task_b)
    # 兩端有一端是被刪的任務：跟著任務同一批進回收桶。
    gone_dep_out = make_dep(db, from_task=task_a, to_task=gone_task)
    gone_dep_in = make_dep(db, from_task=gone_task, to_task=task_b)

    issue = make_issue(db, task=task_a, creator=pm)
    gone_issue = make_issue(db, task=task_a, creator=pm)

    comment = make_comment(db, target=task_a, author=pm)
    gone_comment = make_comment(db, target=task_a, author=pm)
    issue_comment = make_comment(db, target=issue, author=pm)
    gone_issue_comment = make_comment(db, target=issue, author=pm)

    attachment = make_attachment(db, comment=comment)
    # 掛在活的留言底下、卻已刪除的附件：真實流程不會出現（附件只跟著留言刪），
    # 這裡是為了驗證 Comment.attachments 也會排除已刪除的列。
    gone_attachment = make_attachment(db, comment=comment, position=1)

    soft_delete(db, gone_project)
    soft_delete(db, gone_group)
    soft_delete(db, gone_task, gone_dep_out, gone_dep_in)
    soft_delete(db, gone_issue)
    soft_delete(db, gone_comment, gone_attachment)
    soft_delete(db, gone_issue_comment)

    world = World(task_a=task_a)
    for row in (project, group, task_a, task_b, dep, issue, comment, issue_comment, attachment):
        world.add(row, alive=True)
    for row in (
        gone_project,
        gone_group,
        gone_task,
        gone_dep_out,
        gone_dep_in,
        gone_issue,
        gone_comment,
        gone_issue_comment,
        gone_attachment,
    ):
        world.add(row, alive=False)

    assert set(world.live) == set(world.deleted) == SOFT_DELETE_MODELS
    assert_no_live_orphans(db)
    return world


@pytest.mark.parametrize("model", MODELS_BY_NAME, ids=lambda model: model.__name__)
def test_select_skips_deleted(db: Session, world: World, model: type[Any]) -> None:
    assert {row.id for row in db.scalars(select(model))} == world.live[model]
    assert set(db.scalars(select(model.id))) == world.live[model]
    alias = aliased(model)
    assert set(db.scalars(select(alias.id))) == world.live[model]


@pytest.mark.parametrize("model", MODELS_BY_NAME, ids=lambda model: model.__name__)
def test_count_skips_deleted(db: Session, world: World, model: type[Any]) -> None:
    assert db.scalar(select(func.count()).select_from(model)) == len(world.live[model])
    assert db.scalar(select(func.count(model.id))) == len(world.live[model])


@pytest.mark.parametrize("model", MODELS_BY_NAME, ids=lambda model: model.__name__)
def test_include_deleted_sees_everything(db: Session, world: World, model: type[Any]) -> None:
    ids = set(db.scalars(select(model.id).execution_options(include_deleted=True)))
    assert ids == world.live[model] | world.deleted[model]


@pytest.mark.parametrize("relationship", relationships_to_soft_delete_models(), ids=str)
def test_join_skips_deleted(
    db: Session, world: World, relationship: RelationshipProperty[Any]
) -> None:
    parent, target = relationship.parent.class_, relationship.mapper.class_
    child = aliased(target)
    joined = set(
        db.scalars(
            select(child.id)
            .select_from(parent)
            .join(getattr(parent, relationship.key).of_type(child))
        )
    )
    assert joined, f"測試資料沒有涵蓋 {relationship}"
    assert not joined & world.deleted[target]


def test_explicit_join_condition_skips_deleted(db: Session, world: World) -> None:
    rows = db.execute(
        select(Project.id, TaskGroup.id).join(TaskGroup, TaskGroup.project_id == Project.id)
    ).all()
    assert {group_id for _, group_id in rows} == world.live[TaskGroup]
    assert {project_id for project_id, _ in rows} <= world.live[Project]


@pytest.mark.parametrize("strategy", ["lazy", "selectin", "joined"])
@pytest.mark.parametrize("relationship", relationships_to_soft_delete_models(), ids=str)
def test_relationship_loading_skips_deleted(
    db: Session, world: World, relationship: RelationshipProperty[Any], strategy: str
) -> None:
    parent, target = relationship.parent.class_, relationship.mapper.class_
    attribute = getattr(parent, relationship.key)
    statement = select(parent)
    if strategy == "selectin":
        statement = statement.options(selectinload(attribute))
    elif strategy == "joined":
        statement = statement.options(joinedload(attribute))

    db.expunge_all()  # 清掉 identity map，讓關聯真的從資料庫載入
    parents = db.scalars(statement).unique().all()
    loaded = {child.id for row in parents for child in getattr(row, relationship.key)}

    assert loaded, f"測試資料沒有涵蓋 {relationship}"
    assert not loaded & world.deleted[target]
    assert loaded <= world.live[target]


def test_lazy_load_on_objects_created_in_this_session_skips_deleted(
    db: Session, world: World
) -> None:
    # task_a 是這個 session 裡建的、沒被查詢載入過；它的關聯第一次讀取時也要排除已刪除的列。
    assert {issue.id for issue in world.task_a.issues} == world.live[Issue]
    assert {dep.id for dep in world.task_a.outgoing_deps} <= world.live[TaskDep]


@pytest.mark.parametrize("model", MODELS_BY_NAME, ids=lambda model: model.__name__)
def test_orm_update_skips_deleted(db: Session, world: World, model: type[Any]) -> None:
    marker = datetime(2000, 1, 1, tzinfo=UTC)
    db.execute(update(model).values(created_at=marker))

    rows = db.execute(
        select(model.id, model.created_at).execution_options(include_deleted=True)
    ).all()
    touched = {row_id for row_id, created_at in rows if created_at == marker}
    assert touched == world.live[model]


def test_orm_delete_skips_deleted(db: Session, world: World) -> None:
    # 單獨刪相依是唯一真的 DELETE 的地方。
    db.execute(delete(TaskDep))

    remaining = set(db.scalars(select(TaskDep.id).execution_options(include_deleted=True)))
    assert remaining == world.deleted[TaskDep]


def test_reading_attributes_of_object_deleted_in_this_session(db: Session) -> None:
    task = make_task(db, name="剛刪掉的任務")
    soft_delete(db, task)
    db.commit()  # commit 之後屬性過期，下一次讀取會重新查資料庫

    # 重新載入「已經拿到的物件」的欄位不排除已刪除：屬性照樣讀得到，不會丟 ObjectDeletedError。
    assert task.name == "剛刪掉的任務"
    assert task.deleted_at is not None


# ---------- 不變式檢查本身 ----------


def test_live_orphans_reports_live_child_of_deleted_parent(db: Session) -> None:
    task = make_task(db)
    issue = make_issue(db, task=task)
    assert live_orphans(db) == []

    soft_delete(db, task)  # 故意不把 Issue 一起帶走

    problems = live_orphans(db)
    assert len(problems) == 1
    assert str(issue.id) in problems[0]
    with pytest.raises(AssertionError):
        assert_no_live_orphans(db)
