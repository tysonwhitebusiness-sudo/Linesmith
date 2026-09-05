"""Phase 3.2 — the Dixon-Coles scoring-rate engine.

Pure and IO-free, like `tennis_elo.py`. Fitting hyperparameters and the
walk-forward are 3.3/3.4; the ship gate is 3.5. Nothing here reads odds.

THE MODEL. Every club carries an `attack` and a `defence` rate. For one fixture:

    lambda = exp(attack_home - defence_away + home_advantage)     home goals
    mu     = exp(attack_away - defence_home)                      away goals
    P(i,j) = tau(i,j) * Poisson(i; lambda) * Poisson(j; mu)

Summing that grid gives the three-way moneyline and any total from ONE fit,
which is why this engine covers Phases 3, 4 and 5 rather than just this one.

THE TWO DIXON-COLES CORRECTIONS, and why each exists:

  tau, the low-score correction. Independent Poisson under-predicts 0-0, 1-0,
  0-1 and 1-1, because cautious teams are not independent — the scoreline
  affects how both sides play. tau adjusts exactly those four cells and leaves
  every other one alone. rho = 0 collapses this to plain independent Poisson,
  which is the null the engine must reduce to and a test asserts.

  xi, exponential time decay. A match from four seasons ago says less about a
  club than last month's. Weight w = exp(-xi * days_ago) in the likelihood.
  xi = 0 weights all history equally.

IDENTIFIABILITY IS NOT OPTIONAL. Adding a constant to every attack and the same
constant to every defence leaves every lambda unchanged, so the likelihood has a
flat direction and an optimiser will wander along it forever — returning
parameters that differ wildly between runs while fitting identically. The mean
attack is pinned to zero to remove it. This is Phase 2.4's boundary lesson in a
different costume: a parameter the data cannot determine will still be reported
as if it were fitted.

HOME ADVANTAGE IS EARNED HERE, unlike in tennis. Measured 2026-09-04: home
sides win 44.2% in EPL and 49.0% in MLS against 24-25% draws. Phase 2.2 dropped
the equivalent term because tennis "home" was column order at 50.3%. The same
check justifies keeping it here — and doubles as the leakage test.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

# Goals per side to enumerate. Beyond 10 the Poisson mass is negligible for any
# realistic rate (at lambda=3, P(>10) is ~0.0002) and the grid cost is squared.
MAX_GOALS = 10

# tau can drive a cell negative for extreme rho, which is not a probability.
# The paper constrains rho; these bounds keep every cell positive for the
# lambda/mu range football actually produces.
RHO_MIN, RHO_MAX = -0.25, 0.25

# L2 shrinkage on attack/defence, toward the league mean of 0.
#
# NOT a tuning knob — it makes the fit WELL-POSED under time decay. With xi at a
# 347-day half-life, a club that stopped playing years ago carries ~zero weight
# in the likelihood, so its two parameters are unconstrained and the optimiser
# parks them anywhere. Measured 2026-09-04 before this existed: EPL's "strongest"
# club was Hull at +3.64 (last top-flight match 2017) and its "weakest" was
# Coventry at -4.99 (last 2001), against Arsenal at +1.21.
#
# Held-out metrics were not affected — those clubs play no held-out fixtures —
# but the fit was ill-posed, and a promoted club returning would have carried a
# garbage rating into real predictions. Shrinkage pulls an unconstrained club to
# the league mean, which is the honest estimate for a club with no recent
# evidence. It is deliberately weak: a club with real matches is barely moved.
L2_PENALTY = 0.05


@dataclass
class DCParams:
    attack: dict[str, float] = field(default_factory=dict)
    defence: dict[str, float] = field(default_factory=dict)
    home_advantage: float = 0.25
    rho: float = -0.05

    def teams(self) -> list[str]:
        return sorted(self.attack)


def poisson_pmf(k: int, rate: float) -> float:
    if rate <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-rate + k * math.log(rate) - math.lgamma(k + 1))


def tau(i: int, j: int, lam: float, mu: float, rho: float) -> float:
    """Dixon-Coles low-score correction. Touches ONLY the four cells below."""
    if i == 0 and j == 0:
        return 1.0 - lam * mu * rho
    if i == 0 and j == 1:
        return 1.0 + lam * rho
    if i == 1 and j == 0:
        return 1.0 + mu * rho
    if i == 1 and j == 1:
        return 1.0 - rho
    return 1.0


def rates(params: DCParams, home: str, away: str) -> tuple[float, float]:
    """Expected goals for (home, away). Unknown clubs sit at the mean, 0."""
    ah = params.attack.get(home, 0.0)
    aa = params.attack.get(away, 0.0)
    dh = params.defence.get(home, 0.0)
    da = params.defence.get(away, 0.0)
    return (math.exp(ah - da + params.home_advantage), math.exp(aa - dh))


def score_matrix(params: DCParams, home: str, away: str) -> list[list[float]]:
    lam, mu = rates(params, home, away)
    ph = [poisson_pmf(i, lam) for i in range(MAX_GOALS + 1)]
    pa = [poisson_pmf(j, mu) for j in range(MAX_GOALS + 1)]
    grid = [[tau(i, j, lam, mu, params.rho) * ph[i] * pa[j]
             for j in range(MAX_GOALS + 1)] for i in range(MAX_GOALS + 1)]
    # The grid is truncated at MAX_GOALS and tau shifts a little mass, so it
    # does not sum to exactly 1. Normalising makes every consumer a proper
    # distribution rather than making each one remember to divide.
    total = sum(sum(r) for r in grid)
    if total > 0:
        grid = [[c / total for c in r] for r in grid]
    return grid


def outcome_probs(params: DCParams, home: str, away: str) -> tuple[float, float, float]:
    """(home win, draw, away win) — the three-way moneyline."""
    g = score_matrix(params, home, away)
    h = d = a = 0.0
    for i, row in enumerate(g):
        for j, p in enumerate(row):
            if i > j:
                h += p
            elif i == j:
                d += p
            else:
                a += p
    return h, d, a


def total_probs(params: DCParams, home: str, away: str,
                line: float = 2.5) -> tuple[float, float]:
    """(over, under) for a goals line. A whole-number line can push; this
    returns P(over) and P(under) only, so the caller must handle a push if it
    ever uses an integer line."""
    g = score_matrix(params, home, away)
    over = sum(p for i, row in enumerate(g) for j, p in enumerate(row) if i + j > line)
    under = sum(p for i, row in enumerate(g) for j, p in enumerate(row) if i + j < line)
    return over, under


def decay_weight(days_ago: float, xi: float) -> float:
    """Exponential time decay. xi = 0 weights all history equally."""
    if xi <= 0:
        return 1.0
    return math.exp(-xi * max(0.0, days_ago))


def log_likelihood(params: DCParams, matches, xi: float = 0.0,
                   as_of=None) -> float:
    """Weighted DC log-likelihood over `matches`.

    Each match is a dict with home/away/home_goals/away_goals/played.
    """
    total = 0.0
    for m in matches:
        lam, mu = rates(params, m["home"], m["away"])
        i, j = m["home_goals"], m["away_goals"]
        t = tau(i, j, lam, mu, params.rho)
        if t <= 0:
            return -1e18   # an invalid rho, rejected rather than log(negative)
        w = 1.0
        if xi > 0 and as_of is not None:
            w = decay_weight((as_of - m["played"]).days, xi)
        total += w * (math.log(t)
                      + (-lam + i * math.log(lam) - math.lgamma(i + 1))
                      + (-mu + j * math.log(mu) - math.lgamma(j + 1)))
    return total


# ---------------------------------------------------------------------------
# The vectorised fit path.
#
# WHY THIS EXISTS. The scalar log_likelihood above is the readable definition
# and stays the reference. It is not the thing to optimise WITH. L-BFGS-B has no
# analytic gradient here, so it finite-differences: with 35 clubs that is 72
# parameters, hence 73 likelihood evaluations per gradient step, each looping
# every match in Python. Measured 2026-09-04, a real EPL walk-forward on that
# path did not finish in ten minutes.
#
# The arrays below are constant for a given fit, so they are built once and the
# optimiser only ever does vector arithmetic over them. test_dixon_coles asserts
# this path agrees with the scalar definition — it is a speed change, and a
# speed change that alters the answer is a bug.
# ---------------------------------------------------------------------------


class _FitArrays:
    """Everything constant across one fit's likelihood evaluations."""

    def __init__(self, matches, teams: list[str], xi: float, as_of):
        import numpy as np
        from scipy.special import gammaln

        idx = {t: i for i, t in enumerate(teams)}
        self.hi = np.fromiter((idx[m["home"]] for m in matches), int, len(matches))
        self.ai = np.fromiter((idx[m["away"]] for m in matches), int, len(matches))
        hg = np.fromiter((m["home_goals"] for m in matches), float, len(matches))
        ag = np.fromiter((m["away_goals"] for m in matches), float, len(matches))
        self.hg, self.ag = hg, ag
        self.const = gammaln(hg + 1.0) + gammaln(ag + 1.0)
        if xi > 0 and as_of is not None:
            days = np.fromiter(((as_of - m["played"]).days for m in matches),
                               float, len(matches))
            self.w = np.exp(-xi * np.maximum(days, 0.0))
        else:
            self.w = np.ones(len(matches))
        # A SAFE rho RANGE, derived from this sport's scoring rate.
        #
        # tau(0,0) = 1 - lam*mu*rho must stay positive, so the largest usable rho
        # depends on how many goals the sport scores. Soccer (~1.4/team) tolerates
        # the +-0.25 default; NHL (~3/team) does not — at lam*mu ~9.5 anything
        # above ~0.105 makes P(0-0) negative. The factor of 2 leaves headroom for
        # a strong-vs-weak fixture whose rates exceed the mean.
        mean_h = float(hg.mean()) if len(hg) else 1.0
        mean_a = float(ag.mean()) if len(ag) else 1.0
        scale = max(1e-6, 2.0 * max(mean_h, 0.1) * max(mean_a, 0.1))
        self.rho_hi = min(RHO_MAX, 0.9 / scale)
        self.rho_lo = max(RHO_MIN, -0.9 / max(0.1, 2.0 * max(mean_h, mean_a)))

        # The four tau cells, as masks, computed once.
        self.m00 = (hg == 0) & (ag == 0)
        self.m01 = (hg == 0) & (ag == 1)
        self.m10 = (hg == 1) & (ag == 0)
        self.m11 = (hg == 1) & (ag == 1)


