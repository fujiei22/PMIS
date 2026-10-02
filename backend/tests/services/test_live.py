import uuid

import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Member, Task
from app.services._live import get_live
from app.services.errors import NotFound
from tests.factories import make_member, make_task, soft_delete


def test_returns_live_row_by_uuid_or_string(db: Session) -> None:
    task = make_task(db)

    assert get_live(db, Task, task.id) is task
    assert get_live(db, Task, str(task.id)) is task


def test_works_for_tables_without_soft_delete(db: Session) -> None:
    member = make_member(db)

    assert get_live(db, Member, member.id) is member


@pytest.mark.parametrize("bad_id", ["pmis", "t1", "", "12345678-1234-1234-1234-12345678901g"])
def test_malformed_id_is_not_found(db: Session, bad_id: str) -> None:
    with pytest.raises(NotFound):
        get_live(db, Task, bad_id)


def test_missing_row_is_not_found(db: Session) -> None:
    with pytest.raises(NotFound):
        get_live(db, Task, uuid.uuid4())


def test_deleted_row_is_not_found(db: Session) -> None:
    task = make_task(db)
    soft_delete(db, task)

    with pytest.raises(NotFound):
        get_live(db, Task, task.id)


def test_row_deleted_by_bulk_update_in_same_session_is_not_found(db: Session) -> None:
    """物件已經在 identity map 裡，之後被批次 UPDATE 標成已刪除：session.get() 會照樣回傳它。"""
    task = make_task(db)
    other = make_task(db)
    deletion = soft_delete(db, other)
    assert get_live(db, Task, task.id) is task  # 先載入進 identity map

    db.execute(
        update(Task)
        .where(Task.id == task.id)
        .values(deleted_at=deletion.deleted_at, deletion_id=deletion.id)
        .execution_options(synchronize_session=False)  # 不同步記憶體裡的物件，模擬最壞的情況
    )

    with pytest.raises(NotFound):
        get_live(db, Task, task.id)
