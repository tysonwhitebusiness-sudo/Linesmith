# Phase 2 — Codebase Coherence + Database

> Independent audit, 2026-08-27. Method: read the code, then verified every
> load-bearing claim against the live Supabase Postgres (single connection,
> transaction-mode pooler) with real row counts, `EXPLAIN (ANALYZE, BUFFERS)`
> plans, and `pg_stat_statements`. Anything I could not verify is marked
> **UNVERIFIED** with the specific next step.
>
> Baseline: commit `825e032` plus **208 uncommitted files** (94 modified, 5
> deleted, ~109 untracked). See H7 — this materially limits what "the repo
> says" is worth.

---

## What I actually found

The instinct that triggered this audit is correct, and it is worse than a
tidiness problem. The half-replaced work isn't just leaving dead files around —
in three places it is **actively changing what the app does**, and in one place
it has been silently throwing away most of your flagship data feed since before
the Python cutover.

The two things I'd fix this week, in order:

1. **Propline — your highest-volume paid provider — delivers exactly one usable
   MLB market.** Every batter prop it returns (total bases, hits, home runs,
   RBIs, runs, singles, doubles, stolen bases, walks) across ~13 sportsbooks is
   parsed, found unmappable, and dropped on the floor. You are paying for it
   daily. (C1)
2. **A 2-minute background timer is running ~36 full table scans of a 362,000-row
   table forever**, whether or not anyone is using the site. It is the single
   largest consumer of database time in the system and it is what produces the
   `statement timeout` / `EMAXCONNSESSION` errors you see on `/api/odds/lines`. (C2)

Neither is visible from the UI. Both report success. That is the pattern to
internalise: **everything in this system that is broken is broken quietly.**

Some genuinely good news, so the list below is read in proportion:

- **The Postgres migration is structurally correct.** All 24 identity columns
  are `GENERATED ALWAYS`, every sequence is ahead of its table's `max(id)` (no
  desync — the classic migration bug), all 43 timestamps are real `timestamptz`
  with zero TEXT dates, all 23 booleans are real `BOOLEAN`, encoding is UTF-8.
  I looked for the usual carnage and did not find it.
- **The write path validates more than I expected.** `prop_odds.american_odds`
  is `NOT NULL`, and I checked every row for impossible American-odds values
  (my first pass flagged 10,999 — that was my own query bug; `±100` is valid).
  There is no odds garbage in the table.
- **The `job_runner` / `ProviderSpec` architecture in `CLAUDE.md` is real** and
  does what it claims. The rate-limit/budget centralisation is genuinely sound
  design.
- **`entity_resolution.py` is a faithful port of `entityResolution.ts`** — I
  diffed the alias maps and normalisation. It is faithful; unfortunately it
  faithfully reproduces the bug in C1.

---

# FINDINGS

Ranked strictly by severity, not by area or effort.

---

## CRITICAL

### C1 — Propline's entire MLB batter-prop feed is silently discarded

**What it is.** Propline returns MLB player props under market keys like
`batter_total_bases`, `batter_hits`, `batter_home_runs`. The market-name
resolver has no entry for any key with a `batter_`/`pitcher_` prefix, so every
one of those rows fails to resolve and is thrown away. `pitcher_strikeouts`
happens to be in the map by coincidence — which is why exactly one MLB market
survives.

**Where.**
- `python-odds-service/src/entity_resolution.py:275` `resolve_market_key()`,
  and its `MARKET_KEY_ALIASES` table above it.
- Identical gap in the TS original: [`lib/odds/props/entityResolution.ts:255`](lib/odds/props/entityResolution.ts:255).
- Discard happens at `python-odds-service/src/providers.py:148` in
  `_normalize_row()`.

**The evidence.** Propline has written 141,854 `prop_odds` rows. Grouped by
market key, all of them are:

| market_key | rows |
|---|---:|
| `pitcher-strikeouts` | 45,043 |
| `anytime-goalscorer` | 43,081 *(soccer)* |
| `two-plus-goals` | 31,406 *(soccer)* |
| `first-goalscorer` | 22,230 *(soccer)* |
| `saves` | 94 *(soccer)* |

**One MLB market.** Meanwhile `odds_unresolved` records what was dropped —
1,317 rows across 23 distinct market keys, all from Propline, all mainstream:

```
batter_total_bases (174, 13 books)   batter_hits_runs_rbis (157, 11 books)
batter_hits (120, 9 books)           batter_doubles (102, 7 books)
batter_home_runs (99, 11 books)      batter_singles (96, 7 books)
batter_rbis (91, 8 books)            batter_stolen_bases (89, 10 books)
batter_runs (77, 9 books)            batter_walks (47, 4 books)
pitcher_earned_runs (19, 9 books)    pitcher_hits_allowed (19, 8 books)
pitcher_outs (15, 11 books)          + 10 alt-line variants
```

The resolver's three-step fallback (as-is → collapse to `_` → strip
separators) turns `batter_hits` into `batterhits`, which is also absent. The
map *does* contain `batting_hits`, `pitching_hits`, `pitching_outs` — the
**SportsGameOdds** naming convention. Propline's convention was never added.

Provider market-coverage comparison makes the anomaly obvious:

| provider | distinct markets resolved | rows |
|---|---:|---:|
| `propline` | **5** (1 MLB) | 141,854 |
| `propline_2` | **5** (0 MLB) | 51,884 |
| `sharpapi` | 14 | 32,159 |
| `oddsapiio` | 7 | 29,888 |
| `sportsgameodds` | 21 | 19,574 |
| `parlayapi_mlb` | 15 | 7,814 |
| `parlayapi` | 26 | 7,164 |

**Why it matters.** Three separate ways:
1. **Wrong numbers shown to users.** The whole product is odds comparison. For
   every MLB batter prop, you are comparing prices across a book set that is
   missing your largest feed's ~13 books. "Best line" is not best.
2. **Money.** Propline is budgeted at 1,000 requests/day and was spending 897/day
   before the worker hung. You are paying full freight for a feed you use ~10% of.
3. **It fails as success.** The job returns `ok: true` with thousands of rows
   written. Nothing in `job_health_checks` or `/diagnostics` says "90% of what
   I fetched was unusable."

**Standard practice.** Two conventions are missing here. First, an
**unmapped-input rate is a monitored metric, not a debug table** — any
normalisation layer that maps external vocabulary to internal vocabulary should
emit "N of M inputs unmapped" and alert past a threshold, because vendors add
and rename markets constantly. Second, **provider-specific vocabulary belongs
in a per-provider map, not one global one.** A single flat
`MARKET_KEY_ALIASES` shared by six vendors means every vendor's naming quirk
has to be independently remembered, and there is no way to look at it and ask
"is Propline fully covered?"

**Severity justification.** Critical. It corrupts the primary output of the
product, has been doing so continuously, costs real money, and is invisible.
This is not a latent risk — I measured the loss.

