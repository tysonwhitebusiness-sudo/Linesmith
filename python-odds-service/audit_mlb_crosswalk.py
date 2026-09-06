"""Phase 5.2 — where the MLB athlete crosswalk actually stands, and who is missing.

`build_athlete_crosswalk.py` reports MLB prop-ROW coverage of 96.2%. The board
does not rank rows, it ranks PLAYERS on a slate, so row coverage is the wrong
number to plan against: the unresolved athletes are a long tail carrying few
rows each, and 96.2% of rows can coexist with a much lower share of players.

This measures all three, separately, and then names who is missing.

Run from python-odds-service/:
    python audit_mlb_crosswalk.py
"""
import asyncio
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402

SLATES = [date(2026, 7, 4), date(2026, 8, 20), date(2025, 7, 4)]


async def main() -> int:
    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        print("Phase 5.2 — MLB crosswalk coverage, three ways\n")

        rows = await conn.fetchval(
            "SELECT count(*) FROM prop_odds_archive WHERE sport='mlb'")
        rows_ok = await conn.fetchval("""
            SELECT count(*) FROM prop_odds_archive p
             WHERE p.sport='mlb' AND EXISTS (
               SELECT 1 FROM athlete_crosswalk x
                WHERE x.sport='mlb' AND x.espn_athlete_id = p.athlete_id)""")
        ath = await conn.fetchval(
            "SELECT count(DISTINCT athlete_id) FROM prop_odds_archive WHERE sport='mlb'")
        ath_ok = await conn.fetchval("""
            SELECT count(*) FROM (
              SELECT DISTINCT athlete_id FROM prop_odds_archive WHERE sport='mlb') a
             WHERE EXISTS (SELECT 1 FROM athlete_crosswalk x
                            WHERE x.sport='mlb' AND x.espn_athlete_id = a.athlete_id)""")
        print(f"  PROP ROWS     {rows_ok:>9,} / {rows:>9,}   {rows_ok/rows*100:5.1f}%"
              f"   <- what the builder optimised")
        print(f"  PROP ATHLETES {ath_ok:>9,} / {ath:>9,}   {ath_ok/ath*100:5.1f}%")

        print("\n  SLATE COVERAGE — the number the board actually depends on")
        for d in SLATES:
            r = await conn.fetchrow("""
              WITH s AS (SELECT DISTINCT athlete_id FROM player_game_history
                          WHERE sport='mlb' AND game_date=$1)
              SELECT count(*) tot, count(x.athlete_id) named
                FROM s LEFT JOIN athlete_crosswalk x
                  ON x.sport='mlb' AND x.athlete_id = s.athlete_id""", d)
            if r["tot"]:
                print(f"    {d}  {r['named']:>4}/{r['tot']:>4}   "
                      f"{r['named']/r['tot']*100:5.1f}%")

        # The gap is not uniform: a crosswalk row can exist while the player has
        # no history, and vice versa. Both directions matter for a board.
        print("\n  WHICH DIRECTION IS MISSING")
        no_xw = await conn.fetchval("""
            SELECT count(*) FROM (
              SELECT DISTINCT athlete_id FROM player_game_history
               WHERE sport='mlb' AND game_date >= '2025-03-01') g
             WHERE NOT EXISTS (SELECT 1 FROM athlete_crosswalk x
                                WHERE x.sport='mlb' AND x.athlete_id = g.athlete_id)""")
        tot_g = await conn.fetchval("""
            SELECT count(DISTINCT athlete_id) FROM player_game_history
             WHERE sport='mlb' AND game_date >= '2025-03-01'""")
        print(f"    players with 2025+ history and NO crosswalk row: {no_xw:,} / {tot_g:,}")

        no_hist = await conn.fetchval("""
            SELECT count(*) FROM (
              SELECT DISTINCT athlete_id FROM prop_odds_archive WHERE sport='mlb') a
             LEFT JOIN athlete_crosswalk x
                    ON x.sport='mlb' AND x.espn_athlete_id = a.athlete_id
             WHERE x.athlete_id IS NULL""")
        print(f"    prop athletes with NO crosswalk row:            {no_hist:,} / {ath:,}")

        # How much do the unresolved actually matter? A tail of one-row athletes
        # is a different problem from a handful of regulars.
        print("\n  HOW MUCH THE UNRESOLVED PROP ATHLETES MATTER")
        r = await conn.fetchrow("""
            WITH un AS (
              SELECT p.athlete_id, count(*) n FROM prop_odds_archive p
               WHERE p.sport='mlb' AND p.athlete_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM athlete_crosswalk x
                                  WHERE x.sport='mlb' AND x.espn_athlete_id = p.athlete_id)
               GROUP BY 1)
            SELECT count(*) athletes, sum(n) rows, max(n) worst,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY n) med FROM un""")
        print(f"    {r['athletes']:,} athletes, {r['rows']:,} rows "
              f"({r['rows']/rows*100:.1f}% of all MLB prop rows)")
        print(f"    median rows each {float(r['med'] or 0):.0f}, worst {r['worst']:,}")

        # NULL athlete_id turned up on the first run. A row with no athlete at
        # all cannot be crosswalked and is not a crosswalk failure — counted
        # separately rather than charged against coverage.
        nullish = await conn.fetchrow("""
            SELECT count(*) n, count(DISTINCT type_name) mkts FROM prop_odds_archive
             WHERE sport='mlb' AND athlete_id IS NULL""")
        print(f"\n  ROWS WITH NO athlete_id AT ALL: {nullish['n']:,} across "
              f"{nullish['mkts']} markets")
        for t in await conn.fetch("""
            SELECT type_name, count(*) n FROM prop_odds_archive
             WHERE sport='mlb' AND athlete_id IS NULL
             GROUP BY 1 ORDER BY 2 DESC LIMIT 6"""):
            print(f"    {t['type_name']:<36} {t['n']:>7,}")

        print("\n  THE 12 UNRESOLVED ATHLETES WITH THE MOST PROP ROWS")
        top = await conn.fetch("""
            SELECT p.athlete_id, count(*) n, min(p.game_date) lo, max(p.game_date) hi
              FROM prop_odds_archive p
             WHERE p.sport='mlb' AND p.athlete_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM athlete_crosswalk x
                                WHERE x.sport='mlb' AND x.espn_athlete_id = p.athlete_id)
             GROUP BY 1 ORDER BY 2 DESC LIMIT 12""")
        for t in top:
            print(f"    espn {t['athlete_id']:>9}  {t['n']:>6,} rows  "
                  f"{t['lo']} -> {t['hi']}")

        print("\n  MATCH METHODS ON THE EXISTING ROWS")
        for m in await conn.fetch("""
            SELECT match_method, count(*) n,
                   count(verified_game_date) verified
              FROM athlete_crosswalk WHERE sport='mlb'
             GROUP BY 1 ORDER BY 2 DESC"""):
            print(f"    {str(m['match_method']):<22} {m['n']:>5,}   "
                  f"verified against a real game: {m['verified']:>5,}")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
