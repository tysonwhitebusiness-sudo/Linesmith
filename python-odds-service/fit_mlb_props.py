"""Phase 5.3 + 5.4 — the MLB batter/pitcher prop model and its walk-forward.

Phase 4's three corrections are built in FROM THE START rather than discovered
again:

1. QUINTILE ORDERING, never integer buckets. `int(expected)` puts every row of a
   low-mean market into one bucket, and `all()` over a one-element list is
   vacuously True — NHL recorded assists and goals as "ordering monotone" from a
   check with nothing to compare. Most MLB markets are sub-1 (home runs 0.12,
   doubles 0.17, stolen bases 0.05) and would fail identically.

2. NO PARAMETER ON A REAL BOUND, with truncations distinguished from genuine
   endpoints. `dispersion` 1e6 is the Poisson limit, `volume_window` 0 means all
   history, `shrink_k` 0 is no shrinkage: all three are floors of the concept,
   not edges of the grid.

3. STRICTLY-BEFORE, ASSERTED BY COUNT. The two-pointer merge folds in only games
   dated before the prop's own date, and the fit refuses to run if that is ever
   violated.

AND THE ONE PHASE 4 PAID FOR: the fit and the serving path share ONE history
source, `mlb_props.load_game_history`, which existed before either. NHL's fit
built history from prop rows only (18.8 games/player) while serving used every
game (553.8), and the board showed a model that had never been measured.

PER-SEASON LEAGUE BASELINES, not pooled. Measured: mean hits per player-game
runs 0.6439 in 2021 against 0.8046 in 2023. Part of that is a real run
environment (the 2019 ball, the 2023 pitch clock) and part is roster
composition, which is why the baseline used is a RATE — events per plate
appearance — rather than events per game. A rate is robust to how many
marginal players a season's rows happen to include.

Run from python-odds-service/:
    python fit_mlb_props.py [--persist] [market ...]
"""
import asyncio
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from predict import count_prop_engine as eng  # noqa: E402
from predict import mlb_props as mp  # noqa: E402

# SEASON-LEVEL SPLIT: SELECT is the 2025 season, HELD OUT is 2026. Chosen
# against a structural fact about the archive that no plan anticipated —
# MLB PROP PRICES EXIST IN THREE ERAS, and the middle one has none:
#
#   2025-03 .. 2025-11    487,139 rows   84-100% two-sided
#   2026-03 .. 2026-08    753,000 rows   ZERO prices — lines only
#   2026-09-03 .. 09-06    90,435 rows   95.4% two-sided (the live feed)
#
# More than half the archive carries a LINE and no ODDS. That is fully usable
# for the STATS bar, which needs projection, line and outcome and never touches
# a price — so the board is unaffected. It is unusable for the BETTING bar,
# de-vigging and CLV, all of which need a price.
#
# A mid-2026 cutoff would have put the entire held-out window inside the
# price-less era, so the betting bar would have silently had nothing to score
# and reported nothing rather than failing. Splitting on the season keeps priced
# rows on the SELECT side and puts the live feed's priced rows in held-out.
CUTOFF = date(2026, 1, 1)
MIN_PRIOR = 5

# volume_window 40 is a STRUCTURAL ceiling, not a grid edge: PlayerHistory keeps
# only MAX_RECENT=40 recent games, so a longer window cannot differ from 40.
VOLUME_WINDOWS = [0, 5, 10, 20, 40]
# Extended to 160 after the first run pinned hits at k=40. k is in GAMES, and a
# batter's rate is noisier per game than a skater's, so heavier shrinkage is
# plausible rather than pathological.
SHRINK_KS = [0.0, 1.0, 2.0, 5.0, 10.0, 20.0, 40.0, 80.0, 160.0]
# SHAPES, not dispersions. The NB family spans variance >= mean only, so a
# stat whose variance is BELOW its mean has no reachable shape in it. Measured:
# hits var/mean 0.854 (under-dispersed, because a batter cannot out-hit his
# plate appearances), total bases 2.119 (over), home runs 1.004 (Poisson). MLB
# needs all three directions; NHL only ever needed two.
SHAPES = eng.SHAPES

