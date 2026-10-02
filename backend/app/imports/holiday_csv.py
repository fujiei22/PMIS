"""官方辦公日曆 CSV 的解析與完整性檢查（純函式）。

依表頭自動判別兩種格式：

- 新北市資料開放平臺（`date,year,name,isholiday,holidaycategory,description`）：只列特殊日
  （週末、假日、補班日），`isholiday` 是「是」或「否」。
- 行政院人事行政總處（`西元日期,星期,是否放假,備註`）：每天一列，`是否放假` 0 上班、2 放假。

輸出只留「跟預設規則不同」或「有名稱」的日子。預設規則：ISO 星期 6、7（週六、週日）放假，
其他上班；`WEEKEND_ISO_DAYS` 是全系統唯一的定義（API 的 weekendDays 也來自它）。

新北市的「特定節日」包含只限特定身分的日子：軍人節標「放假」，但說明是「軍人依國防部規定辦理」，
一般公司照常上班（人事總處同一天是上班日）。所以特定節日只有說明含「勞工」（勞動節）才算放假，
其他略過並記在 `skipped`，同步與匯入的輸出看得到。

完整性：檔案裡某一年不完整（抓檔被截斷、管理員自製的幾列）時不能匯入，否則那年其他假日
會被整年替換掉。解析時順便算出 `incomplete`，寫入前呼叫 `ensure_complete()` 擋下。
"""

import csv
import io
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

NTPC_HEADER = ("date", "year", "name", "isholiday", "holidaycategory", "description")
DGPA_HEADER = ("西元日期", "星期", "是否放假", "備註")
NAME_MAX_LENGTH = 100
MIN_YEAR = 2000
MAX_YEAR = 2200
# 預設規則的週末：ISO 8601 星期（1 = 週一 … 7 = 週日）
WEEKEND_ISO_DAYS: tuple[int, ...] = (6, 7)

WEEKEND_CATEGORY = "星期六、星期日"
SPECIAL_CATEGORY = "特定節日"
# 新北市沒有名稱的列用類別補名稱；這兩類例外（普通週末不給名稱、紀念日的類別名稱太長）
CATEGORY_NAMES = {WEEKEND_CATEGORY: "", "放假之紀念日及節日": "國定假日"}

# 跟 app/models.py 的 CALENDAR_SOURCES 一致（tests/imports/test_holiday_csv.py 檢查）。
type CalendarSource = Literal["ntpc", "dgpa"]
# key 用 str：資料庫讀出來的 source 是 str，查表時不必轉型
SOURCE_LABELS: dict[str, str] = {"ntpc": "新北市", "dgpa": "人事總處"}


class CalendarFormatError(ValueError):
    """不是認得的格式、內容有錯，或資料不完整；訊息含行號或年份。"""


@dataclass(frozen=True)
class OfficialDay:
    """跟預設規則不同、或有名稱的一天。名稱只供顯示。"""

    day: date
    is_workday: bool
    name: str


@dataclass(frozen=True)
class YearGap:
    """某一年不完整的原因。"""

    year: int
    reason: str


@dataclass(frozen=True)
class ParsedCalendar:
    """解析結果。`years` 是檔案涵蓋的年份，匯入時這些年整年替換。"""

    source: CalendarSource
    years: frozenset[int]
    days: tuple[OfficialDay, ...]  # 依日期排序
    skipped: tuple[OfficialDay, ...]  # 略過的特定節日（例：軍人節）
    incomplete: tuple[YearGap, ...]  # 不完整的年份；非空時 ensure_complete() 會擋
    encoding: str  # "utf-8" 或 "cp950"


def is_default_workday(day: date) -> bool:
    """預設規則：ISO 星期 6、7 放假，其他上班。"""
    return day.isoweekday() not in WEEKEND_ISO_DAYS


