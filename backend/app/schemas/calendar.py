"""工作日曆的 wire 格式（`GET /api/calendar`）。"""

import datetime as dt
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.common import CamelModel


class CalendarQuery(BaseModel):
    """查詢參數：兩端都可以不給（不設限）；都不給就回全部（10 年約 1,200 筆）。"""

    # 多送的參數直接 422（跟請求 model 的 extra="forbid" 同一個規則）
    model_config = ConfigDict(extra="forbid")

    from_: dt.date | None = Field(
        default=None, alias="from", description="區間起日（含），YYYY-MM-DD；不給就不設限"
    )
    to: dt.date | None = Field(default=None, description="區間迄日（含），YYYY-MM-DD；不給就不設限")

    @model_validator(mode="after")
    def check_order(self) -> Self:
        # 丟 ValueError：FastAPI 回標準格式的 422（detail 是陣列），跟其他驗證錯誤一致
        if self.from_ is not None and self.to is not None and self.from_ > self.to:
            raise ValueError("from 不能晚於 to")
        return self


class CalendarDay(CamelModel):
    """跟預設規則不同、或有名稱的一天。"""

    date: dt.date
    is_workday: bool
    # 只供顯示（例：中秋節、補假、颱風假），寫法可能跟來源不同；前端不得拿它判斷邏輯。
    name: str
    # official：官方辦公日曆；override：管理員的例外日（同一天只會回例外日）。
    source: Literal["official", "override"]


class WorkCalendar(CamelModel):
    """工作日曆。

    前端算工作天：`weekendDays`（ISO 8601 星期，1 = 週一 … 7 = 週日）放假、其他上班，
    `days` 裡有的照它；不在 `coveredYears` 的年份只套週末規則，畫面要提示「假日資料未公布」。
    `days` 依日期遞增、同一天只有一筆；`coveredYears` 遞增，代表那幾年官方日曆已完整匯入。
    """

    weekend_days: list[int]
    covered_years: list[int]
    days: list[CalendarDay]
