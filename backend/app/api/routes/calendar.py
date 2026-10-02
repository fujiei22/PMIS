"""工作日曆：給前端算工作天用。

暫時免登入：後端登入還沒做（見 backend/README.md〈免登入的例外〉）；登入完成時跟其他端點一起加上驗證。
寫入（匯入、例外日）只有指令稿 `app/scripts/holidays.py`，沒有寫入的 API。
"""

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import SessionDep
from app.imports.holiday_csv import WEEKEND_ISO_DAYS
from app.schemas.calendar import CalendarDay, CalendarQuery, WorkCalendar
from app.services.calendar import get_calendar

router = APIRouter(tags=["calendar"])


@router.get("/calendar")
def read_calendar(session: SessionDep, query: Annotated[CalendarQuery, Query()]) -> WorkCalendar:
    """週末規則、官方資料完整涵蓋的年份，以及區間內跟預設規則不同或有名稱的日子。

    `from`、`to` 都可以不給；`from` 晚於 `to`、日期格式錯、多餘的參數回 422。
    """
    years, entries = get_calendar(session, query.from_, query.to)
    return WorkCalendar(
        weekend_days=list(WEEKEND_ISO_DAYS),
        covered_years=years,
        days=[
            CalendarDay(date=e.day, is_workday=e.is_workday, name=e.name, source=e.source)
            for e in entries
        ],
    )
