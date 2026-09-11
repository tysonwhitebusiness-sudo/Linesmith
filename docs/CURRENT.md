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

Supabase's own usage graph, billing period 28 Aug – 28 Sep 2026:

```
  Included in Pro Plan   250 GB
  Used in period         623.32 GB
  Overage in period      373.32 GB
  2026-09-11             19.483 GB/day   -- Shared Pooler Egress, 100.0%
```

At ~19.5 GB/day the run-rate is **~585 GB/month, 2.3× the allowance**. Landing
under 250 GB needs **≤8.3 GB/day** — about a 2.4× cut.

**It is 100% Shared Pooler, 0% Storage.** The Parquet corpus is NOT contributing
to this bill; moving 13.9M rows out of Postgres was correct and the corpus reads
are not leaking back in. Every one of those 623 GB is database rows crossing the
pooler, so the remedy is in the serving queries, not in storage layout.

### How the measurement got here, because it was wrong three times

`measure_egress_rate.py` reported a clean `0.00 GB/day` from **three independent
defects**, any one of which alone produced that same plausible zero: query text
truncated to 110 chars (the `FROM` clause sits at char 311); `_table_widths`
called on a connection already released to the pool; and a literal **0x08
backspace byte** where `\b` belonged, written in by a heredoc that ate the
backslash — a regex that could never match anything.

Then the rows→bytes model was wrong twice more. A single mean width is invalid
for `snapshot_cache`, which stores 80-byte `provider-throttle:*` keys beside a
12.4 MB `mlb:full-raw` blob; charging the mean over-counted the throttle reads
**644×** and invented 153 MB out of 238 KB. Excluding such tables then
over-corrected the other way — the full band contained the true 19.483 GB/day,
the excluding version sat below it.

**The lesson to carry: a zero, or any clean number, from a broken parser looks
exactly like a real measurement.** Three separate bugs each produced the same
tidy answer, and the only thing that caught it was refusing to accept a figure
that flattered. The tool now reports a band and calibrates against a known
actual via `--actual-gb-day`.

### Next actions on egress

1. A **3-hour** measurement window is the minimum honest one — five jobs in
   `JOB_REGISTRY` are on 86,400s (daily) schedules and the shortest is 150s, so
   a 10-minute window extrapolated ×144 badly over-weights whatever periodic
   job happened to land in it. The tool now flags any query with fewer than
   `MIN_CALLS_TO_TRUST` calls as extrapolation-unsafe.
2. Rank contributors by **bytes**, not rows, and cut the largest serving reads.
   Early signal (unconfirmed, from a 600s window): `SELECT DISTINCT ON (game_id,
   subject_id, market_key, line, bookmaker, side) …` at ~13,500 rows/call.
3. Re-check the Supabase graph after any change — it is the only authority on
   bytes, and there is no management token in `.env.local`, so it needs the
   operator.

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
