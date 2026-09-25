"""P5 (A1/A2) — hermetic: no database, no network. Run: python -u src/test_price_history.py

1. `line_survives` accepts exactly what a `real` column returns unchanged
   through `line::numeric::float8` (<= 6 significant digits), and nothing else.
2. `disk_guard.decide_window`: the normal window under the limit; the longest
   window that brings the total under the TARGET when over it, oldest days
   first; the floor plus `bridge_paused` when even the floor cannot.
3. The compact tables and their dictionaries are named only by the modules
   that own them — the shared reader rule (A1). A new file that queries them
   directly fails here.
"""
import os
import re
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("DATABASE_URL", "postgresql://x:y@localhost:5432/z")

import price_history as ph                                     # noqa: E402

FAILS: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' — ' + detail) if detail and not cond else ''}")
    if not cond:
        FAILS.append(name)


def test_line_survives() -> None:
    print("line_survives")
    for v in (None, 0.5, 24.3, 0.1, 245.5, 1234.25, -3.5, 99999.5, 6.0):
        check(f"keeps {v!r}", ph.line_survives(v))
    for v in (123456.5, 0.1234567, float("nan"), float("inf")):
        check(f"rejects {v!r}", not ph.line_survives(v))


def test_decide_window() -> None:
    import disk_guard as dg

    print("decide_window")
    G = 10 ** 9
    today = date(2026, 9, 25)
    days = {today - timedelta(days=i): 1 * G for i in range(0, 12)}      # 12 days, 1 GB each
    prov = 27 * G

    d = dg.decide_window(20 * G, prov, days, today, hot_days=10, min_days=3)
    check("under the limit -> normal window, bridge runs", d.hot_days == 10 and not d.bridge_paused, str(d))

    # limit 22.95 GB, target 21.6 GB. 24 GB total: w=10 drops day 11 only (-1 GB = 23),
    # w=9 drops days 10,11 (-2 = 22), w=8 drops 3 (21 <= 21.6).
    d = dg.decide_window(24 * G, prov, days, today, hot_days=10, min_days=3)
    check("over the limit -> longest window under the target", d.hot_days == 8 and not d.bridge_paused, str(d))
    check("projection is the total less the dropped days", d.projected_bytes == 21 * G, str(d))

    d = dg.decide_window(40 * G, prov, days, today, hot_days=10, min_days=3)
    check("floor cannot hold it -> floor + bridge paused", d.hot_days == 3 and d.bridge_paused, str(d))

    d = dg.decide_window(23 * G, prov, {}, today, hot_days=10, min_days=3)
    check("nothing to drop -> paused at the floor", d.hot_days == 3 and d.bridge_paused, str(d))


# Files allowed to name the compact tables or the dictionaries. The migration
# creates them; price_history owns the layout; the rest are the maintenance
# tools A1/A2 name, each of which goes through price_history for the decode.
OWNERS = {
    "price_history.py", "history_mover.py", "disk_guard.py", "health_check.py",
    "test_price_history.py", "test_write_prop_odds.py", "test_write_game_lines.py",
}
# scraper_bridge_replay.py is P6's replay test: it compares the bridge's history
# rows against the scraper's, row for row, and cleans its test rows up — a
# verification harness like test_write_*.py, not a reader of the app's history.
OWNER_SCRIPTS = {"convert_prop_history.py", "scraper_bridge_replay.py"}
# SQL use, not prose: a docstring may say where the history lives.
PATTERN = re.compile(r"\b(FROM|JOIN|INTO|UPDATE|TABLE)\s+(prop_price_history|game_lines_history|"
                     r"odds_(games|subjects|markets|books|sources|sides|periods))\b", re.IGNORECASE)


def test_single_reader() -> None:
    print("shared reader rule")
    root = os.path.dirname(HERE)
    offenders = []
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in (".venv", "__pycache__", "corpus", "golf_model_layer_backup_20260913",
                                                 "dead_tables_backup")]
        for f in files:
            if not f.endswith(".py"):
                continue
            path = os.path.join(base, f)
            if f in OWNERS or (base == root and f in OWNER_SCRIPTS):
                continue
            with open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
            for line in text.splitlines():
                code = line.split("#", 1)[0]
                if PATTERN.search(code):
                    offenders.append(f"{os.path.relpath(path, root)}: {line.strip()[:90]}")
    check("only the owning modules name the compact tables", not offenders, "; ".join(offenders[:5]))


if __name__ == "__main__":
    test_line_survives()
    test_decide_window()
    test_single_reader()
    print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILED: {FAILS}'}")
    sys.exit(1 if FAILS else 0)
