"""依 id 取單筆：一律用 `get_live()`，不用 `session.get()`（tests/test_source_rules.py 守）。

`session.get()` 會先看 identity map，可能拿到同一個請求裡剛被標成已刪除的物件；
這裡改用 SELECT 查（套用排除已刪除的條件），再確認一次 `deleted_at`。
"""

import uuid

from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from app.core.soft_delete import SoftDeleteMixin
from app.models import Base
from app.services.errors import NotFound


def parse_id(value: uuid.UUID | str) -> uuid.UUID:
    """把路徑上的 id 轉成 UUID；格式不對當成找不到（404，不是 422）。"""
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise NotFound(f"id 格式不對：{value!r}") from exc


def get_live[M: Base](session: Session, model: type[M], entity_id: uuid.UUID | str) -> M:
    """取一筆活著的資料；不存在、id 格式不對或已刪除都丟 `NotFound`。"""
    key = parse_id(entity_id)
    (primary_key,) = inspect(model).primary_key
    found = session.scalars(select(model).where(primary_key == key)).one_or_none()
    if found is None or (isinstance(found, SoftDeleteMixin) and found.deleted_at is not None):
        raise NotFound(f"{model.__name__} {key} 不存在或已刪除")
    return found
