# Full prediction-engine Python port — gameplan

Covers every remaining piece of Linesmith's prediction/pick logic that still
runs in TS instead of the Python worker (`python-odds-service/`), audited
directly against the current codebase on 2026-08-22:

**Scope rule for this whole document, per explicit direction**: port what
already exists in TS. Do not invent or build any new prediction model that
doesn't already have a real TS original. Where a track would otherwise
require designing a brand-new model or a brand-new capture mechanism, that
piece is marked **ON HOLD** below rather than planned — future prediction
work that doesn't exist yet will be built directly in Python when it's
actually wanted, not built in TS first and ported later.

1. **Track A — MLB leftovers (Phase Q + Phase H).** Small, bounded, direct
   ports of code that already exists and already has a clear TS original.
2. **Track B — Player-prop predictions.** Medium. A real system exists
   (Beta-Binomial model + a fitted home-run regression); most of its
   low-level math primitives are *already* ported from earlier MLB-engine
   work and just need wiring.
3. **Track C — Golf predictions.** Real models exist for hole-score/
   round-score/tournament-win — ported as direct, faithful copies of what
   TS actually does today, including its existing "compute every poll,
   upsert until graded" capture behavior. No new capture design invented.
4. **Track D — NFL predictions. ON HOLD.** There is **no win-probability
   model of any kind in this codebase today** — NFL only produces
   descriptive stats/grades/ranks, confirmed by direct code audit. Per the
   scope rule above, this isn't ported now. What NFL *does* have (real
   descriptive ranks/grades, real market-line fetching) can still be
   ported as pure data/display parity if wanted — see Track D for exactly
   which pieces are real-and-portable vs. which piece doesn't exist to
   port.

Every track that proceeds ends in the same place: a Python job that
independently computes real predictions/picks and writes them to Postgres,
with a ground-truth health check (matching `health_check.py`'s existing
`eloFreshness`/`gameModelFreshness`/`gamePicksFreshness` pattern) proving it
actually works — not just that it runs.

**One fixed architectural boundary, true for every track below and not
something to "fix" later:** Python is a background worker; it cannot answer
a browser's HTTP request. Next.js will always be the thing a user's browser
actually talks to. "Fully ported" means TS's API routes read Python's
already-computed answer instead of computing it themselves — it does not
mean deleting Next.js's API layer.

---

## Track A — MLB leftovers

### A1. `logGameOddsHistory` (Phase Q)

**TS original**: `lib/odds/gameOddsLog.ts` — `logGameOddsHistory(lines)`.
Called from `app/api/odds/lines/route.ts`'s `GET` on every request (cache
hit or miss). Flattens each `UnifiedGameLine`'s best-available moneyline/
total prices plus every per-bookmaker price into `game_odds_history` rows,
one row per (event, market, side, bookmaker). Write-side dedupes itself —
`lib/db/client.ts`'s `writeGameOddsHistory` only inserts when the latest
row for that (event, market, side, bookmaker) key actually changed price
(log-on-change, not log-every-call).

**Why it matters**: this is the *only* source of `historical_odds`-style
line-movement data for the current season — `getEarliestObservedTotalPoint`
(used by both `odds_lines_cycle.py`'s total-lock path and the live TS
route) reads from this table to compute `lineMovement`. Python currently
only *reads* this table (via `db.get_earliest_observed_total_point`,
already ported); it has never written to it — TS's route is still the sole
writer.

**Port shape**:
- `db.py`: add `write_game_odds_history(rows: list[GameOddsHistoryInput])`,
  a direct port of `writeGameOddsHistory`'s log-on-change upsert (same
  `SELECT ... ORDER BY observed_at DESC LIMIT 1` + conditional `INSERT`
  pattern already used elsewhere in `db.py`).
- `predict/mlb_game_lines.py` (Phase F, already ported — this is where
  `get_mlb_game_lines` already lives, called every 5 minutes by
  `mlbOddsLinesCycleJob`) gains one more step: after fetching lines, call
  the new `write_game_odds_history` the same way `run_mlb_odds_lines_cycle`
  already calls the lock cycles.
- No new external data source — this only restructures data the job
  already has in hand from its own `get_mlb_game_lines` call.

**Health check**: extend `check_game_picks_freshness`-style ground truth —
verify `game_odds_history` has a row observed within the job's own 5-minute
interval whenever `mlb:odds:lines` cache shows lines exist. Cheap to add
alongside the Track A2/A3 checks below rather than as a fourth separate
check.

