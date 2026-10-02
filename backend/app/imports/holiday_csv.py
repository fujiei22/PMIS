"""官方辦公日曆 CSV 的解析與完整性檢查（純函式）。

依表頭自動判別兩種格式：

- 新北市資料開放平臺（`date,year,name,isholiday,holidaycategory,description`）：只列特殊日
  （週末、假日、補班日），`isholiday` 是「是」或「否」。
- 行政院人事行政總處（`西元日期,星期,是否放假,備註`）：每天一列，`是否放假` 0 上班、2 放假。

輸出只留「跟預設規則不同」或「有名稱」的日子。預設規則（週六日放假、其他上班）與年份範圍、
名稱長度、來源清單都定義在 `app/core/calendar_rules.py`。

新北市的「特定節日」包含只限特定身分的日子：軍人節標「放假」，但說明是「軍人依國防部規定辦理」，
一般公司照常上班（人事總處同一天是上班日）。所以特定節日只有說明含「勞工」（勞動節）才算放假，
其他略過並記在 `skipped`，匯入的輸出看得到。

完整性：檔案裡某一年不完整（抓檔被截斷、管理員自製的幾列）時不能匯入，否則那年其他假日
會被整年替換掉。解析時順便算出 `incomplete`，寫入前呼叫 `ensure_complete()` 擋下。
"""

import csv
import io
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta

from app.core.calendar_rules import (
    MAX_YEAR,
    MIN_YEAR,
    OFFICIAL_NAME_MAX,
    CalendarSource,
    has_control_char,
    is_default_workday,
)

NTPC_HEADER = ("date", "year", "name", "isholiday", "holidaycategory", "description")
DGPA_HEADER = ("西元日期", "星期", "是否放假", "備註")
WEEKEND_CATEGORY = "星期六、星期日"
SPECIAL_CATEGORY = "特定節日"
# 新北市沒有名稱的列用類別補名稱；這兩類例外（普通週末不給名稱、紀念日的類別名稱太長）
CATEGORY_NAMES = {WEEKEND_CATEGORY: "", "放假之紀念日及節日": "國定假日"}
# 表頭認不得時只回顯第一格的前幾個字：選錯檔（例如 .env）時不能把整行（可能含密碼）印出來
HEADER_PREVIEW = 20

# 每個 CALENDAR_SOURCES 都要有標籤（tests/core/test_calendar_rules.py 檢查）。
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


def parse_calendar_csv(raw: bytes) -> ParsedCalendar:
    """解析新北市或人事總處的辦公日曆 CSV；格式不對丟 `CalendarFormatError`。"""
    text, encoding = _decode(raw)
    reader = csv.reader(io.StringIO(text))
    try:
        rows = list(reader)
    except csv.Error as exc:
        # 例：引號沒關，後面整份被當成同一個欄位，超過 csv 的欄位長度上限
        raise CalendarFormatError(
            f"第 {reader.line_num} 行附近：CSV 格式錯誤（{exc}）；請用原始下載檔"
        ) from exc
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
        first = header[0] if header else ""
        preview = first[:HEADER_PREVIEW] + ("…" if len(first) > HEADER_PREVIEW else "")
        raise CalendarFormatError(
            # !r：控制字元顯示成跳脫序列，不會直接進終端機
            f"第 1 行：認不得的表頭（{len(header)} 欄，第一欄開頭是 {preview!r}），"
            f"可能選錯檔了。新北市的表頭是 {','.join(NTPC_HEADER)}；"
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
    """略過的特定節日，一筆一行（匯入時印出來）。"""
    return [
        f"略過 {d.day.isoformat()} {d.name}：特定節日，說明沒有「勞工」，一般公司照常上班"
        for d in parsed.skipped
    ]


def _decode(raw: bytes) -> tuple[str, str]:
    """先試 UTF-8（含 BOM），解不開再試 Big5；回傳（文字, 編碼名稱）。"""
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
        """記下檔案裡出現的日期（算完整性用，不管要不要存）；同一天出現兩次就拒絕。"""
        if day in self.seen:
            raise CalendarFormatError(f"第 {line} 行：日期 {day.isoformat()} 重複")
        self.seen.add(day)
        self.years.add(day.year)

    def keep(self, day: date, *, is_workday: bool, name: str) -> None:
        """跟預設規則不同、或有名稱的日子才存（名稱先經過 `_check_name`）。"""
        if is_workday != is_default_workday(day) or name:
            self.days.append(OfficialDay(day=day, is_workday=is_workday, name=name))

    def gaps(self, source: CalendarSource) -> tuple[YearGap, ...]:
        """依來源的完整性規則，列出每個不完整的年份與原因（遞增）。"""
        found = []
        for year in sorted(self.years):
            reason = _ntpc_gap(year, self.seen) if source == "ntpc" else _dgpa_gap(year, self.seen)
            if reason:
                found.append(YearGap(year=year, reason=reason))
        return tuple(found)


def _days_of(year: int) -> list[date]:
    """那一年的每一天（遞增）。"""
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
    """逐列讀新北市格式（表頭之後）；`isholiday` 決定上班或放假，特定節日只留勞工放假的。"""
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
        label = _check_name(name or CATEGORY_NAMES.get(category, category), line)
        # 特定節日只有勞工放假的（勞動節）算；軍人節只限軍人，一般公司照常上班
        if category == SPECIAL_CATEGORY and "勞工" not in description:
            collector.skipped.append(OfficialDay(day=day, is_workday=is_workday, name=label))
            continue
        collector.keep(day, is_workday=is_workday, name=label)


def _read_dgpa(rows: list[list[str]], collector: _Collector) -> None:
    """逐列讀人事總處格式（表頭之後）；沒有備註的非預設日補上「補行上班日」或「放假」。"""
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
        name = _check_name(remark, line)
        if not name and is_workday != is_default_workday(day):
            name = "補行上班日" if is_workday else "放假"
        collector.keep(day, is_workday=is_workday, name=name)


def _cells(row: list[str], expected: int, line: int) -> list[str] | None:
    """去掉前後空白；整列空白回 None（略過），欄位數不對就拒絕。"""
    cells = [cell.strip() for cell in row]
    if not any(cells):
        return None
    if len(cells) != expected:
        raise CalendarFormatError(f"第 {line} 行：欄位數 {len(cells)}，應為 {expected}")
    return cells


def _check_name(name: str, line: int) -> str:
    """名稱會存進資料庫、印在終端機、不用登入就回給前端：太長或含控制字元就拒絕整份。"""
    if len(name) > OFFICIAL_NAME_MAX:
        raise CalendarFormatError(f"第 {line} 行：名稱超過 {OFFICIAL_NAME_MAX} 字")
    if has_control_char(name):
        raise CalendarFormatError(f"第 {line} 行：名稱含控制字元（換行、tab、跳脫序列…）")
    return name


def _parse_day(raw: str, line: int) -> date:
    """`YYYYMMDD` 轉日期；格式錯、日期不存在、年份超出範圍都丟 `CalendarFormatError`。"""
    if len(raw) != 8 or not (raw.isascii() and raw.isdigit()):
        raise CalendarFormatError(f"第 {line} 行：日期 {raw!r} 不是 YYYYMMDD")
    try:
        day = date(int(raw[:4]), int(raw[4:6]), int(raw[6:]))
    except ValueError as exc:
        raise CalendarFormatError(f"第 {line} 行：日期 {raw} 不存在") from exc
    if not MIN_YEAR <= day.year <= MAX_YEAR:
        raise CalendarFormatError(f"第 {line} 行：年份 {day.year} 不在 {MIN_YEAR}–{MAX_YEAR}")
    return day
