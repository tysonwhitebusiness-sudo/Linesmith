"""Direct port of lib/odds/props/propScore.ts — not a reimplementation.

Prop Score v1 — a single 0-100 rating + letter grade per prop, built
entirely from data already flowing through this pipeline: the
Beta-Binomial posterior (edge_model.py), a genuine live two-sided book
price when one exists (live_edge.py), the candidate's own trailing-
performance corroboration (good_bets.py), and matchup favorability.

Deliberately does NOT fold in market trust as a multiplicative term — see
the TS source's own file header for why an earlier design that did broke
(a thin-sample market's Brier Skill Score could zero out an individual
pick's whole score regardless of its own evidence). Weights and scale
constants below are v1, hand-set — same disclosed-guess status as
edge_model.py's MATCHUP_SHIFT_WEIGHT/PRIOR_STRENGTH.
"""
import math
from dataclasses import dataclass

from predict.edge_model import prior_strength
from predict.good_bets import CandidateGoodBetSignals, performance_match_details
from predict.live_edge import CandidateEdgeInfo


def _js_round(x: float) -> int:
    """See good_bets.py's _js_round — same JS Math.round-vs-Python round()
    tie-breaking divergence, matched here since it decides the score
    that in turn decides a pick's letter grade."""
    return math.floor(x + 0.5)


def _clamp(value: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, value))


# Normalizes a raw delta-M = (p_model - leagueRate) edge, discounted by
# posterior confidence — a 15-point shift is roughly the ceiling this maps
# to +/-1.
SCALE_M = 0.15
# Normalizes a raw live book edge (model prob - devigged market prob) — a
# 10-point edge maps to +/-1.
SCALE_E = 0.1
# Flat bonus added to P when >=2 independent performance tracks clear, on
# top of the single best track's own margin.
MULTI_TRACK_BONUS = 0.15
# X — matchup is corroborating only, never load-bearing on its own.
MATCHUP_BONUS = 0.3

WEIGHT_M = 0.3
WEIGHT_E = 0.35
WEIGHT_P = 0.25
WEIGHT_X = 0.1

GRADE_TIERS: list[tuple[int, str]] = [
    (85, "A+"),
    (75, "A"),
    (68, "B+"),
    (62, "B"),
    (56, "C+"),
    (50, "C"),
    (0, "D"),
]


def grade_for_score(score: float) -> str:
    for min_score, grade in GRADE_TIERS:
        if score >= min_score:
            return grade
    return "D"


@dataclass
class PropScoreComponents:
    m: float  # Model conviction — posterior probability's distance from league rate, discounted by sample-size confidence.
    e: float | None  # Live book edge, normalized — None when no genuine two-sided live price exists.
    p: float  # Performance corroboration — best trailing-window margin, plus a multi-track bonus.
    x: float  # Matchup corroboration — flat bonus when favorable, 0 otherwise.


@dataclass
class PropScore:
    score: int
    grade: str
    components: PropScoreComponents
    has_live_edge: bool
    performance_label: str | None
    performance_detail: str | None


def _performance_component(dimension: str, signals: CandidateGoodBetSignals) -> tuple[float, str | None, str | None]:
    matches = performance_match_details(dimension, signals.l5, signals.l10, signals.l15, signals.szn, signals.streak, signals.h2h)
    if not matches:
        return 0.0, None, None
    best_margin = max(m.margin for m in matches)
    bonus = MULTI_TRACK_BONUS if len(matches) >= 2 else 0.0
    label = ", ".join(m.short for m in matches)
    detail = "; ".join(m.long for m in matches)
    return _clamp(best_margin + bonus, 0.0, 1.0), label, detail


def compute_prop_score(
    dimension: str,
    model_prob: float | None,
    league_rate: float | None,
    sample_size: int,
    matchup_favorable: bool | None,
    good_bet_signals: CandidateGoodBetSignals,
    edge_info: CandidateEdgeInfo,
) -> PropScore | None:
    """`edge_info` should come from resolve_candidate_edge (live_edge.py)
    — whatever price/staleness gating that function already applies is
    trusted as-is here, not re-checked. Returns None when there's no model
    probability at all to build a score from — same "absent, not
    fabricated" rule the rest of this app follows for a number it can't
    stand behind. A degenerate NaN model_prob (e.g. a Beta posterior from
    a zero-length window) is rejected the same as a missing one, not let
    through to poison every downstream component."""
    if model_prob is None or not math.isfinite(model_prob):
        return None

    effective_league_rate = league_rate if league_rate is not None and math.isfinite(league_rate) else model_prob
    n0 = prior_strength(dimension)
    kappa = sample_size / (sample_size + n0)
    delta_m = model_prob - effective_league_rate
    m = _clamp((delta_m * kappa) / SCALE_M, -1.0, 1.0)

    e = _clamp(edge_info.edge / SCALE_E, -1.0, 1.0) if edge_info.edge is not None else None

    p, performance_label, performance_detail = _performance_component(dimension, good_bet_signals)

    x = MATCHUP_BONUS if matchup_favorable is True else 0.0

    if e is not None:
        raw = WEIGHT_M * m + WEIGHT_E * e + WEIGHT_P * p + WEIGHT_X * x
    else:
        # No genuine live price — redistribute E's weight over the other
        # three proportionally rather than treat "no price" as "confirmed
        # zero edge."
        remaining = 1 - WEIGHT_E
        raw = (WEIGHT_M / remaining) * m + (WEIGHT_P / remaining) * p + (WEIGHT_X / remaining) * x

    score = _js_round(50 + 50 * _clamp(raw, -1.0, 1.0))
    return PropScore(
        score=score,
        grade=grade_for_score(score),
        components=PropScoreComponents(m=m, e=e, p=p, x=x),
        has_live_edge=e is not None,
        performance_label=performance_label,
        performance_detail=performance_detail,
    )
