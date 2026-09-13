"""Phase 6 step 2 — sweep the rating hyper-parameters instead of guessing them.

    python sweep_cfb_ratings.py

WHY A SWEEP. The first two fits were hand-picked: lam=25/no-decay gave sd 19.89,
lam=25/halflife=540d gave 20.36 -- WORSE, while correlation with the market rose.
Two points chosen by intuition say nothing about the surface, and picking the
better of two guesses is how a bad model gets shipped with a confident number.

WHAT THE SWEEP FOUND, and one of these contradicts the phase plan:

  1. **CAPPING BLOWOUTS HURTS.** cap=100 (effectively uncapped) beat cap=28 and
     cap=21 in EVERY row of the first grid, on residual sd AND on bias. The plan
     says "Cap or shrink blowout margins"; measured, that is backwards. Capping
     also introduces bias (+2.47 at cap=21 vs -0.18 uncapped) because home teams
     win more often, so truncation cuts the distribution asymmetrically.
  2. **RIDGE BARELY HELPS.** lam 12 -> 5 -> 2 -> 1 -> 0.5 gives
     18.95 -> 18.09 -> 17.49 -> 17.26 -> 17.17, flattening. With 14,773 games
     over 267 teams (~55 each) there is plenty of data; lam only needs to stay
     ABOVE ZERO to keep the system identifiable, since ratings are defined only
     up to an additive constant.
  3. Time decay helps, mildly, around a 730-day half-life.

  BEST: lam=0.5, halflife=730d, uncapped -> sd 17.17, bias +0.05, corr 0.882,
  against a market of 15.52.

THE FIRST GRID'S OPTIMUM SAT ON TWO BOUNDARIES (lowest lam, highest cap), which
is why it was widened rather than reported. An optimum at the edge of a grid is
a statement about the grid, not the model.

The bar is fixed and comes from step 1: the closing spread leaves **sd 15.52**
on the same games. Every row below is measured against that.

LEAKAGE CONTROL IS UNCHANGED AND NON-NEGOTIABLE: ratings are refit per
season-week on strictly earlier games. The sweep only changes lam / halflife /
cap; it never changes what the model is allowed to see.

The fit is vectorised here (np.add.at into the normal equations) purely for
speed -- it is the same arithmetic as fit_cfb_ratings.fit_ridge, which stays the
readable reference.
"""
from __future__ import annotations

import csv
import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

TRAIN_CSV = os.path.join(HERE, "cfb_train.csv")


def solve(hi, ai, y, w, n, lam):
    """Weighted ridge normal equations, accumulated with np.add.at."""
    A = np.zeros((n + 1, n + 1))
    b = np.zeros(n + 1)
    np.add.at(A, (hi, hi), w)
    np.add.at(A, (ai, ai), w)
    np.add.at(A, (hi, ai), -w)
    np.add.at(A, (ai, hi), -w)
    np.add.at(A, (hi, np.full_like(hi, n)), w)
    np.add.at(A, (np.full_like(hi, n), hi), w)
    np.add.at(A, (ai, np.full_like(ai, n)), -w)
    np.add.at(A, (np.full_like(ai, n), ai), -w)
    A[n, n] += w.sum()
    np.add.at(b, hi, w * y)
    np.add.at(b, ai, -w * y)
    b[n] += float((w * y).sum())
    A[np.arange(n), np.arange(n)] += lam          # HFA intercept unpenalised
    try:
        return np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        return np.linalg.lstsq(A, b, rcond=None)[0]


