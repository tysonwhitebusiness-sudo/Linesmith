# CURRENT — pick up here

**Phases 1–4 are COMPLETE. Phase 5 (Sustainability) is IN PROGRESS.**

**`docs/master-plan-2026-09-06.md` §5.S is the authority on what remains.** It
lists every remaining step in execution order with its own gate. Work it in
order; deviating needs a reason written into that section. Do NOT re-derive the
ordering conversationally — that is exactly what §5.S exists to stop.

---

## READ THIS FIRST: state at 2026-09-11 01:50Z

```
database   7,282 MB  ->  3,382 MB     88.9% -> 41.3%
```

**§5.S.1 through §5.S.7 are DONE.** All 8 `audit_storage.py` checks pass, tsc is
clean, TS is 359/359, JOB_REGISTRY contract 40/40. Worker is on `4eed32d`.

| table | before | after |
|---|---|---|
| `odds_archive` | 1,171 MB | **8 MB** |
| `prop_odds_archive` | 871 MB | **7 MB** |
| `player_game_history` | 1,839 MB | **460 MB** |
| `mlb_pitch_events` | 477 MB | **289 MB** |
| `odds_import_staging` | 262 MB | **2 MB** |
| 7 dead tables, 2 redundant indexes | 364 MB | **gone** |

### What remains

**5.S.8 — `prop_odds_history` (1,239 MB). NEEDS RESCOPING, NOT EXECUTING.**
Its gate was measured and **both premises were wrong** — see the plan. Short
version: retention already works (2,534 rows survive 30 days); the mass is
~122.7 MB/day flowing into a 14-day window that every consumer reads. Rolling up
"old" rows reclaims almost nothing. And any roll-up must preserve *the last tick
before each game's start*, not the calendar-day close, or CLV goes quietly wrong
rather than missing. `bets` holds **2 rows**, so urgency is low — good time to
pick the shape deliberately.

**5.S.9 — guardrails, part done.** `check_orphan_job_breadcrumbs` is in and
found **ten** tombstones. Still missing: the plan's own gate (*a deliberately
failed job produces an alert the operator actually receives*), an alarm on
**MB/day rather than percent-full**, and worker RAM tracked as a ceiling. The
alert *channel* already exists — health_check is a Render cron every 15 min,
exits 1, and Render's cron-failure notification pages the operator.

**`captureLatency` reports FAIL and it is not damage.** NFL median 3,795 min
(n=1,680) against a 60-minute threshold — a weekly sport captured days ahead,
measured by a rule calibrated for daily ones. Pre-existing; the prune provably
could not have touched it (the 30-day retention margin strictly contains the
check's 7-day window, and the oldest surviving row is 2026-09-03).

**`docs/table-ownership.md` is stale** — 51 live tables against the 36 it
documents, `odds_archive` and `game_result` missing entirely. Flagged in a box
at the top of that file; a re-derivation is queued as its own task.

### The lesson that recurred three times today

**Reading ONE HALF of a split table gives a confident wrong answer.** It cost:
a fit that would have trained on a truncated population, a team index that would
have silently stopped resolving, and the audit's own span check reporting
`odds_archive` as SHRANK while the data was intact. Every reader of a corpus
table goes through a union — `corpus_reads.load_prop_archive` or
`corpus_reads.union_view`, which registers the table in DuckDB so the ORIGINAL
SQL can run unchanged rather than being reimplemented in Python.

**And its sibling:** the 2026-09-04 restart discarded the cumulative statistics
while `pg_stat_database.stats_reset` stayed NULL. It poisoned 5.S.3's index
gate, `vacuum_reclaim`'s bloat estimate, and `audit_storage`'s own 5.0g check.
Anything from `pg_stat_*` covers days, not the database's life.

### Egress

Measured **idle** on 2026-09-11: **10,747,983 rows/day**, against a cumulative
figure of 140,531,438 — because the cumulative window contains five days of
pre-5.1 behaviour, including the old serving query at 511,257 rows/call.
**5.1 is holding.** Tool: `measure_egress_rate.py` (snapshots, waits,
subtracts). Note that a real share of 2026-09-10's ~15 GB was this session's own
corpus verification reads from Supabase Storage; that day is an outlier, not a
baseline. Re-measure over a longer idle window before drawing conclusions.

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
