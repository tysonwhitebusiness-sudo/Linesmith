"""Direct port of lib/sports/golf/models/{holeScoreModel,roundScoreModel,
tournamentWinModel}.ts — not a reimplementation. Combined into one file
per the port plan's own naming (predict/golf_models.py); each section
below mirrors one TS source file, in the same order.

All three ship with hand-picked-prior placeholder math (disclosed in
each TS file's own header), never fitted — porting means porting the
same placeholder math faithfully, not upgrading it. A real fitting pass
(mirroring model_fit.py's pattern) is a natural follow-up once golf has a
season of graded history, not part of this port.
"""
import math
from dataclasses import dataclass, field

from predict.normal_dist import normal_cdf, sample_normal

# =============================================================================
# Hole Score Predictor (holeScoreModel.ts)
# =============================================================================

GolfCategory = str  # 'birdie' | 'par' | 'bogey'


def _category_for(relative_to_par: float) -> GolfCategory:
    if relative_to_par < 0:
        return "birdie"
    if relative_to_par == 0:
        return "par"
    return "bogey"


@dataclass
class HoleFieldObservation:
    relative_to_par: float


@dataclass
class HoleModelInput:
    par: int | None
    # Every golfer's score on this hole this week so far, across all
    # completed rounds — includes the subject golfer's own.
    field_observations: list[HoleFieldObservation]
    # The subject golfer's own subset of the above, weighted extra.
    golfer_own_observations: list[HoleFieldObservation]
    # Season SG:Total, strokes gained per round — the subject golfer's.
    # None when unmatched/unavailable, in which case only the field
    # distribution is used.
    golfer_sg_total: float | None
    # Average season SG:Total per round across the golfers who
    # contributed field_observations.
    field_avg_sg_total: float | None


@dataclass
class HolePrediction:
    prob_birdie: float
    prob_par: float
    prob_bogey: float
    # Single-shot approximation (birdie ~= -1, bogey ~= +1) — doesn't
    # separately weight eagles or doubles, a disclosed simplification.
    expected_relative_to_par: float
    field_sample_size: int
    basis: list[str] = field(default_factory=list)


# Approximate PGA Tour scoring-distribution-by-par, rounded from widely
# published tour averages. A disclosed prior, not fit against this app's
# own data.
_PRIOR_BY_PAR: dict[int, dict[str, float]] = {
    3: {"birdie": 0.13, "par": 0.71, "bogey": 0.16},
    4: {"birdie": 0.13, "par": 0.69, "bogey": 0.18},
    5: {"birdie": 0.34, "par": 0.53, "bogey": 0.13},
}

# How much a hole's par matters to a skill-based shift — a par 5's extra
# length/reachability gives real skill more room to show up than a short
# par 3 does.
_SKILL_WEIGHT_BY_PAR: dict[int, float] = {3: 0.7, 4: 1.0, 5: 1.4}

# How many pseudo-observations the par-based prior counts as, before
# real field data starts outweighing it.
_PRIOR_WEIGHT = 6
# Extra weight given to the golfer's own scores on this exact hole.
# Total weight the subject golfer's own rounds carry, INCLUDING the one they
# already contribute as members of the field. Task 4.12 (P3 M7): they used to
# receive 1 (in the field loop) PLUS this value (in the own loop), so a weight
# named "own extra = 2" actually applied 3 — and the subject's own scores were
# counted twice on top of that, since golfer_own_observations is a SUBSET of
# field_observations, not a separate sample.
_OWN_EXTRA_WEIGHT = 2
# 1 stroke of hole-level skill edge (already down-weighted by
# SKILL_WEIGHT_BY_PAR/18) shifts birdie/bogey log-odds by this much.
_STROKES_TO_LOGODDS = 2.2


def _clamp_prob(p: float) -> float:
    return min(0.98, max(0.01, p))


def _log_odds(p: float) -> float:
    c = _clamp_prob(p)
    return math.log(c / (1 - c))


def _from_log_odds(lo: float) -> float:
    return 1 / (1 + math.exp(-lo))


