"""從網路抓官方辦公日曆 CSV（每月自動同步與 `holidays sync` 指令用）。

用標準函式庫的 urllib，不加相依套件；會自動套用 HTTPS_PROXY / NO_PROXY 環境變數，
公司網路要走 proxy 時設環境變數就好。公司網路有 SSL 檢查（自簽根憑證）時，
設 SSL_CERT_FILE 指向公司根憑證。
"""

import ssl
from http.client import HTTPException
from urllib.request import Request, urlopen

# 單次讀取的逾時（不是整次下載的總時間）
TIMEOUT_SECONDS = 30
# 新北市的檔案（2018–2027）約 60 KB；上限放寬到 5 MB，來源出錯時也不會把記憶體吃掉
MAX_BYTES = 5 * 1024 * 1024
USER_AGENT = "PMIS-holiday-sync/1.0"


class FetchError(Exception):
    """抓不到：網址或轉址不是 https、連不上、HTTP 錯誤、逾時、回應太大或不完整。"""


def ssl_context() -> ssl.SSLContext:
    """抓辦公日曆用的 TLS 設定：照常驗證憑證鏈與主機名稱，只關掉 X.509 嚴格模式。

    Python 3.13 起預設開 VERIFY_X509_STRICT（照 RFC 5280 逐欄檢查憑證格式）。新北市網站的憑證
    由 TWCA 簽發，鏈上有憑證缺少 Subject Key Identifier，嚴格模式下一定 CERTIFICATE_VERIFY_FAILED
    （2026-10-02 實機驗證：嚴格模式失敗，只關這一項就 HTTP 200）。關掉的只是格式檢查：
    憑證要由信任的根憑證簽發、主機名稱要相符，這兩項照樣驗。
    """
    context = ssl.create_default_context()
    context.verify_flags &= ~ssl.VERIFY_X509_STRICT
    return context


def fetch_calendar_csv(
    url: str, *, timeout: float = TIMEOUT_SECONDS, max_bytes: int = MAX_BYTES
) -> bytes:
    """抓 `url` 的內容；任何失敗都丟 `FetchError`。"""
    if not url.startswith("https://"):
        raise FetchError(f"只接受 https 網址：{url}")
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout, context=ssl_context()) as response:
            final_url: str = response.geturl()
            # 多讀一個 byte：讀得到就代表超過上限
            body: bytes = response.read(max_bytes + 1)
            declared = response.headers.get("Content-Length")
    # URLError、HTTPError、TimeoutError 是 OSError；IncompleteRead、InvalidURL 是 HTTPException；
    # 網址格式錯是 ValueError
    except (OSError, HTTPException, ValueError) as exc:
        raise FetchError(f"抓不到 {url}：{exc}") from exc
    if not final_url.startswith("https://"):
        raise FetchError(f"{url} 被轉址到非 https 的 {final_url}，拒收")
    if len(body) > max_bytes:
        raise FetchError(f"{url} 的回應超過 {max_bytes} bytes，拒收")
    # read(amt) 遇到連線提早斷掉只會回傳比較短的內容、不丟例外（CPython http.client 的行為），
    # 所以有 Content-Length 就自己比對
    if declared is not None and declared.isdigit() and int(declared) != len(body):
        raise FetchError(f"{url} 下載不完整：只收到 {len(body)} / {declared} bytes")
    return body
