"""app.* 的 log 輸出設定。

uvicorn／fastapi dev 只設定自己的 logger（uvicorn.*），不設 root：不設定的話，app.* 的 INFO
（例如「假日表已同步」）會被丟掉，WARNING 只印訊息本體、沒有時間與等級。
"""

import logging

FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def setup_app_logging() -> None:
    """讓 app.* 的 INFO 以上印出來。lifespan 開頭呼叫；重複呼叫不會重複加 handler。

    已經有人設定輸出（pytest、部署時的 --log-config 給 root 掛了 handler）就只放行 INFO，
    交給既有的 handler；不動 root，uvicorn 的訊息才不會印兩次。
    """
    app_logger = logging.getLogger("app")
    app_logger.setLevel(logging.INFO)
    if app_logger.handlers or logging.getLogger().handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(FORMAT))
    app_logger.addHandler(handler)
