"""Direct port of lib/sports/mlb/simEngine.ts — not a reimplementation.
Play-by-play simulation engine — per-plate-appearance Markov chain over the
standard 24-state base/out machine. See
docs/mlb-prediction-engine-python-port-gameplan-2026-08-21.md for the full
port plan this file is Phase A of.

Pure math, no DB/network access — every function takes its inputs as plain
arguments/callables, same as the TS source. A caller supplies a stream of
outcome vectors (one per PA); this file only knows how to turn a stream of
PA outcomes into runs.

v1 deterministic advancement (advance_state) and the per-category
independent-Beta shrinkage (dirichlet_shrunk_vector, NOT a true Dirichlet
posterior) are disclosed, deliberate simplifications documented in
docs/mlb-sim-engine-plan.md — not bugs to "fix" during porting.
"""
import math
from dataclasses import dataclass, field
from typing import Callable

Outcome = str  # one of OUTCOME_ORDER below — Python has no cheap closed string-union type

# Fixed order every OutcomeVector uses — sample_outcome walks this order, so
# any array-based representation must match it exactly.
OUTCOME_ORDER: list[Outcome] = ["BB", "K", "1B", "2B", "3B", "HR", "OUT"]

# Probability of each outcome for one plate appearance — must sum to ~1
# (sample_outcome normalizes defensively, but a caller should keep this a
# real distribution). dict[Outcome, float].
OutcomeVector = dict[str, float]

# Uniform [0,1) generator, injected everywhere rather than a global RNG —
# same reproducibility-friendly shape as the TS source's `Rng` type.
Rng = Callable[[], float]


def make_outcome_vector(rates: dict[str, float]) -> OutcomeVector:
    v: OutcomeVector = {k: 0.0 for k in OUTCOME_ORDER}
    for key in OUTCOME_ORDER:
        v[key] = rates.get(key, 0.0)
    return v


def sample_outcome(vector: OutcomeVector, rng: Rng) -> Outcome:
    total = sum(vector[k] for k in OUTCOME_ORDER)
    r = rng() * (total if total > 0 else 1)
    cumulative = 0.0
    for key in OUTCOME_ORDER:
        cumulative += vector[key]
        if r < cumulative:
            return key
    return "OUT"  # floating-point fallback — should only trigger on a vector that sums to ~0


# Base/out state — `bases` is a 3-bit occupancy mask (bit 0 = runner on 1st,
# bit 1 = 2nd, bit 2 = 3rd), `outs` is 0-2 (3 outs ends the half-inning,
# handled by the caller, not represented as a state here).
@dataclass
class BaseOutState:
    outs: int
    bases: int


FIRST = 1
SECOND = 2
THIRD = 4


@dataclass
class AdvanceResult:
    next: BaseOutState
    runs_scored: int


def advance_state(state: BaseOutState, outcome: Outcome) -> AdvanceResult:
    """v1 deterministic advancement — see docs/mlb-sim-engine-plan.md §1 for
    the exact rules and the disclosed simplification (a runner on 2nd/3rd
    always scores on a single/double rather than a real per-situation
    probability). A v2 probabilistic-advancement upgrade replaces only this
    function's body — nothing else in this file needs to change when that
    upgrade lands."""
    on_first = (state.bases & FIRST) != 0
    on_second = (state.bases & SECOND) != 0
    on_third = (state.bases & THIRD) != 0

    if outcome == "K" or outcome == "OUT":
        return AdvanceResult(next=BaseOutState(outs=state.outs + 1, bases=state.bases), runs_scored=0)

    if outcome == "BB":
        # Force advancement only where the chain of occupied bases requires it.
        runs = 0
        bases = state.bases
        if on_first:
            if on_second:
                if on_third:
                    runs += 1  # bases loaded walk forces in a run
                bases |= THIRD
            bases |= SECOND
        bases |= FIRST
        return AdvanceResult(next=BaseOutState(outs=state.outs, bases=bases), runs_scored=runs)

    if outcome == "1B":
        runs = 0
        if on_third:
            runs += 1
        if on_second:
            runs += 1
        bases = FIRST
        if on_first:
            bases |= SECOND
        return AdvanceResult(next=BaseOutState(outs=state.outs, bases=bases), runs_scored=runs)

    if outcome == "2B":
        runs = (1 if on_first else 0) + (1 if on_second else 0) + (1 if on_third else 0)
        return AdvanceResult(next=BaseOutState(outs=state.outs, bases=SECOND), runs_scored=runs)

    # '3B' or 'HR' — everyone scores, batter included for a HR (bases empty
    # after); a triple leaves the batter on 3rd.
    runs_ahead = (1 if on_first else 0) + (1 if on_second else 0) + (1 if on_third else 0)
    if outcome == "HR":
        return AdvanceResult(next=BaseOutState(outs=state.outs, bases=0), runs_scored=runs_ahead + 1)
    return AdvanceResult(next=BaseOutState(outs=state.outs, bases=THIRD), runs_scored=runs_ahead)


