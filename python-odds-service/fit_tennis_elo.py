"""Phases 2.3 + 2.4 — fit the tennis Elo parameters, and test whether the
reversion rules actually earn their place.

Run together because they answer the same question with the same machinery: 2.3
asks whether time-based reversion helps, and the only honest way to answer that
is to fit it and compare against it being off.

THE SPLIT, and why it is three windows rather than two:

    ..2016-12-31   BURN-IN   ratings move, nothing is scored
    2017..2022     TRAIN     parameters are fitted here, and ONLY here
    2023..         HELD OUT  never seen by the optimiser; the reported number

Fitting and reporting on the same rows would report the optimiser's ability to
memorise, and every metric below would look better and mean nothing. Two burn-in
seasons rather than one because a late-2015 debutant entering 2016 still sits
near a cold 1500, and scoring those matches measures the burn-in.

WHAT IS BEING DECIDED:
  k, w_hard, w_clay, w_grass          the engine's core (2.2)
  reversion_months                    2.3's surface reversion
  overall_reversion_months            the idle decay 2.2 flagged as open

Each reversion is fitted AND tested against being switched off, so "the rule
helps" is a measurement rather than an assumption. A rule that does not beat its
own absence is reported as carrying no weight rather than quietly kept.

Run from python-odds-service/:
    python fit_tennis_elo.py
"""
import asyncio
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import tennis_elo as te  # noqa: E402

BURN_IN_END = date(2017, 1, 1)
TRAIN_END = date(2023, 1, 1)

_matches: list[dict] | None = None


async def load_matches() -> list[dict]:
    global _matches
    if _matches is not None:
        return _matches
    pool = await db.get_pool()
    async with pool.acquire(timeout=60.0) as c:
        rows = await c.fetch(
            """SELECT sport, game_date, surface, home_team_raw h, away_team_raw a,
                      (home_score > away_score) home_won
                 FROM game_result
                WHERE sport LIKE 'tennis%' AND surface IS NOT NULL
                ORDER BY game_date, id"""
        )
    _matches = [{"sport": r["sport"], "played": r["game_date"], "surface": r["surface"],
                 "home": r["h"], "away": r["a"], "home_won": r["home_won"]} for r in rows]
    return _matches


def metrics(scored, lo: date | None = None, hi: date | None = None,
            surface: str | None = None) -> dict:
    ll = brier = 0.0
    n = hit = 0
    for s in scored:
        if lo is not None and s.played < lo:
            continue
        if hi is not None and s.played >= hi:
            continue
        if surface is not None and s.surface != surface:
            continue
        p = min(1 - 1e-12, max(1e-12, s.predicted))
        y = 1.0 if s.home_won else 0.0
        ll -= y * math.log(p) + (1 - y) * math.log(1 - p)
        brier += (p - y) ** 2
        hit += 1 if (p > 0.5) == s.home_won else 0
        n += 1
    if not n:
        return {"n": 0, "log_loss": float("nan"), "brier": float("nan"), "acc": float("nan")}
    return {"n": n, "log_loss": ll / n, "brier": brier / n, "acc": hit / n}


def run(matches, params: te.EloParams):
    scored, engine = te.replay(matches, params, score_from=BURN_IN_END)
    return scored, engine


def _clip(v, lo, hi):
    return max(lo, min(hi, v))


def params_from_vector(v, with_decay: bool) -> te.EloParams:
    return te.EloParams(
        k=_clip(v[0], 2.0, 80.0),
        w_hard=_clip(v[1], 0.0, 1.0),
        w_clay=_clip(v[2], 0.0, 1.0),
        w_grass=_clip(v[3], 0.0, 1.0),
        # 1200 months = a century: far past the 11.6-year data span, so the
        # optimiser can express "effectively off" WITHOUT hitting a wall.
        # At 120 it pinned to the bound in both fits, which is not a fitted
        # value — it is the optimiser being stopped mid-descent.
        reversion_months=_clip(v[4], 0.5, 1200.0),
        overall_reversion_months=(_clip(v[5], 0.0, 2400.0) if with_decay else 0.0),
    )


