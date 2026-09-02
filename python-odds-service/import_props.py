"""
Load ESPN player props into `prop_odds_archive`.

DROPS ROWS THAT CARRY NEITHER A LINE NOR A PRICE. 819,262 of the 3,681,061
scraped rows (22.3%) have both empty, and that is the SOURCE, not the parse:
enumerating every `current` block shape across six pages of a real MLB game
gives exactly two -- `{target}` (a line, no price) and `{}` (nothing, e.g.
"To Record Win"). A prop with no line and no price is not a prop, so 2,861,799
actionable rows are loaded and the rest are left in the CSV.

BOTH SIDES EXIST -- AS SEPARATE ITEMS. ESPN publishes one side per prop item,
so the raw CSV shows 697,032 over-only rows and 563,009 under-only rows and ZERO
with both, which reads like a one-sided source. It is not. The two items share
(event, athlete, type, line) and differ only in which side they price, so
merging on that key reconstructs a genuine two-sided prop.

This was found by the unique index rejecting the load, not by inspection: the
natural key collided on (mlb, 401694911, 33696, Total Strikeouts, 5.5) because
the over and the under were arriving as two separate rows.

NO raw_json, by operator decision -- at this row count the blob alone would add
1.5-2.5 GB to a database with an 8 GB ceiling.

Uses COPY rather than executemany: at 2.9M rows the difference is minutes
against hours.
"""

import argparse
import asyncio
import sys
import warnings
from pathlib import Path

import pandas as pd

sys.path.insert(0, "src")
import db  # noqa: E402

SRC = Path("C:/Users/occy3/Downloads/espn_props/espn_props_all.csv")

COLS = ["sport", "event_ref", "game_date", "athlete_id", "type_id", "type_name",
        "line", "over_price", "under_price", "open_line", "open_over_price",
        "open_under_price", "provider", "source", "source_priority", "last_updated",
        "event_start"]


warnings.filterwarnings("ignore")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--truncate", action="store_true")
    ap.add_argument("--batch", type=int, default=100_000)
    args = ap.parse_args()

    pool = await db.get_pool()
    if args.truncate:
        # SET LOCAL INSIDE A TRANSACTION, not a bare SET. db.get_pool() applies a
        # 15-second statement_timeout, which a TRUNCATE of 1.8M rows blows
        # through -- and a plain `SET` cannot lift it, because this app connects
        # through a transaction-mode pooler where session state does not survive
        # to the next statement. Same property that forced withJobLock to be a
        # lease table rather than an advisory lock.
        async with pool.acquire() as c:
            async with c.transaction():
                await c.execute("SET LOCAL statement_timeout = '900s'")
                await c.execute("TRUNCATE prop_odds_archive")
        print("prop_odds_archive truncated", flush=True)

    d = pd.read_csv(SRC, low_memory=False)
    read = len(d)

    # THE ONLY DROP: no line and no price is not a prop. 22.3% of raw rows, and
    # it is the source -- `current` is either {target} or {} on those.
    actionable = d.line.notna() | d.over_price.notna() | d.under_price.notna()
    dropped = int((~actionable).sum())
    d = d[actionable].copy()

    # KEEP THE TIME, NOT JUST THE DAY. `.dt.date` here is what made closing-line
    # value unmeasurable on props: this archive holds many observations per prop
    # as the line moves, and without a start time nothing says which of them was
    # the last one before the game began -- or which were taken AFTER it did.
    d["event_start"] = pd.to_datetime(d.event_date, errors="coerce", utc=True)
    d["event_date"] = d["event_start"].dt.date
    d["last_updated"] = pd.to_datetime(d.last_updated, errors="coerce", utc=True)
    # These are TEXT columns in Postgres, but pandas reads numeric-looking ids
    # as int64 and COPY then rejects the batch with "expected str, got int".
    # Cast through Int64 first so 4686338.0 does not become "4686338.0".
    for c in ("athlete_id", "type_id", "event_id"):
        d[c] = d[c].astype("Int64").astype("object").map(lambda v: None if pd.isna(v) else str(v))
    for c in ("provider", "type_name", "sport"):
        d[c] = d[c].astype("object").where(d[c].notna(), None)

    # MERGE THE TWO SIDES. They arrive as separate items sharing
    # (event, athlete, type, line); first() over each price column pairs them.
    key = ["sport", "event_id", "athlete_id", "type_name", "line"]
    d["_line_k"] = d.line.fillna(-9999.0)
    g = d.groupby(["sport", "event_id", "athlete_id", "type_name", "_line_k"], dropna=False).agg(
        event_date=("event_date", "first"),
        type_id=("type_id", "first"),
        line=("line", "first"),
        over_price=("over_price", "max"),
        under_price=("under_price", "max"),
        open_line=("open_line", "first"),
        open_over_price=("open_over_price", "max"),
        open_under_price=("open_under_price", "max"),
        provider=("provider", "first"),
        last_updated=("last_updated", "max"),
        event_start=("event_start", "first"),
    ).reset_index()
    print(f"read {read:,} | actionable {len(d):,} | merged to {len(g):,} two-sided props", flush=True)

    ints = ["over_price", "under_price", "open_over_price", "open_under_price"]
    recs = []
    for t in g.itertuples(index=False):
        recs.append((
            t.sport, t.event_id, t.event_date,
            t.athlete_id if pd.notna(t.athlete_id) else None,
            t.type_id if pd.notna(t.type_id) else None, t.type_name,
            None if pd.isna(t.line) else float(t.line),
            *[None if pd.isna(getattr(t, c)) else int(getattr(t, c)) for c in ints[:2]],
            None if pd.isna(t.open_line) else float(t.open_line),
            *[None if pd.isna(getattr(t, c)) else int(getattr(t, c)) for c in ints[2:]],
            t.provider if pd.notna(t.provider) else None, "espn_core", 90,
            None if pd.isna(t.last_updated) else t.last_updated.to_pydatetime(),
            None if pd.isna(t.event_start) else t.event_start.to_pydatetime(),
        ))

    for i in range(0, len(recs), args.batch):
        async with pool.acquire() as conn:
            await conn.copy_records_to_table("prop_odds_archive", columns=COLS, records=recs[i:i + args.batch])
        print(f"  loaded {min(i + args.batch, len(recs)):,}", flush=True)

    print(f"\nread {read:,} | dropped (no line and no price) {dropped:,} | loaded {len(recs):,}", flush=True)
    async with pool.acquire() as c:
        for r in await c.fetch("""SELECT sport, count(*) n, count(DISTINCT athlete_id) ath,
                                  count(DISTINCT type_name) types,
                                  count(*) FILTER (WHERE over_price IS NOT NULL AND under_price IS NOT NULL) two,
                                  min(game_date) lo, max(game_date) hi
                                  FROM prop_odds_archive GROUP BY 1 ORDER BY 2 DESC"""):
            print(f"  {r['sport']:<11} {r['n']:>9,}  athletes {r['ath']:>6}  types {r['types']:>4}  two-sided {r['two']:>8,}  {r['lo']} -> {r['hi']}")
        tot = await c.fetchval("SELECT count(*) FROM prop_odds_archive")
        size = await c.fetchval("SELECT pg_size_pretty(pg_database_size(current_database()))")
        print(f"\nTOTAL {tot:,} rows | database now {size}")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
