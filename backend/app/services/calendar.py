"""工作日曆：官方辦公日曆（依年份整年替換）＋管理員的例外日（同一天以例外為準）。

預設規則見 app/core/calendar_rules.py。資料表只存跟預設不同、或有名稱的日子，讀取時把兩邊合併。
所有函式都不 commit，交給呼叫端（API、指令稿）。
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from sqlalchemy import ColumnElement, delete, func, or_, select
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.core.calendar_rules import (
    MAX_YEAR,
    MIN_YEAR,
    OVERRIDE_NAME_MAX,
    OVERRIDE_NOTE_MAX,
    has_control_char,
)
from app.imports.holiday_csv import ParsedCalendar, ensure_complete, parse_calendar_csv
from app.models import CalendarOfficialDay, CalendarOfficialYear, CalendarOverride
from app.services.errors import InvalidInput, NotFound

# 寫工作日曆（官方日曆、例外日）時的 advisory lock 鍵（"PMIS" 的 ASCII）：兩個人同時寫入時排隊，
# 不撞主鍵。目前全系統只有這一把；之後別的功能要用 advisory lock，鍵不能跟它重複。
CALENDAR_WRITE_LOCK = 0x504D4953

type EntrySource = Literal["official", "override"]


@dataclass(frozen=True)
class CalendarEntry:
    """查詢結果的一天：跟預設規則不同、或有名稱。"""

    day: date
    is_workday: bool
    name: str
    source: EntrySource


def import_official_calendar(
    session: Session, raw: bytes, *, imported_at: datetime
) -> ParsedCalendar:
    """匯入官方辦公日曆 CSV：解析、確認每一年都完整，再整年替換；回傳解析結果。

    格式錯或資料不完整丟 `CalendarFormatError`，資料不動。寫入官方日曆一律走這支：
    「不完整的檔不准整年替換」只在這裡把關，呼叫端不必自己記得先檢查。
    """
    parsed = parse_calendar_csv(raw)
    ensure_complete(parsed)
    replace_official_years(session, parsed, imported_at=imported_at)
    return parsed


def replace_official_years(
    session: Session, parsed: ParsedCalendar, *, imported_at: datetime
) -> None:
    """檔案涵蓋的每一年整年換成新資料；其他年份與例外日不動。

    不檢查完整性：正式寫入走 `import_official_calendar`（先檢查再呼叫這支）；
    直接呼叫只限測試（要能放殘缺的樣本）。
    """
    years = sorted(parsed.years)
    if not years:
        raise InvalidInput("檔案沒有任何年份")
    _lock_calendar_writes(session)
    in_years = or_(
        *(CalendarOfficialDay.day_on.between(date(y, 1, 1), date(y, 12, 31)) for y in years)
    )
    session.execute(delete(CalendarOfficialDay).where(in_years))
    session.execute(
        delete(CalendarOfficialYear).where(CalendarOfficialYear.calendar_year.in_(years))
    )
    session.add_all(
        CalendarOfficialDay(day_on=d.day, is_workday=d.is_workday, name=d.name) for d in parsed.days
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
    # 年份最先讀：三條查詢各看各的快照，讀的途中剛好有人匯入新年份時，只會少報涵蓋年份
    # （畫面多提示「假日資料未公布」），不會宣稱某年完整、卻拿不到那年的假日
    years = list(
        session.scalars(
            select(CalendarOfficialYear.calendar_year).order_by(CalendarOfficialYear.calendar_year)
        )
    )
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
    """新增或更新某天的例外日。名稱去掉前後空白後 1–100 字，備註最多 500 字，年份 2000–2200；
    名稱與備註不能含控制字元（名稱不用登入就看得到，備註只有管理員看得到）。
    """
    name = name.strip()
    if not 1 <= len(name) <= OVERRIDE_NAME_MAX:
        raise InvalidInput(f"名稱要 1–{OVERRIDE_NAME_MAX} 字")
    if len(note) > OVERRIDE_NOTE_MAX:
        raise InvalidInput(f"備註最多 {OVERRIDE_NOTE_MAX} 字")
    if has_control_char(name) or has_control_char(note):
        raise InvalidInput("名稱與備註不能含控制字元（換行、tab、跳脫序列…）")
    if not MIN_YEAR <= day.year <= MAX_YEAR:
        raise InvalidInput(f"日期 {day.isoformat()} 的年份要在 {MIN_YEAR}–{MAX_YEAR}")
    # 先鎖再查：兩個人同時新增同一天時，後到的會看到先到的那筆、改成更新，不撞主鍵
    _lock_calendar_writes(session)
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
    _lock_calendar_writes(session)
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


def _lock_calendar_writes(session: Session) -> None:
    """拿工作日曆的寫入鎖，交易結束（commit／rollback）時自動放開。

    正確性依賴預設的 READ COMMITTED：鎖到手之後的每條語句各取新快照，才看得到前一個寫入者
    剛 commit 的資料。engine 若改成 REPEATABLE READ，快照在拿鎖前就定了，會撞主鍵或序列化失敗。
    """
    session.execute(select(func.pg_advisory_xact_lock(CALENDAR_WRITE_LOCK)))


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
