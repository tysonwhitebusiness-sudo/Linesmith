# Session handoff — full TS→Python prediction-engine port

**Written for**: picking this work up in a fresh Claude Code session/account.
Read this whole file before doing anything — it has the end goal, exact
current state, what's verified vs not, and known gotchas that cost real
debugging time to find once already.

---

## The end goal (read this first)

**Linesmith (line-buddy)** is a personal sports-betting research app. It
has two halves: a Next.js/TypeScript web app (`app/`, `lib/`) and a Python
background worker (`python-odds-service/`) deployed on Render, sharing one
Postgres/Supabase database.

Historically, all prediction/pick logic (Elo ratings, game models, pick
locking, prop models) lived in TS and ran only when a page was loaded —
correctness depended on someone actually visiting the site near the right
moment (6am, 3-hours-before-first-pitch, etc). Over a long prior
engagement, the **MLB** game-level prediction engine (Elo, game model,
pick-lock capture/grading) was fully ported to Python so it runs on a real
scheduler instead — **this part is done and live in production.**

**The user's explicit, current instruction (verbatim, this session):**
> "I want everything that is supposed to be built in python in python."
> "if prediction models arent built then lets hold off on building them,
> i just want to change all ts to python and anything built in the future
> will use our systems."

So the end goal is: **port every piece of prediction logic that already
exists in TS over to Python, running on Python's own scheduler instead of
depending on a page load.** Explicitly **not** in scope: inventing new
prediction models that don't already exist in TS (most notably, NFL has
**no** win-probability model anywhere in the codebase today — that's
correctly on hold, not being built).

The governing document for the *remaining* work (everything after MLB's
core engine) is **`docs/full-prediction-engine-python-port-gameplan-2026-08-22.md`**
— read that in full, it has the complete audit and phase breakdown for
every remaining track. This handoff file is the "where did we leave off"
supplement to that plan, not a replacement for it.

---

## Big picture: 4 tracks, current status