**TS side once ported**: remove the `logGameOddsHistory` call and its
`try/catch` from `route.ts`'s `GET` (mirrors exactly how Phase P removed
the lock-cycle calls) — but only after this is deployed and confirmed via
the health check, the same gate Phase P used.

### A2. `logTotalPredictionsFromLines` (Phase Q)

**TS original**: `route.ts`'s `logTotalPredictionsFromLines(lines, games)`
— matches each line's posted total against the snapshot's `gameModel` by
team name, computes `computeTotalModel(...)`, and logs one
`GameTotalPrediction` row per matched game via `logGameTotalPredictions`
(`lib/odds/props/pickHistoryLog.ts`) into `pick_history` — calibration
data, distinct from the actual locked pick in `game_picks`.

**Port shape**: this is almost entirely already covered by
`odds_lines_cycle.py`'s existing `run_total_lock_from_lines` — it already
computes the same `compute_total_model(...)` call against the same matched
game for the lock cycle. The only new piece is a second write: after
computing `model.over_prob` there, also call a new
`db.log_game_total_predictions(sport, predictions)` (direct port of
`logGameTotalPredictions`, which itself calls a generic `logSurfaced` —
port that as `db.log_surfaced(entries)`, a straightforward `INSERT OR
IGNORE`-shaped write into `pick_history` matching the schema already used
by Track B below, so this genuinely shares infrastructure with the props
track rather than being one-off).

**Health check**: not a "freshness" check in the elo/game-model sense —
this is calibration logging, not a live-serving path. A simple row-count
sanity check (today's total-lock games all have a matching `pick_history`
row with `dimension='total'`) is enough; doesn't need its own dedicated
health-check function, can be folded into A1's.

### A3. `attachPricesFromLines` (Phase Q)

**TS original**: `route.ts`'s `attachPricesFromLines(lines, games)` —
best-effort: for every already-locked `game_picks` row, finds the matching
market line and calls `attachMoneylinePrice`/`attachTotalPrice` (both
already exist in `lib/db/client.ts`) to fill in the reference price shown
next to an already-decided pick. **Never influences which side is picked**
— purely display enrichment, explicitly the one function Phase P
deliberately left in TS because it had no Python equivalent.

**Port shape**: needs `db.py` ports of `attach_moneyline_price`/
`attach_total_price` (direct SQL ports — check `lib/db/client.ts` for the
exact `UPDATE game_picks SET ..._price = $1 WHERE ..._price IS NULL`
shape, idempotent by construction same as the lock captures), then one
more step appended to `run_mlb_odds_lines_cycle`: after the two lock
passes, loop over the same matched (line, game) pairs and attach whichever
price sides are present. This is the smallest, most mechanical piece in
this whole document — it's a straight reuse of data `odds_lines_cycle.py`
already has in memory during the same job run.

**Health check**: ground-truth check — every `game_picks` row with a
non-null `ml_initial_side`/`total_initial_side` should, within one job
cycle, also have the corresponding `_price` column populated whenever a
matching market line exists. Same shape as A1/A2's check, same function.

**TS side once ported**: remove `attachPricesFromLines` from `route.ts` —
this finally closes Phase P's one deliberately-left gap, making
`mlbOddsLinesCycleJob` the complete replacement for everything `route.ts`
used to do beyond fetching/serving the live lines themselves.

### A4. `modelFit.ts` (Phase H)

