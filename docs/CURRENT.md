# CURRENT — pick up here

**Phases 1–4 COMPLETE. Phase 5 (Sustainability) IN PROGRESS — egress fixes deployed 2026-09-11, awaiting billing confirmation.**

---

## STATE AS OF 2026-09-11 ~17:00Z

| ceiling | limit | status |
|---|---|---|
| database | 8,192 MB | **CLEARED** — 7,282 → ~3,200 MB |
| worker RAM | 512 MB | **CLEARED** — 311 resting / 360 peak |
| egress | 250 GB/mo | **FIXES DEPLOYED, NOT YET CONFIRMED** |

### What egress was, and what was done

Supabase graph, period 28 Aug – 28 Sep: **623.32 GB used of 250, 373.32 GB
overage, 19.483 GB/day on 11 Sep, 100% Shared Pooler (0% Storage).**
Target for the next period: **≤8.3 GB/day**.

Root cause: **Postgres was being used as a blob cache, and on a hosted database
every cache HIT is a billed network transfer.** `snapshot_cache` reads were
~16 GB/day of the 19.483 — 80% — confirmed two independent ways (blocks
touched: 53,212 B/call × 265,538 calls/day; residual after pricing every other
live query: ~60 KB/read). Every other live query totals ~3.6 GB/day.

**DEPLOYED — item 1** (`82bac81`, live 16:21Z): validation cache
(`src/blob_cache.py`). Asks Postgres for `fetched_at` only (~8 bytes); serves
the payload from local disk when the stamp matches. NOT a TTL cache — the
version IS the stamp, so staleness is impossible by construction. Disk not
memory, deliberately, to protect the RAM ceiling. Every failure path degrades
to a direct DB read. `test_blob_cache.py`: 16 checks, all pass.

**DEPLOYED — item 3** (live 16:45Z): prop archive pivots server-side. Was
fetching 13,542 rows/call × ~2,000 calls/day = 27.3M rows/day, pivoting in
Python, discarding one-sided quotes, writing back to the same database. Now one
`INSERT … SELECT`; no result set crosses the pooler.
`test_prop_archive_equiv.py`: **36,361 rows, 7 sports, ZERO mismatches.**

### THE OPEN QUESTION — read this before declaring victory

Cache hit rate measured **43% cold → 61% warm**, against ~97% predicted from the
30:1 read:write ratio. **Hit rate is probably the wrong metric**: the hypothesis
is that `provider-throttle:*` keys (80 bytes, rewritten every job run) always
miss by design and dilute the rate while costing nothing, whereas the expensive
keys (`mlb:snapshot` 6.6 MB, rewritten only ~every 84 min) hit. **UNVERIFIED.**

If bytes track the 61% rather than the hypothesis, the saving is ~9.8 GB/day,
landing at ~9.7 — still ABOVE the 8.3 target — and items 2 and 4 become
required rather than optional.

**THE SUPABASE GRAPH IS THE ONLY AUTHORITY.** No management token exists in
`.env.local`, so the operator must check it 24–48h after 2026-09-11.


### MEASUREMENT TRAP — this has now caused two false conclusions

**A short window extrapolated to a day is wrong for BURSTY jobs, and a
minimum-call threshold does not catch it.**

2026-09-11, twice:
- A 600s window saw a `player_game_history` stats query 10 times and reported
  **99M rows/day**. Its lifetime figure is **206 calls total, 105/day — ~7.4M
  rows/day**. The window had landed inside a burst. It cleared the
  `MIN_CALLS_TO_TRUST = 5` guard precisely because a burst produces *many*
  calls in a short span, which is the same signature as a high steady rate.
- Earlier the same day, single-call samples were extrapolated x144 and produced
  a ranking that sent an hour of work at the wrong target.

**The rule: for any query, cross-check the window rate against the LIFETIME
rate (`rows / stats_since`). If they disagree by more than ~3x, the window
caught a burst and the window figure must be discarded, not averaged.** Neither
number alone is trustworthy — cumulative cannot tell live from dead, and a
window cannot tell bursty from steady.


### POST-DEPLOY OBSERVATIONS (2026-09-11 22:15Z)

**The cache works, measured in production, not inferred.** Job breadcrumbs now
carry `cache_hit_rate` / `cache_saved_mb` / `cache_fetched_mb`:

```
  hit rate  0.995      saved 140.1 MB      fetched 78.1 MB
```

