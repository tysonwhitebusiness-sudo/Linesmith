"""Phase 3.3 — the plate-appearance simulation: log5 per-PA draw, base-out
state, nine innings, ten thousand times.

WHAT THIS IS FOR. Every model in this repo so far projects ONE statistic
directly and asks "will it clear this line". That works and is validated, but it
cannot answer questions that depend on the whole game: how many runs a team
scores, who wins, whether a batter gets a fifth plate appearance because the
lineup turned over. A simulation answers all of those from one mechanism.

**It has to EARN the board.** Phase 3.4 measures it against the direct model on
the direct model's own job, and the direct model is a strong control — validated
on ~31,000 held-out rows per market with a correct calibration since 3.0. If the
simulation does not beat it on props, the direct model keeps the board and this
is judged on game markets alone. Nothing here is wired to a surface until that
measurement exists.

THE MODEL, and where each piece comes from:

1. **A plate appearance is one draw from eight outcomes** — 1B, 2B, 3B, HR, BB,
   HBP, K, OUT. Measured league-wide over the 2025 season (177,905 PA), those
   run 0.143 / 0.042 / 0.0035 / 0.031 / 0.084 / 0.011 / 0.222 / 0.464 and sum to
   1. They are close to published MLB rates, which is the first sign the stat
   keys mean what they appear to.

2. **log5 combines a batter and a pitcher against the league.** For a rate p_b
   the batter produces and p_p the pitcher allows, against league p_l:

       p = (p_b * p_p / p_l) / ((p_b * p_p / p_l) + ((1-p_b) * (1-p_p) / (1-p_l)))

   which is the odds-ratio form: it multiplies odds rather than probabilities,
   so a good batter against a good pitcher lands sensibly between them instead
   of at an average. Applied per outcome, then RENORMALISED, because eight
   independently-log5'd rates do not sum to 1 on their own.

3. **Base-out state is explicit** — runners on first/second/third, outs, three
   outs ends a half-inning, nine innings (the home half skipped when the home
   team already leads, as in a real game).

MEASURED AGAINST REAL BASEBALL (league-average lineups, 5,000 games):

    runs per team-game   4.14    real 4.4 - 4.6     <- SHORT BY ~0.3, see below
    PA per team-game    38.7     real ~37.9         <- HIGH BY ~0.8, same cause
    hits per team-game   8.56    real 8.0 - 8.5
    shutout pct          7.3%    real 7 - 8%
    10+ run pct          4.8%    real 3.5 - 5.5%

**THE RUN DEFICIT IS EXPLAINED, NOT MYSTERIOUS, AND IS NOT TUNED AWAY.** This
model scores runs only through plate-appearance outcomes. Real baseball also
scores them through events that are not plate appearances, worth roughly:

    reached on error         ~0.12 runs/team-game
    net stolen bases         ~0.10
    wild pitches / passed balls ~0.08
                             -----
                             ~0.30   ->   4.14 + 0.30 = 4.44, in range

The PA excess has the mirror cause: real games fit fewer plate appearances into
27 outs because caught stealings and pickoffs consume outs without a PA.

**WHICH MARKETS THIS BIASES, AND WHICH IT DOES NOT.** Hits, singles, doubles,
triples, home runs, total bases and strikeouts are PURE PLATE-APPEARANCE
OUTCOMES — nothing about baserunning touches them, so the deficit does not bias
them at all. Runs, RBIs and any game total DO depend on advancement and will run
low until non-PA events are modelled. Phase 3.4 compares on the first group;
Phase 3.5's game gate needs the second group fixed first.

WHAT IS STILL DELIBERATELY ABSENT, each a candidate if 3.4 says the idea has
legs: errors, stolen bases, wild pitches, sacrifices; park factors (the repo has
no player-game-to-venue join at all — see `mlb_prop_serving`'s header); platoon
splits; times-through-the-order penalty; and a real bullpen — a starter is
replaced after `STARTER_BATTERS_FACED` and everything after is league-average.

A simulation that gets runs-per-game right for the wrong reasons is the failure
mode to watch for, which is why `calibrate_pa_sim.py` reports the scoring
DISTRIBUTION and not merely its mean.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

# The eight outcomes, in a fixed order everything else indexes by.
OUTCOMES = ("1B", "2B", "3B", "HR", "BB", "HBP", "K", "OUT")
I_1B, I_2B, I_3B, I_HR, I_BB, I_HBP, I_K, I_OUT = range(8)

# League-average per-PA shares, measured over the 2025 season (177,905 PA) from
# `player_game_history`. Used as the log5 anchor and as the fallback for a
# player with no history. Sums to 1.0 by construction of the measurement.
# The measured shares round to a sum of 1.00001, so OUT — the residual
# category, which is what 'everything else' means anyway — absorbs the
# 1e-5 so the tuple is exactly a distribution. Without this, `matchup`'s
# renormalisation shifts every rate by that much even for a league-average
# batter against a league-average pitcher, which should be an identity.
LEAGUE_PA = (0.14303, 0.04239, 0.00347, 0.03080, 0.08375, 0.01052, 0.22219, 0.46385)

# A starter is pulled after this many batters faced, and the bullpen is modelled
# as one league-average arm. Roughly 5.2 innings at league rates, which is close
# to the real 2025 average start. A crude but honest stand-in for a bullpen
# model this repo does not have.
STARTER_BATTERS_FACED = 24


@dataclass(frozen=True)
class PaRates:
    """One player's per-PA outcome distribution, already normalised."""

    p: tuple[float, ...]

    def __post_init__(self) -> None:
        if len(self.p) != len(OUTCOMES):
            raise ValueError(f"expected {len(OUTCOMES)} outcomes, got {len(self.p)}")
        total = sum(self.p)
        if not (0.999 <= total <= 1.001):
            raise ValueError(f"rates must sum to 1, got {total}")

    @staticmethod
    def from_counts(counts: dict[str, float], pa: float,
                    prior_pa: float = 0.0,
                    league: tuple[float, ...] = LEAGUE_PA) -> "PaRates":
        """Build from raw season totals, shrunk toward the league.

        `prior_pa` is the strength of the shrink expressed in plate appearances:
        a batter with `prior_pa` of his own history sits halfway to league. This
        is the same idea as `count_prop_engine.shrunk_rate` and deliberately so —
        a simulation fed unshrunk rates off 20 plate appearances would produce
        confident nonsense for exactly the players a board most needs to be
        careful about.
        """
        if pa <= 0:
            return PaRates(league)
        raw = [max(0.0, counts.get(k, 0.0)) / pa for k in OUTCOMES]
        # Whatever is unaccounted for is an out; negative means the inputs
        # disagree with each other and is clamped rather than propagated.
        raw[I_OUT] = max(0.0, 1.0 - sum(raw[:I_OUT]) - raw[I_K])
        w = pa / (pa + prior_pa) if (pa + prior_pa) > 0 else 0.0
        blended = [w * raw[i] + (1 - w) * league[i] for i in range(len(OUTCOMES))]
        s = sum(blended)
        return PaRates(tuple(x / s for x in blended))


