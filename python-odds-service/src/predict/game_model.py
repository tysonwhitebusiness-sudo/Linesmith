"""Direct port of lib/sports/mlb/gameModel.ts — not a reimplementation.

Game-level prediction model — moneyline win probability and total-runs
probability, built from team season stats, starter quality, and weather
already fetched elsewhere. A game has no "own trailing history" to lean on
the way a player does, so this uses established sabermetric formulas
instead of a Beta-Binomial posterior.

Moneyline: Pythagorean win expectation (runs scored/allowed -> implied win
rate) per team, each blended toward today's opposing starter's own runs
environment (approximated from ERA — earned runs only, a disclosed
simplification, not the true runs-allowed rate a full box score would
give), then combined into a head-to-head probability via the log5 formula
(Bill James) with a standard home-field adjustment layered on top.

Totals: each team's expected runs today (same blended estimate as above)
summed and treated as Poisson-distributed — the standard sabermetric
assumption for run-scoring — to get P(combined total > line) directly.
"""
import math
from dataclasses import dataclass

from .logistic_regression import Matrix, predict_prob_with_interval

# Empirically the standard baseball exponent (vs. 2 for most other sports) —
# Bill James / later refinements settled here.
PYTHAGOREAN_EXPONENT = 1.83

# MLB home teams have won ~53-54% of games historically — a well-documented,
# not tuned, constant. Left as the floor even now that a team-specific split
# edge (below) can add to it, since the flat rate is real and shouldn't be
# fully displaced by a small in-season sample.
HOME_FIELD_EDGE = 0.04

# Below this many decisions, a split record is too noisy to trust — its edge
# is treated as 0 rather than extrapolated from a handful of games.
MIN_SPLIT_SAMPLE = 8
# Same floor for the last-10 form signal — MLB's own standings feed always
# reports at most 10, so this just guards partial seasons.
MIN_RECENT_SAMPLE = 6
# How far a team's home/road split is allowed to move the model versus its
# season rate — bounded so one hot/cold home split doesn't dominate.
MAX_SPLIT_EDGE = 0.08
# Same bound for the recent-form nudge.
MAX_RECENT_EDGE = 0.1
# Recent form is real signal but noisier than a full season — down-weighted
# before being added in.
RECENT_FORM_WEIGHT = 0.4

# Same start-count floor used elsewhere (adapter.ts) before trusting an
# individual starter's own numbers.
MIN_STARTS_FOR_GAME_MODEL = 3


def pythagorean_win_pct(runs_scored: float, runs_allowed: float) -> float:
    rs = max(runs_scored, 0.1) ** PYTHAGOREAN_EXPONENT
    ra = max(runs_allowed, 0.1) ** PYTHAGOREAN_EXPONENT
    return rs / (rs + ra)


def log5(win_pct_a: float, win_pct_b: float) -> float:
    """Bill James' log5: combines two teams' own win rates into a
    head-to-head probability."""
    num = win_pct_a - win_pct_a * win_pct_b
    den = win_pct_a + win_pct_b - 2 * win_pct_a * win_pct_b
    if den <= 0:
        return 0.5
    return min(0.99, max(0.01, num / den))


@dataclass
class TeamRecordSplit:
    wins: int
    losses: int


@dataclass
class TeamOffenseDefense:
    runs_scored_per_game: float
    runs_allowed_per_game: float
    # This team's season record — the baseline the splits below are measured against.
    season_record: TeamRecordSplit | None = None
    # This team's record in today's venue context: home record for the home team, away record for the away team.
    venue_record: TeamRecordSplit | None = None
    # Last-10-games record, any venue.
    recent_record: TeamRecordSplit | None = None


def _win_pct(record: TeamRecordSplit | None) -> float | None:
    if not record:
        return None
    total = record.wins + record.losses
    if total < 1:
        return None
    return record.wins / total


def split_edge(season: TeamRecordSplit | None, split: TeamRecordSplit | None, min_sample: int, cap: float) -> float:
    """How much better (or worse) a team plays in a specific context than
    its season rate — clamped so a small-sample split can't swing the model
    more than `cap`, and zeroed out below `min_sample` decisions entirely."""
    if not split:
        return 0.0
    total = split.wins + split.losses
    if total < min_sample:
        return 0.0
    season_pct = _win_pct(season)
    split_pct = _win_pct(split)
    if season_pct is None or split_pct is None:
        return 0.0
    return min(cap, max(-cap, split_pct - season_pct))


