"""工作日曆 service。

測案：
- 匯入官方日曆只有一個入口：完整的檔才寫入；不完整的整份拒絕、資料不動。
  寫入時拿 advisory lock，兩個人同時匯入會排隊（不撞主鍵）。
- 整年替換：檔案涵蓋的年整年換掉，其他年份不動；同一份檔匯入兩次結果相同。
- 例外日不會被重新匯入蓋掉，查詢時同一天以例外日為準。
- 查詢的區間頭尾都算、兩端都可以不給（前端進頁時一次載全部）；涵蓋年份回傳全部。
- 例外日名稱不能空白、年份要在 2000–2200、刪不存在的例外日要報錯
  （指令稿才能告訴管理員打錯日期）。
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.calendar_rules import CalendarSource
from app.imports.holiday_csv import (
    CalendarFormatError,
    OfficialDay,
    ParsedCalendar,
    parse_calendar_csv,
)
from app.models import CalendarOfficialDay, CalendarOverride
from app.services.calendar import (
    CALENDAR_WRITE_LOCK,
    CalendarEntry,
    covered_years,
    get_calendar,
    get_official_day,
    get_override,
    import_official_calendar,
    list_overrides,
    remove_override,
    replace_official_years,
    set_override,
)
from app.services.errors import InvalidInput, NotFound
from tests.calendar_samples import NTPC_2026_ROWS, NTPC_SAMPLE, ntpc_full_year

T0 = datetime(2026, 10, 1, 1, 0, tzinfo=UTC)


def parsed_of(source: CalendarSource, years: set[int], *days: OfficialDay) -> ParsedCalendar:
    return ParsedCalendar(
        source=source,
        years=frozenset(years),
        days=days,
        skipped=(),
        incomplete=(),
        encoding="utf-8",
    )


def official_days(db: Session) -> list[tuple[date, bool, str, str]]:
    rows = db.scalars(select(CalendarOfficialDay).order_by(CalendarOfficialDay.day_on))
    return [(r.day_on, r.is_workday, r.name, r.source) for r in rows]


def test_import_official_calendar_writes_complete_file(db: Session) -> None:
    parsed = import_official_calendar(db, ntpc_full_year(2026, NTPC_2026_ROWS), imported_at=T0)

    assert parsed.years == frozenset({2026})
    assert [(y.calendar_year, y.source) for y in covered_years(db)] == [(2026, "ntpc")]


def test_import_official_calendar_rejects_incomplete_file(db: Session) -> None:
    with pytest.raises(CalendarFormatError, match="資料不完整"):
        import_official_calendar(db, NTPC_SAMPLE, imported_at=T0)

    assert covered_years(db) == []
    assert official_days(db) == []


def test_import_takes_advisory_lock(db: Session) -> None:
    """鎖到交易結束才放：同一個交易裡查 pg_locks 看得到這把鎖。"""
    import_official_calendar(db, ntpc_full_year(2026, NTPC_2026_ROWS), imported_at=T0)

    held = db.execute(
        text(
            "SELECT classid::bigint * 4294967296 + objid::bigint FROM pg_locks "
            "WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND objsubid = 1"
        )
    ).scalars()
    assert CALENDAR_WRITE_LOCK in list(held)


def test_import_stores_days_and_years(db: Session) -> None:
    replace_official_years(db, parse_calendar_csv(NTPC_SAMPLE), imported_at=T0)

    assert official_days(db) == [
        (date(2023, 9, 23), True, "補行上班日", "ntpc"),
        (date(2026, 5, 1), False, "勞動節", "ntpc"),
        (date(2026, 9, 25), False, "中秋節", "ntpc"),
        (date(2026, 10, 9), False, "補假", "ntpc"),
        (date(2026, 10, 10), False, "國慶日", "ntpc"),
    ]
    assert [(y.calendar_year, y.source, y.imported_at) for y in covered_years(db)] == [
        (2023, "ntpc", T0),
        (2026, "ntpc", T0),
    ]


def test_reimport_replaces_only_the_years_in_the_file(db: Session) -> None:
    replace_official_years(db, parse_calendar_csv(NTPC_SAMPLE), imported_at=T0)
    later = T0 + timedelta(days=1)

    replace_official_years(
        db,
        parsed_of(
            "dgpa", {2026}, OfficialDay(day=date(2026, 9, 25), is_workday=False, name="中秋節")
        ),
        imported_at=later,
    )

    assert official_days(db) == [
        (date(2023, 9, 23), True, "補行上班日", "ntpc"),
        (date(2026, 9, 25), False, "中秋節", "dgpa"),
    ]
    assert [(y.calendar_year, y.source, y.imported_at) for y in covered_years(db)] == [
        (2023, "ntpc", T0),
        (2026, "dgpa", later),
    ]


def test_same_file_twice_gives_same_result(db: Session) -> None:
    parsed = parse_calendar_csv(NTPC_SAMPLE)
    replace_official_years(db, parsed, imported_at=T0)
    first = official_days(db)

    replace_official_years(db, parsed, imported_at=T0)

    assert official_days(db) == first


def test_empty_years_are_rejected(db: Session) -> None:
    with pytest.raises(InvalidInput):
        replace_official_years(db, parsed_of("ntpc", set()), imported_at=T0)


def test_overrides_survive_reimport_and_win(db: Session) -> None:
    replace_official_years(db, parse_calendar_csv(NTPC_SAMPLE), imported_at=T0)
    set_override(db, date(2026, 9, 25), is_workday=True, name="公司補班")
    set_override(db, date(2026, 9, 29), is_workday=False, name="颱風假")

    replace_official_years(db, parse_calendar_csv(NTPC_SAMPLE), imported_at=T0)
    years, entries = get_calendar(db, date(2026, 9, 1), date(2026, 10, 31))

    assert years == [2023, 2026]
    assert entries == [
        CalendarEntry(day=date(2026, 9, 25), is_workday=True, name="公司補班", source="override"),
        CalendarEntry(day=date(2026, 9, 29), is_workday=False, name="颱風假", source="override"),
        CalendarEntry(day=date(2026, 10, 9), is_workday=False, name="補假", source="official"),
        CalendarEntry(day=date(2026, 10, 10), is_workday=False, name="國慶日", source="official"),
    ]


def test_range_is_inclusive_and_open_ended(db: Session) -> None:
    replace_official_years(db, parse_calendar_csv(NTPC_SAMPLE), imported_at=T0)

    def days(start: date | None, end: date | None) -> list[date]:
        return [e.day for e in get_calendar(db, start, end)[1]]

    assert days(date(2026, 9, 25), date(2026, 10, 9)) == [date(2026, 9, 25), date(2026, 10, 9)]
    assert days(date(2026, 10, 9), None) == [date(2026, 10, 9), date(2026, 10, 10)]
    assert days(None, date(2026, 5, 1)) == [date(2023, 9, 23), date(2026, 5, 1)]
    assert len(days(None, None)) == 5


def test_empty_calendar(db: Session) -> None:
    assert get_calendar(db) == ([], [])
    assert covered_years(db) == []


def test_lookup_single_days(db: Session) -> None:
    replace_official_years(db, parse_calendar_csv(NTPC_SAMPLE), imported_at=T0)
    set_override(db, date(2026, 9, 29), is_workday=False, name="颱風假")

    official = get_official_day(db, date(2026, 9, 25))
    assert official is not None
    assert official.name == "中秋節"
    assert get_official_day(db, date(2026, 9, 29)) is None
    override = get_override(db, date(2026, 9, 29))
    assert override is not None
    assert override.name == "颱風假"
    assert get_override(db, date(2026, 9, 25)) is None


def test_set_override_updates_existing(db: Session) -> None:
    set_override(db, date(2026, 9, 29), is_workday=False, name="颱風假")
    set_override(db, date(2026, 9, 29), is_workday=False, name="颱風假（全天）", note="北市公告")

    [override] = list_overrides(db)
    assert (override.name, override.note) == ("颱風假（全天）", "北市公告")


@pytest.mark.parametrize(
    ("day", "name", "note"),
    [
        (date(2026, 9, 29), "", ""),
        (date(2026, 9, 29), "   ", ""),
        (date(2026, 9, 29), "長" * 101, ""),
        (date(2026, 9, 29), "颱風假", "長" * 501),
        (date(1999, 12, 31), "颱風假", ""),
    ],
)
def test_set_override_rejects_bad_input(db: Session, day: date, name: str, note: str) -> None:
    with pytest.raises(InvalidInput):
        set_override(db, day, is_workday=False, name=name, note=note)


def test_set_override_strips_name(db: Session) -> None:
    assert set_override(db, date(2026, 9, 29), is_workday=False, name="  颱風假 ").name == "颱風假"


def test_remove_override(db: Session) -> None:
    set_override(db, date(2026, 9, 29), is_workday=False, name="颱風假")

    remove_override(db, date(2026, 9, 29))

    assert db.scalars(select(CalendarOverride)).all() == []


def test_remove_missing_override_is_not_found(db: Session) -> None:
    with pytest.raises(NotFound, match="2026-09-29"):
        remove_override(db, date(2026, 9, 29))


def test_list_overrides_by_year(db: Session) -> None:
    set_override(db, date(2026, 12, 31), is_workday=False, name="公司假")
    set_override(db, date(2027, 1, 2), is_workday=True, name="補班")

    assert [o.day_on for o in list_overrides(db)] == [date(2026, 12, 31), date(2027, 1, 2)]
    assert [o.day_on for o in list_overrides(db, year=2027)] == [date(2027, 1, 2)]
