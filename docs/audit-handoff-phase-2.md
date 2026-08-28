# Linesmith Audit — Handoff after Phase 2 (for Phases 3–5)

> Produced by Phase 2 (2026-08-27). Companion to, **not** a replacement for,
> `docs/audit-handoff.md` (the post-Phase-1 handoff). That doc's access
> instructions and per-phase starting points still stand — **except where §1
> below corrects them.** Read this file second, after it.
>
> Phase 2's own output is `docs/audit-phase-2.md`. Read that only if you need a
> finding's full reasoning; everything a later phase actually needs is here.

---

## 0. Read this first

Phase 2 verified the codebase against the live database and found that **several
factual claims in the Phase 1 inventory and in `audit-handoff.md` are wrong**,
including one that a Phase 3 task is directly built on. §1 is the correction
list. Do not start Phase 3 without reading it — the original handoff tells you
to do something the data cannot support.

Also: the audit prompts tell you to treat everything as a hypothesis to check.
That applies to this document too. Every number below was measured, but the
system is actively changing (a hung worker, 208 uncommitted files) — re-verify
anything load-bearing.

---

## 1. Corrections to Phase 1 / `audit-handoff.md`

### 1.1 CRITICAL for Phase 3 — the market-baseline comparison is not viable as planned

`audit-handoff.md`'s Phase 3 section says:

> "**Baseline comparison:** does any model beat `market_prob` (the vig-removed
> market line) out-of-sample? `pick_history` has both columns for 355k rows —
> this is directly answerable."

**This is false.** Measured:

| column | rows populated | of 362,616 |
|---|---:|---:|
| `model_prob` | 355,246 | 98% |
| `outcome` (graded) | 356,462 | 98% |
| **`market_prob`** | **3,615** | **1.0%** |
| `edge` | 3,615 | 1.0% |
| `score_grade` | 31,219 | 8.6% |
| `edge_source` | **0** | 0% |
| `price` | **0** | 0% |

The model-vs-market comparison has a **3,615-row sample**, not 355k. Phase 3
should establish what those 3,615 rows actually are (which sport, dimension,
date range, and which writer populated them) before drawing any conclusion, and
should treat "we cannot currently answer this at scale" as a legitimate — and
important — finding in its own right.

Phase 1 §12.2 #15 noted `edge_source` was 100% NULL. It did not note that
`price` (added 2026-08-27) is also 100% NULL, or that `market_prob` is
effectively unpopulated.

### 1.2 CRITICAL for Phase 3 — `pick_history` is 2 sports and 87% backfill

Phase 1 reported "362,400 MLB / 207 NFL" correctly but the composition matters
more than the split:

| sport | rows | graded | `event_context='backfill'` | date range |
|---|---:|---:|---:|---|
| mlb | 362,409 | 356,411 | **316,327** | 2010-04-22 → 2026-08-27 |
| nfl | 207 | 51 | 0 | 2026-08-27 only |

So **live (non-backfill) graded MLB history is ~40,000 rows, not 356,000**, and
every other sport has essentially none. Any calibration, Brier, or
leakage conclusion drawn over the whole table is dominated by a 2010–2026
historical backfill, not by the model as it runs today.

### 1.3 Leakage: the specific line to look at

`audit-handoff.md` correctly flags `writeBackfill` as where date-boundary
leakage would hide. Confirmed, with the exact mechanism —
[`lib/db/client.ts:1161`](lib/db/client.ts:1161):

```sql
INSERT INTO pick_history
  (..., event_context, model_prob, outcome, actual_value, surfaced_at, graded_at)
VALUES (..., 'backfill', @modelProb, @outcome, @actualValue, @surfacedAt, @surfacedAt)
```

`surfaced_at` and `graded_at` are **the same value**, and `outcome`/`actual_value`
are written at insert time. A backfilled row therefore carries no evidence that
the prediction preceded the outcome. Whether `@modelProb` was computed from data
strictly prior to the game is decided entirely by the caller, in code — there is
no temporal constraint in the schema. 316,327 rows are in this state.

**Phase 3's job:** trace every caller of `writeBackfill` / the
`/api/props/*backfill*` routes and `backfill_player_game_history.py`, and
determine for each whether the feature window excludes the graded game. Do not
infer it from the function name.