@dataclass
class OpposingStarter:
    era: float | None
    starts: int


def _blend_with_starter_era(team_rate_per_game: float, starter: OpposingStarter | None) -> float:
    """Blends a team's own season rate toward a starting pitcher's ERA once
    they've thrown enough starts to mean something. Used two ways: a team's
    runs-SCORED rate blends toward the *opposing* starter's ERA (who their
    batters face today), and a team's runs-ALLOWED rate blends toward
    *their own* starter's ERA (who's actually on the mound for them today).
    ERA is earned runs only, and a starter typically pitches 5-6 of 9
    innings, so this is a real but disclosed approximation, not the true
    runs rate a full box score would give."""
    if starter is None or starter.era is None or starter.starts < MIN_STARTS_FOR_GAME_MODEL:
        return team_rate_per_game
    return team_rate_per_game * 0.5 + starter.era * 0.5


@dataclass
class MoneylineInput:
    home: TeamOffenseDefense
    away: TeamOffenseDefense
    # Today's actual starters, own team's side — NOT who they're facing.
    home_starter: OpposingStarter | None
    away_starter: OpposingStarter | None
    # Multiplicative run-environment adjustment for today's specific venue —
    # applied symmetrically to both teams' expected runs (scored AND
    # allowed). 1.0 = no adjustment (unknown venue, or too few games there
    # this season to trust a factor).
    park_factor: float | None = None


@dataclass
class MoneylineDiagnostics:
    raw_log5_home_win_prob: float
    home_venue_edge: float
    away_venue_edge: float
    home_recent_edge: float
    away_recent_edge: float
    # Unscaled versions of home_recent_edge/away_recent_edge (before x RECENT_FORM_WEIGHT) —
    # matches modelFit.ts's training feature exactly.
    raw_home_recent_edge: float
    raw_away_recent_edge: float
    park_factor: float


@dataclass
class MoneylineResult:
    home_win_prob: float
    away_win_prob: float
    home_expected_runs: float
    away_expected_runs: float
    # The raw ingredients behind home_win_prob, exposed (not just the
    # finished number) so a caller can log them — this is what a later
    # fitting pass needs to learn real weights for home field / venue /
    # form instead of the hand-picked constants below staying guesses forever.
    diagnostics: MoneylineDiagnostics


def compute_moneyline_model(input: MoneylineInput) -> MoneylineResult:
    park_factor = input.park_factor if input.park_factor is not None else 1.0

    # Each team's runs scored is shaped by the pitcher they're actually
    # facing (the opponent's starter); each team's runs allowed is shaped
    # by their own starter, who's the one actually on the mound for them today.
    home_expected_runs = _blend_with_starter_era(input.home.runs_scored_per_game, input.away_starter)
    away_expected_runs = _blend_with_starter_era(input.away.runs_scored_per_game, input.home_starter)
    home_expected_runs_allowed = _blend_with_starter_era(input.home.runs_allowed_per_game, input.home_starter)
    away_expected_runs_allowed = _blend_with_starter_era(input.away.runs_allowed_per_game, input.away_starter)

    # Venue run-environment: today's specific park, applied symmetrically to
    # both teams' scored AND allowed figures. Mathematical fact worth being
    # explicit about: scaling both terms of a Pythagorean ratio by the same
    # constant leaves the ratio — and therefore home_win_prob — completely
    # unchanged. So a single symmetric park factor genuinely has ZERO effect
    # on the moneyline here, and that's correct, not a bug: its real,
    # measurable effect is on home_expected_runs + away_expected_runs below,
    # which feeds the totals (Poisson) model directly.
    home_expected_runs *= park_factor
    away_expected_runs *= park_factor
    home_expected_runs_allowed *= park_factor
    away_expected_runs_allowed *= park_factor

    home_win_pct = pythagorean_win_pct(home_expected_runs, home_expected_runs_allowed)
    away_win_pct = pythagorean_win_pct(away_expected_runs, away_expected_runs_allowed)

    raw_home_win_prob = log5(home_win_pct, away_win_pct)

    # Team-specific split/form nudges on top of the flat home-field constant.
    home_venue_edge = split_edge(input.home.season_record, input.home.venue_record, MIN_SPLIT_SAMPLE, MAX_SPLIT_EDGE)
    away_venue_edge = split_edge(input.away.season_record, input.away.venue_record, MIN_SPLIT_SAMPLE, MAX_SPLIT_EDGE)
    # Raw (unscaled) split, kept alongside the xRECENT_FORM_WEIGHT version
    # below because modelFit.ts's training features use the unscaled diff —
    # the regression decides its own weight instead of trusting this
    # hand-picked 0.4 discount.
    raw_home_recent_edge = split_edge(input.home.season_record, input.home.recent_record, MIN_RECENT_SAMPLE, MAX_RECENT_EDGE)
    raw_away_recent_edge = split_edge(input.away.season_record, input.away.recent_record, MIN_RECENT_SAMPLE, MAX_RECENT_EDGE)
    home_recent_edge = raw_home_recent_edge * RECENT_FORM_WEIGHT
    away_recent_edge = raw_away_recent_edge * RECENT_FORM_WEIGHT

    adjustment = HOME_FIELD_EDGE + (home_venue_edge - away_venue_edge) + (home_recent_edge - away_recent_edge)
    home_win_prob = min(0.97, max(0.03, raw_home_win_prob + adjustment))

    return MoneylineResult(
        home_win_prob=home_win_prob,
        away_win_prob=1 - home_win_prob,
        home_expected_runs=home_expected_runs,
        away_expected_runs=away_expected_runs,
        diagnostics=MoneylineDiagnostics(
            raw_log5_home_win_prob=raw_home_win_prob,
            home_venue_edge=home_venue_edge,
            away_venue_edge=away_venue_edge,
            home_recent_edge=home_recent_edge,
            away_recent_edge=away_recent_edge,
            raw_home_recent_edge=raw_home_recent_edge,
            raw_away_recent_edge=raw_away_recent_edge,
            park_factor=park_factor,
        ),
    )


