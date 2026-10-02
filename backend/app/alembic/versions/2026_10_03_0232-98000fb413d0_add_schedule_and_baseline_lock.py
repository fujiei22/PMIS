"""tasks 加工期與計畫基準，projects 加基準鎖定日

tasks.duration_days（工期，工作天 1–3650）、tasks.baseline_start_on／baseline_end_on（計畫基準，成對）、
projects.baseline_locked_on（基準鎖定日，NULL＝規劃中）。規則見 docs/reference/scheduling.md。

autogenerate 產生後手改三處：
- duration_days 先帶 server_default 加欄、再拿掉預設值：已有任務的資料庫也能升級，最終跟 model 一致（不設預設值，
  由 service 寫入，同 status／priority／position 的慣例）。
- 兩條 CHECK 手寫：在既有表新增 CHECK，autogenerate 偵測不到。
- downgrade 先拿掉兩條 CHECK 再刪欄。

Revision ID: 98000fb413d0
Revises: a2eddfa35bec
Create Date: 2026-10-03 02:32:33.106386

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "98000fb413d0"
down_revision: str | Sequence[str] | None = "a2eddfa35bec"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("baseline_locked_on", sa.Date(), nullable=True))
    op.add_column(
        "tasks",
        sa.Column("duration_days", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.alter_column("tasks", "duration_days", server_default=None)
    op.add_column("tasks", sa.Column("baseline_start_on", sa.Date(), nullable=True))
    op.add_column("tasks", sa.Column("baseline_end_on", sa.Date(), nullable=True))
    op.create_check_constraint(
        op.f("ck_tasks_duration_days_range"), "tasks", "duration_days BETWEEN 1 AND 3650"
    )
    op.create_check_constraint(
        op.f("ck_tasks_baseline_pair"),
        "tasks",
        "(baseline_start_on IS NULL) = (baseline_end_on IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_tasks_baseline_pair"), "tasks", type_="check")
    op.drop_constraint(op.f("ck_tasks_duration_days_range"), "tasks", type_="check")
    op.drop_column("tasks", "baseline_end_on")
    op.drop_column("tasks", "baseline_start_on")
    op.drop_column("tasks", "duration_days")
    op.drop_column("projects", "baseline_locked_on")