### 1.4 ANSWERED — Phase 1 open question #6 (what writes `golf_model_predictions`)

`lib/sports/golf/adapter.ts`, **on every golf snapshot rebuild (i.e. page
load)**. Lines ~675 (`logGolfModelPredictions`), 689
(`void ingestGolfHistory`), 696 (`void gradeAllGolfPredictions`).

This runs *in addition to* the Python `golfPredictionsJob`, whose own registry
comment (`jobs.py:932-936`) claims the TS path was removed. It wasn't. Golf has
**two live prediction pipelines** writing the same tables from separately-
maintained ported model code. Full detail: `audit-phase-2.md` H1.

**Phase 3 consequence:** before evaluating golf model quality, establish which
pipeline produced the rows you're scoring. They can disagree.

### 1.5 ANSWERED — Phase 1 open question #11 (which TS provider files are live)

Traced every import. Ruling:

| File | Verdict | Why |
|---|---|---|
| `lib/odds/props/sportsGameOddsRefresh.ts` | **DEAD** | zero callers; only comment references |
| `lib/odds/props/tier1Refresh.ts` | **LIVE** | `app/api/props/scan-player/route.ts` |
| `lib/odds/props/registry.ts` | **LIVE** | `tier1Refresh.ts`, `/api/props/more-books`, `/api/props/diagnostics` |
| `lib/odds/props/config.ts` | **LIVE** | 5 importers incl. `/api/props/{sharp-price,line-history}` |
| `lib/odds/props/providers/*.ts` (7) | **LIVE** | all reachable |

**`CLAUDE.md` is wrong** where it says the Python worker "fully replaced" the TS
provider jobs. It replaced the *scheduled* jobs; the *on-demand* TS paths remain
live. Phases 4 and 5 should not treat `lib/odds/props/` as legacy.

### 1.6 NEW — there is a second Render service, and it may be the web app

`before_delete_snapshot.json` (untracked, repo root) contains a Render service
listing captured during an earlier operation:

```
line-buddy-odds-worker | id: srv-da36bm2bkg8c73fqrdeg | suspended: suspended
Linesmith              | id: srv-da2v3ajsmd2c738bj7v0 | suspended: suspended
```

Phase 1 concluded the Next.js app "appears to run on the operator's laptop"
because no hosting config exists in the repo, and listed it as open question #1.
**There is a Render service named `Linesmith`** that Phase 1's service
enumeration did not surface in its write-up.

**Phase 4 must resolve this before modelling scale or attack surface**: is
`srv-da2v3ajsmd2c738bj7v0` the web app, is it currently running, and is it a
third consumer of the ~9-connection Postgres budget? Query
`GET /v1/services/srv-da2v3ajsmd2c738bj7v0` with `RENDER_API_KEY`.

### 1.7 CLOSED — migration verification cannot be completed

`data/linebuddy.db` **no longer exists** on this machine (`ls data/` shows only
`historical-odds-import/`). Per-row fidelity against the SQLite source is
permanently unverifiable unless the operator has a copy elsewhere.

**Structure was verified and is sound** — do not redo this:
UTF-8 encoding; 24 identity columns all `GENERATED ALWAYS`; **every sequence's
`last_value` ≥ its table's `max(id)`** (no desync); 43 `timestamptz` + 5 `date`
with zero TEXT date columns; 23 real `BOOLEAN` columns; `prop_odds` has no
nulls, blanks, or out-of-range odds.

### 1.8 `odds_unresolved` is a fossil — `/diagnostics` is showing stale data as live

There is **no Python writer** for `odds_unresolved` (no
`replace_unresolved_for_provider` exists in `db.py`). The only writer is
`lib/odds/props/registry.ts:140`, reachable via `/api/props/more-books` and
`/api/props/scan-player`. Since the Python cutover, the worker is the routine
fetcher — so the 1,538 rows on `/diagnostics` are pre-cutover TypeScript-era
data rendered as current.

**Phases 4 and 5:** do not treat any `/diagnostics` panel as live without
checking its writer. This one isn't, and it looks fine.

### 1.9 `snapshot_cache` composition has shifted since Phase 1

Phase 1 described it as dominated by `mlb:full-raw` and `nflverse-*`. Measured
now (`pg_column_size`, compressed):

