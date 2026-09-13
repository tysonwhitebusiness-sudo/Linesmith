"""Phase 6 step 3c — is the high-edge band real, or the best of sixteen cells?

    python test_cfb_high_edge.py

WHY THIS EXISTS. The clean holdout (params chosen on <=2022, evaluated 2023+)
showed cover rates rising monotonically with edge size: 50.49 / 50.91 / 52.00 /
52.77%, the last on n=650 against a 52.38% break-even. That is either a small
real signal or the largest of sixteen reported cells. The difference matters
enough to test directly rather than argue about.

FOUR WAYS IT COULD BE AN ILLUSION, each checked here:

1. **IT IS ONE CELL OUT OF MANY.** Sixteen bands were reported across four
   configurations. Picking the best afterwards is selection, not evidence. So
   this sweeps the threshold continuously -- if the effect is real it should
   strengthen or at least persist as the threshold rises, not spike at exactly
   the one already reported.

2. **IT MAY LIVE IN ONE SEASON.** A single lucky year inside a four-year holdout
   would produce this. Reported season by season, with counts.

3. **IT MAY BE ONE-SIDED.** If every high-edge pick is on home underdogs, the
   "edge" is a stale home-field or dog bias in the rating, not team strength.
   Split by side.

4. **BIG DISAGREEMENT USUALLY MEANS THE MODEL IS WRONG.** A 14-point gap from
   the market most often means a team with thin history, an early-season game,
   or an FCS opponent -- cases where the rating is unreliable rather than
   insightful. Reported by week-of-season and by spread size.

Wilson intervals throughout, because a normal approximation on a proportion near
0.5 with n in the hundreds is exactly where it misleads.
"""
from __future__ import annotations

import csv
import math
import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))
sys.path.insert(0, HERE)

from sweep_cfb_ratings import solve                            # noqa: E402

TRAIN_CSV = os.path.join(HERE, "cfb_train.csv")
BREAK_EVEN = 0.5238
# Chosen on seasons <= 2022 ONLY. Evaluation is 2023+ and never informed these.
LAM, HALFLIFE, CAP = 0.5, 0.0, 100.0


def wilson(k, n, z=1.96):
    if n == 0:
        return (float("nan"), float("nan"))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def line(label, k, n):
    if n < 20:
        return f"    {label:<22} n={n:>5,}   too few"
    p = k / n
    lo, hi = wilson(k, n)
    verdict = "BEATS" if lo > BREAK_EVEN else ("spans" if hi > BREAK_EVEN else "below")
    return (f"    {label:<22} n={n:>5,}   {p*100:>6.2f}%   "
            f"95% CI [{lo*100:5.2f}, {hi*100:5.2f}]   {verdict}")


async def main() -> int:
    import asyncio
    import db

    spreads = {}
    with open(TRAIN_CSV, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            spreads[r["event_ref"]] = float(r["close_spread"])

    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        gr = await conn.fetch(
            """SELECT event_ref, game_date, home_team_id, away_team_id, home_score, away_score
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
             for r in gr]
    teams = sorted({g[2] for g in games} | {g[3] for g in games})
    tix = {t: i for i, t in enumerate(teams)}
    n_t = len(teams)
    byw = defaultdict(list)
    for g in games:
        byw[(g[1].year, g[1].isocalendar()[1])].append(g)
    weeks = sorted(byw)

    hh, aa, yy, oo = [], [], [], []
    rec = []          # season, week_idx, edge, outcome, spread
    season_week = defaultdict(int)
    for wk in weeks:
        wg = byw[wk]
        season_week[wk[0]] += 1
        if len(yy) >= 200:
            y = np.clip(np.array(yy), -CAP, CAP)
            w = (0.5 ** ((wg[0][1].toordinal() - np.array(oo)) / HALFLIFE)
                 if HALFLIFE else np.ones_like(y))
            sol = solve(np.array(hh), np.array(aa), y, w, n_t, LAM)
            for ref, gd, h, a, m in wg:
                sp = spreads.get(ref)
                if sp is None:
                    continue
                mk = -sp
                rec.append((gd.year, season_week[wk[0]],
                            sol[tix[h]] - sol[tix[a]] + sol[n_t] - mk, m - mk, sp))
        for ref, gd, h, a, m in wg:
            hh.append(tix[h]); aa.append(tix[a]); yy.append(m); oo.append(gd.toordinal())

    rec = [r for r in rec if r[0] >= 2023 and r[3] != 0]        # holdout, pushes dropped
    yr = np.array([r[0] for r in rec]); wkn = np.array([r[1] for r in rec])
    e = np.array([r[2] for r in rec]); o = np.array([r[3] for r in rec])
    sp = np.array([r[4] for r in rec])
    win = np.sign(e) == np.sign(o)

    print(f"\n{'=' * 78}\nCFB HIGH-EDGE BAND — is it real?\n{'=' * 78}")
    print(f"  clean holdout 2023+, params from <=2022 only (lam={LAM:g}, hl={HALFLIFE:g})")
    print(f"  games (pushes dropped): {len(e):,}     break-even {BREAK_EVEN*100:.2f}%\n")

    print("  1. THRESHOLD SWEEP — a real effect should persist, not spike at 14")
    for thr in (8, 10, 12, 14, 16, 18, 20, 25):
        m = np.abs(e) >= thr
        print(line(f"|edge| >= {thr}", int(win[m].sum()), int(m.sum())))

    print("\n  2. BY SEASON at |edge| >= 14 — one lucky year would show here")
    m14 = np.abs(e) >= 14
    for y in sorted(set(yr[m14].tolist())):
        s = m14 & (yr == y)
        print(line(f"{y}", int(win[s].sum()), int(s.sum())))

    print("\n  3. BY SIDE at |edge| >= 14 — a one-sided 'edge' is a stale bias")
    for lbl, s in (("model likes HOME", m14 & (e > 0)), ("model likes AWAY", m14 & (e < 0))):
        print(line(lbl, int(win[s].sum()), int(s.sum())))

    print("\n  4. WHAT KIND OF GAMES ARE THESE?")
    print(f"    mean |spread| at |edge|>=14 : {np.abs(sp[m14]).mean():.1f} "
          f"(vs {np.abs(sp).mean():.1f} overall)")
    early = m14 & (wkn <= 4)
    late = m14 & (wkn > 4)
    print(line("weeks 1-4 of season", int(win[early].sum()), int(early.sum())))
    print(line("week 5+", int(win[late].sum()), int(late.sum())))

    print("\n  5. PROFITABILITY at -110, |edge| >= 14")
    k, nn = int(win[m14].sum()), int(m14.sum())
    roi = (k * (100 / 110) - (nn - k)) / nn if nn else float("nan")
    print(f"    record {k}-{nn-k}   ROI {roi*100:+.2f}% per unit staked")
    print(f"    (a 52.38% cover is exactly 0.00%; anything inside the CI above is\n"
          f"     consistent with losing money)")
    print()
    return 0


if __name__ == "__main__":
    import asyncio
    raise SystemExit(asyncio.run(main()))
