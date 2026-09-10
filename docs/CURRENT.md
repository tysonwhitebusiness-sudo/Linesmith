# CURRENT — pick up here

**Phases 1–4 are COMPLETE. Phase 5 (Sustainability) is IN PROGRESS.**

**`docs/master-plan-2026-09-06.md` §5.S is the authority on what remains.** It
lists every remaining step in execution order with its own gate. Work it in
order; deviating needs a reason written into that section. Do NOT re-derive the
ordering conversationally — that is exactly what §5.S exists to stop.

---

## READ THIS FIRST: state as of 2026-09-10 17:00Z

**§5.S.1, §5.S.2 and §5.S.3 are DONE.** §5.S.4 is next and is READY but was not
started — see "why" below, it is a real reason and not an omission.

```
database   7,282 MB  ->  7,174 MB     88.9% -> 87.6%
```

That is 108 MB from 5.S.2 (7 tables dropped) and 5.S.3 (2 indexes dropped). The
big one is still ahead: **~266 MB of 5.S.2's deleted rows are still occupying
their file**, and only 5.S.4's `VACUUM FULL` returns them.

### The worker

`dep-dahdveifngtc73945db0`, commit `16d77532`, live 2026-09-10 16:51:35Z.
Verified through the Render API — `GET /v1/services/.../deploys` and
`/events` — not inferred from breadcrumbs. `RENDER_API_KEY` is in `.env.local`.
**A breadcrumb tells you a job ran, not which code ran it.**

**§5.S.1's gate passed before any of today's work:** `mlbProjectionsJob` at
14:47:16Z reproduced row-for-row by a local `build()` on the same slate — all
640 rows identical on projection, projected volume, model probability, league
baseline and sample size, `history_rows` 355,764 both sides.

### mlbHistorySummaryJob was failing, and it cost more than staleness

The Render service had **no `CORPUS_*` environment variables**, so
`corpus_location()` took its documented default — a local directory — which on
Render is empty. Fixed: all five vars set via the API and confirmed present
(30 vars on the service now).

**A RENDER RESTART DOES NOT RE-READ ENVIRONMENT VARIABLES. A DEPLOY DOES.**
`POST /services/{id}/restart` ran at 16:41:29Z and the job failed again at
16:44 with the identical error. `POST /services/{id}/deploys` at 16:50 is what
actually picked them up. Worth knowing before diagnosing this class of thing
for an hour.

**What the failure actually cost, measured rather than guessed.** Today's board
was being served from the 2026-09-09 summary (`read_history_summary` takes the
newest at or before `as_of`, which degrades quietly by design). Rebuilding
today's summary from the corpus moved the board from **640 projections to 800**
and restored the whole of **`pitcher-hits-allowed`**, which the stale summary
had silently dropped because it held no rows for tonight's starters. Batter
projections moved ~0.001-0.007, and every market edge stayed inside the healthy
-0.03..+0.013 band. So the cost was not "slightly stale numbers"; it was 160
missing rows and a missing market.

Today's summary is already written (1,242 rows, `source=union`, as_of
2026-09-10). **The corpus reads fine from Supabase over S3** — 2,807,445 rows
visible via DuckDB, ~240s for a full summary rebuild, which is why the job is
daily and must stay daily.

### Still broken, and it predates all of this

**`computeMlbPropPredictionsJob` has been dead since 2026-09-08 02:23Z** —
`KeyError: 'a'` in `apply_prop_calibrations` (`jobs.py:812`). Untouched because
§5.S is worked in order; it is the concrete test case §5.S.9's gate should be
written against.

### Why 5.S.4 was not started

Two conditions, both checked, both temporary:

1. **The pooler was at 16 connections against a cap of 15** — the worker's
   post-deploy startup burst. `VACUUM FULL` takes an ACCESS EXCLUSIVE lock on
   `player_game_history` and competes for the same pool. A `vacuum_reclaim.py`
   planning run hung for 5 minutes on exactly this and had to be killed.
2. **`mlbHistorySummaryJob` was mid-run on the worker** (started 16:55:09Z,
   ~4 minutes), reading the corpus and writing the summary.

`python-odds-service/vacuum_reclaim.py` is WRITTEN AND READY. It plans by
default and refuses to `--apply` unless the projected new relation plus a
250 MB margin fits in the headroom — because `VACUUM FULL` builds the new copy
BESIDE the old one and swaps at the end, so peak usage is both at once. Run
`python vacuum_reclaim.py player_game_history` first; it prints every other
connection that will block. **Wait for a quiet pooler.**

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