def _prior_for(par: int | None) -> dict[str, float]:
    if par in (3, 4, 5):
        return _PRIOR_BY_PAR[par]
    return _PRIOR_BY_PAR[4]  # par 4 is the tour's modal hole — least-wrong default when par is unknown


def prior_hole_category_rate(par: int | None, category: GolfCategory) -> float:
    """The par-based prior alone, before any field-observation or skill
    adjustment — the "league rate" a candidate's model conviction is
    measured against (see prop_score.py's M component)."""
    return _prior_for(par)[category]


def predict_hole_score(input: HoleModelInput) -> HolePrediction:
    par = input.par
    prior = _prior_for(par)
    basis: list[str] = []

    # Dirichlet-style blend: prior-as-pseudo-counts + real observations.
    counts = {"birdie": prior["birdie"] * _PRIOR_WEIGHT, "par": prior["par"] * _PRIOR_WEIGHT, "bogey": prior["bogey"] * _PRIOR_WEIGHT}
    for obs in input.field_observations:
        counts[_category_for(obs.relative_to_par)] += 1
    basis.append(f"Field: {len(input.field_observations)} observations this week (par {par if par is not None else 'unknown'} prior blended in at weight {_PRIOR_WEIGHT})")

    if input.golfer_own_observations:
        # Task 4.12 (P3 M7) — the subject is DEDUPED from the field, not added
        # on top of it. `golfer_own_observations` is documented as "the subject
        # golfer's own subset of the above", so every one of these rows has
        # already scored +1 in the field loop. Adding the full weight here
        # counted the subject's own scores twice and gave them a total weight of
        # 1 + _OWN_EXTRA_WEIGHT.
        #
        # Adding (_OWN_EXTRA_WEIGHT - 1) makes the subject's total exactly
        # _OWN_EXTRA_WEIGHT, which is arithmetically identical to removing them
        # from field_observations and re-adding at full weight — and it needs no
        # golfer id to do it, which matters because HoleFieldObservation carries
        # only `relative_to_par` and has no identity to dedupe on.
        own_top_up = _OWN_EXTRA_WEIGHT - 1
        for obs in input.golfer_own_observations:
            counts[_category_for(obs.relative_to_par)] += own_top_up
        basis.append(f"This golfer's own hole history this week: {len(input.golfer_own_observations)} round(s), weighted {_OWN_EXTRA_WEIGHT}x")

    total = counts["birdie"] + counts["par"] + counts["bogey"]
    prob_birdie = counts["birdie"] / total
    prob_par = counts["par"] / total
    prob_bogey = counts["bogey"] / total

    if input.golfer_sg_total is not None and input.field_avg_sg_total is not None:
        skill_delta_per_round = input.golfer_sg_total - input.field_avg_sg_total
        weight = _SKILL_WEIGHT_BY_PAR[par if par in (3, 5) else 4]
        per_hole_skill_delta = (skill_delta_per_round / 18) * weight
        shift = per_hole_skill_delta * _STROKES_TO_LOGODDS

        prob_birdie = _from_log_odds(_log_odds(prob_birdie) + shift)
        prob_bogey = _from_log_odds(_log_odds(prob_bogey) - shift)
        prob_par = max(0.02, 1 - prob_birdie - prob_bogey)

        sign = "+" if skill_delta_per_round >= 0 else ""
        basis.append(f"Skill: {sign}{skill_delta_per_round:.2f} SG/round vs. field average, hole-weighted for par {par if par is not None else 4}")
    else:
        basis.append("Skill: no season SG:Total available for this golfer — field distribution only.")

    total2 = prob_birdie + prob_par + prob_bogey
    prob_birdie /= total2
    prob_par /= total2
    prob_bogey /= total2

    return HolePrediction(
        prob_birdie=prob_birdie,
        prob_par=prob_par,
        prob_bogey=prob_bogey,
        expected_relative_to_par=-prob_birdie + prob_bogey,
        field_sample_size=len(input.field_observations),
        basis=basis,
    )


# =============================================================================
# Round Score Predictor (roundScoreModel.ts)
# =============================================================================


@dataclass
class RoundFieldObservation:
    relative_to_par: float


