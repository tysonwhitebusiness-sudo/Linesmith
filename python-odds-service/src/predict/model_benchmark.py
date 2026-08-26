"""Sport-agnostic multi-model benchmarking harness. Generalizes the
"fitted model overrides the baseline if it beat holdout" pattern already
proven for MLB's home-run prop (prop_candidates.py's home_run_model
override) into a real declarative multi-candidate system: any sport can
register a list of ModelCandidates and get them all run through identical
walk-forward folds, scored consistently, and ranked.

Deliberately NOT the ProviderSpec shape (that pattern is for odds-provider
fetch/cap-check jobs — confirmed inapplicable to model fitting during
planning). run_benchmark reports and persists; it does not itself decide
to activate a winner into live inference — that's a separate, later step
(see predict/run_walkforward.py), so a benchmark run is always safe to run
repeatedly without side effects on what's currently live.
"""
from dataclasses import dataclass
from typing import Awaitable, Callable, Generic

import db
from predict.walkforward import FitOutput, ModelT, WalkforwardResult, run_walkforward


@dataclass
class ModelCandidate(Generic[ModelT]):
    name: str
    fit_fn: Callable[[list[int]], Awaitable[FitOutput[ModelT]]]
    score_fn: Callable[[ModelT, int], Awaitable[list]]


@dataclass
class CandidateBenchmarkResult:
    name: str
    walkforward: WalkforwardResult


async def _persist_walkforward_result(sport: str, market: str, model_name: str, result: WalkforwardResult) -> None:
    for fold in result.folds:
        await db.write_walkforward_result(
            db.WalkforwardResultInput(
                sport=sport,
                market=market,
                model_name=model_name,
                fold_index=fold.fold_index,
                is_final_test=False,
                train_seasons=fold.train_seasons,
                val_seasons=[fold.val_season],
                train_games=fold.train_games,
                val_games=fold.val_games,
                log_loss=fold.log_loss,
                brier_score=fold.brier_score,
            )
        )
    await db.write_walkforward_result(
        db.WalkforwardResultInput(
            sport=sport,
            market=market,
            model_name=model_name,
            fold_index=None,
            is_final_test=True,
            train_seasons=result.final_train_seasons,
            val_seasons=result.test_seasons,
            train_games=result.final_train_games,
            val_games=result.final_test_games,
            log_loss=result.final_test_log_loss,
            brier_score=result.final_test_brier_score,
        )
    )


async def run_benchmark(
    sport: str,
    market: str,
    candidates: list[ModelCandidate],
    train_pool_seasons: list[int],
    test_seasons: list[int],
    min_train_seasons: int,
) -> list[CandidateBenchmarkResult]:
    """Runs every candidate through walk-forward CV with the SAME fold
    boundaries (apples-to-apples — generate_expanding_folds is
    deterministic given the same train_pool_seasons/min_train_seasons, so
    every candidate sees identical folds without needing to share state).
    Persists every fold's score AND the final-test score for every
    candidate via db.write_walkforward_result. Returns candidates sorted
    best-first by final-test log-loss (the selection metric this
    framework standardizes on, matching calibration.py's own method-
    selection rule and the reference methodology's own choice of metric —
    brier_score is still carried through per-row for continuity with
    model_fit.py's existing Brier-based activation gate)."""
    results: list[CandidateBenchmarkResult] = []
    for candidate in candidates:
        wf_result = await run_walkforward(train_pool_seasons, test_seasons, min_train_seasons, candidate.fit_fn, candidate.score_fn)
        await _persist_walkforward_result(sport, market, candidate.name, wf_result)
        results.append(CandidateBenchmarkResult(name=candidate.name, walkforward=wf_result))

    results.sort(key=lambda r: r.walkforward.final_test_log_loss)
    return results
