"""驗證腳本共用工具。

這批腳本原本各自在 8000 埠起一個靜態服務，且埠被佔用時會靜默沿用既有服務，
因此可能驗證到別的（或舊的）建置。這裡改為綁定作業系統指派的隨機埠，
網址由實際埠組出，結束時確實關閉。

執行方式：python tools/verify/<script>.py
"""

from __future__ import annotations

import contextlib
import functools
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
APP_HTML = FRONTEND / "voices-of-the-north-app.html"
# 隱藏式 GPU 在無顯示環境仍可畫 WebGL 地圖；停用自動播放手勢限制以便測試音檔。
BROWSER_ARGS = [
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
]


class _QuietHandler(SimpleHTTPRequestHandler):
    """不把每個請求寫進 stderr，讓腳本輸出只剩檢查結果。"""

    def log_message(self, fmt, *args):  # noqa: A002 - 標準庫簽名
        pass


@contextlib.contextmanager
def frontend_server():
    """在隨機埠上服務 frontend/，yield 單檔前端的完整網址。"""
    handler = functools.partial(_QuietHandler, directory=str(FRONTEND))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = httpd.server_address[:2]
        yield f"http://{host}:{port}/voices-of-the-north-app.html"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def launch_browser(playwright, **overrides):
    """優先用 Playwright 內建 Chromium，未安裝時退回本機 Chrome。"""
    options = {"headless": True, "args": list(BROWSER_ARGS)}
    options.update(overrides)
    try:
        return playwright.chromium.launch(**options)
    except Exception:
        options["channel"] = "chrome"
        return playwright.chromium.launch(**options)


def warn_if_stale() -> None:
    """單檔前端比來源舊時提示先重建，避免驗證到過期版本。"""
    if not APP_HTML.exists():
        raise SystemExit(f"缺少 {APP_HTML}，請先執行 python tools/build_frontend.py")
    sources = [p for p in (FRONTEND / "src").rglob("*") if p.is_file()]
    sources.append(ROOT / "data" / "stories.json")
    newest = max((p.stat().st_mtime for p in sources if p.exists()), default=0)
    if APP_HTML.stat().st_mtime < newest:
        print("  WARN  single-file build is older than its sources; run python tools/build_frontend.py first")
