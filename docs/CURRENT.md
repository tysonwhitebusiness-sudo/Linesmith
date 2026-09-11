# CURRENT — pick up here

**Phases 1–4 are COMPLETE. Phase 5 (Sustainability) is IN PROGRESS.**

**`docs/master-plan-2026-09-06.md` §5.S is the authority on what remains.** It
lists every remaining step in execution order with its own gate. Work it in
order; deviating needs a reason written into that section. Do NOT re-derive the
ordering conversationally — that is exactly what §5.S exists to stop.

---

## READ THIS FIRST: PHASE 5 IS **NOT** COMPLETE — updated 2026-09-11 (2nd revision)

The §5.S checklist was the means; the **three ceilings** in the phase header are
the end. Two are now cleared. The third is not merely unverified — it is
**confirmed over budget and being billed**.

| ceiling | limit | at phase start | now | state |
|---|---|---|---|---|
| database | 8,192 MB | 7,174 MB (87.6%) | **~3,200 MB (39%)** | **CLEARED** |
| worker RAM | 512 MB | 385 MB peak | **311 MB resting / 360 peak (70%)** | **CLEARED** |
| egress | 250 GB/mo | ~500 GB | **623.32 GB used, 373.32 GB OVERAGE** | **FAILED** |

### The RAM ceiling is cleared

It had regressed to 489 resting / 560 peak because 5.S.2 put a Parquet corpus
read inside `mlbHistorySummaryJob` (+118 MB in one job, never released — CPython
does not return freed arenas to the OS). Moving that read off the worker, behind
the precomputed `player_history_prefix` table, took it to **311 MB resting /
360 MB peak**, with the job itself running at 293 MB on `source="prefix"`.

### The egress ceiling FAILED, and this is now scope, not a gate

Supabase's own usage graph, billing period 28 Aug - 28 Sep 2026:

```
  Included in Pro Plan   250 GB
  Used in period         623.32 GB
  Overage in period      373.32 GB
  2026-09-11             19.483 GB/day   -- Shared Pooler Egress, 100.0%
```

This billing period is already lost. The target is the NEXT one: get the daily
rate from ~19.5 to **<=8.3 GB/day** before 28 Sep.

**It is 100% Shared Pooler, 0% Storage.** The Parquet corpus is NOT on this
bill. Every byte is database rows crossing the pooler.

## ROOT CAUSE (measured 2026-09-11, two independent methods agreeing)

**Postgres is being used as a blob cache, and every cache hit is billed as
egress.** A cache that lives in the database does not save traffic, it
manufactures it.

| finding | figure |
|---|---|
| `snapshot_cache` reads | **~16 GB/day of 19.483 (80%)** |
| - via blocks touched | 53,212 B/call x 265,538 calls/day |
| - via residual | (19.483 - 3.6) / 265,536 rows = ~60 KB/read |
| ALL other live query traffic | 24.3M rows/day = **~3.6 GB/day** |

The blobs:
- `mlb:snapshot` **6.6 MB**, read by `load_mlb_games()` -- **32 call sites**
- `mlb:full-raw:<date>` **12.3 MB**
- `nfl:boxscoreRaw:*` **~106 KB** each, 612 keys, read per-game inside loops

## THE MEASUREMENT METHOD THAT WORKS (three earlier ones did not)

- **call rate** -> from a DELTA (only a delta separates live from dead)
- **rows per call** -> from CUMULATIVE `pg_stat_statements` (millions of samples)
- **bytes per row** -> measured per table

Only 35 SELECT statements are actually live. **The pre-5.1 query is DEAD** --
it still shows 45M rows/day cumulative and ran ZERO times in a live window, so
that fix holds and the cumulative figure is a ghost. Cumulative alone cannot
tell live from dead; a short sample cannot give a reliable call rate. Both.

Methods that FAILED and must not be repeated: extrapolating a 10-minute window
(1-call frequencies x144); using `shared_blks` as a byte proxy (**off by 100x**
-- it counts every buffer hit in a scan); a single mean row width on a
heterogeneous table.

## THE PLAN -- APPROVED by the operator 2026-09-11, not yet built

