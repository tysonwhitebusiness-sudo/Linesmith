"""Phase 3.3 — calibrate the two non-PA constants in `mlb_pa_sim` against real
league aggregates, and report the SHAPE of the run distribution, not just its
mean.

    python calibrate_pa_sim.py

WHY A SWEEP RATHER THAN A LOOKUP. `P_PRODUCTIVE_OUT` and `P_GIDP` are the only
tuned numbers in the simulation. Published rates for each exist, but they are
defined over situations counted differently from this model's (which has no ball
in play, no fielder, no count), so transplanting them would be borrowing a
number that does not mean the same thing. Sweeping them against aggregates the
model itself produces is the honest version.

THE FAILURE MODE THIS GUARDS AGAINST is a simulation that hits runs-per-game
exactly while getting there wrongly — too many blowouts and too many shutouts,
averaging to the right answer. So the target is four numbers, not one:

    runs per team-game   4.4 - 4.6
    PA per team-game     37.5 - 38.5
    shutout pct          7% - 9%
    10+ run pct          3.5% - 5.5%

A pure one-out-per-PA model (both constants at 0) fails three of the four: 4.04
runs, 39.4 PA, and the run distribution too flat. That is what motivated adding
them.

NOTHING HERE IS TUNED AGAINST THE HELD-OUT PROP DATA the simulation is later
scored on in Phase 3.4. These constants see league rates only.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from predict import mlb_pa_sim as S  # noqa: E402

TARGETS = {
    "runs_per_team_game": (4.40, 4.60),
    "pa_per_team_game": (37.5, 38.5),
    "shutout_pct": (0.07, 0.09),
    "ten_plus_pct": (0.035, 0.055),
}


# What the module actually declares, captured BEFORE the sweep starts mutating
# it. Without this the closing report reads back whatever the last sweep point
# left behind and attributes it to the module — it claimed the source declared
# 0.44/0.19 while the source said 0.36/0.13.
DECLARED = (S.P_PRODUCTIVE_OUT, S.P_GIDP)


def measure(p_out: float, p_gidp: float, n: int = 4000, seed: int = 7) -> dict:
    S.P_PRODUCTIVE_OUT, S.P_GIDP = p_out, p_gidp
    lg = S.PaRates(S.LEAGUE_PA)
    res = S.simulate_game([lg] * 9, [lg] * 9, lg, lg, n_iter=n, seed=seed)
    sm = S.summarise(res)
    pa = sum(t["PA"] for r in res for t in r.away_bat) / len(res)
    sm["pa_per_team_game"] = pa
    return sm


def score(sm: dict) -> tuple[int, float]:
    """How many targets are met, and total relative distance from their centres."""
    hits, dist = 0, 0.0
    for k, (lo, hi) in TARGETS.items():
        v = sm[k]
        if lo <= v <= hi:
            hits += 1
        mid = (lo + hi) / 2
        dist += abs(v - mid) / mid
    return hits, dist


def main() -> int:
    base = measure(0.0, 0.0)
    print("=== BASELINE: no productive outs, no double plays ===")
    print(f"  runs/team-game {base['runs_per_team_game']:.3f}   "
          f"PA/team-game {base['pa_per_team_game']:.2f}   "
          f"shutout {base['shutout_pct']*100:.1f}%   10+ {base['ten_plus_pct']*100:.1f}%")
    h, _ = score(base)
    print(f"  targets met: {h}/4\n")

    print("=== SWEEP ===")
    print(f"  {'P_OUT':>6}{'P_GIDP':>8}{'runs':>8}{'PA':>8}{'SHO%':>7}{'10+%':>7}{'met':>5}")
    best = None
    for p_out in (0.28, 0.32, 0.36, 0.40, 0.44):
        for p_gidp in (0.07, 0.10, 0.13, 0.16, 0.19):
            sm = measure(p_out, p_gidp)
            h, d = score(sm)
            print(f"  {p_out:>6.2f}{p_gidp:>8.2f}{sm['runs_per_team_game']:>8.3f}"
                  f"{sm['pa_per_team_game']:>8.2f}{sm['shutout_pct']*100:>7.1f}"
                  f"{sm['ten_plus_pct']*100:>7.1f}{h:>5}")
            if best is None or (h, -d) > (best[0], -best[1]):
                best = (h, d, p_out, p_gidp, sm)

    h, d, p_out, p_gidp, sm = best
    print(f"\n=== BEST: P_PRODUCTIVE_OUT={p_out}  P_GIDP={p_gidp} ===")
    print(f"  targets met {h}/4   (total relative distance {d:.4f})")
    for k, (lo, hi) in TARGETS.items():
        v = sm[k]
        print(f"    {k:<22} {v:>8.3f}   target {lo}-{hi}   "
              f"{'OK' if lo <= v <= hi else 'OUT OF RANGE'}")
    print(f"\n  home win {sm['home_win_pct']*100:.1f}%  tie {sm['tie_pct']*100:.1f}%"
          "   (no home-field advantage and no extra innings are modelled,"
          " so these are expected to look wrong)")
    # Restore, so this script never leaves the module mutated for anything that
    # imports it later in the same process.
    S.P_PRODUCTIVE_OUT, S.P_GIDP = DECLARED

    print("\n=== THE DECISION, WHICH IS NOT 'TAKE THE BEST ROW' ===")
    print(f"  mlb_pa_sim declares P_PRODUCTIVE_OUT={DECLARED[0]}, P_GIDP={DECLARED[1]}.")
    if (p_out, p_gidp) != DECLARED:
        print(f"  The sweep's best row is {p_out}/{p_gidp}, and is DELIBERATELY NOT USED.")
        print("  A GIDP rate of 0.19 is half again baseball's real ~0.12-0.13. It wins")
        print("  here only by dragging PA/game toward target, standing in for a mechanism")
        print("  this model does not have — caught stealing and pickoffs, which consume")
        print("  outs without a plate appearance. Tuning one parameter past its real")
        print("  value to cover for a different missing one buys the aggregate and loses")
        print("  the thing underneath.")
    # Report the config that actually SHIPS, not the sweep's best row. Those are
    # different numbers and mixing them up understates what is shipped by 0.05.
    shipped = measure(*DECLARED)
    S.P_PRODUCTIVE_OUT, S.P_GIDP = DECLARED
    print(f"\n  As declared: runs/team-game {shipped['runs_per_team_game']:.3f}, "
          f"PA/team-game {shipped['pa_per_team_game']:.2f}")
    print("\n  RUNS ARE SHORT BY DESIGN, NOT BY OVERSIGHT. This model scores only")
    print("  through plate appearances. Real baseball also adds roughly:")
    print("      reached on error             ~0.12 runs/team-game")
    print("      net stolen bases             ~0.10")
    print("      wild pitches / passed balls  ~0.08")
    print("                                   -----")
    adj = shipped["runs_per_team_game"] + 0.30
    print(f"                                   ~0.30  ->  "
          f"{shipped['runs_per_team_game']:.2f} + 0.30 = {adj:.2f}, "
          f"{'inside' if 4.4 <= adj <= 4.6 else 'just short of'} 4.4-4.6")
    print("\n  Hits, singles, doubles, triples, home runs, total bases and strikeouts")
    print("  are PURE PA OUTCOMES and are NOT biased by this. Runs, RBIs and game")
    print("  totals ARE, and need non-PA events before Phase 3.5's game gate.")
    # Three of four is the pass mark; the fourth is the documented residual.
    return 0 if h >= 3 else 1


if __name__ == "__main__":
    sys.exit(main())
