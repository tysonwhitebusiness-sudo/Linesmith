"""Phase 5.S.7 — build and refresh `team_name_index`.

    python build_team_name_index.py                 # report; writes nothing
    python build_team_name_index.py --apply         # refresh from LIVE rows
    python build_team_name_index.py --apply --seed  # + re-read the corpus

`archival_bridge._team_ids` resolved a team name by scanning every row of
`odds_archive` — 1,982,889 of them, to produce **874 distinct pairs**. Once
5.S.7 prunes that table to its unfrozen tail (3,087 rows), the same scan yields
almost nothing and every capture it cannot resolve is routed to
`odds_unresolved`. Nothing raises; the bridge keeps running; the archive quietly
stops being fed. This table exists so that cannot happen.

TWO MODES, AND THE DIFFERENCE IS ENTIRELY ABOUT EGRESS.

  `--seed`  reads the Parquet corpus (~100 MB) and is run ONCE, or after a
            re-export. It is the only way to recover the pairs that live in
            history rather than in the last two days.
  default   reads only the LIVE tail of `odds_archive` in Postgres, which is a
            few thousand rows. A genuinely new spelling ARRIVES as a live row,
            so ongoing refreshes never need the corpus at all.

That split is the whole design. A job that re-read the corpus hourly to rebuild
874 rows would spend Storage egress to solve a problem a table solves for free,
and egress is the ceiling 5.1 exists to have protected.

UPSERT, NEVER REPLACE. A refresh that rebuilt the table from the live tail would
delete every historical pair on its first run — the precise failure this file
was written to prevent, reintroduced by the thing meant to prevent it. Rows are
only ever added or have `last_seen` bumped.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                     # noqa: E402
from entity_resolution import normalize_team_name             # noqa: E402

# The unfrozen tail — the same boundary `corpus_store.FROZEN_PREDICATE` uses,
# inverted. Everything outside it is in the corpus.
LIVE_PREDICATE = """
    NOT ((event_start IS NOT NULL AND event_start <= now())
      OR (event_start IS NULL AND game_date < current_date - 1))
"""


def _pairs_from(rows, get) -> dict[tuple[str, str], tuple[str, str]]:
    """{(sport, name_key): (team_id, raw_sample)} from either source.

    ONE NORMALISER, used here and by `_team_ids`. If this stored raw names and
    let each reader normalise, the two would eventually disagree about a
    punctuation rule and the lookup would miss for reasons nobody could see.
    """
    out: dict[tuple[str, str], tuple[str, str]] = {}
    for r in rows:
        sport = get(r, "sport")
        for raw_col, id_col in (("home_team_raw", "home_team_id"),
                                ("away_team_raw", "away_team_id")):
            raw, tid = get(r, raw_col), get(r, id_col)
            if not raw or tid is None:
                continue
            key = normalize_team_name(raw)
            if not key:
                continue
            out.setdefault((sport, key), (str(tid), str(raw)))
    return out


def _corpus_pairs() -> dict:
    """Blocking; call through `asyncio.to_thread`."""
    from corpus_location import corpus_location, read_parquet_glob

    con, glob = read_parquet_glob(corpus_location(), "odds_archive")
    try:
        rows = con.execute(
            "SELECT DISTINCT sport, home_team_raw, home_team_id, "
            "       away_team_raw, away_team_id "
            "  FROM read_parquet(?) "
            " WHERE home_team_id IS NOT NULL OR away_team_id IS NOT NULL",
            [glob]).fetchall()
    finally:
        con.close()
    cols = ("sport", "home_team_raw", "home_team_id",
            "away_team_raw", "away_team_id")
    return _pairs_from(rows, lambda r, c: r[cols.index(c)])


async def main(apply: bool, seed: bool) -> int:
    pool = await db.get_pool()
    async with pool.acquire(timeout=900.0) as conn:
        await conn.execute("SET statement_timeout = '15min'")

        live = _pairs_from(
            await conn.fetch(
                f"""SELECT sport, home_team_raw, home_team_id,
                           away_team_raw, away_team_id
                      FROM odds_archive WHERE {LIVE_PREDICATE}"""),
            lambda r, c: r[c])
        found = dict(live)
        print(f"\n{'=' * 78}\n5.S.7  team_name_index\n{'=' * 78}")
        print(f"  live tail          {len(live):>6,} pairs")
        if seed:
            corpus = await asyncio.to_thread(_corpus_pairs)
            print(f"  corpus             {len(corpus):>6,} pairs")
            # Live wins on a conflict: it is the newer observation of the same
            # spelling, and a team id that has genuinely changed should follow
            # the newer row rather than the archive's oldest memory of it.
            found = {**corpus, **live}
        existing = {(r["sport"], r["name_key"]): r["team_id"] for r in
                    await conn.fetch("SELECT sport, name_key, team_id FROM team_name_index")}
        print(f"  already stored     {len(existing):>6,} pairs")
        new = {k: v for k, v in found.items() if k not in existing}
        changed = {k: v for k, v in found.items()
                   if k in existing and existing[k] != v[0]}
        print(f"  new                {len(new):>6,}")
        print(f"  id changed         {len(changed):>6,}")
        by_sport: dict[str, int] = {}
        for (sport, _), _v in found.items():
            by_sport[sport] = by_sport.get(sport, 0) + 1
        for s, n in sorted(by_sport.items(), key=lambda t: -t[1]):
            print(f"      {s:<14}{n:>6,}")

        if not apply:
            print("\n  REPORT ONLY. Nothing written. Re-run with --apply "
                  "(add --seed to include the corpus).\n")
            await _close(pool)
            return 0

        await conn.executemany(
            """INSERT INTO team_name_index
                   (sport, name_key, team_id, raw_sample, first_seen, last_seen)
               VALUES ($1, $2, $3, $4, now(), now())
               ON CONFLICT (sport, name_key) DO UPDATE
                 SET team_id = excluded.team_id,
                     raw_sample = excluded.raw_sample,
                     last_seen = now()""",
            [(s, k, v[0], v[1]) for (s, k), v in found.items()])
        total = await conn.fetchval("SELECT count(*) FROM team_name_index")
        print(f"\n  wrote {len(found):,}; table now holds {total:,} pairs\n")

    await _close(pool)
    return 0


async def _close(pool) -> None:
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                        # noqa: BLE001
        pool.terminate()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--seed", action="store_true",
                    help="also read the Parquet corpus (run once, or after a re-export)")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.apply, a.seed)))