def fit(matches, with_decay: bool, label: str) -> te.EloParams:
    from scipy.optimize import minimize

    calls = {"n": 0}

    def objective(v):
        p = params_from_vector(v, with_decay)
        scored, _ = run(matches, p)
        m = metrics(scored, BURN_IN_END, TRAIN_END)   # TRAIN WINDOW ONLY
        calls["n"] += 1
        return m["log_loss"]

    x0 = [24.0, 0.60, 0.55, 0.30, 18.0, 0.0 if not with_decay else 36.0]
    res = minimize(objective, x0, method="Nelder-Mead",
                   options={"maxiter": 400, "xatol": 1e-2, "fatol": 1e-6})
    best = params_from_vector(res.x, with_decay)
    print(f"  {label}: {calls['n']} evaluations, train log-loss {res.fun:.5f}")
    return best


def show(label: str, m: dict) -> None:
    print(f"    {label:<34} n={m['n']:>6,}  log-loss {m['log_loss']:.5f}  "
          f"brier {m['brier']:.5f}  acc {m['acc']*100:.1f}%")


async def main() -> int:
    matches = await load_matches()
    print(f"loaded {len(matches):,} matches  {matches[0]['played']} .. {matches[-1]['played']}")
    print(f"burn-in <{BURN_IN_END} | train {BURN_IN_END}..{TRAIN_END} | held out {TRAIN_END}..\n")

    print("BASELINE — unfitted defaults")
    scored, _ = run(matches, te.EloParams())
    show("train", metrics(scored, BURN_IN_END, TRAIN_END))
    show("held out", metrics(scored, TRAIN_END))

    print("\nFITTING (train window only)")
    p5 = fit(matches, with_decay=False, label="5 params, no overall decay")
    p6 = fit(matches, with_decay=True, label="6 params, with overall decay")

    print("\nFITTED PARAMETERS")
    for lbl, p in (("5-param", p5), ("6-param", p6)):
        print(f"  {lbl}: k={p.k:.2f} w_hard={p.w_hard:.3f} w_clay={p.w_clay:.3f} "
              f"w_grass={p.w_grass:.3f} surf_revert={p.reversion_months:.1f}mo "
              f"overall_revert={p.overall_reversion_months:.1f}mo")

    print("\nHELD-OUT PERFORMANCE (2023+, never seen by the optimiser)")
    s5, _ = run(matches, p5)
    s6, _ = run(matches, p6)
    show("baseline", metrics(scored, TRAIN_END))
    show("fitted, 5 params", metrics(s5, TRAIN_END))
    show("fitted, 6 params (+decay)", metrics(s6, TRAIN_END))

    best, best_s = (p6, s6) if metrics(s6, TRAIN_END)["log_loss"] < metrics(s5, TRAIN_END)["log_loss"] else (p5, s5)
    print(f"  -> better on held out: {'6-param (+decay)' if best is p6 else '5-param'}")

    # ---- 2.3: does surface reversion actually earn its place? --------------
    print("\n2.3 — SURFACE REVERSION, on vs off (same k and weights)")
    off = te.EloParams(k=best.k, w_hard=best.w_hard, w_clay=best.w_clay,
                       w_grass=best.w_grass, reversion_months=1e9,
                       overall_reversion_months=best.overall_reversion_months)
    s_off, _ = run(matches, off)
    show("reversion ON  (all surfaces)", metrics(best_s, TRAIN_END))
    show("reversion OFF (all surfaces)", metrics(s_off, TRAIN_END))
    print("  grass only — the surface the 2020 gap actually hit:")
    show("reversion ON  (grass)", metrics(best_s, TRAIN_END, surface="Grass"))
    show("reversion OFF (grass)", metrics(s_off, TRAIN_END, surface="Grass"))
    print("  2021 Wimbledon fortnight — the first grass after the cancelled 2020:")
    w_lo, w_hi = date(2021, 6, 20), date(2021, 7, 15)
    show("reversion ON  (2021 Wim)", metrics(best_s, w_lo, w_hi, surface="Grass"))
    show("reversion OFF (2021 Wim)", metrics(s_off, w_lo, w_hi, surface="Grass"))

    # ---- per-year, because a pooled number hides drift ---------------------
    print("\nPER-YEAR (held out), best model — a pooled number hides drift")
    for y in range(2023, 2027):
        show(str(y), metrics(best_s, date(y, 1, 1), date(y + 1, 1, 1)))

    print("\nPER-SURFACE (held out), best model")
    for surf in te.SURFACES:
        show(surf, metrics(best_s, TRAIN_END, surface=surf))
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