**TS original**: `lib/sports/mlb/modelFit.ts` — walks 2010-2025 season
history in one continuous pass (`buildTrainingSet`), building a per-game
feature vector (raw Log5, venue/form edges, park factor, Elo probability,
de-vigged market probability, and a **team-matchup Monte Carlo simulation
result** — `simulateTeamMatchup`, 300 sims/game for training vs. the live
path's 10,000), fits a stacking logistic regression
(`fitMoneylineWeights`/`fitTotalWeights`), and only activates the result if
it beats the current hand-coded formula on a holdout slice of whole
seasons it never trained on (`activated = holdoutBrier < baselineHoldoutBrier`).

**This is the one piece in this entire document where most of the hard
math is already done.** From earlier phases of this engagement,
`python-odds-service/src/predict/` already has:
- `logistic_regression.py` — `fit_logistic_regression`/`predict_prob`/
  `brier_score`, a complete, already-verified port of `core/logisticRegression.ts`.
- `sim_engine.py`, `sim_game.py`, `sim_rates.py` — the full Monte Carlo team-
  matchup simulator (`simulate_team_matchup`, `compute_team_batting_vector`,
  `compute_team_pitching_vector`, `compute_league_outcome_rates`), a
  complete port of the TS sim engine `modelFit.ts` depends on.
- `elo_model.py` — Elo rating/probability functions.
- `statsapi.py` — schedule/season-stats fetching.

**What's actually missing** is the orchestration itself:
- `db.py`: `write_model_weights` (port of `writeModelWeights` — versioned
  insert + "deactivate previous, activate new" transaction) and
  `get_historical_odds(season, game_date, home_id, away_id)` (port of
  `getHistoricalOdds`, a plain read against `historical_odds`). Both are
  direct SQL ports of existing TS functions, no new design.
- A new `predict/model_fit.py`: port `buildTrainingSet`'s walk-forward loop
  (chronological, single-pass Elo carry-forward with season-boundary
  regression-to-mean — the exact same discipline `eloModel.ts`'s own
  backfill already uses and `elo_model.py` should already have this logic
  available to reuse) and the two `fit*Weights` entry points, wired to the
  already-ported sim/logistic-regression/Elo primitives above.
- **Real gap, not yet portable**: `historical_odds` (2010-2020 SBR
  spreadsheets, 2021-2025 multi-book CSV) is populated by
  `historicalOddsIngest.ts`, a one-time static-file ingestion script, not
  an ongoing job. This can stay a TS admin script (same carve-out CLAUDE.md
  already gives backfill/ingest routes) — Python's `model_fit.py` just
  needs read access to the table it produces, not to re-run the ingestion
  itself.

**No scheduled job needed** — `modelFit.ts` is triggered manually via
`/api/props/fit-weights`/`/api/props/fit-total-weights` (admin routes,
already exempt from the caching-pattern requirement per CLAUDE.md), not a
snapshot-rebuild dependency. Port as a callable Python function + a small
admin script/route in the Python worker (or keep it TS-callable but reading
the now-Python-owned Elo/sim state) — this is the one piece in this
document worth a direct question to you: keep the *trigger* in TS
(`/api/props/fit-weights` calling into Python via a one-shot subprocess/RPC)
or move the trigger to Python too (a Python-side admin script you run
directly, `python -m predict.model_fit --train 2010-2024 --holdout 2025`)?
Recommend the latter — it's a training run, not a page load, so it doesn't
need to go through Next.js at all.

---

## Track B — Player-prop predictions

### What exists today (TS)

Two genuinely different systems, both feeding `pick_history`:

1. **Beta-Binomial Bayesian posterior** (`lib/odds/props/edgeModel.ts`) —
   used for 16 of 17 prop dimensions (total-bases, home-runs, RBIs, runs,
   walks, batter/pitcher strikeouts, doubles, triples, singles,
   stolen-bases, hits-runs-RBIs, earned-runs, pitcher-outs,
   pitcher-hits/walks-allowed, hit-in-game). Closed-form conjugate update:
   prior mean = league base rate for that dimension (read live from
   `pick_history` via `leagueBaseRates()`), prior strength = a hand-set
   per-dimension "pseudo-games" count (`PRIOR_STRENGTH`, e.g. 50 for
   home-runs), updated with the player's real over/total counts (recent
   L10 games weighted 1.5×). Two dimensions — `vs-LHP`/`vs-RHP` splits and
   first-inning props — are pure history/trend, no model probability at
   all, and are explicitly excluded from grading.
2. **Fitted home-run regression** (`lib/sports/mlb/homeRunModel.ts` +
   `homeRunModelFit.ts`) — a second-stage stacking model on top of #1:
   features are `[betaBinomialHrProb, parkHrFactorCentered,
   pitcherMatchupSignal, expectedPaCentered]`, fit with the exact same
   `fitLogisticRegression`/walk-forward-holdout-gate pattern as
   `modelFit.ts` (Track A4) — confirmed by the file's own header comment
   as a deliberate structural clone. **This reuses the same
   `logistic_regression.py` primitives Track A4 needs**, so building A4
   and B's home-run piece together is more efficient than either alone.