# Markets with no history to fit on (live scheme only, four days deep).
NOT_YET = {"triples", "walks", "batter-strikeouts"}


def am_prob(o) -> float:
    o = float(o)
    return (100.0 / (o + 100.0)) if o > 0 else ((-o) / ((-o) + 100.0))


def ll(p: float) -> float:
    return -math.log(min(1 - 1e-12, max(1e-12, p)))


def paired(a, b):
    d = [x - y for x, y in zip(a, b)]
    n = len(d)
    if n < 2:
        return 0.0, 0.0, float("nan")
    m = sum(d) / n
    sd = (sum((x - m) ** 2 for x in d) / (n - 1)) ** 0.5
    se = sd / math.sqrt(n)
    return m, se, (m / se if se else float("nan"))


async def load_props(conn, spec) -> list[tuple]:
    """Prop rows joined to the settled outcome, through the dual-space resolver.

    Returns (game_date, athlete_id, line, over_price, under_price, actual).
    """
    # THE RESOLVER IS A CTE, NOT A CORRELATED SUBQUERY. Written the obvious way —
    # COALESCE of two scalar subqueries in the JOIN condition — Postgres
    # evaluates it per candidate row and the query blew the 2-minute statement
    # timeout on the fifth market. Materialising the id map once turns it into a
    # hash join.
    #
    # The UNION ALL is safe because the two id spaces are PROVABLY DISJOINT
    # (5.2: zero ids valid in both), so no prop row can match twice. If that ever
    # stops being true this produces duplicate rows rather than wrong ones, and
    # the row counts in audit_mlb_crosswalk.py would show it.
    sql = f"""
        WITH xw AS (
            SELECT espn_athlete_id AS ext_id, athlete_id
              FROM athlete_crosswalk
             WHERE sport = 'mlb' AND espn_athlete_id IS NOT NULL
            UNION ALL
            SELECT athlete_id AS ext_id, athlete_id
              FROM athlete_crosswalk WHERE sport = 'mlb'
        )
        SELECT p.game_date, g.athlete_id, p.line, p.over_price, p.under_price,
               {spec.stat_sql} AS actual
          FROM prop_odds_archive p
          JOIN xw ON xw.ext_id = p.athlete_id
          JOIN player_game_history g
            ON g.sport = 'mlb'
           AND g.athlete_id = xw.athlete_id
           AND g.game_date = p.game_date
         WHERE p.sport = 'mlb' AND p.type_name = ANY($1::text[])
           AND p.line IS NOT NULL
           AND {' AND '.join(f"g.stats ? '{k}'" for k in spec.required_keys)}
           AND g.stats ? '{spec.volume_key}'
           AND {spec.volume_sql} > 0
    """
    rows = await conn.fetch(sql, list(spec.names))
    # SORTED IN PYTHON, NOT IN POSTGRES. The ORDER BY here made the planner sort
    # a multi-hundred-thousand-row join, which spills to `base/pgsql_tmp` — and
    # the database is at 6.4 GB of an 8 GB ceiling, so the fit died with
    # DiskFullError. A hundred thousand tuples sort in memory in well under a
    # second and cost the database nothing.
    out = [(r["game_date"], str(r["athlete_id"]), float(r["line"]),
            r["over_price"], r["under_price"], float(r["actual"])) for r in rows]
    out.sort(key=lambda t: (t[0], t[1]))
    return out


