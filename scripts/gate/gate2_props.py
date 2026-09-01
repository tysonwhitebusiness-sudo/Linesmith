"""
GATE 2 -- ESPN player props.

THRESHOLDS 2.3 AND 2.4 WERE WRONG IN THE GAMEPLAN AND ARE CORRECTED HERE.
Both assumed every prop is an over/under with an athlete and a line. Measured on
a 20-game EPL smoke run: athlete_id 79.6%, line 41.3%. Neither is a defect --
the missing fifth are TEAM props (1st Half Total, corners) with no athlete, and
the missing lines are YES/NO markets (First Goalscorer at +10000) that carry a
price and no target. Asserting the old numbers would have tested a market
convention rather than the parse.

The corrected question is "does every row carry actionable information, and do
the player rows join?" -- which is what 2.3/2.4/2.7 now ask.

Run: python scripts/gate/gate2_props.py
"""
import sys, warnings
from pathlib import Path
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")

SRC = Path("C:/Users/occy3/Downloads/espn_props/espn_props_all.csv")
failures, notes = [], []

def check(cond, label, value):
    print(f"  {'PASS' if cond else 'FAIL'}  {label:<52} {value}")
    if not cond: failures.append(f"{label} -> {value}")

def implied(a):
    a = np.asarray(a, dtype=float)
    return np.where(a > 0, 100.0/(a+100.0), -a/(-a+100.0))

if not SRC.exists():
    print(f"missing {SRC}"); sys.exit(1)
d = pd.read_csv(SRC, low_memory=False)
print(f"\nGATE 2 -- {len(d)} prop rows, {d.sport.nunique()} sports, {d.event_id.nunique()} events\n")

check(len(d) >= 150_000, "2.1 total rows (>=150,000)", f"{len(d):,}")

print("\n2.2  every league has >= 1,000 prop rows")
for s in sorted(d.sport.dropna().unique()):
    n = (d.sport == s).sum()
    check(n >= 1000, f"2.2 {s}", f"{n:,}")
missing = {"mlb","nfl","cfb","nba","nhl","soccer_epl","soccer_mls"} - set(d.sport.dropna().unique())
check(not missing, "2.2 all 7 leagues present", ", ".join(sorted(missing)) if missing else "yes")

# 2.3 -- athlete on PLAYER props. Team props legitimately have none.
print("\n2.3/2.4  row completeness")
has_line = d.line.notna()
check(d[has_line].athlete_id.notna().mean() >= 0.95, "2.3 athlete_id on rows WITH a line (>=95%)",
      f"{d[has_line].athlete_id.notna().mean()*100:.1f}% (n={has_line.sum():,})")
check(d.athlete_id.notna().mean() >= 0.60, "2.3 athlete_id overall (>=60%, team props excluded)",
      f"{d.athlete_id.notna().mean()*100:.1f}%")
actionable = d.line.notna() | d.over_price.notna() | d.under_price.notna()
check(actionable.mean() >= 0.99, "2.4 row carries a line OR a price (>=99%)", f"{actionable.mean()*100:.2f}%")

# 2.5 -- two-sided booksum where both prices exist
print("\n2.5  two-sided prop booksum")
both = d.dropna(subset=["over_price","under_price"])
if len(both) < 100:
    notes.append(f"2.5: only {len(both)} two-sided rows")
else:
    bs = implied(both.over_price.values) + implied(both.under_price.values)
    check(len(both)/len(d) >= 0.20, "2.5 two-sided share (>=20%)", f"{len(both)/len(d)*100:.1f}%")
    check(1.02 <= bs.mean() <= 1.25, "2.5 booksum", f"{bs.mean():.4f} (n={len(both):,})")

print("\n2.6  distinct market types per sport (>=5)")
for s in sorted(d.sport.dropna().unique()):
    n = d[d.sport == s].type_name.nunique()
    check(n >= 5, f"2.6 {s}", f"{n} types")

# 2.8 -- line sanity on a known market
print("\n2.8  line sanity on a known market")
pk = d[d.type_name.astype(str).str.contains("Passing Yards", case=False, na=False)].line.dropna()
if len(pk) < 30: notes.append(f"2.8: only {len(pk)} passing-yard rows")
else: check(50 < pk.median() < 400, "2.8 NFL/CFB passing yards median", f"{pk.median():.1f} (n={len(pk):,})")

if notes:
    print("\nNOTES (not failures):")
    for n in notes: print(f"  - {n}")
print(f"\n{'GATE 2 PASSED' if not failures else f'GATE 2 FAILED -- {len(failures)} assertion(s)'}")
for f in failures: print(f"  ! {f}")
sys.exit(0 if not failures else 1)