@dataclass
class FittedMoneylineWeights:
    # Order must match modelFit.ts's MONEYLINE_FEATURE_NAMES:
    # [rawLog5, venueDiff, formDiff, parkFactorCentered, eloProb, marketProbCentered, simWinProb].
    weights: list[float]
    intercept: float
    # [intercept, weights...] covariance matrix from the fit — None on older
    # fits from before uncertainty quantification existed.
    covariance: Matrix | None


@dataclass
class FittedMoneylineDiagnostics:
    """Subset of MoneylineDiagnostics the fitted-weights path needs."""
    raw_log5_home_win_prob: float
    home_venue_edge: float
    away_venue_edge: float
    raw_home_recent_edge: float
    raw_away_recent_edge: float
    park_factor: float


def _fitted_feature_vector(diag: FittedMoneylineDiagnostics, elo_prob: float, market_prob: float, sim_win_prob: float) -> list[float]:
    """Same feature order as modelFit.ts's MONEYLINE_FEATURE_NAMES — shared
    by the point-estimate and confidence-interval paths so they can never
    drift apart. `sim_win_prob` is the real per-game simulation once
    game_sim_cache has one cached for this matchup, falling back to 0.5
    (neutral) for a game with no cached sim yet."""
    return [
        diag.raw_log5_home_win_prob,
        diag.home_venue_edge - diag.away_venue_edge,
        diag.raw_home_recent_edge - diag.raw_away_recent_edge,
        diag.park_factor - 1,
        elo_prob,
        market_prob - 0.5,
        sim_win_prob,
    ]


def apply_fitted_moneyline_weights(diag: FittedMoneylineDiagnostics, elo_prob: float, market_prob: float, sim_win_prob: float, fitted: FittedMoneylineWeights) -> float:
    """Applies the fitted stacking regression in place of the hand-coded
    home/venue/form adjustment above — same raw ingredients (diagnostics),
    different combination: learned coefficients instead of the guessed
    HOME_FIELD_EDGE / MAX_SPLIT_EDGE / RECENT_FORM_WEIGHT constants.
    `elo_prob` should be 0.5 (neutral) when Elo isn't trusted yet, and
    `market_prob` should be 0.5 (neutral, centers to 0) when no live
    sportsbook line is available yet — both matching exactly how
    modelFit.ts imputed them during training."""
    features = _fitted_feature_vector(diag, elo_prob, market_prob, sim_win_prob)
    z = fitted.intercept
    for i in range(len(fitted.weights)):
        z += fitted.weights[i] * (features[i] if i < len(features) else 0)
    prob = 1 / (1 + math.exp(-z))
    return min(0.97, max(0.03, prob))


