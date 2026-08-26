"""Manual, on-demand CLI for running the model-benchmarking harness against
real MLB history. NOT wired into JOB_REGISTRY/SequentialQueue — model-
fitting work doesn't fit the queue's 10-minute per-job timeout (confirmed
live this session: building ONE season's real training set — real per-team
stats plus a 300-iteration Monte Carlo sim per game — took ~13 real
minutes; a full 16-season walk-forward run is genuinely a multi-hour
operation even with build_training_set's new in-process memo cache, see
model_fit.py's own comment on why that cache was added). This mirrors
model_fit.py's/home_run_model_fit.py's own existing shape: fitting has
never been a scheduled job in this codebase, only ever a human-triggered,
out-of-band operation.

Lives directly in src/ (not src/predict/) matching this repo's own
convention: src/predict/ is library modules, real CLI entry points
(main.py, health_check.py, every test_*.py) live in src/ itself and are
run as `python src/<script>.py` from python-odds-service/ (confirmed via
render.yaml's own startCommand: python src/main.py) — not `python -m`
package-style invocation, which fails here since python-odds-service/
itself is never added to sys.path.

Usage (from python-odds-service):
    python src/run_walkforward.py --sport mlb --market moneyline
    python src/run_walkforward.py --sport mlb --market moneyline --activate
    python src/run_walkforward.py --sport mlb --market moneyline \
        --train-pool 2010-2023 --test-seasons 2024,2025 --min-train-seasons 8

Default season range is intentionally SMALLER than the full 2010-2025
history the TS admin routes default to (see --train-pool's own help text) —
a deliberate, real cost tradeoff discovered live while building this, not
an oversight. Real measured cost: one season's training set (via
build_training_set's in-process memo cache, see model_fit.py's own comment
on that cache) took 511s (~8.5 real minutes) for a single season; the
cache only helps when the EXACT SAME season tuple is requested twice (which
happens constantly across the 5 shared candidates within one fold, and
between mlb_stacking.py's own inner-split sub-calls and neighboring folds'
boundaries — the expanding-window fold design makes stacking's inner
splits land on already-cached tuples more often than not) — it does NOT
make a later fold's larger season list cheaper than computing it fresh,
since each fold's own season list is a genuinely different cache key. The
2020-2023/min-train-seasons=2 default below is sized for roughly 15 real
distinct season-equivalent builds (~2 hours) as a genuine, complete
end-to-end proof run. Widen --train-pool toward the full 2010-2023 history
once this smaller range has proven the pipeline correct; that's a
genuinely multi-hour-to-many-hour operation even with caching and belongs
in its own deliberately-started, longer run, not squeezed into a first
verification pass.
"""
import argparse
import asyncio
import pickle
import sys

import httpx

import db
from predict import model_fit
from predict.mlb_model_candidates import moneyline_candidates
from predict.model_benchmark import run_benchmark


def _parse_season_range(s: str) -> list[int]:
    if "-" in s:
        start, end = s.split("-", 1)
        return list(range(int(start), int(end) + 1))
    return [int(s)]


def _parse_season_list(s: str) -> list[int]:
    return [int(x) for x in s.split(",")]