def parse_calendar_csv(raw: bytes) -> ParsedCalendar:
    """解析新北市或人事總處的辦公日曆 CSV；格式不對丟 `CalendarFormatError`。"""
    text, encoding = _decode(raw)
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise CalendarFormatError("檔案是空的")
    header = tuple(cell.strip() for cell in rows[0])
    collector = _Collector()
    source: CalendarSource
    if header == NTPC_HEADER:
        source = "ntpc"
        _read_ntpc(rows[1:], collector)
    elif header == DGPA_HEADER:
        source = "dgpa"
        _read_dgpa(rows[1:], collector)
    else:
        raise CalendarFormatError(
            f"第 1 行：認不得的表頭「{','.join(header)}」。新北市的表頭是 {','.join(NTPC_HEADER)}；"
            f"人事總處的是 {','.join(DGPA_HEADER)}（請選一般版，不是「Google 行事曆專用」版）"
        )
    if not collector.years:
        raise CalendarFormatError("檔案只有表頭，沒有任何日期")
    return ParsedCalendar(
        source=source,
        years=frozenset(collector.years),
        days=tuple(sorted(collector.days, key=lambda d: d.day)),
        skipped=tuple(sorted(collector.skipped, key=lambda d: d.day)),
        incomplete=collector.gaps(source),
        encoding=encoding,
    )


def ensure_complete(parsed: ParsedCalendar) -> None:
    """有任何一年不完整就丟 `CalendarFormatError`（整份不匯入）。"""
    if parsed.incomplete:
        detail = "；".join(f"{gap.year} 年{gap.reason}" for gap in parsed.incomplete)
        raise CalendarFormatError(
            f"資料不完整，整份不匯入：{detail}。"
            "官方檔要整年匯入；要加單日的假或補班請用 holidays add"
        )


def describe_years(years: Iterable[int]) -> str:
    """連續三年以上寫成 2018–2027，其他逐年列（2026、2027）。"""
    ordered = sorted(years)
    if len(ordered) > 2 and ordered == list(range(ordered[0], ordered[-1] + 1)):
        return f"{ordered[0]}–{ordered[-1]}"
    return "、".join(str(year) for year in ordered)


def describe_skipped(parsed: ParsedCalendar) -> list[str]:
    """略過的特定節日，一筆一行（同步與匯入時印出來）。"""
    return [
        f"略過 {d.day.isoformat()} {d.name}：特定節日，說明沒有「勞工」，一般公司照常上班"
        for d in parsed.skipped
    ]


def _decode(raw: bytes) -> tuple[str, str]:
    try:
        return raw.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        pass
    try:
        # 中文 Windows 的 Excel 另存 CSV 預設是 Big5；表頭仍嚴格比對，解錯也會被擋下
        return raw.decode("cp950"), "cp950"
    except UnicodeDecodeError as exc:
        raise CalendarFormatError(
            "檔案不是 UTF-8 也不是 Big5 編碼；請用原始下載檔，"
            "或在 Excel 選「另存新檔 → CSV UTF-8（逗號分隔）」"
        ) from exc


class _Collector:
    """逐列累積：看過的日期、涵蓋年份、要存的日子、略過的日子；順便擋重複日期。"""

    def __init__(self) -> None:
        self.years: set[int] = set()
        self.days: list[OfficialDay] = []
        self.skipped: list[OfficialDay] = []
        self.seen: set[date] = set()

    def see(self, day: date, line: int) -> None:
        if day in self.seen:
            raise CalendarFormatError(f"第 {line} 行：日期 {day.isoformat()} 重複")
        self.seen.add(day)
        self.years.add(day.year)

    def keep(self, day: date, *, is_workday: bool, name: str, line: int) -> None:
        if len(name) > NAME_MAX_LENGTH:
            raise CalendarFormatError(f"第 {line} 行：名稱超過 {NAME_MAX_LENGTH} 字")
        if is_workday != is_default_workday(day) or name:
            self.days.append(OfficialDay(day=day, is_workday=is_workday, name=name))

    def gaps(self, source: CalendarSource) -> tuple[YearGap, ...]:
        found = []
        for year in sorted(self.years):
            reason = _ntpc_gap(year, self.seen) if source == "ntpc" else _dgpa_gap(year, self.seen)
            if reason:
                found.append(YearGap(year=year, reason=reason))
        return tuple(found)