**Fix.**
1. *Immediate (30 min).* Add Propline's vocabulary to `MARKET_KEY_ALIASES` in
   **both** `entity_resolution.py` and `entityResolution.ts` (they must stay in
   sync — see M3). Every key in the block above, plus the alt-line variants
   (`batter_1plus_hits`, `batter_2plus_hits`, `batter_3plus_hits`,
   `batter_4plus_hits`, `batter_1plus_rbis`, `batter_2plus_rbis`,
   `batter_3plus_rbis`, `batter_2plus_home_runs`) — decide deliberately whether
   alt-lines map onto the base market or get their own keys; do not let them
   fall through silently either way.
2. *Same change (1 h).* Restructure to `MARKET_KEY_ALIASES_BY_PROVIDER` with a
   shared base map, so "which markets does provider X cover" is answerable by
   reading one dict.
3. *Same day (1 h).* Make the unmapped rate a health check — see H2, which is
   the reason this went unseen and should be fixed in the same sitting.

**Effort.** ~2–3 hours total. **Dependencies.** None. Do this first.

**Also affected (same root cause, smaller).** SharpAPI drops `singles` (map has
only `batting_singles`) and `strikeouts_pitcher` (map has `pitcher_strikeouts`
— reversed word order). ParlayAPI-soccer drops `To Receive A Card`,
`To Receive The First Card`, `To Receive A Red Card`, `Alternate Spread`,
`Alternate Total`.

> **UNVERIFIED:** SharpAPI also shows 37 unresolved `total_bases`, but
> `totalbases` *is* in the map and the strip-separators fallback should catch
> it. Yet `prop_odds` has zero SharpAPI `total-bases` rows, so the loss is
> real. Something between the two doesn't behave as the code reads. Next step:
> add a one-line log of `(raw_label, normalized, result)` in
> `resolve_market_key` and run one live SharpAPI fetch.

---

### C2 — A 2-minute timer is burning the database alive

**What it is.** `lib/scheduler.ts` recomputes the MLB calibration payload every
2 minutes for 3 scopes. Each payload issues ~12 aggregate queries against
`pick_history`, and **none of them can use an index**, because 99.94% of the
table is `sport='mlb'` — the only selective column in the `WHERE` clause isn't
selective. Every one is a full scan of a 362,616-row / 102 MB table.

**Where.**
- [`lib/scheduler.ts:65`](lib/scheduler.ts:65) `refreshCalibration`,
  `CALIBRATION_INTERVAL_MS = 2 * 60_000`, `CALIBRATION_SCOPES = ['all','player','game']`.
- [`lib/odds/props/calibrationSnapshot.ts:62`](lib/odds/props/calibrationSnapshot.ts:62) `computeCalibrationPayload`.
- The queries: [`lib/db/client.ts:1203-1438`](lib/db/client.ts:1203) —
  `calibrationCounts` (6 sequential `COUNT(*)`), `calibrationBuckets`,
  `calibrationByMarket`, `overallBrierScore`, `liveMarketSkill`, `scoreRecord`,
  `goodBetsRecord`.

**The evidence.** From `pg_stat_user_tables` (lifetime, never reset):

```
pick_history   seq_scan: 24,705   seq_tup_read: 4,489,611,029   avg 181,728 rows/scan
```

**4.49 billion rows read** by sequential scan on one table. From
`pg_stat_statements`, the top 20 queries by total execution time are almost
entirely this one family:

| query | calls | mean | total |
|---|---:|---:|---:|
| `calibrationByMarket` (scope: all) | 1,506 | 842 ms | **1,268 s** |
| `calibrationByMarket` (scope: player) | 1,740 | 427 ms | 743 s |
| `COUNT(*) … dimension NOT IN (…)` | 497 | 1,212 ms | 602 s |
| `scoreRecord` | 1,475 | 194 ms | 286 s |
| `COUNT(*) … dimension IN (…)` | 477 | 519 ms | 247 s |
| `overallBrierScore` | 486 | 483 ms | 235 s |
| *…14 more `pick_history` aggregates…* | ~500 ea | 260–435 ms | ~1,700 s |

Summed: **≥5,600 seconds — 93 minutes — of pure database CPU**, against roughly
17 hours of app uptime (inferred from the call counts). That is ~9% of
wall-clock time, one query family, one user, for a cache nobody may be looking
at. A real plan:

```
Finalize Aggregate  (actual time=2306.562..2372.674 rows=1)
  ->  Parallel Index Only Scan … on pick_history
        Index Cond: (sport = 'mlb')
        Heap Fetches: 35004
        Buffers: shared hit=25216 read=3504
Execution Time: 2373.421 ms
```

2.37 seconds, 28,720 buffers, for a single `COUNT(*)`.

**Why it matters.** This is the direct cause of the errors already in
`system_events`:

```
api/odds/lines  canceling statement due to statement timeout        (×3, latest 08-26 19:21)
api/odds/lines  timeout exceeded when trying to connect             (×2, latest 08-27 02:36)
api/odds/lines  (EMAXCONNSESSION) max clients reached in session mode (×1)
```

Your app pool is `max: 6` against a real ~9-connection budget. When three
2-second scans are in flight and the Python worker wants its two, a real user
request has nowhere to go. The failure surfaces on an unrelated route, which is
exactly why it's been hard to attribute.

**Standard practice.** Two conventions:
1. **Pre-aggregate; don't re-scan.** Calibration over 356,462 graded rows is a
   *rollup*: the answer for every row older than today never changes. The
   normal shape is a summary table (`calibration_daily`, keyed by
   `(sport, dimension, scope, day, prob_bucket)` with `n`/`wins`/`sum_sq_err`),
   incrementally appended as rows are graded, and read with a tiny `GROUP BY`.
   Brier score and reliability buckets are both sums — they compose perfectly.
   This turns 2.4 s into <5 ms and stops growing with table size.
2. **Don't refresh a cache on a timer faster than the data changes.** The
   underlying grading loop runs every 15 minutes; recomputing every 2 minutes
   cannot produce new information. Even leaving the queries as-is, a 15–30
   minute interval would cut this by 87%.

**Severity justification.** Critical. It is measurably degrading the live app
today, it is the top resource consumer in the system, and it scales with a table
that grows ~3,000 rows/day forever.

**Fix, in the order I'd do it.**
1. *5 minutes, do it now.* Raise `CALIBRATION_INTERVAL_MS` to `30 * 60_000`.
   87% of the load, gone, zero risk. Also collapse `calibrationCounts`' six
   sequential `COUNT(*)` round-trips into one query with six
   `COUNT(*) FILTER (WHERE …)` — one scan instead of six, no behaviour change.
2. *2–3 hours.* Build the rollup table. Grade-time is the natural write point.
3. *Optional.* If you keep on-demand scans, a partial index on
   `(sport, dimension) WHERE outcome IS NOT NULL AND model_prob IS NOT NULL`
   helps the `GROUP BY dimension` shape, but it is a much smaller win than
   either of the above — the scan is the problem, not the access method.

**Effort.** Step 1: 5 minutes. Steps 1+2: half a day. **Dependencies.** None.

---