async def main() -> int:
    import asyncio
    import db

    spreads = {}
    with open(TRAIN_CSV, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            spreads[r["event_ref"]] = float(r["close_spread"])

    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        rows = await conn.fetch(
            """SELECT event_ref, game_date, home_team_id, away_team_id,
                      home_score, away_score
                 FROM game_result
                WHERE sport='cfb' AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
                  AND home_score IS NOT NULL AND away_score IS NOT NULL
                ORDER BY game_date""")
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                          # noqa: BLE001
        pool.terminate()

    games = [(str(r["event_ref"]), r["game_date"], str(r["home_team_id"]),
              str(r["away_team_id"]), float(int(r["home_score"]) - int(r["away_score"])))
             for r in rows]
    teams = sorted({g[2] for g in games} | {g[3] for g in games})
    tix = {t: i for i, t in enumerate(teams)}
    n = len(teams)

    by_week = defaultdict(list)
    for g in games:
        by_week[(g[1].year, g[1].isocalendar()[1])].append(g)
    weeks = sorted(by_week)

    ordinal = np.array([g[1].toordinal() for g in games], dtype=float)
    print(f"\n{'=' * 84}\nCFB RATING SWEEP  ({len(games):,} games, {n} teams, "
          f"{len(weeks)} season-weeks)\n{'=' * 84}")
    print(f"  bar to beat: MARKET residual sd = 15.52\n")
    print(f"  {'lam':>6} {'halflife':>9} {'cap':>5} {'model sd':>9} {'bias':>7} "
          f"{'corr':>6}  {'vs market':>10}")
    print("  " + "-" * 66)

    results = []
    for lam in (0.5, 1.0, 2.0, 5.0, 12.0):
        for hl in (0.0, 730.0, 1460.0):
            for cap in (35.0, 50.0, 100.0):
                hist_hi, hist_ai, hist_y, hist_ord = [], [], [], []
                acc_pred, acc_act, acc_mkt = [], [], []
                for wk in weeks:
                    wg = by_week[wk]
                    if len(hist_y) >= 200:
                        hi = np.array(hist_hi); ai = np.array(hist_ai)
                        y = np.clip(np.array(hist_y), -cap, cap)
                        if hl:
                            age = wg[0][1].toordinal() - np.array(hist_ord)
                            w = 0.5 ** (age / hl)
                        else:
                            w = np.ones_like(y)
                        sol = solve(hi, ai, y, w, n, lam)
                        for ref, gd, h, a, m in wg:
                            sp = spreads.get(ref)
                            if sp is None:
                                continue
                            acc_pred.append(sol[tix[h]] - sol[tix[a]] + sol[n])
                            acc_act.append(m)
                            acc_mkt.append(-sp)
                    for ref, gd, h, a, m in wg:
                        hist_hi.append(tix[h]); hist_ai.append(tix[a])
                        hist_y.append(m); hist_ord.append(gd.toordinal())
                act = np.array(acc_act); pred = np.array(acc_pred); mkt = np.array(acc_mkt)
                sd = float((act - pred).std()); bias = float((act - pred).mean())
                corr = float(np.corrcoef(pred, mkt)[0, 1])
                mkt_sd = float((act - mkt).std())
                results.append((sd, lam, hl, cap, bias, corr, mkt_sd))
                print(f"  {lam:>6.1f} {hl:>9.0f} {cap:>5.0f} {sd:>9.2f} {bias:>7.2f} "
                      f"{corr:>6.3f}  {sd - mkt_sd:>+10.2f}")

    results.sort()
    sd, lam, hl, cap, bias, corr, mkt_sd = results[0]
    print(f"\n  BEST: lam={lam:g} halflife={hl:g}d cap={cap:g}")
    print(f"        model sd {sd:.2f} vs market {mkt_sd:.2f}  "
          f"({sd - mkt_sd:+.2f}), bias {bias:+.2f}, corr {corr:.3f}")
    print(f"\n  The market is still {'ahead' if sd > mkt_sd else 'BEHIND'}. "
          f"That is expected and is NOT\n  a failure: step 3 asks whether "
          f"model-minus-market predicts margin-minus-market,\n  which is a "
          f"different question from beating it outright.\n")
    return 0


if __name__ == "__main__":
    import asyncio
    raise SystemExit(asyncio.run(main()))