| Track | What | Status |
|---|---|---|
| **MLB core engine** (Phases A–P, separate older doc: `docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md`) | Elo, game model, pick-lock capture/grading | **DONE, deployed, live in production** |
| **Track A** — MLB leftovers (odds-history logging, total-prediction calibration logging, reference-price attachment) | Small direct ports | **DONE, verified locally, NOT YET COMMITTED** |
| **Track B** — Player-prop predictions (Beta-Binomial model + fitted home-run regression) | Medium — real system exists in TS, needs porting | **IN PROGRESS** — see "Track B progress, 2026-08-22" below |
| **Track C** — Golf predictions (hole/round/tournament models) | Real models exist in TS, no lock system (faithfully port as-is, don't invent a better one) | **NOT STARTED** |
| **Track D** — NFL predictions | **ON HOLD per explicit user instruction** — no model exists to port | Two small optional data-pipeline pieces (nflverse ingestion, descriptive ranks) noted but not required |

---

## Exact current git state — READ BEFORE TOUCHING GIT

```
Last 2 commits (pushed to origin/main, deployed to Render, confirmed live):
  4d74e1a  Phase P: cut route.ts's MLB pick-lock capture over to mlbOddsLinesCycleJob
  6b4d035  Add MLB prediction-engine port to the Python worker (Phases A-P)
```

**Uncommitted right now** (all Track A + start of Track B, built and
locally verified this session, never committed or pushed):
```
 M python-odds-service/src/db.py
 M python-odds-service/src/health_check.py
 M python-odds-service/src/predict/odds_lines_cycle.py
 M python-odds-service/src/predict/odds_math.py
?? python-odds-service/src/predict/edge_model.py          (Track B, UNVERIFIED)
?? docs/full-prediction-engine-python-port-gameplan-2026-08-22.md
```

**Do not `git commit`/`push` any of this without the user's explicit
go-ahead** — established pattern all session: build and verify locally
first, only commit/push when asked. When you do commit, review the diff
first (`git diff -- python-odds-service`) since `edge_model.py` in
particular has not been cross-validated yet (see below).

---

## Track A — done, verified, not committed

All four pieces below are built, live-tested against the real shared
Postgres database, and confirmed working. Files touched:
`python-odds-service/src/db.py`, `predict/odds_math.py`,
`predict/odds_lines_cycle.py`, `health_check.py`.

### A1 — `write_game_odds_history` (game odds price history logging)
- Port of `lib/odds/gameOddsLog.ts`'s `logGameOddsHistory`.
- `db.py`: new `GameOddsHistoryInput` dataclass + `write_game_odds_history()`.
- `odds_math.py`: added `decimal_to_american()` (was missing, needed for
  the `bookmakers[]` loop).
- Wired into `odds_lines_cycle.py`'s `run_mlb_odds_lines_cycle` via a new
  `_game_odds_history_rows()` builder function.

**Real bug found and fixed during verification #1**: the "best available"
price for a side and that same bookmaker's own listed price in
`bookmakers[]` can legitimately disagree (different parts of the-odds-api's
response). A naive port appends both as separate rows — since they share
one `observed_at` timestamp for the whole batch, `ORDER BY observed_at
DESC LIMIT 1` can't tell which is "current," causing **unbounded row
growth on every single write call, forever** (verified live: watched a
2-row conflict regenerate 2 more rows every call, no matter how many times
called with identical input). Root cause is a genuine data ambiguity
within one batch, not a database ordering issue — fixed by deduping
`_game_odds_history_rows()`'s output to one row per
`(event_id, market, side, bookmaker)` key before ever calling the DB layer
(keeping whichever was added last — the bookmaker's own `bookmakers[]`
entry, more specific than the "best available" summary attribution).
Verified stable across 3 repeated calls with identical input after the fix
(both synthetic and real live data).

### A2 — `log_game_total_predictions` (calibration logging)
- Port of `route.ts`'s `logTotalPredictionsFromLines` /
  `pickHistoryLog.ts`'s `logGameTotalPredictions`.
- `db.py`: new `SurfacedEntry` dataclass + `log_surfaced()` (the generic
  `pick_history` writer — **Track B will reuse this directly**, don't
  rebuild it), plus `GameTotalPrediction` + `log_game_total_predictions()`.
- Wired into `odds_lines_cycle.py`'s `run_total_lock_from_lines` — logs
  the RAW (un-fitted) `model.over_prob`, same as the TS original's
  separate `computeTotalModel` call (deliberately NOT the fitted/blended
  probability used for the actual lock).

### A3 — `attach_prices_from_lines` (reference-price attachment)
- Port of `route.ts`'s `attachPricesFromLines`.
- `db.py`: new `attach_moneyline_price()` / `attach_total_price()`
  (idempotent `..._price IS NULL` guard, matching TS exactly).
- New `attach_prices_from_lines()` function in `odds_lines_cycle.py`,
  called last in `run_mlb_odds_lines_cycle`.

### A-adjacent — REAL PRODUCTION BUG found and fixed (not in the original plan)

While testing Track A end-to-end, `health_check.py` caught a real live
failure: `gamePicksFreshness` went from healthy to **15/15 games missing
captures** the moment the eastern date rolled over to a new day.

**Root cause**: `odds_lines_cycle.py`'s `read_games_from_snapshot()`
(the function that gives `mlbOddsLinesCycleJob` its list of today's games)
was reading `snapshot_cache['mlb:snapshot']` — a cache **TS's `/api/mlb`
route owns**. Verified live: that cache was 73 minutes stale, still
holding **yesterday's finished slate**, because nothing had hit `/api/mlb`
for the new date yet. Since Phase P made `mlbOddsLinesCycleJob` the *only*
writer of MLB picks, this meant **zero picks were being captured for the
entire gap** — a real, live production correctness issue, not a
hypothetical.

**Fix** (user explicitly approved fixing this immediately, see
conversation): rewrote `read_games_from_snapshot(client)` (now takes a
`client` param) to source games entirely from **Python's own state** —
`statsapi.get_slate()` for the game list/team names/status, and
`db.read_game_model_cache()` (already populated independently by
`computeMlbGameModelJob`) for game model + Elo. Zero dependency on TS
staying fresh, ever, for this job.

**A real circular-import trap hit and avoided while fixing this**:
`game_model_cache.py` already imports `SnapshotElo`/`SnapshotGameModel`
FROM `odds_lines_cycle.py`. Needed `status_for()`'s trivial one-line dict
mapping in `odds_lines_cycle.py` too — importing it back would have been
circular. Fixed by duplicating the one-liner as `_status_for()` locally
with a comment explaining why, rather than restructuring the import graph.
**If you need to share code between `game_model_cache.py` and
`odds_lines_cycle.py` in the future, check which one imports which
first** — `game_model_cache.py` → `odds_lines_cycle.py` is the existing
direction.

**Verified**: `health_check.py` went from `UNHEALTHY` (`gamePicksFreshness`
FAIL, 15/15 missing) to fully `HEALTHY` (all 15 captured) after the fix,
against real production data, real MLB games.

### Track A's health check extension

`health_check.py` gained `check_odds_history_and_prices_freshness()` —
ground truth for A1/A3, reads `mlbOddsLinesCycleJob`'s own last-run
breadcrumb for a `lines` count, cross-checked against recent
`game_odds_history` row activity. Registered in `main()`'s results list.

### What's NOT done in Track A
- No git commit yet.
- The doc mentioned extending A2's health check as "fold into A1's" —
  this was *not* separately built; `check_odds_history_and_prices_freshness`
  only covers A1/A3 ground truth, not a dedicated A2 (calibration logging)
  check. Low priority — A2 is calibration data, not a live-serving path.
- TS side (`route.ts`) still has NOT had `logGameOddsHistory`/
  `logTotalPredictionsFromLines`/`attachPricesFromLines` removed — per
  the same pattern as the MLB core engine's Phase O→P, that removal
  should wait until Track A is proven stable over real usage (and now,
  committed + deployed to Render), not happen in the same sitting it was
  built. **Do not remove these from route.ts yet.**

---

## Track B — player-prop predictions — IN PROGRESS

### Track B progress, 2026-08-22 (this session)

Picked up from the "just started, unverified" state below. Progress against
the gameplan doc's build order, each item live-tested against the real
shared Postgres DB and/or the real live upstream endpoint, not just
`py_compile`'d:

1. **`predict/edge_model.py` — VERIFIED.** The cross-validation that got
   cut off last session ran clean: all 3 captured TS reference cases
   (below) matched the Python output bit-for-bit. Trust this file.
2. **`predict/statsapi.py` game-log fetching — already done, turns out.**
   `get_people_with_game_logs`/`get_league_batter_season_rows` were both
   already present (added earlier, as part of the MLB core-engine port,
   since `sim_rates.py`/`elo_model.py` needed them too — see the file's own
   module docstring). The "NOT yet added" note below was stale; no work
   needed here.
3. **`predict/savant.py` — NEW FILE, BUILT AND VERIFIED.** Direct port of
   `lib/sports/mlb/savant.ts`: CSV-scrape ingest/parse/aggregate, the
   cursor-based incremental season backfill, rate computation, batter
   ranking. Live-tested against the real Savant endpoint for a real 2-day
   range (285 pitchers / 368 batters, real names, plausible whiff%/exit-
   velo/hard-hit% magnitudes). Cache round-trip verified byte-for-byte
   against the TS `StatcastAggregateStore` JSON shape (camelCase keys
   preserved deliberately — **the cache key `mlb:statcast-agg:{season}:v2`
   is intentionally identical to TS's own**, so this becomes a "Python
   writes, TS reads" cutover the moment it's wired into a job, same as
   other snapshot-cache handoffs already in this codebase). Idempotency
   confirmed (repeat save/load, same result). Test data cleaned up from
   the DB afterward — **did not touch the real production
   `mlb:statcast-agg:2026:v2` row**, since a real run means a multi-minute
   full-season backfill; that should happen deliberately when the job is
   actually wired up, not as a side effect of unit verification.
4. **`db.py`: `log_surfaced`/`log_game_total_predictions`** — still already
   done (Track A2), reuse directly, don't rebuild.
   **`league_base_rates()` — NEW, ADDED AND VERIFIED**, direct port of
   `lib/db/client.ts`'s `leagueBaseRates`. Live-tested against real
   `pick_history` data (20 real dimensions returned, plausible rates).
   **Caught and fixed a real bug during verification**: Postgres's
   `AVG(...)` on the `CASE WHEN ... THEN 1.0 ELSE 0.0 END)` expression
   returns `NUMERIC`, which asyncpg maps to Python `Decimal` — but
   `edge_model.py`'s arithmetic (`league_rate * n0`, etc.) would raise
   `TypeError: unsupported operand type(s) for *: 'decimal.Decimal' and
   'float'` the moment this got wired together. Fixed with an explicit
   `::float8` cast in the query (not a Python-side `float()` cast — fixing
   at the SQL layer means every future caller gets a real float
   automatically, no per-caller cast to remember). **Watch for this same
   Decimal trap on any future `AVG`/`SUM` aggregate added to `db.py`** —
   nothing else in the file had hit it yet because nothing else used a
   NUMERIC-producing aggregate until this one.
   **`write_model_weights()` — NEW, ADDED AND VERIFIED**, direct port of
   `lib/db/client.ts`'s `writeModelWeights` (needed by both this track's
   home-run fit AND Track A4's `modelFit.ts` port — build once, share).
   Live-tested under a throwaway `sport='test'` row: version numbers
   increment correctly per (sport, market), activating a new version
   deactivates every prior version for that pair, a non-activating write
   doesn't disturb whichever version is currently active, and every JSON
   column (`feature_names`, `weights_json`, `covariance_json`,
   `train_seasons_json`, `holdout_seasons_json`) round-trips exactly.
   Cleaned up afterward.
5. **`predict/home_run_model.py` — NEW FILE, BUILT AND VERIFIED.** Direct
   port of `lib/sports/mlb/homeRunModel.ts` — pure feature functions
   (`park_hr_factor_centered`, `pitcher_matchup_signal`,
   `expected_pa_centered`/`expected_pa_centered_from_trailing_average`,
   `apply_lineup_confidence`, `apply_fitted_home_run_weights`), no I/O.
   Cross-validated against a live Node one-liner running the equivalent TS
   logic — every value matched bit-for-bit.
   **`predict/home_run_model_fit.py` — NOT STARTED.** This is the bigger
   remaining piece: `aggregateLeagueAndTeamHrRates`,
   `computeLeagueAndTeamHrRates`, `buildHomeRunSeasonRows` (the
   chronological per-batter walk-forward feature builder — no-lookahead
   discipline matters here, re-read `homeRunModelFit.ts`'s file header
   before touching this), `fitHomeRunWeights`. Depends on: `statsapi.py`'s
   `get_schedule_range` (exists), `get_league_batter_season_rows`/
   `get_people_with_game_logs` (exist), `db.read_park_factors` (exists),
   `db.write_model_weights` (now exists, see above), `edge_model.py`'s
   `compute_model_probability` (exists, verified),
   `logistic_regression.py`'s `fit_logistic_regression`/`predict_prob`/
   `brier_score` (already ported, verified in an earlier phase).
6. **`lib/sports/mlb/homeRunLiveMatchup.ts` port — NOT STARTED.** The live
   (not training-time) team-HR-rate-allowed cache:
   `refresh_team_hr_rate_allowed`/`load_team_hr_rate_allowed_cache`, needs
   `db.read_team_hr_rate_allowed`/`write_team_hr_rate_allowed` (neither
   exists in `db.py` yet — check first, don't assume).
7. **Batter/pitcher composite rankings** (`batterRankings.ts`/
   `pitcherRankings.ts`) — used for display and the `matchupFavorable`
   signal. Not started. `savant.py`'s `rank_batter_statcast` (built this
   session) covers the Statcast-only half of this; the composite
   (traditional-stat-merged) ranking is still TS-only.
8. **Park-factor computation** (`computeParkFactors` in `parkFactors.ts`)
   — `db.read_park_factors` already exists (read-only), but nothing in
   Python computes/writes a fresh row yet. Not started.
9. **New job** (`jobs.py`: `job_compute_mlb_prop_predictions`) that ties
   all of the above together into an actual per-slate prediction run and
   calls `db.log_surfaced` — not started, blocked on 5-8 above existing
   first.
10. **Health check extension** — not started, per the gameplan doc's own
    spec (ground truth against real `pick_history` rows for today's slate).

**Also still true**: Track A4 (MLB "leftovers" Phase H — `modelFit.ts`
port) was never started. It shares `logistic_regression.py` AND now
`db.write_model_weights` with this track's home-run fit — do them
together, not separately.

### Approved full-cutover plan, 2026-08-22 (supersedes ad-hoc Track B continuation)

A full 15-phase plan was researched and approved this session — see
`C:\Users\occy3\.claude\plans\enchanted-beaming-sparkle.md` (also saved to
memory as `project_python_cutover_plan`). It supersedes "continue Track B"
as the thing to follow — read that file for the authoritative phase
breakdown, not this section. Key corrections it made to the original
gameplan doc's Track B build order:
- **`matchupFavorable` does NOT come from `batterRankings.ts`/
  `pitcherRankings.ts`'s composite scores** — it comes from a separate
  team-level DVP pipeline in `adapter.ts` (`matchupSplit`/`rankSplit`/
  `teamLevelMatchupRank`, ~250 lines) that hadn't been scoped before. The
  composite rankings turned out to be diagnostics-display-only. This
  reprioritized the real critical path to a ~500-600 line `adapter.ts`
  port (`predict/prop_candidates.py`, the plan's Phase 2), bigger than the
  original doc implied.
- **Explicit user decision: no TS fallback, ever, once a piece is cut
  over.** Delete the old TS compute code outright once the Python
  replacement is proven reliable in production — not the softer
  "keep a dormant fallback" pattern the earlier MLB game-model cutover
  used. See the memory file `feedback_python_cutover_no_fallback` for the
  full reasoning; this applies to every future cutover in this project,
  not just the ones in the current plan.
- **Golf (Track C) and a final audit sweep (Phase 15) are now in scope**
  in the same plan, not deferred — per the user's explicit "ALL prediction
  models" instruction.

**Progress against that plan, this session (2026-08-22, continued after
the plan was approved):**
- **Phase 1a — DONE, verified.** `predict/statsapi.py` gained
  `rank_pitchers`/`PITCHER_RANK_KEYS`/`PITCHER_RANK_LOWER_IS_BETTER`.
  Live-tested against real 2026 starter data: lowest ERA correctly ranks
  1, highest strikeout count correctly ranks 1 (direction confirmed both
  ways).
- **Phase 1b — DONE, verified.** New `predict/park_factors.py`
  (`compute_park_factors`, `ParkFactorResult`) + `db.write_park_factors`
  (upsert on `(venue_id, season)`). Live-tested against real 2026 season
  data: Coors Field reads 1.25 (clamped max — matches its real reputation
  as the most hitter-friendly park), T-Mobile Park reads 0.83 near the
  bottom (matches its pitcher-friendly reputation). Write path tested for
  round-trip + upsert-not-duplicate idempotency under a throwaway season
  number, cleaned up after.
- `health_check.py` still fully green after both.
- **Phase 2f — DONE, verified (discovered mid-implementation, user
  explicitly approved folding it in rather than deferring — see plan
  file's Phase 2f section).** While scoping what a `pick_history` row
  actually needs, found that TS locks `prop_score`/`score_grade`/
  `trust_tier` at first-surfaced time via a whole "Prop Score v1"
  subsystem (`liveEdge.ts`/`propScore.ts`/`goodBets.ts`/`windowedStat.ts`/
  `marketTrust.ts`) that wasn't in the original Phase 2/3 scope — since
  `SurfacedEntry` is an `INSERT ... ON CONFLICT DO NOTHING`, skipping this
  would have meant every Python-written `pick_history` row had those
  fields permanently null. Built and verified this session:
  - `predict/windowed_stat.py` (new) — partial port of `windowedStat.ts`
    (`fixed_window`/`open_window`/`subset_window`/`current_streak`/
    `window_set`; `average`/`entryValue` string-token parsing skipped,
    disclosed in the file docstring, since nothing in this chain reads
    it). Cross-validated against a Node one-liner on a 20-game synthetic
    history — l5/l10/l15/szn/streak/h2h all matched exactly.
  - `predict/good_bets.py` (new) — partial port of `goodBets.ts`
    (`performance_match_details`/`candidate_good_bet_signals` only; the
    "Good Bets" UI-filter half of that file — `isGoodBet`/
    `goodBetReasons`/`qualifiesByEdge`/etc — isn't needed by Prop Score
    and wasn't ported). Cross-validated against the same synthetic
    history — every `PerformanceMatch` (column/short/long/margin) matched
    exactly, including a JS-`Math.round`-vs-Python-`round()` tie-breaking
    fix (`_js_round`, floor(x+0.5)) applied to its percentage strings.
  - `predict/prop_score.py` (new) — full port of `propScore.ts`
    (`compute_prop_score`/`grade_for_score`). Same `_js_round` fix applied
    to the score itself, since it decides the letter-grade tier. Cross-
    validated: score=78, grade="A", all four M/E/P/X components matched
    the Node reference exactly.
  - `predict/market_trust.py` (new) — full port of `marketTrust.ts`
    (`trust_tier_from_live_bss`).
  - `predict/live_edge.py` (new) — full port of `liveEdge.ts`
    (`resolve_candidate_edge`/`rows_for`/`best_price`/`user_book_price`).
    Live-tested against real `prop_odds` rows for a real MLB game/subject/
    market: correctly resolved a real de-vigged edge when a genuine
    same-book two-sided price existed, correctly returned `edge=None` when
    the chosen book had no matching same-provider counterpart — both
    documented TS behaviors, not bugs.
  - `db.py` gained `read_prop_odds_for_game` (direct port of
    `readPropOddsForGame`) and `live_market_skill` (direct port of
    `liveMarketSkill`) — the latter needed the same `::float8` cast
    discipline as `league_base_rates` to avoid the Decimal trap (SQL
    already includes it this time, caught before it shipped rather than
    after).
  - `entity_resolution.py` gained `candidate_dimension_to_market_key`/
    `candidate_category_to_side` (small, direct ports) plus
    `CANONICAL_MARKET_KEYS` (built from the already-ported
    `MARKET_KEY_ALIASES` dict rather than re-porting a second table).
    `odds_math.py` already had `american_to_decimal`/`decimal_to_american`/
    `devig_two_way` from an earlier phase — no work needed there, just
    reused.

- **Phase 2a-2e — DONE, verified end-to-end against today's real live
  slate.** New `predict/prop_candidates.py` — the actual matchup/
  candidate-generation pipeline: `PropMatchupContext`/
  `build_snapshot_context` (the once-per-snapshot league rank tables —
  reused `game_model_cache.py`'s already-built `TeamSide`/
  `build_recent_lineups`/`_make_side` for lineup resolution rather than
  re-porting `adapter.ts`'s `makeSide` a second time), `matchup_split`
  (produces `matchup_favorable`), `stat_entry`/`stat_market_candidates` +
  both dimension-definition tables (16 `value_of` lambdas, ported field-
  for-field), `hit_in_game_candidate`, `RARE_EVENT_FLOOR` gating,
  `build_todays_candidates` (the full slate walk). Live-tested against a
  real slate: **2,388 real candidates across all 16 dimensions**, every
  one with a `model_prob`, `matchup_favorable` distribution (1094 true /
  553 false / 741 none) that looks directionally sane. **The home-run
  fitted model is already active in production (version 5, fitted
  2026-08-14)** — confirmed the blend fires correctly for all 24 real
  home-run candidates (previously this was only reachable in theory,
  since no fit had been verified running through this pipeline before).
- **Phase 2f's remaining wiring — DONE, verified.** New
  `predict/prop_pick_history.py` (port of `pickHistoryLog.ts`'s player-
  prop path): `trust_tier_map` (wraps `db.live_market_skill` +
  `market_trust.py`), `candidate_to_surfaced_entry`, `log_snapshot_candidates`.
  `config.py` gained `USER_SPORTSBOOK` (default `"Fanatics"`, matching
  TS). Verified against real data: built real `SurfacedEntry` rows
  without writing first (trust tiers, prop scores, grades all sane —
  note **`moneyline`/`total` show `trust_tier='excluded'`** in real live
  data right now, a genuine current signal from `live_market_skill`, not
  a bug), then did a small 3-row real write + idempotency check (second
  write didn't duplicate) + cleanup, confirming the write path itself
  works before letting it touch real data at scale.
- **Phase 3 — DONE.** `jobs.py` gained `job_compute_mlb_prop_predictions`
  (registered in `JOB_REGISTRY`, 5min interval matching
  `mlbOddsLinesCycleJob`'s cadence) — thin wrapper calling
  `prop_candidates.build_snapshot_context` +
  `prop_candidates.build_todays_candidates` +
  `prop_pick_history.log_snapshot_candidates`. **Not yet actually run for
  real** — only its components were tested individually/at small scale
  (see above); running the real job writes ~2,388 real predictions to
  production `pick_history` for today, locked in via first-surfaced-wins,
  which is a bigger action than anything else tested this session and
  hasn't been explicitly greenlit yet.
- **Phase 4 — DONE.** `health_check.py` gained
  `check_prop_predictions_freshness` — cross-checks the job's own last-run
  candidate count against real `pick_history` rows for today's real games
  (50% floor, absorbs normal day-to-day variance without false-
  positiving). Currently reports `NEVER RUN` (correct — the real job
  hasn't run yet, see above), and the generic per-job registry check
  (`health_check.py` reads `JOB_REGISTRY` automatically, per `CLAUDE.md`'s
  own claim — confirmed true, no extra code was needed for this half)
  independently also reports `NEVER RUN` for the same reason.

**Update: the real job has now run, with explicit go-ahead.** Ran
`job_compute_mlb_prop_predictions` for real (2026-08-22, ~06:00 UTC):
2,388 candidates, `ok: true`, 165s elapsed. `health_check.py` immediately
after: **fully HEALTHY across every check**, including the new
`propPredictionsFreshness` showing an exact match (2,388 reported = 2,388
rows landed). Spot-checked the real written data — real player names,
plausible probabilities, sensible grade distribution (967 D / 412 C+ /
560 C / 114 B+ / 217 B / 38 A+ / 80 A — skews toward D/C because most
candidates have no genuine two-sided live market price yet, which
zero-weights Prop Score's E component, matching the "~1 in 8 combos have
real two-sided pricing" figure noted elsewhere in this codebase's own
history). Trust tier distribution matches expectations exactly (270 =
batter-strikeouts' real count, tier "proven"). **Python is now genuinely
computing and writing real MLB prop predictions in production, running on
its own 5-minute schedule** (once actually deployed/scheduled on Render —
this was run manually from local dev against the same shared database;
confirm the deployed worker picks up `computeMlbPropPredictionsJob` from
`JOB_REGISTRY` on its next restart/deploy).

### Update, continued (2026-08-22, later same session) — Parts 3-6 built

After the user asked to "build all of these at once and test in between
phases," referring to everything still not done (Phase 5, Track A4/Phase 6,
Phase 7, Phase 8, Golf Phases 9-14, Phase 15), the following got built and
verified this pass — in dependency order, each tested against real data
before moving to the next:

**Track A4 / Phase 6 — `predict/model_fit.py` (moneyline/total fit) — BUILT, core walk-forward verified, full fit NOT run.**
Direct port of `modelFit.ts` in full: `build_training_set` (the season-by-
season walk-forward loop — team state, local Elo recompute, sim-engine
call, historical-odds join), `fit_moneyline_weights`, `fit_total_weights`.
`db.py` gained `get_historical_odds` (direct port, tested against real
2010-2026 data — 37,922 real historical rows exist already). Verified
`build_training_set` alone against real 2023 data: 2,208 moneyline rows,
2,179 total rows, coverage stats all sane (market_coverage 2201/7,
bullpen_coverage 2179/0 missing). **Took 746 seconds (12.4 min) for one
season** — confirmed this is genuinely expensive compute (sim-engine calls
+ sequential per-game historical-odds lookups), not a bug. **Deliberately
did NOT run the full `fit_moneyline_weights`/`fit_total_weights` for
real** — a multi-season fit would take ~40-50 minutes AND, if it beats
the current baseline, would activate a new live model affecting real
production moneyline/total predictions immediately. That's a bigger,
more consequential action than anything else tested this session; flag
this to the user before running it for real.

**Phase 7 — `predict/home_run_model_fit.py` + `predict/home_run_live_matchup.py` — DONE, wired into the live pipeline.**
Direct ports of `homeRunModelFit.ts`/`homeRunLiveMatchup.ts`:
`aggregate_league_and_team_hr_rates`, `compute_league_and_team_hr_rates`,
`build_home_run_season_rows`, `fit_home_run_weights`,
`refresh_team_hr_rate_allowed`, `load_team_hr_rate_allowed_cache`. `db.py`
gained `read_team_hr_rate_allowed`/`write_team_hr_rate_allowed` (the
`team_hr_rate_allowed` table already had 30 real rows from TS). **Wired
`prop_candidates.py`'s `build_snapshot_context` to actually call
`load_team_hr_rate_allowed_cache`** (previously hardcoded to `None` before
this file existed) — the home-run model's live pitcher-matchup signal is
now real, not the neutral placeholder. Not yet run: an actual
`fit_home_run_weights` real training pass (same production-activation
consideration as Track A4 above — the currently-active version-5 model
was presumably fit by TS, not yet re-verified via a real Python run).

**Phase 8 — `predict/batter_rankings.py` + `predict/pitcher_rankings.py` — DONE, verified, one real bug caught and fixed.**
Direct ports of `batterRankings.ts`/`pitcherRankings.ts`. **Caught a real
bug during verification**: `savant.py`'s `rank_batter_statcast` (built
earlier this session) returns rank-dict keys in snake_case
(`barrel_pct`/`exit_velo`/`hard_hit_pct`/`whiff_pct`), but the TS source's
own `BatterStatcastKey` is camelCase — `batter_rankings.py`'s first draft
used camelCase keys to read those ranks, silently returning
`composite=None`/`overall_rank=None` for every single batter (confirmed
live: all 636 real batters showed null). Fixed by reading the snake_case
keys internally and translating to camelCase only at the JSON cache-
serialization boundary (`_ranks_to_json`/`_ranks_from_json`), preserving
cross-app cache compatibility with TS's format. After the fix, verified
against real 2026 season data: pitcher rankings correctly put Shohei
Ohtani #1 (ERA 1.79); batter rankings correctly put Yordan Alvarez #2 and
Juan Soto #3 — both real, well-known elite hitters. Cache round-trips
confirmed byte-for-byte for both.

**Golf, Phases 9-13 — DONE, live-tested against a real in-progress tournament (BMW Championship, round 2).** New files:
- `predict/golf_espn.py` — `fetch_golf_event` (ESPN leaderboard +
  scoreboard merge) and `get_season_schedule`. **Found and fixed a second
  real cache-key collision** while building this: an early draft used
  `golf:schedule:route:{year}` without grepping first, which turned out
  to be `app/api/golf/schedule/route.ts`'s own key for a *different*,
  wrapped `{events,fetchedAt,...}` shape — exactly the collision pattern
  `CLAUDE.md` already documents happening once for this same key family.
  Fixed by reusing `schedule.ts`'s own internal key (`golf:schedule:{year}`,
  bare array) instead, confirmed reading TS's real cached 49-event 2026
  schedule correctly afterward.
- `predict/golf_player_matching.py` — reuses `entity_resolution.py`'s
  `normalize_name`/`_last_name_of` directly rather than re-porting
  identical MLB name-matching logic a second time.
- `predict/golf_pgatour_stats.py` — SG:Total scrape only (the 19-stat
  "Advanced Stats" board is PlayerDetail-display-only, not used by any
  model, not ported). Verified live: Scottie Scheffler #1 (2.374 SG/round
  — matches his real dominant 2024-2025 form), Rory McIlroy top 5.
- `predict/golf_venues.py` — the 24-venue exact-coordinates table only;
  the city-level geocode fallback (`lib/weather/openMeteo.ts`'s
  `geocode`) is NOT ported, a disclosed simplification (minor wind-signal
  effect, most major venues already covered).
- `predict/golf_models.py` — all three models (`predict_hole_score`,
  `predict_round_score`, `predict_tournament`) in one file per the plan's
  own naming. Cross-validated against Node: hole/round score math matched
  bit-for-bit; the Monte Carlo tournament sim's per-golfer probabilities
  matched exactly under a fixed-sequence deterministic RNG (a first
  attempt using an LCG seed diverged between languages — traced to the
  LCG's own arithmetic overflowing JS's safe-integer precision at that
  scale, a test-harness artifact, not a port bug; switched to a fixed-
  value-sequence RNG and got an exact match).
- `predict/golf_history.py`, `predict/golf_grading.py` — direct ports of
  `historyIngest.ts`/`grading.ts`. `db.py` gained `log_system_event` plus
  every golf table's write/read functions (`write_golf_tournament`,
  `write_golf_hole_scores`, `write_golf_round_scores`,
  `write_golf_tournament_results`, `log_golf_model_predictions`,
  `log_golf_tournament_predictions`, `find_gradeable_hole_predictions`,
  `write_graded_hole_predictions`, `find_gradeable_tournament_predictions`,
  `write_graded_tournament_predictions`).
- `predict/golf_candidates.py` (new — no direct TS-file equivalent by
  name, ties together the prediction-relevant subset of `adapter.ts`'s
  `candidatesForGolfer`/`roundScoreCandidate`/the inline "Phase A" block):
  per-golfer hole/round history building, then the full predict-and-log
  pipeline.
- `jobs.py` gained `job_golf_predictions` (5min interval, registered in
  `JOB_REGISTRY`).
- `health_check.py` gained `check_golf_predictions_freshness` (Phase 13)
  — cross-checks the job's own breadcrumb against real
  `golf_model_predictions`/`golf_tournament_predictions` rows, plus a
  probability-well-formedness check (`[0,1]` range,
  `probTop5 >= probWin`, etc.) as golf's ground truth, since there's no
  MLB-style fixed schedule to check candidate counts against.
- **Ran the real job against the live BMW Championship** (round 2 in
  progress at the time) — golf's capture pattern is upsert-while-
  ungraded (not MLB props' pure lock-forever insert), making a real run
  meaningfully lower-risk/more reversible, so this was run without a
  separate check-in the way the MLB props job's first real run got one.
  **Result: 950 hole/round-score predictions + 50 tournament predictions
  logged, `ok: true`, 437s.** Because round 1 was already fully complete
  before this first-ever poll, grading ran in the same execution and
  graded 930 of them immediately — a genuine end-to-end validation of
  predict -> log -> ingest history -> grade all in one real run, not just
  the predict half. **Real calibration signal**: 950 graded rows, hit
  rate ~50.9%, **Brier score 0.207** — meaningfully better than the 0.25
  coin-flip baseline `grading.ts`'s own docstring names as the bar a real
  model should clear. Tournament win probabilities came back as a
  sensible distribution (top favorite ~39%, smoothly declining). `db.py`'s
  `find_gradeable_hole_predictions` SQL (`SUBSTRING(dimension FROM 6)`,
  the trickiest query in this batch) independently verified correct
  against real Postgres before trusting the job's own result.
  `health_check.py` fully green for golf immediately after
  (`golfPredictionsJob`/`golfPredictionsFreshness` both healthy).
  **One real bug caught and fixed mid-flight** (after this run had
  already started, so it ran the slightly-earlier version): the "course
  par fallback" for a hole with a missing `relativeToPar` value was
  initially mis-scoped as "display-only" and skipped — it's actually real
  hole-history data recovery that thins the prediction sample if dropped.
  Fixed in `golf_candidates.py`'s `_hole_history_for`; the fix is in the
  code for the next run, this run's real result stands as a valid (if
  very slightly less complete on the rare column that needed the
  fallback) end-to-end test.

**Phase 15 — DONE.** Audited all 42 remaining routes under
`app/api/mlb/**`/`props/**`/`golf/**` (delegated to a background agent,
each route read and classified). **One real, genuine gap found**:
`app/api/golf/predictions/route.ts` independently recomputes
`predictHoleScore`/`predictRoundScore`/`predictTournament` (the exact
trio now ported and running as a real Python job) against the live TS
snapshot cache — it never reads Python's output. Two things make this
low-urgency rather than a real production risk: (1) confirmed **no
caller anywhere in the app** — `docs/data-flow-audit-2026-08-17.md`
already flagged it as dead code from the UI's perspective; (2)
`docs/premium-feature-gating-audit-2026-08-18.md` separately flagged it
as an **unauthenticated, publicly-reachable** endpoint exposing the
model's output, recommending removal/gating on its own, unrelated
grounds. **Action needed, not yet taken**: delete this route (or fold its
removal into Phase 14's cutover) — given it's already flagged dead code
by two independent prior audits, deleting it isn't gated behind the
"prove the job unattended first" rule the way Phase 5/14's *live-serving*
cutovers are; nothing depends on it. Every other route audited was either
(a) already reading from what Python now writes, or (b) a genuinely
read-only diagnostic/admin/backfill route correctly out of scope.

**Still not done**: Phase 5 (MLB props TS cutover — still correctly gated
on the job proving itself unattended over time, not just manual runs),
Phase 14 (golf's own TS cutover — same gate, plus now also needs to
remove `app/api/golf/predictions/route.ts` per the Phase 15 finding
above).

**Parts 1-2 of the approved plan (Phases 1-5) are now fully done except
Phase 5 itself (the TS-serving cutover) — everything up to and including
a real, verified, live production job run is complete.** Next steps in
priority order: (1) Phase 5's TS cutover, once this job has run
unattended for real for a while and proven stable (not just this one
manual run) — per the plan's own explicit "no fallback" gate; (2) Parts
3-6 (Track A4, home-run fit training, composite rankings, golf) — all
independent of each other and of Part 1-2's completion, can be done in
any order or in parallel by a different session.

### edge_model.py cross-validation reference values (now confirmed passing)

```
Case 1 (home-runs, leagueRate=0.045, overCount=8, totalCount=100, matchupFavorable=true, recentOverCount=2, recentTotalCount=10):
  {"prob":0.07743266129032259,"stdDev":0.021399263744796546,"sampleSize":100,"priorMean":0.06004125,"priorStrength":50}
Case 2 (total-bases, leagueRate=0.35, overCount=20, totalCount=50, matchupFavorable=false):
  {"prob":0.37008653846153844,"stdDev":0.059431969321576655,"sampleSize":50,"priorMean":0.270375,"priorStrength":15}
Case 3 (hit-in-game, leagueRate=0.27, overCount=0, totalCount=0, matchupFavorable=null):
  {"prob":0.2700000000000001,"stdDev":0.11098986440211557,"sampleSize":0,"priorMean":0.27,"priorStrength":15}
```

Python's `compute_model_probability` reproduced all three exactly (verified
this session, see the module's own cross-validation run).

---

## Track C — golf — NOT STARTED

Full audit already done (see the gameplan doc's Track C section in
detail) — models exist in TS (`holeScoreModel.ts`/`roundScoreModel.ts`/
`tournamentWinModel.ts`), zero golf presence in Python today. **Scope
correction already applied to the plan**: port golf's *actual* current
behavior (compute every poll, upsert-until-graded) faithfully — do
**not** invent a better scheduled-lock system, per the same "port what
exists, don't build new design" rule that put Track D on hold.

---

## Track D — NFL — ON HOLD, do not build

No win-probability model exists anywhere in this codebase for NFL —
confirmed by direct code audit (`lib/sports/nfl/adapter.ts`'s own header
comment admits it, and an exhaustive grep for `winProb`/`elo`/etc. across
`lib/sports/nfl/` returns nothing). Per the user's explicit instruction,
**do not build a new model to fill this gap** in this pass. Two small,
independent, genuinely-portable pieces exist if ever wanted (nflverse CSV
ingestion, descriptive team/player percentile ranks) — see the gameplan
doc's Track D section — but neither is required for anything else and
neither should be treated as "the next thing to build" without the user
explicitly asking.

---

## How to verify things in this codebase (methodology used all session)

1. **Cross-validate pure functions against the TS original directly**:
   for a small pure function, just re-implement the exact same logic
   inline in a `node -e "..."` one-liner (no transpiler needed for small
   snippets) and diff outputs against the Python port for several test
   vectors. For larger files, transpile with
   `npx tsc <file> --module commonjs --target es2020 --moduleResolution
   node --esModuleInterop true --skipLibCheck` into a scratch dir and
   `require()` it from a small `.cjs` harness (`NODE_PATH=<node_modules>
   node harness.cjs`, needed because `pg`/`asyncpg`-adjacent lazy pool
   getters mean requiring the compiled file never triggers a real DB
   connection).
2. **Test against the REAL shared Postgres database directly** — this
   codebase's Python venv (`python-odds-service/.venv`) has direct access
   to the same database Render's worker uses. Write small one-off
   `./.venv/Scripts/python.exe -c "..."` scripts that call the real
   function against real data, print results, and (for anything that
   writes) clean up synthetic test rows afterward with an explicit
   `DELETE ... WHERE event_id='test-...'` — never leave synthetic data
   behind silently.
3. **Idempotency-check any write path** by calling it 2-3 times in a row
   with identical input and confirming row counts stabilize — this is
   exactly what caught the A1 bug above. Don't skip this for any new
   write function.
4. **Run `health_check.py`** (`./.venv/Scripts/python.exe src/health_check.py`
   from `python-odds-service/`) after any change that touches a job's
   data path — it's the fastest way to see real production-state
   regressions (it caught the snapshot-staleness bug above within
   minutes of it existing).
5. **`ast.parse()` / `py_compile`** every touched file for a fast syntax
   check before live-testing:
   `./.venv/Scripts/python.exe -m py_compile <files...>`.
6. For TS-side changes: `npm run typecheck` (`tsc --noEmit`) from the
   repo root, plus a real dev-server request via the Browser tools when
   the change is user-visible.

---

## Known environment quirks (don't re-diagnose these)

- **`next dev` is dramatically slower than production** for a cold build
  on a never-before-fetched date (documented in-code, `statsapi.ts`) —
  don't mistake this for a real regression.
- **The Browser pane tooling in this environment is sometimes flaky**
  (intermittent `navigate` failures even when the underlying HTTP request
  succeeds per server logs) — if it happens, trust server logs / direct
  `preview_logs` checks over a failed `navigate` call before assuming
  something's broken.
- **`render.yaml`'s worker service has `autoDeploy: false` on purpose** —
  pushing to `main` does NOT auto-deploy the Python worker. A human must
  trigger a manual deploy from the Render dashboard. The user has done
  this once already this session for commit `6b4d035`/`4d74e1a` — it's
  confirmed live. Any further uncommitted work needs the same manual
  trigger once pushed.
- **A local test run and a real Render job run are indistinguishable in
  the `python-harness:job-run:*` breadcrumb table** — both write to the
  same shared Postgres. Don't assume a "last run Xmin ago, ok=true" is
  necessarily the real scheduled job; it can be an artifact of manual
  testing. Cross-check with something that couldn't have been faked by a
  manual call (e.g. real ground-truth data changing) when it matters.

---

## Undocumented parallel work discovered 2026-08-22 (read this if you're
## about to touch `lib/db/client.ts`, caching, or anything DB-shaped)

A fresh session picking this handoff up found a SECOND body of real,
uncommitted work this file never mentioned — all dated the same evening
(Aug 21) as everything above, so it's from this same stretch of work, just
not written up here:

- **`lib/db/client.ts` has been fully rewritten from `better-sqlite3` to
  async Postgres** (`lib/db/pgClient.ts`, new `pg`/`pg-copy-streams`
  dependencies, `better-sqlite3`/`node:sqlite` dropped from
  `next.config.mjs`'s `serverExternalPackages`). The local
  `data/linebuddy.db` file is gone; `DATABASE_URL` is configured in
  `.env.local`. There's also an untracked `scripts/migrate-to-postgres.js`
  and `scripts/test-job-lock.ts`. **This is the same Postgres database the
  Python worker already targets** (`python-odds-service/src/db.py`'s
  `DATABASE_URL`) — confirmed by the user to be finished and trustworthy,
  not a WIP experiment.
- **`CLAUDE.md`'s API-caching section is now stale** — it still describes
  `lib/db/client.ts` as "the SQLite-persisted cache itself." It's Postgres
  now. Nobody has fixed this doc yet; do it if you're in the area, but it
  wasn't in scope for this session's Track B work.
- **A gzip-compression feature landed the same evening**
  (`lib/db/jsonPassthrough.ts`'s `jsonResponse`, `lib/cachedRoute.ts`) —
  reads as finished, well-commented, not part of the prediction-engine port
  at all. Mentioned here only so a future session doesn't mistake it for
  drift or an accident.

None of this was touched or verified further this session (out of scope
for Track B) — just flagged so it isn't rediscovered from scratch again.

---

## Immediate next steps, in order

1. ~~Finish verifying `edge_model.py`~~ — **DONE 2026-08-22**, all 3 cases
   match bit-for-bit.
2. ~~statsapi.py game logs~~ — **already done** (earlier phase).
   ~~savant.py~~ — **DONE 2026-08-22**, built and live-verified.
   ~~home_run_model.py~~ — **DONE 2026-08-22**, built and verified.
   `home_run_model_fit.py` — **NOT started**, the next real piece of work.
   Then: `homeRunLiveMatchup.ts` port, batter/pitcher composite rankings,
   park-factor computation, the new job, health check — see the numbered
   list in "Track B progress, 2026-08-22" above for the full remaining
   breakdown and what each depends on.
3. Once Track B is solid, do Track A4 (`modelFit.ts` port) alongside it —
   shares `logistic_regression.py` AND now `db.write_model_weights`
   (built 2026-08-22, verified — reuse directly, don't rebuild).
4. Track C (golf) — fully independent, can be done in parallel by a
   different session/agent if desired.
5. Track D (NFL) stays on hold unless the user explicitly says otherwise.
6. At each track's completion: run `health_check.py`, confirm green,
   THEN ask the user before committing/pushing/deploying — never do
   those three unprompted, established pattern all session.
7. Nothing built 2026-08-22 has been committed yet either — same "verify
   locally first" pattern as everything above it.
