"""Phase 7 step 2 — the NBA minutes model, walked forward with no leakage.

    python fit_nba_minutes.py                          # fit, report, compare
    python fit_nba_minutes.py --out nba_minutes_pred.parquet

WHY MINUTES FIRST. Points, rebounds and assists are roughly rate x minutes, and
the rate is the stable half. A player's per-minute scoring moves slowly across a
season; his minutes move every night -- foul trouble, a blowout, a rest day, a
rotation change. So the prop model's error budget is dominated by this one
quantity, and it is worth measuring on its own before anything is built on top
of it.

THE BAR, measured before any model was written (2026 season, n=26,589):

    last game's minutes            MAE 5.888   corr 0.706
    mean of the previous five      MAE 5.178   corr 0.755

A model that does not clear 5.178 is not worth carrying, and "beats the league
mean" is not the comparison -- a rolling average is free and already good.

THE RESULT, 2026-09-13, 246,482 scored player-games over 2017-2026, 128 refits:

                                  all seasons          prop window (n=6,574)
    mean of previous 5            MAE 5.181            MAE 5.198   corr 0.766
    ridge                         MAE 4.941            MAE 4.905   corr 0.799
    gradient boosting             MAE 4.873            MAE 4.713   corr 0.817
    ...240-normalised (BOUND)     MAE 4.599            MAE 4.449   corr 0.839

**A 6.0% improvement on the bar over all seasons, 9.3% in the prop window.**
Real, and worth carrying, and NOT transformative -- the residual standard
deviation is still about 6 minutes against a mean of 22.7. Minutes are
genuinely volatile and this model does not change that; it removes a little
noise and, in the prop window specifically, a real early-season bias (the
rolling-5 baseline runs +0.378 minutes hot while players' roles are still
ramping up; the booster runs -0.064).

THE 240-NORMALISED ROW PRICES AN ACTIVE-ROSTER FEED at a further 5.6% off MAE.
That is the largest single improvement available here and it needs data this
repo does not have -- worth knowing before anyone spends a week on features.

RESIDUAL SPREAD IS NOT CONSTANT and step 3 must not treat it as such. By
predicted minutes: sd 6.56 below 10 minutes, **7.07 in the 10-18 band**, 6.65
at 18-24, 6.11 at 24-30, 5.54 at 30-34, 5.06 above 34. The worst band is not
the lowest one -- it is the fringe rotation player whose role is unsettled,
which is exactly the population a prop is most likely to be offered on.

WHAT THE MODEL PREDICTS, precisely: minutes GIVEN THE PLAYER PLAYED. Only
players who appeared are in `player_game_history` (see the panel builder), so
nothing here knows whether someone is active. For props that is the right
conditioning -- a prop on a scratched player is voided, not lost -- and it is
the wrong conditioning for almost anything else.

EVERY FEATURE IS STRICTLY BACKWARD-LOOKING, and the walk-forward refits on a
14-day cadence using only rows STRICTLY BEFORE the block it predicts. Season
2016 is burn-in: it supplies `prev_season_mean` for 2017 and is never scored.

TWO RESULTS ARE REPORTED SEPARATELY AND MUST NOT BE CONFLATED:

  * the LEAK-FREE model, which is the real number; and
  * the 240-NORMALISED variant, which rescales each team's predictions to the
    minutes that team actually played. That is an UPPER BOUND, not a model:
    240 team-minutes is a hard structural constraint (6,947 of ~7,400 recent
    team-games sum to exactly 48.0 per five-man slot, 306 to ~53 for one
    overtime, 40 to ~58 for two), but applying it needs the active roster and
    the final game length, and this repo has neither -- there is no
    `injury_snapshot` table, and whether a game goes to overtime is not known
    before it is played. It is measured because it prices what an active-roster
    feed would be worth, which is a real decision this project has to make.
"""
from __future__ import annotations

import argparse
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

PANEL = os.path.join(HERE, "nba_panel.parquet")

# Halflives in GAMES, not days. A player's role changes over a run of games;
# a fortnight off changes nothing about it except that the evidence is older.
EWMA_HALFLIVES = (2.0, 5.0, 15.0)

# Rest is capped because beyond a week the number stops meaning "rest" and
# starts meaning "was injured, or the season just started" -- the measured
# average drops from 23.4 minutes at 1-2 days to 16.2 at 5+, which is a
# returning player on a restriction, not a well-rested one.
REST_CAP = 7

