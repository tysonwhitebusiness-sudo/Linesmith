# P5 — the compact history: conversion, size and read timings (2026-09-25)

Every number here is measured against the live database. The script is named
with each one.

## Conversion (`python-odds-service/convert_prop_history.py`)

- **Rows:** 7,074,963 converted. All 36 id chunks were verified row for row, in
  all 13 columns, both ways (`EXCEPT ALL`), with the counts equal: 0 missing,
  0 extra.
- **Size:** 2.41 GB → 0.72 GB. That is **341 → 101.1 B/row** (heap 85.8, index
  15.4, after `VACUUM ANALYZE`). The B-tree index is small because rows from
  one write batch share an `observed_at`, and Postgres deduplicates them.
- **Copy speed.** The first pass slowed from ~20 s to ~485 s per 200k-row
  chunk. The cause was the plan, not disk I/O: the day partition being filled
  had not been analysed yet, so the planner believed it empty and ran the
  already-copied check (the anti-join) as a nested loop, re-scanning the
  partition once per row. With `enable_nestloop = off` for the maintenance
  statements (and the index built once afterwards, in 12.6 s), each chunk took
  **2.7 s**. P6's throughput test should reuse this lesson: a bulk write into
  a fresh partition must not depend on its statistics.

## Read timings (`scripts/p5-timing/time-history-reads.ts`)

Method:
- the real TypeScript readers, old (as of `2035a81`) and new, on the same live
  data (catch-up copy first);
- one warm-up, then 7 runs each; medians;
- **gate: new ≤ old × 1.2, or within 20 ms of it.**

Inputs:
- the busiest prop key of the last 48 h (MLB 823087, pitcher strikeouts);
- the 12 games with the most prop rows in 36 h (about 0.68M rows), each given
  a synthetic start 6 h ahead, the same for both versions;
- the busiest retained game (824464, 107,790 rows), with its start set to its
  median observation.

### Final (shipped code, plain chart index)

| read | old median | new median | result |
|---|---|---|---|
| Price chart (`readLineHistory`, 48 h, 2 queries) | 137 ms | 149 ms | PASS (+12 ms) |
| Game page pre-game props (`readPreGamePropOddsForGame`'s history read) | 1,074 ms | 571 ms | PASS (1.9× faster) |
| Movers (`readConsensusMovers('props')`, 7 days) | 15,640 ms | 10,334 ms | PASS |

The old Movers median moved between runs: 10,114 / 10,790 / 11,564 /
15,640 ms across the four runs today, on a database also serving the live
worker. The new 10,334 ms passes against the fastest of them (10,114 × 1.2 =
12,137).

### What it took, attempt by attempt

| attempt | Movers old → new | cause, from EXPLAIN ANALYZE | change |
|---|---|---|---|
| 1. decode every row, then aggregate | 10.1 s → timeout | the planner expected 39 rows (there were 606,143) and decoded each one with five nested index probes into the dictionaries | aggregate on the integer codes and decode only the final ≤ 1,500 rows (`PROP_MOVER_HISTORY`) |
| 2. coded, side filter as `IN (SELECT …)` | 10.8 → 13.8 s | the line-shift query took 12.1 s against 5.5 s: the semi-join changed its plan | the side codes come from `= ANY(ARRAY(SELECT …))`, evaluated once |
| 3. + a covering index `INCLUDE (line, side, book, source, price)` | 11.6 → 29.6 s | the trend query went 0.9 → 8.2 s: with fresh statistics the planner hash-joined whole partitions against 40 keys. The consensus query could not go index-only anyway (it needs `recorded_at` for the partition bound): 7.4 s against 7.8 s without the index. The index cost 145 B/row against 101 | the covering index was **reverted** (no measured gain). The trend reads each key through a `LATERAL` index lookup (`keyedFrom`): 160 ms, where the old table took 646 ms |
| 4. shipped | 15.6 → 10.3 s | — | — |

**Output equality, checked at the cutover** once the old table had stopped
receiving writes: the rows Movers aggregates for the 12 busiest games came out
identical from both tables (439,536 rows, 0 missing, 0 extra). The rows
compared were the same selection Movers makes: 7 days, sane prices, books
outside the consensus exclusions.

## Mover (the cron's export of a day)

`history_mover.export_day` on the busiest converted day, 2026-09-16 (823,498
rows). The id filter was lifted for the measurement, so legacy rows counted,
and the output went to a scratch local corpus. The path is the one the cron
runs:
- stream the decoded rows;
- write Parquet;
- "upload";
- read it back;
- compare digests.

| rows | files | Parquet | time | process RSS |
|---|---|---|---|---|
| 823,498 | 1 | 5.37 MB (**6.53 B/row**) | **89.2 s** | 45.5 MB baseline → **160.2 MB peak** (+114.7) |

- **Memory** is bounded by the 20,000-row fetch, not by the size of the day:
  rows stream through, one file of at most 1.5M rows is open at a time, and
  the digest is O(1). 160 MB fits the cron's 512 MB instance with room left.
- **Time at bridge volume is NOT measured yet.** 8.1M rows/day is 9.8× this
  day; if the export scales linearly, that is about 15 minutes per day. P6's
  soak measures the real figure before the mover depends on it.
