"""Phase 5.1 exit gate — the per-market stat-coverage audit.

For every market in `mlb_props.MARKETS`, checks the things that would otherwise
be found at fit time or, worse, on the board:

  A. does the settling stat EXIST in player_game_history, and for how many rows
  B. do the archive's prop rows for it JOIN to a player-game outcome
  C. does the computed outcome look like the market it claims to settle
     (mean outcome vs mean line — NHL's Power Play Points failed exactly here)
  D. is the live naming scheme covered as well as the historical one

Run from python-odds-service/:
    python audit_mlb_markets.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import mlb_props as mp  # noqa: E402


async def main() -> int:
    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        print(f"Phase 5.1 — MLB market audit, {len(mp.MARKETS)} markets modelled, "
              f"{len(mp.EXCLUDED)} excluded\n")

        # The derivations, checked against reality before anything relies on them.
        print("DERIVATIONS")
        neg = await conn.fetchval(f"""
            SELECT count(*) FROM player_game_history
             WHERE sport='mlb' AND stats ? 'bat_hits' AND stats ? 'bat_doubles'
               AND stats ? 'bat_triples' AND stats ? 'bat_homeRuns'
               AND {mp.BY_SLUG['singles'].stat_sql} < 0""")
        print(f"  singles = H - 2B - 3B - HR, rows going NEGATIVE: {neg}"
              f"   {'PASS' if neg == 0 else 'FAIL — the derivation is wrong'}")

        bad_ip = await conn.fetchval("""
            SELECT count(*) FROM player_game_history
             WHERE sport='mlb' AND stats ? 'pit_inningsPitched'
               AND (((stats->>'pit_inningsPitched')::float * 10)::int % 10) > 2""")
        print(f"  pit_inningsPitched fractional parts outside .0/.1/.2: {bad_ip}"
              f"   {'PASS — it is outs notation' if bad_ip == 0 else 'FAIL'}")

        sample = await conn.fetch(f"""
            SELECT stats->>'pit_inningsPitched' ip, {mp._OUTS_SQL} outs
              FROM player_game_history WHERE sport='mlb' AND stats ? 'pit_inningsPitched'
             GROUP BY 1, 2 ORDER BY 2 LIMIT 6""")
        print("  outs conversion:",
              ", ".join(f"{r['ip']}->{int(r['outs'])}" for r in sample))

        print("\nPER-MARKET")
        hdr = (f"  {'market':<22} {'side':<4} {'pgh rows':>10} {'prop rows':>10} "
               f"{'hist':>7} {'live':>7} {'mean out':>9} {'mean line':>9}")
        print(hdr)
        print("  " + "-" * (len(hdr) - 2))
        problems = []
        for spec in mp.MARKETS:
            keys = " AND ".join(f"stats ? '{k}'" for k in spec.required_keys)
            pgh = await conn.fetchval(f"""
                SELECT count(*) FROM player_game_history
                 WHERE sport='mlb' AND {keys} AND stats ? '{spec.volume_key}'
                   AND {spec.volume_sql} > 0""")
            # MEAN OUTCOME ON THE JOINED SET, not on the whole population.
            # Comparing a league-wide mean to a mean LINE compares two different
            # populations: lines are offered on starters and stars, while
            # player_game_history holds every pinch-hitter and mop-up reliever.
            # That mismatch flagged eight healthy markets as suspect on the first
            # run. The only comparison that means anything is outcome vs line on
            # the rows that actually have both.
            #
            # The join goes through athlete_crosswalk because MLB prop rows carry
            # ESPN athlete ids while player_game_history carries MLB ids. Joining
            # the two id columns DIRECTLY matches 399 athletes and 0.00% of those
            # rows land on the right game_date — the ids collide by coincidence.
            # Through the crosswalk, 89.03% land on the same date.
            mean_out = await conn.fetchval(f"""
                SELECT avg({spec.stat_sql}) FROM player_game_history g
                 WHERE g.sport='mlb' AND {keys} AND stats ? '{spec.volume_key}'
                   AND {spec.volume_sql} > 0
                   AND EXISTS (
                     SELECT 1 FROM prop_odds_archive p
                       JOIN athlete_crosswalk x
                         ON x.sport='mlb' AND x.espn_athlete_id = p.athlete_id
                      WHERE p.sport='mlb' AND p.type_name = ANY($1::text[])
                        AND x.athlete_id = g.athlete_id
                        AND p.game_date = g.game_date)""",
                list(spec.names))
            row = await conn.fetchrow("""
                SELECT count(*) n,
                       count(*) FILTER (WHERE bookmaker IS NULL) hist,
                       count(*) FILTER (WHERE bookmaker IS NOT NULL) live,
                       avg(line) ml
                  FROM prop_odds_archive
                 WHERE sport='mlb' AND type_name = ANY($1::text[])""",
                list(spec.names))
            print(f"  {spec.slug:<22} {spec.side:<4} {pgh:>10,} {row['n']:>10,} "
                  f"{row['hist']:>7,} {row['live']:>7,} "
                  f"{(mean_out or 0):>9.3f} {(row['ml'] or 0):>9.2f}")
            if row["n"] == 0:
                problems.append(f"{spec.slug}: no prop rows under any known name")
            elif row["live"] == 0:
                problems.append(f"{spec.slug}: NO LIVE ROWS — will go blank at go-live")
            elif row["hist"] == 0:
                problems.append(f"{spec.slug}: live only, no history to fit on")
            if pgh == 0:
                problems.append(f"{spec.slug}: settling stat absent from player_game_history")
            # C: does the outcome plausibly settle the market it claims to?
            if mean_out and row["ml"] and row["n"]:
                ratio = mean_out / float(row["ml"])
                if not 0.4 <= ratio <= 2.5:
                    problems.append(
                        f"{spec.slug}: mean outcome {mean_out:.2f} vs mean line "
                        f"{float(row['ml']):.2f} (ratio {ratio:.2f}) — the computed "
                        f"outcome may not be what the market settles")

        # D: every market name in the archive is either modelled or excluded.
        print("\nUNCLASSIFIED MARKET NAMES (must be empty)")
        known = {n for s in mp.MARKETS for n in s.names} | set(mp.EXCLUDED)
        rows = await conn.fetch("""
            SELECT type_name, count(*) n FROM prop_odds_archive
             WHERE sport='mlb' GROUP BY 1 ORDER BY 2 DESC""")
        unk = [(r["type_name"], r["n"]) for r in rows
               if r["type_name"] not in known and "Milestone" not in r["type_name"]]
        for name, n in unk:
            print(f"  {name:<40} {n:>8,}")
        if not unk:
            print("  (none — every non-Milestone market is modelled or explicitly excluded)")

        print("\nPROBLEMS")
        if problems:
            for p in problems:
                print(f"  - {p}")
        else:
            print("  (none)")
        print(f"\nVERDICT: {'PASS' if not problems and not unk else 'ATTENTION'}")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
