# MLB Play-by-Play Simulation Engine — Plan

Status: **spec only, not yet built**. For approval before any code is written.

Reserved for **game-level markets only** — win probability, run totals. The
Home Run model is a separate, already-live, standalone fitted regression with
no simulation in its prediction path (see
[docs/hr-predictor-plan.md](hr-predictor-plan.md)) — confirmed decision,
not revisited here.

## What the engine is

A per-plate-appearance Markov chain simulator: draw one outcome at a time from a
batter/pitcher-blended probability vector, advance a 24-state base/out machine,
repeat until the game ends, record the full box score, repeat N times, read off
distributions.

## What's already proven, not theoretical anymore

When this doc was first written, steps 2-5 below were design ideas. Building
the Home Run model since then has actually exercised most of the same data
pipeline this engine needs, live, against real MLB data:

- **Per-batter rate data at scale** — `getPeopleWithGameLogs` /
  `getLeagueBatterSeasonRows` ([statsapi.ts](../lib/sports/mlb/statsapi.ts))
  already pull full-season, per-game batter logs for hundreds of players in
  one pass. This is the exact same data step 2's outcome-rate vectors need.
- **Dirichlet-style shrinkage philosophy, proven at the Beta-Binomial scale**
  — `computeModelProbability` / `PRIOR_STRENGTH`
  ([edgeModel.ts](../lib/odds/props/edgeModel.ts)) is live and graded.
- **Park factors, Elo, bullpen ERA** — all three already live, cached,
  refreshed-on-demand data sources (`parkFactors.ts`, `eloModel.ts`,
  `getTeamBullpenEra`), directly reusable for steps 4-5.
- **The venue/gamePk join, team-aggregate opponent-rate pattern** — built and
  shipped for the Home Run model's live pitcher-matchup lookup
  ([homeRunLiveMatchup.ts](../lib/sports/mlb/homeRunLiveMatchup.ts)): a
  `refresh*` function that pulls the expensive aggregate, persists it, and a
  cheap `load*Cache` read for the live path. Step 4's bullpen vector and any
  future per-team pitching aggregate should copy this exact shape, not
  reinvent it.
- **The walk-forward fit + holdout-gated activation infrastructure** —
  `fitLogisticRegression` ([logisticRegression.ts](../lib/core/logisticRegression.ts)),
  `model_weights` (versioned, `train_seasons_json`/`holdout_seasons_json`
  tracked, staleness-checked on `/diagnostics`) — all live, all proven across
  three real markets (moneyline, total, home-run).

None of this replaces steps 1-6 below. It means Phases 2-5's *data plumbing*
is no longer a design risk — it's copy-the-pattern work against infrastructure
that's already been built once and works.

## The pieces, in build order

### 1. Base-out state machine (build first, in isolation)

Standard sabermetric object: 3 outs × 8 base configurations = 24 states. Each PA
outcome maps to a state transition + runs scored.

**v1 (deterministic advancement):**
- K/most outs → +1 out, no runner movement
- BB/HBP → batter to 1st, force runners as needed
- 1B → batter to 1st, runners advance 1 (simplify: runner on 2nd/3rd scores)
- 2B → batter to 2nd, all runners score (simplify)
- 3B / HR → all runners + batter score

**v2 upgrade — probabilistic advancement tables:** replace the deterministic rules
above with league-average (later team/player-specific) advancement probabilities —
e.g. a runner on 1st takes 3rd on a single ~28-30% of the time league-average,
scores from 1st on a double some fraction of the time, etc. This is the single
highest-ROI upgrade over v1: deterministic rules both over- and understate run
environments depending on a team's speed/GB-FB profile, and it plugs into the same
state machine without touching anything else. Layer in without touching steps 2-6.

### 2. Per-batter outcome-rate vector

