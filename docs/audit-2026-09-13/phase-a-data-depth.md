# Phase A — Data-depth ledger

**Status: COMPLETE 2026-09-13.** Measured against the live database. Log-only;
nothing was changed.

## Headline: the premise was half right, and the half that was wrong matters more

The audit plan opened on the operator's observation that "we have 10+ years of
data in almost every sport" and the pages show almost none of it.

**The 10+ years is real. It is not in `player_game_history`, and no TypeScript
file can see it.**

| | where the deep history actually is | depth | read by TS? |
|---|---|---|---|
| game/team results | `game_result` — 184,108 rows | **NFL 1999→, NBA/NHL 2007→, MLB 2010→, MLS 2012→, CFB 2013→, EPL/tennis 2015→** | **NO — zero files** |
| historical odds | `historical_odds` — 37,922 rows | 2010 → 2026 | model-fit / ingest / diagnostics only, never a sport page |
| player per-game | `player_game_history` — ~766k rows | **2–4 seasons only** | one file, one season |

`grep -rn "game_result" lib/ app/ components/` returns **nothing**. Not a query,
not a mention. The table is Python-only — `corpus_store`, `archival_bridge`, and
the `predict/*` model modules. **Sixteen to twenty-seven years of real results
per sport exist and the render path was never connected to them.**

So "the data is thin" has two independent causes, and they need different fixes:

- **Gap 1 — player pages.** The corpus holds 2–4 seasons; pages read **one**.
- **Gap 2 — team and game pages.** 10–27 years exist; pages read **none of it**,
  because no TypeScript read path to `game_result` has ever been written.

Gap 2 is the larger prize and is entirely unbuilt. Gap 1 is a shallower fix
against a shallower corpus.

## The player corpus, exactly

Total ~766k rows (exact `GROUP BY` sum; `pg_class` estimates 758,630).

| sport | rows | seasons held | athletes | first game | last game |
|---|---|---|---|---|---|
| mlb | 202,747 | 2024–2026 | 2,043 | 2024-03-20 | 2026-08-28 |
| nhl | 143,609 | 2023–2025 | 1,317 | 2023-10-10 | 2026-04-16 |
| cfb | 134,052 | 2024–2026 | 21,232 | 2024-08-24 | 2026-09-13 |
| nba | 79,713 | 2024–2026 | 809 | 2023-10-24 | 2026-04-13 |
| tennis_wta | 54,368 | 2024–2026 | 4,678 | 2024-01-06 | 2026-08-29 |
| nfl | 51,482 | 2023–2026 | 2,677 | 2023-09-08 | 2026-09-11 |
| tennis_atp | 44,016 | 2024–2026 | 3,450 | 2024-01-06 | 2026-08-29 |
| soccer_mls | 32,497 | 2024–2026 | 1,212 | 2024-02-22 | 2026-09-13 |
| soccer_epl | 23,983 | 2024–2026 | 850 | 2024-08-16 | 2026-09-13 |

**Golf has zero rows in this table.** It uses `golf_shot_events` (1.03M),
`golf_hole_scores` (10.6k) and `golf_round_scores` — and `golf_hole_scores`
`ingested_at` spans only **2026-08-16 → 2026-08-30**. Golf's depth needs its own
assessment; it is not comparable to the other eight.

Per-season counts are uniform (full seasons ~equal, current season partial), so
there is no "thinning in older years" inside the corpus.

### Correction to a doc comment

`lib/sports/shared/seasonAggregates.ts` states the table holds **2.75M rows**.
It holds **~0.77M** — 3.6x off. The likeliest cause is the Phase 5 database
reduction (7,282 MB → ~3,200 MB, `docs/CURRENT.md`), which would have pruned
this table without the comment being revisited. Worth fixing when that file is
next touched; it is the kind of number a future decision gets anchored on.

## Stat vocabulary — the flagged risk measured NO

The plan flagged that older seasons might carry a thinner set of usable
`stats` JSONB keys, which would change the shape of any remediation.

Measured exactly — every key, every sport, every season, by presence rate:

| sport | keys | seasons | keys varying across seasons |
|---|---|---|---|
| cfb | 53 | 2024–2026 | **0** |
| nfl | 57 | 2023–2026 | **0** |
| mlb | 27 | 2024–2026 | **0** |
| nhl | 21 | 2023–2025 | **0** |
| nba | 17 | 2024–2026 | **0** |
| soccer_epl / soccer_mls | 16 | 2024–2026 | **0** |
| tennis_atp / tennis_wta | 8 | 2024–2026 | **0** |

**Zero varying keys in all nine sport-leagues.** Every key present in one season
is present at the same rate in every other. Remediation needs no per-season key
handling. This risk is closed.

## What the pages actually request today

| sport | player-page history source | depth requested |
|---|---|---|
| nba | vendor season file (`sportsdataverse.ts`) | **1 season** — adapter states "No prior-season fallback needed here" |
| nhl | `nhle.ts`, `currentNhlSeason()` | **1 season** |
| cfb | `cfbd.ts`, `currentCfbdSeason()` | **1 season** |
| tennis | `tennismylife.ts`, `currentTennisSeason()` | **1 season** |
| nfl | `nflverse.ts`, `MOST_RECENT_STATS_SEASON` | **1 season** |
| soccer | `understat.ts` / `americanSocceranalysis.ts` | **CAREER-SPANNING — corrected by Phase B7.** This row originally read "1 season + prior as a small-sample fallback". That was inferred from `attachRealHistory`'s season variable without opening the fetcher, and it was wrong: `fetchUnderstatPlayerMatches` (`understat.ts:401`) returns a career-spanning `matches[]`. A rendered EPL player page shows **259 games**. |
| mlb | `statsapi.ts` / `playerGamelogCache.ts` | current season |
| golf | `golf_*` tables via `playerSeason.ts` / `pgatourStats.ts` | current season |

**No `playerDetailAdapter.ts` in any sport reads `player_game_history`.**
`lib/db/client.ts` never queries it either. The corpus's only frontend reader is
`lib/sports/shared/seasonAggregates.ts`, which pins to `max(season)`.

## Amendments after Phase B

- **Soccer's depth row above was wrong and is corrected in place.** Soccer
  already reads career-spanning player history (259 games rendered). It was
  called shallow here on a static read of the wrong function. The general
  lesson is the one this project already recorded as
  `feedback_render_before_believing`: the adapter's season variable did not
  describe what the fetcher returned.
- **Consequence for remediation:** soccer is a working precedent, not a victim.
  The shared components demonstrably render deep multi-season history without
  modification, so Gap 1 is a data-sourcing job per sport, not a UI job.

## Carried into Phase B and C

1. **Gap 2 is the headline.** Every "starved" verdict in Phase C must record
   whether `game_result` could feed it — that is where the depth actually is.
2. **Golf is not comparable** and needs its own depth question in Phase C rather
   than being scored against the other eight.
3. **NHL holds no 2026 season rows** — check in Phase B whether NHL pages
   degrade or go blank out of season, rather than assuming.
4. Per-season key handling is **not** needed. Closed.

## Method notes

- All queries `COUNT`/`GROUP BY`, small result sets — negligible egress against
  the open Phase 5 retest.
- No rate was extrapolated from a window (`docs/CURRENT.md` measurement trap);
  every figure here is a full-table aggregate.
- Operator confirmed the connection pool was clear before these ran.
