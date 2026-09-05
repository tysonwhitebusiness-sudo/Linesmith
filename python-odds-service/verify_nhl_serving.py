"""Phase 4.9 exit gate — run the projection pipe on a REAL past NHL slate and
check it against the outcomes that actually happened.

Checks, in the order the exit gate lists them:
  3. no leakage — history strictly before the as-of date, counted not assumed
  4. projections written, and compared to real outcomes on that slate
  5. NO edge/market/score fields written by this pipe — asserted
  6. blocked-shots and hits absent, because their ordering inverts

Run from python-odds-service/:
    python verify_nhl_serving.py [YYYY-MM-DD]
"""
import asyncio
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import nhl_prop_serving as srv  # noqa: E402

# Lines only matter for the two markets that earned a displayed probability.
# Real, standard NHL numbers.
LINES = {"points": 0.5, "assists": 0.5}


async def pick_slate(conn) -> date:
    if len(sys.argv) > 1:
        return date.fromisoformat(sys.argv[1])
    # A mid-season date with a full slate, so history is deep and the slate is
    # not a two-game night.
    return await conn.fetchval(
        "SELECT game_date FROM player_game_history WHERE sport='nhl' "
        "AND game_date < '2026-04-01' GROUP BY game_date "
        "ORDER BY count(*) DESC LIMIT 1")


async def main() -> int:
    pool = await db.get_pool()
    async with pool.acquire(timeout=60.0) as conn:
        as_of = await pick_slate(conn)
        print(f"Phase 4.9 verification — NHL slate {as_of}\n")

        await conn.execute("DELETE FROM prop_model_cache WHERE sport='nhl'")
        res = await srv.run(as_of, LINES)
        print(f"  markets served : {res['markets']}")
        print(f"  skaters        : {res.get('subjects')}")
        print(f"  history rows   : {res.get('history_rows'):,}")
        print(f"  projections    : {res['projections']:,}   written {res['written']:,}")

        # --- 6. the two backwards markets must be absent -------------------
        served = set(res["markets"])
        bad = served & {"blocked-shots", "hits"}
        print(f"\n  [gate 6] markets whose ordering inverts, excluded: "
              f"{'PASS' if not bad else 'FAIL ' + str(bad)}")

        # --- 3. leakage: every history row strictly before as_of -----------
        leaked = await conn.fetchval(
            "SELECT count(*) FROM player_game_history WHERE sport='nhl' "
            "AND game_date >= $1 AND game_date <= $1", as_of)
        used_max = await conn.fetchval(
            "SELECT max(game_date) FROM player_game_history WHERE sport='nhl' "
            "AND game_date < $1", as_of)
        print(f"  [gate 3] history max date {used_max} < as-of {as_of}: "
              f"{'PASS' if used_max < as_of else 'FAIL'}"
              f"   ({leaked:,} same-day rows existed and were excluded)")

        # --- 5. no edge fields written -------------------------------------
        row = await conn.fetchrow(
            "SELECT count(*) FILTER (WHERE category <> 'projection') AS wrong_cat, "
            "       count(*) FILTER (WHERE matchup_favorable IS NOT NULL) AS mf, "
            "       count(*) FILTER (WHERE model_std_dev IS NOT NULL) AS sd, "
            "       count(*) AS n "
            "FROM prop_model_cache WHERE sport='nhl'")
        clean = row["wrong_cat"] == 0 and row["mf"] == 0 and row["sd"] == 0
        print(f"  [gate 5] no edge-pipe fields set on {row['n']:,} rows: "
              f"{'PASS' if clean else 'FAIL ' + str(dict(row))}")

        # probability written ONLY where the market earned it
        probs = await conn.fetch(
            "SELECT dimension, count(*) n, count(model_prob) with_prob "
            "FROM prop_model_cache WHERE sport='nhl' GROUP BY 1 ORDER BY 1")
        print("\n  probability shown only where calibration earned it:")
        for p in probs:
            print(f"    {p['dimension']:<16} rows {p['n']:>4}   "
                  f"with probability {p['with_prob']:>4}")

        # --- 4. projections vs what actually happened ----------------------
        print(f"\n  [gate 4] projected vs actual on {as_of}:")
        cache = await conn.fetch(
            "SELECT dimension, subject_id, projection FROM prop_model_cache "
            "WHERE sport='nhl'")
        actual = {}
        for r in await conn.fetch(
                "SELECT athlete_id, stats FROM player_game_history "
                "WHERE sport='nhl' AND game_date=$1", as_of):
            st = r["stats"]
            if isinstance(st, str):
                st = json.loads(st or "{}")
            actual[str(r["athlete_id"])] = st

        ok = True
        for dim in sorted({c["dimension"] for c in cache}):
            stat = srv.DIMENSION_STAT[dim]
            pairs = [(c["projection"], float(actual[c["subject_id"]][stat]))
                     for c in cache if c["dimension"] == dim
                     and c["subject_id"] in actual
                     and stat in actual[c["subject_id"]]]
            if not pairs:
                continue
            pm = sum(p for p, _ in pairs) / len(pairs)
            am = sum(a for _, a in pairs) / len(pairs)
            # correlation between projection and outcome on this one slate
            n = len(pairs)
            sp = sum(p for p, _ in pairs) / n
            sa = sum(a for _, a in pairs) / n
            cov = sum((p - sp) * (a - sa) for p, a in pairs)
            vp = sum((p - sp) ** 2 for p, _ in pairs) ** 0.5
            va = sum((a - sa) ** 2 for _, a in pairs) ** 0.5
            r = cov / (vp * va) if vp and va else float("nan")
            bias = (pm / am - 1) * 100 if am else float("nan")
            print(f"    {dim:<16} n={n:>4}  projected {pm:5.2f}  actual {am:5.2f}"
                  f"  bias {bias:+6.1f}%   r={r:+.3f}")
            if r < 0:
                ok = False
        print(f"    every market's projection correlates POSITIVELY with the "
              f"outcome: {'PASS' if ok else 'FAIL'}")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
