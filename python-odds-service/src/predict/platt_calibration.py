"""Task 4.3 (P3 H1) — Platt calibration, fitted on LIVE graded rows.

P3 H1: `model_calibration` and `model_artifacts` are empty, and probabilities
are systematically over-confident. This fits the standard correction and stores
it, per sport and market.

WHAT PLATT SCALING IS, and why it is the right shape here. A model that ranks
well but is over-confident produces probabilities that are too extreme in both
directions — 0.85 when the truth is 0.70, 0.15 when the truth is 0.30. Platt
fits a one-parameter-plus-intercept logistic on the model's own LOG-ODDS:

    calibrated = sigmoid(A * logit(model_prob) + B)

A < 1 shrinks predictions toward the base rate, which is exactly the correction
over-confidence needs; B moves the base rate itself. Because it is monotone it
CANNOT change the model's ranking — only how its confidence is expressed. That
matters given Q1: prop grades may return only as ranking, and calibration
therefore cannot damage the one property the audit found actually works.

LIVE ROWS ONLY. `price_source IS NOT NULL` is the discriminator: it is set by
the live pricing path and is null on every backfilled row. Fitting calibration
on backfilled history would be calibrating against a distribution the model
never faced — P3 H5's complaint about the backfill driving the live gate,
applied here before it can happen again.

MINIMUM SAMPLE — operator decision Q32: 200 graded rows per sport+market.
Below that a fitted A and B are noise, and a stored calibration is worse than
none because every downstream reader trusts it. This writes NOTHING under the
threshold rather than writing something weak.

Run standalone:  python -u src/predict/platt_calibration.py
"""
from __future__ import annotations

import asyncio
import math
import sys
from dataclasses import dataclass

sys.path.insert(0, "src")

import db  # noqa: E402
from predict.logistic_regression import fit_logistic_regression  # noqa: E402

# Operator decision Q32.
MIN_ROWS_FOR_CALIBRATION = 200
# Fraction held out. Chronological, never random: a random split lets a model
# be tuned on rows that came after the ones it is scored on, which is the same
# lookahead the leakage findings (P3 H4) were about.
HOLDOUT_FRACTION = 0.25
_EPS = 1e-6


def _logit(p: float) -> float:
    q = min(1 - _EPS, max(_EPS, p))
    return math.log(q / (1 - q))


def _sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z))


def apply_platt(model_prob: float, a: float, b: float) -> float:
    """The stored calibration, applied. Monotone in `model_prob`, so ranking is
    preserved exactly — see the module docstring.

    The OUTPUT is clamped off 0 and 1, not just the input. A steep calibration
    on an extreme input saturates the sigmoid to exactly 1.0 in float
    (A=5, B=3, p=1.0 reaches sigmoid(72)), and a probability of exactly 1.0
    means infinite confidence to every downstream log-loss — one such row would
    dominate any score it appears in. Caught by test_platt_calibration.py
    asserting the range for deliberately extreme parameters, which is why it
    tests values no fit has actually produced.
    """
    return min(1 - _EPS, max(_EPS, _sigmoid(a * _logit(model_prob) + b)))


def _log_loss(pairs: list[tuple[float, float]]) -> float:
    """pairs of (predicted, actual 0/1)."""
    if not pairs:
        return float("nan")
    total = 0.0
    for p, y in pairs:
        q = min(1 - _EPS, max(_EPS, p))
        total += -(y * math.log(q) + (1 - y) * math.log(1 - q))
    return total / len(pairs)


@dataclass
class CalibrationFit:
    sport: str
    market: str
    rows: int
    skipped_reason: str | None
    a: float | None = None
    b: float | None = None
    train_log_loss: float | None = None
    holdout_log_loss: float | None = None
    baseline_holdout_log_loss: float | None = None
    improved: bool = False

    def summary(self) -> str:
        if self.skipped_reason:
            return f"{self.sport}/{self.market}: SKIPPED — {self.skipped_reason} (n={self.rows})"
        return (
            f"{self.sport}/{self.market}: n={self.rows} A={self.a:.4f} B={self.b:.4f} | "
            f"holdout log-loss {self.holdout_log_loss:.5f} vs uncalibrated "
            f"{self.baseline_holdout_log_loss:.5f} | "
            f"{'IMPROVED' if self.improved else 'no improvement — not activated'}"
        )


