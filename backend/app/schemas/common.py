"""wire 格式的共用基底。

前端的欄位名稱是 camelCase（`pmId`、`canEdit`），Python 照慣例寫 snake_case（`pm_id`、`can_edit`）。
API 的 request / response model 一律繼承 `CamelModel`，兩種寫法由 Pydantic 自動對應：

- 回應的 JSON 與 OpenAPI 文件用 camelCase（FastAPI 輸出回應時用別名），前端型別因此也是 camelCase。
- 收請求時 camelCase 與 snake_case 都收；Python 程式裡建 model 用 snake_case。

請求用的 model 另外加 `extra="forbid"`：多送的欄位（`id`、`created`、`__proto__`…）直接 422，
這就是 PATCH 的欄位白名單（frontend/README.md〈還沒做的〉的 mass-assignment）。設定會跟基底合併：

    class TaskPatch(CamelModel):
        model_config = ConfigDict(extra="forbid")

        name: str | None = None
        group_id: str | None = None  # wire 上是 groupId
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        # 這兩個一起開，等於 Pydantic 2.11 以前的 populate_by_name=True（新版建議改用這兩個）。
        validate_by_name=True,
        validate_by_alias=True,
    )
