"""工作日曆：官方辦公日曆（依年份整年替換）＋管理員的例外日（同一天以例外為準）。

預設規則見 app/imports/holiday_csv.py 的 WEEKEND_ISO_DAYS。資料表只存跟預設不同、或有名稱的日子，
讀取時把兩邊合併。所有函式都不 commit，交給呼叫端（API、指令稿）。
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from sqlalchemy import ColumnElement, delete, func, or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.imports.holiday_csv import MAX_YEAR, MIN_YEAR, ParsedCalendar
from app.models import CalendarOfficialDay, CalendarOfficialYear, CalendarOverride
from app.services.errors import InvalidInput, NotFound

OVERRIDE_NAME_MAX = 100
OVERRIDE_NOTE_MAX = 500
# 寫官方日曆時的 advisory lock 鍵（"PMIS"）：兩個人同時匯入時排隊，不撞主鍵
CALENDAR_WRITE_LOCK = 0x504D4953

type EntrySource = Literal["official", "override"]


@dataclass(frozen=True)
class CalendarEntry:
    """查詢結果的一天：跟預設規則不同、或有名稱。"""

    day: date
    is_workday: bool
    name: str
    source: EntrySource


def replace_official_years(
    session: Session, parsed: ParsedCalendar, *, imported_at: datetime
) -> None:
    """檔案涵蓋的每一年整年換成新資料；其他年份與例外日不動。

    呼叫前應該先 `ensure_complete(parsed)`：這裡不檢查完整性（測試要能放殘缺的樣本）。
    """
    years = sorted(parsed.years)
    if not years:
        raise InvalidInput("檔案沒有任何年份")
    # 交易結束時自動放開
    session.execute(select(func.pg_advisory_xact_lock(CALENDAR_WRITE_LOCK)))
    in_years = or_(
        *(CalendarOfficialDay.day_on.between(date(y, 1, 1), date(y, 12, 31)) for y in years)
    )
    session.execute(delete(CalendarOfficialDay).where(in_years))
    session.execute(
        delete(CalendarOfficialYear).where(CalendarOfficialYear.calendar_year.in_(years))
    )
    session.add_all(
        CalendarOfficialDay(
            day_on=d.day, is_workday=d.is_workday, name=d.name, source=parsed.source
        )
        for d in parsed.days
    )
    session.add_all(
        CalendarOfficialYear(calendar_year=y, source=parsed.source, imported_at=imported_at)
        for y in years
    )
    session.flush()


def get_calendar(
    session: Session, start: date | None = None, end: date | None = None
) -> tuple[list[int], list[CalendarEntry]]:
    """區間內的特殊日（依日期遞增、例外日優先），以及官方資料完整涵蓋的所有年份（遞增）。

    `start`、`end` 都含在內；不給的那一端不設限。
    """
    merged: dict[date, CalendarEntry] = {}
    official_in_range = _within(CalendarOfficialDay.day_on, start, end)
    for official in session.scalars(select(CalendarOfficialDay).where(*official_in_range)):
        merged[official.day_on] = CalendarEntry(
            day=official.day_on,
            is_workday=official.is_workday,
            name=official.name,
            source="official",
        )
    override_in_range = _within(CalendarOverride.day_on, start, end)
    for override in session.scalars(select(CalendarOverride).where(*override_in_range)):
        merged[override.day_on] = CalendarEntry(
            day=override.day_on,
            is_workday=override.is_workday,
            name=override.name,
            source="override",
        )
    years = list(
        session.scalars(
            select(CalendarOfficialYear.calendar_year).order_by(CalendarOfficialYear.calendar_year)
        )
    )
    return years, [merged[day] for day in sorted(merged)]


def covered_years(session: Session) -> list[CalendarOfficialYear]:
    """官方資料完整涵蓋的年份（遞增），含每年的來源與最後匯入時間。"""
    return list(
        session.scalars(select(CalendarOfficialYear).order_by(CalendarOfficialYear.calendar_year))
    )


def get_official_day(session: Session, day: date) -> CalendarOfficialDay | None:
    """那天的官方特殊日；普通日子（照預設規則）回 None。"""
    return session.scalars(
        select(CalendarOfficialDay).where(CalendarOfficialDay.day_on == day)
    ).one_or_none()


def get_override(session: Session, day: date) -> CalendarOverride | None:
    """那天的例外日；沒有回 None。"""
    # 主鍵是日期，不是 UUID：不能用 get_live()，也不准用 session.get()（test_source_rules 守）
    return session.scalars(
        select(CalendarOverride).where(CalendarOverride.day_on == day)
    ).one_or_none()


def set_override(
    session: Session, day: date, *, is_workday: bool, name: str, note: str = ""
) -> CalendarOverride:
    """新增或更新某天的例外日。名稱去掉前後空白後 1–100 字，備註最多 500 字，年份 2000–2200。"""
    name = name.strip()
    if not 1 <= len(name) <= OVERRIDE_NAME_MAX:
        raise InvalidInput(f"名稱要 1–{OVERRIDE_NAME_MAX} 字")
    if len(note) > OVERRIDE_NOTE_MAX:
        raise InvalidInput(f"備註最多 {OVERRIDE_NOTE_MAX} 字")
    if not MIN_YEAR <= day.year <= MAX_YEAR:
        raise InvalidInput(f"日期 {day.isoformat()} 的年份要在 {MIN_YEAR}–{MAX_YEAR}")
    override = get_override(session, day)
    if override is None:
        override = CalendarOverride(day_on=day, is_workday=is_workday, name=name, note=note)
        session.add(override)
    else:
        override.is_workday = is_workday
        override.name = name
        override.note = note
    session.flush()
    return override


def remove_override(session: Session, day: date) -> None:
    """刪掉某天的例外日（真的刪，沒有回收桶）；那天沒有例外日丟 `NotFound`。"""
    override = get_override(session, day)
    if override is None:
        raise NotFound(f"{day.isoformat()} 沒有例外日（先用 list 查）")
    session.delete(override)
    session.flush()


def list_overrides(session: Session, year: int | None = None) -> list[CalendarOverride]:
    """例外日（依日期排序）；給 `year` 只列那一年。"""
    start = None if year is None else date(year, 1, 1)
    end = None if year is None else date(year, 12, 31)
    return list(
        session.scalars(
            select(CalendarOverride)
            .where(*_within(CalendarOverride.day_on, start, end))
            .order_by(CalendarOverride.day_on)
        )
    )


def _within(
    column: InstrumentedAttribute[date], start: date | None, end: date | None
) -> list[ColumnElement[bool]]:
    """`start <= column <= end`；不給的那一端不設限（回空 list，`.where()` 等於沒有條件）。"""
    conditions: list[ColumnElement[bool]] = []
    if start is not None:
        conditions.append(column >= start)
    if end is not None:
        conditions.append(column <= end)
    return conditions