@dataclass
class RoundModelInput:
    # Every golfer's completed-round score (relative to par) at this
    # course this week so far.
    field_observations: list[RoundFieldObservation]
    golfer_own_observations: list[RoundFieldObservation]
    golfer_sg_total: float | None
    field_avg_sg_total: float | None
    wind_mph: float | None


@dataclass
class RoundPrediction:
    expected_relative_to_par: float
    prob_under_par: float
    prob_even_par: float
    prob_over_par: float
    field_sample_size: int
    basis: list[str] = field(default_factory=list)


# Widely published PGA Tour round-to-round scoring standard deviation —
# exported so tournament_win_model draws from the same figure this
# model's own bucket probabilities are built on.
ROUND_SCORE_SD = 2.8
# Below this wind speed, the disclosed adjustment stays at 0.
_WIND_THRESHOLD_MPH = 10
# Strokes added per mph of wind above the threshold.
_WIND_STROKES_PER_MPH = 0.05
# Empirical-Bayes-style shrinkage constant — with 3 rounds of a golfer's
# own results this week, their own history and the skill/field estimate
# get roughly equal weight.
_OWN_HISTORY_PRIOR_STRENGTH = 3


def _average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


@dataclass
class _RoundBuckets:
    prob_under_par: float
    prob_even_par: float
    prob_over_par: float


def _bucketize(mean: float) -> _RoundBuckets:
    """Continuity-corrected discretization: score < -0.5 rounds down to
    "under par", score > 0.5 rounds up to "over par", the half-stroke
    band between them is the P(score == 0) mass a continuous Normal
    can't place exactly."""
    prob_under_par = normal_cdf(-0.5, mean, ROUND_SCORE_SD)
    prob_over_par = 1 - normal_cdf(0.5, mean, ROUND_SCORE_SD)
    prob_even_par = max(0.0, 1 - prob_under_par - prob_over_par)
    total = prob_under_par + prob_over_par + prob_even_par
    return _RoundBuckets(prob_under_par=prob_under_par / total, prob_even_par=prob_even_par / total, prob_over_par=prob_over_par / total)


def field_baseline_bucket_probs(field_observations: list[RoundFieldObservation]) -> _RoundBuckets:
    """Bucket probabilities from the field-observed baseline alone — the
    "league rate" a round-score candidate's model conviction is measured
    against."""
    field_baseline = _average([o.relative_to_par for o in field_observations]) or 0.0
    return _bucketize(field_baseline)


def predict_round_score(input: RoundModelInput) -> RoundPrediction:
    basis: list[str] = []

    field_baseline = _average([o.relative_to_par for o in input.field_observations]) or 0.0
    if input.field_observations:
        sign = "+" if field_baseline >= 0 else ""
        basis.append(f"Field: {len(input.field_observations)} completed rounds this week, averaging {sign}{field_baseline:.2f}")
    else:
        basis.append("Field: no completed rounds yet this week — course-difficulty baseline defaults to even par.")

    skill_adj = 0.0
    if input.golfer_sg_total is not None and input.field_avg_sg_total is not None:
        skill_adj = -(input.golfer_sg_total - input.field_avg_sg_total)
        delta = input.golfer_sg_total - input.field_avg_sg_total
        sign = "+" if input.golfer_sg_total >= input.field_avg_sg_total else ""
        basis.append(f"Skill: {sign}{delta:.2f} SG/round vs. field average")
    else:
        basis.append("Skill: no season SG:Total available for this golfer.")

    wind_adj = 0.0
    if input.wind_mph is not None and input.wind_mph > _WIND_THRESHOLD_MPH:
        wind_adj = (input.wind_mph - _WIND_THRESHOLD_MPH) * _WIND_STROKES_PER_MPH
        basis.append(f"Weather: {input.wind_mph:.0f} mph wind, +{wind_adj:.2f} strokes")

    skill_estimate = field_baseline + skill_adj + wind_adj

    own_avg = _average([o.relative_to_par for o in input.golfer_own_observations])
    expected = skill_estimate
    if own_avg is not None:
        n = len(input.golfer_own_observations)
        own_weight = n / (n + _OWN_HISTORY_PRIOR_STRENGTH)
        expected = own_weight * own_avg + (1 - own_weight) * skill_estimate
        sign = "+" if own_avg >= 0 else ""
        basis.append(f"This golfer's own rounds this week: {n}, averaging {sign}{own_avg:.2f} (blended at {own_weight * 100:.0f}% weight)")

    buckets = _bucketize(expected)

    return RoundPrediction(
        expected_relative_to_par=expected,
        prob_under_par=buckets.prob_under_par,
        prob_even_par=buckets.prob_even_par,
        prob_over_par=buckets.prob_over_par,
        field_sample_size=len(input.field_observations),
        basis=basis,
    )


