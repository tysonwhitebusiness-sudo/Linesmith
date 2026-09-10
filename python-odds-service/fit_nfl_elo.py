"""Phase 4.1 — fit NFL Elo on the real history, and gate it against the market.

    python fit_nfl_elo.py [--persist]

WHAT ALREADY EXISTED, AND WHY THIS IS NOT A REWRITE. `predict/generic_team_elo.py`
already carries the whole Elo apparatus — the logistic expectation, a log-scaled
margin-of-victory multiplier dampened by how big a favourite the winner already
was, season regression toward the mean. That IS the "margin-adjusted Elo with
diminishing returns on blowouts" this phase asks for, and this file imports it
rather than growing a second copy.

Two things were missing, and they are the whole of 4.1:

1. **NOTHING WAS EVER FITTED.** NFL sits on `k_factor=20, home_bonus=48`, which
   that module's own docstring calls "reasonable, standard sports-Elo starting
   points". They were never measured against NFL results.
2. **IT ONLY EVER SAW ~400 DAYS.** `backfill_sport_elo` walks ESPN's scoreboard
   with `days_back=400`. The database holds **7,561 NFL games with scores back
   to 1999-09-12**, 7,264 of which join to archived odds. A rating system judged
   on one season of history is judged on noise.

THE GATE IS THE MARKET, NOT A COIN FLIP. Beating 50% proves nothing — home teams
win about 57% of NFL games, so a model that always picks the home side clears
that. The comparison is against the DE-VIGGED CLOSING MONEYLINE on the same
games, scored with the same paired t-test `fit_mlb_props.py` uses for its betting
bar. Phase 3.2 is the cautionary case: home runs beat a constant predictor by
1.92% and was still the weakest thing on the board.

De-vig is multiplicative from ONE source's two-sided price:
`p_home = raw_home / (raw_home + raw_away)`. Comparing a price from one book
against another book's is not either book's opinion — the same rule
`_market_prob_for` enforces elsewhere in this repo.

SPLIT BY SEASON, never by row. A season boundary is a real discontinuity (rosters
turn over, ratings regress) and slicing inside one leaks the second half of a
season into the first.
"""
import asyncio
import csv
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from predict.generic_team_elo import (  # noqa: E402
    ELO_SCALE, STARTING_ELO, elo_expected_home_win_prob, mov_multiplier,
)

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".nfl_elo_games.csv")
HELD_OUT_FROM = 2021          # seasons >= this are the test set


def implied(american) -> float | None:
    if american is None:
        return None
    a = float(american)
    if a > 0:
        return 100.0 / (a + 100.0)
    if a < 0:
        return (-a) / ((-a) + 100.0)
    return None


def ll(p: float, actual: float) -> float:
    p = min(1 - 1e-12, max(1e-12, p))
    return -(actual * math.log(p) + (1 - actual) * math.log(1 - p))


def season_of(game_date: str) -> int:
    """NFL seasons span the new year: a January game belongs to the prior
    season. Getting this wrong would regress ratings to the mean in the middle
    of the playoffs."""
    y, m = int(game_date[:4]), int(game_date[5:7])
    return y - 1 if m <= 2 else y


