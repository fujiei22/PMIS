"""辦公日曆 CSV 的解析規則與完整性檢查。

測案依據 2026-10-02 抽樣兩份真實檔案的結果：
- 軍人節在新北市檔案標「放假」，但只限軍人（人事總處同一天是上班日）→ 不算假日，記在 skipped。
- 勞動節（說明含「勞工」）算假日。
- 補假列沒有名稱 → 用類別名稱「補假」；「放假之紀念日及節日」沒有名稱 →「國定假日」；
  補班日 → 上班日。
- 人事總處沒有備註的非預設日補「放假」或「補行上班日」。
- 普通週末、普通平日不存（預設規則就是這樣）。
- 格式錯一律整份拒絕，訊息帶行號；UTF-8 解不開改用 Big5（Excel 存檔的預設）。
  csv 模組自己丟的錯（引號沒關造成欄位過長）也轉成格式錯誤，不讓 traceback 漏出去。
- 完整性：檔案不是整年時（被截斷、管理員自製的幾列）不能匯入，否則那年其他假日會被整年替換掉。
"""

from datetime import date

import pytest

from app.imports.holiday_csv import (
    CalendarFormatError,
    OfficialDay,
    describe_skipped,
    describe_years,
    ensure_complete,
    parse_calendar_csv,
)
from tests.calendar_samples import (
    DGPA_HEADER_LINE,
    DGPA_SAMPLE,
    NTPC_2026_ROWS,
    NTPC_HEADER_LINE,
    NTPC_SAMPLE,
    dgpa_full_year,
    ntpc_full_year,
)

NTPC = f"\ufeff{NTPC_HEADER_LINE}\n"
DGPA = f"\ufeff{DGPA_HEADER_LINE}\n"


def test_parses_ntpc_sample() -> None:
    parsed = parse_calendar_csv(NTPC_SAMPLE)

    assert parsed.source == "ntpc"
    assert parsed.encoding == "utf-8"
    assert parsed.years == frozenset({2023, 2026})
    assert parsed.days == (
        OfficialDay(day=date(2023, 9, 23), is_workday=True, name="補行上班日"),
        OfficialDay(day=date(2026, 5, 1), is_workday=False, name="勞動節"),
        OfficialDay(day=date(2026, 9, 25), is_workday=False, name="中秋節"),
        OfficialDay(day=date(2026, 10, 9), is_workday=False, name="補假"),
        OfficialDay(day=date(2026, 10, 10), is_workday=False, name="國慶日"),
    )
    assert parsed.skipped == (OfficialDay(day=date(2026, 9, 3), is_workday=False, name="軍人節"),)


def test_unnamed_memorial_day_is_named_generically() -> None:
    raw = (NTPC + "20250928,2025,,是,放假之紀念日及節日,\n").encode()
    assert parse_calendar_csv(raw).days == (
        OfficialDay(day=date(2025, 9, 28), is_workday=False, name="國定假日"),
    )


def test_parses_dgpa_sample() -> None:
    parsed = parse_calendar_csv(DGPA_SAMPLE)

    assert parsed.source == "dgpa"
    assert parsed.years == frozenset({2027})
    assert parsed.days == (
        OfficialDay(day=date(2027, 1, 1), is_workday=False, name="開國紀念日"),
        OfficialDay(day=date(2027, 9, 28), is_workday=False, name="孔子誕辰紀念日/教師節"),
    )
    assert parsed.skipped == ()


def test_dgpa_unnamed_exceptions_get_names() -> None:
    raw = (DGPA + "20270104,一,2,\n20270102,六,0,\n").encode()
    assert parse_calendar_csv(raw).days == (
        OfficialDay(day=date(2027, 1, 2), is_workday=True, name="補行上班日"),
        OfficialDay(day=date(2027, 1, 4), is_workday=False, name="放假"),
    )


def test_days_are_sorted_even_if_file_is_not() -> None:
    raw = (
        NTPC
        + "20260925,2026,中秋節,是,放假之紀念日及節日,\n"
        + "20260501,2026,勞動節,是,特定節日,勞工放假一日。\n"
    ).encode()
    assert [d.day for d in parse_calendar_csv(raw).days] == [date(2026, 5, 1), date(2026, 9, 25)]


def test_works_without_bom() -> None:
    assert parse_calendar_csv(NTPC_SAMPLE.removeprefix("\ufeff".encode())).source == "ntpc"


def test_reads_big5_saved_by_excel() -> None:
    raw = (DGPA_HEADER_LINE + "\n20270101,五,2,開國紀念日\n").encode("cp950")

    parsed = parse_calendar_csv(raw)

    assert parsed.encoding == "cp950"
    assert parsed.days[0].name == "開國紀念日"


def test_blank_lines_are_ignored() -> None:
    raw = (NTPC + "\n20260925,2026,中秋節,是,放假之紀念日及節日,\n\n").encode()
    assert len(parse_calendar_csv(raw).days) == 1


