# Linesmith Audit — Handoff for Phases 4 + 5 (combined run)

> Produced by Phase 3 (2026-08-27). The operator is running **Phases 4 and 5
> together in one fresh session**.
>
> **Reading order:** `docs/audit-handoff.md` (Phase 1's operational scaffolding)
> → `docs/audit-handoff-phase-2.md` (its §1 corrects several Phase 1 facts) →
> this file. Then `docs/audit-phase-3.md` §3 and §4 before you touch anything.
>
> Everything in the earlier handoffs still stands **except where §1 below
> corrects or extends it.** Phase 3's own full output is `docs/audit-phase-3.md`
> — read it if you need a finding's reasoning; everything Phases 4 and 5
> actually need is here.

---

## 0. Read this first

Phase 3 found one thing that invalidates a load-bearing assumption in both the
Phase 1 and Phase 2 handoffs, and it changes how Phase 4 must model the system:

**The Next.js app is not a reader over Supabase. It is a third compute-and-write
location, it runs its own in-process timers, and it performs database writes on
unauthenticated GET requests.**

Both prior handoffs implicitly treat the architecture as "Render worker +
OddsHarvester → Supabase → app reads it." That is wrong. Any scale model,
connection-budget model, or attack-surface model built on it will be wrong too.
§1.1 has the evidence.

Second: the audit prompts tell you to treat every claim as a hypothesis to check.
That applies here. Every number below was measured on 2026-08-27, but the system
is actively changing (a hung worker, 200+ uncommitted files, a possible second
Render service). Re-verify anything load-bearing.

---

## 1. Corrections and extensions to Phases 1–2

### 1.1 CRITICAL for Phase 4 — the web app is a write path, and it writes on unauthenticated GETs

Phase 1 open question #1 asked where the web app runs. Phase 2 §1.6 found a
second Render service named `Linesmith` and told Phase 4 to resolve it. Both
framed the app as a consumer. It is not.

**Verified this session:**

- **`lib/scheduler.ts:95-96`** — two `setInterval` timers run *inside the Next.js
  process*: `refreshMlb` (rebuilds the MLB snapshot, a multi-MB blob) and
  `refreshCalibration` (recomputes the calibration payload and writes
  `snapshot_cache`). These are per-process. **If the app runs in more than one
  place — laptop plus the `Linesmith` Render service — every timer runs N times
  and every write happens N times.** Resolving §1.6 is therefore not just a
  topology question, it is a write-amplification question.
- **30+ TypeScript files issue Postgres writes**, including `pickHistoryLog.ts`,
  `grading.ts`, `gameOddsLog.ts`, `registry.ts`, `snapshotRebuild.ts`,
  `golf/adapter.ts`, `modelBackfill.ts`, `gameModelBackfill.ts`.
- **`app/api/odds/lines/route.ts` is public and mutates on GET.** It is not
  matched by any prefix in `middleware.ts` (`PROTECTED_API_PREFIXES` =
  `/api/picks`, `/api/bets`, `/api/watchlist`, `/api/tracked-lines`;
  `ADMIN_API_PREFIXES` = `/api/diagnostics`). On every request it runs
  `logGameOddsHistory`, `logTotalPredictionsFromLines` and
  `attachPricesFromLines` — three real write passes, including inserts into
  `pick_history`, which is the model's own graded track record.
- **Proof the app is doing the work today:** MLB `pick_history` rows were written
  at **19:31** while every Python worker job's last run was ~02:49 (984–1052 min
  stale). The worker was 17 hours dead. TypeScript wrote them. Likewise
  `game_odds_history` took 6,013 rows in 24h from the route above.

**Phase 4 consequences.** (a) An anonymous visitor can inflate `pick_history` and
`game_odds_history` by hitting a public GET in a loop — a data-integrity DoS, not
just a cost one. (b) The per-visitor cost of a page load includes three write
passes, not zero. (c) Any "N concurrent users" model must count app-side writes
and app-side timers against the same ~15-connection budget the worker uses.

### 1.2 Extends Phase 2 §1.5 — the TS/Python overlap is far larger than the provider jobs

Phase 2 correctly ruled that `lib/odds/props/` is live and that `CLAUDE.md`
overstates the cutover. Phase 3 measured the full overlap: **22 of 35 tables have
writers in both languages.**