**Capture pattern — genuinely different from `game_pick_lock.py`, and this
matters for the port**: there is no scheduled 6am/T-minus-3-hours window
for props. `pick_history` has a `UNIQUE (sport, subject_id, dimension,
category, game_id)` constraint with an `INSERT OR IGNORE` write
(`logSnapshotCandidates`, called on every snapshot refresh — every few
minutes) — whichever refresh cycle is the *first* to surface a given
(player, market, game) tuple that day locks in `model_prob` forever, no
re-affirmation closer to game time. This "first-surfaced-wins" pattern is
simpler than `game_pick_lock.py`'s two-slot capture and is what A2 above
already needs (`log_surfaced`/`log_game_total_predictions`) — Track B
should share that same `db.log_surfaced` function rather than duplicating
the `INSERT OR IGNORE` logic a second time.

### Port shape

**Data dependencies not yet in Python** (the real scope driver — the
*models* are comparatively small once these exist):
- MLB StatsAPI batter/pitcher **game logs** (`statsapi.ts`'s
  `getLeagueBatterSeasonRows`/`getPeopleWithGameLogs`) — `predict/statsapi.py`
  already has season-stats/standings/handedness (Phase K) but not the
  per-game batting-log rows the Beta-Binomial model counts over/total
  against. This is the single largest missing piece.
- **Baseball Savant/Statcast scrape** (`savant.ts`) — whiff%/barrel%/exit
  velo/hard-hit%, a public unauthenticated CSV endpoint
  (`baseballsavant.mlb.com/statcast_search/csv`). No Python module exists
  for this yet; new `predict/savant.py`.
- **Park factors** — already partially there (`db.read_park_factors`
  exists, per Track A4's audit); the *computation* itself
  (`computeParkFactors`, from schedule data alone) needs porting too if
  Python is to refresh this table itself rather than only reading what TS
  last wrote.
- **Team HR-rate-allowed** (`homeRunLiveMatchup.ts`) — same StatsAPI
  game-log dependency as above, one more derived cache table.
- **Batter/pitcher composite rankings** (`batterRankings.ts`/
  `pitcherRankings.ts`) — used for display and the `matchupFavorable`
  signal that shifts the Beta-Binomial prior; straightforward percentile
  math once the underlying Statcast/game-log data is in Python.

**Build order** (each step unlocks the next; no step is blocked on a track
outside this list):
1. `predict/statsapi.py`: add batter/pitcher game-log fetching.
2. `predict/savant.py`: new Statcast scraper.
3. `predict/edge_model.py`: port the Beta-Binomial posterior — pure
   function, no I/O, direct port of `edgeModel.ts` once #1/#2 exist.
4. `db.py`: `log_surfaced`/`log_game_total_predictions` (shared with Track
   A2), `leagueBaseRates` equivalent (a live SQL aggregate over
   `pick_history`, already Postgres-resident — trivial port).
5. `predict/home_run_model.py` + a `home_run_model_fit.py` alongside Track
   A4's `model_fit.py` — reuses `logistic_regression.py` directly, same
   walk-forward-holdout-gate shape.
6. A new job (`jobs.py`: `job_compute_mlb_prop_predictions`, mirroring
   `computeMlbGameModelJob`'s cache-first shape) that computes candidate
   probabilities for the day's slate and calls `log_surfaced` —
   analogous to how `computeMlbGameModelJob` populates
   `mlb_game_model_cache` for the game-level pick-lock cycle to consume.

**Health check**: ground truth against real `pick_history` rows — for
today's real slate (already fetched via `build_slate_game_inputs`, Track A
already has this), verify every scanned player/dimension combination that
should have surfaced today actually has a `pick_history` row with a
non-null `model_prob`. Same shape as `check_game_picks_freshness`.

**TS side once ported**: `adapter.ts`'s prop-candidate builders
(`hitInGameCandidates`, `statMarketCandidates`) become cache-first reads
against Python's output, same pattern as Phase O's `gameModelAndEloFor` —
live-compute fallback preserved, not deleted, exactly like the MLB
game-model cutover.

---

## Track C — Golf predictions

### What exists today (TS)

Real models exist and are directly portable:
- **Hole-score model** (`lib/sports/golf/models/holeScoreModel.ts`,
  `predictHoleScore`) — birdie/par/bogey probability per hole, blends a
  hand-picked prior (`PRIOR_BY_PAR`) against the field's own observed
  history plus a season Strokes-Gained:Total signal.
- **Round-score model** (`roundScoreModel.ts`, `predictRoundScore`) —
  under/even/over-par probability per round, same shape, plus a wind
  adjustment from Open-Meteo.
- **Tournament-win model** (`tournamentWinModel.ts`, `predictTournament`)
  — Monte Carlo simulation (3,000 iterations), produces `probWin`/
  `probTop5`/`probTop10`/`probMadeCut`. **No `top3` market exists anywhere
  in the codebase today** — if that's part of the target scope (an earlier
  project note mentioned "top3/5/10"), it's new modeling work, not a port
  of something that already exists.

