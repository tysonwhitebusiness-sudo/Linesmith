# MLB Home Run Predictor — Plan

Status: **spec only, not yet built**. For approval before any code is written.

Separate from [docs/mlb-sim-engine-plan.md](mlb-sim-engine-plan.md) — no
simulation anywhere in this model's prediction path. Simulation is reserved
for game-level markets (win probability, totals); this model is a standalone
fitted regression, always a plain formula at prediction time.

## Scope: four independently-tracked models

Building this gives the app four separately graded models, not one blended
system:

1. **Moneyline** — live today (`gameModel.ts` + `modelFit.ts`, `market = 'moneyline'`)
2. **Totals** — live today (same files, `market = 'total'`)
3. **Home Run** — this plan
4. **Player Prop** (everything else — hits, strikeouts, walks, doubles,
   triples, stolen bases) — stays on the existing shared Beta-Binomial
   pipeline in `edgeModel.ts`, unaffected by this plan

The Home Run model needs to be genuinely standalone — not a formula folded
into the shared props pipeline — because it's getting its own dedicated daily
page (Blast-Board-style) with its own rolling accuracy history.

## What's live today, and what this adds

[edgeModel.ts](../lib/odds/props/edgeModel.ts) already runs a Beta-Binomial
posterior for the `home-runs` dimension: `PRIOR_STRENGTH['home-runs'] = 50`
(line 45), prior centered on the real league base rate
(`leagueBaseRates('mlb')`, [adapter.ts:1706](../lib/sports/mlb/adapter.ts)),
shrunk against the batter's own trailing HR rate, nudged by a `barrelPct`
matchup shift ([adapter.ts:934](../lib/sports/mlb/adapter.ts)). That's a real,
functioning model already in production — this plan extends it, not replaces
it from zero.

What it's missing, identified from the FullCountProps research: no park
factor, no explicit pitcher-vs-batter matchup blend (`barrelPct` is a
batter-only quality-of-contact proxy, not a batter-vs-*this*-pitcher
comparison), and no lineup-order/expected-PA term. This plan adds those three
signals and validates the result against the existing Beta-Binomial baseline —
only ships if it demonstrably wins on data it never trained on.

## How the new signals combine: fitted, not hand-multiplied

The first draft of this plan combined the four signals as a hand-multiplied
formula (`marcel_rate × park × matchup × PA`). Rejected in favor of a fitted
stacking regression — same shape as
[`fitMoneylineWeights`](../lib/sports/mlb/modelFit.ts:359) /
`fitTotalWeights`, reusing the same `fitLogisticRegression` function that
already powers those two markets:

```
features = [beta_binomial_hr_prob,      # existing baseline — dominant raw signal
            park_hr_factor_centered,     # NEW
            pitcher_matchup_signal,      # NEW
            expected_PA_centered]        # NEW
```

Each historical training row is one batter's plate appearances in one real
past game: the four feature values as they were knowable *before* that game
(no lookahead), plus the actual outcome (HR: yes/no). `fitLogisticRegression`
finds the intercept and per-feature weight that best predict real outcomes
across every row — the same maximum-likelihood fit already running for
Moneyline/Totals, just a different training set and feature list. A feature
that turns out to be mostly redundant (say, matchup signal adds little once
park and the baseline are known) gets a weight near zero automatically — the
fit decides, nobody has to notice and hand-adjust it.

Lineup-confidence (official vs. projected lineup) is a **discrete discount
applied to the final probability**, not a fitted feature — same role as
FullCountProps' ×0.9 example for a projected-but-unconfirmed batter.

## Standalone tracking — the actual mechanism

Moneyline and Totals are standalone models today because of
[`model_weights`](../lib/db/schema.ts:370): a table keyed on
`(sport, market, version)`, storing each version's train/holdout Brier,
whether it beat the baseline, and whether it's active. `market` is currently
`'moneyline' | 'total'`. Adding `'home-run'` as a third value gets this model
the same tracking for free — its own version history, its own Brier per
version, its own activation flag, never blended with the other three models.

**Schema gap this surfaces:** `pick_history` ([schema.ts:49](../lib/db/schema.ts))
has no `model_version` column — a graded pick can't currently say which
`model_weights` version produced it. Needed to report "here's `home-run-v2`'s
rolling Brier, never blended with v1's," the same discipline FullCountProps
uses. Small addition (stamp `model_version` at surface time from whichever
`model_weights` row was active), and it benefits Moneyline/Totals grading the
same way — neither stamps this today either.

## Components

| # | Signal | Status | Notes |
|---|---|---|---|
| 1 | `beta_binomial_hr_prob` | Existing, reused as-is | The current live baseline; becomes the dominant feature, not replaced |
| 2 | `park_hr_factor_centered` | New | Reuses [parkFactors.ts](../lib/sports/mlb/parkFactors.ts) directly — no new data source, just wire it in as a feature |
| 3 | `pitcher_matchup_signal` | New | Odds-ratio blend (same family as `log5()`, [gameModel.ts:50](../lib/sports/mlb/gameModel.ts)) of pitcher's HR/9-or-hard-hit-rate-allowed vs. league average, combined with batter's platoon split vs. that pitcher's hand |
| 4 | `expected_PA_centered` | New | Batting-slot → expected PAs/game (leadoff ≈ 4.6, 9-hole ≈ 3.6); this is the "Lineup Order" input confirmed on FullCountProps' Blast Board |
| 5 | Lineup-confidence discount | New, not a fitted feature | Multiplies the final probability by P(this projected batter actually starts) until the lineup goes official, then turns off |

## Data inputs needed

- **Batter:** existing trailing HR-rate data already feeding the
  Beta-Binomial (no new source), handedness/platoon splits, today's batting
  order slot.