```
game_odds_book_lines   game_odds_history            game_picks
game_sim_cache         golf_hole_scores             golf_model_predictions
golf_round_scores      golf_tournament_predictions  golf_tournament_results
golf_tournaments       model_weights                odds_cache
park_factors           pick_history                 pitcher_game_score_history
prop_odds              prop_odds_history            provider_usage
snapshot_cache         system_events                team_elo_history
team_hr_rate_allowed
```

Python-only (6): `player_game_history`, `job_health_checks`, `model_calibration`,
`model_artifacts`, `mlb_game_model_cache`, `walkforward_results`.
TypeScript-only (6): `bets`, `picks`, `watchlist`, `tracked_lines`,
`historical_odds`, `odds_unresolved`.

*Method: grep for raw `INSERT`/`UPDATE`/`DELETE` across both trees. Some writes go
through helpers, so 22 is a floor.*

**Phase 4:** this is your concurrency and write-conflict surface. Two independent
processes upserting the same natural keys, with no advisory locking anywhere that
I saw. `db.log_surfaced` and `logSurfaced` both rely on `ON CONFLICT DO NOTHING`
on the same key, which makes them safe from duplication but means **whichever
process writes first wins permanently** — including when the first writer had
worse data (this is the mechanism behind Phase 3's H4 leakage finding).

**Phase 5:** this is the headline engineering-standards gap, bigger than anything
on Phase 2's list. Full detail in `docs/audit-phase-3.md` §4.

### 1.3 Extends Phase 2 §1.8 — `/diagnostics` is worse than "one stale panel"

Phase 2 found `odds_unresolved` is a fossil. Phase 3 found the health checks
themselves report healthy through a total outage. At the time of audit, with
every provider job 986–1052 min stale:

```
gameOddsBookLinesFreshness    healthy   (counts rows over a 7-DAY window)
oddsHistoryAndPricesFreshness healthy   (satisfied by OddsHarvester alone)
propPredictionsFreshness      healthy   (counts rows generated from 17h-old prices)
```

The job-level checks *do* report stale correctly. So `/diagnostics` simultaneously
shows accurate red and misleading green. **Phase 4: do not treat any green panel
as evidence of anything without reading its query.** Phase 3 M9 has the fix.

Also live and unresolved: `refreshTennisAtpJob` / `refreshTennisWtaJob` have been
crash-looping for 16h on `TypeError: normalize() argument 2 must be str, not None`.

### 1.4 Confirms and quantifies Phase 2 §4's connection-budget warning

Phase 2's C2 (a 2-minute `lib/scheduler.ts` timer driving ~36 full scans of
`pick_history` per tick, 24,705 sequential scans, 4.49 billion rows read) is
consistent with everything Phase 3 saw. Add to it:

- `snapshot_cache` is **1,340 MB against the health check's own 800 MB
  threshold**, largest single payload 72.4 MB (`mlb:full-raw:2026-08-26`). The
  check reports this as STALE/unhealthy and has for some time.
- Live `system_events` errors on `/api/odds/lines` include
  `EMAXCONNSESSION (max clients reached, pool_size: 15)`,
  `canceling statement due to statement timeout`, and
  `timeout exceeded when trying to connect`. These are the app's own route
  failing against the shared pooler.

### 1.5 For Phase 5 — the competitive premise has changed

Phase 2 §4 told Phase 5 to "temper the `pick_history` asset claim." Phase 3 goes
further and it materially changes the competitive story:

- **The model does not beat the market.** Brier 0.2329 vs the market's 0.2294 on
  the 3,615 rows where both exist; paired t = 2.63; loses in 10 of 11 markets.
- **The `edge ≥ 3%` signal has no realized value.** Those picks won 40.84%; the
  market implied 41.02%.
- **First-ever CLV measurement is negative** (n=78): 27% beat the closing
  reference, −4.6% ROI per unit.
- **The fitted models are market-anchored**, with `marketProbCentered` weighted
  +3.5 (moneyline) and +3.7 (totals) while the app's own baseball features carry
  negative coefficients. Measured market-only baselines: MLB moneyline 0.2406,
  totals 0.2500 — the fitted models beat those by 0.0008 and 0.0025, i.e. noise.

**Phase 5 must not position Linesmith as "a model that finds value the market
missed."** Phase 3's own read is that the **line-shopping** half (best price
across 22 books, price movement history) is the defensible product today and
requires no model. Evaluate competitors on that axis primarily.

---

## 2. Operational notes

Phase 2 §2's DB access notes are accurate and complete — reuse them verbatim.
Recap of the parts that matter most:

