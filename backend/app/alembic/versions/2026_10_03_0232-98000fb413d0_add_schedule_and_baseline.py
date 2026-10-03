"""tasks 加工期與計畫

tasks.duration_days（工期，工作天 1–3650）、tasks.baseline_start_on／baseline_end_on（計畫起訖，成對）。
規則見 docs/reference/scheduling.md〈計畫與延遲〉。

autogenerate 產生後手改四處：
- duration_days 先帶 server_default 1 加欄，再依起訖換算既有任務的工期（`BACKFILL_DURATION_SQL`），
  最後拿掉預設值，跟 model 一致（不設預設值，由 service 寫入，同 status／priority／position 的慣例）。
  起訖缺一或結束早於開始的任務算不出工作天，維持 1。日曆要先匯入（`holidays import`），否則只扣週末。
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

# 既有任務的工期＝起訖之間（含頭尾）的工作天數，夾在 1–3650（規則見 docs/reference/scheduling.md〈工作天〉〈工期〉）。
# 判斷一天上不上班的順序同 app/services/calendar.py：例外日 → 官方資料 → 週六日（ISO 6、7）。
# - 用整數序列加日期（date + int），不用 generate_series(date, date, interval)：後者會變成 timestamptz，有時區問題。
# - 序列最多展開 7300 天：再長也只會夾成 3650 個工作天。
# - raw SQL 不經 ORM 的軟刪除過濾，回收桶裡的任務也一起換算（還原時才不會帶著錯的工期）。
# - 起訖缺一、結束早於開始的不更新，留在加欄時補的 1。
# 只能在升級當下跑一次：任務 API 上線後，結束日是依工期推算寫回的快照，再反推會蓋掉真正的輸入值。
# tests/test_migration_duration_backfill.py 直接執行這段 SQL 驗證。
BACKFILL_DURATION_SQL = """
UPDATE tasks AS t
SET duration_days = (
    SELECT LEAST(3650, GREATEST(1, count(*)))
    FROM generate_series(0, LEAST(t.end_on - t.start_on, 7300)) AS g(n)
    WHERE COALESCE(
        (SELECT o.is_workday FROM calendar_overrides AS o WHERE o.day_on = t.start_on + g.n),
        (SELECT d.is_workday FROM calendar_official_days AS d WHERE d.day_on = t.start_on + g.n),
        EXTRACT(ISODOW FROM t.start_on + g.n) NOT IN (6, 7)
    )
)
WHERE t.start_on IS NOT NULL
  AND t.end_on IS NOT NULL
  AND isfinite(t.start_on) AND isfinite(t.end_on)
  AND t.end_on >= t.start_on
"""


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("duration_days", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.execute(sa.text(BACKFILL_DURATION_SQL))
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
    # 會永久刪掉工期與計畫開始日（根任務的計畫開始日、工期都是使用者的輸入值，不能從其他欄位重算）；
    # 有資料時降版前先備份：pg_dump -t tasks
    op.drop_constraint(op.f("ck_tasks_baseline_pair"), "tasks", type_="check")
    op.drop_constraint(op.f("ck_tasks_duration_days_range"), "tasks", type_="check")
    op.drop_column("tasks", "baseline_end_on")
    op.drop_column("tasks", "baseline_start_on")
    op.drop_column("tasks", "duration_days")
