"""Phase 4.8 — extend the prop engine to every two-sided NHL market.

The engine is market-agnostic: volume x rate x shape, swapping which stat it
projects. This runs all of them and reports each SEPARATELY — pooling would let
a strong shots model hide a broken hits model.

TWO BARS, because Phase 9's split now governs what ships:

  STATS BAR (what the board needs) — is the projection CALIBRATED and correctly
  ORDERED against outcomes? No market comparison. This is the bar that decides
  whether a market appears on the ranking board.

  BETTING BAR (informational here) — does it beat the de-vigged close? Reported
  for completeness; nothing has cleared it and the board no longer waits on it.

TOTAL POWER PLAY POINTS IS EXCLUDED, and for a stronger reason than the plan
gave. The plan called it data-limited because there is no power-play ice time.
Measured, it is worse than that: the market settles on power-play goals PLUS
power-play assists, and the database carries only `powerPlayGoals`. So the
"actual" outcome computed for it is not the outcome the bet settles on — mean
0.08 against a real PP-points mean several times higher, and an apparent over
rate of 7.9%. Both sides of the comparison are wrong, so it cannot be scored at
all, let alone modelled. Excluded, not flagged.

TOTAL GOALS AND TOTAL HITS STOP ON 2025-12-01. Their held-out windows are short
and that is reported alongside their numbers rather than buried.

Run from python-odds-service/:
    python fit_nhl_props_all.py
"""
import asyncio
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from predict import nhl_props as npx  # noqa: E402

CUTOFF = date(2025, 11, 8)
MIN_PRIOR = 5
TOI_WINDOWS = [0, 5, 10]
SHRINK_KS = [5.0, 10.0, 20.0]
DISPERSIONS = [1.0, 2.0, 4.0, 8.0, 20.0, 1e6]

MARKETS = ["Total Shots on Goal", "Total Points", "Total Assists",
           "Total Goals", "Total Blocked Shots", "Total Hits"]

# The board and the serving path key on a dimension slug, not the vendor's
# market label — `prop_model_cache.dimension` and generic_dimension_configs
# both already use this style, so the same NHL market has ONE name across the
# fit, the cache and the config rather than three spellings to reconcile.
DIMENSION = {
    "Total Shots on Goal": "shots-on-goal",
    "Total Points": "points",
    "Total Assists": "assists",
    "Total Goals": "goals",
    "Total Blocked Shots": "blocked-shots",
    "Total Hits": "hits",
}


def am_prob(o) -> float:
    o = float(o)
    return (100.0 / (o + 100.0)) if o > 0 else ((-o) / ((-o) + 100.0))


def ll(p: float) -> float:
    return -math.log(min(1 - 1e-12, max(1e-12, p)))


def paired(a, b):
    d = [x - y for x, y in zip(a, b)]
    n = len(d)
    m = sum(d) / n
    sd = (sum((x - m) ** 2 for x in d) / (n - 1)) ** 0.5
    se = sd / math.sqrt(n)
    return m, se, (m / se if se else float("nan"))


def temper(p, T):
    lo = math.log(max(1e-12, p) / max(1e-12, 1 - p)) / T
    return 1.0 / (1.0 + math.exp(-lo))


def walk(rows, w, k, disp, lr, lt):
    hist, out = {}, []
    for r in rows:
        h = hist.setdefault(r.athlete_id, npx.PlayerHistory())
        if h.games >= MIN_PRIOR:
            p = npx.project(h, lr, lt, k=k, toi_window=w)
            out.append((r, npx.nb_prob_over(r.line, p.expected_sog, disp), p.expected_sog))
        h.add(r.actual_sog, r.toi)
    return out


def score(sc, lo=None, hi=None):
    v = [x for x in sc if (lo is None or x[0].played >= lo)
         and (hi is None or x[0].played < hi)]
    if not v:
        return None
    n = len(v)
    L = sum(ll(o if r.actual_sog > r.line else 1 - o) for r, o, _ in v) / n
    acc = sum(1 for r, o, _ in v if (o > 0.5) == (r.actual_sog > r.line)) / n
    proj = sum(e for _, _, e in v) / n
    act = sum(r.actual_sog for r, _, _ in v) / n
    return {"n": n, "ll": L, "acc": acc, "bias": proj / act - 1 if act else float("nan"),
            "rows": v}