**1. Validation-cache in front of `read_snapshot`/`read_snapshot_with_age` (~13 GB/day).**
NOT a TTL cache. Ask Postgres for `fetched_at` ONLY (~8 bytes); if the local
copy carries that same stamp, serve the payload from local disk. `fetched_at`
IS the version, so there is no staleness window at all. Turns a 6.6 MB transfer
into ~30 bytes.
- **DECIDED: disk, not memory.** Worker RAM is a ceiling we just cleared
  (311/512 MB) and CPython does not return freed arenas, so an in-memory cache
  is permanent once touched. Disk costs no RAM. Reversible decision.
- Must degrade gracefully to a direct DB read if the filesystem is unavailable.

**2. Stop shipping whole blobs to read part of them (~2 GB/day).**
`load_mlb_games` pulls 6.6 MB to build a game list. Push field selection into
SQL with jsonb operators.

**3. Archive family into SQL (~2.5 GB/day) -- INDEPENDENT of 1/2/4, additive.**
`archivePropsJob` and `archiveClosingLinesJob` read Postgres -> reshape in
Python -> write Postgres. `INSERT ... SELECT` keeps the rows in the server.
Measured live: 9.13M + 8.61M + 2.10M rows/day.
- **GATE: assert IDENTICAL ROWS between the Python and SQL paths, not similar
  counts.** This project has been bitten twice by comparisons that matched on
  the wrong key (the board comparison missing `game_id`; the prefix-vs-union
  check that revealed the OLD path was wrong).

**4. Never re-read immutable data (~1 GB/day).** A finished game's boxscore
never changes. `nfl:boxscoreRaw:*` should be cached permanently.

**SAVINGS IN 1, 2 AND 4 OVERLAP -- they are NOT additive.** All three attack the
same ~16 GB; item 4 is item 1 with an infinite TTL. Item 1 alone likely captures
most of it. `item 1 + item 3` may already reach ~4 GB/day, which would make 2
and 4 refinements rather than requirements. Re-measure after 1+3 before
building the rest.

Projected: **19.5 -> ~4 GB/day** against a <=8.3 target.

## VERIFICATION ORDER (operator's explicit instruction: build first, test after)

1. Build items 1 and 3.
2. Correctness tests against the DB (cheap -- a test reads a few thousand rows
   against a platform moving 24.5M/day, i.e. <0.1%; there is no measurement to
   protect).
3. Re-run the live-delta measurement.
4. **Deploy requires asking the operator first** (standing rule).
5. Confirm on the Supabase graph after 24-48h -- the ONLY authority on bytes.
   There is no management token in `.env.local`, so the operator must check it.

Nothing is in flight. The 3-hour measurement window was killed deliberately: it
used the band estimator, which is the least reliable method for the one
contributor that dominates the bill, and it had already been contaminated by
this session's own diagnostic queries.

### Everything else Phase 5 did land

**Database 7,282 → 3,225 MB, 88.9% → 39.4%.** Nothing deleted: 13.9M rows in
Parquet, every prune verifying each row present there by id and content
fingerprint first. `odds_archive` 1,171→8 MB, `prop_odds_archive` 871→7,
`player_game_history` 1,839→460, `mlb_pitch_events` 477→289,
`odds_import_staging` 262→2, plus 7 dead tables and 2 redundant indexes.

Serving stopped transferring 7.2M rows to compute 300 numbers. `fit_nfl_elo`
got a total sort after 232 groups were found sharing `(game_date, event_ref)` —
it was never reproducible run to run. OddsHarvester, dead since 2026-09-01, was
diagnosed (site rebuild, not a block) and fixed by re-vendoring upstream
v0.12.0; MLB and NFL both scrape again at 15/15 matched.

Four alarms now watch rates and boundaries rather than levels:
`databaseGrowth` (MB/day), `corpusFreshness`, `workerMemory`,
`harvesterScrapes`/`orphanJobBreadcrumbs`. The alert channel was paging ~96×/day
on structural reds, which made a real failure invisible; those are acknowledged
with the task that clears them, verified by deliberately breaking a job.

**Two of those alarms were wrong on their first attempt** — `databaseGrowth`
extrapolated a 2 MB wobble into 700 MB/day, `workerMemory` blamed a job that
ran for 0.02 seconds. Both now refuse to state a trend without real history.
Treat them as proven in about a week, not today.

---

## What changed today, in one paragraph