**99.5% of reads hit.** The earlier "61%" was an artifact of computing hit rate
from `pg_stat_statements`, which counts THIS SESSION'S local diagnostic scripts
too -- those run against a different cache directory and miss constantly. The
78.1 MB fetched is the one-time cost of filling the cache after a restart.

**archivePropsJob runs in 8.6s on the worker** (37,620 rows), not the 81s
measured locally -- that difference was this machine's round-trip latency to a
remote database, not the job. Item 3 is fast.

**Worker RAM improved again: 259 MB resting** (was 311), 406 MB peak.

**OPEN — refreshTier1 overruns its own interval: 171.75s against a 150s
schedule**, which is why `gameOddsBookLinesFreshness` and `refreshTier1` show
red. It writes 89,157 rows across 5 providers, so it is provider-network-bound.
**Unknown whether this predates the 2026-09-11 deploys** -- no pre-deploy health
check was captured that day. The blob cache makes reads cheaper, so the
mechanism does not explain it, but that is reasoning, not evidence. Check
whether it was red before concluding either way.


### THE 3x GAP, RESOLVED (2026-09-12 01:10Z) — measured, not modelled

Two estimates disagreed 3x. BOTH were wrong, in opposite directions, and the
baseline they were compared against was contaminated. Measured truth, from the
cache's own byte counters over 702s of SAME-PROCESS time:

```
  blob egress AVOIDED   : 8.52  GB/day
  blob egress REMAINING : 0.012 GB/day      (99.86% eliminated)
```

**Error 1 - the 16 GB/day estimate was INFLATED.** It priced `snapshot_cache`
by BLOCKS TOUCHED, which counts index and heap pages rather than bytes sent.
Proof from today: `SELECT fetched_at FROM snapshot_cache WHERE cache_key = $1`
shows **16.2 GB/day of block traffic while sending ~8 bytes per call**. The
"independent corroboration" (residual = total minus everything else) was NOT
independent -- an underestimate of everything else becomes an overestimate here
by construction.

**Error 2 - the 4.7 GB/day figure was DEFLATED.** Cumulative counters (526.9 MB)
were divided by 2.7h of WALL CLOCK, but the worker had restarted and the
counters reset, so true elapsed time was far shorter. **Per-process counters may
only ever be divided by same-process elapsed time.** A counter that goes
BACKWARDS is the signal a restart happened.

**Error 3 - the 19.483 GB/day BASELINE is contaminated by our own maintenance.**
`measure_egress_rate.py` has a `MINE` constant built to attribute exactly this,
and it was not applied:

```
  61,250,313 rows   corpus export/verify tooling (quoted-identifier SQL)
                    6.6% of all rows read since stats_reset
                    ~12.3 GB, concentrated on 10-11 Sep
```

2026-09-11 -- the day of the 19.483 GB reading -- had corpus exports and prune
verifications running all day. **The platform's steady state was never 19.5
GB/day.** The graph's own shape agrees: 57-69 GB on heavy-corpus days, ~11 GB on
28 Aug before that work started.

**LESSON: three different proxies for "bytes sent" (block counts, average row
width, wall-clock rates) each produced a confident wrong answer. The only
trustworthy figure came from counting actual payload bytes at the point they
would have crossed the wire.** Build the counter; do not model the number.


### STEP 1 DONE — closing-lines archive is server-side (2026-09-12 01:55Z)

`archiveClosingLinesJob` was the last read-reshape-write round trip of any size:
it pulled the latest book line for every upcoming game (~8.6-24.8M rows/day),
rebuilt each row as a dict in Python, and wrote them back to the same database.
Now a single INSERT..SELECT. **Verified live: ok=True, 6.62s, 2,104 rows** (it
takes 153s from a developer machine -- that gap is round-trip latency, not the
job).

Gate: `test_closing_archive_equiv.py` -- 2,104 rows across cfb/mlb/nfl, full row
tuples under an exact key, **0 mismatches**.

**A PRE-EXISTING SILENT BUG SURFACED, and it is worth a decision.**
`odds_archive_natural_key` keys on `source`, which this insert sets to the
constant `'live_capture'` -- **`provider` is NOT in the key.** So two providers
quoting the SAME book collapse to one archive row. Measured on NFL:

```
  moneyline/home  fanduel  oddsharvester -118  vs  propline -124
  moneyline/away  fanduel  oddsharvester -175  vs  propline -184
  86 of 2,190 rows per cycle (3.9%)
```