def simulate_half_inning(
    next_vector: Callable[[], OutcomeVector],
    rng: Rng,
    stop_if_lead_taken: Callable[[int], bool] | None = None,
) -> int:
    """Plays out one half-inning. `next_vector` is called once per PA.
    `stop_if_lead_taken` (walk-off) ends the half-inning the instant the
    batting team takes the lead, before the third out — only ever relevant
    for the home team's bottom-of-9th-or-later at-bat."""
    outs = 0
    bases = 0
    runs = 0
    while outs < 3:
        outcome = sample_outcome(next_vector(), rng)
        result = advance_state(BaseOutState(outs=outs, bases=bases), outcome)
        outs = result.next.outs
        bases = result.next.bases
        runs += result.runs_scored
        if stop_if_lead_taken is not None and stop_if_lead_taken(runs):
            break
    return runs


@dataclass
class GameSimResult:
    home_runs: int
    away_runs: int
    innings: int


MAX_INNINGS_SAFETY = 30  # real games essentially never go this deep — a hard stop against a runaway RNG edge case, not a rules limit


def simulate_game(
    home_vector_stream: Callable[[], OutcomeVector],
    away_vector_stream: Callable[[], OutcomeVector],
    rng: Rng,
) -> GameSimResult:
    """Standard 9-inning-plus-extras game loop: away bats first each inning;
    home skips its bottom half if already ahead after 9+ (no need for the
    "extra" at-bat); a walk-off ends the bottom half instantly once home
    takes the lead in the 9th or later."""
    home_runs = 0
    away_runs = 0
    inning = 1
    while inning <= MAX_INNINGS_SAFETY:
        away_runs += simulate_half_inning(away_vector_stream, rng)
        if inning >= 9 and home_runs > away_runs:
            break  # home already won — no bottom half needed
        before = home_runs
        stop_fn = (lambda runs_this_half, _before=before: _before + runs_this_half > away_runs) if inning >= 9 else None
        home_runs += simulate_half_inning(home_vector_stream, rng, stop_fn)
        if inning >= 9 and home_runs != away_runs:
            break  # decided at the end of a completed inning 9+
        inning += 1
    return GameSimResult(home_runs=home_runs, away_runs=away_runs, innings=inning)


def simulate_games(home_vector: OutcomeVector, away_vector: OutcomeVector, n: int, rng: Rng) -> list[GameSimResult]:
    """Runs simulate_game `n` times with fixed (non-lineup-varying) vector
    streams — the flat-vector shape still used today by simulate_team_matchup
    in sim_game.py, distinct from the full lineup-vs-pitching-staff path."""
    results: list[GameSimResult] = []
    for _ in range(n):
        results.append(simulate_game(lambda: home_vector, lambda: away_vector, rng))
    return results


# ---------------------------------------------------------------------------
# Dirichlet-multinomial-style shrinkage
# ---------------------------------------------------------------------------