For each lineup batter: P(BB, K, 1B, 2B, 3B, HR, other-out) from season rate
stats, shrunk toward league average using a Dirichlet-multinomial prior — the
direct multi-outcome generalization of the Beta-Binomial shrinkage already in
[edgeModel.ts](../lib/odds/props/edgeModel.ts) (`PRIOR_STRENGTH`). Rare outcomes
(3B, HR) get a stronger prior, same philosophy as the existing `PRIOR_STRENGTH`
table. Feed Statcast rates ([savant.ts](../lib/sports/mlb/savant.ts)) in as a
stabilizer for small in-season samples, same role it plays today via
`ownStatcastSummary` in [adapter.ts](../lib/sports/mlb/adapter.ts).

**Upgrade — platoon splits:** condition the batter vector (and the pitcher vector
in step 3) on handedness — batter vs. L/R, pitcher vs. L/R — using the same
Dirichlet-shrinkage machinery, just split by platoon side before shrinking.
Lineups shift same-day (a righty masher sits vs. a tough lefty), so this should
read the actual announced/expected lineup (already live — `side.lineup`,
`side.lineupProjected` in [adapter.ts](../lib/sports/mlb/adapter.ts), proven by
the Home Run model's lineup-confidence discount), not a season-blended batter rate.

### 3. Pitcher blending — odds-ratio method

Generalizes `log5()` ([gameModel.ts:50](../lib/sports/mlb/gameModel.ts)) — currently
binary win/loss — to a per-outcome-type blend: for each outcome category, combine
the batter's own rate-vs-league-odds-ratio with the pitcher's own allowed-rate-vs-
league-odds-ratio, multiply, renormalize to a valid probability vector. Same
mathematical family as log5, applied component-wise across 7 categories instead
of once across 2. (Note: this is the same odds-ratio family as
`pitcherMatchupSignal` in [homeRunModel.ts](../lib/sports/mlb/homeRunModel.ts),
just producing a full outcome vector instead of one log-odds scalar.)

**Upgrade — times-through-the-order penalty (TTOP):** starters lose ~0.15-0.30 wOBA
of effectiveness facing a lineup a 3rd time. Since the engine already tracks
innings/PA count per starter for the bullpen handoff trigger (step 4), it's cheap
to condition the pitcher's odds-ratio blend on "which time through the order is
this PA" and degrade the pitcher vector accordingly on the 3rd+ pass.

### 4. Bullpen — start crude, refine later

v1: treat the whole bullpen as one blended outcome vector (extend
`getTeamBullpenEra` in [statsapi.ts:811](../lib/sports/mlb/statsapi.ts), used today
via [modelFit.ts](../lib/sports/mlb/modelFit.ts), to a full outcome vector, not
just ERA — same refresh/cache split as `homeRunLiveMatchup.ts`). Trigger the
starter→bullpen handoff using that starter's own average innings/start (same
signal TTOP uses). This loses reliever-specific accuracy but is fine for
team-run-total and batter-facing props, which don't care which reliever, just
what environment he creates.

