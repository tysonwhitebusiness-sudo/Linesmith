"""predict/dixon_coles.py — the Phase 3.2 scoring-rate engine.

Pure, so every property is checkable without a database. The tests worth having
are the ones that fail SILENTLY:

  tau touching a cell it should not — the whole point of the correction is that
  it adjusts four scorelines and nothing else;
  the grid not being a distribution, which makes every probability slightly
  wrong in a way no assertion downstream would notice;
  rho != 0 failing to reduce to plain Poisson at rho = 0, i.e. the null the
  model must contain;
  and identifiability — an unpinned mean attack leaves the likelihood flat, and
  the optimiser then returns parameters that differ run to run while fitting
  identically. That is Phase 2.4's boundary lesson in a different costume.

The strongest test here is RECOVERY: generate matches from known parameters,
fit, and check the fit finds them back. A model that cannot recover its own
truth on clean synthetic data will not be believable on real data.

Run with:  python test_dixon_coles.py
"""
import math
import random
import sys
from datetime import date, timedelta

from predict import dixon_coles as dc

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
        print(f"  PASS  {label}  ({actual:.4f})")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual:.5f}, expected {expected:.5f} +/- {tol}")


def P(**kw) -> dc.DCParams:
    return dc.DCParams(**kw)


def test_poisson() -> None:
    print("\nthe Poisson pmf itself")
    close("P(0; 1) = e^-1", dc.poisson_pmf(0, 1.0), math.exp(-1), 1e-12)
    close("P(2; 2) = 2e^-2", dc.poisson_pmf(2, 2.0), 2 * math.exp(-2), 1e-12)
    s = sum(dc.poisson_pmf(k, 1.5) for k in range(40))
    close("it sums to 1 over enough k", s, 1.0, 1e-9)
    close("a zero rate is all mass on 0", dc.poisson_pmf(0, 0.0), 1.0, 1e-12)


def test_tau_touches_only_four_cells() -> None:
    print("\ntau — adjusts FOUR scorelines and nothing else")
    lam, mu, rho = 1.4, 1.1, -0.08
    touched = [(i, j) for i in range(6) for j in range(6)
               if dc.tau(i, j, lam, mu, rho) != 1.0]
    check("exactly the low-score cells are touched",
          sorted(touched), [(0, 0), (0, 1), (1, 0), (1, 1)])
    close("tau(0,0) = 1 - lam*mu*rho", dc.tau(0, 0, lam, mu, rho),
          1 - lam * mu * rho, 1e-12)
    close("tau(1,1) = 1 - rho", dc.tau(1, 1, lam, mu, rho), 1 - rho, 1e-12)
    check("rho = 0 makes tau the identity everywhere",
          all(dc.tau(i, j, lam, mu, 0.0) == 1.0 for i in range(4) for j in range(4)),
          True)


def test_grid_is_a_distribution() -> None:
    print("\nthe score grid is a proper distribution")
    p = P(attack={"A": 0.3, "B": -0.3}, defence={"A": 0.1, "B": -0.1},
          home_advantage=0.25, rho=-0.06)
    g = dc.score_matrix(p, "A", "B")
    close("sums to 1", sum(sum(r) for r in g), 1.0, 1e-9)
    check("every cell is a probability",
          all(0.0 <= c <= 1.0 for r in g for c in r), True)
    h, d, a = dc.outcome_probs(p, "A", "B")
    close("home + draw + away = 1", h + d + a, 1.0, 1e-9)
    o, u = dc.total_probs(p, "A", "B", 2.5)
    close("over + under = 1 on a half line", o + u, 1.0, 1e-9)


def test_reduces_to_independent_poisson() -> None:
    print("\nrho = 0 must reduce EXACTLY to independent Poisson")
    p = P(attack={"A": 0.2, "B": -0.2}, defence={"A": 0.0, "B": 0.0},
          home_advantage=0.3, rho=0.0)
    lam, mu = dc.rates(p, "A", "B")
    g = dc.score_matrix(p, "A", "B")
    # Independent Poisson: P(i,j) = P(i)P(j). Compare a few cells directly.
    worst = max(abs(g[i][j] - dc.poisson_pmf(i, lam) * dc.poisson_pmf(j, mu))
                for i in range(4) for j in range(4))
    close("every cell matches the product of marginals", worst, 0.0, 1e-6)


def test_home_advantage() -> None:
    print("\nhome advantage — earned from the data here, unlike tennis")
    even = P(attack={"A": 0.0, "B": 0.0}, defence={"A": 0.0, "B": 0.0},
             home_advantage=0.0, rho=0.0)
    h, d, a = dc.outcome_probs(even, "A", "B")
    close("with no home term, two equal clubs are symmetric", h - a, 0.0, 1e-9)
    check("and a draw is a real third outcome, not a rounding error",
          0.15 < d < 0.35, True)

    adv = P(attack={"A": 0.0, "B": 0.0}, defence={"A": 0.0, "B": 0.0},
            home_advantage=0.30, rho=0.0)
    h2, _, a2 = dc.outcome_probs(adv, "A", "B")
    check("a home term raises the home side", h2 > h, True)
    check("and lowers the away side", a2 < a, True)


def test_strength_ordering() -> None:
    print("\nbetter attack and better defence both help")
    base = P(attack={"A": 0.0, "B": 0.0}, defence={"A": 0.0, "B": 0.0},
             home_advantage=0.2, rho=0.0)
    strong_att = P(attack={"A": 0.5, "B": 0.0}, defence={"A": 0.0, "B": 0.0},
                   home_advantage=0.2, rho=0.0)
    strong_def = P(attack={"A": 0.0, "B": 0.0}, defence={"A": 0.5, "B": 0.0},
                   home_advantage=0.2, rho=0.0)
    b = dc.outcome_probs(base, "A", "B")[0]
    check("a stronger attack raises P(home win)",
          dc.outcome_probs(strong_att, "A", "B")[0] > b, True)
    check("a stronger defence also raises P(home win)",
          dc.outcome_probs(strong_def, "A", "B")[0] > b, True)