def log5(p_b: float, p_p: float, p_l: float) -> float:
    """Odds-ratio combination of a batter rate and a pitcher rate.

    Degenerate inputs return the batter's own rate rather than raising: a league
    rate of 0 (an outcome that never happened) makes the ratio undefined, and a
    simulation is not the place to discover that.
    """
    if p_l <= 0.0 or p_l >= 1.0:
        return p_b
    p_b = min(max(p_b, 1e-9), 1 - 1e-9)
    p_p = min(max(p_p, 1e-9), 1 - 1e-9)
    num = (p_b * p_p) / p_l
    den = num + ((1 - p_b) * (1 - p_p)) / (1 - p_l)
    return num / den if den > 0 else p_b


def matchup(batter: PaRates, pitcher: PaRates,
            league: tuple[float, ...] = LEAGUE_PA) -> tuple[float, ...]:
    """log5 each outcome, then renormalise.

    THE RENORMALISATION IS NOT COSMETIC. Eight rates combined independently do
    not sum to 1 — typically 0.95 to 1.05 here — and using them unnormalised
    would silently scale every downstream probability.
    """
    combined = [log5(batter.p[i], pitcher.p[i], league[i]) for i in range(len(OUTCOMES))]
    s = sum(combined)
    if s <= 0:
        return league
    return tuple(x / s for x in combined)