| key family | rows | size | note |
|---|---:|---:|---|
| `mlb:full-raw:{date}` | 15 | 125 MB | ~8 MB/day, never deleted |
| `nfl:boxscoreRaw:*` | 481 | 43 MB | **all created 2026-08-27** — new, fastest-growing |
| `mlb:snapshot:{date}` | 6 | 17 MB | |
| `cfb:cfbd:*` | 554 | 6.8 MB | |
| everything else | ~1,950 | ~30 MB | |

**717 rows / 107 MB have not been written in 3+ days.** Table reports 366 MB but
payloads sum to ~220 MB — the rest is bloat from 5,787 TOAST-rewriting updates.

---

## 2. Operational notes — DB access (read before querying)

`audit-handoff.md`'s access section is accurate. Additions from actually doing it:

- **Transaction-mode pooler works fine** and is the right choice. Swap
  `:5432` → `:6543` in the `DATABASE_URL` from `.env.local`. One
  `new pg.Client(...)`, `ssl: { rejectUnauthorized: false }`. I ran ~50 queries
  including `EXPLAIN ANALYZE` with no `EMAXCONNSESSION`.
- **The working script pattern** (`pg` resolves only inside the repo):
  ```
  cd C:/Users/occy3/Documents/line-buddy
  # write _tmp.mjs here, run it, then delete it
  node ./_tmp.mjs ; rm -f ./_tmp.mjs
  ```
  Batching many queries into one connected script and dumping JSON to a file is
  far cheaper than one process per query.
- **`n_live_tup` is unreliable — do not quote it.** `pg_stat_user_tables` reports
  `pick_history` at 1,664 live rows; real `COUNT(*)` is 362,616. Several tables
  are similarly wrong. Use real counts for any number you publish.
- **`pg_stat_statements` has never been reset** (`pg_stat_database.stats_reset
  IS NULL`), so all figures are lifetime since the 2026-08-18 migration. Scan
  counts in `pg_stat_user_tables` corroborate it.
- **`SELECT SUM(LENGTH(payload)) FROM snapshot_cache` takes 32+ seconds** — it's
  in the top 5 queries by total time system-wide. Use `pg_total_relation_size()`
  or `pg_column_size(payload)` with a `LIMIT`.
- Set `statement_timeout: 60000` on the client; a few aggregates genuinely need it.

---

## 3. Do not redo — Phase 2 covered these

- Full dead-code sweep: import-graph over every `.ts`/`.tsx` in `app/`,
  `components/`, `lib/`; reference sweep over all **104** API routes; import
  sweep over `python-odds-service/src/**/*.py`. Results in `audit-phase-2.md` M2.
- The `lib/odds/props/` keep/delete ruling (§1.5 above).
- Migration structural verification (§1.7 above).
- Index inventory + `idx_scan` per index; `EXPLAIN ANALYZE` on the
  `pick_history` calibration aggregates, the `prop_odds` prior-price lookup, and
  the `game_odds_history` prior lookup.
- Provider market-coverage and freshness by provider; full `odds_unresolved`
  breakdown.

---

## 4. Leads by phase

### Phase 3 — odds math + models

Beyond §1.1–1.4:

1. **Every edge/devig calculation is computed against an incomplete market.**
   Phase 2's Critical finding C1: Propline (141,854 rows, the highest-volume
   provider) resolves **exactly one MLB market** (`pitcher-strikeouts`); its
   entire batter-prop feed across ~13 books is dropped by a gap in
   `MARKET_KEY_ALIASES`. So "best line", "market-implied probability", and
   "edge %" for every MLB batter prop are derived from a book set missing the
   largest feed. **Any conclusion Phase 3 reaches about edge quality is
   conditional on this being fixed.** Say so explicitly.
2. **Market coverage by provider** (measured, useful context for any
   model-input question):

   | provider | distinct markets | rows |
   |---|---:|---:|
   | propline | 5 (1 MLB) | 141,854 |
   | propline_2 | 5 (0 MLB) | 51,884 |
   | sharpapi | 14 | 32,159 |
   | oddsapiio | 7 | 29,888 |
   | sportsgameodds | 21 | 19,574 |
   | parlayapi_mlb | 15 | 7,814 |
   | parlayapi | 26 | 7,164 |