# How many plate appearances of league-average behavior each outcome's prior
# is worth before a batter's own real data takes over — Russell Carleton's
# published stat-stabilization-point research: strikeout rate stabilizes
# fastest (~40-60 PA), walk rate next (~100-200 PA), contact-quality/power
# outcomes slowest (HR ~170 PA, extra-base hits generally 300+, triples
# essentially never stabilize in a single season — hence the very high prior
# strength). v1 hand-set and disclosed, not yet fit against real graded
# outcomes.
OUTCOME_PRIOR_STRENGTH: dict[str, float] = {
    "K": 60,
    "BB": 200,
    "1B": 300,
    "2B": 300,
    "3B": 1000,
    "HR": 170,
    "OUT": 60,
}


def dirichlet_shrunk_vector(
    counts: OutcomeVector,
    league_rates: OutcomeVector,
    prior_strength: dict[str, float] | None = None,
) -> OutcomeVector:
    """Per-category Beta shrinkage, then renormalized into a valid
    7-category distribution — NOT a textbook Dirichlet-multinomial
    posterior. See the TS source's own extensive comment for why a true
    Dirichlet with per-category-varying prior strength does NOT reduce to
    league_rates on zero observations (categories with a larger strength get
    proportionally over-weighted in the shared normalizer), and why this
    per-category-independent formula is the deliberate fix: shrunk_i =
    (leagueRate_i*strength_i + count_i) / (strength_i + totalPA), which
    correctly returns exactly league_rate_i on zero observations regardless
    of strength_i, then renormalized to sum to 1."""
    if prior_strength is None:
        prior_strength = OUTCOME_PRIOR_STRENGTH
    total_pa = sum(counts[k] for k in OUTCOME_ORDER)
    shrunk: dict[str, float] = {}
    for key in OUTCOME_ORDER:
        strength = prior_strength[key]
        shrunk[key] = (league_rates[key] * strength + counts[key]) / (strength + total_pa)
    denom = sum(shrunk[k] for k in OUTCOME_ORDER)
    out: dict[str, float] = {}
    for key in OUTCOME_ORDER:
        out[key] = shrunk[key] / denom if denom > 0 else league_rates[key]
    return make_outcome_vector(out)


# ---------------------------------------------------------------------------
# Pitcher blending via the odds-ratio method
# ---------------------------------------------------------------------------

def _clamp_rate(rate: float) -> float:
    """Keeps a rate strictly inside (0,1) before taking odds — a rate of
    exactly 0 or 1 makes odds 0 or infinite."""
    return min(0.999, max(0.001, rate))


def _odds(rate: float) -> float:
    r = _clamp_rate(rate)
    return r / (1 - r)


def blend_batter_pitcher_vector(batter_vector: OutcomeVector, pitcher_vector: OutcomeVector, league_rates: OutcomeVector) -> OutcomeVector:
    """Generalizes log5 from one binary outcome to all 7 categories at once:
    for each category independently, combine the batter's own
    rate-vs-league odds-ratio with the pitcher's own allowed-rate-vs-league
    odds-ratio, multiply, convert back to a probability — then renormalize
    across all 7 categories so the result is a valid distribution again.

    A league-average batter facing a league-average pitcher gets back
    league_rates unchanged (both odds-ratios are 1)."""
    combined: dict[str, float] = {}
    for key in OUTCOME_ORDER:
        odds_league = _odds(league_rates[key])
        or_batter = _odds(batter_vector[key]) / odds_league
        or_pitcher = _odds(pitcher_vector[key]) / odds_league
        odds_combined = odds_league * or_batter * or_pitcher
        combined[key] = odds_combined / (1 + odds_combined)
    total = sum(combined[k] for k in OUTCOME_ORDER)
    out: dict[str, float] = {}
    for key in OUTCOME_ORDER:
        out[key] = combined[key] / total if total > 0 else league_rates[key]
    return make_outcome_vector(out)


# ---------------------------------------------------------------------------
# Starter/bullpen handoff
# ---------------------------------------------------------------------------

# ~4.3 batters faced per inning of work is a standard sabermetric rule of
# thumb (roughly 3 outs plus the extra baserunners an inning typically allows).
BATTERS_FACED_PER_INNING = 4.3


