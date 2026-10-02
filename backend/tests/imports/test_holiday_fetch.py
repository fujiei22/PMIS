"""抓辦公日曆 CSV。

測案：
- 正常回傳內容，帶逾時與 User-Agent（有些政府網站擋沒有 User-Agent 的請求）。
- 只接受 https：連線前就擋；被轉址到 http 也拒收（內容會直接落進資料庫）。
- 連不上、HTTP 錯誤、逾時、http.client 的協定錯誤、網址格式錯，一律轉成 FetchError
  （呼叫端只接一種例外，記 warning 後保留舊資料、約 24 小時後再試）。
- 回應超過上限、跟 Content-Length 對不上（被截斷）都拒收。
- TLS：憑證鏈與主機名稱照常驗，只關掉 Python 3.13 起預設的 X.509 嚴格模式
  （新北市網站的 TWCA 憑證鏈缺 Subject Key Identifier，嚴格模式下一定失敗；2026-10-02 實機驗證發現）。
- 測試環境的 autouse fixture 擋住真的連線。
"""

import ssl
from http.client import IncompleteRead, InvalidURL
from types import TracebackType
from urllib.error import HTTPError, URLError
from urllib.request import Request

import pytest

from app.imports import holiday_fetch
from app.imports.holiday_fetch import FetchError, fetch_calendar_csv

URL = "https://data.ntpc.gov.tw/calendar.csv"


class FakeResponse:
    def __init__(self, body: bytes, *, url: str = URL, content_length: str | None = None) -> None:
        self._body = body
        self._url = url
        self.headers = {} if content_length is None else {"Content-Length": content_length}

    def read(self, amount: int = -1) -> bytes:
        return self._body if amount < 0 else self._body[:amount]

    def geturl(self) -> str:
        return self._url

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        return None


def serve(monkeypatch: pytest.MonkeyPatch, response: FakeResponse) -> None:
    monkeypatch.setattr(holiday_fetch, "urlopen", lambda request, timeout, context: response)


def test_returns_body(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def fake_urlopen(request: Request, timeout: float, context: ssl.SSLContext) -> FakeResponse:
        seen["url"] = request.full_url
        seen["agent"] = request.get_header("User-agent")
        seen["timeout"] = timeout
        seen["strict"] = bool(context.verify_flags & ssl.VERIFY_X509_STRICT)
        return FakeResponse(b"date,year\n", content_length="10")

    monkeypatch.setattr(holiday_fetch, "urlopen", fake_urlopen)

    assert fetch_calendar_csv(URL) == b"date,year\n"
    assert seen == {"url": URL, "agent": holiday_fetch.USER_AGENT, "timeout": 30, "strict": False}


def test_tls_still_verifies_chain_and_hostname() -> None:
    """只關 X.509 嚴格模式：憑證要由信任的根憑證簽發、主機名稱要相符，這兩項不能跟著關掉。"""
    context = holiday_fetch.ssl_context()

    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True
    assert not context.verify_flags & ssl.VERIFY_X509_STRICT


def test_rejects_plain_http_before_connecting() -> None:
    # 沒有 monkeypatch：真的連線會被 conftest 的 autouse fixture 擋成 AssertionError
    with pytest.raises(FetchError, match="https"):
        fetch_calendar_csv("http://data.ntpc.gov.tw/calendar.csv")


def test_rejects_redirect_to_http(monkeypatch: pytest.MonkeyPatch) -> None:
    serve(monkeypatch, FakeResponse(b"x", url="http://mirror.example/calendar.csv"))

    with pytest.raises(FetchError, match="轉址"):
        fetch_calendar_csv(URL)


@pytest.mark.parametrize(
    "error",
    [
        URLError("name resolution failed"),
        HTTPError(URL, 503, "Service Unavailable", None, None),  # type: ignore[arg-type]
        TimeoutError("timed out"),
        IncompleteRead(b"partial"),
        InvalidURL("bad url"),
        ValueError("unknown url type"),
    ],
)
def test_errors_become_fetch_error(monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    def failing(request: Request, timeout: float, context: ssl.SSLContext) -> FakeResponse:
        raise error

    monkeypatch.setattr(holiday_fetch, "urlopen", failing)

    with pytest.raises(FetchError, match="抓不到"):
        fetch_calendar_csv(URL)


def test_rejects_oversized_response(monkeypatch: pytest.MonkeyPatch) -> None:
    serve(monkeypatch, FakeResponse(b"x" * 11))

    with pytest.raises(FetchError, match="超過 10 bytes"):
        fetch_calendar_csv(URL, max_bytes=10)


def test_rejects_truncated_response(monkeypatch: pytest.MonkeyPatch) -> None:
    serve(monkeypatch, FakeResponse(b"date,ye", content_length="10"))

    with pytest.raises(FetchError, match="不完整"):
        fetch_calendar_csv(URL)


def test_tests_cannot_reach_network() -> None:
    """沒 monkeypatch 的抓檔會走到真的連線，被 conftest 的 autouse fixture 擋下（不是 FetchError）。"""
    with pytest.raises(AssertionError, match="測試不准連外網"):
        fetch_calendar_csv(URL)