## HIGH

### H1 — Golf runs two competing prediction pipelines, and the code says otherwise

**What it is.** Golf model predictions, history ingest, and grading all run in
**two** places at once: the TypeScript `golf/adapter.ts` (fires on every golf
snapshot rebuild, i.e. page load) and the Python `golfPredictionsJob` (every 5
minutes). The Python job's own registry comment states the TS path was removed.
It was not.

**Where.**
- TS: [`lib/sports/golf/adapter.ts:675`](lib/sports/golf/adapter.ts:675)
  `logGolfModelPredictions(...)`, then line 689 `void ingestGolfHistory(...)`,
  then line 696 `void gradeAllGolfPredictions()`.
- Python: `python-odds-service/src/jobs.py:936`, whose comment reads:
  > `# Moved from "inside every live golf page request" (adapter.ts) to a`
  > `# schedule — 5min matches the MLB props job's own ...`
- Both write `golf_model_predictions`, `golf_hole_scores`, `golf_round_scores`,
  `golf_tournament_predictions`.

**The evidence.** This resolves Phase 1's open question #6 ("what is writing
`golf_model_predictions` at 19:18 while the worker is hung?"). The answer is
`adapter.ts`, on page load. Confirmed by `pg_stat_user_tables`:
`golf_model_predictions` shows 5,243 updates and only 4 inserts in the current
stats window, while every worker job's last run was 02:51.

**Why it matters.**
1. **Ambiguous authority.** Two implementations, same tables, no rule for which
   wins. They use ported-but-separately-maintained model code, so they can
   diverge silently.
2. **A GET request has a write side-effect.** `CLAUDE.md` allows this only with
   a documented reason; golf isn't on that list. Rendering a page mutates model
   history and runs grading.
3. **`void`-ed floating promises.** `void ingestGolfHistory(...)` and
   `void gradeAllGolfPredictions()` are fire-and-forget. A rejection is an
   unhandled promise rejection. `system_events` shows this failing for real:
   46 × `golf/historyIngest — Failed to persist golf history for this poll`,
   15 × `golf/models/grading — Failed to grade hole/round predictions`.
4. **It falsifies the docs.** The `jobs.py` comment and `CLAUDE.md`'s Python
   cutover narrative both assert a migration that only half-happened.

**Standard practice.** A background job and a request handler must never both
own the same write. Pick one owner per table and make the other read-only. The
reason is not aesthetic: with two writers on different schedules you cannot
reason about what a row means, and you cannot debug it, because reproducing the
state requires knowing who wrote last.

**Severity.** High. Not Critical only because both paths run the same ported
model, so the numbers are probably consistent today. The structure guarantees
they eventually won't be.

**Fix.** Delete the three calls from `adapter.ts` (lines ~675, 689, 696) and
let the Python job own golf writes, as the comment already claims. This is the
decision `jobs.py` documented; it just needs finishing. **Before deleting,
confirm the worker is healthy** — right now the TS path is the *only* one
running, so removing it while the worker is hung stops golf predictions
entirely. Sequence it after the worker incident is resolved (see the unification
plan, Step 0).

**Effort.** 30 minutes. **Dependencies.** Worker must be running first.

---

### H2 — The diagnostic that would have caught C1 isn't written by the live pipeline

**What it is.** `odds_unresolved` — the table that records every dropped
market/player/bookmaker — **has no writer in the Python worker at all**. There
is no `replace_unresolved_for_provider` in `db.py`. The Python job counts
unresolved rows into its summary dict and then discards them.

**Where.**
- `python-odds-service/src/job_runner.py:99` — `"unresolved": sum(len(o.unresolved) for o in outcomes)`.
  The count is returned; `o.unresolved` itself is never persisted.
- Only writer: [`lib/odds/props/registry.ts:140`](lib/odds/props/registry.ts:140),
  reachable solely via `/api/props/more-books` and `/api/props/scan-player`.
- Read by `/api/props/diagnostics` and displayed on `/diagnostics`.

**Why it matters.** Since the Python cutover, the Python worker is the app's
only routine odds fetcher. So `/diagnostics` shows you 1,538 rows of
*pre-cutover TypeScript-era* unresolved data, presented as current. It is a
fossil rendered as a live gauge. That is worse than an empty panel: it actively
tells you the mapping situation is being monitored when it isn't.

Fortunately for this audit, the fossil was accurate enough to expose C1. You
should not rely on that twice.

**Standard practice.** A dashboard panel must have exactly one live writer, and
a panel with no recent writes should render as "stale/no data", not as its last
known value. Any metric worth displaying is worth a freshness timestamp beside it.

**Severity.** High — it's the detection gap behind a Critical finding.

**Fix.**
1. Port `replaceUnresolvedForProvider` into `db.py` and call it from
   `run_provider_specs` per provider (~1 h).
2. Add an `unresolvedRate` check to `health_check.py`: fail when any provider's
   unresolved count exceeds, say, 5% of its resolved rows in the same fetch.
   `health_check.py` reads `JOB_REGISTRY` generically, so this is one function
   (~1 h).
3. Show `max(observed_at)` next to the panel on `/diagnostics`.

**Effort.** ~2–3 hours. **Dependencies.** Pairs naturally with C1.

---

### H3 — ParlayAPI soft caps are configured, documented, and ignored

**What it is.** You set `PARLAYAPI_NFL_SOFT_CAP=800` (and MLB/CFB/SOCCER
equivalents) in `.env.local` to keep an 800-call safety margin under each free
account's 1,000/month hard limit. The Python worker — now the only caller —
never reads those variables. It gates on the hard 1,000.

**Where.**
- `.env.local`: `PARLAYAPI_{MLB,NFL,CFB,SOCCER}_SOFT_CAP=800`, `PARLAYAPI_SOFT_CAP=800`.
- `python-odds-service/src/config.py` — greps for `SOFT_CAP` return **only**
  `SPORTSGAMEODDS_MONTHLY_SOFT_CAP`. No ParlayAPI soft cap is ever read.
- `python-odds-service/src/jobs.py:175-209` — `_PARLAYAPI_SPORT_CONFIG` carries
  `PARLAYAPI_*_MONTHLY_LIMIT` (1000), and the spec is built with
  `cap_limit=cap_limit,  # hard limit, not a soft cap`.
- The soft cap *is* still read by [`lib/odds/props/config.ts:137`](lib/odds/props/config.ts:137)
  — which now feeds mostly-dead code (M1).

**Why it matters.** Five environment variables you deliberately set have no
effect. When these sports come back into season and leave `gameday.py`'s cold
tier, each account will run to 1,000/1,000 and then hard-stop mid-month with no
reserve — which is precisely what the soft cap existed to prevent. Note
SportsGameOdds *does* honour its soft cap, so the behaviour is inconsistent
between providers, which is the worst case: you can't form a reliable mental
model either way.

**Standard practice.** Configuration that is read by nothing should fail loudly
at startup, not be silently inert. A config loader should assert that every
`*_SOFT_CAP` it finds in the environment is claimed by some provider, or log a
warning naming the orphan.

