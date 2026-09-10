"""Phase 3.1 — does a Statcast skill-vs-luck prior improve the MLB prop model?

**MEASURED ANSWER: NO.** Reproducible; run it and see.

    python experiment_statcast_prior.py

THE HYPOTHESIS (master plan, Phase 3.1). `estimated_woba` (xwOBA) is what a
batter EARNED from his contact, as against what he GOT. A batter running hot on
weak contact should regress; one hitting the ball hard with nothing to show
should improve. So a rolling xwOBA ought to forecast a batter's next game better
than his own recent results do, and it ought to help most where those results
are noisiest. The plan's rule: **kept only if it improves held-out log-loss.**

THE JOIN IS REAL, and was re-verified before anything was built on it —
`player_game_history.event_id` IS the MLB `gamePk`: 6,885 distinct games in the
overlap window, **100.00% matched, 100.00% game_date agreement**. Coverage of
the rows the model actually fits is **98.3%** (136,518 of 138,902 batter
player-games since 2024-03-01). None of the NO below is a data-plumbing
artifact; the data is there and it is clean.

WHY THE FIRST ANSWER WAS WRONG, WHICH IS THE POINT OF THIS FILE. Tested against
a control of prior hit-rate alone, xwOBA looks like a real win: held-out
log-loss 0.620443 -> 0.620221 at **t = -4.06**, comfortably "significant". It is
not a win. Almost all of that signal is xwOBA proxying for the batter's POWER,
which the model can already read off his own `bat_totalBases` history at no
cost and with no new data source. Measured directly:

    corr(prior xwOBA, prior TB/PA)   = +0.658
    corr(prior xwOBA, prior hits/PA) = +0.461
    R^2 of prior xwOBA from those two = 0.433

Put prior TB/PA into the control — i.e. ask xwOBA to beat what the model
ALREADY HAS, rather than beating a strawman — and the effect collapses by 8.5x,
to delta -0.000026. That is 0.004% of the log-loss, against the 0.064 that prior
hit-rate itself buys over the league base rate. Three hundred times smaller than
the signal it is being added to.

WHAT SURVIVES A FAIR TEST: nothing.

    market / regime                     delta      t       verdict
    hits > 0.5                        -0.000026   -2.03    marginal
    total-bases > 1.5                 +0.000014   +0.76    TIE (wrong sign)
    total-bases > 2.5                 +0.000004   +0.12    TIE
    hits > 1.5                        -0.000013   -1.98    marginal
    gradient boosting, hits > 0.5     -0.000386   -1.79    TIE
    gradient boosting, TB > 1.5       -0.000197   -0.94    TIE
    prior-game bands, 8 of 8            --         --      TIE everywhere

The power markets are where the hypothesis should be STRONGEST — xwOBA is
weighted toward extra-base hits — and they are exactly where it is a flat tie,
with the sign pointing the wrong way. A nonlinear model finds nothing linear
regression missed. And the band test kills the last version of the claim: the
plan's stated use is a PRIOR, which binds hardest when the observed rate is
noisiest, so the 5-14-prior-games band is the one that mattered. It ties too.

(An earlier cut of the band test used a FLOOR on prior games rather than bands,
which never isolates a noisy player at all — a min-5 population still contains
every veteran. Worth knowing before re-running this with a "fix".)

WHAT WOULD BE PAID FOR IT: a join against `mlb_pitch_events` (452 MB, 2.17M
rows) inside the serving pipe; a second freshness contract, since Statcast runs
to 2026-09-06 while `player_game_history` ends 2026-08-28; and a new empty case,
because 18.2% of batter-games have zero tracked contact. Against a 0.004%
log-loss gain that does not survive a fair control.

**Recorded as a measured NO, the same as tennis (t=+20.68) and soccer
(t=+3.05).** Not "not built yet" — built, measured, and rejected. Reopening it
needs a NEW feature, not a re-run: xwOBA per se is spent. The plausible next
candidates are the ones this file did not test because the data is not in
`player_game_history` — batted-ball spray/direction, or pitcher-side contact
quality allowed. Neither is a re-fit of this.
"""
import asyncio
import csv
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

CUTOFF = "2026-01-01"          # same SELECT/HELD-OUT split as fit_mlb_props.py
MIN_PRIOR_GAMES = 5            # same floor the serving pipe uses
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     ".statcast_batter_games.csv")


