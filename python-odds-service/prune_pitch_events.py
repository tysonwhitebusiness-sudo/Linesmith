"""Phase 5.S.5 — trim `mlb_pitch_events` to the seasons that are actually served.

    python prune_pitch_events.py            # VERIFY ONLY. Deletes nothing.
    python prune_pitch_events.py --apply
    python prune_pitch_events.py --keep 1   # keep only the current season

`mlb_pitch_events` is 477 MB / ~2.19M rows across three near-equal seasons, and
it is the worst-compressing table in the corpus (10x), so it is the least
valuable of the three to keep in a row store.

WHAT THE READERS ACTUALLY NEED, measured rather than assumed — which is this
step's whole gate:

  * **Serving** (`lib/sports/mlb/pitchProfile.ts`, via
    `/api/mlb/pitch-profile`) issues three aggregates, and every one of them is
    `WHERE {pitcher_id|batter_id} = ? AND season = ?`. It is never asked for a
    range. `PlayerDetail.tsx` passes `new Date().getUTCFullYear()` at the only
    call site, so in practice exactly ONE season is ever requested.
  * **`experiment_statcast_prior.py`** aggregates EVERY season with no filter
    at all — and it is a fit/experiment script, which is precisely the category
    5.2 says should read the Parquet corpus. It does now.

So Postgres keeps a hot window and the corpus keeps everything, which is the
same shape `player_game_history` already uses.

DEFAULT IS TWO SEASONS, NOT ONE, and the extra season is not timidity. The
route permits any season from 2024 and the UI's `getUTCFullYear()` rolls over on
1 January, months before a season starts — so for a quarter of every year the
"current" season is nearly empty. Keeping the previous season leaves the obvious
fallback implementable. `--keep 1` frees ~160 MB more if that is ever wanted.

THE FLOOR IS PUBLISHED, NOT ASSUMED. After a successful prune this writes the
oldest retained season to `snapshot_cache` under
`mlb:pitch-events:retained-floor`, and `getPitchProfile` reads it to tell
"pruned to the corpus" (410) apart from "this player threw nothing" (an empty
profile). Those two were indistinguishable before, and the route's own comment
already recorded that confusion as the reason its static floor exists. A
cross-language constant would have had to be hand-maintained in both languages;
a value published by the only process that can change it cannot drift.

THE SAME FOUR REFUSALS as `prune_corpus.py` and `prune_player_history.py`:
  1. verify-only by default;
  2. every row it deletes must be provably in the corpus — checked by comparing
     the actual id sets per season, not by comparing counts, because two equal
     counts over different id sets is exactly the kind of agreement that looks
     like proof and is not;
  3. it deletes BY ID, never by predicate, so a row written since the export
     cannot be swept up by a re-evaluated `season = 2024`;
  4. it refuses while the corpus is local-only.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

from corpus_location import LocalCorpus, corpus_location, read_parquet_glob  # noqa: E402
import db                                                     # noqa: E402

TABLE = "mlb_pitch_events"
KEEP_SEASONS = 2
DELETE_BATCH = 5_000
FLOOR_CACHE_KEY = "mlb:pitch-events:retained-floor"


def corpus_ids(season: int) -> set[int]:
    """Every `id` the corpus holds for one season.

    THE ID SET, NOT THE COUNT. `prune_corpus.py`'s rule 2 says a delete names
    the exact ids proven to be in the corpus; a count comparison would pass
    while the two sides held different rows, and there is no second chance to
    notice.
    """
    con, glob = read_parquet_glob(corpus_location(), TABLE)
    try:
        rows = con.execute(
            "SELECT id FROM read_parquet(?) WHERE season = ?", [glob, season]
        ).fetchall()
    finally:
        con.close()
    return {int(r[0]) for r in rows}


async def main(keep: int, apply: bool, force_local: bool) -> int:
    backend = corpus_location()
    if isinstance(backend, LocalCorpus) and apply and not force_local:
        print("REFUSING: the corpus is local-only. Deleting the last remote copy "
              "of data whose only surviving copy sits on one machine's disk is "
              "not a backup. Re-run with --i-have-my-own-backup if you mean it.")
        return 2

    pool = await db.get_pool()
    async with pool.acquire(timeout=600.0) as conn:
        await conn.execute("SET statement_timeout = '30min'")
        seasons = [r["season"] for r in await conn.fetch(
            f"SELECT DISTINCT season FROM {TABLE} ORDER BY season")]
        if not seasons:
            print(f"{TABLE} is empty; nothing to do.")
            await _close(pool)
            return 0
        floor = max(seasons) - keep + 1
        doomed = [s for s in seasons if s < floor]
        kept = [s for s in seasons if s >= floor]

        print(f"\n{'=' * 78}\n5.S.5  {TABLE}\n{'=' * 78}")
        print(f"  corpus  : {backend.describe}")
        size = await conn.fetchval(
            f"SELECT pg_total_relation_size('{TABLE}')") / 1e6
        print(f"  table   : {size:,.0f} MB")
        print(f"  seasons : {seasons}")
        print(f"  keep    : {kept}   (floor {floor}, --keep {keep})")
        print(f"  prune   : {doomed or 'nothing'}\n")
        if not doomed:
            print("  Already within the window. Nothing to prune.\n")
            await _close(pool)
            return 0

        total_ids: dict[int, list[int]] = {}
        for s in doomed:
            pg = {r["id"] for r in
                  await conn.fetch(f"SELECT id FROM {TABLE} WHERE season = $1", s)}
            # OFF THE EVENT LOOP. DuckDB's read is a blocking C call that runs
            # for tens of seconds over S3, and awaiting nothing while it does
            # starves asyncpg's keepalive -- the pooler then drops the
            # connection and `pool.close()` hangs for 60s before the
            # interpreter dies with a GIL error that names none of this. Seen
            # on the first run of this tool.
            cp = await asyncio.to_thread(corpus_ids, s)
            missing = pg - cp
            print(f"  season {s}: postgres {len(pg):>9,}   corpus {len(cp):>9,}   "
                  f"in pg but NOT in corpus: {len(missing):,}")
            if missing:
                print(f"\n  REFUSING: {len(missing):,} row(s) of season {s} are not "
                      f"in the corpus. Re-export and re-verify before pruning.\n"
                      f"  sample ids: {sorted(missing)[:5]}")
                await pool.close()
                return 1
            # Only ids PROVEN present in the corpus are ever named in a DELETE.
            total_ids[s] = sorted(pg)

        n = sum(len(v) for v in total_ids.values())
        print(f"\n  {n:,} rows verified present in the corpus and eligible to delete.")

        if not apply:
            print("\n  VERIFY ONLY. Nothing deleted. Re-run with --apply.\n")
            await _close(pool)
            return 0

        removed = 0
        for s, ids in total_ids.items():
            for i in range(0, len(ids), DELETE_BATCH):
                batch = ids[i:i + DELETE_BATCH]
                tag = await conn.execute(
                    f"DELETE FROM {TABLE} WHERE id = ANY($1::bigint[])", batch)
                removed += int(tag.split()[-1])
            print(f"  season {s}: deleted {len(ids):,}")

        # PUBLISH THE FLOOR. Written only after the deletes succeed, because a
        # floor claiming rows are gone while they are still present would make
        # the route 410 on data it could have served.
        await conn.execute(
            """INSERT INTO snapshot_cache (cache_key, payload, fetched_at)
               VALUES ($1, $2, now())
               ON CONFLICT (cache_key) DO UPDATE
                 SET payload = excluded.payload, fetched_at = excluded.fetched_at""",
            FLOOR_CACHE_KEY,
            json.dumps({"floor": floor, "kept": kept, "pruned": doomed,
                        "rows_deleted": removed, "table": TABLE}))
        after = await conn.fetchval(
            f"SELECT pg_total_relation_size('{TABLE}')") / 1e6
        print(f"\n  deleted {removed:,} rows; retained floor published as {floor}")
        print(f"  {TABLE}: {size:,.0f} MB -> {after:,.0f} MB "
              f"(VACUUM FULL returns the space — vacuum_reclaim.py)\n")

    await _close(pool)
    return 0


async def _close(pool) -> None:
    """Bounded close. A pooler that has already dropped the connection makes
    `Pool.close()` wait forever; the work is done by this point either way."""
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except (asyncio.TimeoutError, Exception):               # noqa: BLE001
        pool.terminate()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=KEEP_SEASONS)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--i-have-my-own-backup", action="store_true",
                    dest="force_local")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.keep, a.apply, a.force_local)))
