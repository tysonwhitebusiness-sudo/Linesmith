"""No ESPN scoreboard call may ask for more than 500 events.

Above roughly 500, ESPN silently falls back to its default page of 25 and
answers 200. Measured 2026-09-19 on a real CFB Saturday: `limit=500` returned
71 games, `limit=900` returned 25. With date RANGES the old `limit=1000` was
honoured, so moving to one date per request (8dab195) quietly cut CFB discovery
and grading to 25 games a day until `f2232c7` set 500.

This guard scans the source rather than the network: any line that passes both
`dates` and `limit` to ESPN must keep the limit at or below 500. A line that
genuinely needs more carries `# espn-limit-ok` with its reason.

Run with:  .venv/Scripts/python.exe src/test_espn_limit_guard.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX = 500
LIMIT_RE = re.compile(r"""limit["']?\s*[:=]\s*["']?(\d+)""")

failures: list[str] = []
checked = 0

SKIP = {".venv", "__pycache__", "corpus", "dead_tables_backup", "golf_model_layer_backup_20260913"}
paths = sorted(ROOT.glob("*.py")) + sorted((ROOT / "src").rglob("*.py"))
for path in paths:
    if SKIP & set(path.parts) or path.name == Path(__file__).name:
        continue
    for n, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
        if "dates" not in line or "limit" not in line:
            continue
        checked += 1
        if "espn-limit-ok" in line:
            continue
        m = LIMIT_RE.search(line)
        if m and int(m.group(1)) > MAX:
            failures.append(f"{path.relative_to(ROOT)}:{n} asks ESPN for limit={m.group(1)}\n      {line.strip()}")

print(f"checked {checked} ESPN scoreboard call site(s) with a dates+limit pair")
if failures:
    for f in failures:
        print("FAIL:", f)
    sys.exit(1)
print(f"all within limit {MAX}")