The audit found three ceilings — database 88.5%, egress ~2× its allowance,
worker RAM already OOM-killing a job — and that **one query family was the
largest contributor to all three**: `mlbProjectionsJob` transferred 7,184,704
rows per run to compute 300 numbers. Fixing it (5.1) cut that job 152s → 12.6s
and ended a 13-hour silent outage. Then the corpus (4,434 MB across five tables)
was exported to Parquet, verified, and uploaded to Supabase Storage, and
`player_game_history` was trimmed to a hot window behind a summary table that
reproduces the model exactly.

---

## Where the space is, so the number stops moving

```
now                                        7,258 MB   88.6%
after 5.S.2 + 5.S.3 + 5.S.4               ~5,269 MB   64%
after 5.S.5 + 5.S.6 + 5.S.7               ~2,736 MB   33%
after 5.S.8                               ~2,400 MB   29%
```

**The ~2,400 MB in Phase 5's header was always the figure for a COMPLETED
Phase 5.** `odds_archive` (1,203 MB), `prop_odds_archive` (854 MB) and
`mlb_pitch_events` (476 MB) are all exported and verified in object storage;
none has been deleted, because their readers still query Postgres. That is the
entire remaining gap. Porting those readers is now a *proven pattern* —
`player_game_history` went through it end to end — not an unknown.

---

## The corpus

**441 files / 129.7 MB in Supabase Storage**, `s3://linesmith-corpus/v1`, every
file verified against its local original by size and MD5.

**THE LOCAL STAGING COPY IS GONE.** It lived in the previous session's
scratchpad. `prune_player_history.py` and `prune_corpus.py` both verify against
a local copy, so **re-download from Supabase before running either**. The
credentials are in `.env.local` as `CORPUS_URI` / `CORPUS_S3_*` (Supabase's S3
access keys — NOT the anon key, NOT the service-role key).

Tools, all in `python-odds-service/`:

| tool | does |
|---|---|
| `audit_storage.py` | re-derives every Phase 5 number; exits non-zero when a claim stops matching |
| `export_corpus.py` | Postgres → Parquet, resumable, verifies every partition |
| `upload_corpus.py` | Parquet → Supabase, re-reads each object to confirm it landed |
| `prune_corpus.py` | verify-only by default; deletes by verified row id |
| `prune_player_history.py` | trims to `season >= max(season) - 2`, per sport |
| `measure_projection_memory.py` | worker RSS against the 512 MB plan |

---

## Traps that cost real time today

- **`statement_timeout` is 2 minutes** and the pooler recycles long-lived
  connections. Maintenance work uses one short connection PER PARTITION and
  raises its own timeout. Two full exports died mid-run before this.
- **Every date index is `btree (sport, game_date)`** — composite, `sport`
  leading. A bare `game_date` predicate cannot use any of them.
  `extract(year …)` is likewise non-sargable.
- **A chunk of all-NULLs types an Arrow column as `null`** and poisons the
  writer for every later chunk. The corpus schema is DECLARED from
  `information_schema`, never inferred.
- **CPython's `sum()` is compensated (Neumaier)** and differs from a `+=` loop
  by ~1 ulp. Exact float identity between a summary and a replay is not
  achievable and is not the gate; the served projection is.
- **MLB plays doubleheaders** — 6,617 `(game_date, athlete_id)` pairs are not
  unique, so history sorts need an `id` tiebreaker or the order (and therefore
  `recent_volume`) is unstable.
- **boto3 multipart starts at 8 MB**, and a multipart ETag is an md5-of-md5s.
  Uploads are forced single-part so the cheap hash check stays valid.
- **An exact `as_of` lookup on the summary blanks the board at midnight.** It
  did. `read` now takes the newest summary at or before `as_of`.

---

## Standing constraints

- **Do not deploy to Render without asking** — but the deploy is §5.S.1, so ask.
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.
- **Back up before deleting.** Every prune tool refuses without a verified
  corpus copy, and refuses outright while that copy is local-only.
- **`DELETE` does not return space.** Only `VACUUM FULL` does, and it takes an
  ACCESS EXCLUSIVE lock. That is §5.S.4 and wants a quiet window.
- **The Postgres pooler caps at 15 connections.** Maintenance competes with the
  worker; check what is running first.
- **The Python tests are standalone scripts, not pytest.** Run each with
  `.venv/Scripts/python.exe src/<file>.py`. `test_harvester_scrape.py` cannot
  run locally (imports `oddsharvester`, not installed). TS suite is `npm test`.