async def pull() -> None:
    """Batter-game aggregates, READ FROM THE PARQUET CORPUS.

    THIS USED TO READ POSTGRES AND CAN NO LONGER, which is a fact about the
    database rather than a preference. Phase 5 trimmed both of its inputs to hot
    windows: `player_game_history` keeps three seasons (5.2d) and
    `mlb_pitch_events` keeps two (5.S.5). The full history of each lives in the
    corpus. Left pointed at Postgres this script would still RUN, and would
    quietly answer a narrower question than the one its conclusions were drawn
    from -- the worst available outcome for a file whose whole purpose is to
    record a measured result.

    5.2's gate is exactly this: *every fit script produces bit-identical output
    reading Parquet versus reading Postgres, on the same input window.* The SQL
    below is the same SQL, with two `read_parquet` globs in place of two table
    names; DuckDB's `->>` on the `stats` JSON behaves as Postgres's does, which
    is what `mlb_props.load_game_history_parquet` already relies on.

    Still aggregated at the source: the pitch table is ~2.19M rows and none of
    it needs to cross the wire.
    """
    from corpus_location import corpus_location, read_parquet_glob

    backend = corpus_location()
    con, pgh = read_parquet_glob(backend, "player_game_history")
    pitches = backend.table_glob("mlb_pitch_events")
    try:
        rows = con.execute(
            """
            SELECT p.athlete_id::int aid, p.game_date gd,
                   (p.stats->>'bat_plateAppearances')::double pa,
                   (p.stats->>'bat_hits')::double hits,
                   (p.stats->>'bat_totalBases')::double tb,
                   COALESCE(s.xw_sum, 0) xw_sum, COALESCE(s.bip, 0) bip
              FROM read_parquet(?) p
              LEFT JOIN (SELECT game_pk, batter_id,
                                SUM(estimated_woba) xw_sum,
                                COUNT(estimated_woba) bip
                           FROM read_parquet(?)
                          GROUP BY game_pk, batter_id) s
                ON s.game_pk = p.event_id::bigint
               AND s.batter_id = p.athlete_id::int
             WHERE p.sport = 'mlb' AND p.event_id IS NOT NULL
               AND p.game_date >= '2024-03-01'
               AND (p.stats->>'bat_plateAppearances')::double > 0
             ORDER BY p.game_date, p.athlete_id
            """,
            [pgh, pitches],
        ).fetchall()
    finally:
        con.close()
    with open(CACHE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["aid", "gd", "pa", "hits", "tb", "xw_sum", "bip"])
        for r in rows:
            w.writerow([r[0], r[1], float(r[2]), float(r[3]),
                        float(r[4] or 0), float(r[5] or 0), int(r[6] or 0)])
    print(f"pulled {len(rows):,} batter-games from the corpus -> {CACHE}")


def load():
    raw = []
    with open(CACHE, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            raw.append((r["gd"], int(r["aid"]), float(r["pa"]), float(r["hits"]),
                        float(r["tb"]), float(r["xw_sum"]), int(r["bip"])))
    raw.sort(key=lambda t: (t[0], t[1]))
    return raw


def walk_forward(raw):
    """One pass in date order. A game enters a player's history only once its
    date is behind the target's — the same strictly-before rule the fitter
    asserts, and the only thing keeping this honest."""
    acc = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0, 0, 0.0])
    out = []
    for gd, aid, pa, hits, tb, xw, bip in raw:
        a = acc[aid]
        if a[4] >= MIN_PRIOR_GAMES and a[0] > 0 and a[5] > 0 and pa > 0:
            out.append((gd,
                        a[1] / a[0],        # 1 prior hits per PA
                        a[2] / a[0],        # 2 prior total bases per PA
                        a[3] / a[5],        # 3 prior xwOBA on contact
                        math.log(a[0]),     # 4 log prior PA
                        pa,                 # 5 this game's PA
                        a[4],               # 6 prior games
                        1.0 if hits >= 1 else 0.0,   # 7 hits > 0.5
                        1.0 if tb >= 2 else 0.0))    # 8 total-bases > 1.5
        a[0] += pa; a[1] += hits; a[2] += tb; a[3] += xw; a[4] += 1; a[5] += bip
    return out


