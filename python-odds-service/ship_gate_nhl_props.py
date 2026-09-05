"""Phase 4.7 — the NHL prop ship gate. Does the shots-on-goal model beat the close?

Same authority order as every gate in this plan: accuracy decides, calibration
is ruled out before any failure is declared, and the economics are
informational.

PARAMETERS COME FROM 4.6 AND ARE NOT RE-TUNED HERE. toi_window=5, shrink_k=10,
dispersion=4.0, fitted on the SELECT window (before 2025-11-08) and applied
unchanged to the held-out rows. Re-fitting on the gate's own data would be
reporting the fit rather than the model.

THE SAMPLE WAS SIZED BEFORE THE FIT, IN 4.6: n=2,312 held out, paired SE of a
log-loss difference ~0.0007, so a gap of ~0.0015 is detectable at t=2 and
anything inside that band is a genuine tie. Phase 2.5's ROI table is why that is
fixed in advance — its 10% row looked positive and was noise at n=144.

TWO-SIDED ONLY. A prop with no under price cannot be de-vigged, so its "edge"
would be partly the bookmaker's margin. 5,140 of 5,356 shots-on-goal rows carry
both sides AND opening prices, so the loss is small and the alternative is
unmeasurable.

CLV IS REAL HERE. Opening prices are present on the same 5,140 rows, so this is
genuine open-to-close movement — the measurement tennis could not make at all
and EPL made at −0.00092 (t=−0.88).

Run from python-odds-service/:
    python ship_gate_nhl_props.py
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
TOI_WINDOW, SHRINK_K, DISPERSION = 5, 10.0, 4.0      # fitted in 4.6


def am_prob(o) -> float:
    o = float(o)
    return (100.0 / (o + 100.0)) if o > 0 else ((-o) / ((-o) + 100.0))


def am_dec(o) -> float:
    o = float(o)
    return 1.0 + (o / 100.0 if o > 0 else 100.0 / (-o))


def ll(p: float) -> float:
    return -math.log(min(1 - 1e-12, max(1e-12, p)))


def paired(a, b):
    d = [x - y for x, y in zip(a, b)]
    n = len(d)
    m = sum(d) / n
    sd = (sum((x - m) ** 2 for x in d) / (n - 1)) ** 0.5
    se = sd / math.sqrt(n)
    return m, se, (m / se if se else float("nan"))


def temper(p: float, T: float) -> float:
    lo = math.log(max(1e-12, p) / max(1e-12, 1 - p)) / T
    return 1.0 / (1.0 + math.exp(-lo))


async def main() -> int:
    data = await npx.load_shot_props()
    rows = data["rows"]
    sel = [r for r in rows if r.played < CUTOFF]
    league_rate = sum(r.actual_sog for r in sel) / sum(r.toi for r in sel)
    league_toi = sum(r.toi for r in sel) / len(sel)

    hist: dict[str, npx.PlayerHistory] = {}
    scored = []
    prev = None
    for r in rows:
        if prev is not None and r.played < prev:
            raise ValueError("prop rows must be chronological")
        prev = r.played
        h = hist.setdefault(r.athlete_id, npx.PlayerHistory())
        if h.games >= MIN_PRIOR_GAMES:
            p = npx.project(h, league_rate, league_toi, k=SHRINK_K,
                            toi_window=TOI_WINDOW)
            scored.append((r, npx.nb_prob_over(r.line, p.expected_sog, DISPERSION)))
        h.add(r.actual_sog, r.toi)        # AFTER predicting

    # Two-sided only, and split by the window the parameters were fitted on.
    def usable(pair):
        r, _ = pair
        return r.over_price is not None and r.under_price is not None

    sel_rows = [x for x in scored if x[0].played < CUTOFF and usable(x)]
    held = [x for x in scored if x[0].played >= CUTOFF and usable(x)]
    print(f"held out {len(held):,} two-sided rows (of {len(scored):,} scored); "
          f"{len(sel_rows):,} in SELECT for calibration only")

    def market(r) -> float:
        po, pu = am_prob(r.over_price), am_prob(r.under_price)
        return po / (po + pu)

    m_ll = [ll(o if r.actual_sog > r.line else 1 - o) for r, o in held]
    k_ll = [ll(market(r) if r.actual_sog > r.line else 1 - market(r)) for r, o in held]

    print("\nGATE 1 — ACCURACY vs the de-vigged close (this decides)")
    mean, se, t = paired(m_ll, k_ll)
    verdict = ("MODEL BEATS" if t < -1.96 else
               "MARKET BEATS" if t > 1.96 else "NO SIGNIFICANT DIFFERENCE")
    macc = sum((o > .5) == (r.actual_sog > r.line) for r, o in held) / len(held)
    kacc = sum((market(r) > .5) == (r.actual_sog > r.line) for r, o in held) / len(held)
    print(f"  model  {sum(m_ll)/len(held):.5f}   market {sum(k_ll)/len(held):.5f}")
    print(f"  model - market {mean:+.5f}  SE {se:.5f}  t={t:+.2f}   {verdict}")
    print(f"  accuracy: model {macc*100:.1f}%   market {kacc*100:.1f}%")
    print(f"  detectable at t=2: {2*se:.5f}")

    print("\nGATE 2 — CALIBRATION, then re-measure before concluding")
    buckets: dict[int, list] = {}
    for r, o in held:
        buckets.setdefault(min(9, int(o * 10)), []).append((r, o))
    worst = 0.0
    for b in sorted(buckets):
        g = buckets[b]
        if len(g) < 40:
            continue
        pred = sum(o for _, o in g) / len(g)
        act = sum(1 for r, _ in g if r.actual_sog > r.line) / len(g)
        worst = max(worst, abs(pred - act))
        print(f"  {b/10:.1f}-{(b+1)/10:.1f}  n={len(g):>5,}  predicted {pred:.3f}  "
              f"actual {act:.3f}  gap {act-pred:+.3f}")
    print(f"  worst gap {worst:+.3f}" + ("  <-- OUT OF TOLERANCE" if worst > 0.05 else ""))

    # Temperature fitted on SELECT only.
    best_T, best = 1.0, None
    for i in range(60):
        T = 0.6 + 0.02 * i
        v = sum(ll(temper(o, T) if r.actual_sog > r.line else 1 - temper(o, T))
                for r, o in sel_rows) / max(1, len(sel_rows))
        if best is None or v < best:
            best, best_T = v, T
    c_ll = [ll(temper(o, best_T) if r.actual_sog > r.line else 1 - temper(o, best_T))
            for r, o in held]
    cm, cse, ct = paired(c_ll, k_ll)
    print(f"  T={best_T:.2f} (fitted on SELECT): raw {sum(m_ll)/len(held):.5f} -> "
          f"calibrated {sum(c_ll)/len(held):.5f}")
    print(f"  calibrated - market {cm:+.5f}  t={ct:+.2f}   "
          f"recovered {(sum(m_ll)-sum(c_ll))/len(held):+.5f} of {mean:.5f}")

    print("\nGATE 3 — CLV (real opening -> closing movement)")
    clv = [(r, o) for r, o in held if r.open_over is not None and r.open_under is not None]
    if clv:
        moves = []
        for r, o in clv:
            po, pu = am_prob(r.open_over), am_prob(r.open_under)
            open_over = po / (po + pu)
            close_over = market(r)
            moves.append((close_over - open_over) if o > 0.5 else (open_over - close_over))
        mean_c = sum(moves) / len(moves)
        sd = (sum((x - mean_c) ** 2 for x in moves) / max(1, len(moves) - 1)) ** 0.5
        se_c = sd / math.sqrt(len(moves))
        print(f"  n={len(clv):,}  mean CLV {mean_c:+.5f}  SE {se_c:.5f}  t={mean_c/se_c:+.2f}")
        print("  positive => the line moved TOWARD the model's side after it was made")
    else:
        print("  no opening prices")

    print("\nGATE 4 — ROI at the quoted price (informational; watch MONOTONICITY)")
    print("  edge      bets      ROI    per-bet SE")
    for thr in (0.00, 0.02, 0.05, 0.10):
        pnl = []
        for r, o in held:
            q = market(r)
            for is_over, mp, price in ((True, o, r.over_price), (False, 1 - o, r.under_price)):
                edge = mp - (q if is_over else 1 - q)
                if edge <= thr:
                    continue
                won = (r.actual_sog > r.line) if is_over else (r.actual_sog < r.line)
                pnl.append(am_dec(price) - 1.0 if won else -1.0)
        if not pnl:
            print(f"  {thr:>4.0%}       0         -")
            continue
        mu = sum(pnl) / len(pnl)
        sd = (sum((x - mu) ** 2 for x in pnl) / max(1, len(pnl) - 1)) ** 0.5
        print(f"  {thr:>4.0%}  {len(pnl):>7,}  {mu*100:+7.2f}%   "
              f"{sd/math.sqrt(len(pnl))*100:.2f}%")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
