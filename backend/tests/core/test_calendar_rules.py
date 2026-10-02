"""工作日曆的共用規則。

測案：
- 預設規則：週一到週五上班、週六日放假（ISO 星期 6、7）。
- 來源清單：型別（Literal）、資料表 CHECK 用的清單、顯示用的標籤三處一致
  （少一處，匯入或 status 輸出就會出錯）。
"""

from datetime import date
from typing import get_args

from app.core.calendar_rules import (
    CALENDAR_SOURCES,
    WEEKEND_ISO_DAYS,
    CalendarSource,
    is_default_workday,
)
from app.imports.holiday_csv import SOURCE_LABELS


def test_default_rule_is_weekdays_work_weekends_off() -> None:
    assert WEEKEND_ISO_DAYS == (6, 7)
    assert is_default_workday(date(2026, 10, 2))  # 五
    assert not is_default_workday(date(2026, 10, 3))  # 六
    assert not is_default_workday(date(2026, 10, 4))  # 日


def test_sources_match_type_and_labels() -> None:
    assert get_args(CalendarSource.__value__) == CALENDAR_SOURCES
    assert tuple(SOURCE_LABELS) == CALENDAR_SOURCES
