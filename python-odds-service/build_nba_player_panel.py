"""Phase 7 step 2a — the NBA player-game panel, extracted once.

    python build_nba_player_panel.py                     # report only
    python build_nba_player_panel.py --out nba_panel.parquet

ONE ROW PER PLAYER-GAME, every NBA season `player_game_history` holds: 269,257
rows with minutes across 2016-2026, ~26k a season. Raw box score plus the
identifying columns, and nothing derived -- every feature is computed by the
fitter, so the feature logic lives in one readable place instead of being split
between a SQL window clause and a Python loop.

WHY THIS IS ITS OWN SCRIPT. A corpus read costs ~300 MB of RAM and is barred
from the Render worker, so it runs here, on the operator's machine. Steps 2
(minutes) and 3 (rate stats per minute) both need the same panel, and re-reading
the corpus once per experiment is the cost this file exists to pay once.

FOUR THINGS MEASURED ABOUT THIS DATA, 2026-09-13, each of which changes how it
must be used:

1. **A DNP IS AN ABSENT ROW, NOT A ZERO.** Only players who appeared are
   recorded -- a team-game carries 6 to 16 rows, median 10, against a 15-man
   roster. So a minutes model fit on this panel predicts minutes GIVEN THE
   PLAYER PLAYED, and cannot learn whether someone is active. For props that is
   the right conditioning and not a limitation: a prop on a scratched player is
   voided, not lost. It would be the wrong conditioning for anything else.

2. **THE DNP CONVENTION CHANGED IN 2019.** Seasons 2016-2018 carry ~3,400
   rows a year with no `minutes` key; from 2019 it drops to single or double
   digits. That is the feed changing, not players suddenly always playing.
   Rows without minutes are dropped here (all 10,404 of them have zero points,
   confirming they are DNPs rather than data loss), but a count that spans the
   boundary would read the change as a trend.

3. **240 TEAM-MINUTES IS A HARD CONSTRAINT, and it is clean enough to use.**
   Of ~7,400 recent team-games, 6,947 sum to exactly 48.0 minutes per
   five-man slot, 306 to ~53 (one overtime) and 40 to ~58 (two). The rest are
   a few dozen broken rows. Any model that predicts each player independently
   is throwing this away.

4. **THE SAME (athlete, game_date) CAN SPAN TWO event_ids** -- 1,863 pairs,
   different opponents and minutes. NBA teams do not play twice in a day, so
   these are two real games stamped with one calendar date. Step 1 hit this as
   a join fan-out. Here it matters for ORDERING: the panel is ordered by
   `(game_date, event_id)` so a player's own sequence is deterministic, and
   `rest_days` computed from it will read 0 for those pairs rather than
   silently reordering them.

WHAT IS DELIBERATELY NOT HERE: any filter on the prop window. The priced props
cover six weeks of one season (see `build_nba_prop_training_set.py`); the
minutes model should be fit on everything and only EVALUATED there, so the
panel carries all eleven seasons.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

# Box-score keys, verbatim as `player_game_history.stats` spells them. Minutes
# first because it is the target; the rest are what step 3 turns into per-minute
# rates. `fieldGoalsAttempted`/`freeThrowsAttempted`/`turnovers`/
# `offensiveRebounds` are the four the possessions estimate needs.
STAT_KEYS = [
    "minutes", "points", "rebounds", "assists", "steals", "blocks", "turnovers",
    "fouls", "plusMinus", "fieldGoalsMade", "fieldGoalsAttempted",
    "freeThrowsMade", "freeThrowsAttempted", "threePointFieldGoalsMade",
    "threePointFieldGoalsAttempted", "offensiveRebounds", "defensiveRebounds",
]


async def build(conn):
    import corpus_reads

    con = corpus_reads.duck_connection()
    try:
        con.execute("INSTALL json; LOAD json;")
    except Exception:                                            # noqa: BLE001
        pass
    await corpus_reads.union_view(con, conn, "player_game_history")

    stats = ",\n               ".join(
        f"json_extract(stats, '$.{k}')::DOUBLE AS {k}" for k in STAT_KEYS)
    sql = f"""
        SELECT athlete_id, event_id, game_date, season, team_id, opponent_id,
               is_home,
               {stats}
          FROM player_game_history
         WHERE sport = 'nba'
           AND json_extract(stats, '$.minutes') IS NOT NULL
         ORDER BY game_date, event_id, athlete_id
    """
    rel = con.execute(sql)
    cols = [d[0] for d in rel.description]
    rows = rel.fetchall()
    con.close()
    return cols, rows


async def main(out: str | None) -> int:
    import db

    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        cols, rows = await build(conn)
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                            # noqa: BLE001
        pool.terminate()

    print("\n" + "=" * 78)
    print("NBA PLAYER-GAME PANEL")
    print("=" * 78)
    print(f"  player-games with minutes : {len(rows):,}")
    if not rows:
        print("\n  empty — check the corpus is reachable.\n")
        return 1

    ix = {c: i for i, c in enumerate(cols)}
    seasons = sorted({r[ix["season"]] for r in rows})
    print(f"  seasons                   : {seasons[0]}..{seasons[-1]} ({len(seasons)})")
    print(f"  athletes                  : {len({r[ix['athlete_id']] for r in rows}):,}")
    print(f"  events                    : {len({r[ix['event_id']] for r in rows}):,}")
    print(f"  dates                     : {min(r[ix['game_date']] for r in rows)}"
          f" .. {max(r[ix['game_date']] for r in rows)}")

    import statistics as st
    mins = [r[ix["minutes"]] for r in rows]
    print(f"  minutes  mean {st.mean(mins):.2f}  sd {st.pstdev(mins):.2f}  "
          f"median {st.median(mins):.1f}  max {max(mins):.0f}")
    missing = {k: sum(1 for r in rows if r[ix[k]] is None) for k in STAT_KEYS}
    bad = {k: v for k, v in missing.items() if v}
    print(f"  stat keys null anywhere   : {bad if bad else 'none'}")

    if out:
        import pyarrow as pa
        import pyarrow.parquet as pq
        tbl = pa.table({c: [r[i] for r in rows] for i, c in enumerate(cols)})
        pq.write_table(tbl, out)
        print(f"\n  wrote {len(rows):,} rows -> {out} "
              f"({os.path.getsize(out) / 1e6:.1f} MB)")
    else:
        print("\n  REPORT ONLY. Pass --out <file.parquet> to write the panel.")
    print()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="write the panel to this parquet file")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.out)))
