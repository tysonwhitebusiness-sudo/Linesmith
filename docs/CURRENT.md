# CURRENT — pick up here

**Phases 1–4 are COMPLETE. Phase 5 (Sustainability) is IN PROGRESS.**

**`docs/master-plan-2026-09-06.md` §5.S is the authority on what remains.** It
lists every remaining step in execution order with its own gate. Work it in
order; deviating needs a reason written into that section. Do NOT re-derive the
ordering conversationally — that is exactly what §5.S exists to stop.

---

## READ THIS FIRST: state as of 2026-09-10 15:20Z

**Both of the previous handover's "live conditions" are RESOLVED.** They are
written out here rather than deleted so the next reader can tell a resolved
condition from one nobody looked at.

**1. THE WORKER IS RUNNING.** `dep-dahc2ght0dsc73ff65n0`, commit `6779a3c8`,
live 2026-09-10 14:41:31Z. Every job has a breadcrumb from the post-deploy
startup burst (14:26-14:47Z). Verified through the Render API, not inferred
from breadcrumbs — see "Render answers deploy questions directly" below.

**2. PRODUCTION NO LONGER REPLAYS THE TRUNCATED TABLE. §5.S.1 IS DONE.**
`mlbProjectionsJob` ran at 14:47:16Z: 100 subjects, 640 projections written,
0.48s, `history_rows` 355,764. A local `build()` on the same slate reproduces
it **row for row** — all 640 rows identical on projection, projected volume,
model probability, league baseline and sample size, and the identical
`history_rows` and per-market edges. The summary path is what production
serves, and it serves the same numbers the model was measured on.

### THE ONE THING THAT IS BROKEN, and it is new

**`mlbHistorySummaryJob` FAILS ON RENDER**, every run, since the deploy:

```
IOException: No files found that match the pattern
"/opt/render/project/src/python-odds-service/corpus/player_game_history/*.parquet"
```

**The Render service has no `CORPUS_*` environment variables** (confirmed
against `/v1/services/.../env-vars`: 25 vars, none of them corpus). So
`corpus_location()` takes its documented default — a LOCAL directory — and on
Render that directory is empty. The job was built and proven against the
operator's local staging copy and has never had a path to the corpus in
production.

**What it costs while it stays broken, precisely:** nothing is wrong today, and
that is the trap. `read_history_summary` takes the newest summary at or before
`as_of`, so the board is being served from the **2026-09-09** summary (written
2026-09-10 02:59Z by a local run, 3,591 players, full lifetime history). That
degrades gracefully and silently, one day further behind every day, and the
first visible symptom would be a player with a genuinely changed recent form
projecting off stale numbers. `job_mlb_history_summary`'s own docstring says
it: *"if this job stops, the summary goes stale and the board silently serves
yesterday's history."*

**The fix is five environment variables on the Render service** —
`CORPUS_URI`, `CORPUS_S3_ENDPOINT`, `CORPUS_S3_REGION`, `CORPUS_S3_KEY_ID`,
`CORPUS_S3_SECRET`, the same values already in `.env.local`. That is a config
change to a live service and it restarts the worker, so it is an operator
decision, not a code change. Egress is not an objection: the job is daily by
deliberate design (its docstring reasons about exactly this), so it is roughly
one corpus read per day, not per hour.

### Also failing, and it predates all of this

**`computeMlbPropPredictionsJob` has been dead since 2026-09-08 02:23Z** —
`KeyError: 'a'` in `apply_prop_calibrations` (`jobs.py:812`). Two and a half
days of a job failing with nobody noticing is precisely the failure mode
**§5.S.9** exists to end. Not chased here because §5.S is worked in order; it
is the concrete test case §5.S.9's gate should be written against.

### Render answers deploy questions directly

`RENDER_API_KEY` is in `.env.local`. `GET /v1/services` and
`GET /v1/services/srv-da36bm2bkg8c73fqrdeg/deploys` give deploy id, status,
commit and finish time. **Use it instead of inferring deploy state from job
breadcrumbs** — a breadcrumb tells you a job ran, not which code ran it.

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
