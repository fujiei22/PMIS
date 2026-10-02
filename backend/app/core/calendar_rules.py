"""工作日曆的共用規則：預設週末、年份範圍、名稱長度、官方日曆來源。

解析（`app/imports/holiday_csv.py`）、寫入（`app/services/calendar.py`）、資料表的 CHECK
（`app/models.py`）、API（`app/api/routes/calendar.py`）都從這裡拿，不各自寫一份。

資料表只存「跟預設週末不同、或有名稱」的日子，等於把週末定義寫進了資料：改 `WEEKEND_ISO_DAYS`
之後，已匯入的官方日曆要全部重新匯入，例外日也要逐筆檢查。
"""

from datetime import date
from typing import Literal

# 預設規則的週末：ISO 8601 星期（1 = 週一 … 7 = 週日）
WEEKEND_ISO_DAYS: tuple[int, ...] = (6, 7)

# 官方日曆與例外日接受的年份（含頭尾）；資料表也有同樣的 CHECK
MIN_YEAR = 2000
MAX_YEAR = 2200

# 官方日曆的名稱（中秋節、補假…）最多幾字
OFFICIAL_NAME_MAX = 100
# 例外日的名稱（必填）與備註最多幾字
OVERRIDE_NAME_MAX = 100
OVERRIDE_NOTE_MAX = 500

# 官方日曆的來源：ntpc 新北市資料開放平臺、dgpa 行政院人事行政總處
type CalendarSource = Literal["ntpc", "dgpa"]
CALENDAR_SOURCES: tuple[CalendarSource, ...] = ("ntpc", "dgpa")


def is_default_workday(day: date) -> bool:
    """預設規則：`WEEKEND_ISO_DAYS` 放假，其他上班。"""
    return day.isoweekday() not in WEEKEND_ISO_DAYS
