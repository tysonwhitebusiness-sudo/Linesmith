"""
GATE 1 -- ESPN core-API game lines.

Asserts against OUTCOMES, not row counts. Every threshold is grounded in a
number measured on 2026-08-31. Exits non-zero listing every failure.

WHY PYTHON AND NOT THE .mjs THE GAMEPLAN NAMED: a hand-rolled JS CSV parser
OOM'd twice (4 GB then 6 GB) on 102k rows -- it accumulated fields character by
character, which is quadratic string churn, and it held raw_json for every row.
pandas reads the same file in seconds. The gameplan said .mjs; the file format
was never the point of the gate.

Run: python scripts/gate/gate1_game_lines.py
"""
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

V1 = Path("C:/Users/occy3/Downloads/espn_core_odds/espn_core_odds_all.csv")
V2 = Path("C:/Users/occy3/Downloads/espn_core_odds_v2/espn_core_odds_all.csv")
failures, notes = [], []


def check(cond, label, value):
    print(f"  {'PASS' if cond else 'FAIL'}  {label:<50} {value}")
    if not cond:
        failures.append(f"{label} -> {value}")


def implied(a):
    a = np.asarray(a, dtype=float)
    return np.where(a > 0, 100.0 / (a + 100.0), -a / (-a + 100.0))


USECOLS = [
    "block", "sport", "event_id", "event_date", "home_team", "away_team",
    "home_score", "away_score", "provider", "cur_spread", "cur_total",
    "cur_home_ml", "cur_away_ml", "close_total", "close_home_ml",
    "close_away_ml", "open_total", "draw_ml", "ml_booksum", "ml_flag",
    "close_over_odds", "close_under_odds",
]

frames = []
for p in (V1, V2):
    if p.exists():
        head = pd.read_csv(p, nrows=0).columns
        frames.append(pd.read_csv(p, usecols=[c for c in USECOLS if c in head], low_memory=False))
if not frames:
    print("no input files")
    sys.exit(1)
d = pd.concat(frames, ignore_index=True)
for c in ("draw_ml", "close_total", "open_total"):
    if c not in d:
        d[c] = np.nan
# ZERO IS A PLACEHOLDER, NOT A VALUE. ESPN writes close_total == 0 on every
# MLB row that has a close block, and close_home_ml == 0 on 1,233 of them.
# Coalescing 0 as real dragged the MLB total mean to 3.71 against a true 8.47.
for _c in ("close_total", "cur_total", "close_home_ml", "cur_home_ml",
           "close_away_ml", "cur_away_ml", "open_total"):
    if _c in d:
        d[_c] = d[_c].replace(0, np.nan)
d["total"] = d["close_total"].fillna(d["cur_total"])
d["hml"] = d["close_home_ml"].fillna(d["cur_home_ml"])
d["aml"] = d["close_away_ml"].fillna(d["cur_away_ml"])
d["pts"] = d.home_score + d.away_score
d["margin"] = d.home_score - d.away_score
d["home_won"] = (d.home_score > d.away_score).astype(float)

print(f"\nGATE 1 -- {len(d)} rows, {d.block.nunique()} blocks, {d.sport.nunique()} sports\n")
sports = sorted(d.sport.dropna().unique())
is_soccer = lambda s: str(s).startswith("soccer")

# ---- 1.1 event coverage ----------------------------------------------------
print("1.1  event coverage per block (>= 95%)")
for b, g in d.groupby("block"):
    games = g.event_id.nunique()
    withodds = g[g.hml.notna() | g.total.notna()].event_id.nunique()
    pct = withodds / games if games else 0
    check(pct >= 0.95, f"1.1 {b}", f"{pct*100:.1f}% ({withodds}/{games})")

# ---- 1.2 / 1.3 booksum -----------------------------------------------------
print("\n1.2/1.3  booksum by sport")
for s in sports:
    g = d[d.sport == s]
    if is_soccer(s):
        three = g[g.ml_flag == "three_way"].ml_booksum.dropna()
        drawpct = g.draw_ml.notna().mean()
        check(len(three) > 0 and 1.02 <= three.mean() <= 1.15,
              f"1.3 {s} three-way booksum", f"{three.mean():.4f} (n={len(three)})" if len(three) else "none")
        check(drawpct >= 0.90, f"1.3 {s} draw_ml populated", f"{drawpct*100:.1f}%")
    else:
        two = g[g.ml_flag == "two_way"].ml_booksum.dropna()
        check(len(two) > 0 and 1.02 <= two.mean() <= 1.12,
              f"1.2 {s} two-way booksum", f"{two.mean():.4f} (n={len(two)})" if len(two) else "none")

# ---- 1.4 implied vs realised ------------------------------------------------
print("\n1.4  |mean implied home - actual home win rate| <= 0.04")
for s in sports:
    g = d[(d.sport == s) & d.ml_flag.isin(["two_way", "three_way"])].dropna(subset=["hml", "home_score", "away_score"])
    if len(g) < 30:
        notes.append(f"1.4 {s}: only {len(g)} rows, skipped")
        continue
    p, a = implied(g.hml.values).mean(), g.home_won.mean()
    check(abs(p - a) <= 0.04, f"1.4 {s}", f"implied {p:.3f} vs actual {a:.3f} (gap {p-a:+.3f}, n={len(g)})")

