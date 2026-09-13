"""Phase 7 step 4 — does the NBA prop model's disagreement with the market carry
information?

    python test_nba_prop_edge.py

THE HYPOTHESES WERE PRE-REGISTERED in docs/CURRENT.md (commit 0fbb022) before
this file existed. This script implements that text and nothing else; if the two
disagree, the pre-registration wins and this file has a bug.

    edge    = model_p_over - market_p_over      (+ve: model likes the over more)
    outcome = y - market_p_over                  (+ve: the over beat its price)

H1a (primary)  slope of outcome on edge, CI excluding 0.
H1b (betting)  at |edge| >= 0.05, one unit on the model's side at the ACTUAL
               price: ROI CI lower bound > 0, AND ROI above the control of
               betting the under on the same rows.
H1 passes only if both do.

FOUR WAYS THIS COULD LIE, each handled:

1. **CORRELATED ROWS.** Points, PR, PA and PRA on one player-game are
   near-duplicates, and a night's props share an injury report. Plain binomial
   intervals treat 9,477 rows as independent and are far too narrow. CIs here
   come from a cluster bootstrap by game_date AND by athlete_id, and the WIDER
   of the two is the verdict's. Fifteen date clusters is few, so even that
   understates the uncertainty.

2. **A BREAK-EVEN THAT IGNORES THE PRICE.** 52.38% is -110's break-even, and
   these props run from -10000 to +800. It is printed, as the plan asks, but
   each table also prints the mean break-even of the bets actually taken, and
   the betting verdict is ROI at the real price.

3. **AN "EDGE" THAT IS ONLY A BIAS.** The market's over side is overpriced
   (step 1: -0.69pt) and the model leans under relative to the market. A model
   that just bets unders will look sharp. The always-under control on the same
   rows is what H1b has to beat.

4. **HUNTING THE GRID.** The band and per-market tables are DESCRIPTIVE. Nothing
   found in them is a finding; that is exactly what Phase 6's high-edge band
   turned out to be.

H2 (the Total Assists 55-60% pocket) CANNOT be tested here: step 1 found it on
all 25,420 props, including every EVAL day, and there are no other priced NBA
props. It is pre-registered for 2026-27. The split printed below is labelled
CONTAMINATED and may only show whether the pocket lives in one sub-period.

Every line is a half-point, so there are no pushes; the script asserts it.
"""
from __future__ import annotations

import csv
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

from predict.odds_math import american_to_decimal, devig_two_way  # noqa: E402

PROBS_CSV = os.path.join(HERE, "nba_prop_probs.csv")
TRAIN_CSV = os.path.join(HERE, "nba_props_train.csv")

BREAK_EVEN = 0.5238          # -110 both ways
THRESHOLD = 0.05             # pre-registered
EVAL_START = "2025-11-16"    # step 3's SELECT ends 2025-11-15
DRAWS = 2000
SEED = 20260913


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return float("nan"), float("nan")
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


def profit(price: np.ndarray, won: np.ndarray) -> np.ndarray:
    """Flat one-unit stake at an American price."""
    win_pay = np.where(price > 0, price / 100.0, 100.0 / np.abs(price))
    return np.where(won, win_pay, -1.0)


def load() -> dict[str, np.ndarray]:
    with open(PROBS_CSV, encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    out = {
        "date": np.array([r["game_date"] for r in rows]),
        "athlete": np.array([r["athlete_id"] for r in rows]),
        "market": np.array([r["market"] for r in rows]),
        "line": np.array([float(r["line"]) for r in rows]),
        "actual": np.array([float(r["actual"]) for r in rows]),
        "y": np.array([int(r["y"]) for r in rows]),
        "p": np.array([float(r["model_p_over"]) for r in rows]),
        "m": np.array([float(r["market_p_over"]) for r in rows]),
        "op": np.array([float(r["over_price"]) for r in rows]),
        "up": np.array([float(r["under_price"]) for r in rows]),
    }
    assert not np.any(out["actual"] == out["line"]), "a push exists; the pre-registration assumed none"
    assert np.all(out["date"] >= EVAL_START), "a SELECT-period row is in the EVAL file"
    return out


def cluster_ci(keys: np.ndarray, cols: dict[str, np.ndarray], stat, rng) -> tuple[float, float]:
    """Percentile CI of `stat(sums)` under resampling whole clusters.

    `cols` are per-row additive quantities; each draw sums them over a
    with-replacement sample of clusters and hands the sums to `stat`."""
    uniq, inv = np.unique(keys, return_inverse=True)
    k = len(uniq)
    agg = {name: np.bincount(inv, weights=v, minlength=k) for name, v in cols.items()}
    vals = np.empty(DRAWS)
    for i in range(DRAWS):
        counts = np.bincount(rng.integers(0, k, k), minlength=k)
        vals[i] = stat({name: float(counts @ a) for name, a in agg.items()})
    vals = vals[np.isfinite(vals)]
    return float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))


