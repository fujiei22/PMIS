"""GET /api/calendar。

測案：
- 回傳週末規則、官方資料完整涵蓋的年份、區間內的特殊日（camelCase、例外日優先、依日期遞增）。
- from、to 都可以不給（前端進頁時一次載全部）。
- from 晚於 to、日期格式錯、多餘的參數 → 422，而且一律是 FastAPI 標準格式（detail 是陣列）：
  前端由 OpenAPI 產生的型別只認這一種。
- 暫時免登入（登入還沒做；README〈免登入的例外〉有寫）。
"""

from datetime import UTC, date, datetime
from typing import get_args

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.imports.holiday_csv import parse_calendar_csv
from app.schemas.calendar import CalendarDay
from app.services.calendar import EntrySource, replace_official_years, set_override
from tests.calendar_samples import NTPC_SAMPLE


@pytest.fixture
def seeded(db: Session) -> None:
    replace_official_years(
        db, parse_calendar_csv(NTPC_SAMPLE), imported_at=datetime(2026, 10, 1, tzinfo=UTC)
    )
    set_override(db, date(2026, 9, 29), is_workday=False, name="颱風假")


@pytest.mark.usefixtures("seeded")
def test_returns_rule_years_and_special_days(client: TestClient) -> None:
    response = client.get("/api/calendar", params={"from": "2026-09-01", "to": "2026-10-31"})

    assert response.status_code == 200
    assert response.json() == {
        "weekendDays": [6, 7],
        "coveredYears": [2023, 2026],
        "days": [
            {"date": "2026-09-25", "isWorkday": False, "name": "中秋節", "source": "official"},
            {"date": "2026-09-29", "isWorkday": False, "name": "颱風假", "source": "override"},
            {"date": "2026-10-09", "isWorkday": False, "name": "補假", "source": "official"},
            {"date": "2026-10-10", "isWorkday": False, "name": "國慶日", "source": "official"},
        ],
    }


@pytest.mark.usefixtures("seeded")
def test_without_params_returns_everything(client: TestClient) -> None:
    response = client.get("/api/calendar")

    assert response.status_code == 200
    assert [d["date"] for d in response.json()["days"]] == [
        "2023-09-23",
        "2026-05-01",
        "2026-09-25",
        "2026-09-29",
        "2026-10-09",
        "2026-10-10",
    ]


@pytest.mark.usefixtures("seeded")
def test_open_ended_range(client: TestClient) -> None:
    response = client.get("/api/calendar", params={"from": "2026-10-01"})

    assert [d["date"] for d in response.json()["days"]] == ["2026-10-09", "2026-10-10"]


def test_empty_calendar(client: TestClient) -> None:
    response = client.get("/api/calendar")

    assert response.status_code == 200
    assert response.json() == {"weekendDays": [6, 7], "coveredYears": [], "days": []}


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-10-31", "to": "2026-09-01"},
        {"from": "2026/09/01"},
        {"to": "2026-09-31"},
        {"start": "2026-09-01"},
    ],
)
def test_bad_params_are_standard_422(client: TestClient, params: dict[str, str]) -> None:
    response = client.get("/api/calendar", params=params)

    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_schema_source_values_match_service() -> None:
    """schema 與 service 各寫一份 "official" | "override"，這裡確認一致。"""
    assert get_args(CalendarDay.model_fields["source"].annotation) == get_args(
        EntrySource.__value__
    )