- Swap `:5432` → `:6543` in `DATABASE_URL` (transaction-mode pooler). One
  `new pg.Client(...)`, `ssl: { rejectUnauthorized: false }`,
  `statement_timeout: 60000`. ~50 queries incl. `EXPLAIN ANALYZE` with no
  `EMAXCONNSESSION`.
- Script pattern (`pg` resolves only inside the repo):
  ```
  cd C:/Users/occy3/Documents/line-buddy
  # write _tmp.mjs here, run it, then delete it
  node ./_tmp.mjs ; rm -f ./_tmp.mjs
  ```
  Batch many queries into one connected script; dumping JSON to a file is far
  cheaper than one process per query. **Delete the temp file** — it sits in the
  repo root next to 200+ uncommitted files.
- **`n_live_tup` is unreliable — do not quote it.** Use real `COUNT(*)`.
- `SELECT SUM(LENGTH(payload)) FROM snapshot_cache` takes 32+ s. Use
  `pg_total_relation_size()` or `pg_column_size(payload)` with a `LIMIT`.
- **Do not use a heredoc for a large file.** Phase 3 hit `ENAMETOOLONG: uv_spawn`
  writing a ~1,900-line doc via `cat > file <<'EOF'`. Use the Write tool for
  anything over a few hundred lines.

**New for Phase 4:** compiling TypeScript for direct execution works and is worth
knowing —

```
node ./node_modules/typescript/bin/tsc <files> --module esnext --target es2022 \
     --moduleResolution bundler --outDir out
# then add {"type":"module"} to out/package.json and fix relative imports to .js
```

Phase 3 used this to execute the real `devig.ts`/`display.ts` against test
vectors rather than transcribing them. Useful for Phase 4 if you need to exercise
`middleware.ts` logic or any pure security-relevant helper directly.

---

## 3. Do not redo — Phases 1–3 covered these

- **Phase 1:** full schema introspection (35 tables, 88 indexes, constraints, RLS
  status, extensions, sequences); Render service + deploy history; the
  substantial code read listed in `audit-handoff.md`.
- **Phase 2:** full dead-code sweep (import graph over all `.ts`/`.tsx`, all 104
  API routes, all `python-odds-service/src/**/*.py`); the `lib/odds/props/`
  keep/delete ruling; migration structural verification; index inventory +
  `idx_scan`; `EXPLAIN ANALYZE` on the `pick_history` calibration aggregates and
  the `prop_odds`/`game_odds_history` prior lookups; provider market coverage and
  freshness; full `odds_unresolved` breakdown.
