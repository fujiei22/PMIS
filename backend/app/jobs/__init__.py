"""背景排程工作（每月同步假日表…）。不 import FastAPI（tests/test_source_rules.py 守）。

程式啟動時由 `app/lifespan.py` 呼叫 `app.jobs.startup.start_background_jobs()` 開始。
新增一個工作：寫一個符合 `app.jobs.scheduler.Job` 的類別，加進 `startup.default_jobs()`。
"""
