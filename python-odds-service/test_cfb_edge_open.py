"""Phase 6 step 3b — the model against the OPENING line, and against line MOVE.

    python test_cfb_edge_open.py

WHY THIS EXISTS AFTER A NEGATIVE RESULT. Step 3 tested the model against the
CLOSING spread and found nothing: holdout slope +0.0068, t=+0.23, no edge band
beating the 52.38% vig. That is the correct headline, but it is also the
HARSHEST POSSIBLE TEST -- a closing line is the price after all information is
in, and nobody can bet it. Two fairer questions the data can answer:

  A. **Versus the OPEN.** Bets are struck at a price that exists in advance.
     Does model-minus-open predict margin-minus-open?

  B. **Does the model anticipate the MARKET?** Does model-minus-open predict
     close-minus-open -- i.e. when the model disagrees with the opening number,
     does the line later move toward the model?

B is the stronger evidence of real information and the weaker evidence of
profit. A model can consistently predict where the line moves (genuine
information the market later incorporates) while still not beating the closing
price. Reporting them separately keeps those two claims apart, because
conflating them is how a "predictive" model turns out to be unbettable.

open_line exists for cfb from 2021 (870/853/873/859/939/143 games by season);
there is none before that, so this is a ~4,500-game test, not a 14,000-game one.

Leakage control is unchanged: ratings still come from the step-2 walk-forward,
refit per season-week on strictly earlier games.
"""
from __future__ import annotations

import os
import sys
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

BREAK_EVEN = 52.38
LAM, HALFLIFE, CAP = 0.5, 730.0, 100.0


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


def report(tag, e, o, unit):
    if len(e) < 50:
        print(f"\n  {tag}: only {len(e)} games, not reportable")
        return
    b, a0 = np.polyfit(e, o, 1)
    pred = a0 + b * e
    se = np.sqrt(((o - pred) ** 2).sum() / (len(e) - 2) / ((e - e.mean()) ** 2).sum())
    t = b / se if se else float("nan")
    print(f"\n  {tag}   n={len(e):,}")
    print(f"    slope  {b:+.4f}    t-stat {t:+.2f}    corr {float(np.corrcoef(e,o)[0,1]):+.4f}   [{unit}]")
    print(f"    {'edge band':>12} {'n':>7} {'model side wins':>17}   break-even {BREAK_EVEN}%")
    for lo, hi in ((0, 3), (3, 7), (7, 14), (14, 999)):
        m = (np.abs(e) >= lo) & (np.abs(e) < hi)
        if not m.any():
            continue
        ee, oo = e[m], o[m]
        live = oo != 0
        ee, oo = ee[live], oo[live]
        if len(ee) < 20:
            continue
        pct = float((np.sign(ee) == np.sign(oo)).mean() * 100.0)
        flag = "  <-- beats vig" if pct > BREAK_EVEN else ""
        band = f"{lo}-{hi if hi < 999 else '+'}"
        print(f"    {band:>12} {len(ee):>7,} {pct:>16.2f}%{flag}")


async def main() -> int:
    import asyncio
    import db
    from corpus_location import corpus_location, read_parquet_glob

    con, glob = read_parquet_glob(corpus_location(), "odds_archive")
    try:
        rows = con.execute("""
            SELECT event_ref,
                   percentile_disc(0.5) WITHIN GROUP (ORDER BY open_line) AS open_sp,
                   percentile_disc(0.5) WITHIN GROUP (ORDER BY line)      AS close_sp
              FROM read_parquet(?)
             WHERE sport='cfb' AND market='spread' AND side='home'
               AND open_line IS NOT NULL AND line IS NOT NULL
               AND abs(open_line) <= 60 AND abs(line) <= 60
             GROUP BY event_ref""", [glob]).fetchall()
    finally:
        con.close()
    lines = {str(r[0]): (float(r[1]), float(r[2])) for r in rows}
    print(f"\n{'=' * 78}\nCFB EDGE vs OPENING LINE\n{'=' * 78}")
    print(f"  games with BOTH an open and a close: {len(lines):,}")

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
    tix = {t: i for i, t in enumerate(teams)}; n = len(teams)
    by_week = defaultdict(list)
    for g in games:
        by_week[(g[1].year, g[1].isocalendar()[1])].append(g)

    hh, aa, yy, oo = [], [], [], []
    E_open, O_out, O_move, yrs = [], [], [], []
    for wk in sorted(by_week):
        wg = by_week[wk]
        if len(yy) >= 200:
            y = np.clip(np.array(yy), -CAP, CAP)
            w = 0.5 ** ((wg[0][1].toordinal() - np.array(oo)) / HALFLIFE)
            sol = solve(np.array(hh), np.array(aa), y, w, n, LAM)
            for ref, gd, h, a, m in wg:
                lv = lines.get(ref)
                if lv is None:
                    continue
                open_sp, close_sp = lv
                model = sol[tix[h]] - sol[tix[a]] + sol[n]
                E_open.append(model - (-open_sp))          # model vs OPEN
                O_out.append(m - (-open_sp))               # result vs OPEN
                O_move.append((-close_sp) - (-open_sp))    # how the market moved
                yrs.append(gd.year)
        for ref, gd, h, a, m in wg:
            hh.append(tix[h]); aa.append(tix[a]); yy.append(m); oo.append(gd.toordinal())

    e = np.array(E_open); out = np.array(O_out); mv = np.array(O_move)
    yr = np.array(yrs)
    print(f"  scored: {len(e):,}   seasons {yr.min() if len(yr) else '-'}..{yr.max() if len(yr) else '-'}")
    print(f"  edge sd {e.std():.2f}   line move sd {mv.std():.2f}")

    report("A. vs OPEN — does edge predict the RESULT?", e, out, "points of margin")
    report("B. vs OPEN — does edge predict the market's own MOVE?", e, mv, "points of line move")
    m23 = yr >= 2024
    report("A. holdout 2024+ (result)", e[m23], out[m23], "points of margin")
    report("B. holdout 2024+ (line move)", e[m23], mv[m23], "points of line move")

    print("\n  B is evidence of INFORMATION; A is evidence of PROFIT. They are not")
    print("  the same claim, and a model can have the first without the second.\n")
    return 0


if __name__ == "__main__":
    import asyncio
    raise SystemExit(asyncio.run(main()))
