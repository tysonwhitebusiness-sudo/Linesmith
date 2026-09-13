"""Phase 6 step 1 — the CFB training set: closing spread vs final margin.

    python build_cfb_training_set.py            # report only
    python build_cfb_training_set.py --out cfb_train.parquet

WHERE THE DATA IS, AND WHY THAT IS NOT OBVIOUS. Phase 5 pruned `odds_archive`
to a 30-day window, so Postgres holds 4,493 cfb rows starting 2026-08-27. All
13,659 games of spread history live in the **Parquet corpus**. This reads the
corpus through DuckDB, which is why it runs on the operator's machine and not
the Render worker: a corpus read costs ~300 MB of RAM, the same reason
`corpus_store` bars the export from the worker.

WHAT A ROW IS. One per game: the consensus closing spread (home side, signed)
and the final margin (home_score - away_score). The model's job is to predict
the margin; the spread is what it is judged against.

THREE THINGS THAT WOULD SILENTLY CORRUPT THIS, each handled:

1. **THE PRICE COLUMN LIES ON espn_core SPREAD ROWS.** `price` there holds a
   rounded copy of `line` (`line = -30.5, price = -30`) -- zero of 988 rows are
   plausible American odds. This never reads spread `price`; it reads `line`,
   which is sound across all sources. See the Phase 6 audit note in the master
   plan. Real cfb spread PRICES exist for 75 games, all ours, all 2026.

2. **MANY BOOKS PER GAME, DISAGREEING.** A single book is a coin flip -- the
   same defect that made OddsHarvester's reference line non-deterministic. Takes
   the MEDIAN line across books, and `percentile_disc` so the result is a line
   somebody actually posted rather than an interpolated half-point.

3. **BOTH SIDES ARE STORED.** `home` and `away` rows both exist (40,755 /
   38,881). Only the home side is read, because its signed point is the
   convention `odds_archive` writers use; mixing them would cancel.

NO PRICES ARE REQUIRED HERE and that is deliberate. A line teaches a margin
model without a price attached; prices matter at validation, which is
moneyline-only for now (4,104 games).
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

from corpus_location import corpus_location, read_parquet_glob   # noqa: E402

# A spread whose absolute value exceeds this is not a real posted line; the
# corpus holds values out to -76.5/62.0, which are ingest artefacts rather than
# games anyone priced. Kept generous: real CFB blowout lines do reach the 50s.
MAX_PLAUSIBLE_SPREAD = 60.0


def build(limit_season: int | None = None):
    loc = corpus_location()
    con, odds_glob = read_parquet_glob(loc, "odds_archive")
    try:
        con.execute("INSTALL json; LOAD json;")
    except Exception:                                            # noqa: BLE001
        pass

    # game_result still lives in Postgres in full (14,782 cfb rows, 2013->2026);
    # it was never pruned, being small. Pulled through DuckDB's postgres reader
    # would add a dependency, so it comes over asyncpg in main() instead.
    sql = f"""
        SELECT event_ref,
               any_value(game_date)                                   AS game_date,
               percentile_disc(0.5) WITHIN GROUP (ORDER BY line)      AS close_spread,
               count(*)                                              AS book_rows,
               count(DISTINCT bookmaker)                             AS books
          FROM read_parquet(?)
         WHERE sport = 'cfb'
           AND market = 'spread'
           AND side = 'home'
           AND line IS NOT NULL
           AND abs(line) <= {MAX_PLAUSIBLE_SPREAD}
         GROUP BY event_ref
    """
    rows = con.execute(sql, [odds_glob]).fetchall()
    con.close()
    return {str(r[0]): (r[1], float(r[2]), int(r[3]), int(r[4])) for r in rows}


async def main(out: str | None) -> int:
    import asyncio                                               # noqa: F401
    import db

    spreads = build()
    print(f"\n{'=' * 78}\nCFB TRAINING SET\n{'=' * 78}")
    print(f"  games with a consensus closing spread : {len(spreads):,}")

    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        res = await conn.fetch(
            """SELECT event_ref, game_date, home_score, away_score
                 FROM game_result
                WHERE sport = 'cfb' AND home_score IS NOT NULL AND away_score IS NOT NULL""")
    results = {str(r["event_ref"]): (r["game_date"], int(r["home_score"]), int(r["away_score"]))
               for r in res}
    print(f"  games with a final score              : {len(results):,}")

    joined = []
    for ref, (gd, spread, book_rows, books) in spreads.items():
        got = results.get(ref)
        if got is None:
            continue
        _, hs, as_ = got
        joined.append((ref, gd, spread, hs - as_, books))

    print(f"  JOINED (spread AND result)            : {len(joined):,}")
    if not joined:
        print("\n  nothing joined -- check event_ref alignment before going further.\n")
        await _close(pool)
        return 1

    import statistics as st
    margins = [j[3] for j in joined]
    spreads_only = [j[2] for j in joined]
    # The residual the model is meant to explain: margin + spread, because the
    # home spread is negative when the home team is favoured.
    resid = [m + s for m, s in zip(margins, spreads_only)]
    by_season: dict[int, int] = {}
    for _, gd, _, _, _ in joined:
        by_season[gd.year] = by_season.get(gd.year, 0) + 1

    print(f"\n  seasons: {min(by_season)}..{max(by_season)}")
    for y in sorted(by_season):
        print(f"    {y}  {by_season[y]:>5,}")
    print(f"\n  final margin   mean {st.mean(margins):>7.2f}  sd {st.pstdev(margins):>6.2f}")
    print(f"  closing spread mean {st.mean(spreads_only):>7.2f}  sd {st.pstdev(spreads_only):>6.2f}")
    print(f"  RESIDUAL       mean {st.mean(resid):>7.2f}  sd {st.pstdev(resid):>6.2f}")
    print("  (residual = margin + home spread; mean ~0 means the market is unbiased,")
    print("   sd is the noise any model has to beat)")
    print(f"\n  books per game: median "
          f"{st.median([j[4] for j in joined]):.0f}, max {max(j[4] for j in joined)}")

    if out:
        import csv
        with open(out, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["event_ref", "game_date", "close_spread", "margin", "books"])
            for ref, gd, sp, mg, bk in sorted(joined, key=lambda j: (j[1], j[0])):
                w.writerow([ref, gd, sp, mg, bk])
        print(f"\n  wrote {len(joined):,} rows -> {out}")
    else:
        print("\n  REPORT ONLY. Pass --out <file.csv> to write the set.")
    print()
    await _close(pool)
    return 0


async def _close(pool) -> None:
    import asyncio
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                            # noqa: BLE001
        pool.terminate()


if __name__ == "__main__":
    import asyncio
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="write the joined set to this CSV")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.out)))