- **`.venv/Scripts/python.exe`**, not the system Python.

---

## Open, deliberately not closed

- **~35% of egress is unattributed.** The 64.7% share belonging to the corpus
  pull is counted; the rest is not investigated and may hold another 5.1-sized
  win. **The one post-5.1 rate measurement taken was contaminated** — heavy
  local experiments ran during the window. Re-measure while genuinely idle.
- **Supabase quota: egress, restricting 05 Oct 2026.** Database size is a
  separate ceiling; §5.S.2–4 do not help egress.
- **MLB serves `line: 4.5` while Scan shows the book's posted line** (5.5 on
  2026-09-09). `mlb_board_lines.py` records only 47% of posted lines are 4.5, so
  the displayed Model % answers a different question than the row's bet more
  than half the time. Operator's call.
- **Book coverage went 12 → 26 in two weeks**, which is what moved the growth
  curve. A product decision the architecture absorbs but cannot make.
- **`served_probability_spread` is computed and persisted but still ungated.**

---

## The habit that keeps paying

Four of Phase 3's five sub-phases, and most of today's findings, turned on a
**measurement** being wrong rather than a model. Today alone: an equality check
that would have blocked pruning forever, a digest comparing Python reprs instead
of values, a jsonb test passing while comparing two empty lists, a test
asserting a row count that the prune invalidated, and an egress measurement
contaminated by the measurer. **The tell is a result that is too clean, or one
that fails in a way that flatters the thing you just built.** Check the
measurement before believing the model — in both directions.

---

## PARKED until egress is fixed — cfb / provider coverage (2026-09-11)

Deliberately deferred at the operator's request. All findings below are
measured, not guessed; pick them up after the egress ceiling is under control.

**cfb harvester — partly fixed, not finished.**
- FIXED: discovery walked all 85 league fixtures and died at the 1800s cap.
  Now filtered via schema.org JSON-LD from the league page (one plain HTTP GET)
  to matches that are ours; commits `d5e41de`, `9c4f825`.
- STILL OPEN: the fallback filter only takes 85 → **72** pages, because we track
  166 cfb games and almost every NCAA fixture is ours. At the measured 12–21s
  per page that is 850–1,512s against an 1,800s cap — it will complete on a good
  day and time out on a slow one. **The real fix is to bound work per cycle and
  rotate** (scrape the N most imminent games each run; the scheduled task fires
  every ~20 min, so the slate still gets covered) rather than shrinking the
  kickoff window, which buys cost by giving up lead time.
- STILL OPEN: blocked/dashed moneylines are silently discarded. A real cfb page
  returns `{"1": "-", "2": "41.00", "blocked_outcomes": ["1","2"]}` — books will
  not price an FBS-vs-FCS mismatch two-way. `_parse_decimal_odds("-")` returns
  None, which is indistinguishable from a parse failure. Count them explicitly.
- NOT YET OBSERVED: a cfb run finishing end to end. Both attempts were killed by
  a 900s timeout in the test harness, not by the code under test.

**cfb game-line coverage is thin for a provider reason, not a harvester one.**
`refreshCfbJob` is healthy and writes ~1,614 rows/run, but
`game_odds_book_lines` holds only 25 cfb rows across 4 games. Its own warnings:
```
sharpapi says: limit=500 exceeded max=200; applied=200
sharpapi HTTP 429 on page 12 - backing off
sportsgameodds throttled -- last run 416244s ago, required 2592000s
```
- SharpAPI paginates at 200/page and gets **429'd on page 12** (free tier is
  12 req/min). Leading explanation for the thin coverage — correlated, **not yet
  proven causal**; nobody has traced which records were lost.
- SportsGameOdds is on a 30-day cadence, so it contributes to no given slate.
- ParlayAPI is enabled for cfb and has written zero cfb game lines. Unexplained.
- Propline's absence is DELIBERATE and documented in `provider_matrix.py`:
  1+N requests per cycle means a 178-game slate is ~179 requests against
  SharpAPI's 1. Do not "fix" this without redoing that arithmetic.

Consequence: only **7 of 166** cfb games have a reference total/spread, so the
dynamic-lines discovery pass has almost nothing to aim at even when fast.