def test_decay() -> None:
    print("\ntime decay")
    close("today is unweighted", dc.decay_weight(0, 0.002), 1.0, 1e-12)
    check("older matches weigh less",
          dc.decay_weight(400, 0.002) < dc.decay_weight(100, 0.002), True)
    close("xi = 0 weights everything equally", dc.decay_weight(9999, 0.0), 1.0, 1e-12)


def test_identifiability() -> None:
    print("\nIDENTIFIABILITY — mean attack pinned to zero")
    # Adding c to every attack AND every defence leaves every rate unchanged,
    # so without pinning, the optimiser has an infinite ridge to wander down.
    teams = ["A", "B", "C"]
    v = [1.0, 2.0, 3.0] + [0.1, 0.2, 0.3] + [0.25, -0.05]
    p = dc._unpack(v, teams)
    close("mean attack is 0 after unpacking",
          sum(p.attack.values()) / len(teams), 0.0, 1e-12)
    # The SHIFTED vector must produce the same rates as the original.
    shifted = [x + 5.0 for x in v[:3]] + v[3:]
    p2 = dc._unpack(shifted, teams)
    r1 = dc.rates(p, "A", "B")
    r2 = dc.rates(p2, "A", "B")
    close("a shifted attack vector gives identical rates", r1[0], r2[0], 1e-9)
    check("rho is clamped into a range that keeps tau positive",
          dc._unpack([0, 0, 0, 0, 0, 0, 0.25, 9.0], teams).rho, dc.RHO_MAX)


def test_fast_path_agrees_with_the_definition() -> None:
    print("\nthe VECTORISED fit path must agree with the scalar definition")
    # The scalar log_likelihood is the readable reference; the numpy path is
    # what the optimiser actually calls, because finite-differencing 72
    # parameters over a Python loop did not finish a real EPL walk-forward in
    # ten minutes. A speed change that alters the answer is a bug, so the two
    # are compared directly rather than assumed equivalent.
    random.seed(11)
    teams = ["A", "B", "C", "D"]
    d0 = date(2021, 1, 1)
    matches = [{"home": random.choice(teams), "away": random.choice(teams),
                "home_goals": random.randint(0, 4), "away_goals": random.randint(0, 4),
                "played": d0 + timedelta(days=i)} for i in range(300)]
    matches = [m for m in matches if m["home"] != m["away"]]
    as_of = d0 + timedelta(days=400)

    for xi in (0.0, 0.003):
        for rho in (0.0, -0.08, 0.06):
            v = [0.3, -0.1, 0.05, -0.25,
                 0.2, -0.15, 0.0, 0.1, 0.27, rho]
            p = dc._unpack(v, teams)
            scalar = dc.log_likelihood(p, matches, xi, as_of)
            arr = dc._FitArrays(matches, teams, xi, as_of)
            # l2=0: comparing the LIKELIHOOD, not the penalised objective.
            fast = -dc._neg_ll_fast(v, arr, len(teams), l2=0.0)
            close(f"xi={xi} rho={rho:+.2f}: fast == scalar", fast, scalar, 1e-6)


def test_recovery_from_synthetic_data() -> None:
    print("\nRECOVERY — fit known parameters back out of data they generated")
    random.seed(7)
    truth = dc.DCParams(
        attack={"Strong": 0.45, "Mid": 0.0, "Weak": -0.45},
        defence={"Strong": 0.35, "Mid": 0.0, "Weak": -0.35},
        home_advantage=0.28, rho=0.0)
    teams = ["Strong", "Mid", "Weak"]

    def draw_poisson(rate: float) -> int:
        # Knuth. Fine at football goal rates.
        L, k, p = math.exp(-rate), 0, 1.0
        while True:
            p *= random.random()
            if p <= L:
                return k
            k += 1

    matches = []
    d0 = date(2020, 1, 1)
    for n in range(6000):
        h, a = random.sample(teams, 2)
        lam, mu = dc.rates(truth, h, a)
        matches.append({"home": h, "away": a, "home_goals": draw_poisson(lam),
                        "away_goals": draw_poisson(mu),
                        "played": d0 + timedelta(days=n // 10)})
    got = dc.fit(matches, xi=0.0, maxiter=600)

    print(f"    home_advantage  truth 0.280   fitted {got.home_advantage:.3f}")
    for t in teams:
        print(f"    {t:<7} attack {truth.attack[t]:+.2f} -> {got.attack[t]:+.3f}"
              f"   defence {truth.defence[t]:+.2f} -> {got.defence[t]:+.3f}")
    close("home advantage recovered", got.home_advantage, 0.28, 0.06)
    for t in teams:
        close(f"{t} attack recovered", got.attack[t], truth.attack[t], 0.10)
    check("attack ordering preserved",
          got.attack["Strong"] > got.attack["Mid"] > got.attack["Weak"], True)
    check("defence ordering preserved",
          got.defence["Strong"] > got.defence["Mid"] > got.defence["Weak"], True)


def main() -> int:
    test_poisson()
    test_tau_touches_only_four_cells()
    test_grid_is_a_distribution()
    test_reduces_to_independent_poisson()
    test_home_advantage()
    test_strength_ordering()
    test_decay()
    test_identifiability()
    test_fast_path_agrees_with_the_definition()
    test_recovery_from_synthetic_data()
    print()
    if _failures:
        print(f"{_failures} FAILURE(S)")
        return 1
    print("all dixon_coles checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
