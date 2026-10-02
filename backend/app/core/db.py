"""資料庫連線：整支程式共用一個 engine（內含連線池）。

engine 在第一次用到時才建立，import 時不讀設定、不連資料庫。
"""

from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    """回傳共用的 engine；要換連線設定時呼叫 `get_engine.cache_clear()`。"""
    return create_engine(get_settings().DATABASE_URL, pool_pre_ping=True)


def create_session() -> Session:
    """開一個新的 session，用 `with create_session() as session:` 包起來，離開時自動關閉。

    API 端點不直接呼叫，改用 `app.api.deps.SessionDep`。
    """
    return Session(get_engine())