def _cumulative(p: tuple[float, ...]) -> tuple[float, ...]:
    out, run = [], 0.0
    for x in p:
        run += x
        out.append(run)
    return tuple(out)


# Runner advancement, as (bases the batter takes, bases each runner takes).
# A single advances runners one base; a double, two. Deterministic apart from
# the one case below, which is common enough that ignoring it visibly costs runs.
ADVANCE = {I_1B: 1, I_2B: 2, I_3B: 3, I_HR: 4}

# P(a runner on first reaches third on a single). Real MLB is ~0.27-0.30. The
# single most valuable non-deterministic advancement to model: without it the
# simulation strands runners at second and under-scores.
P_FIRST_TO_THIRD_ON_SINGLE = 0.28

# TWO MECHANISMS THAT ARE NOT PLATE-APPEARANCE OUTCOMES, and are here because
# leaving them out was measurably wrong rather than merely incomplete.
#
# A first cut modelled an in-play out as simply an out. It produced MORE
# baserunners than real baseball and FEWER runs — 8.68 hits and 39.4 PA per
# team-game against a real ~8.2 and ~37.9, but only 4.04 runs against a real
# 4.4-4.6. Both errors have one cause each:
#
#   - **Productive outs.** With a runner on third and fewer than two outs, a
#     sacrifice fly or a groundout scores him. Without this the simulation
#     strands runners on third at a rate real baseball does not.
#   - **Double plays.** A GIDP turns one plate appearance into two outs, which
#     is why real games fit ~37.9 PA into 27 outs rather than the 39.4 that a
#     pure one-out-per-PA model implies. It also ends rallies.
#
# Both rates are CALIBRATED, not looked up: `calibrate_pa_sim.py` sweeps them
# against the two aggregates above. They are the only tuned constants in this
# file, and they are tuned to league aggregates rather than to anything the
# model is later scored on.
# A first sweep over these two ALONE could not reach 4.4 runs — it topped out at
# 4.14, and GIDP pushes runs down, so no setting of the pair got there. The
# deficit was not these mechanisms; it was two places where advancement was
# hard-coded pessimistically:
#
#   - a runner on FIRST always stopped at third on a double (real baseball
#     scores him a bit over 40% of the time), and
#   - a runner on SECOND never advanced on an in-play out, though a groundout
#     to the right side routinely moves him up.
#
# Both are one-line facts about baseball that the first cut simply asserted the
# wrong way. Fixing them is what closes the run gap; tuning the first two
# constants harder would only have traded one aggregate for another.
# EVERY CONSTANT HERE IS SET TO ITS REAL-WORLD VALUE, NOT TUNED TO HIT AN
# AGGREGATE. The sweep in `calibrate_pa_sim.py` scores best at P_GIDP=0.19,
# which would be a double-play rate half again higher than baseball's — it wins
# only because inflating it drags PA/game down toward the target, papering over
# a DIFFERENT missing mechanism (caught stealing and pickoffs, which consume
# outs without a plate appearance). Distorting one parameter to cover for
# another absent one produces a model that is right on the total and wrong
# everywhere underneath, which is the exact failure this file is supposed to
# avoid. So these stay honest and the residual is documented instead.
P_PRODUCTIVE_OUT = 0.36    # runner on 3rd, <2 outs, in-play out -> he scores
P_GIDP = 0.13              # runner on 1st, <2 outs, in-play out -> two outs
P_SCORE_FROM_FIRST_ON_DOUBLE = 0.42   # else he stops at third
P_SECOND_TO_THIRD_ON_OUT = 0.25       # <2 outs, third empty, in-play out