def _days_of(year: int) -> list[date]:
    first = date(year, 1, 1)
    return [first + timedelta(days=i) for i in range((date(year + 1, 1, 1) - first).days)]


def _ntpc_gap(year: int, seen: set[date]) -> str:
    """新北市：每個週六日都要有列，而且 1/1 要有列（只有週末、還沒有假日的年份不算完整）。"""
    missing = [d for d in _days_of(year) if not is_default_workday(d) and d not in seen]
    problems = []
    if missing:
        problems.append(f"缺 {len(missing)} 個週六日")
    if date(year, 1, 1) not in seen:
        problems.append("缺 1/1")
    return "、".join(problems)


def _dgpa_gap(year: int, seen: set[date]) -> str:
    """人事總處：每一天都要有列。"""
    expected = len(_days_of(year))
    count = sum(1 for d in seen if d.year == year)
    return "" if count == expected else f"只有 {count} 天，應為 {expected} 天"


def _read_ntpc(rows: list[list[str]], collector: _Collector) -> None:
    for line, row in enumerate(rows, start=2):
        cells = _cells(row, len(NTPC_HEADER), line)
        if cells is None:
            continue
        raw_day, raw_year, name, is_holiday, category, description = cells
        day = _parse_day(raw_day, line)
        if raw_year != str(day.year):
            raise CalendarFormatError(f"第 {line} 行：year 欄 {raw_year} 跟日期 {raw_day} 不一致")
        collector.see(day, line)
        if is_holiday not in ("是", "否"):
            raise CalendarFormatError(
                f"第 {line} 行：isholiday 應為「是」或「否」，實際是 {is_holiday!r}"
            )
        is_workday = is_holiday == "否"
        label = name or CATEGORY_NAMES.get(category, category)
        # 特定節日只有勞工放假的（勞動節）算；軍人節只限軍人，一般公司照常上班
        if category == SPECIAL_CATEGORY and "勞工" not in description:
            collector.skipped.append(OfficialDay(day=day, is_workday=is_workday, name=label))
            continue
        collector.keep(day, is_workday=is_workday, name=label, line=line)


def _read_dgpa(rows: list[list[str]], collector: _Collector) -> None:
    for line, row in enumerate(rows, start=2):
        cells = _cells(row, len(DGPA_HEADER), line)
        if cells is None:
            continue
        raw_day, _weekday, flag, remark = cells
        day = _parse_day(raw_day, line)
        collector.see(day, line)
        if flag not in ("0", "2"):
            raise CalendarFormatError(f"第 {line} 行：是否放假應為 0 或 2，實際是 {flag!r}")
        is_workday = flag == "0"
        name = remark
        if not name and is_workday != is_default_workday(day):
            name = "補行上班日" if is_workday else "放假"
        collector.keep(day, is_workday=is_workday, name=name, line=line)


def _cells(row: list[str], expected: int, line: int) -> list[str] | None:
    """去掉前後空白；整列空白回 None（略過），欄位數不對就拒絕。"""
    cells = [cell.strip() for cell in row]
    if not any(cells):
        return None
    if len(cells) != expected:
        raise CalendarFormatError(f"第 {line} 行：欄位數 {len(cells)}，應為 {expected}")
    return cells


def _parse_day(raw: str, line: int) -> date:
    if len(raw) != 8 or not (raw.isascii() and raw.isdigit()):
        raise CalendarFormatError(f"第 {line} 行：日期 {raw!r} 不是 YYYYMMDD")
    try:
        day = date(int(raw[:4]), int(raw[4:6]), int(raw[6:]))
    except ValueError as exc:
        raise CalendarFormatError(f"第 {line} 行：日期 {raw} 不存在") from exc
    if not MIN_YEAR <= day.year <= MAX_YEAR:
        raise CalendarFormatError(f"第 {line} 行：年份 {day.year} 不在 {MIN_YEAR}–{MAX_YEAR}")
    return day