def wider(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    return a if (a[1] - a[0]) >= (b[1] - b[0]) else b


def main() -> int:
    d = load()
    rng = np.random.default_rng(SEED)
    edge = d["p"] - d["m"]
    outcome = d["y"] - d["m"]
    n = len(edge)

    print("\n" + "=" * 78)
    print("NBA PROP EDGE TEST — pre-registered in docs/CURRENT.md (commit 0fbb022)")
    print("=" * 78)
    print(f"  EVAL rows {n:,}   game days {len(np.unique(d['date']))}   "
          f"athletes {len(np.unique(d['athlete']))}   pushes 0 (asserted)")
    print(f"  edge sd {edge.std():.4f}   mean edge {edge.mean():+.4f}   "
          f"over-rate {d['y'].mean() * 100:.2f}%   mean market p {d['m'].mean() * 100:.2f}%")

    # ---- H1a ---------------------------------------------------------------
    b, a0 = np.polyfit(edge, outcome, 1)
    r = float(np.corrcoef(edge, outcome)[0, 1])

    def slope(s):
        den = s["n"] * s["ee"] - s["e"] ** 2
        return (s["n"] * s["eo"] - s["e"] * s["o"]) / den if den else float("nan")

    cols = {"n": np.ones(n), "e": edge, "o": outcome, "ee": edge * edge, "eo": edge * outcome}
    ci_date = cluster_ci(d["date"], cols, slope, rng)
    ci_ath = cluster_ci(d["athlete"], cols, slope, rng)
    ci_a = wider(ci_date, ci_ath)
    h1a = b > 0 and ci_a[0] > 0

    print("\n  --- H1a  slope of (y - market) on (model - market) --------------------")
    print(f"    slope {b:+.4f}   intercept {a0:+.4f}   corr {r:+.4f}")
    print("    (1.0 = disagreement fully realised, 0 = no information)")
    print(f"    95% CI by date    [{ci_date[0]:+.4f}, {ci_date[1]:+.4f}]")
    print(f"    95% CI by athlete [{ci_ath[0]:+.4f}, {ci_ath[1]:+.4f}]")
    print(f"    H1a: {'PASS' if h1a else 'FAIL'}  (wider CI [{ci_a[0]:+.4f}, {ci_a[1]:+.4f}])")

    # ---- H1b ---------------------------------------------------------------
    over_side = edge > 0
    side_price = np.where(over_side, d["op"], d["up"])
    side_won = np.where(over_side, d["y"] == 1, d["y"] == 0)
    pnl = profit(side_price, side_won)
    ctrl_pnl = profit(d["up"], d["y"] == 0)
    be = 1.0 / np.array([american_to_decimal(x) for x in side_price])

    bet = np.abs(edge) >= THRESHOLD
    nb = int(bet.sum())
    wins = int(side_won[bet].sum())
    roi = float(pnl[bet].mean())
    ctrl = float(ctrl_pnl[bet].mean())

    def roi_stat(s):
        return s["pnl"] / s["n"] if s["n"] else float("nan")

    def diff_stat(s):
        return (s["pnl"] - s["ctrl"]) / s["n"] if s["n"] else float("nan")

    bcols = {"n": bet.astype(float), "pnl": np.where(bet, pnl, 0.0), "ctrl": np.where(bet, ctrl_pnl, 0.0)}
    roi_ci = wider(cluster_ci(d["date"], bcols, roi_stat, rng),
                   cluster_ci(d["athlete"], bcols, roi_stat, rng))
    diff_ci = wider(cluster_ci(d["date"], bcols, diff_stat, rng),
                    cluster_ci(d["athlete"], bcols, diff_stat, rng))
    h1b = roi_ci[0] > 0 and roi > ctrl
    wl, wh = wilson(wins, nb)

    print(f"\n  --- H1b  bet the model's side at |edge| >= {THRESHOLD} ------------------------")
    print(f"    bets {nb:,}  ({int((bet & over_side).sum()):,} over, {int((bet & ~over_side).sum()):,} under)")
    print(f"    win rate {100 * wins / nb:.2f}%   Wilson [{100 * wl:.2f}, {100 * wh:.2f}] (independence assumed, reference only)")
    print(f"    mean break-even of bets taken {100 * be[bet].mean():.2f}%   (-110 reference {100 * BREAK_EVEN:.2f}%)")
    print(f"    ROI           {100 * roi:+.2f}%   95% cluster CI [{100 * roi_ci[0]:+.2f}, {100 * roi_ci[1]:+.2f}]")
    print(f"    CONTROL ROI   {100 * ctrl:+.2f}%   (always the under, same rows)")
    print(f"    model - control {100 * (roi - ctrl):+.2f}pt   95% cluster CI [{100 * diff_ci[0]:+.2f}, {100 * diff_ci[1]:+.2f}]"
          "   (extra, not in the pass rule)")
    print(f"    H1b: {'PASS' if h1b else 'FAIL'}  (needs CI lower bound > 0 AND ROI > control)")

    # ---- descriptive -------------------------------------------------------
    def table(mask_fn, labels, title):
        print(f"\n  --- DESCRIPTIVE ONLY: {title} " + "-" * max(0, 52 - len(title)))
        print(f"    {'':<38}{'n':>6}{'win%':>8}{'b/e%':>8}{'ROI%':>8}{'ctrl%':>8}")
        for lab in labels:
            m = mask_fn(lab)
            k = int(m.sum())
            if not k:
                continue
            print(f"    {lab if isinstance(lab, str) else f'{lab[0]:.2f}-{lab[1]:.2f}':<38}{k:>6,}"
                  f"{100 * side_won[m].mean():>8.2f}{100 * be[m].mean():>8.2f}"
                  f"{100 * pnl[m].mean():>+8.2f}{100 * ctrl_pnl[m].mean():>+8.2f}")

    bands = [(0.0, 0.02), (0.02, 0.05), (0.05, 0.10), (0.10, 9.0)]
    table(lambda lo_hi: (np.abs(edge) >= lo_hi[0]) & (np.abs(edge) < lo_hi[1]), bands,
          "model side by |edge| band, all rows")
    markets = list(dict.fromkeys(d["market"]))
    table(lambda mk: bet & (d["market"] == mk), markets, f"per market at |edge| >= {THRESHOLD}")
    print("    No row of either table is a finding. The pass rule is H1a and H1b above.")

    # ---- H2, contaminated --------------------------------------------------
    print("\n  --- H2  Total Assists, market p_over in [0.55, 0.60): CONTAMINATED -----")
    print("    Found by step 1 on ALL of these rows. Pre-registered for 2026-27.")
    print("    This split may only show whether the pocket sits in one sub-period.")
    with open(TRAIN_CSV, encoding="utf-8") as fh:
        pocket = []
        for row in csv.DictReader(fh):
            if row["market"] != "Total Assists" or row["actual"] in ("", None):
                continue
            pair = devig_two_way(american_to_decimal(float(row["over_price"])),
                                 american_to_decimal(float(row["under_price"])))
            if pair is None or not (0.55 <= pair[0] < 0.60):
                continue
            pocket.append((row["game_date"], pair[0], float(row["actual"]) > float(row["line"]),
                           float(row["under_price"])))
    print(f"    rows reproduced {len(pocket):,} (step 1 reported 546)")
    for tag, keep in (("SELECT  (to 2025-11-15)", lambda g: g < EVAL_START),
                      ("EVAL    (2025-11-16 on)", lambda g: g >= EVAL_START)):
        rows = [p for p in pocket if keep(p[0])]
        if not rows:
            print(f"    {tag}  no rows")
            continue
        over = np.array([p[2] for p in rows])
        up = np.array([p[3] for p in rows])
        print(f"    {tag}  n {len(rows):>4}   implied {100 * np.mean([p[1] for p in rows]):.2f}%   "
              f"realised {100 * over.mean():.2f}%   under ROI {100 * profit(up, ~over).mean():+.2f}%")

    # ---- verdict -----------------------------------------------------------
    print("\n  " + "=" * 74)
    print(f"  VERDICT  H1a {'PASS' if h1a else 'FAIL'}   H1b {'PASS' if h1b else 'FAIL'}   "
          f"=>  H1 {'PASS' if (h1a and h1b) else 'FAIL'}")
    print("  H2: not tested (pre-registered for 2026-27 prices)")
    print("  " + "=" * 74 + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
