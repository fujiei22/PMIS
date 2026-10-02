"""從網路抓官方辦公日曆 CSV（每月自動同步與 `holidays sync` 指令用）。

用標準函式庫的 urllib，不加相依套件；會自動套用 HTTPS_PROXY / NO_PROXY 環境變數，
公司網路要走 proxy 時設環境變數就好。公司網路有 SSL 檢查（自簽根憑證）時，
設 SSL_CERT_FILE 指向公司根憑證。
"""

from http.client import HTTPException
from urllib.request import Request, urlopen

# 單次讀取的逾時（不是整次下載的總時間）
TIMEOUT_SECONDS = 30
# 新北市的檔案（2018–2027）約 60 KB；上限放寬到 5 MB，來源出錯時也不會把記憶體吃掉
MAX_BYTES = 5 * 1024 * 1024
USER_AGENT = "PMIS-holiday-sync/1.0"


class FetchError(Exception):
    """抓不到：網址或轉址不是 https、連不上、HTTP 錯誤、逾時、回應太大或不完整。"""


def fetch_calendar_csv(
    url: str, *, timeout: float = TIMEOUT_SECONDS, max_bytes: int = MAX_BYTES
) -> bytes:
    """抓 `url` 的內容；任何失敗都丟 `FetchError`。"""
    if not url.startswith("https://"):
        raise FetchError(f"只接受 https 網址：{url}")
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout) as response:
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