**v2 (not a v1 blocker) — per-reliever modeling:** matters most for late-inning
prop markets (opposing team's closer, 8th-inning matchup props), less for game
totals. Build only after the blended-vector version is validated.

### 5. Park factors

Reuse the existing single scalar from
[parkFactors.ts](../lib/sports/mlb/parkFactors.ts) as v1, applied to HR/XBH-relevant
outcomes rather than uniformly to runs.

**v2 (disclosed future refinement, not a blocker):** per-outcome-type park factors
(a park that inflates HR but not walks).

### 6. Aggregation

Per simulated game, record: final score, and every player's full box line
(H/2B/3B/HR/BB/K/R/RBI/TB). After N sims:
- **Game markets:** winProb = mean(win indicator), expectedTotal =
  mean(homeRuns+awayRuns), most-likely score = mode/median of the score-pair
  distribution.
- **Player markets:** out of scope for this engine (see Home Run model note
  above) — a future engine-adjacent player-prop use is not ruled out, but
  isn't planned here.

## How this feeds the game model — not a separate blend, one more feature

`gameModel.ts` doesn't hand-blend signals — it runs a fitted stacking
regression (`fitMoneylineWeights` / `fitTotalWeights` in
[modelFit.ts](../lib/sports/mlb/modelFit.ts)): raw signals go in as named
features (`rawLog5`, `eloProb`, `marketProbCentered`, `parkFactorCentered`,
…), `fitLogisticRegression` learns each one's weight from real history, and
`activated = holdoutBrier < baselineHoldoutBrier` decides whether a new
version goes live. Elo was added this way — it's just one more feature,
neutral-imputed (0.5) when untrusted.

Simulation output plugs in exactly the same way, not as a separate averaging
step:

```
MONEYLINE_FEATURE_NAMES = [rawLog5, venueDiff, formDiff, parkFactorCentered, eloProb, marketProbCentered, simWinProb]
TOTAL_FEATURE_NAMES     = [rawPoissonOverProb, formDiff, parkFactorCentered, eloProb, marketProbCentered, lineMovement, bullpenEraCentered, simOverProb]
```

`fitLogisticRegression` decides `simWinProb`/`simOverProb`'s weight from real
holdout performance — same "let the regression decide, don't hand-pick a
blend ratio" discipline already governing every other feature. If the
simulator is mostly redundant with what log5/Elo/market already capture, the
fit gives it a small weight and nothing breaks. **The feature-standardization
fix already shipped for the Home Run model** (`fitLogisticRegression` now
z-scores every column internally before fitting, then maps weights back to
raw-feature units — see [logisticRegression.ts](../lib/core/logisticRegression.ts))
means `simWinProb` won't hit the scale-mismatch problem the Home Run model's
v1 fit did; this is a real, already-resolved risk, not a hopeful assumption.

`simWinProb`/`simOverProb` gets neutral-imputed (0.5 / the existing raw
formula's own value) for any historical game the simulator hasn't been run
against — same convention every other optional feature already uses.

## Historical backfill — the actual mechanism, not a local script

Earlier planning assumed a standalone local script to avoid "serverless
cost." That assumption turned out to be based on a wrong premise about how
this app runs: it's a persistent local/self-hosted Node process, not
ephemeral serverless functions (confirmed by `data/linesmith.db` being a
plain SQLite file, and by `gamePickLock.ts`'s own design note that the app
"runs only while someone has it open"). There is no execution-time cap to
route around.

**Correction:** the established, now four-times-proven pattern in this
codebase is a `POST` API route that runs the fit/backfill server-side,
triggered manually (or later by a scheduled job), writing straight to SQLite
— `/api/props/fit-weights`, `/api/props/fit-total-weights`,
`/api/props/fit-home-run-weights`, `/api/mlb/refresh-hr-matchup`. The sim
engine's historical backfill (Phase 7 below) should be
`POST /api/props/fit-sim-weights` (or folded into a `simGameEngineFit.ts`
called from the existing fit routes), matching that exact shape — not a
separate script. Same real-money-cost finding as before applies unchanged:
this is local CPU, not metered API spend, regardless of which of the two
mechanisms runs it.

## No real-money cost, either way

Confirmed, still true: simulation is pure local computation against data
already free to pull (MLB Stats API). There's no per-simulation charge the
way there would be for an LLM API call. The only way this could cost real
money is running it on metered cloud compute — which this app doesn't use.

## Sim count strategy

The statistically correct lens for "how many sims" is standard error on a
simulated probability: SE ≈ √(p(1-p)/N).

- **Game-level markets (moneyline, totals):** p is typically near 0.5, so
  N=2,000 already gives SE ≈ 1.1%. Going to N=10,000 barely moves these —
  diminishing returns. Keep these at ~2,000-4,000.
- **External validation, not just theory:** FullCountProps (a live,
  real-money-adjacent MLB projection site) runs the identical architecture —
  per-PA Markov sampling, bullpen handoff, box-line aggregation — at exactly
  **2,000 sims per game**, and a separate, smaller **1,000-sim** pass for
  narrower per-pitcher outing lines. That's independent confirmation this
  plan's original N wasn't undershooting.
- **Practical approach:** don't use one N for everything. Run game-level
  markets at 2,000-4,000; if a future per-market use needs tail precision
  (not currently planned here — player props are out of scope, see above),
  that would need a separately-tuned higher N.
- Actual throughput must still be measured (Phase 8 below) before locking in
  target N — the above is a planning target, not a benchmark result.

## Scheduling — piggyback on the lock-cycle system that already exists

Original planning proposed a bespoke "6am initial read, refresh at official
lineup, freeze at first pitch" scheme. That system **already exists and is
live** — `lib/core/gamePickLock.ts` runs exactly this cycle for
Moneyline/Total today: an initial capture once the day's slate opens
(~6am America/Chicago), a final capture frozen 3 hours before first pitch,
both "due" checks evaluated opportunistically (this app has no real cron —
same limitation noted in the Home Run plan's Phase 8). Once `simWinProb` /
`simOverProb` are wired in as model_weights features, they inherit this
scheduling for free — no new scheduling code needed, just make sure the
simulation runs early enough in the request path that it's ready by the time
`gamePickLock.ts`'s initial capture fires.

## Build phases

| Phase | What | Validates |
|---|---|---|
| 1 | State machine + inning/game loop, league-average rates only, no player data yet | Sanity check: does pure-average simulation reproduce real MLB league averages (~4.3-4.5 runs/team/game, ~54% home win rate)? Isolates plumbing bugs from rate-input bugs. |
| 2 | Real per-batter rate vectors (Dirichlet-shrunk), reusing `getPeopleWithGameLogs`/`getLeagueBatterSeasonRows` | Does swapping a real lineup in shift team runs sensibly (All-Star lineup outscoring replacement-level)? |
| 3 | Starter blending (odds-ratio) | Does a true-ace starter meaningfully suppress the simulated run environment vs. a replacement arm? |
| 4 | Bullpen (single blended vector, refresh/cache split like `homeRunLiveMatchup.ts`) | Do innings 7-9 look different from 1-6 in a sensible direction? |
| 5 | Park factors folded in | Coors Field vs. a pitcher's park produce the expected shift |
| 6 | Wire into the app: `lib/sports/mlb/simEngine.ts`, `simulateGame(context, n=2000)`; add `simWinProb`/`simOverProb` to `MONEYLINE_FEATURE_NAMES`/`TOTAL_FEATURE_NAMES` | Runs alongside the existing formulas; features exist but aren't fit yet |
| 7 | Historical backfill + fit: `POST /api/props/fit-sim-weights` (same shape as the three existing fit routes) — walk-forward, same holdout-guardrail discipline as `modelFit.ts` | Only activates if holdout Brier beats the currently-active moneyline/total version — same gate already governing those two markets |
| 8 | Perf check | Measure actual PA-draws/sec in JS; use the real number to confirm 2,000-4,000/game is genuinely cheap at this app's real slate size (14 games/day) |

## Upgrade backlog (post-v1, ordered by ROI)

1. Probabilistic base advancement (§1 v2)
2. Times-through-the-order penalty (§3 upgrade)
3. Platoon splits, batter and pitcher (§2 upgrade)
4. Per-reliever bullpen modeling (§4 v2)
5. Per-outcome-type park factors (§5 v2)

## What this doesn't replace

Everything from the Signal Score / trust-tier system still sits on top of this
unchanged — `simWinProb`/`simOverProb` become features inside the exact same
fitted moneyline/total models, which already feed the same M/E/P/X formula,
get compared against live book odds the same way, and get the same
BSS-based trust tiering. If anything it needs that safety net more: a
simulator with one stale input rate can be confidently, precisely wrong in a
way a simple trailing-rate model usually can't be — Phase 7's holdout
guardrail is what catches that before it ever goes live.