**Severity.** High — real money/quota, and it will bite at the least convenient
moment (in-season).

**Fix.** Add `PARLAYAPI_{MLB,NFL,CFB,SOCCER}_SOFT_CAP` to `config.py` and pass
them as `cap_limit` in `_PARLAYAPI_SPORT_CONFIG`, matching how
`SPORTSGAMEODDS_MONTHLY_SOFT_CAP` is already handled. Then add the
orphan-config warning. **Effort.** 1 hour.

---

### H4 — A concurrent provider job throws away rows you already paid for

**What it is.** In `run_provider_specs`, when `concurrent=True` (the NFL and CFB
jobs), providers run under `asyncio.gather(...)` **without**
`return_exceptions=True`. If either provider raises, `gather` propagates
immediately and the whole job dies — including the *other* provider's
successfully fetched rows, which are never written. Spend was already recorded.

**Where.** `python-odds-service/src/job_runner.py:80-88`:

```python
if concurrent:
    results = await asyncio.gather(*(run_one(spec) for spec in specs))
...
await db.write_prop_odds(all_rows)
```

Spend is recorded inside `run_one` (line 77), *before* the write at line 88.

**Why it matters.** ParlayAPI and SportsGameOdds run concurrently for NFL/CFB.
A transient 500 from one discards the other's data while both quotas have
already been debited. On a 1,000/month free tier that is permanent loss. It also
means a flaky provider can keep a healthy one's data out of the database
indefinitely, and the failure looks like "the job errored", not "you lost paid data".

**Standard practice.** When fanning out to independent external services,
partial success is the expected outcome, not an exception. Use
`return_exceptions=True`, write what succeeded, and record failures as
warnings. Also: record spend *after* a successful write, or make the two atomic
— never debit a budget for data you then drop.

**Severity.** High. Money + silent data loss, currently masked only because
NFL/CFB are in `gameday.py`'s cold tier and barely fetching.

**Fix.**
```python
results = await asyncio.gather(*(run_one(s) for s in specs), return_exceptions=True)
outcomes = [r for r in results if isinstance(r, FetchOutcome)]
errors   = [r for r in results if isinstance(r, BaseException)]
```
then fold `errors` into the returned `warnings` list. Move the
`record_*_spend` calls to after `write_prop_odds` succeeds.

**Effort.** 1 hour, plus a test. **Dependencies.** None.

---

### H5 — `snapshot_cache` has no retention policy and is your biggest cost risk

**What it is.** A 366 MB key/value blob table that only grows. There is no trim
job, no TTL eviction, no size cap. Phase 1 notes it was implicated in a past
**103 GB egress overage**.

**Where.** `lib/db/client.ts` `writeSnapshotCache`, used by `lib/cachedRoute.ts`
and ~30 direct callers. No delete path exists anywhere.

**The evidence.**

| key family | rows | size | note |
|---|---:|---:|---|
| `mlb:full-raw:{date}` | 15 | 125 MB | one per day, never deleted, back to 08-13 |
| `nfl:boxscoreRaw:*` | 481 | 43 MB | **all created today** — new, fastest-growing family |
| `mlb:snapshot:{date}` | 6 | 17 MB | |
| `cfb:cfbd:*` | 554 | 6.8 MB | |
| *everything else* | ~1,950 | ~30 MB | |

- **717 rows / 107 MB have not been touched in 3+ days** — ~30% of the table is
  cold.
- The table reports 366 MB total but payloads sum to ~220 MB compressed. The
  gap is **bloat**: 5,787 updates vs 754 inserts, each rewriting a multi-MB
  TOAST value.
- Reads and writes of these blobs are themselves top-10 queries:
  `INSERT … ON CONFLICT` on `snapshot_cache` = 2,468 calls × 460 ms = **1,137 s**;
  the point read = 8,990 calls × 78 ms = **706 s**.
- The health check's own size probes are pathological:
  `SELECT SUM(LENGTH(payload))` runs at **32.6 s mean** (685 s total) and the
  largest-keys query at **30.1 s mean** (603 s). The monitoring is a meaningful
  fraction of the load it monitors.

**Why it matters.** Database size drives your Supabase bill; egress drives it
harder, and you have already been burned once. `mlb:full-raw` alone adds ~8 MB
compressed per day forever, and `nfl:boxscoreRaw` looks set to add more.

**Standard practice.** A cache must have an eviction policy — that is what makes
it a cache rather than a table. Minimum: delete rows past a TTL. Better: don't
persist raw upstream payloads at all (`mlb:full-raw` is a *raw* API response;
if the derived `mlb:snapshot` is what's read, the raw copy is a debugging
convenience costing 125 MB). And a monitoring query should never be one of the
most expensive queries in the system — `pg_total_relation_size()` is instant and
gives the same answer as summing `LENGTH(payload)`.

**Severity.** High — cost, unbounded growth, and it degrades every cached route.

**Fix.**
1. *15 min.* Add a daily `DELETE FROM snapshot_cache WHERE fetched_at < now() - interval '3 days'`
   guarded to spare permanently-warm keys (`*:snapshot`, `nflverse-*`). Reclaims
   ~107 MB immediately.
2. *15 min.* Rewrite `health_check.py`'s `snapshotCacheSize` to use
   `pg_total_relation_size('snapshot_cache')` and `pg_column_size(payload)`
   with a `LIMIT`, instead of `SUM(LENGTH(payload))` over 366 MB of TOAST.
3. *30 min.* Decide whether `mlb:full-raw:{date}` needs more than 2 days of
   retention. Probably not.
4. *After the delete.* `VACUUM (ANALYZE) snapshot_cache` to actually return the
   bloat.

**Effort.** ~1 hour for the whole set. **Dependencies.** None.

---

### H6 — Migration correctness cannot be fully verified: the source database is gone

**What it is.** You asked me to verify the SQLite → Postgres migration. I can
verify its *structure* — and it is good. I **cannot** verify that every row's
values round-tripped, because `data/linebuddy.db` no longer exists on this
machine.

**Where.** `scripts/migrate-to-postgres.js:25` expects
`data/linebuddy.db`. `ls data/` shows only `historical-odds-import/`. No `.db`
file exists anywhere in the repo.

**What I verified and can vouch for:**

| check | result |
|---|---|
| Encoding | UTF8 / `en_US.UTF-8` ✓ |
| Identity columns | 24, all `GENERATED ALWAYS` (`attidentity='a'`) ✓ |
| **Sequence sync** | every sequence `last_value` ≥ `max(id)` ✓ — no desync |
| Timestamp translation | 43 `timestamptz` + 5 `date`, **zero** TEXT date columns ✓ |
| Boolean translation | 23 real `BOOLEAN` columns; matches `BOOLEAN_COLUMNS` in the migration script ✓ |
| `prop_odds` integrity | 0 null `american_odds`, 0 blank `subject_name`, no out-of-range odds ✓ |
| Orphan `game_id`s | none detectable ✓ |