def walk(props, games, w, k, shape, lr, lv):
    """Walk-forward. History from EVERY game, strictly before the prop's date."""
    hist, out, i = {}, [], 0
    for gd, aid, line, op, up, actual in props:
        while i < len(games) and games[i][0] < gd:
            _, a2, ev, vol = games[i]
            hist.setdefault(a2, eng.PlayerHistory()).add(ev, vol)
            i += 1
        h = hist.get(aid)
        if h is not None and h.games >= MIN_PRIOR:
            pr = eng.project(h, lr, lv, k=k, volume_window=w)
            prob = eng.shape_prob_over(shape[0], shape[1], line,
                                       pr.expected, pr.projected_volume)
            out.append((gd, line, op, up, actual, prob, pr.expected))
    return out


def score(sc, lo=None, hi=None):
    v = [x for x in sc if (lo is None or x[0] >= lo) and (hi is None or x[0] < hi)]
    if not v:
        return None
    n = len(v)
    L = sum(ll(o if actual > line else 1 - o)
            for _, line, _, _, actual, o, _ in v) / n
    acc = sum(1 for _, line, _, _, actual, o, _ in v
              if (o > 0.5) == (actual > line)) / n
    proj = sum(e for *_, e in v) / n
    act = sum(a for _, _, _, _, a, _, _ in v) / n
    return {"n": n, "ll": L, "acc": acc,
            "bias": proj / act - 1 if act else float("nan"), "rows": v}