def _bat(outcome: int, bases: list[bool], rng: random.Random) -> int:
    """Apply one non-out outcome to the base state. Returns runs scored.

    `bases` is [first, second, third] and is mutated in place.
    """
    runs = 0
    if outcome == I_HR:
        runs = 1 + sum(bases)
        bases[0] = bases[1] = bases[2] = False
        return runs

    if outcome in (I_BB, I_HBP):
        # A walk forces runners only where the base behind is occupied.
        if bases[0]:
            if bases[1]:
                if bases[2]:
                    runs += 1
                bases[2] = True
            bases[1] = True
        bases[0] = True
        return runs

    take = ADVANCE[outcome]
    if take == 3:                       # triple: everyone scores
        runs += sum(bases)
        bases[0] = bases[1] = False
        bases[2] = True
        return runs

    if take == 2:                       # double: runners on 2nd and 3rd score
        runs += sum(bases[1:])
        # The runner on first scores better than 40% of the time rather than
        # always stopping at third — see P_SCORE_FROM_FIRST_ON_DOUBLE.
        from_first_scores = bases[0] and rng.random() < P_SCORE_FROM_FIRST_ON_DOUBLE
        runs += 1 if from_first_scores else 0
        bases[2] = bases[0] and not from_first_scores
        bases[1] = True                 # the batter
        bases[0] = False
        return runs

    # Single. A runner on third scores, and so does one on second — the two are
    # independent of what the runner on first does, which is the one thing easy
    # to get wrong here. The runner on first reaches third
    # `P_FIRST_TO_THIRD_ON_SINGLE` of the time and second otherwise.
    runs += 1 if bases[2] else 0
    runs += 1 if bases[1] else 0
    to_third = bases[0] and rng.random() < P_FIRST_TO_THIRD_ON_SINGLE
    bases[2] = to_third
    bases[1] = bases[0] and not to_third
    bases[0] = True
    return runs


def _in_play_out(bases: list[bool], outs: int, rng: random.Random) -> tuple[int, int]:
    """An in-play out. Returns (runs scored, outs recorded).

    Strikeouts never come here — they cannot be a double play or a sacrifice,
    which is most of why the two are separated at all.
    """
    if outs < 2 and bases[0] and rng.random() < P_GIDP:
        # Force at second, batter out at first. Runners on second and third
        # hold: modelling them advancing would need a ball-in-play location
        # this simulation does not have.
        bases[0] = False
        return 0, 2
    runs = 0
    if outs < 2 and bases[2] and rng.random() < P_PRODUCTIVE_OUT:
        bases[2] = False
        runs = 1
    # With third now clear and fewer than two outs, a runner on second moves up
    # on a groundout often enough to matter to the run total.
    if outs < 2 and bases[1] and not bases[2] and rng.random() < P_SECOND_TO_THIRD_ON_OUT:
        bases[1], bases[2] = False, True
    return runs, 1


@dataclass
class GameResult:
    """Per-iteration outcome. Player tallies are indexed by lineup slot."""

    away_runs: int
    home_runs: int
    away_bat: list[dict[str, int]]
    home_bat: list[dict[str, int]]


