"""Phase 3.4 — fit Dixon-Coles per league and measure it honestly.

THREE WINDOWS, not two, because xi is a HYPERPARAMETER. The club attack and
defence parameters are re-fitted inside every walk-forward step; xi (time decay)
is not — it is chosen once, and choosing it on the held-out window would report
the selection rather than the model.

    ..2021-12-31   history    fits happen here from the start
    2022..2023     SELECT     xi is chosen here, and only here
    2024..         HELD OUT   never used to choose anything; the reported number

THE SWEEP MUST NOT END AT ITS OWN EDGE. Phase 2.4 returned the clip bound in
both solutions and widening it changed the conclusion; a parameter pinned to the
edge of its search is not a fitted parameter. If the best xi lands on the first
or last candidate, the sweep is reported as INCONCLUSIVE and widened rather than
quoted.

WHY xi MATTERS HERE SPECIFICALLY. 3.3 measured home_advantage at 0.198 over
2015-2026 but 0.133 over 2023-25 alone: Premier League home advantage has
genuinely declined since 2020. Fitting one number across that structural break
averages two different eras. Time decay is the mechanism that should fix it, so
this sweep is a real test of a real effect rather than a routine tune.

Run from python-odds-service/:
    python fit_soccer_dc.py
"""
import asyncio
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from predict import dc_walkforward as wf  # noqa: E402
from predict import dixon_coles as dc  # noqa: E402
from predict import soccer_teams as st  # noqa: E402

SELECT_FROM = date(2022, 1, 1)
HELD_OUT_FROM = date(2024, 1, 1)

# Half-lives: 0.0005 -> 3.8y, 0.001 -> 1.9y, 0.002 -> 0.95y, 0.003 -> 0.63y,
# 0.005 -> 0.38y. 0.0 is "no decay", the null this must beat to be worth having.
XI_GRID = [0.0, 0.0005, 0.001, 0.002, 0.003, 0.005]


def metrics(scored, lo=None, hi=None, outcome=None) -> dict:
    ll = brier = 0.0
    n = hit = 0
    for s in scored:
        if lo is not None and s.played < lo:
            continue
        if hi is not None and s.played >= hi:
            continue
        if outcome is not None and s.outcome != outcome:
            continue
        p = min(1 - 1e-12, max(1e-12, s.p_actual))
        ll -= math.log(p)
        # Three-way Brier: summed squared error over the full outcome vector.
        for name, prob in (("home", s.p_home), ("draw", s.p_draw), ("away", s.p_away)):
            brier += (prob - (1.0 if s.outcome == name else 0.0)) ** 2
        top = max((s.p_home, "home"), (s.p_draw, "draw"), (s.p_away, "away"))[1]
        hit += 1 if top == s.outcome else 0
        n += 1
    if not n:
        return {"n": 0, "log_loss": float("nan"), "brier": float("nan"), "acc": float("nan")}
    return {"n": n, "log_loss": ll / n, "brier": brier / n, "acc": hit / n}


def show(label: str, m: dict) -> None:
    print(f"    {label:<26} n={m['n']:>6,}  log-loss {m['log_loss']:.5f}  "
          f"brier {m['brier']:.5f}  top-pick {m['acc']*100:.1f}%")