# ---- 1.5 distinct total lines ----------------------------------------------
# Per-sport because market structure genuinely differs: NBA totals span 190-260
# in half-points; soccer is 2.5/3.5/4.5 and nothing else. The check asks "is
# this a varying line or a constant?" -- the site API's NHL total had exactly
# ONE distinct value across 1,400+ games.
MIN_DISTINCT = {"nba": 20, "nhl": 5, "mlb": 5, "nfl": 15, "cfb": 15, "soccer_epl": 3, "soccer_mls": 3}
print("\n1.5  distinct total lines per sport")
for s in sports:
    t = d[d.sport == s].total.dropna()
    mn = MIN_DISTINCT.get(s, 5)
    check(t.nunique() >= mn, f"1.5 {s} distinct totals (>={mn})", f"{t.nunique()} distinct over {len(t)} rows, sd {t.std():.3f}")

# ---- 1.6 over rate ----------------------------------------------------------
print("\n1.6  over rate 0.46-0.54")
for s in sports:
    g = d[d.sport == s].dropna(subset=["total", "pts"])
    if len(g) < 50:
        notes.append(f"1.6 {s}: only {len(g)} rows, skipped")
        continue
    over = (g.pts > g.total).mean()
    # COMPARE TO THE PRICE, NOT TO 0.50. A 50% over rate is only expected when
    # both sides are priced symmetrically. Measured: NBA -105/-102 and NFL
    # -95/-99 are symmetric, but NHL is -69/-26 and MLS -52/-19, so their
    # realised over rate SHOULD sit well off 0.50. Asserting 0.46-0.54 there
    # tests the market's pricing convention, not our parse.
    gp = g.dropna(subset=["close_over_odds", "close_under_odds"])
    if len(gp) >= 50:
        io_, iu = implied(gp.close_over_odds.values), implied(gp.close_under_odds.values)
        exp = float(np.mean(io_ / (io_ + iu)))
        obs = float((gp.pts > gp.total).mean())
        check(abs(obs - exp) <= 0.06, f"1.6 {s} over rate vs price-implied",
              f"observed {obs:.3f} vs implied {exp:.3f} (gap {obs-exp:+.3f}, n={len(gp)})")
    else:
        check(0.46 <= over <= 0.54, f"1.6 {s} over rate (no prices)",
              f"{over:.3f} (n={len(g)}, line {g.total.mean():.2f} vs actual {g.pts.mean():.2f})")

# ---- 1.7 spread predicts margin ---------------------------------------------
# Skipped where the handicap is near-constant by design (MLB run line, NHL puck
# line, soccer handicap are all +-1.5 on nearly every game). That is a property
# of the market, not of the parse. 1.8 is what catches a broken orientation.
print("\n1.7  corr(-spread, home margin) >= 0.25   [nba/nfl/cfb only]")
for s in sports:
    if s not in ("nba", "nfl", "cfb"):
        notes.append(f"1.7 {s}: skipped, handicap is near-constant by design")
        continue
    g = d[d.sport == s].dropna(subset=["cur_spread", "margin"])
    if len(g) < 50:
        notes.append(f"1.7 {s}: only {len(g)} rows")
        continue
    c = np.corrcoef(-g.cur_spread.values, g.margin.values)[0, 1]
    check(c >= 0.25, f"1.7 {s}", f"{c:.4f} (n={len(g)})")

# ---- 1.8 favourite / dog split ----------------------------------------------
print("\n1.8  home-favourite minus home-dog win rate >= 0.15")
for s in sports:
    g = d[d.sport == s].dropna(subset=["hml", "aml", "home_score", "away_score"])
    fav, dog = g[g.hml < g.aml], g[g.hml > g.aml]
    if len(fav) < 20 or len(dog) < 20:
        notes.append(f"1.8 {s}: fav {len(fav)} dog {len(dog)}, skipped")
        continue
    fw, dw = fav.home_won.mean(), dog.home_won.mean()
    check(fw - dw >= 0.15, f"1.8 {s}", f"fav {fw:.3f} vs dog {dw:.3f} = {fw-dw:+.3f}")

# ---- 1.9 DELETED 2026-09-01 -- superseded by gate 4.5 ------------------------
# 1.9 compared ESPN's closing total against SBR's on the same game, matching
# the two by RAW TEAM NAME. It never once asserted anything: SBR writes
# "LALakers" and ESPN writes "Los Angeles Lakers", so it found 0 overlaps on
# both sports it covered, printed a note, and passed vacuously. Its own note
# said the right thing -- "a low match is an ENTITY problem for Phase 4" -- and
# Phase 4 solved it.
#
# gate4_staging.mjs 4.5 is that same check, done against RESOLVED team ids in
# odds_import_staging, and it is strictly stronger on every axis:
#   - it matches (n=524 NBA, 217 NHL) where 1.9 matched nothing;
#   - it DERIVES the SBR-vs-ESPN day offset instead of assuming 0 (it is +1,
#     because SBR dates are local and ESPN's are UTC);
#   - it asserts BIAS as the primary check, not per-game distance, because one
#     source is a consensus snapshot and the other a ~16-book average of a line
#     that genuinely moves;
#   - it adds a same-favourite check on averaged IMPLIED PROBABILITIES.
#
# Fixing 1.9 would have meant reimplementing entity resolution here, upstream of
# the importer that already does it. Deleted rather than fixed.

# ---- 1.10 no all-null column ------------------------------------------------
print("\n1.10  every loaded column non-null on at least one row")
dead = [c for c in USECOLS if c in d and d[c].notna().sum() == 0]
check(not dead, "1.10 all-null columns", ", ".join(dead) if dead else "none")

# ---- summary ----------------------------------------------------------------
if notes:
    print("\nNOTES (not failures):")
    for n in notes:
        print(f"  - {n}")
print(f"\n{'GATE 1 PASSED' if not failures else f'GATE 1 FAILED -- {len(failures)} assertion(s)'}")
for f in failures:
    print(f"  ! {f}")
sys.exit(0 if not failures else 1)
