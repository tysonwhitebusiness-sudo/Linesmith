# MLB market-centric model gameplan (2026-08-27)

## Why this doc exists

Research (the user's own) plus an earlier comparison against a reference tool ("quant-predictor") both point the same direction: betting markets — sharp books' closing lines specifically — aggregate more real information (injuries, weather, sharp and public money) than a model built from public box-score data alone, and academic work on Closing Line Value (CLV) consistently finds it's extremely hard to beat with an outcome-prediction model. quant-predictor's own strongest validation wasn't "does the model predict outcomes accurately" — it was a paired comparison against Pinnacle's closing line, plus a CLV backtest: does the model's edge at the time of a pick predict real market movement toward that side by close. That's edge-detection thinking, not outcome-prediction thinking, and this app's current architecture is the latter with a market blend bolted on, not the former.

This conversation was interrupted mid-plan by the odds-system-is-broken discovery (a real, separate emergency: the Python worker had been dead 4 days). The odds system is now fixed and verified. This doc is the actual, honest gameplan for the market-centric pivot, grounded in what's really in the codebase and the real database — not a redo of what was said before, since that was never fully written down.

## Current state, audited (not assumed)

**The model ensemble** (`python-odds-service/src/predict/`): `elo_model.py`, `mlb_bradley_terry.py`, `mlb_mlp.py`, `mlb_stacking.py`, `mlb_tree_models.py` feed `mlb_model_candidates.py`, fit and validated via `walkforward.py` — a real, working, sport-agnostic expanding-window CV harness. Its scoring is **entirely outcome-based**: `log_loss`/`brier_score` against real graded results (`predict/logistic_regression.py`'s `PredictionRecord`/`brier_score`). No CLV scoring exists anywhere in it today — confirmed by reading the file, not inferred.

**The market blend** (`predict/probability_blend.py`): the calibrated model probability is blended 50% with the devigged market-implied probability (`MARKET_BLEND_WEIGHT = 0.5`), then blended again with Elo at 20% (`ELO_BLEND_WEIGHT = 0.2`) — sequential composition, market first, Elo as a smaller nudge after. Both weights are explicitly disclosed in the file's own docstring as **placeholders, never fit against real outcomes** — "a real fitting pass replaces the guessing with weights learned from real graded outcomes" is written directly in the code, unresolved.

**What does NOT exist today, confirmed by reading the actual files** (not guessed from names): `edge_model.py` is Beta-Binomial prop hit-rate estimation (props, not game lines, and not market-relative). `market_trust.py` is a real, working Brier-Skill-Score-vs-naive-baseline trust tier for prop *markets* — a good template for how to validate a NEW signal for real, but it scores outcome accuracy, not CLV. `good_bets.py` is a prop performance-tier filter. None of these are a market-deviation model or a CLV backtest. That architecture has never been built.

## Real data available right now (queried live, 2026-08-27)

- `game_picks` (MLB): **144 rows**, spanning 2026-08-12 to 2026-08-26. **113 already graded** (real win/loss known). **102 have both `ml_initial_price` and `ml_final_price` captured** — an open/close-shaped pair already exists per pick, today, without building anything new.
- `game_odds_history`: **18,453 rows**, spanning 2026-08-12 to now — a genuinely deep, granular price-observation log (predates this week's odds rebuild; this has been running via `mlbOddsLinesCycleJob` for two weeks). This is a richer source for reconstructing a true closing price than `game_picks`' two fixed snapshots (6am CT initial, ~3hr-before-first-pitch final) — those two windows are proxies for open/close, not necessarily the real thing.
- `game_odds_book_lines` (the new multi-book grid table from this week's rebuild): only 2 days deep (since 2026-08-25), 1,931 rows, 3 sources. Real, but too young alone for a backtest — use `game_odds_history` for anything retrospective.
- **Pinnacle coverage confirmed live**: 84 rows in `game_odds_book_lines` tagged `bookmaker='pinnacle'`, sourced via OddsHarvester. Pinnacle is the standard sharp-book reference for CLV work in the research this is based on — it's actually present, not something to go acquire.

The honest caveat: 113 graded picks is a real but small sample for a backtest. Early results should be read as "does this look directionally right," not "is this statistically proven" — that bar needs more games, which accrue automatically as the season continues.

## Target architecture

Reframe the objective. Today: predict P(win) from the model ensemble → blend toward market → compare final probability to market price to size a Kelly bet. Target: **the market-implied probability (from the sharpest available book, Pinnacle preferred) is the anchor**, and the model's real job is predicting a genuine, validated **deviation from that anchor** — a signal that should predict the line moving toward the picked side by close, not just a signal that happens to agree with the eventual winner.

This doesn't necessarily throw away the existing Elo/Bradley-Terry/MLP/stacking ensemble — those can still generate the deviation *signal*. What changes is (a) what the signal is validated against, and (b) how much of the final number the market anchor controls vs. a fit (not guessed) blend weight.

## Phased plan

**Phase 0 — Baseline audit, before changing any model code.** Build a CLV backtest using what already exists: for the 102 `game_picks` rows with both `ml_initial_price` and `ml_final_price`, compute realized CLV per pick (did the price move toward the picked side between initial and final capture?) and aggregate. This answers a question nobody's actually asked yet: does the *current* architecture already have positive CLV by accident, or negative? You can't measure whether a change helped without this number first.

**Phase 1 — Real open/close reconstruction.** Evaluate whether `game_picks`' two fixed snapshots (6am CT / ~3hr-before-first-pitch) are good enough open/close proxies, or whether `game_odds_history`'s much denser 18,453-row log should be used instead to find the actual closing price per game per book (ideally Pinnacle specifically, using the confirmed-live 84 Pinnacle rows as a starting point, extended backward through `game_odds_history` once whichever source logged Pinnacle prices historically is identified). This is a real investigation, not an assumption either way.

**Phase 2 — Build the CLV backtest as a real, reusable tool.** A new module (`predict/clv_backtest.py` or similar) — given a set of (pick side, pick price, pick timestamp, closing price) tuples, computes CLV in both cents and probability terms, matching quant-predictor's own paired-comparison-vs-Pinnacle-close methodology from the earlier research. This is the tool Phase 0 uses, formalized and kept for every future model change to be checked against — not a one-off script.

**Phase 3 — Reframe the model's training target.** This is the real architectural change: instead of (or alongside) fitting the ensemble against `log_loss`/`brier_score` on outcomes (what `walkforward.py` does today), fit a signal against whether it predicted subsequent line movement — a different training-data shape (features → did the market move our way, not features → who won). `walkforward.py` is sport-agnostic and callback-driven by design (its own docstring: "no baseball, no sport-specific anything") — the expanding-window fold structure it already has is real, reusable infrastructure; what's missing is a CLV-scoring callback to pass into it alongside (not necessarily instead of) the existing log-loss one.

**Phase 4 — Replace the guessed blend weights with fit ones.** Once Phase 2's tool exists, `MARKET_BLEND_WEIGHT`/`ELO_BLEND_WEIGHT` (`probability_blend.py`) stop being hand-set placeholders — fit them against real graded outcomes AND real CLV, the same way `walkforward.py` already fits everything else. Whether the end state is "a fit blend weight" or "the deviation model's output replaces the blend entirely" is a real decision to make once Phase 3's signal is actually built and its CLV-backtest results are in — not decided in advance here.

**Phase 5 — Re-validate against the Phase 0 baseline.** Confirm a real, measured CLV improvement — not just improved log-loss/Brier, which is a different objective and can move in the opposite direction from CLV.

**Phase 6 — Generalize the pattern, not the code, to other sports.** Once this is proven on MLB, the *template* other sports inherit is: market-as-anchor, CLV-validated deviation signal, `walkforward.py`'s existing fold harness reused with a CLV scoring callback — not MLB's specific Elo/Bradley-Terry/MLP ensemble verbatim, since other sports' real statistical shape differs (this is also why the earlier handoff doc's framing — "MLB is the finished reference to copy" — was wrong; the *validation methodology* is the reusable part, not MLB's specific model files).

## What this doc replaces

`docs/model-building-handoff-2026-08-27.md`'s "What's genuinely next" section described MLB's current architecture as a finished template to replicate for other sports. That was incomplete — MLB's blend weights are explicitly disclosed placeholders, never fit, and the market-centric/CLV pivot above was the real next step for MLB itself, interrupted before it was written down. This doc is the accurate one; treat it as superseding that section.
