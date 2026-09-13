"""Phase 7 step 3 — NBA rate stats per minute, turned into a distribution.

    python fit_nba_prop_rates.py
    python fit_nba_prop_rates.py --out nba_prop_probs.csv

WHAT THIS DOES. Step 2 produced a projection of MINUTES. This turns a player's
history into a RATE per minute, multiplies the two into an expected count, and
puts a shape around it so the expected count becomes P(over the posted line).
Step 4 then asks whether that probability beats the market's.

IT BINDS TO THE SHARED ENGINE RATHER THAN ADDING A TENTH DISTRIBUTION.
`predict/count_prop_engine.py` already owns this exact decomposition -- volume x
rate x shape -- for NHL and MLB, with `shrunk_rate` shrinking in units of GAMES
(not raw volume, which is the bug its identity test caught), and a `SHAPES` grid
whose two ends are genuine limits rather than truncations. NBA supplies
`volume = minutes` and `events = the counting stat`, and nothing else here is
new maths. CLAUDE.md is explicit that there is one prop engine; this is what
using it looks like.

THE ONE PLACE NBA DEPARTS FROM THE ENGINE, and why. `project()` computes volume
itself, as a rolling mean over a recent window. That is the very quantity step 2
spent a model improving, so this calls `shrunk_rate` directly and multiplies by
the step-2 projection instead. The departure is measured rather than assumed:
the run reports the identical pipeline driven by a rolling-5 minutes estimate
beside the model-driven one, so "the better minutes model helps the props" is a
number here, not a hope.

NO LEAKAGE, BY CONSTRUCTION AND IN THREE PLACES:

  * A player's rate history is snapshotted BEFORE the game it is used to
    predict, in one ordered pass over the panel -- the same append-after-emit
    shape as the minutes model's feature loop.
  * The league baseline rate is a RUNNING accumulator over games already
    played, not a season-wide or all-time mean. A whole-panel league rate would
    leak the future into every early-season row.
  * Hyperparameters (shrinkage `k`, and the shape) are chosen on an EARLIER
    slice of the prop window and reported on a LATER one. The split is by date,
    never by row, because props within one night are correlated.

WHAT THIS STEP DOES NOT CLAIM. Beating the market's Brier score is not the test
and is not expected -- the market prices these with information this model does
not have (injuries, rest plans, matchups). Step 3 succeeds if it produces a
CALIBRATED probability. Whether that probability carries an EDGE is step 4, and
a model can be worse on average yet right in a particular band. Reporting the
market's Brier alongside is a scale, not a verdict.

THE SHAPE GRID INCLUDES `binomial` AND IT IS STRUCTURALLY WRONG FOR POINTS.
`binom_prob_over` treats volume as a count of chances and caps the outcome at
it, which is right for MLB hits (a batter cannot out-hit his plate appearances)
and wrong for NBA points (a player can and does out-score his minutes). It is
left in the grid rather than special-cased out, because the selection is made on
held-out log-loss and a shape that cannot fit will not be chosen -- and which
shape each market actually picks is a reported result worth reading.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

from predict.count_prop_engine import (                          # noqa: E402
    SHAPES, calibration, fit_platt, platt, shape_label, shape_prob_over,
    shrunk_rate,
)
from predict.odds_math import american_to_decimal, devig_two_way  # noqa: E402

PANEL = os.path.join(HERE, "nba_panel.parquet")
PROPS = os.path.join(HERE, "nba_props_train.csv")
MINUTES = os.path.join(HERE, "nba_minutes_pred.parquet")

# market -> the panel columns whose sum is the graded event. Mirrors
# `build_nba_prop_training_set.MARKETS`; kept as a list of columns rather than
# a string expression because here it is summed in Python, not in SQL.
MARKET_PARTS: dict[str, tuple[str, ...]] = {
    "Total Points":                        ("points",),
    "Total Rebounds":                      ("rebounds",),
    "Total Assists":                       ("assists",),
    "Total 3-Point Field Goals":           ("threePointFieldGoalsMade",),
    "Total Steals":                        ("steals",),
    "Total Blocks":                        ("blocks",),
    "Total Points and Rebounds":           ("points", "rebounds"),
    "Total Points and Assists":            ("points", "assists"),
    "Total Points, Rebounds, and Assists": ("points", "rebounds", "assists"),
}

# Shrinkage, in GAMES-worth of minutes. 0 is no shrinkage at all -- a genuine
# floor, not a truncated grid edge, exactly as the engine's docstring requires.
K_GRID = (0.0, 2.0, 5.0, 10.0, 20.0, 40.0, 80.0)


# ---------------------------------------------------------------------------
# ONE ORDERED PASS: snapshot each prop's inputs from history-so-far
# ---------------------------------------------------------------------------

def snapshot(panel, props_by_key, minutes_by_key):
    """For every prop, the state of the world strictly before its game.

    Returns one dict per (prop) carrying the player's accumulated events and
    minutes, the running league rate, and both minutes estimates. Everything
    the grid search needs, and nothing that depends on `k` or the shape -- so
    the 63 (k, shape) combinations are then a fast arithmetic sweep over this
    snapshot rather than 63 more passes over the panel.
    """
    ath = panel["athlete_id"].to_pylist()
    ev = panel["event_id"].to_pylist()
    date = panel["game_date"].to_pylist()
    mins = panel["minutes"].to_pylist()
    cols = {c: panel[c].to_pylist() for c in
            {p for parts in MARKET_PARTS.values() for p in parts}}

    order = sorted(range(len(ath)), key=lambda i: (date[i], str(ev[i]), str(ath[i])))

    # per-market running state
    p_ev: dict = {}          # (market, athlete) -> [events, minutes, games]
    lg: dict = {m: [0.0, 0.0] for m in MARKET_PARTS}   # market -> [events, minutes]
    lg_min = [0.0, 0]        # running league [total minutes, player-games]
    recent: dict = {}        # athlete -> last 5 minutes

    out = []
    for i in order:
        a, e, m_played = ath[i], ev[i], float(mins[i])
        key = (a, e)
        want = props_by_key.get(key)
        if want:
            pm = minutes_by_key.get(key)
            r5 = recent.get(a, [])
            lgm = lg_min[0] / lg_min[1] if lg_min[1] else 22.67
            for pr in want:
                mk = pr["market"]
                st = p_ev.get((mk, a), [0.0, 0.0, 0])
                le, lv = lg[mk]
                out.append({
                    **pr,
                    "p_events": st[0], "p_volume": st[1], "p_games": st[2],
                    "league_rate": (le / lv) if lv > 0 else 0.0,
                    "league_minutes": lgm,
                    "pred_minutes": pm if pm is not None else (
                        sum(r5) / len(r5) if r5 else lgm),
                    "roll5_minutes": (sum(r5) / len(r5)) if r5 else lgm,
                    "has_model_minutes": pm is not None,
                })

        # --- state update AFTER the row is emitted ---
        for mk, parts in MARKET_PARTS.items():
            val = sum(float(cols[p][i]) for p in parts)
            st = p_ev.get((mk, a))
            if st is None:
                st = p_ev[(mk, a)] = [0.0, 0.0, 0]
            st[0] += val
            st[1] += m_played
            st[2] += 1
            lg[mk][0] += val
            lg[mk][1] += m_played
        lg_min[0] += m_played
        lg_min[1] += 1
        r = recent.setdefault(a, [])
        r.append(m_played)
        if len(r) > 5:
            del r[0]
    return out


# ---------------------------------------------------------------------------
# GRID
# ---------------------------------------------------------------------------

def probs_for(rows, k: float, kind: str, param, minutes_field: str):
    ps = []
    for r in rows:
        vol = max(0.0, float(r[minutes_field]))
        rate = shrunk_rate(r["p_events"], r["p_volume"], r["league_rate"],
                           k, max(1e-9, r["league_minutes"]))
        expected = vol * rate
        ps.append(shape_prob_over(kind, param, r["line"], expected, vol))
    return ps


def _logloss(ps, ys):
    t = 0.0
    for p, y in zip(ps, ys):
        q = min(1 - 1e-9, max(1e-9, p))
        t -= math.log(q if y else 1 - q)
    return t / max(1, len(ps))


def _brier(ps, ys):
    return sum((p - y) ** 2 for p, y in zip(ps, ys)) / max(1, len(ps))


def main(out_path: str | None) -> int:
    import pyarrow.parquet as pq

    for f in (PANEL, PROPS, MINUTES):
        if not os.path.exists(f):
            print(f"\n  missing {os.path.basename(f)} — run the builders first.\n")
            return 1

    panel = pq.read_table(PANEL)
    mt = pq.read_table(MINUTES)
    minutes_by_key = dict(zip(
        zip(mt["athlete_id"].to_pylist(), mt["event_id"].to_pylist()),
        mt["pred_minutes"].to_pylist()))

    props_by_key: dict = {}
    n_props = 0
    for r in csv.DictReader(open(PROPS, encoding="utf-8")):
        if r["market"] not in MARKET_PARTS:
            continue
        o, u = int(r["over_price"]), int(r["under_price"])
        pair = devig_two_way(american_to_decimal(o), american_to_decimal(u))
        if not pair:
            continue
        line, actual = float(r["line"]), float(r["actual"])
        if actual == line:
            continue                                   # push; none exist today
        props_by_key.setdefault((r["athlete_id"], r["event_ref"]), []).append({
            "athlete_id": r["athlete_id"], "event_ref": r["event_ref"],
            "game_date": dt.date.fromisoformat(r["game_date"]),
            "market": r["market"], "line": line, "actual": actual,
            "y": 1 if actual > line else 0,
            "market_p_over": pair[0], "over_price": o, "under_price": u,
        })
        n_props += 1

    print("\n" + "=" * 78)
    print("NBA PROP RATE MODEL")
    print("=" * 78)
    print(f"  panel {panel.num_rows:,} player-games   props {n_props:,}   "
          f"minutes predictions {mt.num_rows:,}")

    rows = snapshot(panel, props_by_key, minutes_by_key)
    print(f"  snapshotted {len(rows):,} props with history-so-far")
    miss = sum(1 for r in rows if not r["has_model_minutes"])
    print(f"  props without a model minutes prediction: {miss:,}"
          f"  (fell back to rolling-5)")

    dates = sorted({r["game_date"] for r in rows})
    # Split by DATE at the point closest to 60% of props, never by row: two
    # props from the same night share a game, a rotation and a blowout.
    cum, cut = 0, dates[-1]
    for d in dates:
        cum += sum(1 for r in rows if r["game_date"] == d)
        if cum >= 0.6 * len(rows):
            cut = d
            break
    sel = [r for r in rows if r["game_date"] <= cut]
    evl = [r for r in rows if r["game_date"] > cut]
    print(f"  SELECT {len(sel):,} props to {cut}   EVAL {len(evl):,} props after")
    if not evl:
        print("\n  no evaluation rows — the window is too short to split.\n")
        return 1

    print("\n  --- per market: shape and shrinkage chosen on SELECT, "
          "reported on EVAL " + "-" * 5)
    hdr = (f"    {'market':<36}{'shape':>10}{'k':>5}{'n':>7}"
           f"{'logloss':>9}{'mkt':>8}{'Brier':>8}{'mkt':>8}")
    print(hdr)
    all_eval, all_cal = [], []
    per_market = {}
    for mk in MARKET_PARTS:
        s = [r for r in sel if r["market"] == mk]
        e = [r for r in evl if r["market"] == mk]
        if len(s) < 200 or len(e) < 100:
            print(f"    {mk[:35]:<36}{'(too few rows)':>45}")
            continue
        ys, ye = [r["y"] for r in s], [r["y"] for r in e]
        best = None
        for k in K_GRID:
            for kind, param in SHAPES:
                ps = probs_for(s, k, kind, param, "pred_minutes")
                ll = _logloss(ps, ys)
                if best is None or ll < best[0]:
                    best = (ll, k, kind, param, ps)
        _, k, kind, param, ps_sel = best
        # Platt fitted on SELECT only, applied to EVAL.
        a, b = fit_platt(list(zip(ps_sel, ys)))
        pe = [platt(p, a, b) for p in probs_for(e, k, kind, param, "pred_minutes")]
        mkt = [r["market_p_over"] for r in e]
        per_market[mk] = {"k": k, "kind": kind, "param": param, "a": a, "b": b,
                          "n": len(e), "ll": _logloss(pe, ye),
                          "ll_mkt": _logloss(mkt, ye),
                          "br": _brier(pe, ye), "br_mkt": _brier(mkt, ye)}
        m = per_market[mk]
        print(f"    {mk[:35]:<36}{shape_label(kind, param):>10}{k:>5.0f}{len(e):>7,}"
              f"{m['ll']:>9.4f}{m['ll_mkt']:>8.4f}{m['br']:>8.4f}{m['br_mkt']:>8.4f}")
        for r, p in zip(e, pe):
            all_eval.append((r, p))
            all_cal.append((p, r["y"]))

    if not all_eval:
        print("\n  nothing evaluated.\n")
        return 1

    ye = [r["y"] for r, _ in all_eval]
    pe = [p for _, p in all_eval]
    mkt = [r["market_p_over"] for r, _ in all_eval]
    print(f"\n  --- POOLED EVAL (n={len(ye):,}) " + "-" * 46)
    print(f"    model   log loss {_logloss(pe, ye):.4f}   Brier {_brier(pe, ye):.4f}"
          f"   mean p {sum(pe) / len(pe):.4f}")
    print(f"    market  log loss {_logloss(mkt, ye):.4f}   Brier {_brier(mkt, ye):.4f}"
          f"   mean p {sum(mkt) / len(mkt):.4f}")
    print(f"    realised over-rate {sum(ye) / len(ye):.4f}")

    print("\n  --- CALIBRATION of the model's probability on EVAL " + "-" * 26)
    cal = calibration(all_cal, n_floor=100)
    print(f"    ECE {cal['ece']:.4f}   worst bucket gap {cal['worst']:.4f} "
          f"(n={cal['worst_n']:,}, buckets under 100 rows excluded from 'worst')")
    print(f"    {'bucket':>8}{'n':>8}{'predicted':>12}{'actual':>10}{'gap':>9}")
    for b in cal["table"]:
        print(f"    {b['bucket']:>8.1f}{b['n']:>8,}{b['pred']:>12.4f}"
              f"{b['actual']:>10.4f}{b['gap']:>9.4f}")
    # The same table for the MARKET, so "is the model calibrated?" is read
    # against how calibrated the thing it must beat is, not against zero.
    cal_m = calibration([(r["market_p_over"], r["y"]) for r, _ in all_eval],
                        n_floor=100)
    print(f"    market for comparison: ECE {cal_m['ece']:.4f}   "
          f"worst {cal_m['worst']:.4f}")

    # --- what step 2 actually bought, at the prop level --------------------
    print("\n  --- DID THE MINUTES MODEL HELP? same pipeline, rolling-5 minutes "
          + "-" * 11)
    for field, label in (("pred_minutes", "step-2 model minutes"),
                         ("roll5_minutes", "rolling-5 minutes")):
        tot_ll, tot_n = 0.0, 0
        for mk, m in per_market.items():
            e = [r for r in evl if r["market"] == mk]
            s = [r for r in sel if r["market"] == mk]
            ps_s = probs_for(s, m["k"], m["kind"], m["param"], field)
            a, b = fit_platt(list(zip(ps_s, [r["y"] for r in s])))
            p = [platt(x, a, b) for x in
                 probs_for(e, m["k"], m["kind"], m["param"], field)]
            tot_ll += _logloss(p, [r["y"] for r in e]) * len(e)
            tot_n += len(e)
        print(f"    {label:<26} pooled log loss {tot_ll / tot_n:.4f}  (n={tot_n:,})")

    if out_path:
        with open(out_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["game_date", "athlete_id", "event_ref", "market", "line",
                        "actual", "y", "model_p_over", "market_p_over",
                        "over_price", "under_price", "pred_minutes"])
            for r, p in all_eval:
                w.writerow([r["game_date"], r["athlete_id"], r["event_ref"],
                            r["market"], r["line"], r["actual"], r["y"],
                            f"{p:.6f}", f"{r['market_p_over']:.6f}",
                            r["over_price"], r["under_price"],
                            f"{r['pred_minutes']:.3f}"])
        print(f"\n  wrote {len(all_eval):,} EVAL rows -> {out_path}")
    print()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    raise SystemExit(main(a.out))
