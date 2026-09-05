"""Phase 4.6 — walk forward the NHL shots-on-goal prop model and fit it.

THE SAMPLE-SIZE DECISION WAS MADE BEFORE RUNNING, as the plan requires, because
a promising number inside its own confidence interval is not a result. Phase
2.5's ROI table is the cautionary case: its 10% row looked positive and was
noise at n=144.

    cutoff 2025-11-08     SELECT 1,558 rows     HELD OUT 2,312 rows

At n=2,312 the paired SE of a log-loss difference is ~0.0007, so **a gap of
about 0.0015 is detectable at t=2**. For scale, the NHL game gate lost by 0.0093
and tennis by 0.033. This sample resolves differences far finer than any seen so
far, and anything inside +-0.0015 is a genuine tie rather than a weak signal.

WHY THE SPLIT IS INSIDE ONE SEASON. Prop collection is far narrower than the
date range suggests: 5,086 of 5,356 rows (95%) fall in October and November 2025,
with December onward nearly empty. There is no second season to hold out, so the
split is a date cutoff within the one that exists.

NO LEAKAGE. Every projection uses only games played STRICTLY BEFORE the prop's
own game, accumulated in one chronological pass. Chronology is asserted, not
assumed.

WHAT IS FITTED, and why each is a real question rather than a knob:

  toi_window  — ice time is a ROLE and roles change within days, so averaging a
                whole season smooths away the thing that matters. This is the
                leading suspect for 4.5's 4.5% over-projection.
  shrink_k    — how much a short history defers to the league.
  dispersion  — the negative binomial shape. A large value IS Poisson, so
                Poisson is inside the search rather than assumed away.

Run from python-odds-service/:
    python fit_nhl_props.py
"""
import asyncio
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from predict import nhl_props as npx  # noqa: E402

CUTOFF = date(2025, 11, 8)
MIN_PRIOR_GAMES = 5

TOI_WINDOWS = [0, 5, 10, 20]
SHRINK_KS = [5.0, 10.0, 20.0, 40.0]
DISPERSIONS = [2.0, 4.0, 6.0, 10.0, 20.0, 1e6]      # 1e6 == Poisson


def american_to_prob(o) -> float:
    o = float(o)
    return (100.0 / (o + 100.0)) if o > 0 else ((-o) / ((-o) + 100.0))


def run(rows, toi_window: int, k: float, disp: float,
        league_rate: float, league_toi: float):
    """One chronological pass. Returns scored predictions, strictly-before-only."""
    hist: dict[str, npx.PlayerHistory] = {}
    out = []
    prev = None
    for r in rows:
        if prev is not None and r.played < prev:
            raise ValueError("prop rows must be chronological")
        prev = r.played
        h = hist.setdefault(r.athlete_id, npx.PlayerHistory())
        if h.games >= MIN_PRIOR_GAMES:
            p = npx.project(h, league_rate, league_toi, k=k, toi_window=toi_window)
            over = npx.nb_prob_over(r.line, p.expected_sog, disp)
            out.append((r, over, p.expected_sog))
        h.add(r.actual_sog, r.toi)          # AFTER predicting, never before
    return out


def metrics(scored, lo=None, hi=None) -> dict:
    ll = 0.0
    n = hit = 0
    proj = act = 0.0
    for r, over, exp in scored:
        if lo is not None and r.played < lo:
            continue
        if hi is not None and r.played >= hi:
            continue
        won = r.actual_sog > r.line
        p = min(1 - 1e-12, max(1e-12, over if won else 1 - over))
        ll -= math.log(p)
        hit += 1 if (over > 0.5) == won else 0
        proj += exp
        act += r.actual_sog
        n += 1
    if not n:
        return {"n": 0, "log_loss": float("nan"), "acc": float("nan"), "bias": float("nan")}
    return {"n": n, "log_loss": ll / n, "acc": hit / n, "bias": proj / act - 1.0}


async def main() -> int:
    data = await npx.load_shot_props()
    rows = data["rows"]
    print(f"loaded {len(rows):,} prop rows  {rows[0].played} .. {rows[-1].played}")
    print(f"join: {data['stats']}")

    # League constants from the SELECT side only — using all rows would leak the
    # held-out period's scoring environment into the model's fallback.
    sel_rows = [r for r in rows if r.played < CUTOFF]
    league_rate = sum(r.actual_sog for r in sel_rows) / sum(r.toi for r in sel_rows)
    league_toi = sum(r.toi for r in sel_rows) / len(sel_rows)
    print(f"league constants from SELECT only: {league_rate:.5f} sog/min, "
          f"{league_toi:.2f} min\n")

    print("SWEEP — scored on the SELECT window only")
    best = None
    for w in TOI_WINDOWS:
        for k in SHRINK_KS:
            for d in DISPERSIONS:
                sc = run(rows, w, k, d, league_rate, league_toi)
                m = metrics(sc, hi=CUTOFF)
                if m["n"] and (best is None or m["log_loss"] < best[0]):
                    best = (m["log_loss"], w, k, d)
    bll, bw, bk, bd = best
    print(f"  best: toi_window={bw or 'all'}  shrink_k={bk}  dispersion="
          f"{'Poisson' if bd > 1e5 else bd}   select log-loss {bll:.5f}")
    edge = (bw in (TOI_WINDOWS[0], TOI_WINDOWS[-1]) or bk in (SHRINK_KS[0], SHRINK_KS[-1])
            or bd in (DISPERSIONS[0], DISPERSIONS[-1]))
    if edge:
        print("  *** a chosen value sits at the edge of its grid — widen before quoting")

    print("\n  sensitivity on SELECT (holding the others at their best):")
    for label, vals, pos in (("toi_window", TOI_WINDOWS, 0), ("shrink_k", SHRINK_KS, 1),
                             ("dispersion", DISPERSIONS, 2)):
        line = []
        for v in vals:
            args = [bw, bk, bd]
            args[pos] = v
            m = metrics(run(rows, args[0], args[1], args[2], league_rate, league_toi),
                        hi=CUTOFF)
            tag = "Poisson" if (pos == 2 and v > 1e5) else ("all" if (pos == 0 and v == 0) else v)
            line.append(f"{tag}:{m['log_loss']:.5f}")
        print(f"    {label:<11} " + "  ".join(line))

    print(f"\nHELD OUT {CUTOFF}+ (never used to choose anything)")
    base = metrics(run(rows, 0, npx.SHRINK_K, 1e6, league_rate, league_toi), lo=CUTOFF)
    fit = metrics(run(rows, bw, bk, bd, league_rate, league_toi), lo=CUTOFF)
    for label, m in (("unfitted (all-history TOI, Poisson)", base), ("fitted", fit)):
        print(f"  {label:<36} n={m['n']:>5,}  log-loss {m['log_loss']:.5f}  "
              f"acc {m['acc']*100:.1f}%  projection bias {m['bias']*100:+.1f}%")

    # The market, for orientation only — the gate itself is 4.7.
    sc = run(rows, bw, bk, bd, league_rate, league_toi)
    held = [(r, o) for r, o, _ in sc if r.played >= CUTOFF
            and r.over_price is not None and r.under_price is not None]
    if held:
        mll = 0.0
        for r, _o in held:
            po, pu = american_to_prob(r.over_price), american_to_prob(r.under_price)
            q = po / (po + pu)
            won = r.actual_sog > r.line
            mll -= math.log(min(1 - 1e-12, max(1e-12, q if won else 1 - q)))
        print(f"  {'market (de-vigged), same rows':<36} n={len(held):>5,}  "
              f"log-loss {mll/len(held):.5f}   <- 4.7 tests this properly")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