FEATURES = (
    ["ewma_%g" % h for h in EWMA_HALFLIVES]
    + ["lag1", "roll3", "roll5", "roll10", "sd5", "season_mean",
       "prev_season_mean", "n_prior", "n_season", "rest", "rest_is_long",
       "is_home", "days_into_season", "league_mean_fallback"]
)


# ---------------------------------------------------------------------------
# FEATURES
# ---------------------------------------------------------------------------

def build_features(tbl) -> dict:
    """One pass per athlete, in (game_date, event_id) order.

    Written as an explicit loop rather than a stack of SQL window clauses
    because every value here has to be provably computed from earlier rows
    only, and a loop that appends to history AFTER emitting the row makes that
    checkable by reading it. The panel is 269k rows; this costs a few seconds.
    """
    ath = tbl["athlete_id"].to_pylist()
    date = tbl["game_date"].to_pylist()
    event = tbl["event_id"].to_pylist()
    season = tbl["season"].to_pylist()
    mins = tbl["minutes"].to_pylist()
    home = tbl["is_home"].to_pylist()
    team = tbl["team_id"].to_pylist()

    order = sorted(range(len(ath)), key=lambda i: (date[i], str(event[i]), str(ath[i])))
    league_mean = float(np.mean(mins))

    # per-athlete running state
    hist: dict = {}
    prev_season: dict = {}          # (athlete, season) -> mean minutes that season
    season_acc: dict = {}           # (athlete, season) -> [sum, n]
    season_start: dict = {}         # season -> first date seen

    rows = []
    for i in order:
        a, s = ath[i], season[i]
        if s not in season_start:
            season_start[s] = date[i]
        h = hist.get(a)
        if h is None:
            h = hist[a] = {"mins": [], "last_date": None,
                           "ewma": {k: None for k in EWMA_HALFLIVES}}

        past = h["mins"]
        n_prior = len(past)
        acc = season_acc.get((a, s), [0.0, 0])

        def _mean(seq, fallback):
            return float(np.mean(seq)) if seq else fallback

        feat = {}
        for k in EWMA_HALFLIVES:
            v = h["ewma"][k]
            feat["ewma_%g" % k] = league_mean if v is None else v
        feat["lag1"] = past[-1] if past else league_mean
        feat["roll3"] = _mean(past[-3:], league_mean)
        feat["roll5"] = _mean(past[-5:], league_mean)
        feat["roll10"] = _mean(past[-10:], league_mean)
        feat["sd5"] = float(np.std(past[-5:])) if len(past) >= 2 else 0.0
        feat["season_mean"] = acc[0] / acc[1] if acc[1] else league_mean
        feat["prev_season_mean"] = prev_season.get((a, s - 1), league_mean)
        feat["n_prior"] = float(min(n_prior, 200))
        feat["n_season"] = float(acc[1])
        rest = None if h["last_date"] is None else (date[i] - h["last_date"]).days
        feat["rest"] = float(min(rest, REST_CAP)) if rest is not None else float(REST_CAP)
        feat["rest_is_long"] = 1.0 if (rest is not None and rest >= 5) else 0.0
        feat["is_home"] = 1.0 if home[i] else 0.0
        feat["days_into_season"] = float((date[i] - season_start[s]).days)
        # An explicit flag for "this player has no history at all", so the
        # model can treat an imputed league mean as the guess it is rather
        # than as a real observation of an average-minutes player.
        feat["league_mean_fallback"] = 1.0 if n_prior == 0 else 0.0

        rows.append({"i": i, "athlete_id": a, "season": s, "game_date": date[i],
                     "event_id": event[i], "team_id": team[i],
                     "y": float(mins[i]), **feat})

        # --- state update happens AFTER the row is emitted ---
        m = float(mins[i])
        past.append(m)
        if len(past) > 40:
            del past[0]
        for k in EWMA_HALFLIVES:
            alpha = 1.0 - 0.5 ** (1.0 / k)
            v = h["ewma"][k]
            h["ewma"][k] = m if v is None else (alpha * m + (1 - alpha) * v)
        h["last_date"] = date[i]
        acc[0] += m
        acc[1] += 1
        season_acc[(a, s)] = acc
        prev_season[(a, s)] = acc[0] / acc[1]

    return {"rows": rows, "league_mean": league_mean}