def make_starter_bullpen_stream(starter_vector: OutcomeVector, bullpen_vector: OutcomeVector, expected_innings_per_start: float) -> Callable[[], OutcomeVector]:
    """A stateful PA-count-based handoff — approximates "pull the starter
    after roughly his average innings/start" without needing
    simulate_half_inning to report real outs back to this closure.
    expected_innings_per_start * ~4.3 sets the batter count the starter is
    expected to face before the bullpen (one single blended vector, not
    per-reliever) takes over for the rest of the game."""
    handoff_after_batters = max(1, round(expected_innings_per_start * BATTERS_FACED_PER_INNING))
    state = {"faced": 0}

    def stream() -> OutcomeVector:
        state["faced"] += 1
        return starter_vector if state["faced"] <= handoff_after_batters else bullpen_vector

    return stream


# ---------------------------------------------------------------------------
# Park factors
# ---------------------------------------------------------------------------

# HR, 2B, and 3B are the outcomes a park's dimensions/altitude/air density
# actually change — a walk or strikeout doesn't care how far the fences are.
PARK_SENSITIVE_OUTCOMES: list[Outcome] = ["2B", "3B", "HR"]


def apply_park_factor(vector: OutcomeVector, park_factor: float) -> OutcomeVector:
    """Scales the park-sensitive categories by park_factor, then
    renormalizes the whole vector back to a valid distribution.
    park_factor == 1 (neutral park, or unknown venue) leaves the vector
    completely unchanged."""
    if park_factor == 1:
        return vector
    adjusted: dict[str, float] = dict(vector)
    for key in PARK_SENSITIVE_OUTCOMES:
        adjusted[key] = vector[key] * park_factor
    total = sum(adjusted[k] for k in OUTCOME_ORDER)
    out: dict[str, float] = {}
    for key in OUTCOME_ORDER:
        out[key] = adjusted[key] / total if total > 0 else vector[key]
    return make_outcome_vector(out)


# ---------------------------------------------------------------------------
# Full-lineup-vs-pitching-staff stream (composes the pieces above)
# ---------------------------------------------------------------------------

@dataclass
class PrecomputedLineupVsPitching:
    vs_starter: list[OutcomeVector]
    vs_bullpen: list[OutcomeVector]
    handoff_after_batters: int


def precompute_lineup_vs_pitching(
    lineup_vectors: list[OutcomeVector],
    starter_vector: OutcomeVector,
    bullpen_vector: OutcomeVector,
    league_rates: OutcomeVector,
    expected_innings_per_start: float,
    park_factor: float,
) -> PrecomputedLineupVsPitching:
    """The expensive half: blends all 9 lineup slots against both the
    starter and the bullpen, with park factor applied — 18 vectors, computed
    ONCE for a given matchup regardless of how many of the N games get
    simulated against it."""
    if len(lineup_vectors) == 0:
        raise ValueError("precompute_lineup_vs_pitching: empty lineup")
    return PrecomputedLineupVsPitching(
        vs_starter=[apply_park_factor(blend_batter_pitcher_vector(v, starter_vector, league_rates), park_factor) for v in lineup_vectors],
        vs_bullpen=[apply_park_factor(blend_batter_pitcher_vector(v, bullpen_vector, league_rates), park_factor) for v in lineup_vectors],
        handoff_after_batters=max(1, round(expected_innings_per_start * BATTERS_FACED_PER_INNING)),
    )


def make_lineup_vs_pitching_stream(precomputed: PrecomputedLineupVsPitching, lineup_size: int) -> Callable[[], OutcomeVector]:
    """The cheap half: a fresh, independently-stateful per-game stream from
    an already-precomputed matchup — call this once per simulated game (its
    counters must start at 0 for each new game), reuse the same
    PrecomputedLineupVsPitching across all N of them."""
    vs_starter = precomputed.vs_starter
    vs_bullpen = precomputed.vs_bullpen
    handoff_after_batters = precomputed.handoff_after_batters
    state = {"batters_faced": 0, "order_index": 0}

    def stream() -> OutcomeVector:
        state["batters_faced"] += 1
        slot = state["order_index"] % lineup_size
        state["order_index"] += 1
        return vs_starter[slot] if state["batters_faced"] <= handoff_after_batters else vs_bullpen[slot]

    return stream