async def pull() -> None:
    import db
    # Phase 5.S.7 — THE SAME SQL, RUN IN DUCKDB OVER (corpus UNION postgres).
    # Both tables this reads are corpus members: `odds_archive` is pruned to its
    # unfrozen tail, and `game_result` may follow. Read from Postgres alone this
    # fit would silently lose the pregame moneyline for almost every historical
    # game -- the `LEFT JOIN mkt` means those games do not disappear, they just
    # arrive with a NULL market price, so the Elo would still fit, on a
    # population with no market to calibrate against. That is the worst possible
    # shape of failure: a complete-looking run with the benchmark quietly gone.
    from corpus_reads import duck_connection, union_view

    pool = await db.get_pool()
    async with pool.acquire(timeout=1800.0) as c:
        await c.execute("SET statement_timeout = '30min'")
        _sql = ("""
            -- ONE BOOK, BOTH SIDES. A home price from one book de-vigged
            -- against an away price from another is not either book's opinion,
            -- and taking MAX on each side separately picks the best available
            -- price on both — which understates the vig and hands the market a
            -- sharpness no real book had. Same rule `_market_prob_for` enforces
            -- everywhere else in this repo. `is_live` rows are excluded: an
            -- in-game price is not a pregame opinion (Phase 3.5).
            WITH per_book AS (
              SELECT event_ref, bookmaker,
                     MAX(price) FILTER (WHERE side='home') home_price,
                     MAX(price) FILTER (WHERE side='away') away_price,
                     COUNT(*) FILTER (WHERE bookmaker='nflverseconsensus') is_consensus
                FROM odds_archive
               WHERE sport='nfl' AND market='moneyline' AND price IS NOT NULL
                 AND COALESCE(is_live, false) = false
               GROUP BY event_ref, bookmaker
            ), mkt AS (
              SELECT DISTINCT ON (event_ref) event_ref, home_price, away_price
                FROM per_book
               WHERE home_price IS NOT NULL AND away_price IS NOT NULL
               -- Prefer the consensus close, which is the standard benchmark
               -- and covers 10,814 of 11,540 rows back to 2006.
               ORDER BY event_ref, is_consensus DESC, bookmaker
            )
            SELECT g.game_date, g.event_ref, g.home_team_id, g.away_team_id,
                   g.home_score, g.away_score, m.home_price, m.away_price
              FROM game_result g
              LEFT JOIN mkt m ON m.event_ref = g.event_ref
             WHERE g.sport='nfl' AND g.home_score IS NOT NULL
               AND g.home_team_id IS NOT NULL AND g.away_team_id IS NOT NULL
             -- TOTAL ORDER, AND IT IS NOT COSMETIC. `(game_date, event_ref)`
             -- is NOT unique here: 232 groups in this very population share
             -- both, so the walk's order among them was whatever the engine
             -- happened to return. Elo is path-dependent -- each game updates
             -- the ratings the next one is scored against -- so those 464 rows
             -- moved the fitted numbers by an amount nobody could reproduce.
             -- Found when Postgres and DuckDB tie-broke them differently; the
             -- ROW SETS were identical, only the order was not. Same lesson as
             -- `mlb_props.load_game_history`'s doubleheader tiebreaker.
             ORDER BY g.game_date, g.event_ref, g.home_team_id, g.away_team_id""")
        con = duck_connection()
        try:
            await union_view(con, c, "odds_archive")
            await union_view(con, c, "game_result")
            cur = con.execute(_sql)
            names = [d[0] for d in cur.description]
            rows = [dict(zip(names, r)) for r in cur.fetchall()]
        finally:
            con.close()
    with open(CACHE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["game_date", "event_ref", "home", "away", "hs", "as_",
                    "home_price", "away_price"])
        for r in rows:
            w.writerow([r["game_date"], r["event_ref"], r["home_team_id"],
                        r["away_team_id"], r["home_score"], r["away_score"],
                        r["home_price"] if r["home_price"] is not None else "",
                        r["away_price"] if r["away_price"] is not None else ""])
    print(f"pulled {len(rows):,} NFL games -> {CACHE}")