@pytest.mark.parametrize(
    ("raw", "message"),
    [
        (b"", "空的"),
        (NTPC.encode(), "沒有任何日期"),
        ("西元日期,是否放假\n20270101,2\n".encode(), "第 1 行：認不得的表頭"),
        ((NTPC + "20260925,2026,中秋節,是,放假之紀念日及節日\n").encode(), "第 2 行：欄位數 5"),
        ((NTPC + "20260925,2026,中秋節,放,放假之紀念日及節日,\n").encode(), "第 2 行：isholiday"),
        ((NTPC + "20260230,2026,,是,補假,\n").encode(), "第 2 行：日期 20260230 不存在"),
        (
            (NTPC + "2026-09-25,2026,中秋節,是,放假之紀念日及節日,\n").encode(),
            "第 2 行：日期 '2026-09-25' 不是 YYYYMMDD",
        ),
        (
            (NTPC + "20260925,2025,中秋節,是,放假之紀念日及節日,\n").encode(),
            "第 2 行：year 欄 2025",
        ),
        ((NTPC + "19990101,1999,元旦,是,放假之紀念日及節日,\n").encode(), "第 2 行：年份 1999"),
        (
            (NTPC + "20260925,2026,中秋節,是,放假之紀念日及節日,\n" * 2).encode(),
            "第 3 行：日期 2026-09-25 重複",
        ),
        ((DGPA + "20270101,五,1,開國紀念日\n").encode(), "第 2 行：是否放假"),
        (
            (NTPC + "20260925,2026," + "長" * 101 + ",是,放假之紀念日及節日,\n").encode(),
            "第 2 行：名稱超過 100 字",
        ),
        (b"\xff\xfe\xff", "不是 UTF-8"),
    ],
)
def test_rejects_bad_files(raw: bytes, message: str) -> None:
    with pytest.raises(CalendarFormatError, match=message):
        parse_calendar_csv(raw)


def test_unknown_header_message_lists_both_formats() -> None:
    with pytest.raises(CalendarFormatError) as caught:
        parse_calendar_csv(b"Subject,Start Date,All Day Event\n")
    message = str(caught.value)
    assert NTPC_HEADER_LINE in message
    assert DGPA_HEADER_LINE in message
    assert "Google 行事曆專用" in message


def test_full_years_are_complete() -> None:
    ensure_complete(parse_calendar_csv(ntpc_full_year(2026, NTPC_2026_ROWS)))
    ensure_complete(parse_calendar_csv(dgpa_full_year(2027)))
    ensure_complete(parse_calendar_csv(dgpa_full_year(2028)))  # 閏年 366 天


def test_partial_files_are_incomplete() -> None:
    with pytest.raises(CalendarFormatError) as caught:
        ensure_complete(parse_calendar_csv(NTPC_SAMPLE))
    message = str(caught.value)
    assert "2023 年" in message
    assert "2026 年" in message
    assert "holidays add" in message


def test_truncated_year_is_incomplete() -> None:
    """抓檔被截斷：年底那幾週不見了。"""
    lines = ntpc_full_year(2026).decode("utf-8-sig").splitlines()
    truncated = "\n".join(line for line in lines if not line.startswith("202612")) + "\n"

    parsed = parse_calendar_csv(truncated.encode())

    assert [g.year for g in parsed.incomplete] == [2026]
    assert "週六日" in parsed.incomplete[0].reason


def test_year_without_new_year_day_is_incomplete() -> None:
    """只有週末、還沒有假日的年份（上游只先放出週末）不算完整。"""
    lines = ntpc_full_year(2026).decode("utf-8-sig").splitlines()
    without_jan1 = "\n".join(line for line in lines if not line.startswith("20260101")) + "\n"

    assert "1/1" in parse_calendar_csv(without_jan1.encode()).incomplete[0].reason


def test_dgpa_missing_days_is_incomplete() -> None:
    assert "只有 5 天" in parse_calendar_csv(DGPA_SAMPLE).incomplete[0].reason


def test_describe_years() -> None:
    assert describe_years([2018, 2019, 2020]) == "2018–2020"
    assert describe_years([2026, 2027]) == "2026、2027"
    assert describe_years([2023, 2026]) == "2023、2026"


def test_describe_skipped() -> None:
    assert describe_skipped(parse_calendar_csv(NTPC_SAMPLE)) == [
        "略過 2026-09-03 軍人節：特定節日，說明沒有「勞工」，一般公司照常上班"
    ]


def test_broken_quoting_is_format_error() -> None:
    """引號沒關：後面整份被當成同一個欄位，超過 csv 的欄位長度上限（csv.Error）。"""
    raw = (NTPC + '20260101,2026,"開國紀念日' + "x" * 200_000).encode()

    with pytest.raises(CalendarFormatError, match="CSV 格式錯誤"):
        parse_calendar_csv(raw)