Sequence desync is *the* classic post-migration bug (copy rows with explicit
ids, forget `setval`, next insert collides). It is clean here. Type translation
is clean. This migration was done carefully.

**What remains unverifiable:** per-row value fidelity, and whether any table was
truncated mid-copy. The migration script's resume logic compared row counts
per table, which would have caught a truncated table *at the time*, but that
evidence is gone with the source.

**Why it matters.** Mostly it doesn't, now — 9 days of live writes have
accumulated on top, and nothing in the data looks wrong. But it means "did the
migration lose anything?" is permanently unanswerable, and you should stop
treating it as an open question.

**Severity.** High, but as an *information* gap rather than an active defect.

**Fix / next step.**
- **Question for you:** do you have `data/linebuddy.db` anywhere else — an old
  laptop, a backup, a cloud sync folder? If yes, a row-count-per-table diff
  takes 10 minutes and closes this permanently.
- If not: declare it closed, and put the effort into H6b instead.

**H6b — you have no verified backup/restore procedure.** Phase 1 found no
app-level backup and no documented restore. You are relying entirely on
whatever your (unconfirmed) Supabase plan provides. Given the source DB for the
last migration has already vanished, this is a pattern worth breaking. A
`pg_dump` to a local file on a weekly schedule is an afternoon's work and is the
single highest-value insurance policy in this document.

---

### H7 — The repository does not describe what is running

**What it is.** 208 files differ from `HEAD`: 94 modified, 5 deleted-but-uncommitted,
~109 untracked. The untracked set includes **27 API route files** (the entire
`/api/tennis/*` surface, all `team-defense-allowed` routes, several
`/api/picks/*`), 25 components/hooks, 12 `lib/sports/*` modules, and **3
migrations already applied to production Postgres**.

**Why it matters.** This is the root enabler of everything else in Part A.
Concretely:
- **`git log` is not a history of your system.** You cannot bisect, revert, or
  diff against a known-good state.
- **Three applied migrations exist only on this laptop.** If this machine dies,
  the schema is unreproducible.
  (`20260823090000_tracked_lines.sql`, `20260827060000_player_game_history.sql`,
  `20260827070000_pick_history_price.sql`)
- **The five staged deletions** (`lib/odds/merge.ts`, `lib/odds/oddsHarvester.ts`,
  `lib/odds/props/multiSportRefresh.ts`,
  `lib/odds/props/tier1RefreshScheduler.ts`,
  `app/api/props/multi-sport-refresh/route.ts`) are referred to in `CLAUDE.md`
  as *already deleted*, so the committed tree contradicts its own documentation.
- **The Render worker deploys from git** (`autoDeploy: false`, last manual
  deploy at `89f6754`). Any Python fix in the working tree isn't running.

**Standard practice.** Commit early and often; the working tree is scratch
space, not storage. Migrations in particular should be committed the moment they
are applied, because a schema you can't recreate is a schema you can't recover.

**Severity.** High — it is a single-point-of-failure for your entire schema and
it blocks safe execution of every cleanup below.

**Fix.** **This is Step 1 of the unification plan.** Commit in themed batches
(see below). At minimum, commit the three migrations *today*.

**Question for you:** is this one coherent change set you intend to ship (the
tennis surface + live tabs + matchup cards look like one project), or several
overlapping efforts? Your answer determines whether this is one commit or five.

---

## MEDIUM

### M1 — Ambiguous authority: the TypeScript provider machinery

Phase 1 flagged `lib/odds/props/{tier1Refresh,sportsGameOddsRefresh,registry,config}.ts`
+ `providers/*.ts` as "keep or delete?". I traced every import. **Here is the ruling.**

| File | Status | Evidence |
|---|---|---|
| `sportsGameOddsRefresh.ts` | **DELETE — fully dead** | `refreshSportsGameOdds()` has zero callers. The only two matches for the filename anywhere are comments inside `providers/sportsGameOdds.ts`. |
| `tier1Refresh.ts` | **KEEP** | `refreshTier1` is imported by `app/api/props/scan-player/route.ts` — a live, user-triggered POST refresh. Legitimately still in use. |
| `registry.ts` | **KEEP** | `runProviderFetch` used by `tier1Refresh.ts` and `app/api/props/more-books/route.ts`; `allProviderMeta` by `app/api/props/diagnostics/route.ts`. |
| `config.ts` | **KEEP (reduced)** | Still imported by `/api/props/diagnostics`, `/api/props/sharp-price`, `/api/props/more-books`, `/api/props/line-history`, `lib/sports/mlb/oddsPapiHistoricalIngest.ts`. But the `softCap` fields it exposes are now decorative for ParlayAPI (H3). |
| `providers/*.ts` (7 files) | **KEEP** | All reachable: `sportsGameOdds` via `/api/nfl/game/[gameId]`, `oddsPapi` via `/api/props/{line-history,sharp-price}`, `sharpapi` via `lib/odds/nflGameLines.ts`, the rest via `registry.ts`. |

**So: the TS provider layer is *not* dead.** `CLAUDE.md`'s claim that the Python
worker "fully replaced" it is **wrong** — it replaced the *scheduled* jobs, not
the on-demand ones. That distinction should be written down, because right now
the doc invites someone to delete live code.

**Fix.** Delete `sportsGameOddsRefresh.ts`. Correct the `CLAUDE.md` paragraph to
say "replaced the scheduled provider jobs; the on-demand TS paths
(`/api/props/scan-player`, `/api/props/more-books`) remain live." **Effort.** 30 min.

---

### M2 — Dead code inventory

Verified by tracing every import across `app/`, `components/`, `lib/`, and
`python-odds-service/`.

**TypeScript modules with zero importers:**

| File | Size | Ruling |
|---|---:|---|
| `lib/db/schema.ts` | 32 kB | **DELETE.** SQLite `SCHEMA_SQL` incl. `PRAGMA journal_mode = WAL`. Only reference is a *comment* in `lib/sports/golf/historyIngest.ts:3` — update that comment to point at `supabase/migrations/`. |
| `lib/odds/props/sportsGameOddsRefresh.ts` | 4 kB | **DELETE** (M1). |
| `components/DenseViews.tsx` | 14 kB | **DELETE.** |
| `components/MicroBars.tsx` | 5 kB | **DELETE.** |
| `lib/odds/nflGameLines.ts` | 5 kB | **CONFIRM THEN DELETE** — no importer, but it imports `getSharpApiGameLines`; make sure NFL game lines aren't expected from here. |

**API routes with no reference anywhere** (104 routes total, 11 unreferenced):

- `/api/odds/game-lines` — **DELETE.** Legacy MLB-only, superseded by the
  multi-sport `/api/odds/game-line` (singular). Note it's public and
  `?force` triggers a paid The Odds API call — flag for Phase 4.
- `/api/golf/predictions` — **REVIEW.** Self-described "testing/integration
  endpoint" that runs a 3,000-iteration simulation. Public, unauthenticated,
  unreferenced by any frontend. Delete or gate.
