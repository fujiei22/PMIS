"""匯入外部資料（辦公日曆 CSV…）：解析與檢查的純函式，不碰資料庫、不 import FastAPI。

寫入資料庫交給 `app/services/`；不 import FastAPI 由 tests/test_source_rules.py 守。
"""