# =============================================================================
# Tournament Winner / Ranking Model (tournamentWinModel.ts)
# =============================================================================


@dataclass
class GolferProjection:
    espn_id: str
    # This golfer's own relative-to-par score for each round already
    # completed this tournament, in order (R1, R2, ...).
    completed_rounds: list[float]
    # Expected relative-to-par for a round this golfer hasn't played yet
    # — round_score_model's own expected_relative_to_par for this golfer.
    projected_round_mean: float


@dataclass
class TournamentModelInput:
    golfers: list[GolferProjection]
    total_rounds: int
    # How many golfers survive the cut — top N by running total, ties
    # broken by sort order. None skips cut modeling entirely.
    cut_size: int | None
    # Which round the cut applies after — 2 for a standard 4-round event.
    cut_after_round: int
    iterations: int
    round_score_sd: float
    rng: object = None  # injectable for deterministic tests; defaults to random.random via sample_normal


@dataclass
class GolferTournamentOutcome:
    espn_id: str
    prob_win: float
    prob_top5: float
    prob_top10: float
    prob_made_cut: float
    expected_final_score: float


@dataclass
class TournamentPrediction:
    outcomes: list[GolferTournamentOutcome]
    iterations: int
    basis: list[str] = field(default_factory=list)


def predict_tournament(input: TournamentModelInput) -> TournamentPrediction:
    golfers = input.golfers
    n = len(golfers)

    wins = [0] * n
    top5s = [0] * n
    top10s = [0] * n
    made_cuts = [0] * n
    score_sum = [0.0] * n

    rng = input.rng if input.rng is not None else __import__("random").random

    for _ in range(input.iterations):
        running = [0.0] * n
        active = list(range(n))
        cut_applied = input.cut_size is None

        for round_num in range(1, input.total_rounds + 1):
            for i in active:
                g = golfers[i]
                played = g.completed_rounds[round_num - 1] if round_num - 1 < len(g.completed_rounds) else None
                running[i] += played if played is not None else sample_normal(g.projected_round_mean, input.round_score_sd, rng)

            if not cut_applied and round_num == input.cut_after_round:
                active = sorted(active, key=lambda a: running[a])[: (input.cut_size if input.cut_size is not None else len(active))]
                cut_applied = True

        for i in active:
            made_cuts[i] += 1
        for i in active:
            score_sum[i] += running[i]

        ranked = sorted(active, key=lambda a: running[a])
        if ranked:
            wins[ranked[0]] += 1
        for i in ranked[:5]:
            top5s[i] += 1
        for i in ranked[:10]:
            top10s[i] += 1

    outcomes = [
        GolferTournamentOutcome(
            espn_id=golfers[i].espn_id,
            prob_win=wins[i] / input.iterations,
            prob_top5=top5s[i] / input.iterations,
            prob_top10=top10s[i] / input.iterations,
            prob_made_cut=made_cuts[i] / input.iterations,
            expected_final_score=(score_sum[i] / made_cuts[i]) if made_cuts[i] > 0 else float("nan"),
        )
        for i in range(n)
    ]
    outcomes.sort(key=lambda o: -o.prob_win)

    return TournamentPrediction(
        outcomes=outcomes,
        iterations=input.iterations,
        basis=[
            f"{n} golfers, {input.iterations:,} simulated tournaments",
            f"Cut modeled: top {input.cut_size} after round {input.cut_after_round}" if input.cut_size is not None else "No cut modeled (already applied or not requested)",
            f"Round-to-round score SD: {input.round_score_sd} strokes (disclosed constant, not yet fit)",
        ],
    )
