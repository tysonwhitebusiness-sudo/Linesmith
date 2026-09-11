# CURRENT — pick up here

**Phases 1–4 are COMPLETE. Phase 5 (Sustainability) is IN PROGRESS.**

**`docs/master-plan-2026-09-06.md` §5.S is the authority on what remains.** It
lists every remaining step in execution order with its own gate. Work it in
order; deviating needs a reason written into that section. Do NOT re-derive the
ordering conversationally — that is exactly what §5.S exists to stop.

---

## READ THIS FIRST: PHASE 5 IS COMPLETE — 2026-09-11

```
database   7,282 MB  ->  3,143 MB     88.9% -> 38.4%
```

**§5.S.1 through §5.S.9 are all DONE.** All 8 `audit_storage.py` checks pass,
`health_check.py` exits 0, tsc is clean, TS 359/359, registry contract 40/40.

| table | before | after |
|---|---|---|
| `odds_archive` | 1,171 MB | **8 MB** |
| `prop_odds_archive` | 871 MB | **7 MB** |
| `player_game_history` | 1,839 MB | **460 MB** |
| `prop_odds_history` | 1,279 MB | **1,037 MB** (capped ~1,727) |
| `mlb_pitch_events` | 477 MB | **289 MB** |
| `odds_import_staging` | 262 MB | **2 MB** |
| 7 dead tables, 2 redundant indexes | 364 MB | **gone** |

**Nothing was deleted that is not in the corpus.** Every prune verified each row
present in Parquet first, by id and content fingerprint.

---

## THE ONE THING THAT MUST HAPPEN ON THE OPERATOR'S MACHINE

**`scripts/corpus-refresh-setup.ps1` HAS NOT BEEN RUN.** Until it is, nothing
exports the corpus on a schedule.

```powershell
.\scripts\corpus-refresh-setup.ps1
```

Why it matters: Postgres now keeps a **14-day** window of `prop_odds_history`
and the corpus is the only copy of anything older. A stalled export does **not**
lose data — `prune_corpus` refuses to delete a row it cannot see in the corpus
— it stops reclaiming space while the table grows ~123 MB/day.
`health_check.corpusFreshness` alarms at 250,000 unexported rows (about half a
day). It cannot be a `JOB_REGISTRY` entry: the export peaks at ~280 MB RSS
against a 512 MB plan shared with 37 jobs.

---

## Verified end-to-end 2026-09-11 14:05Z, after a full day in production

Worker deployed at `0c76ca4c` (13:41:58Z). Database **3,199 MB / 39.0%**.
8/8 audit checks, tsc clean, TS 359/359, 7 Python suites, corpus 13,915,007 rows
across 6 tables readable with spans 1999→yesterday. Board: **2,332 projections,
zero mismatches** against production. Routes exercised live: pitch-profile
200/410, chart rendering 16 books of real ticks, clamp reporting
`servedHours: 345`.

### Three things the new alarms surfaced on their first day

1. **`workerMemory` — 445 MB of 512 (87%), heaviest in `refreshTier1`.** Above
   the 80% warn line. This is the ceiling the plan said had already OOM-killed a
   job; it is now a number anyone can read instead of something you learn by
   watching a job die.
2. **`refreshTier1` takes ~341s against a 300s interval.** It cannot meet its
   own cadence, so `check_job` will mark it stale on any run that is not
   perfectly timed, and `gameOddsBookLinesFreshness` fails as a consequence. It
   is not broken — a healthy run writes ~76,000 rows — the interval is simply
   shorter than the work. One of them has to move.
3. **A statement timeout during the post-deploy burst.** `refreshTier1` failed
   once at 13:49 with `QueryCanceledError`, then recovered unaided.
   **Ruled out as a Phase 5 side effect:** the planner was shown the actual
   prior-rows query with real values and chose `idx_prop_odds_subject` — the
   composite that was KEPT — not `idx_prop_odds_game`, which 5.S.3 dropped and
   which it would not have used anyway (three matched columns against one).

### OddsHarvester: ten days of silent zero — DIAGNOSED, fix not yet applied

Full audit: **`docs/oddsharvester-outage-2026-09-11.md`**. Short version: not an
anti-bot block. OddsPortal rebuilt its frontend and removed every `data-testid`,
which is what all 29 of the vendored scraper's selectors key on; the site still
returns HTTP 200 and 699 KB of real fixtures. **Upstream already fixed it** —
we vendor 0.10.0, upstream shipped the selector rewrite in v0.11.0/v0.12.0 on
2026-09-02/03, one and two days after we broke. The upgrade is the fix and our
coupling is four imports, all of which still exist with an identical
`run_scraper` signature.

### Egress

Measured over 20 minutes: **30,967,292 rows/day extrapolated, 22.9% of the
135.5M cumulative figure**. **That window was NOT idle** — it contains this
session's own verification (a 40,011-row `player_game_history` pull, a 14.8 MB
props route fetch), so treat it as an upper bound rather than a steady state.
The team-index fix is visible and working: `SELECT sport, name_key, team_id FROM
team_name_index` reads **859 rows/call** where `_team_ids` used to scan 1.98M.

---

## Two real problems that are TRACKED, not fixed

Both are acknowledged in `health_check.ACKNOWLEDGED_CHECKS` so the alert channel
stays usable. Each names the task that clears it; delete the entry when fixed.

1. **NFL "closing" lines are not closes.** `live_capture` rows stop updating a
   median **61 hours** before kickoff, while mlb and cfb reach 2 minutes.
   `fit_nfl_elo` benchmarks against exactly those moneylines. *I twice called
   this a threshold artifact; it is not.*
2. **`cfb/sportsgameodds` is declared and produces nothing** while CFB is live.

## What Phase 5 actually taught, in two lines

**Reading ONE HALF of a split table gives a confident wrong answer** — it cost a
fit trained on a truncated population, a team index that would have silently
stopped resolving, and the audit's own span check crying data loss over intact
data. Every reader now unions, via `corpus_reads.load_prop_archive` or
`union_view`, which runs the ORIGINAL SQL rather than a reimplementation.

**A measurement that flatters the thing you just built is wrong.** The
2026-09-04 restart discarded `pg_stat_*` while `stats_reset` stayed NULL and
poisoned three separate measurements. The index gate could not fail. The bloat
estimate read `game_result` as 199 rows. `databaseGrowth` extrapolated a 2 MB
wobble to 700 MB/day. A corpus comparison "failed" on timezone formatting. Each
was caught by the output looking wrong, never by a test.

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