# ---------------------------------------------------------------------------
# WALK-FORWARD
# ---------------------------------------------------------------------------

def walk_forward(rows, model: str, block_days: int = 14, min_train: int = 5000):
    """Refit every `block_days` on rows strictly before the block. Returns a
    prediction for every scored row."""
    from sklearn.linear_model import Ridge
    from sklearn.ensemble import HistGradientBoostingRegressor

    rows = sorted(rows, key=lambda r: (r["game_date"], str(r["event_id"])))
    X = np.array([[r[f] for f in FEATURES] for r in rows], dtype=np.float64)
    y = np.array([r["y"] for r in rows], dtype=np.float64)
    dates = [r["game_date"] for r in rows]
    season = np.array([r["season"] for r in rows])

    preds = np.full(len(rows), np.nan)
    # Blocks start at the first scored season; 2016 is burn-in.
    scored = np.where(season >= 2017)[0]
    start = dates[scored[0]]
    end = dates[-1]

    blocks, cur = [], start
    while cur <= end:
        nxt = cur + __import__("datetime").timedelta(days=block_days)
        blocks.append((cur, nxt))
        cur = nxt

    # `dates` is sorted, so the training set for a block is always the prefix
    # ending at the block's first row — bisect, not a full scan per block.
    import bisect
    n_fit = 0
    for b0, b1 in blocks:
        lo, hi = bisect.bisect_left(dates, b0), bisect.bisect_left(dates, b1)
        te = [i for i in range(lo, hi) if season[i] >= 2017]
        if not te:
            continue
        tr = range(lo)
        if lo < min_train:
            continue
        if model == "ridge":
            mdl = Ridge(alpha=10.0)
        else:
            mdl = HistGradientBoostingRegressor(
                max_iter=200, learning_rate=0.08, max_depth=6,
                early_stopping=False, random_state=0)
        # Standardising matters for ridge and is harmless for the booster.
        Xtr, ytr = X[:lo], y[:lo]
        mu, sd = Xtr.mean(0), Xtr.std(0)
        sd[sd == 0] = 1.0
        mdl.fit((Xtr - mu) / sd, ytr)
        preds[te] = mdl.predict((X[te] - mu) / sd)
        n_fit += 1

    return preds, y, rows, n_fit


def _metrics(y, p, mask):
    m = mask & ~np.isnan(p)
    if m.sum() == 0:
        return None
    e = p[m] - y[m]
    return {"n": int(m.sum()), "mae": float(np.mean(np.abs(e))),
            "rmse": float(math.sqrt(np.mean(e * e))),
            "bias": float(np.mean(e)),
            "corr": float(np.corrcoef(p[m], y[m])[0, 1]),
            "sd_resid": float(np.std(e))}


def _line(label, m):
    if m is None:
        print(f"    {label:<34} (no rows)")
        return
    print(f"    {label:<34} n={m['n']:>7,}  MAE {m['mae']:6.3f}  RMSE {m['rmse']:6.3f}"
          f"  bias {m['bias']:+6.3f}  corr {m['corr']:.4f}")


def normalise_to_team(rows, preds, y):
    """The 240-minute constraint, applied with hindsight. UPPER BOUND ONLY."""
    out = preds.copy()
    groups: dict = {}
    for k, r in enumerate(rows):
        if np.isnan(preds[k]):
            continue
        groups.setdefault((r["event_id"], r["team_id"]), []).append(k)
    for _, idx in groups.items():
        tot_p = sum(preds[k] for k in idx)
        tot_y = sum(y[k] for k in idx)
        if tot_p > 0:
            for k in idx:
                out[k] = preds[k] * tot_y / tot_p
    return out


