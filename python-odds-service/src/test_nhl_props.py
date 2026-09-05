"""predict/nhl_props.py — the Phase 4.5 prop engine.

Pure parts only; the loader is exercised against the database in 4.6.

The tests that matter are the ones where a wrong answer still looks plausible:

  the negative binomial, checked against scipy rather than against itself — a
  hand-rolled recurrence that is subtly wrong produces probabilities in [0,1]
  that are simply incorrect, and nothing downstream would notice;

  shrinkage, which must actually SHRINK — a weight that silently resolves to 1
  gives every callup a superstar's rate off one good night, and the model would
  look confident and be wrong exactly where it has least evidence;

  and the Poisson limit, because a negative binomial with a large dispersion
  must reduce to Poisson. That is the null the shape parameter has to beat.

Run with:  python test_nhl_props.py
"""
import math
import sys

from predict import nhl_props as npx

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


def close(label: str, actual: float, expected: float, tol: float) -> None:
    global _failures
    if abs(actual - expected) <= tol:
        print(f"  PASS  {label}  ({actual:.5f})")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual:.6f}, expected {expected:.6f} +/- {tol}")


def test_nb_against_scipy() -> None:
    print("\nthe negative binomial, checked against scipy not against itself")
    from scipy.stats import nbinom
    for mean, r, line in ((2.3, 4.0, 1.5), (2.3, 4.0, 2.5), (1.1, 2.0, 0.5),
                          (3.4, 8.0, 3.5), (2.0, 1.5, 2.5)):
        p = r / (r + mean)
        want = 1.0 - nbinom.cdf(math.floor(line), r, p)
        close(f"mean={mean} r={r} line={line}", npx.nb_prob_over(line, mean, r),
              float(want), 1e-9)


def test_poisson_limit() -> None:
    print("\na large dispersion must reduce to Poisson — the null to beat")
    mean, line = 2.3, 2.5
    poisson_over = 1.0 - sum(math.exp(-mean + k * math.log(mean) - math.lgamma(k + 1))
                             for k in range(int(line) + 1))
    close("r=10,000 is Poisson to 4dp",
          npx.nb_prob_over(line, mean, 10_000.0), poisson_over, 1e-4)
    check("and a small r is genuinely different",
          abs(npx.nb_prob_over(line, mean, 1.5) - poisson_over) > 0.01, True)


def test_nb_monotonicity() -> None:
    print("\nP(over) behaves the way a probability must")
    check("rises with the mean",
          npx.nb_prob_over(2.5, 3.0, 4.0) > npx.nb_prob_over(2.5, 2.0, 4.0), True)
    check("falls as the line rises",
          npx.nb_prob_over(3.5, 2.3, 4.0) < npx.nb_prob_over(1.5, 2.3, 4.0), True)
    check("stays in [0,1] at an extreme mean",
          0.0 <= npx.nb_prob_over(0.5, 40.0, 4.0) <= 1.0, True)
    close("a zero mean never goes over", npx.nb_prob_over(0.5, 0.0, 4.0), 0.0, 1e-12)


def test_shrinkage_actually_shrinks() -> None:
    print("\nSHRINKAGE — the guard against a hot callup")
    league = 0.12
    # Two games at a superstar rate: must land near the league, not near 0.25.
    hot = npx.shrunk_rate(player_events=9.0, player_minutes=36.0, league_rate=league)
    check("2 games at 0.25/min stays closer to the league than to its own rate",
          abs(hot - league) < abs(hot - 0.25), True)
    print(f"    2 games at 0.250/min -> {hot:.4f}  (league {league})")

    # A full season at the same rate should be trusted.
    settled = npx.shrunk_rate(player_events=200.0, player_minutes=800.0,
                              league_rate=league)
    print(f"    44 games at 0.250/min -> {settled:.4f}")
    check("a full season is trusted over the league", settled > hot, True)
    check("but never overshoots its own observed rate", settled <= 0.25 + 1e-9, True)
    close("no history at all returns the league exactly",
          npx.shrunk_rate(0.0, 0.0, league), league, 1e-12)
    # Monotone in evidence.
    seq = [npx.shrunk_rate(0.25 * m, m, league) for m in (18, 90, 360, 1800)]
    check("more minutes move steadily toward the player's own rate",
          all(seq[i] < seq[i + 1] for i in range(len(seq) - 1)), True)


def test_projection_is_volume_times_rate() -> None:
    print("\nprojection = volume x rate, and volume dominates")
    h = npx.PlayerHistory()
    for _ in range(20):
        h.add(sog=3.0, minutes=20.0)
    p = npx.project(h, league_rate=0.12, league_toi=18.0)
    close("projected TOI is the player's own mean", p.projected_toi, 20.0, 1e-9)
    close("expected = toi * rate", p.expected_sog, p.projected_toi * p.rate_per_min, 1e-12)
    check("history length is reported", p.games_of_history, 20)

    # Same rate, half the minutes -> half the shots. Volume is the first
    # ingredient for a reason.
    h2 = npx.PlayerHistory()
    for _ in range(20):
        h2.add(sog=1.5, minutes=10.0)
    p2 = npx.project(h2, league_rate=0.12, league_toi=18.0)
    close("half the minutes at the same rate halves the projection",
          p2.expected_sog / p.expected_sog, 0.5, 0.02)


def test_empty_history_uses_league() -> None:
    print("\na player with no history falls back to the league, not to zero")
    p = npx.project(npx.PlayerHistory(), league_rate=0.12, league_toi=18.5)
    close("toi falls back to the league mean", p.projected_toi, 18.5, 1e-12)
    close("rate falls back to the league mean", p.rate_per_min, 0.12, 1e-12)
    check("so the projection is non-zero", p.expected_sog > 0, True)


def main() -> int:
    test_nb_against_scipy()
    test_poisson_limit()
    test_nb_monotonicity()
    test_shrinkage_actually_shrinks()
    test_projection_is_volume_times_rate()
    test_empty_history_uses_league()
    print()
    if _failures:
        print(f"{_failures} FAILURE(S)")
        return 1
    print("all nhl_props checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
