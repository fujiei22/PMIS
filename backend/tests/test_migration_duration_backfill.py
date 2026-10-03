"""migration 98000fb413d0 的工期換算：既有任務的工期＝起訖之間（含頭尾）的工作天數。

規則見 docs/reference/scheduling.md〈工作天〉〈工期〉：例外日（calendar_overrides）優先、
其次官方資料（calendar_official_days）、都沒有就看週六日。起訖缺一或結束早於開始的維持 1，
超過上限夾在 TASK_DURATION_MAX。

做法：migration 把換算的 SQL 放在模組常數 `BACKFILL_DURATION_SQL`，這裡在測試交易裡灌日曆與任務、
跑同一段 SQL 再檢查（結束時整個交易 rollback，不必把測試資料庫降版再升版）。
"""

import importlib.util
from datetime import date
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models import TASK_DURATION_MAX, CalendarOfficialDay, CalendarOverride, Task
from tests.factories import make_task, soft_delete

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "app/alembic/versions/2026_10_03_0232-98000fb413d0_add_schedule_and_baseline_lock.py"
)


def backfill_sql() -> str:
    """從 migration 模組取出換算的 SQL（檔名以數字開頭，不能直接 import）。"""
    spec = importlib.util.spec_from_file_location("migration_98000fb413d0", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.BACKFILL_DURATION_SQL


def run_backfill(db: Session) -> None:
    """跑換算（raw SQL，跟 migration 裡的同一段）。"""
    db.execute(text(backfill_sql()))


def duration_of(db: Session, task: Task) -> int:
    """直接讀資料表：ORM 的查詢會套軟刪除過濾，回收桶裡的列讀不到。"""
    return db.execute(
        text("SELECT duration_days FROM tasks WHERE id = :id"), {"id": task.id}
    ).scalar_one()


def test_counts_workdays_with_official_holidays(db: Session) -> None:
    """scheduling.md 的例子：10/08–10/13 中間有補假與國慶，3 個工作天。"""
    db.add_all(
        [
            CalendarOfficialDay(day_on=date(2026, 10, 9), is_workday=False, name="補假"),
            CalendarOfficialDay(day_on=date(2026, 10, 10), is_workday=False, name="國慶日"),
        ]
    )
    task = make_task(db, start_on=date(2026, 10, 8), end_on=date(2026, 10, 13))
    run_backfill(db)
    assert duration_of(db, task) == 3


def test_override_beats_weekend(db: Session) -> None:
    """例外日優先：週六補班算工作天（10/16 五、10/17 六補班、10/19 一＝3 天）。"""
    db.add(CalendarOverride(day_on=date(2026, 10, 17), is_workday=True, name="補班", note=""))
    task = make_task(db, start_on=date(2026, 10, 16), end_on=date(2026, 10, 19))
    run_backfill(db)
    assert duration_of(db, task) == 3


def test_override_beats_official(db: Session) -> None:
    """例外日蓋過官方資料：官方說放假、公司說上班，就算上班。"""
    db.add_all(
        [
            CalendarOfficialDay(day_on=date(2026, 10, 9), is_workday=False, name="補假"),
            CalendarOverride(day_on=date(2026, 10, 9), is_workday=True, name="照常上班", note=""),
        ]
    )
    task = make_task(db, start_on=date(2026, 10, 8), end_on=date(2026, 10, 9))
    run_backfill(db)
    assert duration_of(db, task) == 2


def test_missing_or_reversed_dates_stay_one(db: Session) -> None:
    """起訖缺一、結束早於開始：算不出工作天，維持升級時補的 1。"""
    no_start = make_task(db, end_on=date(2026, 10, 13))
    reversed_ = make_task(db, start_on=date(2026, 10, 13), end_on=date(2026, 10, 8))
    run_backfill(db)
    assert duration_of(db, no_start) == 1
    assert duration_of(db, reversed_) == 1


def test_clamped_to_max(db: Session) -> None:
    """很長的區間夾在上限（CHECK 是 1–TASK_DURATION_MAX）。"""
    task = make_task(db, start_on=date(2000, 1, 3), end_on=date(2030, 12, 31))
    run_backfill(db)
    assert duration_of(db, task) == TASK_DURATION_MAX


def test_soft_deleted_tasks_are_converted_too(db: Session) -> None:
    """回收桶裡的任務也要換算：還原出來時才不會帶著錯的工期。"""
    task = make_task(db, start_on=date(2026, 10, 12), end_on=date(2026, 10, 16))
    soft_delete(db, task)
    run_backfill(db)
    assert duration_of(db, task) == 5
