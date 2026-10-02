"""假日表的管理指令（登入與管理畫面做好之前，管理員用這支）。連的是 DATABASE_URL。

假日表全靠手動維護，程式不連外網（user 2026-10-02 定案）：管理員下載新北市或人事總處的
辦公日曆 CSV，用 `import` 整年匯入；颱風假、公司自訂假日用 `add` 加例外日。

成功回 0；失敗（檔案壞、日期沒有例外日…）印原因與下一步、回 1，資料不動；
`status --check` 發現缺今年資料、或 11 月起還缺明年資料時回 3（給監控或人工巡檢用）。
輸出走 stdout，可以 `> 檔案` 或接管線。範例見 `--help`。
"""

import argparse
import logging
import sys
from collections.abc import Callable, Sequence
from contextlib import AbstractContextManager
from datetime import date, datetime
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy.exc import OperationalError, ProgrammingError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.calendar_rules import MAX_YEAR, MIN_YEAR, is_default_workday
from app.core.db import create_session
from app.core.time import local_zone, today, utc_now
from app.imports.holiday_csv import (
    SOURCE_LABELS,
    CalendarFormatError,
    ParsedCalendar,
    describe_skipped,
    describe_years,
)
from app.models import CalendarOfficialYear
from app.services.calendar import (
    covered_years,
    get_official_day,
    get_override,
    import_official_calendar,
    list_overrides,
    remove_override,
    set_override,
)
from app.services.errors import InvalidInput, ServiceError

logger = logging.getLogger(__name__)

PROG = "uv run python -m app.scripts.holidays"
EXAMPLES = f"""範例（在 backend/ 下執行）：
  {PROG} status                         官方資料涵蓋哪幾年、每年的來源與匯入時間
  {PROG} import D:\\下載\\辦公日曆表.csv   手動匯入新北市或人事總處的 CSV（整年）
  {PROG} add 2026-09-29 2026-09-30 --off --name 颱風假
  {PROG} add 2026-12-26 --workday --name 補班
  {PROG} remove 2026-09-29
  {PROG} list --year 2026
"""
WEEKDAYS = "一二三四五六日"
CHECK_FAILED = 3
# 11 月起還沒有明年的假日資料就算問題（人事總處通常年中公布，新北市隨後更新）
NEXT_YEAR_DUE_MONTH = 11

type SessionScope = Callable[[], AbstractContextManager[Session]]
type Handler = Callable[[Session, argparse.Namespace, datetime], int]


def main(
    argv: Sequence[str] | None = None,
    *,
    session_scope: SessionScope = create_session,
    clock: Callable[[], datetime] = utc_now,
) -> int:
    """跑一個子指令，回傳 exit code（0 成功、1 失敗、3 status --check 發現問題）。

    參數格式錯（日期、年份、缺 --off／--workday）由 argparse 印用法並 `SystemExit(2)`，不經過這裡的回傳值。
    `session_scope`、`clock` 給測試注入測試資料庫與固定時間。
    """
    args = _parser().parse_args(argv)
    handler: Handler = args.handler
    try:
        with session_scope() as session:
            return handler(session, args, clock())
    except ValidationError as exc:
        logger.error("設定有誤（backend/.env 或環境變數）：\n%s", exc)
    except OperationalError as exc:
        logger.error("連不上資料庫：%s\n請確認 PostgreSQL 有在跑，以及 DATABASE_URL 正確", exc.orig)
    except ProgrammingError as exc:
        logger.error(
            "資料表不存在或版本不對：%s\n先在 backend/ 跑 uv run alembic upgrade head", exc.orig
        )
    except SQLAlchemyError as exc:
        logger.error("資料庫錯誤，資料沒有改動，請稍後再試：%s", exc)
    except (ServiceError, CalendarFormatError) as exc:
        logger.error("失敗：%s", exc)
    return 1


