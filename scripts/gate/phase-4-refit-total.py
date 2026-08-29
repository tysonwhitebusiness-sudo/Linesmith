"""Phase 4 gate — re-fit the MLB total model in Python, per the operator
decision of 2026-08-29 ("Re-fit in Python, activate if it passes").

WHY THIS SCRIPT HAS TO EXIST. `fit_total_weights` has been in
predict/model_fit.py since the Python cutover and has never had a caller: no
job in JOB_REGISTRY, no route, no CLI. Every row in `model_weights` was written
on 2026-08-14 by TypeScript's /api/props/fit-total-weights. So "re-fit in
Python" is not a flag flip -- the invocation path is the missing piece, and
this is it.

WHAT IT FIXES. Task 4.11 switched MLB totals from Poisson to negative binomial
(variance/mean 2.28 -- totals are over-dispersed). That changed feature[0] of
the total model at SERVE time (odds_lines_cycle.py:498 passes model.over_prob
into apply_fitted_total_weights). The live weights were fitted on the Poisson
version of that same feature, and the two disagree by up to 11 points at
ordinary totals -- far more than the 3% edge threshold that decides which picks
surface. Re-fitting makes the weights and the feature agree again.

ACTIVATION IS NOT ASSUMED. The fit goes through the same three guardrails as
any other, including the base-rate guardrail the Phase 4 gate added after a
zeroed-feature model activated. If it does not beat its own baseline, the base
rate, and the market gate, it is written unactivated and the previous model
stays live. That is the intended outcome of a fit that does not earn its place.

Run from python-odds-service/:
    ./.venv/Scripts/python.exe -u ../scripts/gate/phase-4-refit-total.py
"""
import asyncio
import sys

sys.path.insert(0, "src")

import httpx

from predict import model_fit  # noqa: E402

# 2010-2023 train, 2024-2025 holdout. historical_odds has total_line on
# essentially every row from 2010 on (checked: >=99.5% per season, 2020 short
# at 860 rows for the shortened season). The holdout is the two most recent
# complete seasons, so the guardrails are judged on the most recent behaviour
# rather than on a decade-old run environment.
TRAIN_SEASONS = list(range(2010, 2024))
HOLDOUT_SEASONS = [2024, 2025]


async def main() -> int:
    print(f"re-fitting mlb/total in Python", flush=True)
    print(f"  train   {TRAIN_SEASONS[0]}-{TRAIN_SEASONS[-1]} ({len(TRAIN_SEASONS)} seasons)", flush=True)
    print(f"  holdout {HOLDOUT_SEASONS}", flush=True)
    print(flush=True)

    async with httpx.AsyncClient() as client:
        s = await model_fit.fit_total_weights(client, TRAIN_SEASONS, HOLDOUT_SEASONS)

    print(flush=True)
    print(f"  train games        {s.train_games}")
    print(f"  holdout games      {s.holdout_games}")
    print(f"  train Brier        {s.train_brier:.6f}")
    print(f"  holdout Brier      {s.holdout_brier:.6f}")
    print(f"  baseline holdout   {s.baseline_holdout_brier:.6f}")
    print(f"  ACTIVATED          {s.activated}")
    if s.saved_row is not None:
        print(f"  saved version      {s.saved_row.version} (active={s.saved_row.active}, shadow={s.saved_row.shadow})")
    print(flush=True)
    print("feature weights:")
    for name, w in zip(s.feature_names, s.weights):
        print(f"  {name:28s} {w:+.6f}")
    print(f"  {'(intercept)':28s} {s.intercept:+.6f}")
    return 0


sys.exit(asyncio.run(main()))
