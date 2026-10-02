"""端點共用的依賴（FastAPI 的 `Depends`）。"""

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.db import create_session


def get_db() -> Iterator[Session]:
    """每個請求一個 session，請求結束自動關閉。要寫入資料時在端點裡自己 `session.commit()`。"""
    with create_session() as session:
        yield session


# 端點參數寫 `session: SessionDep` 就會拿到這個請求的 session。
SessionDep = Annotated[Session, Depends(get_db)]
