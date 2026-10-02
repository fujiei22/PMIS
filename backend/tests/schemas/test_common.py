"""`CamelModel`：Python 寫 snake_case，wire 上是 camelCase。"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ConfigDict, ValidationError

from app.schemas.common import CamelModel


class Sample(CamelModel):
    pm_id: str
    can_edit: bool = False


class SampleRequest(CamelModel):
    model_config = ConfigDict(extra="forbid")

    pm_id: str


def test_dumps_camel_case_by_alias() -> None:
    assert Sample(pm_id="m1").model_dump(by_alias=True) == {"pmId": "m1", "canEdit": False}


def test_accepts_camel_and_snake_case() -> None:
    assert Sample.model_validate({"pmId": "m1"}).pm_id == "m1"
    assert Sample.model_validate({"pm_id": "m1"}).pm_id == "m1"


def test_json_schema_uses_camel_case() -> None:
    assert set(Sample.model_json_schema()["properties"]) == {"pmId", "canEdit"}


def test_request_model_keeps_camel_case_and_forbids_extra_fields() -> None:
    # 子類別的 model_config 跟 CamelModel 的合併，不會蓋掉別名設定。
    assert SampleRequest.model_validate({"pmId": "m1"}).pm_id == "m1"
    with pytest.raises(ValidationError):
        SampleRequest.model_validate({"pmId": "m1", "__proto__": {}})


def test_fastapi_response_and_openapi_use_camel_case() -> None:
    demo = FastAPI(separate_input_output_schemas=False)

    @demo.get("/sample")
    def sample() -> Sample:
        return Sample(pm_id="m1", can_edit=True)

    with TestClient(demo) as client:
        assert client.get("/sample").json() == {"pmId": "m1", "canEdit": True}
        schema = client.get("/openapi.json").json()["components"]["schemas"]["Sample"]
    assert set(schema["properties"]) == {"pmId", "canEdit"}