def _neg_ll_fast(v, arr: "_FitArrays", n: int, l2: float = L2_PENALTY) -> float:
    """Negative penalised log-likelihood — the OBJECTIVE, not the likelihood.

    `l2 = 0` gives the bare likelihood, which is what the agreement test
    compares against the scalar definition. The penalty is a separate, explicit
    term rather than folded into log_likelihood(), because a likelihood with a
    prior baked in silently is a likelihood nobody can check.
    """
    import numpy as np

    att = np.asarray(v[:n], dtype=float)
    att = att - att.mean()                      # the identifiability pin
    dfn = np.asarray(v[n:2 * n], dtype=float)
    ha = float(v[2 * n])
    rho = min(arr.rho_hi, max(arr.rho_lo, float(v[2 * n + 1])))

    lam = np.exp(att[arr.hi] - dfn[arr.ai] + ha)
    mu = np.exp(att[arr.ai] - dfn[arr.hi])
    if not (np.all(np.isfinite(lam)) and np.all(np.isfinite(mu))):
        return 1e18

    # VALIDITY IS A BOX CONSTRAINT, NOT A CLIFF.
    #
    # tau must stay positive for every cell the model will ever PRICE, not just
    # for the scorelines present in training. NHL made that gap visible: final
    # scores are never tied, so no 0-0 row exists, the m00 mask is empty, and
    # rho ran to its +0.25 default bound. At hockey rates (lam ~3.16, mu ~3.00)
    # that gives tau(0,0) = 1 - 9.5*0.25 = -1.37 and a score matrix with
    # P(0-0) = -0.00289.
    #
    # The first fix rejected such rho with a 1e18 return. That is a DISCONTINUITY,
    # and L-BFGS-B is gradient-based: the sweep went erratic and non-monotonic,
    # 13 of 169 refits hit the iteration cap, and exp() overflowed. Replaced by
    # `arr.rho_hi` / `arr.rho_lo` above — a smooth box derived from the sport's
    # own scoring rate, which the optimiser can actually work inside.
    t = np.ones_like(lam)
    t[arr.m00] = 1.0 - lam[arr.m00] * mu[arr.m00] * rho
    t[arr.m01] = 1.0 + lam[arr.m01] * rho
    t[arr.m10] = 1.0 + mu[arr.m10] * rho
    t[arr.m11] = 1.0 - rho
    if np.any(t <= 0):
        return 1e18                              # an invalid rho, not log(negative)

    ll = (-lam + arr.hg * np.log(lam) - mu + arr.ag * np.log(mu)
          - arr.const + np.log(t))
    obj = -float(np.sum(arr.w * ll))
    if l2:
        obj += l2 * (float(np.dot(att, att)) + float(np.dot(dfn, dfn)))
    return obj