async def _activate_winner(sport: str, market: str, winner_name: str, client: httpx.AsyncClient, train_pool_seasons: list[int], test_seasons: list[int]) -> None:
    """'formula' re-derives via the existing model_fit gate straight into
    model_weights (zero new live-wiring needed if it wins — see the
    approved plan's own stated design). Anything else writes into
    model_artifacts, gated on beating the CURRENT ACTIVE model's holdout
    Brier (not just the raw hand-coded formula), per the plan's explicit
    requirement."""
    if winner_name == "formula":
        summary = await model_fit.fit_moneyline_weights(client, train_pool_seasons, test_seasons)
        print(f"formula activation: activated={summary.activated} holdout_brier={summary.holdout_brier:.4f} baseline_holdout_brier={summary.baseline_holdout_brier:.4f}")
        return

    # Every other candidate needs its own real fit against the full
    # train_pool + a real holdout Brier score to compare against whatever
    # is CURRENTLY active — re-running the single candidate's fit_fn/
    # score_fn directly (not the whole benchmark) since we already know
    # which one won.
    candidates = {c.name: c for c in moneyline_candidates(client)}
    candidate = candidates[winner_name]
    fit_output = await candidate.fit_fn(train_pool_seasons)
    from predict.walkforward import brier

    test_predictions = []
    for season in test_seasons:
        test_predictions.extend(await candidate.score_fn(fit_output.model, season))
    holdout_brier = brier(test_predictions)

    current_active = await db.get_active_model_weights(sport, market)
    current_active_brier = current_active.holdout_brier if current_active is not None else float("inf")
    activated = holdout_brier < current_active_brier

    # Serialize whatever the model object is — Bradley-Terry's params are
    # already plain dicts/floats (JSON-safe); the tree/NN/stacking models
    # are opaque fitted objects (pickle bytes).
    if winner_name == "bradley_terry":
        artifact_json = {"team_ratings": fit_output.model.team_ratings, "home_advantage": fit_output.model.home_advantage}
        artifact_blob = None
    else:
        artifact_json = None
        artifact_blob = pickle.dumps(fit_output.model)

    saved = await db.write_model_artifact(
        db.ModelArtifactInput(
            sport=sport,
            market=market,
            model_name=winner_name,
            artifact_json=artifact_json,
            artifact_blob=artifact_blob,
            train_games=fit_output.train_games,
            train_log_loss=0.0,  # not recomputed here — walkforward_results already has this from the benchmark pass
            train_brier=0.0,
            holdout_games=len(test_predictions),
            holdout_log_loss=0.0,
            holdout_brier=holdout_brier,
        ),
        activate=activated,
    )
    print(f"{winner_name} activation: activated={activated} holdout_brier={holdout_brier:.4f} current_active_brier={current_active_brier if current_active_brier != float('inf') else 'none'} (model_artifacts version {saved.version})")


async def main() -> int:
    parser = argparse.ArgumentParser(description="Run the model-benchmarking harness against real MLB history.")
    parser.add_argument("--sport", default="mlb")
    parser.add_argument("--market", default="moneyline", choices=["moneyline"])  # total not supported yet — see mlb_model_candidates.py's own note
    parser.add_argument("--train-pool", default="2020-2023", help="Season range for the walk-forward CV pool, e.g. 2010-2023. Smaller than the full 2010-2023 TS-route default on purpose — see this module's own docstring for the real measured per-season cost.")
    parser.add_argument("--test-seasons", default="2024,2025", help="Comma-separated held-out test seasons, e.g. 2024,2025.")
    parser.add_argument("--min-train-seasons", type=int, default=2, help="Warmup seasons before the first CV fold. Must be >= 2 for the stacking candidate — its own inner out-of-fold split needs at least 2 seasons in every fold's train_seasons.")
    parser.add_argument("--activate", action="store_true", help="Write the winning candidate live (model_weights for 'formula', model_artifacts for everything else). Default is a dry run: report only.")
    args = parser.parse_args()

    train_pool_seasons = _parse_season_range(args.train_pool)
    test_seasons = _parse_season_list(args.test_seasons)

    print(f"train_pool_seasons={train_pool_seasons} test_seasons={test_seasons} min_train_seasons={args.min_train_seasons}")

    async with httpx.AsyncClient() as client:
        candidates = moneyline_candidates(client)
        print(f"candidates: {[c.name for c in candidates]}")

        results = await run_benchmark(args.sport, args.market, candidates, train_pool_seasons, test_seasons, args.min_train_seasons)

        print("\n=== Ranked results (best first, by final-test log-loss) ===")
        for i, r in enumerate(results):
            wf = r.walkforward
            print(f"{i+1}. {r.name}: final_test_log_loss={wf.final_test_log_loss:.4f} final_test_brier={wf.final_test_brier_score:.4f} mean_cv_log_loss={wf.mean_log_loss:.4f} mean_cv_brier={wf.mean_brier_score:.4f} final_train_games={wf.final_train_games} final_test_games={wf.final_test_games}")

        if args.activate:
            winner = results[0].name
            print(f"\n=== Activating winner: {winner} ===")
            await _activate_winner(args.sport, args.market, winner, client, train_pool_seasons, test_seasons)
        else:
            print(f"\nDry run (no --activate) — nothing written to model_weights/model_artifacts. Winner would be: {results[0].name}")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
