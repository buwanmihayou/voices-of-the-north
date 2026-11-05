"""檢查單檔前端 HTML 內每個內嵌 <script> 區塊的 JavaScript 語法。

執行：python tools/check_frontend_syntax.py
依賴：python -m pip install esprima

esprima 4 只支援到 ES2017，專案既有程式碼含 ES2018 物件展開（...rec），
故解析前把這類展開暫換成合法佔位字串；置換只作用於記憶體中的副本，
不會改動 HTML 檔案。這能抓出括號、字串、逗號等真正的語法錯誤。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import esprima

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_HTML = ROOT / "frontend" / "voices-of-the-north-app.html"


def check(path: Path) -> int:
    html = path.read_text(encoding="utf-8")
    blocks = re.findall(r"(?is)<script([^>]*)>(.*?)</script>", html)
    checked = 0
    failed = 0
    for index, (attrs, src) in enumerate(blocks, 1):
        if re.search(r"\bsrc\s*=", attrs) or not src.strip():
            continue
        # 僅為 esprima 相容性置換物件展開；不影響其他語法檢查
        normalized = re.sub(
            r"\.\.\.([A-Za-z_$][\w$]*)\s*,", "__spread_placeholder: 0,", src
        )
        checked += 1
        try:
            esprima.parseScript(normalized)
            print(f"  OK   script #{index}  ({len(src):,} chars)")
        except Exception as exc:
            failed += 1
            print(f"  FAIL script #{index}: {exc}")
            match = re.search(r"Line (\d+)", str(exc))
            if match:
                line_no = int(match.group(1))
                lines = normalized.splitlines()
                for j in range(max(0, line_no - 3), min(len(lines), line_no + 2)):
                    print(f"       {j + 1}: {lines[j][:160]}")
    print(f"\n{checked - failed}/{checked} script blocks parsed; source: {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_HTML
    sys.exit(check(target))