3. **TS/Python math-port divergence has a proven precedent.** `entity_resolution.py`
   is a faithful port of `entityResolution.ts` — including the bug in C1. When
   checking whether `predict/odds_math.py` etc. agree with their TS originals,
   note that "they agree" does not mean "they're correct"; both can be wrong
   identically. Check each against the maths, not against each other.
4. `model_weights` is MLB-only (moneyline v8, total v8, home-run v5, all fitted
   2026-08-12→14). `model_artifacts` and `model_calibration` are **empty** — the
   ensemble is backtested but not activated. Unchanged from Phase 1; re-confirmed.

### Phase 4 — auth, scale, security

1. **Resolve the second Render service first** (§1.6). It changes the topology.
2. **The connection budget is already spent.** Phase 2's finding C2: a 2-minute
   timer in `lib/scheduler.ts` runs ~36 full scans of `pick_history` per tick;
   measured **24,705 sequential scans / 4.49 billion rows read**, ≥5,600s of DB
   CPU. This is the direct cause of the `statement timeout` / `EMAXCONNSESSION`
   entries in `system_events` on `/api/odds/lines`. **Any scale model that
   assumes the ~9 connections are available to users is wrong** — a large share
   is consumed by this before the first visitor arrives.
3. **Unauthenticated routes that cost money or CPU** (confirmed unreferenced by
   any frontend, so unlikely to be missed if gated):
   - `/api/odds/game-lines` — legacy MLB route; `?force` triggers a paid
     The Odds API call.
   - `/api/golf/predictions` — self-described "testing/integration endpoint",
     runs a 3,000-iteration Monte Carlo per request.
   - The `/api/props/*` backfill/fit/ingest operator routes remain public.
4. **`/diagnostics` panel trustworthiness** — see §1.8.

### Phase 5 — competitive + standards research

1. **Under-used data assets, now quantified:** `prop_odds_history` 425,307
   line-movement points (~20,000/day when the worker is healthy) and
   `game_odds_history` 19,667, both read today only by grading and one
   line-history route. CLV, steam detection, and book-lag analysis are all
   already in the database.
2. **Temper the `pick_history` asset claim.** The original handoff calls it
   "362k graded model predictions with market-implied baseline." It is 2 sports,
   87% historical backfill, and the market baseline exists on 1% of rows (§1.1,
   §1.2). Still valuable; not what it says on the tin.
3. **Engineering-standards gaps confirmed by Phase 2**, in addition to Phase 1's
   list: no retention policy on any table; config duplicated across three
   places with no test keeping them in sync (this caused two real defects — a
   silently-ignored spend cap and the C1 market map); no CHECK constraints on
   any status/enum column, which is the layer that would have made C1 loud
   instead of silent.

---

## 5. Open questions Phase 2 could not answer

Carried forward — these need the operator, not more digging.

1. **Are the 208 uncommitted files one change set or several?** (Blocks the
   unification plan's Step 1. Three applied migrations exist only on this laptop.)
2. **Does `data/linebuddy.db` exist anywhere else?** (Closes §1.7 or confirms it.)
3. **What Supabase plan, and what size/egress/connection ceilings?**
   (DB is 1,562 MB and growing ~8 MB/day from `snapshot_cache` alone.)
4. **Any backup/restore procedure, or entirely Supabase's built-in?**
5. **Is `ODDS_API_KEY` deliberately withheld from the worker's Render env?**
   Health check says `mlbGameLinesJob` → "ODDS_API_KEY is not set" while
   `odds_cache` shows the TS route refreshing it fine. Two owners, one job.
6. **Should Propline's alt-line markets** (`batter_2plus_hits`,
   `batter_3plus_rbis`, …) **get their own market keys or fold into the base
   market?** Needed to finish the C1 fix correctly.
7. **Is `srv-da2v3ajsmd2c738bj7v0` ("Linesmith") the web app, and is it running?** (§1.6)

Still open from Phase 1 and not addressed by Phase 2: the worker hang root
cause (#2), whether Render `notifyOnFail` is wired (#3), the OddsHarvester
laptop's identity (#5), the `player_game_history` backfill status (#7), and
whether TheRundown is used at all (#10).

---

*End of Phase 2 handoff. Phases 3, 4, 5 remain independent of each other and can
run in any order or in parallel, each in its own fresh session.*