def _parser() -> argparse.ArgumentParser:
    """子指令與參數；每個子指令的處理函式放在 `handler`。"""
    parser = argparse.ArgumentParser(
        prog=PROG,
        description="假日表（工作日曆）管理。連的是 DATABASE_URL。",
        epilog=EXAMPLES,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    commands = parser.add_subparsers(required=True, metavar="指令")

    status = commands.add_parser("status", help="官方資料涵蓋的年份、每年的來源與匯入時間")
    status.add_argument(
        "--check",
        action="store_true",
        help=f"缺今年資料、或 {NEXT_YEAR_DUE_MONTH} 月起還缺明年資料時回 {CHECK_FAILED}",
    )
    status.set_defaults(handler=_status)

    import_ = commands.add_parser(
        "import", help="匯入新北市或人事總處的辦公日曆 CSV（整年；下載處見 backend/README.md）"
    )
    import_.add_argument(
        "path", type=Path, help="CSV 檔案路徑；相對路徑以目前資料夾為準，建議用完整路徑"
    )
    import_.set_defaults(handler=_import)

    add = commands.add_parser("add", help="新增或修改例外日（颱風假、公司自訂假日、臨時補班）")
    add.add_argument(
        "days", nargs="+", type=_day, metavar="日期", help="YYYY-MM-DD，可以一次給多個"
    )
    kind = add.add_mutually_exclusive_group(required=True)
    kind.add_argument("--off", action="store_true", help="這幾天放假")
    kind.add_argument("--workday", action="store_true", help="這幾天上班（例：臨時補班）")
    add.add_argument("--name", required=True, help="名稱，例：颱風假、公司自訂假日、補班")
    add.add_argument("--note", default="", help="備註")
    add.set_defaults(handler=_add)

    remove = commands.add_parser("remove", help="刪掉例外日")
    remove.add_argument(
        "days", nargs="+", type=_day, metavar="日期", help="YYYY-MM-DD，可以一次給多個"
    )
    remove.set_defaults(handler=_remove)

    list_ = commands.add_parser("list", help="列出管理員的例外日（不含官方假日）")
    list_.add_argument("--year", type=_year, help="只列這一年")
    list_.set_defaults(handler=_list)
    return parser


def _day(text: str) -> date:
    """argparse 的型別：YYYY-MM-DD 轉日期（年份範圍交給 service 檢查，錯誤訊息比較完整）。"""
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"日期要寫成 YYYY-MM-DD（例：2026-09-29），收到 {text!r}"
        ) from None


def _year(text: str) -> int:
    """argparse 的型別：西元四位數、在資料接受的範圍內（0000 之類的會讓日期運算出錯）。"""
    if not (len(text) == 4 and text.isascii() and text.isdigit()):
        raise argparse.ArgumentTypeError(f"年份要是西元四位數（例：2026），收到 {text!r}")
    year = int(text)
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise argparse.ArgumentTypeError(f"年份要在 {MIN_YEAR}–{MAX_YEAR}，收到 {text}")
    return year


def _status(session: Session, args: argparse.Namespace, now: datetime) -> int:
    """逐年列官方資料的來源與匯入時間、例外日筆數；缺今年、或 11 月起缺明年的資料記 warning。"""
    years = covered_years(session)
    problems: list[str] = []
    this_year = today(now).year
    if not years:
        problems.append("還沒有官方日曆資料；下載新北市或人事總處的辦公日曆 CSV，用 import 匯入")
    else:
        logger.info("官方日曆：%s", _describe_coverage(years))
        numbers = {y.calendar_year for y in years}
        if this_year not in numbers:
            problems.append(
                f"今年（{this_year}）的假日資料還沒有，工作天只扣週末；下載 CSV 用 import 匯入"
            )
        if this_year + 1 not in numbers:
            message = f"明年（{this_year + 1}）的假日資料還沒有；公布後下載 CSV 用 import 匯入"
            if today(now).month >= NEXT_YEAR_DUE_MONTH:
                problems.append(message)
            else:
                logger.info(message)
    logger.info("例外日 %d 筆（list 查看）", len(list_overrides(session)))
    for problem in problems:
        logger.warning(problem)
    return CHECK_FAILED if args.check and problems else 0


def _import(session: Session, args: argparse.Namespace, now: datetime) -> int:
    """整年匯入官方日曆 CSV；格式錯或不完整時資料不動。"""
    parsed = import_official_calendar(session, _read_file(args.path), imported_at=now)
    session.commit()
    _log_imported(parsed)
    return 0


