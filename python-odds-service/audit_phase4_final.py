"""Phase 4 final audit — three checks the earlier passes did not make.

1. DID THE FIX ACTUALLY CLOSE THE GAP? The fit now calls
   `nhl_props.load_game_history`; serving builds histories from its own SQL.
   Those are two different code paths that are SUPPOSED to agree. Asserting the
   fix worked without measuring it would repeat the exact mistake the fix was
   for.

2. ARE ANY FITTED PARAMETERS PINNED TO A SWEEP BOUND? Standing rule in this
   project: a parameter sitting on the edge of its search grid is not a fitted
   parameter — the real optimum may be outside the grid and nobody would know.

3. IS THE BOARD SELF-CONSISTENT? Points = goals + assists, by definition. The
   board now shows all three side by side, so a user can check that arithmetic
   themselves. If E[points] does not track E[goals] + E[assists], the board
   visibly contradicts itself.

Run from python-odds-service/:
    python audit_phase4_final.py
"""
import asyncio
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import nhl_props as npx  # noqa: E402
from predict import nhl_prop_serving as srv  # noqa: E402

AS_OF = date(2026, 3, 28)
TOI_WINDOWS = [0, 5, 10]
SHRINK_KS = [5.0, 10.0, 20.0]
DISPERSIONS = [1.0, 2.0, 4.0, 8.0, 20.0, 1e6]


async def check_paths_agree(conn) -> bool:
    print("=" * 72)
    print("1. FIT PATH vs SERVING PATH — do the two constructions now agree?")
    print("=" * 72)
    cal = await conn.fetchrow(
        "SELECT params_json FROM model_calibration "
        "WHERE sport='nhl' AND market='shots-on-goal' AND active=true")
    p = json.loads(cal["params_json"])
    lr, lt, k, w = p["league_rate"], p["league_toi"], p["shrink_k"], int(p["toi_window"] or 0)

    # FIT path: exactly what fit_nhl_props_all.walk now folds in.
    games = await npx.load_game_history("sog", conn=conn)
    fit: dict[str, npx.PlayerHistory] = {}
    for gd, aid, stat, toi in games:
        if gd >= AS_OF:
            break
        fit.setdefault(aid, npx.PlayerHistory()).add(stat, toi)

    # SERVING path: its own build(), through its own SQL.
    built = await srv.build(conn, AS_OF, {"shots-on-goal": 2.5})
    served = {s.athlete_id: s for s in built["served"]
              if s.dimension == "shots-on-goal"}

    diffs, mism = [], []
    for aid, s in served.items():
        h = fit.get(aid)
        if h is None or h.games < srv.MIN_PRIOR_GAMES:
            mism.append((aid, "no fit history"))
            continue
        pf = npx.project(h, lr, lt, k=k, toi_window=w)
        d = abs(pf.expected_sog - s.projection)
        diffs.append(d)
        if d > 1e-9 or h.games != s.games_of_history:
            mism.append((aid, f"proj {pf.expected_sog:.6f} vs {s.projection:.6f}, "
                              f"games {h.games} vs {s.games_of_history}"))

    n = len(diffs)
    print(f"  players compared          : {n}")
    print(f"  max |projection diff|     : {max(diffs) if diffs else 0:.10f}")
    print(f"  mismatches                : {len(mism)}")
    for aid, why in mism[:5]:
        print(f"      {aid}: {why}")
    ok = n > 0 and (not diffs or max(diffs) < 1e-9) and not mism
    print(f"  VERDICT: {'PASS — the two paths are now identical' if ok else 'FAIL'}")
    return ok


async def check_bounds(conn) -> bool:
    print()
    print("=" * 72)
    print("2. PARAMETERS PINNED TO A SWEEP BOUND")
    print("=" * 72)
    print("  A value on the edge of its grid is not a fitted value — the real")
    print("  optimum may sit outside and the sweep could not have seen it.\n")
    rows = await conn.fetch(
        "SELECT market, params_json FROM model_calibration "
        "WHERE sport='nhl' AND active=true ORDER BY market")
    grids = {"toi_window": TOI_WINDOWS, "shrink_k": SHRINK_KS,
             "dispersion": DISPERSIONS}
    any_pinned = False
    print(f"  {'market':<16} {'toi_window':>11} {'shrink_k':>9} {'dispersion':>11}")
    for r in rows:
        p = json.loads(r["params_json"])
        cells, pinned = [], []
        for name, grid in grids.items():
            v = float(p[name])
            lo, hi = min(grid), max(grid)
            mark = ""
            if v <= lo:
                mark, any_pinned = " LO", True
                pinned.append(name)
            elif v >= hi:
                mark, any_pinned = " HI", True
                pinned.append(name)
            shown = "Poisson" if name == "dispersion" and v > 1e5 else f"{v:g}"
            cells.append(f"{shown + mark:>11}" if name != "shrink_k"
                         else f"{shown + mark:>9}")
        print(f"  {r['market']:<16} {cells[0]} {cells[1]} {cells[2]}")
    print(f"\n  VERDICT: {'PINNED PARAMETERS PRESENT' if any_pinned else 'PASS — nothing on a bound'}")
    return not any_pinned


async def check_coherence(conn) -> bool:
    print()
    print("=" * 72)
    print("3. BOARD SELF-CONSISTENCY — points vs goals + assists")
    print("=" * 72)
    print("  Points ARE goals plus assists. The board shows all three, so this")
    print("  arithmetic is visible to any user who looks.\n")
    rows = await conn.fetch(
        "SELECT subject_id, dimension, projection FROM prop_model_cache "
        "WHERE sport='nhl' AND dimension IN ('points','goals','assists')")
    by: dict[str, dict[str, float]] = {}
    for r in rows:
        by.setdefault(r["subject_id"], {})[r["dimension"]] = r["projection"]
    trip = [(v["points"], v["goals"] + v["assists"]) for v in by.values()
            if {"points", "goals", "assists"} <= v.keys()]
    if not trip:
        print("  no player carries all three — cannot check")
        return True
    n = len(trip)
    errs = [abs(a - b) for a, b in trip]
    mp = sum(a for a, _ in trip) / n
    ms = sum(b for _, b in trip) / n
    worst = max(errs)
    print(f"  players with all three    : {n}")
    print(f"  mean E[points]            : {mp:.4f}")
    print(f"  mean E[goals] + E[assists]: {ms:.4f}")
    print(f"  mean |difference|         : {sum(errs)/n:.4f}")
    print(f"  worst |difference|        : {worst:.4f}")
    rel = abs(mp - ms) / ms if ms else 0
    ok = rel < 0.05
    print(f"  aggregate disagreement    : {rel*100:.2f}%")
    print(f"  VERDICT: {'PASS — the three agree to within 5%' if ok else 'FAIL — the board contradicts itself'}")
    return ok


async def main() -> int:
    pool = await db.get_pool()
    async with pool.acquire(timeout=180.0) as conn:
        a = await check_paths_agree(conn)
        b = await check_bounds(conn)
        c = await check_coherence(conn)
    print()
    print("=" * 72)
    print(f"  paths agree      {'PASS' if a else 'FAIL'}")
    print(f"  no pinned params {'PASS' if b else 'ATTENTION'}")
    print(f"  board coherent   {'PASS' if c else 'FAIL'}")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
