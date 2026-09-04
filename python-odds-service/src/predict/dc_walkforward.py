"""Phase 3.3 — rolling-refit walk-forward for Dixon-Coles.

STRUCTURALLY DIFFERENT FROM PHASE 2, and the main reason this phase costs more.
Elo is online: one pass, each match updates the ratings, and scoring 56,386
tennis matches took 0.5 seconds. Dixon-Coles is a batch maximum-likelihood fit,
so an honest walk-forward means REFITTING as of each test date on prior matches
only. There is no shortcut that preserves the no-leakage property.

THE NO-LEAKAGE RULE, stated precisely because it is easy to get subtly wrong:
a match played on date D is predicted by a fit trained on matches played
STRICTLY BEFORE D. Not "before the refit date" — matches between the last refit
and D are excluded too, since they were not available when a bettor would have
priced D. And not "on or before D", which would let a same-day fixture's result
inform its own prediction.

REFIT CADENCE. Weekly, matching a football matchweek. Per-match refitting is the
theoretical ideal and is not affordable: fits grow with history, and a per-match
schedule multiplies that by the number of matches. Weekly is the coarsest
cadence that never lets a fit go stale within a matchweek, which is the unit
football actually moves in.

WARM STARTING. Consecutive weekly fits differ by one matchweek of data, so
their parameters are nearly identical. Each refit starts the optimiser at the
previous week's solution instead of from zero. This is a pure speed measure and
cannot change the answer at convergence — but it CAN mask non-convergence, so
the harness records how many refits hit the iteration cap and the caller must
look at that number rather than assume it is zero.

MINIMUM HISTORY, decided here rather than discovered mid-run. A fit estimates
two parameters per club plus two globals, so it needs enough matches per club to
separate attack from defence at all. The floor is `min_matches_per_team` (15)
times the number of clubs seen so far — EPL ~300 matches, MLS ~435 — and
anything before that is used for training but never scored. It is expressed per
club rather than as a flat count precisely because MLS carries more clubs than
EPL and a flat number would be too loose for one and too strict for the other.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from . import dixon_coles as dc


@dataclass
class ScoredMatch:
    sport: str
    played: date
    home: str
    away: str
    home_goals: int
    away_goals: int
    p_home: float
    p_draw: float
    p_away: float
    n_train: int          # matches the fit behind this prediction actually saw

    @property
    def outcome(self) -> str:
        if self.home_goals > self.away_goals:
            return "home"
        return "draw" if self.home_goals == self.away_goals else "away"

    @property
    def p_actual(self) -> float:
        return {"home": self.p_home, "draw": self.p_draw, "away": self.p_away}[self.outcome]


@dataclass
class WalkForwardResult:
    scored: list[ScoredMatch]
    refits: int
    refits_hitting_cap: int
    final_params: dc.DCParams
    skipped_thin: int


def walk_forward(
    matches,
    score_from: date,
    xi: float = 0.0,
    refit_days: int = 7,
    min_matches_per_team: int = 15,
    maxiter: int = 400,
    warm_start: bool = True,
) -> WalkForwardResult:
    """Predict every match on or after `score_from` using only prior matches."""
    prev: date | None = None
    for m in matches:
        if prev is not None and m["played"] < prev:
            raise ValueError(
                f"matches must be chronological: {m['played']} came after {prev}")
        prev = m["played"]

    scored: list[ScoredMatch] = []
    params: dc.DCParams | None = None
    last_refit: date | None = None
    refits = hit_cap = skipped = 0

    # Grouped by date so a refit happens at most once per distinct match day,
    # and every fixture on that day is priced by the same fit — which is what a
    # bettor pricing a matchweek would actually have.
    by_date: dict[date, list] = {}
    for m in matches:
        by_date.setdefault(m["played"], []).append(m)

    for d in sorted(by_date):
        day = by_date[d]
        if d < score_from:
            continue

        # STRICTLY BEFORE d. Same-day fixtures are excluded from their own fit.
        history = [m for m in matches if m["played"] < d]
        teams_seen = {m["home"] for m in history} | {m["away"] for m in history}
        if len(history) < min_matches_per_team * max(1, len(teams_seen)):
            skipped += len(day)
            continue

        due = last_refit is None or (d - last_refit) >= timedelta(days=refit_days)
        if due:
            start = params if (warm_start and params is not None) else None
            params, capped = _fit(history, xi, d, maxiter, start)
            refits += 1
            hit_cap += 1 if capped else 0
            last_refit = d

        for m in day:
            h, dr, a = dc.outcome_probs(params, m["home"], m["away"])
            scored.append(ScoredMatch(
                sport=m.get("sport", ""), played=d, home=m["home"], away=m["away"],
                home_goals=m["home_goals"], away_goals=m["away_goals"],
                p_home=h, p_draw=dr, p_away=a, n_train=len(history)))

    return WalkForwardResult(scored, refits, hit_cap,
                             params or dc.DCParams(), skipped)


def _fit(history, xi: float, as_of: date, maxiter: int,
         start: dc.DCParams | None) -> tuple[dc.DCParams, bool]:
    """One fit, optionally warm-started. Returns (params, hit_iteration_cap)."""
    from scipy.optimize import minimize

    teams = sorted({m["home"] for m in history} | {m["away"] for m in history})
    if not teams:
        return dc.DCParams(), False

    if start is not None:
        # Clubs promoted since the last fit have no previous estimate; they
        # start at the mean (0), which is the honest prior for a club this fit
        # has not seen play.
        seed = dc.DCParams(
            attack={t: start.attack.get(t, 0.0) for t in teams},
            defence={t: start.defence.get(t, 0.0) for t in teams},
            home_advantage=start.home_advantage, rho=start.rho)
    else:
        seed = dc.DCParams(attack={t: 0.0 for t in teams},
                           defence={t: 0.0 for t in teams},
                           home_advantage=0.25, rho=-0.05)

    arr = dc._FitArrays(history, teams, xi, as_of)
    n = len(teams)
    res = minimize(lambda v: dc._neg_ll_fast(v, arr, n), dc._pack(seed, teams),
                   method="L-BFGS-B", options={"maxiter": maxiter})
    return dc._unpack(res.x, teams), not bool(res.success)