- **Pitcher:** season HR/9 or hard-hit-rate allowed, throwing hand.
- **Park:** existing `parkFactors.ts` HR factor (no new source).
- **Lineup status:** official vs. projected, plus a start-probability estimate
  for projected slots — open question #2 below on where this comes from.

## Where it plugs into the existing app

- **Prediction display** (props page, Prop Score, live-edge comparison): the
  active `home-run` model's output populates `candidate.subjectMeta.modelProb`
  / `leagueRate` / `modelSampleSize` — exactly what
  [propScore.ts](../lib/odds/props/propScore.ts)'s `M` component already
  expects. No new rendering pipeline needed there.
- **Daily rankings — new Scan tab, not a separate page.** Scan already has a
  row of underline tabs for exactly this kind of ranked view:
  `SCAN_VIEWS = ['Good Bets', 'All', 'Coming up', 'Watchlist']`
  ([AppShell.tsx:67](../components/AppShell.tsx)), each backed by one named
  list in the `views` `useMemo`
  ([AppShell.tsx:310](../components/AppShell.tsx)) and rendered through the
  same `renderList`/`ScanTable` machinery. Add a fifth entry — e.g.
  `'Home Runs'` — backed by a new `views.homeRuns`: candidates filtered to
  `dimension === 'home-runs'`, sorted descending by the standalone model's
  `modelProb`. No new table component, no new route — same pattern Good
  Bets/Watchlist already use, just one more filter+sort added to the existing
  `views` object and one more label in `SCAN_VIEWS`.
- **Standalone performance tracking** (accuracy history, separate from the
  ranked list above): reads `model_weights` where `market = 'home-run'` for
  version/Brier history, and `pick_history` filtered to
  `dimension = 'home-runs'` (plus the new `model_version` column) for graded
  picks — same pattern already used to grade Moneyline/Totals.

## Explicitly not doing

- Not using either rejected GitHub repo's post-contact features (launch
  speed/angle, hit distance, delta-run-exp) — confirmed data leakage, ruled
  out earlier in this project's research.
- Not folding in the `homeruns-main` breakout-score model as this model's core
  signal — it predicts season-level HR/BBE *trajectory*, not a per-game
  probability. Candidate for a later nudge to the baseline for players whose
  underlying swing/contact process is trending; not required for v1.
- No simulation anywhere in the prediction path.

## Validation

- Walk-forward backtest, same discipline as `modelFit.ts`: fit on earlier
  seasons, grade on a holdout slice the model never trained on.
- **Must beat the current live Beta-Binomial + barrelPct baseline** on that
  holdout — same `activated = holdoutBrier < baselineHoldoutBrier` gate
  already governing Moneyline/Totals. Adding three new signals that don't
  actually improve holdout Brier is a regression, not a v2, and stays
  inactive.
- External sanity check, not a target to copy: FullCountProps' live `prop-v3`
  HR Brier is 0.097 (predicted 11.3% vs. actual 10.5%, N=1,820). If holdout
  Brier lands meaningfully worse than that, something's wrong before this
  ships.

## Build phases

| Phase | What | Validates |
|---|---|---|
| 1 | Add `pick_history.model_version` column; add `'home-run'` as a valid `model_weights.market` value | Schema ready for standalone tracking, no behavior change yet |
| 2 | Build the three new feature calculators (park factor as a feature, pitcher matchup signal, expected-PA from lineup slot) as pure functions, unit-testable against known inputs | Each signal computes a sane number in isolation before touching real games |
| 3 | Build the historical training-row builder (one row per real past batter-game, features + actual HR outcome, no lookahead) — likely the same local-script pattern as the sim engine's historical backfill, not a deployed route | Row count and feature distributions look sane against a known season |
| 4 | `fitHomeRunWeights(trainSeasons, holdoutSeasons)` — walk-forward fit + holdout Brier vs. baseline, mirroring `fitMoneylineWeights` | Holdout Brier is computed and comparable to the current live baseline |
| 5 | Activation gate: only write `active = true` if holdout Brier beats baseline | Matches Moneyline/Totals' existing promotion discipline exactly |
| 6 | Wire the active version into live prediction (`candidate.subjectMeta.modelProb`) and lineup-confidence discount | Props page shows HR probabilities from the new model, existing Prop Score UI unaffected |
| 7 | Add `'Home Runs'` to Scan's `SCAN_VIEWS` underline tabs + `views.homeRuns` (dimension filter + sort by `modelProb`); separately, an accuracy view reading `model_weights` + `pick_history` for the standalone Brier/calibration history | Daily rankings appear as a Scan tab using existing table machinery; accuracy tracked isolated from other models |
| 8 | Daily live run scheduling — early pass (~6am, projected lineups + start-risk discount) → per-game refresh at official lineup post → freeze at first pitch | Matches the freeze-and-grade discipline already used elsewhere in this project's plans |

## Open questions before building

1. **Keep Beta-Binomial base rate, or move to Marcel-style 3-season
   weighting?** Recommend: keep Beta-Binomial (it's live, tested, the rest of
   the app depends on its shape) but check `PRIOR_STRENGTH['home-runs'] = 50`
   against Russell Carleton's published HR stabilization-point research
   rather than leaving it a pure guess.
2. **Where does projected/official lineup data come from?** Does the app
   already ingest MLB probable lineups anywhere, or does the projection
   heuristic (recent starts vs. same-handed pitching) need to be built new?
3. **Pitcher HR/9 vs. hard-hit-rate-allowed** as the matchup input — HR/9 is
   noisier (small per-season sample of actual HRs allowed) but simpler;
   hard-hit-rate is more stable but one step removed from the outcome.
4. **Confirm the `pick_history.model_version` schema addition** — prerequisite
   for standalone per-version accuracy reporting on all three fitted models,
   not just this one.