async def run_league(sport: str) -> None:
    print(f"\n{'=' * 66}\n{sport}\n{'=' * 66}")
    matches = await st.load_soccer_matches(sport)
    print(f"  {len(matches):,} matches  {matches[0]['played']} .. {matches[-1]['played']}")

    # ---- select xi on the SELECT window only ------------------------------
    print(f"\n  xi sweep, scored on {SELECT_FROM}..{HELD_OUT_FROM} only:")
    results = []
    for xi in XI_GRID:
        r = wf.walk_forward(matches, score_from=SELECT_FROM, xi=xi, refit_days=7)
        m = metrics(r.scored, SELECT_FROM, HELD_OUT_FROM)
        half = (math.log(2) / xi) if xi > 0 else float("inf")
        results.append((m["log_loss"], xi, r))
        hl = "no decay" if xi == 0 else f"half-life {half:>5.0f}d"
        print(f"    xi={xi:<7.4f} {hl:<16} log-loss {m['log_loss']:.5f}  "
              f"({r.refits} refits, {r.refits_hitting_cap} capped)")

    results.sort()
    best_ll, best_xi, _ = results[0]
    edge = best_xi in (XI_GRID[0], XI_GRID[-1])
    print(f"  -> best xi = {best_xi}")
    if edge:
        print("     *** AT THE EDGE OF THE SWEEP — inconclusive, widen before quoting."
              "\n         A parameter pinned to its search bound is not a fitted parameter.")

    # ---- report on HELD OUT, which chose nothing --------------------------
    print(f"\n  HELD OUT {HELD_OUT_FROM}+ (the optimiser never saw this):")
    base = wf.walk_forward(matches, score_from=HELD_OUT_FROM, xi=0.0, refit_days=7)
    best = wf.walk_forward(matches, score_from=HELD_OUT_FROM, xi=best_xi, refit_days=7)
    show("no decay (xi=0)", metrics(base.scored, HELD_OUT_FROM))
    show(f"fitted decay (xi={best_xi})", metrics(best.scored, HELD_OUT_FROM))

    b, f = metrics(base.scored, HELD_OUT_FROM), metrics(best.scored, HELD_OUT_FROM)
    delta = f["log_loss"] - b["log_loss"]
    print(f"    decay changes held-out log-loss by {delta:+.5f} "
          f"({'better' if delta < 0 else 'WORSE'})")

    p = best.final_params
    print(f"\n  FITTED PARAMETERS (final refit): home_advantage={p.home_advantage:.3f}  "
          f"rho={p.rho:+.4f}")
    at_bound = []
    if abs(p.rho - dc.RHO_MIN) < 1e-6 or abs(p.rho - dc.RHO_MAX) < 1e-6:
        at_bound.append(f"rho pinned at {p.rho:+.3f}")
    if edge:
        at_bound.append(f"xi at sweep edge ({best_xi})")
    print(f"  BOUNDS CHECK: {'; '.join(at_bound) if at_bound else 'no parameter is at a bound'}")
    print(f"  convergence: {best.refits_hitting_cap} of {best.refits} refits hit the cap")

    # RANK ONLY CLUBS WITH A REAL EFFECTIVE SAMPLE.
    #
    # Under a 347-day half-life a long-relegated club has ~0 decay-weighted
    # matches, so its two parameters rest on almost nothing and land at
    # extremes. Measured 2026-09-04: EPL had Hull ranked above Arsenal on ~6
    # recent matches, and Middlesbrough sits at 0.0 effective matches.
    #
    # This is a REPORTING problem, not a prediction one. Those clubs appear in
    # 39 of 964 held-out EPL fixtures (4.0%) and held-out log-loss is BETTER
    # including them (0.98837) than excluding them (0.99632). So the fix is to
    # stop the table lying, not to drop the matches or bend the model.
    end = matches[-1]["played"]
    eff = {}
    for m in matches:
        w = math.exp(-best_xi * (end - m["played"]).days) if best_xi > 0 else 1.0
        for t in (m["home"], m["away"]):
            eff[t] = eff.get(t, 0.0) + w
    MIN_EFF = 10.0
    strength = {t: p.attack[t] + p.defence[t]
                for t in p.attack if eff.get(t, 0.0) >= MIN_EFF}
    thin = sorted(t for t in p.attack if eff.get(t, 0.0) < MIN_EFF)
    rank = sorted(strength.items(), key=lambda kv: -kv[1])
    print(f"  (ranking {len(rank)} clubs with >= {MIN_EFF:.0f} effective matches; "
          f"{len(thin)} too thin to rank)")
    print("  strongest: " + ", ".join(f"{t} {v:+.2f}" for t, v in rank[:4]))
    print("  weakest:   " + ", ".join(f"{t} {v:+.2f}" for t, v in rank[-4:]))
    if thin:
        extra = f" (+{len(thin) - 6} more)" if len(thin) > 6 else ""
        print(f"  too thin to rank: {', '.join(thin[:6])}{extra}")

    print("\n  PER YEAR (held out) — a pooled number hides drift:")
    for y in range(HELD_OUT_FROM.year, 2027):
        m = metrics(best.scored, date(y, 1, 1), date(y + 1, 1, 1))
        if m["n"]:
            show(str(y), m)

    print("\n  PER OUTCOME — the draw is where Poisson models fail:")
    for o in ("home", "draw", "away"):
        m = metrics(best.scored, HELD_OUT_FROM, outcome=o)
        if m["n"]:
            share = m["n"] / len(best.scored) * 100
            print(f"    {o:<6} {m['n']:>5,} matches ({share:4.1f}%)  "
                  f"mean P(actual) {math.exp(-m['log_loss']):.3f}")


async def main() -> int:
    for sport in ("soccer_epl", "soccer_mls"):
        await run_league(sport)
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