- `/api/props/{backfill-oddspapi-historical,elo-backfill,fit-home-run-weights,fit-total-weights,ingest-historical-odds,park-factors}`
  — **KEEP.** Operator/backfill routes invoked by hand; `CLAUDE.md` explicitly
  exempts these. (Phase 4 should look at whether they should be auth-gated.)
- `/api/props/line-history`, `/api/{cfb,nba}/player/[playerId]/candidates` —
  **VERIFY.** Likely called from a client path my static scan missed. Check the
  network tab before removing.

**Python modules with zero importers:**
- `src/predict/batter_rankings.py`, `src/predict/pitcher_rankings.py` —
  **DELETE.** `batter_rankings.py`'s own docstring says "not part of the live
  matchup/candidate pipeline."
- `src/predict/clv_backtest.py` — **KEEP** as a standalone analysis script (same
  category as `run_walkforward.py`).

**Dependencies:**
- `better-sqlite3` + `@types/better-sqlite3` — **MOVE, don't delete.**
  `scripts/migrate-to-postgres.js:20` still requires it. It is a native module
  that compiles on every `npm install` for a script you will never run again.
  Move both to `devDependencies` (or archive the script and drop them).

**Effort.** ~2 hours for the whole sweep.

---

### M3 — Provider configuration exists in three places that must agree by hand

`.env.local` (real values) ↔ `python-odds-service/src/config.py` (defaults) ↔
`lib/odds/props/config.ts` (TS reader). `jobs.py` comments literally say
*"same env var as config.ts:NN"* — a correspondence maintained by human memory.

H3 is what happens when that memory fails. C1 is the same failure mode applied
to the market alias map, which is *also* duplicated across
`entity_resolution.py` and `entityResolution.ts` with no mechanism keeping them
in sync.

**Standard practice.** One source of truth. The cheapest version that works
here: a single committed `config/providers.json` holding limits/caps/enabled
flags and the market alias map, read by both runtimes, with secrets staying in
env. Second-cheapest: keep the duplication but add a test that fails when the
two maps diverge — 20 lines, catches every future instance of C1 and H3.

**Fix.** Start with the divergence test; it's cheap and buys the most. **Effort.**
Test: 1 hour. Full consolidation: half a day.

---

### M4 — The `?` placeholder shim will corrupt any JSONB-operator SQL

[`lib/db/pgClient.ts:119`](lib/db/pgClient.ts:119):

```js
const text = sql.replace(/\?/g, () => `$${++i}`);
```

This replaces **every** `?` in the SQL string, unconditionally. Postgres's JSONB
existence operators are `?`, `?|`, `?&`. `player_game_history.stats` is real
`JSONB` and is your largest table (830 MB). The moment anyone writes
`WHERE stats ? 'goals'`, that `?` becomes `$1` and the query breaks — or worse,
silently binds a parameter into the wrong slot.

**I verified this is not currently triggered** (no TS query uses a JSONB
operator today), so it is a landmine, not a live bug. But `player_game_history`
is exactly the table someone will want to query that way next.

**Fix.** Make `compile()` skip `?` inside string literals and refuse to convert
`?`/`?|`/`?&` when followed by whitespace-and-an-operand. Or, better, retire the
shim on new code and write `$1` directly — the shim exists only so migrated
SQL could carry over verbatim, and that migration is done. **Effort.** 1 hour.

---

### M5 — `withConnectionRetry` can double-apply a non-idempotent INSERT

[`lib/db/pgClient.ts:102`](lib/db/pgClient.ts:102) retries the whole callback on
`Connection terminated unexpectedly` / `ECONNRESET` / `ETIMEDOUT`. If the server
executed the statement and the *response* was lost, the retry executes it again.

Most writes are `ON CONFLICT` upserts, so they're safe. The exposed ones are
plain appends: `prop_odds_history` ([`client.ts:572`](lib/db/client.ts:572)),
`game_odds_history` ([`client.ts:623`](lib/db/client.ts:623)),
`system_events` ([`client.ts:2482`](lib/db/client.ts:2482)).

Impact is low — a duplicate price-history point or log row, not corruption —
and these run inside `pgTransaction`, which uses a dedicated client, so a
dropped connection usually aborts the transaction rather than half-applying it.

**Fix.** Restrict retry to `pgGet`/`pgAll` (reads are always safe to retry) and
exclude `pgRun`. One-line change, removes the class entirely. **Effort.** 15 min.

Related: `pgTransaction`'s `catch` calls `client.query('ROLLBACK')` without its
own try/catch — if the connection is dead, `ROLLBACK` throws and *replaces* the
original error, hiding the real cause. Wrap it. **Effort.** 5 min.

---

### M6 — Comments that will actively mislead the next person

These matter more than usual here, because this codebase leans heavily on long
explanatory comments and you will trust them.

1. **`python-odds-service/src/db.py:331-334`** — `write_prop_odds`'s docstring:
   *"this is the one function in this file that isn't a diagnostic/breadcrumb
   write, which is exactly why it stays disconnected from any live fetch path."*
   **False.** It is called by `job_runner.run_provider_specs:88` and has written
   290,663 `prop_odds` rows. This is the primary write path in the system.
2. **`lib/db/pgClient.ts:50-67`** — the `max` comment says *"reverted all the
   way back to 10"* mid-paragraph and concludes *"6 here + 3 on the worker
   (db.py) = 9."* The worker's actual `max_size` is **2** (per the live deploy
   commit "reduce worker pool max_size 3 → 2"). The arithmetic in the comment is
   wrong.
3. **`python-odds-service/src/jobs.py:932-936`** — claims golf was moved out of
   `adapter.ts`. It wasn't (H1).
4. **`lib/odds/props/calibrationSnapshot.ts:1-16`** — still describes the work
   as *"six separate SQLite aggregate scans"* and reasons about SQLite blocking
   the event loop. It's Postgres now, it's ~12 queries not 6, and the
   single-threaded-Node reasoning no longer applies the same way.
5. **`lib/scheduler.ts:1-39`** — the header still enumerates the five
   odds-provider jobs it no longer runs, and lines 24-28 explain the file's
   existence in terms of `better-sqlite3` bundling, a dependency it no longer uses.
6. **`CLAUDE.md`** — "the Python worker fully replaced the TS provider jobs" (M1),
   and the `app/api/props/lines/route.ts` note points at
   `tier1RefreshScheduler.ts`, a staged-but-uncommitted deletion (H7).

**Fix.** Correct all six while doing the surrounding work. **Effort.** 1 hour total.

---

### M7 — `writePropOdds` does 3 round-trips per row inside one transaction

[`lib/db/client.ts:550`](lib/db/client.ts:550) and its Python twin
`db.py:312` both loop per row: `SELECT` prior price → maybe `INSERT` history →
`INSERT … ON CONFLICT` current. For a 2,000-row provider fetch that's ~6,000
sequential network round-trips holding a transaction open the whole time,
against a pooler you have ~9 connections on.

