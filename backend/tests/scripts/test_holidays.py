"""假日表管理指令（登入與管理畫面做好之前，管理員只能靠這支）。

測案：
- status：沒資料時提示怎麼補；有資料時逐年列來源與匯入時間、同步開關、例外日筆數；
  過期（超過 45 天）或缺今年資料時記 warning，--check 回 3。
- import：兩種檔都能匯入；殘缺檔、壞檔、找不到檔回 1 且資料不動；略過的特定節日要印出來；
  自動同步開著時提醒「下次可能被蓋回」。
- sync：成功寫入；抓不到回 1，並告訴管理員下一步。
- add / remove / list：一定要指定 --off 或 --workday；可以一次多個日期；輸出帶星期、官方原值、
  新增或修改；刪不存在的、名稱空白都回 1。
- 參數格式錯（日期不是 YYYY-MM-DD）由 argparse 擋，exit code 2，訊息是中文。
- 資料庫連不上時回 1，不噴 traceback。
"""

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager, nullcontext
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Protocol

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.imports.holiday_csv import parse_calendar_csv
from app.imports.holiday_fetch import FetchError
from app.scripts import holidays
from app.scripts.holidays import CHECK_FAILED, main
from app.services.calendar import (
    get_calendar,
    last_synced_at,
    list_overrides,
    replace_official_years,
)
from tests.calendar_samples import NTPC_2026_ROWS, NTPC_SAMPLE, dgpa_full_year, ntpc_full_year

NOW = datetime(2026, 10, 2, 1, 0, tzinfo=UTC)  # 台北 2026-10-02 09:00


class Runner(Protocol):
    def __call__(self, *argv: str, fetch: Callable[[], bytes] | None = None) -> int: ...


@pytest.fixture
def run(db: Session, caplog: pytest.LogCaptureFixture) -> Runner:
    """跑指令：連測試的 db、固定時間、預設抓到合成的 2026 完整年。"""
    caplog.set_level(logging.INFO, logger="app.scripts.holidays")

    def _run(*argv: str, fetch: Callable[[], bytes] | None = None) -> int:
        return main(
            list(argv),
            session_scope=lambda: nullcontext(db),
            fetch=fetch or (lambda: ntpc_full_year(2026, NTPC_2026_ROWS)),
            clock=lambda: NOW,
        )

    return _run


def write(tmp_path: Path, name: str, content: bytes) -> str:
    path = tmp_path / name
    path.write_bytes(content)
    return str(path)


def test_status_without_data(run: Runner, caplog: pytest.LogCaptureFixture) -> None:
    assert run("status") == 0
    assert "還沒有官方日曆資料" in caplog.text
    assert run("status", "--check") == CHECK_FAILED