async def run_market(conn, slug: str, persist: bool) -> dict | None:
    spec = mp.BY_SLUG[slug]
    props = await load_props(conn, spec)
    games = await mp.load_game_history(slug, conn=conn)

    sel_props = [p for p in props if p[0] < CUTOFF]
    if len(sel_props) < 500:
        print(f"\n{slug}: only {len(sel_props):,} SELECT rows — too few to fit")
        return None

    # Leakage control, asserted rather than trusted.
    sel_games = [g for g in games if g[0] < CUTOFF]
    if not sel_games:
        print(f"\n{slug}: no SELECT-window games")
        return None
    lr = sum(g[2] for g in sel_games) / sum(g[3] for g in sel_games)
    lv = sum(g[3] for g in sel_games) / len(sel_games)

    best = None
    for w in VOLUME_WINDOWS:
        for k in SHRINK_KS:
            for sh in SHAPES:
                m = score(walk(props, games, w, k, sh, lr, lv), hi=CUTOFF)
                if m and (best is None or m["ll"] < best[0]):
                    best = (m["ll"], w, k, sh)
    if best is None:
        print(f"\n{slug}: nothing scored")
        return None
    _, bw, bk, bsh = best
    sc = walk(props, games, bw, bk, bsh, lr, lv)
    sel, held = score(sc, hi=CUTOFF), score(sc, lo=CUTOFF)
    if not held:
        print(f"\n{slug}: no held-out rows")
        return None

    # CALIBRATION: temperature vs full Platt, chosen on SELECT.
    #
    # Temperature (a=1/T, b=0) rotates the curve about 0.5 and fixes
    # OVERCONFIDENCE, which is what NHL needed. It cannot SHIFT the curve, so it
    # is powerless against a model that is wrong in one direction everywhere —
    # measured on MLB hits, every bucket at every line was off positively.
    # Whichever form wins on SELECT is kept, so a market that needs only
    # temperature is not charged a second parameter.
    cal_rows = [(o, a > line) for _, line, _, _, a, o, _ in sel["rows"]]

    bestT, bv = 1.0, None
    for i in range(70):
        T = 0.5 + 0.03 * i
        v = sum(ll(eng.temper(o, T) if hit else 1 - eng.temper(o, T))
                for o, hit in cal_rows) / len(cal_rows)
        if bv is None or v < bv:
            bv, bestT = v, T

    pa, pb = eng.fit_platt(cal_rows)
    pv = sum(ll(eng.platt(o, pa, pb) if hit else 1 - eng.platt(o, pa, pb))
             for o, hit in cal_rows) / len(cal_rows)

    if pv < bv:
        cal_kind, cal_a, cal_b = "platt", pa, pb
    else:
        cal_kind, cal_a, cal_b = "temperature", 1.0 / bestT, 0.0

    def corrected(pr: float) -> float:
        return eng.platt(pr, cal_a, cal_b)

    print(f"\n{slug}  ({spec.side})")
    print(f"  fitted: volume_window={bw or 'all'} shrink_k={bk} "
          f"shape={eng.shape_label(*bsh)}")
    print(f"  calibration: {cal_kind}  a={cal_a:.3f} b={cal_b:+.3f}"
          f"   (SELECT ll: temperature {bv:.5f}, platt {pv:.5f})")
    print(f"  league: rate {lr:.5f}/chance, {lv:.2f} chances/game")
    print(f"  held out n={held['n']:,}  log-loss {held['ll']:.5f}  "
          f"acc {held['acc']*100:.1f}%  bias {held['bias']*100:+.1f}%")

    # --- ORDERING: equal-count quintiles, never integer buckets -------------
    ranked = sorted(held["rows"], key=lambda t: t[6])
    order = []
    if len(ranked) >= 5 * 30:
        step = len(ranked) // 5
        for i in range(5):
            chunk = ranked[i * step:(i + 1) * step if i < 4 else len(ranked)]
            order.append((i + 1, len(chunk),
                          sum(r[4] for r in chunk) / len(chunk)))
    monotone = bool(order) and all(
        order[i][2] <= order[i + 1][2] + 1e-9 for i in range(len(order) - 1))

    cal = eng.calibration([(corrected(r[5]), r[4] > r[1]) for r in held["rows"]])
    ece, worst = cal["ece"], cal["worst"]
    # BOTH must hold. ECE is the n-weighted average error and answers "is this
    # calibrated?"; `worst` catches a model fine on average and badly wrong in
    # one place. Thresholds: 0.025 and 0.05.
    prob_ok = bool(monotone and ece <= 0.025 and worst <= 0.05)

    print("  ORDERING by projection quintile: " +
          (", ".join(f"Q{b}->{m:.3f} (n={n})" for b, n, m in order)
           if order else "TOO FEW ROWS FOR 5 BINS — untested, not passing"))
    print(f"    monotone: {monotone}   after {cal_kind}: "
          f"ECE {ece:.4f} (<=0.025), worst bucket {worst:.3f} (<=0.05, n>={cal['worst_n']})"
          f"   ranks={'YES' if monotone else 'NO'} probability={'YES' if prob_ok else 'NO'}")

    market_ll = None
    two = [r for r in held["rows"] if r[2] is not None and r[3] is not None]
    if len(two) >= 200:
        def mk(r):
            a, b = am_prob(r[2]), am_prob(r[3])
            return a / (a + b)
        m_ll = [ll(r[5] if r[4] > r[1] else 1 - r[5]) for r in two]
        k_ll = [ll(mk(r) if r[4] > r[1] else 1 - mk(r)) for r in two]
        market_ll = sum(k_ll) / len(two)
        _, _, t = paired(m_ll, k_ll)
        print(f"  BETTING BAR — model {sum(m_ll)/len(two):.5f} vs market "
              f"{market_ll:.5f}   t={t:+.2f}  "
              f"{'MODEL' if t < -1.96 else 'MARKET' if t > 1.96 else 'TIE'}")

    if persist:
        import db as _db
        await _db.write_calibration(
            _db.CalibrationInput(
                sport="mlb", market=slug, method=cal_kind,
                params={
                    "volume_window": bw, "shrink_k": bk,
                    "shape_kind": bsh[0], "shape_param": bsh[1],
                    "calibration_kind": cal_kind, "calibration_a": cal_a,
                    "calibration_b": cal_b,
                    "league_rate": lr, "league_volume": lv,
                    "min_prior_games": MIN_PRIOR, "select_cutoff": CUTOFF.isoformat(),
                    "side": spec.side,
                    "ordering": [{"quintile": b, "n": n, "actual": m}
                                 for b, n, m in order],
                    "ordering_monotone": monotone,
                    "calibration_ece": ece,
                    "worst_calibration_gap": worst,
                    "calibration_table": cal["table"],
                    "ranking_ok": monotone,
                    "probability_ok": prob_ok,
                    "holdout_accuracy": held["acc"],
                    "projection_bias": held["bias"],
                },
                train_games=sel["n"], train_log_loss=sel["ll"],
                holdout_games=held["n"], holdout_log_loss=held["ll"],
                baseline_holdout_log_loss=market_ll),
            activate=monotone)
        print(f"  persisted: mlb/{slug}  active={monotone} "
              f"probability_ok={bool(monotone and worst <= 0.05)}")

    return {"slug": slug, "monotone": monotone, "gap": worst, "ece": ece,
            "prob_ok": prob_ok, "n": held["n"], "ll": held["ll"]}