All three are explicitly disclosed in their own file headers as
**hand-picked-prior placeholders, never fitted** — there is no
`golfModelFit.ts`/Phase-B-equivalent anywhere. Porting these to Python
means porting the same placeholder math, not a proven model — a real
fitting pass (mirroring Track A4/B's pattern once golf has a season of
graded history) would be a natural follow-up once this port is live and
accumulating real graded predictions.

**No rating system** — golf has no Elo equivalent. The closest signal
(season Strokes-Gained:Total) is scraped live from PGA Tour's site every
poll, never persisted as an evolving rating. Nothing to port here beyond
the live scrape itself (§Port shape, step 2) — there is no rating-update
formula in TS to carry over.

**No pick-lock system in TS today — so none gets built in this port
either, per the scope rule.** `golf_model_predictions`/
`golf_tournament_predictions` are upserted on *every* snapshot poll (every
few minutes) with `WHERE graded_at IS NULL` as the only guard — whatever
the model computed on the last poll before real data landed is what gets
graded. That's a real, faithfully-portable behavior (unlike NFL's Track D,
golf's capture logic *does* exist, it's just simpler/weaker than MLB's) —
Python's version reproduces this exact poll-and-upsert-until-graded
pattern, not a new scheduled-lock design. A better capture mechanism
(e.g. a real tee-time-based lock) is future work, to be built directly in
Python if and when it's wanted — not part of this port.

### Port shape

**Zero golf presence in Python today** — confirmed nothing under
`python-odds-service/` references golf at all. Everything below is new:

1. `predict/golf_espn.py` — port `espn.ts`'s two ESPN feed fetches
   (leaderboard, per-hole scores) and `schedule.py`'s season-schedule fetch.
2. `predict/golf_pgatour_stats.py` — port `pgatourStats.ts`'s
   Strokes-Gained scrape (same `__NEXT_DATA__` JSON-scrape technique).
3. `predict/golf_models.py` — direct math port of `holeScoreModel.ts`/
   `roundScoreModel.ts`/`tournamentWinModel.ts` (pure functions, no I/O,
   the easiest part of this whole track).
4. `golf_hole_scores`/`golf_round_scores`/`golf_tournament_results`
   (already exist as Postgres tables, currently written only by TS's
   `historyIngest.ts`) get a Python writer too —
   `predict/golf_history.py`, direct port of `ingestGolfHistory`.
   `golf_model_predictions`/`golf_tournament_predictions` (also already
   exist) get the same `WHERE graded_at IS NULL`-guarded upsert Python
   writer, direct port of `adapter.ts`'s existing insert calls — no new
   table needed.
5. `predict/golf_grading.py` — direct port of `grading.ts`'s
   `gradeGolfHoleRoundPredictions`/`gradeGolfTournamentPredictions`,
   unchanged logic.
6. `jobs.py`: a new `job_golf_predictions` that reproduces exactly what
   `adapter.ts`'s inline block does today (compute models → log
   predictions → ingest history → grade), just moved from "inside every
   live page request" to a regular scheduled interval — this alone is a
   real improvement (today's live page pays for all of this on every
   poll) without changing what gets computed or when a pick is considered
   final.