The index situation is fine — I checked, the prior-lookup uses
`idx_prop_odds_subject` and runs in 0.05 ms, and `IS NOT DISTINCT FROM` does
*not* defeat it. The cost is purely round-trip count and lock duration.

**Standard practice.** Set-based writes. Send all rows as arrays and do the
whole batch in three statements using `unnest(...)`, or `COPY` into a temp
table and `INSERT … SELECT`. The log-on-change logic becomes a `WHERE NOT
EXISTS` / `IS DISTINCT FROM` join instead of N round-trips.

**Severity.** Medium — it's slow and holds connections, but it is correct, and
it isn't currently in the top-25 by total time (the worker has been down).

**Fix.** Rewrite as a batched `unnest` insert. **Effort.** 3–4 hours, needs a
test. **Dependency.** Do it in Python only; the TS copy is now only reachable
from `/api/props/scan-player` with small row counts.

---

### M8 — No `CHECK` constraints on status columns; no foreign keys on sports data

The schema has **4 foreign keys** (all `user_id → auth.users`) and **2 `CHECK`
constraints** (both on `tracked_lines`, added recently — so you already know the
pattern). Everything else — `pick_history.outcome`, `bets.status`,
`game_picks.ml_outcome`, every `side`, `market`, `sport`, `source`, `dimension`
— is bare `TEXT` whose legal values live only in comments.

`prop_odds.game_id`, `pick_history.game_id` are unconstrained `TEXT`.

**Why it matters.** This is the layer that would have turned C1 into a loud
failure. With `market_key` constrained to a known enum, an unmappable market
would raise on insert instead of vanishing. Right now a provider that changes an
id format writes it verbatim and you find out weeks later.