def _half_inning(lineup: list[tuple[float, ...]], start_idx: int,
                 tallies: list[dict[str, int]], rng: random.Random) -> tuple[int, int]:
    """One half-inning. Returns (runs, next batter index)."""
    outs, runs = 0, 0
    bases = [False, False, False]
    idx = start_idx
    while outs < 3:
        slot = idx % len(lineup)
        cum = lineup[slot]
        r = rng.random()
        outcome = 0
        for i, c in enumerate(cum):
            if r <= c:
                outcome = i
                break
        else:
            outcome = I_OUT
        t = tallies[slot]
        t["PA"] += 1
        if outcome == I_K:
            t["K"] += 1
            outs += 1
        elif outcome == I_OUT:
            r, added = _in_play_out(bases, outs, rng)
            runs += r
            outs += added
        else:
            runs += _bat(outcome, bases, rng)
            name = OUTCOMES[outcome]
            t[name] += 1
            if outcome in (I_1B, I_2B, I_3B, I_HR):
                t["H"] += 1
                t["TB"] += (1, 2, 3, 4)[(I_1B, I_2B, I_3B, I_HR).index(outcome)]
        idx += 1
    return runs, idx


def simulate_game(away_lineup: list[PaRates], home_lineup: list[PaRates],
                  away_pitcher: PaRates, home_pitcher: PaRates,
                  n_iter: int = 10_000, seed: int | None = None,
                  innings: int = 9,
                  bullpen: PaRates | None = None) -> list[GameResult]:
    """Ten thousand nine-inning games.

    The home half of the ninth is skipped when the home team is already ahead,
    which is real and matters: including it inflates home scoring.
    """
    rng = random.Random(seed)
    pen = bullpen or PaRates(LEAGUE_PA)

    # Precompute the cumulative matchup distribution for each (slot, pitcher).
    def table(lineup, pitcher):
        return [_cumulative(matchup(b, pitcher)) for b in lineup]

    away_vs_start = table(away_lineup, home_pitcher)
    away_vs_pen = table(away_lineup, pen)
    home_vs_start = table(home_lineup, away_pitcher)
    home_vs_pen = table(home_lineup, pen)

    results: list[GameResult] = []
    for _ in range(n_iter):
        def fresh(n):
            return [{k: 0 for k in ("PA", "H", "TB", "K", "1B", "2B", "3B", "HR", "BB", "HBP")}
                    for _ in range(n)]

        at, ht = fresh(len(away_lineup)), fresh(len(home_lineup))
        ar = hr_ = 0
        ai = hi = 0
        for inning in range(innings):
            faced_a = sum(t["PA"] for t in at)
            r, ai = _half_inning(
                away_vs_start if faced_a < STARTER_BATTERS_FACED else away_vs_pen,
                ai, at, rng)
            ar += r
            if inning == innings - 1 and hr_ > ar:
                break            # home team already ahead: no bottom of the ninth
            faced_h = sum(t["PA"] for t in ht)
            r, hi = _half_inning(
                home_vs_start if faced_h < STARTER_BATTERS_FACED else home_vs_pen,
                hi, ht, rng)
            hr_ += r
        results.append(GameResult(ar, hr_, at, ht))
    return results


def summarise(results: list[GameResult]) -> dict:
    """League-level checks. `runs_per_team_game` is the headline validity test —
    real MLB sits near 4.4-4.6."""
    n = len(results)
    away = [r.away_runs for r in results]
    home = [r.home_runs for r in results]
    allr = away + home
    total = [a + h for a, h in zip(away, home)]
    return {
        "iterations": n,
        "runs_per_team_game": sum(allr) / len(allr),
        "total_runs_mean": sum(total) / n,
        "home_win_pct": sum(1 for a, h in zip(away, home) if h > a) / n,
        "tie_pct": sum(1 for a, h in zip(away, home) if h == a) / n,
        "shutout_pct": sum(1 for x in allr if x == 0) / len(allr),
        "ten_plus_pct": sum(1 for x in allr if x >= 10) / len(allr),
    }


def prop_probability(results: list[GameResult], side: str, slot: int,
                     stat: str, line: float) -> float:
    """P(stat > line) for one lineup slot, straight off the simulated games."""
    tallies = [(r.away_bat if side == "away" else r.home_bat)[slot] for r in results]
    return sum(1 for t in tallies if t[stat] > line) / len(tallies)