def _add(session: Session, args: argparse.Namespace, now: datetime) -> int:
    """新增或修改例外日；每天印出原本的值、官方日曆的值，跟官方相同時提醒「不會改變工期」。

    全部寫入並 commit 之後才印：中途哪一天失敗會整筆 rollback，不能先印「已新增」。
    """
    lines = []
    # 同一天給兩次只處理一次（保持給的順序）
    for day in dict.fromkeys(args.days):
        before = get_override(session, day)
        # 先記下原本的值：set_override 會改同一個物件
        before_text = None if before is None else _state(before.is_workday, before.name)
        override = set_override(
            session, day, is_workday=args.workday, name=args.name, note=args.note
        )
        official = get_official_day(session, day)
        official_is_workday = official.is_workday if official else is_default_workday(day)
        details = [f"官方日曆：{_state(official_is_workday, official.name if official else '')}"]
        if before_text is not None:
            details.insert(0, f"原本：{before_text}")
        verb = "已新增" if before is None else "已修改"
        new_text = _state(override.is_workday, override.name)
        line = f"{verb} {_describe_day(day)}：{new_text}（{'；'.join(details)}）"
        if override.is_workday == official_is_workday:
            line += "。跟官方日曆相同，不會改變工期"
        lines.append(line)
    session.commit()
    for line in lines:
        logger.info(line)
    return 0


def _remove(session: Session, args: argparse.Namespace, now: datetime) -> int:
    """刪掉例外日；任何一天沒有例外日就整筆不刪。同一天給兩次只刪一次。"""
    days = list(dict.fromkeys(args.days))
    for day in days:
        remove_override(session, day)
    session.commit()
    for day in days:
        logger.info("已刪除 %s 的例外日", _describe_day(day))
    return 0


def _list(session: Session, args: argparse.Namespace, now: datetime) -> int:
    """列出例外日（不含官方假日），可以只看某一年。"""
    overrides = list_overrides(session, year=args.year)
    if not overrides:
        logger.info("沒有例外日")
    for o in overrides:
        note = f"（備註：{o.note}）" if o.note else ""
        logger.info("%s %s%s", _describe_day(o.day_on), _state(o.is_workday, o.name), note)
    return 0


def _read_file(path: Path) -> bytes:
    """讀整個檔案；找不到、被占用、其他讀取錯誤都轉成 `InvalidInput`（附下一步）。"""
    try:
        return path.read_bytes()
    except FileNotFoundError:
        raise InvalidInput(
            f"找不到檔案 {path}（相對路徑以目前資料夾 {Path.cwd()} 為準；建議用完整路徑）"
        ) from None
    except PermissionError:
        raise InvalidInput(f"讀不到 {path}：檔案可能正被 Excel 開著，關掉後再試") from None
    except OSError as exc:
        raise InvalidInput(f"讀不到 {path}：{exc}") from None


def _describe_coverage(years: list[CalendarOfficialYear]) -> str:
    """把連續、同一次匯入的年份合併：2018–2026 新北市（2026-10-02 09:00 匯入）；2027 人事總處（…）。"""
    groups: list[list[CalendarOfficialYear]] = []
    for year in years:
        last = groups[-1][-1] if groups else None
        if (
            last is not None
            and year.calendar_year == last.calendar_year + 1
            and (year.source, year.imported_at) == (last.source, last.imported_at)
        ):
            groups[-1].append(year)
        else:
            groups.append([year])
    return "；".join(_describe_group(group) for group in groups)


def _describe_group(group: list[CalendarOfficialYear]) -> str:
    """一組連續年份：2018–2026 新北市（2026-10-02 09:00 匯入）。"""
    first, last = group[0].calendar_year, group[-1].calendar_year
    span = str(first) if first == last else f"{first}–{last}"
    # 資料庫的 CHECK 保證 source 一定是已知來源；.get 的預設值只是保險
    label = SOURCE_LABELS.get(group[0].source, group[0].source)
    return f"{span} {label}（{_local(group[0].imported_at)} 匯入）"


def _describe_day(day: date) -> str:
    return f"{day.isoformat()}（{WEEKDAYS[day.weekday()]}）"


def _state(is_workday: bool, name: str) -> str:
    return ("上班" if is_workday else "放假") + (f" {name}" if name else "")


def _local(moment: datetime) -> str:
    return moment.astimezone(local_zone()).strftime("%Y-%m-%d %H:%M")


def _log_imported(parsed: ParsedCalendar) -> None:
    """匯入結果：年份、來源、特殊日數量、編碼（Big5 時才提）、略過的特定節日。"""
    logger.info(
        "已匯入 %s 年（%s），%d 個特殊日",
        describe_years(parsed.years),
        SOURCE_LABELS[parsed.source],
        len(parsed.days),
    )
    if parsed.encoding != "utf-8":
        logger.info("檔案以 Big5（cp950）讀取")
    for line in describe_skipped(parsed):
        logger.info(line)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    sys.exit(main())