@dataclass
class MoneylineConfidenceInterval:
    # 90% Wald interval (delta method) for the HOME side's win probability —
    # same clamp as apply_fitted_moneyline_weights's point estimate.
    lower_home: float
    upper_home: float


def compute_moneyline_confidence_interval(diag: FittedMoneylineDiagnostics, elo_prob: float, market_prob: float, sim_win_prob: float, fitted: FittedMoneylineWeights) -> MoneylineConfidenceInterval | None:
    """Statistical confidence interval for the fitted prediction, from the
    regression's own covariance matrix — None when `fitted` has no
    covariance (older fit, before this existed). Always in terms of the
    HOME side; callers flip to the picked side themselves (lower/upper swap
    under 1-p)."""
    if fitted.covariance is None:
        return None
    features = _fitted_feature_vector(diag, elo_prob, market_prob, sim_win_prob)
    interval = predict_prob_with_interval(features, fitted.weights, fitted.intercept, fitted.covariance)
    return MoneylineConfidenceInterval(
        lower_home=min(0.97, max(0.03, interval.lower)),
        upper_home=min(0.97, max(0.03, interval.upper)),
    )


def _poisson_pmf(lam: float, k: int) -> float:
    """Numerically stable Poisson PMF — builds each term from the last
    rather than computing lambda^k or k! directly, which overflow for
    realistic MLB run totals."""
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    pmf = math.exp(-lam)
    for i in range(1, k + 1):
        pmf *= lam / i
    return pmf


def poisson_over_probability(lam: float, threshold: float) -> float:
    """P(over) for X ~ Poisson(lambda), with a PUSH handled as a push.

    Task 4.12 (P3 L1). `k = floor(threshold)` alone returns P(X > k), which is
    right for a half-integer line — the overwhelming majority of MLB totals —
    and WRONG for an integer one. On a line of exactly 9, X = 9 is a PUSH: the
    stake comes back. The old code scored it as a loss, understating the over.

    Conditioning on "not a push" is the standard treatment and is what a price
    on an integer line actually represents — a book quoting over 9 at -110 is
    pricing the two outcomes that can happen, not three. So:

        integer line   P(over) = P(X > k) / (1 - P(X = k))
        half-integer   P(over) = P(X > k)          (no push is possible)

    Returns the over probability only; `poisson_push_probability` below exposes
    the push mass for callers that need to price or grade it, rather than
    burying a second number in a tuple that every existing call site would have
    to unpack.
    """
    k = math.floor(threshold)
    cdf = 0.0
    for i in range(0, k + 1):
        cdf += _poisson_pmf(lam, i)
    over = 1 - cdf
    # A threshold that is exactly an integer admits a push at X == k.
    if float(threshold).is_integer():
        push = _poisson_pmf(lam, k)
        if push < 1.0:
            over = over / (1 - push)
    return min(0.99, max(0.01, over))


def poisson_push_probability(lam: float, threshold: float) -> float:
    """P(push) for X ~ Poisson(lambda) — non-zero only on an integer line
    (task 4.12, P3 L1). Half-integer lines cannot push, and return 0.0."""
    if not float(threshold).is_integer():
        return 0.0
    return _poisson_pmf(lam, int(threshold))


@dataclass
class TotalModelInput:
    home_expected_runs: float
    away_expected_runs: float
    line: float


@dataclass
class TotalModelResult:
    expected_total: float
    over_prob: float


def compute_total_model(input: TotalModelInput) -> TotalModelResult:
    """Sum of two independent Poisson variables is itself Poisson with the
    combined rate — the standard simplifying assumption here."""
    expected_total = input.home_expected_runs + input.away_expected_runs
    return TotalModelResult(
        expected_total=expected_total,
        over_prob=poisson_over_probability(expected_total, input.line),
    )


@dataclass
class FittedTotalWeights:
    # Order must match modelFit.ts's TOTAL_FEATURE_NAMES:
    # [rawPoissonOverProb, formDiff, parkFactorCentered, eloProb, marketProbCentered, lineMovement, bullpenEraCentered, simOverProb].
    weights: list[float]
    intercept: float
    # [intercept, weights...] covariance matrix from the fit — None on fits
    # from before uncertainty quantification, or before this market has ever been fit.
    covariance: Matrix | None