def _pack(params: DCParams, teams: list[str]) -> list[float]:
    return ([params.attack[t] for t in teams]
            + [params.defence[t] for t in teams]
            + [params.home_advantage, params.rho])


def _unpack(v, teams: list[str]) -> DCParams:
    n = len(teams)
    att = list(v[:n])
    # MEAN ATTACK PINNED TO ZERO. Without this the likelihood is flat along
    # "add c to every attack and every defence" and the optimiser drifts down
    # it, returning wildly different parameters that fit identically.
    mean = sum(att) / n if n else 0.0
    att = [a - mean for a in att]
    return DCParams(
        attack=dict(zip(teams, att)),
        defence=dict(zip(teams, v[n:2 * n])),
        home_advantage=v[2 * n],
        rho=min(RHO_MAX, max(RHO_MIN, v[2 * n + 1])),
    )


def fit(matches, xi: float = 0.0, as_of=None, maxiter: int = 400) -> DCParams:
    """Maximum-likelihood fit. `matches` must all precede `as_of`."""
    from scipy.optimize import minimize

    teams = sorted({m["home"] for m in matches} | {m["away"] for m in matches})
    if not teams:
        return DCParams()
    start = DCParams(attack={t: 0.0 for t in teams},
                     defence={t: 0.0 for t in teams},
                     home_advantage=0.25, rho=-0.05)

    arr = _FitArrays(matches, teams, xi, as_of)
    n = len(teams)
    bounds = [(None, None)] * (2 * n + 1) + [(arr.rho_lo, arr.rho_hi)]
    res = minimize(lambda v: _neg_ll_fast(v, arr, n), _pack(start, teams),
                   method="L-BFGS-B", bounds=bounds, options={"maxiter": maxiter})
    return _unpack(res.x, teams)