This is NOT new. The old `executemany` path hit the same collision and resolved
it silently -- last row written won, in whatever order the fetch returned -- so
the archive has always kept an arbitrary one of the two. `INSERT..SELECT` cannot
do that (Postgres rejects a command proposing the same key twice), which is how
a long-standing silent behaviour finally became a hard error.

Now deterministic: **newest quote wins**, a stated rule instead of an accident
of row order.

**OPEN DECISION, for the operator, NOT decided here: should `provider` be part
of `odds_archive_natural_key`?** Today the archive can hold only one price per
(game, market, side, book) even when two providers genuinely disagree about what
that book is showing -- and a 6-cent moneyline disagreement is exactly the kind
of thing a CLV model would want to see. Adding provider to the key is a
migration and changes archive cardinality, so it needs a real decision rather
than a quiet fix.


### corpusFreshness FIXED (2026-09-12 03:05Z) — and two things it uncovered

**The alarm could never be satisfied.** Its own docstring calibrated 250,000
rows as "half a day at ~465k rows/day". Measured: `prop_odds_history` takes
**~68k rows/HOUR (~1.63M/day)**, more than triple. One 6-hour refresh cycle
deposits **~407,616 rows**, so the threshold sat BELOW the floor of normal
operation and went red every cycle regardless of health.

**The root cause was that nothing could SEE whether the export ran.**
`check_corpus_freshness` runs on the Render worker; `refresh_corpus` runs as a
Windows Scheduled Task on the operator's machine. The worker cannot read Task
Scheduler, so it could only infer liveness from a row count -- and a row count
cannot separate "mid-cycle, working fine" from "stopped three days ago".

Same gap and same fix as OddsHarvester: `refresh_corpus._write_heartbeat` now
writes `job_health_checks['corpus_refresh']` on every run, and the check reads
it. Red means the export actually FAILED, or has not succeeded within 1.5
cycles (9h). The row count survives only as a transitional fallback (1.2M,
~3 measured cycles) for the window before the first heartbeat exists.

Verified all four branches on real data: fresh (1h) healthy, late (8h) healthy,
stale (12h) red, last-run-failed red. Producer write confirmed end to end.
**The first real heartbeat lands on the 05:16Z task run.**

## OPEN, NOT MINE — eloFreshness

`eloFreshness` went red at ~03:05Z: **1 of 11 finished games today has no
`team_elo_history` row (game_pk 824873)**. It is NOT a sync delay --
`maintainMlbEloJob` ran at 03:25:26Z with ok=True and still did not cover it,
which is the case the check's own message says needs investigating.

**Ruled out as a side effect of the 2026-09-12 blob cache**, by measurement
rather than reasoning: `read_snapshot("mlb:snapshot")` returns a payload
**byte-identical** to a direct Postgres read (same sha256 over 26,127,752
bytes), and game 824873 is present in both. The cache is not serving stale data.

Also noticed while checking, and NOT yet explained: `mlb:snapshot` carries
`fetched_at 2026-09-11 22:26:36Z` -- roughly 5 hours stale at the time of
writing. Whether that is normal cadence or a second problem is unknown.


### CEILING 1 WAS NOT SUSTAINABLY CLEARED — found and fixed 2026-09-12 04:00Z

**The correction:** this file has said "database: CLEARED" since 2026-09-11.
That was true as a point-in-time measurement (44.2%) and WRONG as a
sustainability claim, which is what Phase 5 is about.

Once `databaseGrowth` had its full 24h of history it said:

```
  CEILING APPROACHING - 3,623 MB (44.2%), +469.6 MB/day over 1.0d,
  10 days of headroom
```

44.2% full looks fine. The RATE does not. The alarm built in 5.S.9 was working
correctly; it had been reading "establishing baseline" and was skimmed past.

**ROOT CAUSE: the loop was never closed.** `refresh_corpus` ran
`export_corpus` + `upload_corpus` and stopped. The corpus accumulated a
faithful copy and Postgres never shed anything. The 7,282 -> 3,200 MB reduction
came from running the prune tools BY HAND; nothing repeated them, so the
database simply refilled. **A one-time cleanup is not sustainability.**

`prop_odds_history` alone: 245 bytes/row x ~1.63M rows/day = **~400 MB/day**,
nearly all of the measured growth. Fully corpus-backed, fully prunable, tooling
proven -- it just never ran.