async def _live_graded_rows(sport: str, market: str) -> list[tuple[float, float]]:
    """(model_prob, actual) for live graded rows, oldest first.

    Ordered by `surfaced_at` so the holdout split below is chronological.
    """
    pool = await db.get_pool()
    rows = await pool.fetch(
        """
        SELECT model_prob, outcome
          FROM pick_history
         WHERE sport = $1 AND dimension = $2
           AND outcome IN ('win', 'loss')
           AND model_prob IS NOT NULL
           AND price_source IS NOT NULL
         ORDER BY surfaced_at ASC
        """,
        sport,
        market,
    )
    return [(float(r["model_prob"]), 1.0 if r["outcome"] == "win" else 0.0) for r in rows]


async def fit_for(sport: str, market: str, store: bool = True) -> CalibrationFit:
    sample = await _live_graded_rows(sport, market)
    n = len(sample)
    if n < MIN_ROWS_FOR_CALIBRATION:
        return CalibrationFit(sport, market, n, f"below Q32's minimum of {MIN_ROWS_FOR_CALIBRATION}")

    split = int(n * (1 - HOLDOUT_FRACTION))
    train, holdout = sample[:split], sample[split:]
    if not train or not holdout:
        return CalibrationFit(sport, market, n, "split produced an empty side")

    # A single feature — the model's own log-odds. The fitter supplies the
    # intercept, which is Platt's B.
    fit = fit_logistic_regression([[_logit(p)] for p, _ in train], [y for _, y in train])
    a, b = fit.weights[0], fit.intercept

    train_ll = _log_loss([(apply_platt(p, a, b), y) for p, y in train])
    holdout_ll = _log_loss([(apply_platt(p, a, b), y) for p, y in holdout])
    baseline_ll = _log_loss(holdout)

    # Only activate a calibration that actually helps on data it never saw.
    # Same discipline as the model activation gate in model_fit.py — a
    # calibration that makes held-out predictions worse is not a calibration.
    improved = holdout_ll < baseline_ll

    result = CalibrationFit(
        sport=sport, market=market, rows=n, skipped_reason=None,
        a=a, b=b, train_log_loss=train_ll, holdout_log_loss=holdout_ll,
        baseline_holdout_log_loss=baseline_ll, improved=improved,
    )

    if store:
        await db.write_calibration(
            db.CalibrationInput(
                sport=sport, market=market, method="platt",
                params={"a": a, "b": b, "holdout_fraction": HOLDOUT_FRACTION},
                train_games=len(train), train_log_loss=train_ll,
                holdout_games=len(holdout), holdout_log_loss=holdout_ll,
                baseline_holdout_log_loss=baseline_ll,
            ),
            activate=improved,
        )
    return result


async def eligible_pairs() -> list[tuple[str, str]]:
    """Every (sport, dimension) with enough live graded rows to be worth
    fitting. Computed rather than hardcoded, so a market becomes eligible on
    its own as its history accumulates."""
    pool = await db.get_pool()
    rows = await pool.fetch(
        """
        SELECT sport, dimension, count(*) AS n
          FROM pick_history
         WHERE outcome IN ('win', 'loss')
           AND model_prob IS NOT NULL
           AND price_source IS NOT NULL
         GROUP BY sport, dimension
        HAVING count(*) >= $1
         ORDER BY count(*) DESC
        """,
        MIN_ROWS_FOR_CALIBRATION,
    )
    return [(r["sport"], r["dimension"]) for r in rows]


async def fit_all(store: bool = True) -> list[CalibrationFit]:
    results = []
    for sport, market in await eligible_pairs():
        results.append(await fit_for(sport, market, store=store))
    return results


async def _main() -> None:
    results = await fit_all(store=True)
    if not results:
        print(f"no sport/market has {MIN_ROWS_FOR_CALIBRATION}+ live graded rows yet", flush=True)
        return
    for r in results:
        print("  " + r.summary(), flush=True)


if __name__ == "__main__":
    asyncio.run(_main())
