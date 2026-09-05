"""Phase 4.3 — fit Dixon-Coles on NHL, and convert its draw into a winner.

REUSES `predict/dixon_coles.py` UNCHANGED. The engine needed nothing for hockey:
attack, defence, home advantage, the low-score correction and time decay all
transfer, and goals-per-team around 3 sits comfortably inside the 0..10 grid
(P(>10) at lambda=3 is ~0.0002).

THE ONE THING THAT DOES NOT TRANSFER IS THE DRAW, and it is NHL-specific enough
to live here rather than in the shared engine — soccer's draw is a real outcome
and must not be touched.

An NHL final score never ties: overtime and a shootout resolve every game, which
is why `game_result` shows 0 ties across 24,889 rows. But a Poisson score matrix
puts real mass on the diagonal. So the model's P(draw) is not a prediction of a
draw — it is a prediction that the game REACHES overtime, and that mass has to
be split between the two teams to answer the question the market asks. The NHL
moneyline is two-way (measured: 67,027 home / 67,030 away, no draw side).

    P(home wins) = P(home > away) + P_OT_HOME * P(tie)
    P(away wins) = P(away > home) + (1 - P_OT_HOME) * P(tie)

P_OT_HOME IS 0.5, AND THAT IS A DELIBERATE NON-MEASUREMENT. The empirical value
cannot be established from this database: `nhl_shot_events` keys games by the NHL
API id (`2024010001`) while `game_result` uses ESPN's (`401685327`), and no
crosswalk exists. Bridging on (date, team pair) resolves only 473 of 1,503 games
— 31% — and that subset is visibly biased, showing 59.8% home wins against the
true 54.3%. An OT split estimated from it (62.1%, n=87) would be an artefact of
the join, not a fact about hockey. 0.5 is the neutral choice; the sensitivity is
small (a 0.53 split moves P(home) by ~0.006), and the honest position is that
this is unmeasured rather than measured-as-half.

Run from python-odds-service/:
    python fit_nhl_dc.py
"""
import asyncio
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from predict import dc_walkforward as wf  # noqa: E402
from predict import dixon_coles as dc  # noqa: E402
from predict import nhl_teams as nt  # noqa: E402

SELECT_FROM = date(2022, 1, 1)
HELD_OUT_FROM = date(2024, 1, 1)
P_OT_HOME = 0.5

# Widened after the first run returned 0.004, the old top of the grid.
# A parameter at its search bound is not a fitted parameter (Phase 2.4).
XI_GRID = [0.0, 0.001, 0.002, 0.004, 0.008, 0.016]


def two_way(s) -> tuple[float, float]:
    """(P home wins, P away wins) — the diagonal split, see the module docstring."""
    h = s.p_home + P_OT_HOME * s.p_draw
    a = s.p_away + (1.0 - P_OT_HOME) * s.p_draw
    tot = h + a
    return h / tot, a / tot


def metrics(scored, lo=None, hi=None) -> dict:
    ll = brier = 0.0
    n = hit = 0
    for s in scored:
        if lo is not None and s.played < lo:
            continue
        if hi is not None and s.played >= hi:
            continue
        ph, _ = two_way(s)
        won = s.home_goals > s.away_goals
        p = min(1 - 1e-12, max(1e-12, ph if won else 1 - ph))
        ll -= math.log(p)
        brier += (ph - (1.0 if won else 0.0)) ** 2
        hit += 1 if (ph > 0.5) == won else 0
        n += 1
    if not n:
        return {"n": 0, "log_loss": float("nan"), "brier": float("nan"), "acc": float("nan")}
    return {"n": n, "log_loss": ll / n, "brier": brier / n, "acc": hit / n}


def show(label: str, m: dict) -> None:
    print(f"    {label:<28} n={m['n']:>6,}  log-loss {m['log_loss']:.5f}  "
          f"brier {m['brier']:.5f}  acc {m['acc']*100:.1f}%")


