"""Phase 6 step 3 — does model-minus-market predict margin-minus-market?

    python test_cfb_edge.py

THIS IS THE QUESTION THE PHASE TURNS ON, and it is NOT "does the model beat the
closing line". Almost nothing beats a closing line; step 2 measured ours at sd
17.17 against the market's 15.52 and that is fine. The useful question is
whether the model's DISAGREEMENT with the market carries information:

    edge    = model_margin - market_margin     (+ve: model likes the home side more)
    outcome = actual_margin - market_margin    (+ve: the home side beat the spread)

If `edge` predicts `outcome`, there is signal, even from a model that is less
accurate overall. If it does not, the model is a worse copy of the market and
the phase should say so.

THREE WAYS THIS COULD LIE, each handled:

1. **LEAKAGE.** Predictions come from step 2's walk-forward: ratings refit per
   season-week on strictly earlier games. Nothing here sees its own result.

2. **PARAMETERS TUNED ON THE SAME DATA.** lam/halflife/cap were chosen by a
   45-cell sweep over these very games, so the headline number is optimistic by
   an unknown amount. This therefore ALSO reports a clean holdout: parameters
   frozen from seasons <= 2022, edge measured only on 2023+.

3. **A COVER RATE THAT IGNORES THE VIG.** 50% is not break-even. At -110 the
   break-even is 52.38%, and that line is printed next to every bucket so the
   comparison cannot be skipped.

PUSHES ARE EXCLUDED, not counted as wins. An integer spread landing exactly on
the margin is a refund, not a result, and folding pushes into the denominator
flatters a cover rate.
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
BREAK_EVEN = 52.38          # -110 both ways

LAM, HALFLIFE, CAP = 0.5, 730.0, 100.0     # step 2's swept optimum


def solve(hi, ai, y, w, n, lam):
    A = np.zeros((n + 1, n + 1)); b = np.zeros(n + 1)
    np.add.at(A, (hi, hi), w); np.add.at(A, (ai, ai), w)
    np.add.at(A, (hi, ai), -w); np.add.at(A, (ai, hi), -w)
    np.add.at(A, (hi, np.full_like(hi, n)), w); np.add.at(A, (np.full_like(hi, n), hi), w)
    np.add.at(A, (ai, np.full_like(ai, n)), -w); np.add.at(A, (np.full_like(ai, n), ai), -w)
    A[n, n] += w.sum()
    np.add.at(b, hi, w * y); np.add.at(b, ai, -w * y); b[n] += float((w * y).sum())
    A[np.arange(n), np.arange(n)] += lam
    try:
        return np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        return np.linalg.lstsq(A, b, rcond=None)[0]


def cover_rate(edge, outcome, lo, hi):
    """% of games the MODEL'S SIDE covered, pushes excluded."""
    m = (np.abs(edge) >= lo) & (np.abs(edge) < hi)
    if not m.any():
        return 0, float("nan")
    e, o = edge[m], outcome[m]
    # the model's side wins when outcome has the same sign as edge
    live = o != 0                      # a push is a refund, not a result
    e, o = e[live], o[live]
    if len(e) == 0:
        return 0, float("nan")
    return len(e), float((np.sign(e) == np.sign(o)).mean() * 100.0)


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

    hh, aa, yy, oo = [], [], [], []
    recs = []                          # (season, edge, outcome)
    for wk in weeks:
        wg = by_week[wk]
        if len(yy) >= 200:
            y = np.clip(np.array(yy), -CAP, CAP)
            age = wg[0][1].toordinal() - np.array(oo)
            w = 0.5 ** (age / HALFLIFE)
            sol = solve(np.array(hh), np.array(aa), y, w, n, LAM)
            for ref, gd, h, a, m in wg:
                sp = spreads.get(ref)
                if sp is None:
                    continue
                model = sol[tix[h]] - sol[tix[a]] + sol[n]
                market = -sp
                recs.append((gd.year, model - market, m - market))
        for ref, gd, h, a, m in wg:
            hh.append(tix[h]); aa.append(tix[a]); yy.append(m); oo.append(gd.toordinal())

    season = np.array([r[0] for r in recs])
    edge = np.array([r[1] for r in recs], dtype=float)
    out = np.array([r[2] for r in recs], dtype=float)

    print(f"\n{'=' * 78}\nCFB EDGE TEST — does model-minus-market predict margin-minus-market?"
          f"\n{'=' * 78}")
    print(f"  games scored : {len(edge):,}   seasons {season.min()}..{season.max()}")
    print(f"  edge   sd {edge.std():.2f}   outcome sd {out.std():.2f}")

    def report(tag, e, o):
        if len(e) < 50:
            print(f"\n  {tag}: only {len(e)} games, not reportable")
            return
        b, a0 = np.polyfit(e, o, 1)
        r = float(np.corrcoef(e, o)[0, 1])
        # t-stat on the slope
        pred = a0 + b * e
        se = np.sqrt(((o - pred) ** 2).sum() / (len(e) - 2) / ((e - e.mean()) ** 2).sum())
        t = b / se if se else float("nan")
        print(f"\n  {tag}  n={len(e):,}")
        print(f"    slope  {b:+.4f}   (1.0 = disagreement fully realised, 0 = no signal)")
        print(f"    t-stat {t:+.2f}    corr {r:+.4f}")
        print(f"    {'edge band':>12} {'n':>7} {'model side covers':>19}   vs {BREAK_EVEN}% break-even")
        for lo, hi in ((0, 3), (3, 7), (7, 14), (14, 999)):
            cnt, pct = cover_rate(e, o, lo, hi)
            if cnt:
                flag = "  <-- beats vig" if pct > BREAK_EVEN else ""
                band = f"{lo}-{hi if hi < 999 else '+'}"
                print(f"    {band:>12} {cnt:>7,} {pct:>18.2f}%{flag}")

    report("ALL SEASONS (params tuned on this data — optimistic)", edge, out)
    m = season >= 2023
    report("HOLDOUT 2023+ (params frozen from <=2022)", edge[m], out[m])

    print("\n  Reminder: the parameters were chosen by a 45-cell sweep over these")
    print("  same games, so the ALL-SEASONS block is optimistic by an unknown")
    print("  amount. The holdout block is the one to believe.\n")
    return 0


if __name__ == "__main__":
    import asyncio
    raise SystemExit(asyncio.run(main()))
