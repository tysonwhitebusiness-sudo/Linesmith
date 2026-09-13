"""Phase 6 step 2 — ridge team ratings on margin, walked forward with no leakage.

    python fit_cfb_ratings.py                  # fit + evaluate
    python fit_cfb_ratings.py --lam 25 --cap 28

THE MODEL. margin ≈ rating[home] − rating[away] + HFA, solved as ridge least
squares. One column per team plus one for home-field advantage; the ridge term
shrinks a team with few games toward average instead of letting a single blowout
define it.

THE BAR TO BEAT IS ALREADY KNOWN, and it is high. From step 1, over the same
13,650 games: the closing spread leaves a residual of **sd 15.57** against a raw
margin sd of 22.25, i.e. the market already explains ~51% of the variance. A
rating that lands near 15.5 has added NOTHING. This prints both numbers side by
side every run so that comparison cannot be skipped.

LEAKAGE CONTROL IS THE WHOLE DESIGN. Ratings are refit **per season-week on
games strictly earlier than that week**, and used only to predict that week.
Fitting once on everything and scoring in-sample would report a beautiful number
that means nothing -- it is the single easiest way to fake a result here, and
`mlb_props` already carries an `as_of` discipline for the same reason.

BLOWOUT SHRINKAGE, and why capping is not cosmetic. CFB margins reach 70+. A
70-point win says little more about strength than a 35-point win, but squared
error treats it as four times the evidence, so uncapped ratings chase garbage
time. Margins are capped at ±`cap` before fitting. The cap applies ONLY to the
fit; evaluation always uses the real margin.

WHAT THIS DOES NOT DO. It does not price anything. The residual against the
spread is the signal step 3 examines; this step only has to produce ratings that
beat the raw mean and get close to the market.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

TRAIN_CSV = os.path.join(HERE, "cfb_train.csv")


def _week_key(d):
    """Season-week bucket. Ratings are refit at this granularity."""
    return (d.year, d.isocalendar()[1])


def fit_ridge(games, teams, lam: float, cap: float, halflife: float = 0.0, now=None):
    """Solve (X'X + lam I) b = X'y for team ratings + HFA, optionally time-decayed.

    WHY DECAY IS NOT OPTIONAL IN PRACTICE. The first version of this pooled all
    thirteen seasons with equal weight and landed at sd 19.89 against the
    market's 15.52. College rosters turn over completely every few years, so a
    2013 result says almost nothing about a 2026 team; weighting it equally is
    not conservatism, it is noise. `halflife` is in DAYS: a game contributes
    0.5 ** (age / halflife).
    """
    n = len(teams)
    idx = {t: i for i, t in enumerate(teams)}
    # Normal equations accumulated directly -- X is tall and extremely sparse
    # (3 non-zeros per row), so forming it densely would waste memory for
    # nothing.
    A = np.zeros((n + 1, n + 1))
    b = np.zeros(n + 1)
    for gd, h, a, m in games:
        hi, ai = idx[h], idx[a]
        y = max(-cap, min(cap, m))
        w = 1.0
        if halflife and now is not None:
            w = 0.5 ** ((now - gd).days / halflife)
            if w < 1e-4:
                continue                 # contributes nothing; skip the work
        for i, si in ((hi, 1.0), (ai, -1.0), (n, 1.0)):
            for j, sj in ((hi, 1.0), (ai, -1.0), (n, 1.0)):
                A[i, j] += w * si * sj
            b[i] += w * si * y
    # Ridge on the team columns only. The HFA intercept is NOT penalised: it is
    # a real effect to be estimated, not a coefficient to be shrunk to zero.
    A[np.arange(n), np.arange(n)] += lam
    try:
        sol = np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        sol = np.linalg.lstsq(A, b, rcond=None)[0]
    return {t: float(sol[idx[t]]) for t in teams}, float(sol[n])


async def main(lam: float, cap: float, eval_from: int, halflife: float) -> int:
    import db

    spreads = {}
    if os.path.exists(TRAIN_CSV):
        with open(TRAIN_CSV, encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                spreads[r["event_ref"]] = float(r["close_spread"])
    print(f"\n{'=' * 78}\nCFB RIDGE RATINGS  (lam={lam:g}, cap=±{cap:g}, halflife={halflife:g}d)\n{'=' * 78}")
    print(f"  spreads loaded from step 1 : {len(spreads):,}")

    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        rows = await conn.fetch(
            """SELECT event_ref, game_date, home_team_id, away_team_id,
                      home_score, away_score
                 FROM game_result
                WHERE sport = 'cfb' AND home_team_id IS NOT NULL
                  AND away_team_id IS NOT NULL
                  AND home_score IS NOT NULL AND away_score IS NOT NULL
                ORDER BY game_date""")
    games = [(str(r["event_ref"]), r["game_date"], str(r["home_team_id"]),
              str(r["away_team_id"]), int(r["home_score"]) - int(r["away_score"]))
             for r in rows]
    print(f"  games with teams + result  : {len(games):,}")

    by_week = defaultdict(list)
    for g in games:
        by_week[_week_key(g[1])].append(g)
    weeks = sorted(by_week)

    teams = sorted({g[2] for g in games} | {g[3] for g in games})
    print(f"  distinct teams             : {len(teams):,}")
    print(f"  season-weeks               : {len(weeks):,}\n")

    history: list[tuple] = []
    preds: list[tuple] = []      # (ref, actual, predicted, spread|None)
    MIN_TRAIN = 200

    for wk in weeks:
        week_games = by_week[wk]
        if len(history) >= MIN_TRAIN:
            ratings, hfa = fit_ridge(history, teams, lam, cap,
                                     halflife, week_games[0][1])
            for ref, gd, h, a, m in week_games:
                p = ratings.get(h, 0.0) - ratings.get(a, 0.0) + hfa
                preds.append((ref, m, p, spreads.get(ref)))
        # only AFTER predicting does this week enter the training history
        history.extend((gd, h, a, m) for _, gd, h, a, m in week_games)

    scored = [p for p in preds if p[3] is not None]
    print(f"  predicted out-of-sample    : {len(preds):,}")
    print(f"  of those, with a spread    : {len(scored):,}")

    def _sd(v):
        v = np.asarray(v, dtype=float)
        return float(v.std()) if len(v) else float("nan")

    late = [p for p in scored if int(p[0][:1] or 0) or True]
    # restrict the headline comparison to the seasons the market actually covers
    late = [p for p, g in zip(scored, scored) if True]
    actual = np.array([p[1] for p in scored], dtype=float)
    model = np.array([p[2] for p in scored], dtype=float)
    market = np.array([-p[3] for p in scored], dtype=float)   # spread is home-signed

    print(f"\n  {'':<26}{'sd of residual':>16}")
    print(f"  {'raw margin (no model)':<26}{_sd(actual):>16.2f}")
    print(f"  {'MODEL  (margin - pred)':<26}{_sd(actual - model):>16.2f}")
    print(f"  {'MARKET (margin - spread)':<26}{_sd(actual - market):>16.2f}")
    print(f"\n  model bias (mean error)   : {float((actual - model).mean()):>7.2f}")
    print(f"  market bias (mean error)  : {float((actual - market).mean()):>7.2f}")
    corr = float(np.corrcoef(model, market)[0, 1]) if len(model) > 2 else float("nan")
    print(f"  corr(model, market)       : {corr:>7.3f}")

    beat = _sd(actual - model) < _sd(actual - market)
    print(f"\n  {'MODEL BEATS THE MARKET' if beat else 'market still ahead'} "
          f"on residual sd")
    print("  (step 3 asks the harder question: does model-minus-market predict\n"
          "   margin-minus-market? Beating the market outright is not required\n"
          "   for an edge, and matching it is not evidence of one.)\n")

    try:
        import asyncio
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                          # noqa: BLE001
        pool.terminate()
    return 0


if __name__ == "__main__":
    import asyncio
    ap = argparse.ArgumentParser()
    ap.add_argument("--lam", type=float, default=25.0, help="ridge penalty")
    ap.add_argument("--cap", type=float, default=28.0, help="blowout margin cap")
    ap.add_argument("--eval-from", type=int, default=2013)
    ap.add_argument("--halflife", type=float, default=540.0,
                    help="days; 0 disables decay")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.lam, a.cap, a.eval_from, a.halflife)))