- **Phase 3:** all odds math verified numerically against the compiled real code
  (§2 of `audit-phase-3.md` is the trustworthy-list — don't re-derive it); model
  vs market baseline; calibration curves for props, totals, moneyline and golf;
  Poisson dispersion test; CLV first pass; the TS/Python write-overlap map;
  provider credit consumption (`provider_usage` by day); `middleware.ts` auth
  scope.

---

## 4. Phase 4 — auth, scale, security

### 4.1 Start here, in this order

1. **Resolve the second Render service.** `GET /v1/services/srv-da2v3ajsmd2c738bj7v0`
   with `RENDER_API_KEY` (read-only). Is `Linesmith` the web app? Is it running?
   Per §1.1 this decides whether the in-process timers and the per-request write
   passes are happening once or twice, and whether the ~15-connection budget has
   two claimants or three. Phase 2 §1.6 has the raw service listing from
   `before_delete_snapshot.json` (untracked, repo root).
2. **Model the real per-request cost.** A single `/api/odds/lines` GET does a
   multi-MB `snapshot_cache` read plus three write passes. Phase 2 measured a
   per-game version of one query at 62 s for a 15-game slate before it was
   batched. Establish what one page load actually costs in connections, time and
   rows touched — the existing `system_events` timeouts say the answer is "too
   much."
3. **Audit the public write surface** (§1.1). `/api/odds/lines` is the confirmed
   one. Sweep every route under `app/api/**` for write side effects on GET and
   check each against `middleware.ts`'s four protected prefixes. Phase 2 already
   flagged `/api/odds/game-lines` (`?force` triggers a paid The Odds API call),
   `/api/golf/predictions` (3,000-iteration Monte Carlo per request,
   self-described as a testing endpoint), and the `/api/props/*`
   backfill/fit/ingest operator routes — all public.
4. **Supabase adversarial RLS test.** Untouched by every phase so far. Hit
   `https://qsqzercvwnzaeboltvca.supabase.co/rest/v1/<table>` with
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and enumerate what a browser client can read
   and write. `bets`, `picks`, `watchlist`, `tracked_lines` are the per-user
   tables; `auth.users` is readable via the Postgres connection.
5. **`/diagnostics` is admin-gated to a single hardcoded UUID**
   (`ADMIN_USER_IDS = ['038048de-...']` in `middleware.ts`). Verify the gate
   actually holds — and note the operator's own comment says it is an allowlist
   rather than a `profiles.role` column because there is one operator today.

### 4.2 Specific things Phase 3 saw but did not chase

- **`SUPABASE_SERVICE_ROLE_KEY` is in `.env.local`.** Establish whether it ever
  reaches the browser bundle. `next.config.mjs` and any `NEXT_PUBLIC_` prefixing
  mistake are the places to look.
- **`provider_usage` is a shared mutable budget** written by both the app and the
  worker (`budget.ts`'s own header says fragmenting the key would break the
  shared budget). Two writers, no locking. What happens under concurrent
  increment? Is spend under-counted?
- **`propline_2` has `cap_kind="none"`** — no rate-limit gate at all, 4,098
  requests recorded for the month, last successful write six days before the
  audit. Likely vendor-side rejection with no visibility. See Phase 3 H7.
- **No CHECK constraints on any status/enum column** (Phase 2's finding,
  re-confirmed). Phase 3 H10 found `game_odds_book_lines` rows carrying totals
  that cannot be the same proposition (`over 2.5 @ +1200` beside `over 8.5 @ -101`
  for one MLB game). Constraints are the layer that would make that loud.
- **No retention policy on any table.** `snapshot_cache` 1,340 MB and growing
  ~8 MB/day from `mlb:full-raw` alone; `prop_odds` never expires rows.

### 4.3 Open questions Phase 4 should close

Carried from Phases 1–2, still open:

1. Are the 208 uncommitted files one change set or several? Three applied
   migrations exist only on this laptop.
2. Does `data/linebuddy.db` exist anywhere else? (Closes Phase 2 §1.7.)
3. What Supabase plan, and what size/egress/connection ceilings?
4. Any backup/restore procedure, or entirely Supabase's built-in?
5. Is `ODDS_API_KEY` deliberately withheld from the worker's Render env? Health
   check says `mlbGameLinesJob` → "ODDS_API_KEY is not set" while `odds_cache`
   shows the TS route refreshing it fine — two owners, one job.
6. Is `srv-da2v3ajsmd2c738bj7v0` ("Linesmith") the web app, and is it running?
7. Worker hang root cause (Phase 1 #2) — still unknown, and it has now been dead
   17h+ during a live audit.
8. Is Render `notifyOnFail` wired to anything real? Only confirmable in the
   dashboard.
9. OddsHarvester laptop's identity (Phase 1 #5).

---

## 5. Phase 5 — competitive + standards research

### 5.1 Reframe before you research

Read `docs/audit-phase-3.md` §3 first — it is the plain-language version of what
the product currently does and does not do. The short form:

- **Do not position this as a model that beats the market.** It measurably does
  not (§1.5 above). Any competitive framing built on predictive edge is building
  on a claim the operator's own data refutes.
- **Do position the line-shopping half as the asset.** 22 distinct bookmakers in
  `prop_odds`, 425,307 line-movement points in `prop_odds_history` (~20,000/day
  when healthy), 19,667 in `game_odds_history`. That is a real, differentiated
  dataset that requires no model to be valuable. Today it is read only by grading
  and one line-history route.
- **The realistic near-term product is price transparency**: best price across
  books, line movement, steam detection, book-lag analysis, CLV tracking. All
  achievable from data already in the database.

### 5.2 Research targets

- **Line-shopping / odds-screen competitors** — how OddsJam, Unabated, Crazy
  Ninja Odds, DarkHorseOdds and similar present best-line, de-vig method, and
  freshness. Specifically: *how do they display price age?* Phase 3's C4 is a
  solved problem everywhere else.
- **De-vig method as a differentiator.** Phase 3 M3: Linesmith uses multiplicative
  de-vig only. Shin's method and power/logarithmic de-vig are the recognised
  alternatives and several competitors expose the choice to the user. Worth
  knowing what the market expects.
- **CLV as a product feature, not just an internal metric.** Several tools show
  the user their own closing line value. Linesmith has the data and shows none.
- **What "sharp book" coverage costs.** Phase 3's edge redesign depends on a
  Pinnacle-class reference and currently has 3.3% coverage. Establish what real
  Pinnacle-carrying feeds cost — this is Phase 3 open question 4 and it is a buy
  decision, not a build one.
- **Correlated-prop handling.** Nothing in Linesmith tells a user that a batter's
  hits / total bases / runs / RBIs are the same event four ways. Check how
  competitors handle parlay correlation warnings.

### 5.3 Engineering-standards gaps to write up

Phase 2's list, plus Phase 3's additions:

- **Logic duplicated across two languages with no ownership boundary** — 22
  shared tables, self-described "direct ports" that have already drifted (Phase 3
  H6, H8, and Phase 2 §1.4's two golf pipelines). This is the largest one.
- **Zero automated tests on the TypeScript side.** 19 `test_*.py` files in
  `python-odds-service/`; nothing in `package.json`, no `*.test.ts` anywhere.
  Every Critical in Phase 3 is in TypeScript.
- No retention policy on any table.
- Config duplicated across three places with no test keeping them in sync — this
  caused two real defects (a silently-ignored spend cap and the C1 market map).
- No CHECK constraints on any status/enum column.
- **No model-governance process**: the activation gate compares a fitted model
  against the app's own unfitted formula, never against the market; the
  `model_calibration` and `model_artifacts` tables exist and are empty; two
  different MLB game models run simultaneously with no reconciliation.
- Health checks that report green during a total outage (§1.3).

---

## 6. Numbers you can reuse without re-measuring

Measured 2026-08-27. Re-verify before publishing any of them.

| | |
|---|---|
| `pick_history` | 362,616 rows; 362,409 MLB / 207 NFL; 87% `event_context='backfill'` |
| `pick_history` coverage | `model_prob` 355,246 · `outcome` 356,462 · `market_prob` 3,615 · `edge` 3,615 · `prop_score` 31,219 · `edge_source` **0** · `price` **0** |
| `prop_odds` | ~290,663 rows across 9 provider ids; 22 distinct bookmakers |
| `prop_odds_history` | 425,307 line-movement points |
| `game_odds_history` | 19,667 |
| `game_odds_book_lines` | 3,289 rows, 5 sources, bookmaker names **not normalised** |
| `game_picks` | 160 rows (144 MLB); 102 with both initial and final ML price |
| `snapshot_cache` | 1,340 MB (health threshold 800 MB); largest payload 72.4 MB |
| `historical_odds` | 37,922 games, 2010–2026, market probs already de-vigged |
| `model_weights` | 21 rows; active = moneyline v8, total v8, home-run v5 (MLB only) |
| `model_artifacts` / `model_calibration` | **empty** |
| `walkforward_results` | 21 rows, MLB moneyline, nothing activated |
| Provider daily spend (propline) | 897 (8/27, partial day) · 966 (8/26) · 1007 (8/22, over its 1000 cap) |
| Feed freshness at audit | propline/sharpapi/oddsapiio 17.5h · sportsgameodds & propline_2 6.7d · parlayapi_mlb 10.3d |
| Worker state | all `JOB_REGISTRY` jobs 984–1052 min stale |

---

## 7. What Phase 3 deliberately did not touch

So you know where the gaps are rather than assuming coverage:

- **Frontend behaviour under failure.** Phase 3 read `OddsChip`, `ScanTable` row
  building and `usePropOdds`'s shared logic, but did not exercise the UI. What
  the Scan table does with an empty/erroring `/api/props/lines` is unverified.
- **The `bets`/`picks`/`watchlist`/`tracked_lines` user-data path.** Entirely
  out of Phase 3 scope; it is Phase 4's.
- **`sim_engine.py` / `sim_game.py` / `sim_rates.py`.** The simulation carries the
  second-largest weight in both fitted models (`simWinProb` +2.29,
  `simOverProb` +1.04) and Phase 3 did not audit its internals — only observed
  its coefficient. **If Phase 4 or 5 has capacity, this is the largest unaudited
  model surface in the codebase.**
- **Tennis, NBA, NHL, CFB and soccer model internals.** Phase 3 audited the
  shared generic path (`generic_prop_score.py`, `generic_team_elo.py`,
  `edge_model.py`) but not each sport's own adapter. Note NBA and NHL have zero
  rows in `game_odds_book_lines`.
- **Golf's tournament-win model** (`golf_models.py`'s third section) — only the
  hole-score and round-score models were checked against graded outcomes.

---

*End of Phase 4 + 5 handoff. Both phases can run in either order within the
session; Phase 4's §4.1 item 1 (resolve the second Render service) should go
first regardless, because it changes the topology every other Phase 4 item is
measured against.*
