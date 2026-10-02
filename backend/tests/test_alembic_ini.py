from pathlib import Path

ALEMBIC_INI = Path(__file__).resolve().parents[1] / "alembic.ini"


def test_alembic_ini_is_ascii_only() -> None:
    """alembic 用系統編碼讀 alembic.ini，Windows（cp950）遇到中文會讀檔失敗。"""
    bad_lines = [
        number
        for number, line in enumerate(ALEMBIC_INI.read_bytes().splitlines(), start=1)
        if not line.isascii()
    ]
    assert not bad_lines, (
        f"alembic.ini 第 {bad_lines} 行有非 ASCII 字元（例如中文註解）。"
        "alembic 用系統編碼讀這個檔，Windows 上會讀檔失敗；請改用英文。"
    )