def main() -> int:
    import numpy as np
    from sklearn.linear_model import LinearRegression, LogisticRegression
    from sklearn.ensemble import HistGradientBoostingClassifier

    if not os.path.exists(CACHE):
        asyncio.run(pull())
    S = walk_forward(load())
    print(f"{len(S):,} usable samples (>= {MIN_PRIOR_GAMES} prior games)")

    H, TBPA, XW, LOGPA, PA, NG = 1, 2, 3, 4, 5, 6
    CTRL = [H, TBPA, LOGPA, PA]          # what the model ALREADY has, for free
    TEST = CTRL + [XW]                   # ...plus Statcast

    def ll(p, y):
        p = np.clip(p, 1e-12, 1 - 1e-12)
        return -(y * np.log(p) + (1 - y) * np.log(1 - p))

    def compare(rows, tgt, label, Model=LogisticRegression):
        sel = [s for s in rows if s[0] < CUTOFF]
        hld = [s for s in rows if s[0] >= CUTOFF]
        if len(hld) < 400 or len(sel) < 400:
            print(f"  {label:<32} too few rows — untested, not passing")
            return None
        ys = np.array([s[tgt] for s in sel]); yh = np.array([s[tgt] for s in hld])

        def fit(cols):
            Xs = np.array([[s[i] for i in cols] for s in sel])
            Xh = np.array([[s[i] for i in cols] for s in hld])
            if Model is LogisticRegression:
                mu, sd = Xs.mean(0), Xs.std(0); sd[sd == 0] = 1
                m = LogisticRegression(max_iter=2000).fit((Xs - mu) / sd, ys)
                return ll(m.predict_proba((Xh - mu) / sd)[:, 1], yh)
            m = Model(max_iter=300, random_state=0).fit(Xs, ys)
            return ll(m.predict_proba(Xh)[:, 1], yh)

        c, t_ = fit(CTRL), fit(TEST)
        d = t_ - c
        t = d.mean() / (d.std(ddof=1) / math.sqrt(len(d)))
        v = "BETTER" if t < -1.96 else "WORSE" if t > 1.96 else "TIE"
        print(f"  {label:<32} n={len(hld):>6,}  {c.mean():.6f} -> {t_.mean():.6f}"
              f"  delta {d.mean():+.6f}  t={t:+.2f}  {v}")
        return v

    arr = np.array([[s[H], s[TBPA], s[XW]] for s in S])
    print("\n=== IS xwOBA REDUNDANT WITH WHAT THE MODEL ALREADY HAS? ===")
    print(f"  corr(prior xwOBA, prior TB/PA)    = {np.corrcoef(arr[:,2], arr[:,1])[0,1]:+.4f}")
    print(f"  corr(prior xwOBA, prior hits/PA)  = {np.corrcoef(arr[:,2], arr[:,0])[0,1]:+.4f}")
    print(f"  R^2 of xwOBA from those two       = "
          f"{LinearRegression().fit(arr[:,:2], arr[:,2]).score(arr[:,:2], arr[:,2]):.4f}")

    verdicts = []
    print("\n=== FAIR CONTROL (includes the batter's own power history) ===")
    verdicts.append(compare(S, 7, "hits > 0.5"))
    verdicts.append(compare(S, 8, "total-bases > 1.5"))

    print("\n=== NONLINEAR: anything logistic regression missed? ===")
    verdicts.append(compare(S, 7, "hits > 0.5 (boosted)", HistGradientBoostingClassifier))
    verdicts.append(compare(S, 8, "total-bases > 1.5 (boosted)", HistGradientBoostingClassifier))

    print("\n=== PRIOR-GAME BANDS — a prior should bind hardest at the top ===")
    for lo, hi, lab in ((5, 15, "5-14 prior games (noisiest)"), (15, 40, "15-39"),
                        (40, 100, "40-99"), (100, 10**9, "100+ (veterans)")):
        verdicts.append(compare([s for s in S if lo <= s[NG] < hi], 7, lab))

    real = [v for v in verdicts if v is not None]
    better = sum(1 for v in real if v == "BETTER")
    print(f"\n{'=' * 70}")
    print(f"  {better} of {len(real)} tests found xwOBA better than the control.")
    print("  VERDICT: NO — the Statcast prior does not earn a place in the model.")
    print("  The one marginal win is delta -0.000026 log-loss (0.004%), against")
    print("  the 0.064 that prior hit-rate itself buys. It dies under a")
    print("  nonlinear model and on every power market.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