**FIXED** (`35392eb`): `refresh_corpus --prune` now runs `prune_corpus <table>
--apply` after export and upload succeed.
- **Daily, not 6-hourly.** Exporting is incremental and cheap; VERIFYING is
  neither -- `prune_table` re-reads every non-empty partition and a verify-only
  pass exceeded 10 minutes. Running it every cycle would spend much of what the
  egress work just saved. One daily pass reclaims a day.
- **Opt-in.** A bare `python refresh_corpus.py` stays non-destructive, matching
  prune_corpus's own default. The scheduled task passes `--prune` via
  `scripts/corpus-refresh-setup.ps1` -- the generated `.bat` is gitignored, so
  THE GENERATOR is what must carry the flag.
- **"Unknown" means DUE.** The cadence gate reads `last_prune_at` from the
  heartbeat; if it cannot, it prunes. Failing closed would silently stop
  pruning and let the database refill -- the exact failure this prevents.
- `prune_corpus` is untouched and remains the safety layer: verification
  independent of the export's manifests, deletion by verified row id not by
  predicate, refusal while the corpus is local-only.

**First automated prune: the 05:16Z task run.** Watch `databaseGrowth` after it
-- the number to see is MB/day falling to ~0, not the absolute percentage.


### ...BUT THE PRUNE ALONE DOES NOT CLEAR CEILING 1 — decision needed

Verify-only prune, 2026-09-12 04:40Z:

```
  retention margin: keeping 5,155,194 row(s) newer than 14 days
  VERIFY ONLY: 103,942 rows would be deleted
```

Only 103,942 of 5,159,084 rows are prunable. The 14-day retention margin holds
back essentially the whole table.

**SAME STALE-CALIBRATION BUG AS THE corpusFreshness THRESHOLD, IN A SECOND
PLACE.** `KEEP_RECENT_DAYS["prop_odds_history"] = 14` carries the comment "14
days costs ~1,725 MB steady state at the current **465k rows/day**". Measured
inflow is now **1.63M rows/day -- 3.5x** what it was sized against.

| retention | steady-state rows | prop_odds_history |
|---|---|---|
| **14d (current)** | 22.8M | **5,591 MB** |
| 7d | 11.4M | 2,795 MB |
| 3d | 4.9M | 1,198 MB |

Other tables ~2,358 MB, so the CURRENT setting settles at **~7,950 MB against
an 8,192 MB ceiling -- 97%**, with no room for inflow to rise again.

Closing the loop was NECESSARY but is NOT SUFFICIENT: it converts unbounded
growth into a plateau, and the plateau is at 97%.

**THIS IS A PRODUCT DECISION, NOT AN ENGINEERING ONE, and it is NOT made here.**
The 14 days is a SERVING window, not a safety margin -- the table's own comment:
"the price chart, per-key grading and `userClv.closingPropPrice` all read this
table from TypeScript, where there is no DuckDB and so no corpus read. Whatever
is not here cannot be served at all." 7 days halves the footprint (total ~5,150
MB, 63%) and caps the price chart at 6.7 days instead of 13.3.

Options, for the operator:
  a) cut KEEP_RECENT_DAYS to 7 -- chart loses half its native range
  b) keep 14 and reduce INFLOW instead (prop_odds_history is log-on-change;
     1.63M/day means prices are changing, or being re-logged, very often --
     worth auditing before accepting it as given)
  c) keep 14, accept ~97%, and monitor -- no headroom for growth
  d) serve the chart from the corpus (removes the serving constraint entirely,
     but there is no DuckDB in TypeScript, so this is real work)

**LESSON, now twice in one day: a constant calibrated against a measured rate
goes stale silently when the rate changes. Both the corpusFreshness threshold
and this retention window were sized against ~465k rows/day and neither was
revisited when inflow tripled. Any constant derived from a measurement needs
the measurement re-checked, or the constant derived at runtime.**

### Next actions

1. **Operator: read the Supabase egress graph for 12–13 Sep.** That is the verdict.
2. If still >8.3 GB/day: build item 2 (jsonb field selection — `load_mlb_games`
   pulls 6.6 MB to produce a game list, 32 call sites) and item 4 (immutable
   `nfl:boxscoreRaw:*` cached permanently).
3. Instrument `blob_cache.stats()` into `health_check.py` so hit rate and
   bytes-saved are visible in production rather than inferred.
4. `archive_props` now takes ~81s per run against a 300s interval — fine, but
   worth watching.

---

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
