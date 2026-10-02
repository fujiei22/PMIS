"""資料表定義（SQLAlchemy 2）。目前還沒有資料表。

新增資料表：在這個檔案寫一個繼承 `Base` 的 class，然後產生 migration
（`uv run alembic revision --autogenerate -m "說明"`），逐行確認後再套用。
Alembic 從 `Base.metadata` 比對資料表變更，所以 model 一定要繼承 `Base`。
"""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# 約束（主鍵、外鍵、唯一、檢查）與索引的命名規則。
# 名稱固定下來，之後的 migration 才能用名稱刪改它們。
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """所有資料表 model 的基底。"""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