async def run_market(market: str, persist: bool = False) -> None:
    d = await npx.load_shot_props(market=market)
    rows = d["rows"]
    sel_src = [r for r in rows if r.played < CUTOFF]
    if len(sel_src) < 200:
        print(f"\n{market}: only {len(sel_src)} SELECT rows — too few to fit")
        return
    lr = sum(r.actual_sog for r in sel_src) / sum(r.toi for r in sel_src)
    lt = sum(r.toi for r in sel_src) / len(sel_src)

    best = None
    for w in TOI_WINDOWS:
        for k in SHRINK_KS:
            for dsp in DISPERSIONS:
                m = score(walk(rows, w, k, dsp, lr, lt), hi=CUTOFF)
                if m and (best is None or m["ll"] < best[0]):
                    best = (m["ll"], w, k, dsp)
    _, bw, bk, bd = best
    sc = walk(rows, bw, bk, bd, lr, lt)
    held = score(sc, lo=CUTOFF)
    sel = score(sc, hi=CUTOFF)
    if not held:
        print(f"\n{market}: no held-out rows")
        return

    # Temperature for the STATS bar, fitted on SELECT only.
    bestT, bv = 1.0, None
    for i in range(70):
        T = 0.5 + 0.03 * i
        v = sum(ll(temper(o, T) if r.actual_sog > r.line else 1 - temper(o, T))
                for r, o, _ in sel["rows"]) / len(sel["rows"])
        if bv is None or v < bv:
            bv, bestT = v, T

    print(f"\n{market}  (window ends {rows[-1].played})")
    print(f"  fitted: toi_window={bw or 'all'} shrink_k={bk} dispersion="
          f"{'Poisson' if bd > 1e5 else bd}   T={bestT:.2f}")
    print(f"  held out n={held['n']:,}  log-loss {held['ll']:.5f}  "
          f"acc {held['acc']*100:.1f}%  projection bias {held['bias']*100:+.1f}%")

    # ---- STATS BAR: ordering + calibration, no market involved -------------
    # QUINTILES OF PROJECTION, not integer buckets of it. The integer version
    # this replaces put every row of a low-mean market into a single bucket —
    # assists (mean 0.44) and goals (mean 0.17) both produced ONE bucket, and
    # `all()` over a one-element list is vacuously True. Both markets were
    # therefore recorded as "ordering monotone" by a check that had nothing to
    # compare, which is the same failure mode as a gate that passes because
    # nothing tried to render.
    #
    # Equal-COUNT bins test the ordering claim the board actually makes — that
    # players ranked higher produce more — at every mean, and they cannot
    # degenerate to one bin.
    ranked_rows = sorted(held["rows"], key=lambda t: t[2])
    nbin = 5
    order = []
    if len(ranked_rows) >= nbin * 30:
        step = len(ranked_rows) // nbin
        for i in range(nbin):
            chunk = ranked_rows[i * step:(i + 1) * step if i < nbin - 1 else len(ranked_rows)]
            order.append((i + 1, len(chunk),
                          sum(r.actual_sog for r, _, _ in chunk) / len(chunk)))
    # A market with too few held-out rows to form five honest bins is UNTESTED,
    # not passing. `order` stays empty and monotone is False.
    monotone = bool(order) and all(
        order[i][2] <= order[i + 1][2] + 1e-9 for i in range(len(order) - 1))
    cal = [ll(temper(o, bestT) if r.actual_sog > r.line else 1 - temper(o, bestT))
           for r, o, _ in held["rows"]]
    worst = 0.0
    cb: dict[int, list] = {}
    for (r, o, _), c in zip(held["rows"], cal):
        cb.setdefault(min(9, int(temper(o, bestT) * 10)), []).append(r)
    for b, v in cb.items():
        if len(v) < 40:
            continue
        pred = (b + 0.5) / 10
        act = sum(1 for r in v if r.actual_sog > r.line) / len(v)
        worst = max(worst, abs(pred - act))
    print("  STATS BAR — ordering by projection quintile: " +
          (", ".join(f"Q{b}->{m:.2f} (n={n})" for b, n, m in order)
           if order else "TOO FEW ROWS FOR 5 BINS — untested, not passing"))
    print(f"    monotone: {monotone}   worst calibration gap after T: {worst:.3f}"
          f"   {'PASS' if monotone and worst <= 0.05 else 'FAIL'}")

    # ---- BETTING BAR: informational ---------------------------------------
    # None when this market has no two-sided prices at all — persisted as a
    # null baseline rather than a fabricated one.
    market_ll = None
    two = [(r, o) for r, o, _ in held["rows"]
           if r.over_price is not None and r.under_price is not None]
    if two:
        def mk(r):
            a, b = am_prob(r.over_price), am_prob(r.under_price)
            return a / (a + b)
        m_ll = [ll(o if r.actual_sog > r.line else 1 - o) for r, o in two]
        k_ll = [ll(mk(r) if r.actual_sog > r.line else 1 - mk(r)) for r, o in two]
        mean, se, t = paired(m_ll, k_ll)
        market_ll = sum(k_ll) / len(two)
        print(f"  BETTING BAR — model {sum(m_ll)/len(two):.5f} vs market "
              f"{market_ll:.5f}   t={t:+.2f}  "
              f"{'MODEL' if t < -1.96 else 'MARKET' if t > 1.96 else 'TIE'}")

    if not persist:
        return

    # ---- PERSIST: the served model must BE the measured model ---------------
    # Hand-copying six markets' worth of fitted parameters into a serving
    # module is how a served model silently stops being the one that was
    # measured. The fit writes them itself, versioned, via the same
    # write_calibration MLB already uses.
    #
    # `active` means "this market may be RANKED" — i.e. its ordering is
    # monotone. It deliberately does NOT mean "may show a probability": that
    # is a stricter, separate claim (4.10), carried in params as
    # `probability_ok`, because a ranking and a displayed probability rest on
    # different evidence.
    import db  # noqa: E402  (only needed on the persist path)
    await db.write_calibration(
        db.CalibrationInput(
            sport="nhl",
            market=DIMENSION[market],
            # Temperature scaling is single-parameter Platt: a = 1/T, b = 0 in
            # logit space. Named for what it is rather than folded into
            # 'platt', so a reader knows one parameter was fitted, not two.
            method="temperature",
            params={
                "toi_window": bw,
                "shrink_k": bk,
                "dispersion": bd,
                "temperature": bestT,
                "league_rate": lr,
                "league_toi": lt,
                "min_prior_games": MIN_PRIOR,
                "select_cutoff": CUTOFF.isoformat(),
                "ordering": [{"quintile": b, "n": n, "actual": m} for b, n, m in order],
                "ordering_monotone": monotone,
                "worst_calibration_gap": worst,
                "ranking_ok": monotone,
                "probability_ok": bool(monotone and worst <= 0.05),
                "holdout_accuracy": held["acc"],
                "projection_bias": held["bias"],
            },
            train_games=sel["n"],
            train_log_loss=sel["ll"],
            holdout_games=held["n"],
            holdout_log_loss=held["ll"],
            baseline_holdout_log_loss=market_ll,
        ),
        activate=monotone,
    )
    print(f"  persisted to model_calibration: nhl/{DIMENSION[market]}  "
          f"active={monotone} (ranking), probability_ok="
          f"{bool(monotone and worst <= 0.05)}")


async def main() -> int:
    persist = "--persist" in sys.argv
    print("Phase 4.8 — every two-sided NHL market, reported separately"
          + ("   [--persist: writing fitted constants to model_calibration]"
             if persist else ""))
    print("Total Power Play Points EXCLUDED: the database has powerPlayGoals but the")
    print("market settles power-play POINTS, so the computed outcome is not the one")
    print("the bet settles on. Both sides of the comparison would be wrong.")
    for m in MARKETS:
        await run_market(m, persist=persist)
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