**Health check**: ground truth — for today's real field (from the ESPN
leaderboard), verify every active golfer has a current, ungraded-or-graded
`golf_model_predictions`/`golf_tournament_predictions` row (mirrors what
TS's own upsert-every-poll behavior already guarantees, just verifying
Python's job is doing the same), plus a sanity check that
`probWin`/`probTop5`/`probTop10`/`probMadeCut` behave sanely (a
correctness check beyond mere presence, since golf has no analog to MLB's
"does this game exist in the real schedule" ground truth once the field is
this variable-sized).

**TS side once ported**: `adapter.ts`'s inline "Phase A prediction models"
block (lines 539-684 — the block that currently computes models,
logs, ingests history, and grades all inside the live snapshot-serving
request) gets replaced with a cache-first read against Python's output,
the single biggest live-request latency win in this whole document, since
today this expensive work happens on **every poll of the live page**, not
on a schedule.

---

## Track D — NFL predictions

### What exists today (TS) — and what doesn't

**No win-probability model exists anywhere in this codebase for NFL.**
Confirmed by the code's own disclosure (`adapter.ts`'s header comment: "no
Elo/park-factor equivalent exists for NFL yet") and by an exhaustive grep
for `winProb`/`spreadEdge`/`elo`/`moneylinePick` across `lib/sports/nfl/`
returning zero matches. What NFL has instead:
- **Descriptive team grades** (`nflTeamGrades.ts`) — season-to-date
  percentile composites (Offense/Defense/Special-Teams/etc.), letter
  grades, recomputed from scratch each time, never an incrementally
  updating rating.
- **Descriptive player rankings** (`nflPlayerRankings.ts`) — same
  percentile-composite pattern, position-pooled.
- **Real market lines** (`nflGameLines.ts` — SharpAPI + TheRundown
  merge) — pass-through only, no model laid over it.
- **Team-level trend "candidates"** (`teamFormCandidates.ts`) — real
  win/loss and scoring history rendered in the same `PickCandidate` shape
  MLB uses, but with a fixed line (0.5, or a 15-game rolling average) and
  **no probability computed, no side picked**.

`lib/core/gamePickLock.ts` (and its Python port, `game_pick_lock.py`) is
already sport-generic — `run_moneyline_lock_cycle(sport, ...)` etc. take a
`sport` string and could run for `"nfl"` today with zero changes to that
file. But nothing calls it for NFL, and — the real blocker — its input
types *require* a `home_win_prob`/`over_prob` field that nothing in this
codebase currently produces for NFL. Wiring NFL into the lock-cycle system
is the *last* step, not the first; there is no probability to lock until
one exists.

### Status: ON HOLD — no existing model to port

Per the scope rule at the top of this document, Track D's win-probability
model, its capture/lock wiring, and everything downstream of "a real
probability exists" are **not planned here**. There is nothing in TS to
port for any of that — building it now would mean designing a brand-new
model, which is explicitly out of scope for this pass. When NFL prediction
becomes an actual priority, it gets built directly in Python from day one
(reusing `probability_blend.py` and the already-generic
`game_pick_lock.py`, both ready and waiting), never staged through a TS
version first.

### What NFL data-pipeline work is real, portable parity (not model-building)

Two pieces exist in TS today and are pure data/display parity — no
prediction, no new design, just moving existing computation to Python:

1. **nflverse ingestion** — TS currently fetches and caches nflverse's
   CSVs (schedule, player/team weekly and season stats) as opaque JSON
   blobs in `snapshot_cache` rather than structured Postgres rows. Porting
   the fetch/parse itself (`predict/nflverse.py`, direct port of
   `nflverse.ts`) is a straight data-pipeline move, the same category of
   work as Track A1's odds-history port — not model-building.
2. **Descriptive ranks/grades** — `nflPlayerRankings.ts`/
   `nflTeamGrades.ts`'s percentile-composite math (letter grades, position
   ranks) is real, already-built, deterministic computation with no
   probability or pick involved. Porting it (`predict/nfl_rankings.py`/
   `nfl_team_grades.py`) is a direct math port, same shape as Track B's
   `batterRankings.ts` port.

Neither of these unlocks `game_picks` captures or a `hero.model` value —
they're display/ranking parity only. Whether either is worth doing now,
given neither is blocking anything else in this document, is your call —
flagging them separately from the "on hold" model work since they're a
genuinely different kind of task (data pipeline, not prediction).

---

## Sequencing

No track blocks another — they touch disjoint code and disjoint tables.
Suggested order, driven by dependency depth and how much is already
reusable, not by estimated effort:

```
Track A (A1, A2, A3 in any order, A4 last — needs db.py additions A1-A3
         don't) — closes the one deliberate gap Phase P left open.

Track B — shares db.log_surfaced with A2; sequencing B after A2 avoids
          building that function twice.

Track C — fully independent of A/B; a direct, faithful port with no open
          design questions.

Track D — ON HOLD (model work). The two data-pipeline pieces (nflverse
          ingestion, descriptive ranks/grades) are independent and can run
          anytime if wanted, but unlock nothing else in this document.
```

Everything in Tracks A/B/C, and the two optional Track D data-pipeline
pieces, is a direct, unambiguous port of code that already exists — no
open design decisions remain. Say the word on which to start.