def main(out: str | None, block_days: int) -> int:
    import pyarrow.parquet as pq

    if not os.path.exists(PANEL):
        print(f"\n  {PANEL} not found — run build_nba_player_panel.py --out "
              f"nba_panel.parquet first.\n")
        return 1
    tbl = pq.read_table(PANEL)
    print("\n" + "=" * 78)
    print("NBA MINUTES MODEL")
    print("=" * 78)
    print(f"  panel {tbl.num_rows:,} player-games")

    built = build_features(tbl)
    rows = built["rows"]
    print(f"  features built for {len(rows):,} rows  "
          f"(league mean {built['league_mean']:.2f} min)")

    rows = sorted(rows, key=lambda r: (r["game_date"], str(r["event_id"])))
    y = np.array([r["y"] for r in rows])
    season = np.array([r["season"] for r in rows])
    dates = [r["game_date"] for r in rows]
    import datetime as _dt
    PROP0, PROP1 = _dt.date(2025, 10, 21), _dt.date(2025, 12, 1)
    in_prop = np.array([PROP0 <= d <= PROP1 for d in dates])
    scored = season >= 2017

    # --- baselines, on exactly the rows the model is scored on -------------
    base = {
        "league mean": np.array([built["league_mean"]] * len(rows)),
        "last game (lag 1)": np.array([r["lag1"] for r in rows]),
        "mean of previous 3": np.array([r["roll3"] for r in rows]),
        "mean of previous 5": np.array([r["roll5"] for r in rows]),
        "mean of previous 10": np.array([r["roll10"] for r in rows]),
        "season to date": np.array([r["season_mean"] for r in rows]),
    }

    results = {}
    print("\n  --- BASELINES, all scored seasons (2017-2026) " + "-" * 31)
    for k, p in base.items():
        results[k] = _metrics(y, p, scored)
        _line(k, results[k])

    print(f"\n  --- MODELS, walked forward in {block_days}-day blocks " + "-" * 26)
    model_preds = {}
    for model in ("ridge", "gbm"):
        p, _, _, n_fit = walk_forward(rows, model, block_days=block_days)
        model_preds[model] = p
        results[model] = _metrics(y, p, scored)
        _line(f"{model} ({n_fit} refits)", results[model])

    best = min(("ridge", "gbm"), key=lambda m: results[m]["mae"])
    print("\n  --- THE PROP WINDOW ONLY (2025-10-21 .. 2025-12-01) " + "-" * 25)
    for k, p in base.items():
        _line(k, _metrics(y, p, in_prop))
    for model in ("ridge", "gbm"):
        _line(model, _metrics(y, model_preds[model], in_prop))

    print("\n  --- 240-MINUTE NORMALISATION (UPPER BOUND, needs a roster feed) " + "-" * 13)
    norm = normalise_to_team(rows, model_preds[best], y)
    _line(f"{best}, all seasons", _metrics(y, norm, scored))
    _line(f"{best}, prop window", _metrics(y, norm, in_prop))

    # --- what the distribution needs: residual spread by predicted level ---
    print("\n  --- RESIDUAL SPREAD by predicted minutes (step 3 needs this) " + "-" * 16)
    p = model_preds[best]
    m = scored & ~np.isnan(p)
    print(f"    {'predicted minutes':<20}{'n':>8}{'mean resid':>12}{'sd resid':>10}")
    for lo, hi in [(0, 10), (10, 18), (18, 24), (24, 30), (30, 34), (34, 99)]:
        sel = m & (p >= lo) & (p < hi)
        if sel.sum() == 0:
            continue
        e = p[sel] - y[sel]
        print(f"    {lo:>2}-{hi:<17}{int(sel.sum()):>8,}{np.mean(e):>12.3f}{np.std(e):>10.3f}")

    bl = results["mean of previous 5"]["mae"]
    got = results[best]["mae"]
    print(f"\n  VERDICT: best model is {best} at MAE {got:.3f} against the "
          f"rolling-5 bar of {bl:.3f}")
    print(f"           — {'an improvement of %.3f min (%.1f%%)' % (bl - got, 100 * (bl - got) / bl)}"
          if got < bl else "           — NO IMPROVEMENT. The rolling average is the model.")

    if out:
        import pyarrow as pa
        import pyarrow.parquet as pqw
        keep = ~np.isnan(model_preds[best])
        pqw.write_table(pa.table({
            "athlete_id": [rows[i]["athlete_id"] for i in range(len(rows)) if keep[i]],
            "event_id": [rows[i]["event_id"] for i in range(len(rows)) if keep[i]],
            "game_date": [rows[i]["game_date"] for i in range(len(rows)) if keep[i]],
            "team_id": [rows[i]["team_id"] for i in range(len(rows)) if keep[i]],
            "minutes": y[keep],
            "pred_minutes": model_preds[best][keep],
        }), out)
        print(f"\n  wrote {int(keep.sum()):,} predictions -> {out}")
    print()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    ap.add_argument("--block-days", type=int, default=14)
    a = ap.parse_args()
    raise SystemExit(main(a.out, a.block_days))
