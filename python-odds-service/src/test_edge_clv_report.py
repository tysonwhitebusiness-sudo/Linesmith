"""P13 (E3) — the closing-line report on a synthetic log. Hermetic (no database).

A soft close moving toward the fair price counts, one moving away does not;
CLV matches a hand computation; the bootstrap interval is ordered; the fair
close is the reference's last PRE-START pair; a split under n = 30 prints
"not enough data".

Run with:  python -u src/test_edge_clv_report.py
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from edge_clv_report import EdgeOutcome, bootstrap_ci, fair_close, last_before, render, summarize  # noqa: E402

failures: list[str] = []


def ok(name, cond, detail=""):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}{'' if cond else '  -- ' + str(detail)}")
    if not cond:
        failures.append(name)


def edge(close, fair_close_p=0.52, shown=-105, fair=0.517, life=600.0, book="betmgm", sport="nfl"):
    return EdgeOutcome(sport=sport, group="game lines", book=book, reference="pinnacle", shown_american=shown,
                       fair_at_show=fair, close_american=close, fair_close=fair_close_p, life_s=life)


print("moved toward")
# Shown -105 (implied 51.22%) against fair 51.7%: a close at -108 (51.92%) is nearer the fair price.
ok("a close moving toward the fair price counts", edge(-108).moved_toward is True)
ok("a close moving away does not", edge(100).moved_toward is False)
ok("no close is not measured", edge(None).moved_toward is None and not edge(None).measured)

print("CLV")
# fair close 0.52 x decimal(-105) 1.95238 - 1 = 0.015238
ok("CLV = fair close x shown decimal - 1", abs(edge(-108).clv - (0.52 * (1 + 100 / 105) - 1)) < 1e-12, edge(-108).clv)

print("the close is the last PRE-START price")
start = datetime(2026, 9, 27, 17, 0, tzinfo=timezone.utc)
hist = [(start - timedelta(hours=2), -110), (start - timedelta(minutes=5), -115), (start + timedelta(minutes=1), -140)]
ok("last price before the start", last_before(hist, start) == -115)
fc = fair_close([(start - timedelta(minutes=3), -113)], [(start - timedelta(minutes=3), 102), (start + timedelta(minutes=2), 120)],
                start, "multiplicative")
ok("fair close from the reference's last pre-start pair", fc is not None and abs(fc - 0.5173) < 0.0005, fc)
ok("no pre-start pair, no fair close", fair_close([], [(start - timedelta(minutes=3), 102)], start, "multiplicative") is None)

print("bootstrap")
xs = [0.01 * ((i * 37) % 11 - 5) for i in range(60)]
lo, hi = bootstrap_ci(xs)
ok("the 95% interval is ordered and brackets the mean", lo <= sum(xs) / len(xs) <= hi and lo < hi, (lo, hi))

print("not enough data")
few = [edge(-108) for _ in range(29)]
ok("n < 30 is not summarized", summarize(few)["enough"] is False)
enough = [edge(-108 if i % 3 else 100, life=60.0 if i % 10 == 0 else 900.0) for i in range(40)]
s = summarize(enough)
ok("n >= 30 is", s["enough"] and 0 < s["moved_toward"] < 1, s)
ok("half-life is the median life", s["half_life_s"] == 900.0)
ok("an edge ending within one poll is an artefact", abs(s["artefacts"] - 0.1) < 1e-9, s["artefacts"])
md = render(few + [edge(-108, sport="mlb")], None, date(2026, 10, 1))
ok("the report prints 'not enough data' for a small split", "not enough data" in md and "## By sport" in md)
ok("the report prints numbers for a big split", "%" in render(enough, None, date(2026, 10, 1)).split("## All edges")[1].split("##")[0])

print()
if failures:
    print(f"FAILED: {failures}")
    sys.exit(1)
print("all edge CLV report checks passed")
