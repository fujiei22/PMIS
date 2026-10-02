"""Alembic 的執行環境。

連線字串從設定讀（環境變數 DATABASE_URL），比對資料表變更的對象是 `Base.metadata`。
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import get_settings
from app.models import Base

config = context.config

# 從命令列執行時套用 alembic.ini 的 log 設定；pytest 會關掉這一步，免得蓋掉 pytest 的 log 設定。
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """只產生 SQL、不連資料庫（`alembic upgrade head --sql`）。"""
    context.configure(
        url=get_settings().DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """連上資料庫執行 migration。"""
    connectable = create_engine(get_settings().DATABASE_URL, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