def test_import_ntpc_file(
    run: Runner, db: Session, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    path = write(tmp_path, "ntpc.csv", ntpc_full_year(2026, NTPC_2026_ROWS))

    assert run("import", path) == 0

    assert last_synced_at(db) == NOW
    assert "已匯入 2026 年（新北市），5 個特殊日" in caplog.text
    assert "略過 2026-09-03 軍人節" in caplog.text


def test_import_reminds_auto_sync_may_overwrite(
    run: Runner,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enabled = get_settings().model_copy(update={"BACKGROUND_JOBS_ENABLED": True})
    monkeypatch.setattr(holidays, "get_settings", lambda: enabled)

    assert run("import", write(tmp_path, "116年.csv", dgpa_full_year(2027))) == 0

    assert "下次自動同步" in caplog.text


def test_import_dgpa_file(run: Runner, db: Session, tmp_path: Path) -> None:
    content = dgpa_full_year(
        2027,
        {date(2027, 1, 1): ("2", "開國紀念日"), date(2027, 9, 28): ("2", "孔子誕辰紀念日/教師節")},
    )

    assert run("import", write(tmp_path, "116年.csv", content)) == 0

    years, entries = get_calendar(db, date(2027, 1, 1), date(2027, 12, 31))
    assert years == [2027]
    assert [e.name for e in entries] == ["開國紀念日", "孔子誕辰紀念日/教師節"]


def test_import_partial_file_changes_nothing(
    run: Runner, db: Session, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    assert run("import", write(tmp_path, "few.csv", NTPC_SAMPLE)) == 1

    assert last_synced_at(db) is None
    assert "資料不完整" in caplog.text
    assert "holidays add" in caplog.text


def test_import_bad_header(run: Runner, tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    assert run("import", write(tmp_path, "bad.csv", b"a,b\n1,2\n")) == 1
    assert "認不得的表頭" in caplog.text


def test_import_missing_file(run: Runner, tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    assert run("import", str(tmp_path / "nope.csv")) == 1
    assert "找不到檔案" in caplog.text


def test_status_after_import(run: Runner, tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    run("import", write(tmp_path, "ntpc.csv", ntpc_full_year(2026, NTPC_2026_ROWS)))
    caplog.clear()

    assert run("status", "--check") == 0

    assert "2026 新北市（2026-10-02 09:00 匯入）" in caplog.text
    assert "明年（2027）的假日資料還沒有" in caplog.text
    assert "自動同步：關" in caplog.text
    assert "例外日 0 筆" in caplog.text


def test_status_stale(run: Runner, db: Session, caplog: pytest.LogCaptureFixture) -> None:
    replace_official_years(
        db, parse_calendar_csv(ntpc_full_year(2026)), imported_at=NOW - timedelta(days=50)
    )

    assert run("status", "--check") == CHECK_FAILED
    assert "上次匯入已經是 50 天前" in caplog.text


def test_sync(run: Runner, db: Session, caplog: pytest.LogCaptureFixture) -> None:
    assert run("sync") == 0
    assert last_synced_at(db) == NOW
    assert "下載中" in caplog.text


def test_sync_failure(run: Runner, db: Session, caplog: pytest.LogCaptureFixture) -> None:
    def unreachable() -> bytes:
        raise FetchError("抓不到 https://example.test：timed out")

    assert run("sync", fetch=unreachable) == 1
    assert last_synced_at(db) is None
    assert "伺服器連不到外網的話" in caplog.text


def test_add_list_remove(run: Runner, db: Session, caplog: pytest.LogCaptureFixture) -> None:
    assert (
        run("add", "2026-09-29", "2026-09-30", "--off", "--name", "颱風假", "--note", "北市公告")
        == 0
    )
    assert run("add", "2026-12-26", "--workday", "--name", "補班") == 0
    assert "已新增 2026-09-29（二）：放假 颱風假（官方日曆：上班）" in caplog.text
    assert "已新增 2026-12-26（六）：上班 補班（官方日曆：放假）" in caplog.text
    caplog.clear()

    assert run("add", "2026-09-29", "--off", "--name", "颱風假（全天）") == 0
    assert (
        "已修改 2026-09-29（二）：放假 颱風假（全天）（原本：放假 颱風假；官方日曆：上班）"
        in caplog.text
    )
    caplog.clear()

    assert run("list", "--year", "2026") == 0
    assert "2026-09-29（二） 放假 颱風假（全天）" in caplog.text
    assert "2026-09-30（三） 放假 颱風假（備註：北市公告）" in caplog.text

    assert run("remove", "2026-09-29", "2026-09-30") == 0
    assert [o.day_on for o in list_overrides(db)] == [date(2026, 12, 26)]


def test_add_same_as_official_is_flagged(run: Runner, caplog: pytest.LogCaptureFixture) -> None:
    assert run("add", "2026-10-03", "--off", "--name", "週六") == 0
    assert "跟官方日曆相同，不會改變工期" in caplog.text


def test_add_requires_off_or_workday(run: Runner) -> None:
    with pytest.raises(SystemExit) as exited:
        run("add", "2026-09-29", "--name", "颱風假")
    assert exited.value.code == 2


def test_list_without_overrides(run: Runner, caplog: pytest.LogCaptureFixture) -> None:
    assert run("list") == 0
    assert "沒有例外日" in caplog.text


def test_remove_missing(run: Runner, caplog: pytest.LogCaptureFixture) -> None:
    assert run("remove", "2026-09-29") == 1
    assert "2026-09-29 沒有例外日" in caplog.text


def test_add_blank_name(run: Runner) -> None:
    assert run("add", "2026-09-29", "--off", "--name", "  ") == 1


def test_bad_date_argument(run: Runner, capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exited:
        run("add", "2026/09/29", "--off", "--name", "颱風假")
    assert exited.value.code == 2
    assert "日期要寫成 YYYY-MM-DD" in capsys.readouterr().err


def test_database_down(caplog: pytest.LogCaptureFixture) -> None:
    def broken_scope() -> AbstractContextManager[Session]:
        raise OperationalError("SELECT 1", None, Exception("connection refused"))

    assert main(["status"], session_scope=broken_scope) == 1
    assert "連不上資料庫" in caplog.text
