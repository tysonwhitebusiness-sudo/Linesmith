"""The plate-appearance simulation produces baseball, not merely numbers.

Phase 3.3 of docs/master-plan-2026-09-06.md (2026-09-07).

A Monte Carlo is easy to write and hard to know you got right: it always returns
a number, and a wrong number looks exactly like a right one. So this pins the
things that would be silently wrong — the log5 algebra, the base-out rules that
actually move runners, and the league aggregates the whole thing has to
reproduce before any of its per-player output means anything.

THE BUG THIS FILE ALREADY CAUGHT. A first cut of the single-advancement rule
made the runner on SECOND score only when the runner on first did not take
third, conflating two independent runners. It cost runs in a way that looked
like a modelling choice rather than a defect.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from predict import mlb_pa_sim as S  # noqa: E402

_failures = 0


def check(label, got, want):
    global _failures
    ok = got == want
    if not ok:
        _failures += 1
    print(f"{'PASS' if ok else 'FAIL'}: {label}" + ("" if ok else f"  got {got!r}, want {want!r}"))


def approx(label, got, lo, hi):
    global _failures
    ok = lo <= got <= hi
    if not ok:
        _failures += 1
    print(f"{'PASS' if ok else 'FAIL'}: {label}  = {got:.4f}"
          + ("" if ok else f"   want {lo}..{hi}"))


class _Rng:
    """Deterministic stand-in so advancement rules are tested, not sampled."""

    def __init__(self, values):
        self._v = list(values)

    def random(self):
        return self._v.pop(0) if self._v else 0.999


def test_league_rates_are_a_distribution():
    check("the eight league shares sum to 1",
          round(sum(S.LEAGUE_PA), 6), 1.0)
    check("there are exactly eight outcomes", len(S.OUTCOMES), 8)


def test_log5_algebra():
    """The three identities that make log5 the right combination."""
    lg = 0.25
    approx("an average batter vs an average pitcher returns the league rate",
           S.log5(lg, lg, lg), lg - 1e-9, lg + 1e-9)
    # A better batter must beat the league; a better pitcher must suppress it.
    check("a better batter against an average pitcher beats the league",
          S.log5(0.40, lg, lg) > lg, True)
    check("an average batter against a suppressing pitcher falls below league",
          S.log5(lg, 0.10, lg) < lg, True)
    # Symmetry: swapping the batter and pitcher rates gives the same answer.
    check("log5 is symmetric in the batter and pitcher rates",
          round(S.log5(0.40, 0.10, lg), 12), round(S.log5(0.10, 0.40, lg), 12))
    # A degenerate league rate must not raise.
    check("a zero league rate falls back to the batter rate rather than raising",
          S.log5(0.3, 0.2, 0.0), 0.3)


def test_matchup_renormalises():
    b = S.PaRates(S.LEAGUE_PA)
    p = S.PaRates(S.LEAGUE_PA)
    m = S.matchup(b, p)
    approx("a matchup distribution sums to 1", sum(m), 0.999999, 1.000001)
    for i, name in enumerate(S.OUTCOMES):
        approx(f"average vs average reproduces the league {name} rate",
               m[i], S.LEAGUE_PA[i] - 1e-6, S.LEAGUE_PA[i] + 1e-6)


def test_home_run_clears_the_bases():
    bases = [True, True, True]
    runs = S._bat(S.I_HR, bases, _Rng([]))
    check("a grand slam scores four", runs, 4)
    check("and leaves the bases empty", bases, [False, False, False])


def test_walk_forces_only_where_it_must():
    bases = [True, False, True]          # first and third
    runs = S._bat(S.I_BB, bases, _Rng([]))
    check("a walk with first and third scores nobody", runs, 0)
    check("and pushes the runner to second, leaving third alone",
          bases, [True, True, True])

    bases = [True, True, True]
    runs = S._bat(S.I_BB, bases, _Rng([]))
    check("a walk with the bases loaded forces in exactly one", runs, 1)


def test_a_runner_on_second_scores_on_a_single_regardless_of_the_runner_on_first():
    """THE REGRESSION. These two runners are independent."""
    # rng < P_FIRST_TO_THIRD_ON_SINGLE -> the runner on first takes third.
    bases = [True, True, False]
    runs = S._bat(S.I_1B, bases, _Rng([0.0]))
    check("second scores even when first takes third", runs, 1)
    check("first is now on third, batter on first", bases, [True, False, True])

    # rng above the threshold -> the runner on first stops at second.
    bases = [True, True, False]
    runs = S._bat(S.I_1B, bases, _Rng([0.99]))
    check("second scores when first stops at second", runs, 1)
    check("first is now on second, batter on first", bases, [True, True, False])


def test_double_scores_from_first_sometimes_and_never_strands_wrongly():
    bases = [True, False, False]
    runs = S._bat(S.I_2B, bases, _Rng([0.0]))       # below threshold -> scores
    check("a runner on first can score on a double", runs, 1)
    check("leaving only the batter on second", bases, [False, True, False])

    bases = [True, False, False]
    runs = S._bat(S.I_2B, bases, _Rng([0.99]))      # above -> holds at third
    check("otherwise he stops at third", runs, 0)
    check("batter on second, runner on third", bases, [False, True, True])


def test_triple_scores_everyone():
    bases = [True, True, True]
    runs = S._bat(S.I_3B, bases, _Rng([]))
    check("a triple with the bases loaded scores three", runs, 3)
    check("and leaves the batter on third", bases, [False, False, True])


def test_in_play_out_rules():
    # Double play needs a runner on first and fewer than two outs.
    bases = [True, False, False]
    runs, outs = S._in_play_out(bases, 0, _Rng([0.0]))
    check("a double play records two outs", outs, 2)
    check("and erases the runner on first", bases, [False, False, False])

    bases = [True, False, False]
    _, outs = S._in_play_out(bases, 2, _Rng([0.0]))
    check("no double play with two already out", outs, 1)

    # Productive out: runner on third, fewer than two outs.
    # NOTE: with no runner on first the GIDP branch short-circuits and consumes
    # no random value, so the first value here feeds the productive-out roll.
    bases = [False, False, True]
    runs, outs = S._in_play_out(bases, 0, _Rng([0.0]))
    check("a productive out scores the runner from third", runs, 1)
    check("for one out", outs, 1)

    bases = [False, False, True]
    runs, _ = S._in_play_out(bases, 2, _Rng([0.0]))
    check("but never with two already out", runs, 0)


def test_league_aggregates_are_baseball():
    """The whole point. Average lineups against average pitching must produce
    something recognisable as a baseball game."""
    lg = S.PaRates(S.LEAGUE_PA)
    res = S.simulate_game([lg] * 9, [lg] * 9, lg, lg, n_iter=3000, seed=11)
    sm = S.summarise(res)
    pa = sum(t["PA"] for r in res for t in r.away_bat) / len(res)

    # Runs run ~0.3 low BY CONSTRUCTION: this model scores only through plate
    # appearances, and real baseball also scores on errors, steals and wild
    # pitches. The band is set around what a PA-only model should produce, not
    # around real baseball's 4.4-4.6 — see the module docstring.
    approx("runs per team-game (PA-only model)", sm["runs_per_team_game"], 3.95, 4.35)
    approx("PA per team-game", pa, 38.0, 39.4)
    approx("shutout pct", sm["shutout_pct"], 0.05, 0.10)
    approx("10+ run pct", sm["ten_plus_pct"], 0.030, 0.065)

    # Per-batter props must match reality, which is what Phase 3.4 compares on.
    hr = sum(S.prop_probability(res, s, i, "HR", 0.5)
             for s in ("away", "home") for i in range(9)) / 18
    singles = sum(S.prop_probability(res, s, i, "1B", 0.5)
                  for s in ("away", "home") for i in range(9)) / 18
    approx("P(home run) for an average batter  (real ~0.112)", hr, 0.09, 0.15)
    approx("P(a single) for an average batter  (real ~0.45)", singles, 0.40, 0.52)


def test_a_better_lineup_scores_more():
    """Directionality: the simulation must respond to its inputs."""
    lg = S.PaRates(S.LEAGUE_PA)
    good = list(S.LEAGUE_PA)
    good[S.I_HR] *= 2.0
    good[S.I_1B] *= 1.3
    good[S.I_K] *= 0.7
    good[S.I_OUT] = max(0.0, 1.0 - sum(good[:S.I_OUT]) - good[S.I_K])
    strong = S.PaRates(tuple(x / sum(good) for x in good))

    base = S.summarise(S.simulate_game([lg] * 9, [lg] * 9, lg, lg, n_iter=2000, seed=5))
    up = S.summarise(S.simulate_game([strong] * 9, [lg] * 9, lg, lg, n_iter=2000, seed=5))
    check("a stronger away lineup scores more than an average one",
          up["runs_per_team_game"] > base["runs_per_team_game"], True)


def test_the_home_ninth_is_skipped_when_it_should_be():
    """A real game does not bat in the bottom of the ninth when already ahead.
    Including it would inflate home scoring."""
    lg = S.PaRates(S.LEAGUE_PA)
    res = S.simulate_game([lg] * 9, [lg] * 9, lg, lg, n_iter=4000, seed=17)
    home_pa = sum(sum(t["PA"] for t in r.home_bat) for r in res) / len(res)
    away_pa = sum(sum(t["PA"] for t in r.away_bat) for r in res) / len(res)
    check("the home team takes fewer plate appearances than the away team",
          home_pa < away_pa, True)


def main() -> bool:
    test_league_rates_are_a_distribution()
    test_log5_algebra()
    test_matchup_renormalises()
    test_home_run_clears_the_bases()
    test_walk_forces_only_where_it_must()
    test_a_runner_on_second_scores_on_a_single_regardless_of_the_runner_on_first()
    test_double_scores_from_first_sometimes_and_never_strands_wrongly()
    test_triple_scores_everyone()
    test_in_play_out_rules()
    test_league_aggregates_are_baseball()
    test_a_better_lineup_scores_more()
    test_the_home_ninth_is_skipped_when_it_should_be()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