The zero-FK design was inherited deliberately from SQLite. That was a reasonable
call at migration time (don't change two things at once) but it is not a
reasonable steady state — Postgres gives you these for free and they cost
essentially nothing on write.

**Standard practice.** Constrain what you can prove. Start with the cheap,
zero-risk ones: `CHECK (outcome IN ('win','loss','push'))` and friends. Add them
`NOT VALID` first so existing rows aren't re-checked, then `VALIDATE CONSTRAINT`
once you've confirmed the data is clean.

**Fix.** One migration adding `CHECK` constraints to the ~10 real enum columns.
Foreign keys on sports data are a bigger conversation (`game_id` has no single
parent table) — I'd skip those and do the `CHECK`s. **Effort.** 2 hours.

---

### M9 — Two writers on `pick_history`, one of which is the load-bearing one

Not a defect — Phase 1 documented it as intentional, and both use the same
`ON CONFLICT DO NOTHING` key so they can't corrupt each other. Recording it
here only because it interacts with C2: `lib/scheduler.ts`'s `refreshMlb` is
currently the *only* live writer (the worker is hung), so if you disable the
scheduler to fix C2, disable only `refreshCalibration`, **not** `refreshMlb`.

---

## LOW

### L1 — Unused indexes

`pg_stat_user_indexes` shows a long tail at `idx_scan = 0`. Most are on empty or
tiny tables and cost nothing. Two worth noting:

- `historical_odds_season_game_date_home_team_id_away_team_id_key` — 1.4 MB,
  zero scans. It's a `UNIQUE` constraint so it's doing integrity work; keep.
- `game_odds_history_pkey` — zero scans, 472 kB. Also structural; keep.

**No action.** I'm listing this so you know I checked and there's nothing here.
Dropping indexes on a 1.5 GB database to save kilobytes is not worth the risk.

### L2 — `TEXT` payloads instead of `JSONB`

`snapshot_cache.payload`, `odds_cache.payload`, and every `*_json` column are
`TEXT`. This was a deliberate migration deferral. It is defensible for
`snapshot_cache` specifically — `lib/db/jsonPassthrough.ts` exists precisely to
serve the stored string without a parse/serialize round-trip, and `JSONB` would
force a reparse on every read. **Recommendation: leave it.** The one real cost
is that a malformed payload is only discovered when a reader chokes on it.

### L3 — `game_odds_history.source` default backfill

The `source` column was added with `DEFAULT 'the-odds-api'` and backfilled onto
every pre-existing row. Any reader grouping by `(event_id, market, side,
bookmaker)` *without* `source` now silently mixes writers. I checked the current
readers and they handle it, but the historical rows carry an assumption
(everything before the migration came from The Odds API) that is only
approximately true. **Low** — worth a comment on the column.

### L4 — `system_events` has no rotation

101 rows, 88 kB. Append-only, no pruning. Not a problem yet; add it to the same
retention job as H5 so it never becomes one.

### L5 — `picks` (0 rows) vs `pick_history` (362,616 rows)

Near-identical column prefixes, completely different purposes: `picks` is the
user's live slip (RLS, user-scoped, empty); `pick_history` is the global model
calibration log (no `user_id`, never per-user). This will bite someone.
**Rename `pick_history` → `model_predictions`** when you next touch it — the
name describes what it is.

---

# Growth projection

Measured daily rates, extrapolated. Current database: **1,562 MB**.

| Table | Now | Rate (healthy) | +1 yr | 10× volume | 100× volume |
|---|---:|---|---:|---:|---:|
| `player_game_history` | 830 MB | backfill-driven | ~830 MB | 8.3 GB | 83 GB |
| `snapshot_cache` | 366 MB | **+8–15 MB/day, unbounded** | **~4.5 GB** | — | — |
| `prop_odds_history` | 111 MB | ~20,000 rows/day @ 261 B | +1.9 GB | 19 GB | 190 GB |
| `prop_odds` | 105 MB | upsert-in-place, bounded by slate | ~flat | 1 GB | 10 GB |
| `pick_history` | 102 MB | ~3,000 rows/day @ 282 B | +300 MB | 3 GB | 30 GB |
| **Total** | **1.56 GB** | | **~7.5 GB** | | |

**Where this hits limits.**

1. **`snapshot_cache` is the only genuinely unbounded item**, and it's the one
   with no retention policy (H5). Fixing H5 removes ~4 GB/yr of growth for an
   hour of work. Do that before anything else on this list.
2. **You will cross 8 GB within a year on current behaviour.** Phase 1 notes
   past incidents referencing a "5 GB plan." You are at 1.56 GB. **Open
   question for you: what Supabase plan are you on, and what is its size
   ceiling?** This determines whether H5 is urgent or merely important.
3. **Connections bind before storage does.** At ~9 usable connections with the
   app pool at 6 and the worker at 2, you have zero headroom. C2 is consuming
   that headroom right now. This is a Phase 4 topic but it's the real ceiling.
4. **`player_game_history` will roughly double** when the MLB/NBA backfill
   resumes (currently NHL/CFB/NFL/EPL/MLS only), at 589 bytes/row. Budget ~1.6 GB.

**Data you are collecting and not using** (the question cut the other way) —
`prop_odds_history` at 425,307 line-movement points and `game_odds_history` at
19,667 are genuinely valuable and genuinely under-read: the only current
consumers are grading and a line-history route. Closing-line value, steam
detection, and book-lag analysis are all sitting in there already. That's a
Phase 3/5 conversation, but it's an asset, not a cost.

**Data you are collecting and throwing away:** everything in C1.

---

# Part A — Unification plan

Kept separate from the severity list, as requested. Sequenced so nothing breaks
mid-cleanup. **Do not reorder** — several steps depend on earlier ones.

### Step 0 — Resolve the worker incident *(blocker for Step 5)*

The Python worker has been hung since 02:51 UTC. Two of the cleanups below
remove TypeScript paths that are currently the *only* thing keeping golf and
prop odds alive. Get the worker running before you delete anything it's
supposed to replace.

*(Phase 1 §12.1 and Phase 4 own the incident itself; it's listed here only as a
prerequisite.)*

### Step 1 — Commit the working tree *(blocks everything)*

Nothing below is safe while 208 files are uncommitted and unrevertable.

1. **Today, before anything else:** commit the three applied migrations. They
   exist only on this laptop.
2. Then commit in themed batches so the history is useful:
   - the tennis surface (routes + components + `lib/sports/tennis/*`)
   - live game tabs (`*LiveTab.tsx`, `use*LiveGame.ts`, `lib/sports/*/liveGame.ts`)
   - matchup cards + `team-defense-allowed`
   - the `player_game_history` backfill (Python)
   - the five staged deletions
   - docs

**Answer needed from you first:** is this one change set or several? (H7)

### Step 2 — Fix C1 and H2 together *(highest value, no dependencies)*

The market-alias fix and the unresolved-monitoring fix belong in one sitting:
the second is what stops the first from recurring. Details in C1/H2.

### Step 3 — Fix C2 *(5 minutes for 87% of the win)*

Bump `CALIBRATION_INTERVAL_MS` to 30 minutes. Then, separately, the rollup table.
**Do not** disable `refreshMlb` while doing this — see M9.

### Step 4 — Delete confirmed-dead code *(safe, mechanical)*

In this order, so each deletion's justification is already committed:

1. `lib/odds/props/sportsGameOddsRefresh.ts`
2. `lib/db/schema.ts` — and fix the comment in `lib/sports/golf/historyIngest.ts:3`
3. `components/DenseViews.tsx`, `components/MicroBars.tsx`
4. `app/api/odds/game-lines/` (legacy plural route)
5. `python-odds-service/src/predict/{batter_rankings,pitcher_rankings}.py`
6. Move `better-sqlite3` + `@types/better-sqlite3` to `devDependencies`
7. Verify-then-delete: `lib/odds/nflGameLines.ts`, `/api/golf/predictions`

Run `npm run typecheck` after each. **Effort.** 2 hours.

### Step 5 — Collapse the golf double-pipeline *(requires Step 0)*

Remove the three write calls from `lib/sports/golf/adapter.ts` (~675, 689, 696).
Confirm `golf_model_predictions` keeps advancing from the worker for 24 h
afterwards. (H1)

### Step 6 — Close the config drift *(requires Step 2's alias work)*

1. Wire `PARLAYAPI_*_SOFT_CAP` into `config.py` (H3).
2. Add the TS↔Python divergence test for the alias map and provider limits (M3).
3. Add the orphan-env-var warning.

### Step 7 — Correct the misleading comments *(do last, once behaviour is settled)*

All six in M6, plus the `CLAUDE.md` corrections from M1. Writing these before
the behaviour is final just means writing them twice.

### Step 8 — Hardening backlog *(no ordering constraints)*

H4 (`return_exceptions`), H5 (retention job), M4 (`?` shim), M5 (retry scope),
M7 (batched writes), M8 (`CHECK` constraints), H6b (backups).

---

# Questions I need you to answer

Short, specific, and each one changes a recommendation above.

1. **Are the 208 uncommitted files one coherent change set, or several
   overlapping efforts?** Determines Step 1's shape. *(H7)*
2. **Does `data/linebuddy.db` still exist anywhere** — old machine, backup,
   cloud sync? If yes, migration verification closes in 10 minutes; if no, I'll
   call it permanently closed. *(H6)*
3. **What Supabase plan are you on, and what's its size ceiling?** Determines
   whether H5's retention job is urgent or merely important. *(Growth)*
4. **Do you have any backup/restore procedure at all, or is it entirely
   Supabase's built-in?** *(H6b)*
5. **Was `ODDS_API_KEY` deliberately withheld from the worker's Render env**, so
   the TS route keeps owning MLB game lines — or is it an oversight? The health
   check reports `mlbGameLinesJob` as "ODDS_API_KEY is not set" while
   `odds_cache` shows the TS path refreshing it fine. Two owners, one job.
6. **Are the alt-line Propline markets** (`batter_2plus_hits`,
   `batter_3plus_rbis`, …) **something you want as their own market keys, or
   folded into the base market?** I need this to finish C1's map correctly.

---

# Appendix — what I ran

All against live Postgres via the transaction-mode pooler (port 6543), one
connection at a time, read-only.

- Full schema introspection: 35 tables, columns, nullability, defaults, all
  constraints (`pg_constraint` for `c`/`f`), identity columns
  (`pg_attribute.attidentity`), sequence `last_value` vs `max(id)`, encoding.
- `pg_stat_user_tables` — seq/idx scan counts, tuple counts, dead tuples,
  autovacuum timestamps.
- `pg_stat_user_indexes` — `idx_scan` per index.
- `pg_stat_statements` — top 30 by `total_exec_time`, top 15 by `mean_exec_time`.
  **Never reset** (`pg_stat_database.stats_reset IS NULL`), so figures are
  lifetime since the 2026-08-18 migration.
- `EXPLAIN (ANALYZE, BUFFERS)` on: `calibrationByMarket`, the
  `calibrationCounts` scope variants, the `prop_odds` prior-price lookup (both
  `IS NOT DISTINCT FROM` and `=`), and the `game_odds_history` prior lookup.
- Data-integrity sweeps: null/blank/out-of-range checks on `prop_odds`,
  `pick_history` column-population rates, `player_game_history` per-sport
  coverage and empty-`stats` count, orphan `game_id` checks.
- `snapshot_cache` composition by key prefix with `pg_column_size`, and cold-row
  volume.
- Per-provider freshness and market coverage; full `odds_unresolved` breakdown.
- Static analysis: import-graph sweep over all `.ts`/`.tsx` in `app/`,
  `components/`, `lib/`; reference sweep over all 104 API routes; import sweep
  over `python-odds-service/src/**/*.py`.

**Caveats.** `n_live_tup` in `pg_stat_user_tables` disagrees with real
`COUNT(*)` on several tables (e.g. `pick_history` reports 1,664 vs an actual
362,616) — the statistics epoch appears to have been reset independently of
`pg_stat_database`. I used real `COUNT(*)` everywhere a number is quoted, and
treated `n_live_tup` as unreliable. Scan *counts* and `pg_stat_statements`
figures are internally consistent and corroborate each other, so I trust the
direction and magnitude of C2 even if the absolute lifetime window is fuzzy.