def load():
    games = []
    with open(CACHE, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            hp = int(r["home_price"]) if r["home_price"] else None
            ap = int(r["away_price"]) if r["away_price"] else None
            mkt = None
            if hp is not None and ap is not None:
                a, b = implied(hp), implied(ap)
                if a and b and a + b > 0:
                    mkt = a / (a + b)          # multiplicative de-vig
            games.append({
                "date": r["game_date"], "season": season_of(r["game_date"]),
                "home": r["home"], "away": r["away"],
                "hs": float(r["hs"]), "as": float(r["as_"]), "mkt": mkt,
            })
    games.sort(key=lambda g: (g["date"], g["home"]))
    return games


# Trailing seasons used to estimate home-field advantage. HOME ADVANTAGE IS NOT
# A CONSTANT, and the decline is fully visible inside SELECT alone — so this is a
# structural fix justified without looking at the held-out window:
#
#     1999-2007  home win 0.5757  ->  53.0 Elo points
#     2008-2014  home win 0.5730  ->  51.1
#     2015-2020  home win 0.5524  ->  36.5     (all three inside SELECT)
#     2021-2025  home win 0.5445  ->  31.0     (held out; confirms the trend)
#
# A single global fit picks ~56 from the high-advantage era and then over-favours
# the home side on every held-out game. Estimating it from recent seasons tracks
# the real value instead.
HFA_WINDOW = 3


def _hfa_from(recent: list[tuple[int, float]]) -> float | None:
    """Home-field advantage in Elo points from recent seasons' home win rate."""
    n = sum(c for c, _ in recent)
    w = sum(x for _, x in recent)
    if n < 200:
        return None
    p = min(0.99, max(0.01, w / n))
    return -400.0 * math.log10(1.0 / p - 1.0)


def walk(games, k: float, home_bonus: float, regression: float,
         adaptive_hfa: bool = False):
    """One chronological pass. Returns per-game (season, p_home, actual, mkt).

    Every prediction is made BEFORE the game updates the ratings, so this is a
    genuine walk-forward at every row rather than only at the split.
    """
    elo: dict[str, float] = {}
    season = None
    out = []
    hist: list[tuple[int, float]] = []     # (games, home wins) per finished season
    cur = [0, 0.0]
    hfa = home_bonus
    for g in games:
        if g["season"] != season:
            if season is not None:
                for t in elo:
                    elo[t] = STARTING_ELO + regression * (elo[t] - STARTING_ELO)
                hist.append((cur[0], cur[1]))
                cur = [0, 0.0]
                if adaptive_hfa:
                    # Only seasons ALREADY PLAYED feed this, so no game is
                    # predicted using its own season's home-win rate.
                    est = _hfa_from(hist[-HFA_WINDOW:])
                    if est is not None:
                        hfa = est
            season = g["season"]
        h = elo.setdefault(g["home"], STARTING_ELO)
        a = elo.setdefault(g["away"], STARTING_ELO)
        p = elo_expected_home_win_prob(h, a, hfa)
        actual = 1.0 if g["hs"] > g["as"] else (0.5 if g["hs"] == g["as"] else 0.0)
        cur[0] += 1
        cur[1] += actual
        out.append((g["season"], p, actual, g["mkt"]))
        # update
        if g["hs"] == g["as"]:
            diff = 0.0
        else:
            diff = (h - a) if g["hs"] > g["as"] else (a - h)
        mov = mov_multiplier(g["hs"] - g["as"], diff)
        delta = k * mov * (actual - p)
        elo[g["home"]] = h + delta
        elo[g["away"]] = a - delta
    return out


def score(rows, lo=None, hi=None, need_market=False):
    v = [r for r in rows
         if (lo is None or r[0] >= lo) and (hi is None or r[0] < hi)
         and (not need_market or r[3] is not None)]
    if not v:
        return None
    return {"n": len(v), "ll": sum(ll(r[1], r[2]) for r in v) / len(v), "rows": v}


def paired_t(a, b):
    d = [x - y for x, y in zip(a, b)]
    n = len(d)
    m = sum(d) / n
    if n < 2:
        return m, float("nan")
    var = sum((x - m) ** 2 for x in d) / (n - 1)
    se = math.sqrt(var / n)
    return m, (m / se if se > 0 else float("nan"))


def main() -> int:
    if not os.path.exists(CACHE):
        asyncio.run(pull())
    games = load()
    seasons = sorted({g["season"] for g in games})
    with_mkt = sum(1 for g in games if g["mkt"] is not None)
    print(f"{len(games):,} games, seasons {seasons[0]}..{seasons[-1]}, "
          f"{with_mkt:,} with a two-sided moneyline ({100*with_mkt/len(games):.1f}%)")
    print(f"SELECT seasons < {HELD_OUT_FROM}, HELD OUT >= {HELD_OUT_FROM}\n")

    # --- fit on SELECT only -------------------------------------------------
    # Both variants are fitted on SELECT only, and the choice BETWEEN them is
    # made on SELECT too. The held-out window decides nothing here — it is run
    # once, at the end, and reported whatever it says.
    results = {}
    for adaptive in (False, True):
        best = None
        for k in (8, 12, 16, 20, 24, 28, 32):
            for hb in (20, 32, 44, 56, 68):
                for reg in (0.60, 0.75, 0.90, 1.00):
                    rows = walk(games, k, hb, reg, adaptive_hfa=adaptive)
                    sc = score(rows, hi=HELD_OUT_FROM)
                    if sc and (best is None or sc["ll"] < best[0]):
                        best = (sc["ll"], k, hb, reg)
        results[adaptive] = best
        label = "adaptive HFA" if adaptive else "fixed HFA   "
        print(f"  {label}  SELECT best: k={best[1]:>3} home_bonus={best[2]:>3} "
              f"regression={best[3]}  ll={best[0]:.5f}")
    adaptive = results[True][0] < results[False][0]
    _, k, hb, reg = results[adaptive]
    print(f"  -> chosen on SELECT: {'ADAPTIVE' if adaptive else 'FIXED'} home-field advantage")
    print(f"  (defaults were k=20 home_bonus=48, never fitted)\n")

    rows = walk(games, k, hb, reg, adaptive_hfa=adaptive)
    held = score(rows, lo=HELD_OUT_FROM)
    print(f"HELD OUT: n={held['n']:,}  log-loss {held['ll']:.5f}")

    base_rate = sum(r[2] for r in held["rows"]) / held["n"]
    const = sum(ll(base_rate, r[2]) for r in held["rows"]) / held["n"]
    print(f"  always-home-at-{base_rate:.3f} baseline: {const:.5f}"
          f"   model gains {const - held['ll']:+.5f}")

    # --- THE REAL GATE: the de-vigged market on the same games --------------
    both = [r for r in held["rows"] if r[3] is not None]
    print(f"\n=== THE GATE: de-vigged closing moneyline, same {len(both):,} games ===")
    if len(both) < 200:
        print("  too few market rows in the held-out window — untested, not passing")
        return 1
    m_ll = [ll(r[1], r[2]) for r in both]
    k_ll = [ll(r[3], r[2]) for r in both]
    md, t = paired_t(m_ll, k_ll)
    print(f"  model  {sum(m_ll)/len(both):.5f}")
    print(f"  market {sum(k_ll)/len(both):.5f}")
    verdict = ("MODEL BEATS MARKET" if t < -1.96 else
               "MARKET BEATS MODEL" if t > 1.96 else "TIE")
    print(f"  delta {md:+.5f}   t={t:+.2f}   {verdict}")

    if "--persist" in sys.argv:
        import db
        print("\npersisting fitted parameters ...")
        asyncio.run(_persist(k, hb, reg, held, sum(m_ll)/len(both), sum(k_ll)/len(both), t))
    return 0


async def _persist(k, hb, reg, held, model_ll, market_ll, t) -> None:
    import db
    await db.write_calibration(db.CalibrationInput(
        sport="nfl", market="moneyline", method="elo",
        params={
            "k_factor": k, "home_bonus": hb, "season_regression": reg,
            "held_out_from_season": HELD_OUT_FROM,
            "model_holdout_log_loss": model_ll,
            "market_holdout_log_loss": market_ll,
            "vs_market_t": t,
            # The gate, recorded with the parameters rather than in a comment.
            "beats_market": bool(t < -1.96),
            "probability_ok": bool(t < -1.96),
        },
        train_games=0, train_log_loss=None,
        holdout_games=held["n"], holdout_log_loss=held["ll"],
        baseline_holdout_log_loss=market_ll),
        activate=True)
    print("  persisted nfl/moneyline")


if __name__ == "__main__":
    sys.exit(main())
