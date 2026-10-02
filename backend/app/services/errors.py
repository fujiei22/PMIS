"""service 層的例外。

service 不 import FastAPI：丟這裡的例外，由 `app/api/errors.py` 的 exception handler
轉成 HTTP 回應（之後的 PR 建）。
"""


class ServiceError(Exception):
    """service 層例外的基底。"""


class NotFound(ServiceError):
    """找不到、id 格式不對，或已經在回收桶裡 → 404。"""


class InvalidInput(ServiceError):
    """輸入不合法（例：例外日名稱空白、年份超出範圍）→ 422。"""