async def main() -> int:
    games = await nt.load_nhl_games()
    print(f"NHL: {len(games):,} games  {games[0]['played']} .. {games[-1]['played']}")
    print(f"burn-in <{SELECT_FROM} | select {SELECT_FROM}..{HELD_OUT_FROM} | "
          f"held out {HELD_OUT_FROM}..\n")

    print("BASELINE — unfitted defaults (soccer's fitted values, as a starting point)")
    base_sel = wf.walk_forward(games, score_from=SELECT_FROM, xi=0.0, refit_days=7)
    show("select, no decay", metrics(base_sel.scored, SELECT_FROM, HELD_OUT_FROM))

    print("\nXI SWEEP — scored on the SELECT window only")
    results = []
    for xi in XI_GRID:
        r = wf.walk_forward(games, score_from=SELECT_FROM, xi=xi, refit_days=7)
        m = metrics(r.scored, SELECT_FROM, HELD_OUT_FROM)
        hl = "no decay" if xi == 0 else f"half-life {math.log(2)/xi:>5.0f}d"
        results.append((m["log_loss"], xi))
        print(f"    xi={xi:<7.4f} {hl:<16} log-loss {m['log_loss']:.5f}  "
              f"({r.refits} refits, {r.refits_hitting_cap} capped)")
    results.sort()
    best_ll, best_xi = results[0]
    edge = best_xi in (XI_GRID[0], XI_GRID[-1])
    print(f"  -> best xi = {best_xi}")
    if edge:
        print("     *** AT THE EDGE OF THE SWEEP — inconclusive, widen before quoting.")

    print(f"\nHELD OUT {HELD_OUT_FROM}+ (never used to choose anything)")
    b = wf.walk_forward(games, score_from=HELD_OUT_FROM, xi=0.0, refit_days=7)
    f = wf.walk_forward(games, score_from=HELD_OUT_FROM, xi=best_xi, refit_days=7)
    show("no decay", metrics(b.scored, HELD_OUT_FROM))
    show(f"fitted decay (xi={best_xi})", metrics(f.scored, HELD_OUT_FROM))
    d = metrics(f.scored, HELD_OUT_FROM)["log_loss"] - metrics(b.scored, HELD_OUT_FROM)["log_loss"]
    print(f"    decay changes held-out log-loss by {d:+.5f} "
          f"({'better' if d < 0 else 'WORSE'})")

    p = f.final_params
    print(f"\nFITTED: home_advantage={p.home_advantage:.3f}  rho={p.rho:+.4f}")
    at_bound = []
    if abs(p.rho - dc.RHO_MIN) < 1e-6 or abs(p.rho - dc.RHO_MAX) < 1e-6:
        at_bound.append(f"rho pinned at {p.rho:+.3f}")
    if edge:
        at_bound.append(f"xi at sweep edge ({best_xi})")
    print(f"BOUNDS CHECK: {'; '.join(at_bound) if at_bound else 'no parameter is at a bound'}")
    print(f"convergence: {f.refits_hitting_cap} of {f.refits} refits hit the cap")

    end = games[-1]["played"]
    eff: dict[str, float] = {}
    for m in games:
        w = math.exp(-best_xi * (end - m["played"]).days) if best_xi > 0 else 1.0
        for t in (m["home"], m["away"]):
            eff[t] = eff.get(t, 0.0) + w
    rank = sorted(((p.attack[t] + p.defence[t], t) for t in p.attack
                   if eff.get(t, 0.0) >= 10.0), reverse=True)
    print("strongest: " + ", ".join(f"{t} {v:+.2f}" for v, t in rank[:5]))
    print("weakest:   " + ", ".join(f"{t} {v:+.2f}" for v, t in rank[-5:]))

    print("\nPER YEAR (held out):")
    for y in range(HELD_OUT_FROM.year, 2027):
        m = metrics(f.scored, date(y, 1, 1), date(y + 1, 1, 1))
        if m["n"]:
            show(str(y), m)
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
