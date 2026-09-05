"""Phase 4 audit — is the SERVED model the model that was VALIDATED?

The walk-forward in `fit_nhl_props_all.py` builds each player's history by
walking the PROP ROWS: a player accumulates history only from games that
happened to carry a prop line. The serving path in `nhl_prop_serving.py` builds
history from EVERY row of `player_game_history`.

If those two produce materially different histories, the projection on the board
is not the projection that was measured — the gate would have been passed by one
model and the board would be showing another. This measures the gap instead of
assuming either way.

Run from python-odds-service/:
    python audit_fit_vs_serve.py
"""
import asyncio
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import nhl_props as npx  # noqa: E402

AS_OF = date(int(sys.argv[1][:4]), int(sys.argv[1][5:7]), int(sys.argv[1][8:10])) if len(sys.argv) > 1 else date(2026, 1, 14)
MARKET = "Total Shots on Goal"
DIM = "shots-on-goal"


async def main() -> int:
    pool = await db.get_pool()
    async with pool.acquire(timeout=120.0) as conn:
        cal = await conn.fetchrow(
            "SELECT params_json FROM model_calibration "
            "WHERE sport='nhl' AND market=$1 AND active=true", DIM)
        p = json.loads(cal["params_json"])
        lr, lt, k, w = p["league_rate"], p["league_toi"], p["shrink_k"], int(p["toi_window"] or 0)
        print(f"active calibration: league_rate={lr:.5f} league_toi={lt:.2f} "
              f"shrink_k={k} toi_window={w or 'all'}\n")

        # --- history as SERVING builds it: every game before AS_OF ----------
        rows = await conn.fetch(
            "SELECT athlete_id, stats FROM player_game_history "
            "WHERE sport='nhl' AND game_date < $1 ORDER BY game_date", AS_OF)
        serve: dict[str, npx.PlayerHistory] = {}
        for r in rows:
            st = r["stats"]
            if isinstance(st, str):
                st = json.loads(st or "{}")
            if st.get("isGoalie") or "sog" not in st or "toiMinutes" not in st:
                continue
            serve.setdefault(str(r["athlete_id"]), npx.PlayerHistory()).add(
                float(st["sog"]), float(st["toiMinutes"]))

    # --- history as the FIT builds it: prop rows only, in order -------------
    d = await npx.load_shot_props(market=MARKET)
    fit: dict[str, npx.PlayerHistory] = {}
    for r in d["rows"]:
        if r.played >= AS_OF:
            break
        fit.setdefault(r.athlete_id, npx.PlayerHistory()).add(r.actual_sog, r.toi)

    shared = sorted(set(fit) & set(serve))
    print(f"players with history in BOTH constructions: {len(shared)}")
    print(f"  fit-only history: {len(set(fit) - set(serve))}   "
          f"serve-only: {len(set(serve) - set(fit))}\n")

    if not shared:
        print("no overlap — cannot compare")
        return 0

    gaps, diffs, worst = [], [], []
    for aid in shared:
        hf, hs = fit[aid], serve[aid]
        if hf.games < 5 or hs.games < 5:
            continue
        pf = npx.project(hf, lr, lt, k=k, toi_window=w)
        ps = npx.project(hs, lr, lt, k=k, toi_window=w)
        gaps.append((hs.games, hf.games))
        diffs.append(abs(ps.expected_sog - pf.expected_sog))
        worst.append((abs(ps.expected_sog - pf.expected_sog), aid,
                      hf.games, hs.games, pf.expected_sog, ps.expected_sog))

    n = len(diffs)
    print(f"comparable players (>=5 games both ways): {n}\n")
    print("HISTORY DEPTH")
    mf = sum(g[1] for g in gaps) / n
    ms = sum(g[0] for g in gaps) / n
    print(f"  mean games, fit  (prop rows only) : {mf:8.1f}")
    print(f"  mean games, serve (all games)     : {ms:8.1f}")
    print(f"  serving sees {ms / mf:.1f}x more history\n")

    print("PROJECTION DIFFERENCE (same player, same date, same constants)")
    diffs.sort()
    print(f"  mean |diff| : {sum(diffs)/n:.4f} shots")
    print(f"  median      : {diffs[n//2]:.4f}")
    print(f"  p90         : {diffs[int(n*0.9)]:.4f}")
    print(f"  max         : {diffs[-1]:.4f}")
    within = sum(1 for x in diffs if x <= 0.10) / n
    print(f"  within 0.10 shots: {within*100:.1f}%\n")

    worst.sort(reverse=True)
    print("LARGEST DISAGREEMENTS")
    print(f"  {'athlete':>10} {'fit_g':>6} {'srv_g':>6} {'fit_proj':>9} {'srv_proj':>9} {'diff':>7}")
    for dd, aid, gf, gs, pf, ps in worst[:8]:
        print(f"  {aid:>10} {gf:>6} {gs:>6} {pf:>9.3f} {ps:>9.3f} {dd:>7.3f}")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
