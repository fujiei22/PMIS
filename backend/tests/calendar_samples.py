"""工作日曆測試共用的 CSV。

- NTPC_SAMPLE、DGPA_SAMPLE：逐列取自 2026-10-02 實際下載的兩份檔案（只挑測得到規則的列），
  跟原檔一樣是 UTF-8 BOM、LF。**不完整**（不是整年），拿來測解析規則與完整性檢查。
- ntpc_full_year()、dgpa_full_year()：合成的完整一年，通過完整性檢查，給同步與匯入的測試用。
  真實的新北市檔每年正是「每個週六日一列＋1/1」的結構（2018–2027 逐年驗過）。

星期：2023-09-23 六、2026-05-01 五、2026-09-03 四、2026-09-25 五、2026-09-29 二、2026-10-03 六、
2026-10-09 五、2026-10-10 六、2026-12-26 六、2027-01-01 五、2027-01-02 六、2027-01-04 一、
2027-09-03 五、2027-09-28 二。
"""

from collections.abc import Mapping, Sequence
from datetime import date, timedelta

NTPC_HEADER_LINE = "date,year,name,isholiday,holidaycategory,description"
DGPA_HEADER_LINE = "西元日期,星期,是否放假,備註"
WEEKDAY_NAMES = "一二三四五六日"

NTPC_SAMPLE = (
    f"\ufeff{NTPC_HEADER_LINE}\n"
    "20230923,2023,,否,補行上班日,\n"
    "20260501,2026,勞動節,是,特定節日,全國各機關學校及勞工放假一日。\n"
    "20260903,2026,軍人節,是,特定節日,軍人依國防部規定辦理。\n"
    "20260925,2026,中秋節,是,放假之紀念日及節日,全國各機關學校放假一日。\n"
    "20261003,2026,,是,星期六、星期日,\n"
    "20261009,2026,,是,補假,\n"
    "20261010,2026,國慶日,是,放假之紀念日及節日,10/10（六）國慶日逢例假日，於10/9（五）補假一日\n"
).encode()

DGPA_SAMPLE = (
    f"\ufeff{DGPA_HEADER_LINE}\n"
    "20270101,五,2,開國紀念日\n"
    "20270102,六,2,\n"
    "20270104,一,0,\n"
    "20270903,五,0,\n"
    "20270928,二,2,孔子誕辰紀念日/教師節\n"
).encode()

# NTPC_SAMPLE 裡 2026 年的那幾列，疊在合成的整年檔上
NTPC_2026_ROWS = (
    "20260501,2026,勞動節,是,特定節日,全國各機關學校及勞工放假一日。",
    "20260903,2026,軍人節,是,特定節日,軍人依國防部規定辦理。",
    "20260925,2026,中秋節,是,放假之紀念日及節日,全國各機關學校放假一日。",
    "20261003,2026,,是,星期六、星期日,",
    "20261009,2026,,是,補假,",
    "20261010,2026,國慶日,是,放假之紀念日及節日,10/10（六）國慶日逢例假日，於10/9（五）補假一日",
)


def ntpc_full_year(year: int, rows: Sequence[str] = ()) -> bytes:
    """新北市格式的完整一年：每個週六日一列、1/1 開國紀念日，再疊上 rows（同一天以 rows 為準）。"""
    lines: dict[str, str] = {}
    day = date(year, 1, 1)
    while day.year == year:
        if day.isoweekday() in (6, 7):
            key = f"{day:%Y%m%d}"
            lines[key] = f"{key},{year},,是,星期六、星期日,"
        day += timedelta(days=1)
    jan1 = f"{year}0101"
    lines[jan1] = f"{jan1},{year},中華民國開國紀念日,是,放假之紀念日及節日,全國各機關學校放假一日。"
    for row in rows:
        lines[row.split(",", 1)[0]] = row
    body = "\n".join(lines[key] for key in sorted(lines))
    return f"\ufeff{NTPC_HEADER_LINE}\n{body}\n".encode()


def dgpa_full_year(year: int, changes: Mapping[date, tuple[str, str]] | None = None) -> bytes:
    """人事總處格式的完整一年：每天一列，週六日放假、其他上班，再套上 changes（日期 →（是否放假, 備註））。"""
    changes = changes or {}
    lines = []
    day = date(year, 1, 1)
    while day.year == year:
        flag, remark = changes.get(day, ("2" if day.isoweekday() in (6, 7) else "0", ""))
        lines.append(f"{day:%Y%m%d},{WEEKDAY_NAMES[day.weekday()]},{flag},{remark}")
        day += timedelta(days=1)
    return (f"\ufeff{DGPA_HEADER_LINE}\n" + "\n".join(lines) + "\n").encode()