@dataclass
class TotalFittedDiagnostics:
    """Subset of MoneylineDiagnostics the totals fit reuses — same game,
    same raw ingredients, no need to recompute form/park separately."""
    raw_home_recent_edge: float
    raw_away_recent_edge: float
    park_factor: float


NEUTRAL_BULLPEN_ERA = 4.3


def _fitted_total_feature_vector(
    raw_over_prob: float,
    diag: TotalFittedDiagnostics,
    elo_prob: float,
    market_prob: float,
    line_movement: float,
    home_bullpen_era: float | None,
    away_bullpen_era: float | None,
    sim_over_prob: float,
) -> list[float]:
    """Same feature order as modelFit.ts's TOTAL_FEATURE_NAMES — shared by
    the point-estimate and confidence-interval paths so they can never
    drift apart. `line_movement` is 0 (no signal) when there's no reliable
    "opening" reference to compare against; `home_bullpen_era`/
    `away_bullpen_era` fall back to the neutral reference individually when
    unavailable. `sim_over_prob` is the real per-game simulation's expected
    total, converted to an over-probability against today's actual line,
    once game_sim_cache has one cached for this matchup — falls back to
    raw_over_prob's own value (the sim contributing "no additional signal
    beyond the existing formula" is the honest neutral point for a
    probability feature, unlike a flat 0.5) for a game with no cached sim yet."""
    bullpen_era_centered = (
        (home_bullpen_era if home_bullpen_era is not None else NEUTRAL_BULLPEN_ERA) / 2
        + (away_bullpen_era if away_bullpen_era is not None else NEUTRAL_BULLPEN_ERA) / 2
        - NEUTRAL_BULLPEN_ERA
    )
    return [
        raw_over_prob,
        diag.raw_home_recent_edge - diag.raw_away_recent_edge,
        diag.park_factor - 1,
        elo_prob,
        market_prob - 0.5,
        line_movement,
        bullpen_era_centered,
        sim_over_prob,
    ]


def apply_fitted_total_weights(
    raw_over_prob: float,
    diag: TotalFittedDiagnostics,
    elo_prob: float,
    market_prob: float,
    line_movement: float,
    home_bullpen_era: float | None,
    away_bullpen_era: float | None,
    sim_over_prob: float,
    fitted: FittedTotalWeights,
) -> float:
    """Applies the fitted total-market stacking regression in place of the
    flat 0.5-weight market blend `runTotalLockCycle` otherwise falls back
    to — same raw ingredients as the live Poisson formula (raw_over_prob)
    plus form/park/Elo/market/line-movement/bullpen signals, learned
    coefficients instead of a guessed blend weight."""
    features = _fitted_total_feature_vector(raw_over_prob, diag, elo_prob, market_prob, line_movement, home_bullpen_era, away_bullpen_era, sim_over_prob)
    z = fitted.intercept
    for i in range(len(fitted.weights)):
        z += fitted.weights[i] * (features[i] if i < len(features) else 0)
    prob = 1 / (1 + math.exp(-z))
    return min(0.97, max(0.03, prob))


@dataclass
class TotalConfidenceInterval:
    # 90% Wald interval (delta method) for the OVER probability — same
    # clamp as apply_fitted_total_weights's point estimate.
    lower_over: float
    upper_over: float


def compute_total_confidence_interval(
    raw_over_prob: float,
    diag: TotalFittedDiagnostics,
    elo_prob: float,
    market_prob: float,
    line_movement: float,
    home_bullpen_era: float | None,
    away_bullpen_era: float | None,
    sim_over_prob: float,
    fitted: FittedTotalWeights,
) -> TotalConfidenceInterval | None:
    """Statistical confidence interval for the fitted total prediction,
    from the regression's own covariance matrix — None when `fitted` has
    no covariance. Always in terms of OVER; callers flip to the picked side
    themselves (lower/upper swap under 1-p), same convention as
    compute_moneyline_confidence_interval."""
    if fitted.covariance is None:
        return None
    features = _fitted_total_feature_vector(raw_over_prob, diag, elo_prob, market_prob, line_movement, home_bullpen_era, away_bullpen_era, sim_over_prob)
    interval = predict_prob_with_interval(features, fitted.weights, fitted.intercept, fitted.covariance)
    return TotalConfidenceInterval(
        lower_over=min(0.97, max(0.03, interval.lower)),
        upper_over=min(0.97, max(0.03, interval.upper)),
    )
