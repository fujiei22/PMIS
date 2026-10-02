from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.core.time import today


@pytest.fixture
def timezone_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[pytest.MonkeyPatch]:
    """測試裡改 TIMEZONE；結束後清掉快取，其他測試讀回原本的設定。"""
    get_settings.cache_clear()
    yield monkeypatch
    get_settings.cache_clear()


@pytest.mark.parametrize(
    ("utc_moment", "expected"),
    [
        # Asia/Taipei 是 UTC+8：UTC 16:00 是台灣的隔天 00:00。
        (datetime(2026, 10, 1, 15, 59, 59, tzinfo=UTC), date(2026, 10, 1)),
        (datetime(2026, 10, 1, 16, 0, 0, tzinfo=UTC), date(2026, 10, 2)),
    ],
)
def test_today_uses_taipei_by_default(
    timezone_env: pytest.MonkeyPatch, utc_moment: datetime, expected: date
) -> None:
    timezone_env.delenv("TIMEZONE", raising=False)
    assert today(utc_moment) == expected


def test_today_follows_timezone_setting(timezone_env: pytest.MonkeyPatch) -> None:
    timezone_env.setenv("TIMEZONE", "UTC")
    assert today(datetime(2026, 10, 1, 16, 0, 0, tzinfo=UTC)) == date(2026, 10, 1)


def test_today_rejects_naive_datetime() -> None:
    naive = datetime(2026, 10, 1, 12, 0, 0)  # noqa: DTZ001 -- 故意不帶時區
    with pytest.raises(ValueError, match="時區"):
        today(naive)


def test_today_without_argument_is_a_date() -> None:
    assert isinstance(today(), date)


@pytest.mark.parametrize("value", ["Taipei", "Asia/Nowhere", "../etc/passwd", ""])
def test_unknown_timezone_is_rejected(value: str) -> None:
    with pytest.raises(ValidationError, match="TIMEZONE"):
        Settings(DATABASE_URL="postgresql+psycopg://u:p@localhost/db", TIMEZONE=value)