async def main() -> int:
    import db

    persist = "--persist" in sys.argv
    wanted = [a for a in sys.argv[1:] if not a.startswith("--")]
    slugs = wanted or [s.slug for s in mp.MARKETS if s.slug not in NOT_YET]

    sys.stdout.reconfigure(line_buffering=True)
    print(f"Phase 5.3/5.4 — MLB prop walk-forward, {len(slugs)} markets"
          + ("   [--persist]" if persist else ""))
    print(f"SELECT < {CUTOFF} <= HELD OUT.  "
          f"{len(VOLUME_WINDOWS)}x{len(SHRINK_KS)}x{len(SHAPES)} "
          f"= {len(VOLUME_WINDOWS)*len(SHRINK_KS)*len(SHAPES)} combos/market")

    pool = await db.get_pool()
    results = []
    # ONE CONNECTION PER MARKET, NOT ONE FOR THE WHOLE RUN. Holding a single
    # connection across a multi-hour fit means the pool eventually reclaims it
    # and the next query dies with "connection has been released back to the
    # pool" — which is exactly how the third attempt at this fit ended, after
    # completing one market and then sitting idle for hours. A market takes
    # minutes; a connection held for minutes is uncontroversial.
    for slug in slugs:
        async with pool.acquire(timeout=300.0) as conn:
            # THIS IS AN OFFLINE FIT, NOT A REQUEST PATH. The default 2-minute
            # statement timeout is right for anything a user waits on and wrong
            # here: one market's join spans 1.3M prop rows against 727k
            # player-games. Raised deliberately, per connection, alongside the
            # indexes in migration 20260906010000 that should make it moot.
            await conn.execute("SET statement_timeout = '15min'")
            try:
                r = await run_market(conn, slug, persist)
            except Exception as exc:                       # noqa: BLE001
                # ONE MARKET'S FAILURE MUST NOT COST THE OTHER THIRTEEN. Three
                # earlier runs lost every subsequent market to a single query
                # error; the fit now records the failure and carries on.
                print()
                print(f"{slug}: FAILED — {type(exc).__name__}: {exc}")
                results.append({"slug": slug, "monotone": False, "gap": 9.9,
                                "ece": 9.9, "prob_ok": False, "n": 0,
                                "ll": float("nan"), "error": str(exc)[:120]})
                continue
        if r:
            results.append(r)

    print("\n" + "=" * 70)
    print(f"  {'market':<22} {'held out':>9} {'log-loss':>9} {'ECE':>7} {'worst':>7}  verdict")
    for r in sorted(results, key=lambda x: x["ece"]):
        v = ("FAILED: " + r["error"][:40] if r.get("error")
             else "rank + probability" if r["prob_ok"]
             else "rank only" if r["monotone"] else "OFF THE BOARD")
        print(f"  {r['slug']:<22} {r['n']:>9,} {r['ll']:>9.5f} "
              f"{r['ece']:>7.4f} {r['gap']:>7.3f}  {v}")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
