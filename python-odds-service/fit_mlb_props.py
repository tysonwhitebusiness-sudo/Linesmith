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

# WIDENED BY THE PHASE 5 AUDIT, which found every fitted market pinned at the
# old maximum of 40. `PlayerHistory` now keeps 200 games, so 200 is the real
# structural ceiling and 0 ("all history") remains the floor — both genuine
# endpoints, with room between them for the optimum to actually sit.
VOLUME_WINDOWS = [0, 5, 10, 20, 40, 80, 160, 200]
# Extended twice: to 160 after the first run pinned hits at 40, then to 1280
# after the audit found three of four markets pinned at 160. k is in GAMES, and
# a batter's per-game rate is far noisier than a skater's — a season is 150-odd
# games and a hitter's true talent moves slowly — so shrinkage measured in
# hundreds of games is plausible rather than pathological. The point is that the
# optimum must sit INSIDE the grid, wherever that turns out to be.
# 1e9 is the FULL-SHRINKAGE LIMIT and a genuine endpoint, the mirror of 0.0 at
# the other end and of dispersion=1e6 for shape. At k that large the weight
# n/(n+k) is zero for any real sample, so the projection ignores the player's own
# rate entirely and uses the league rate times his volume. That is a meaningful
# answer, not a degenerate one: it says this market's per-player rate carries no
# signal the volume does not already carry. Including it makes the top of the
# grid an endpoint rather than a truncation, so a market landing there has been
# fitted rather than clipped.
SHRINK_KS = [0.0, 1.0, 2.0, 5.0, 10.0, 20.0, 40.0, 80.0, 160.0, 320.0, 640.0,
             1280.0, 2560.0, 5120.0, 1e9]
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


async def load_crosswalk(conn) -> dict[str, str]:
    """External prop athlete id -> the id `player_game_history` uses.

    Covers BOTH id spaces: ESPN ids before the 2026-09-03 cutover, MLB StatsAPI
    ids after it. Safe as one flat dict because 5.2 proved the spaces disjoint —
    zero ids are valid in both — so no key can be claimed twice.
    """
    out: dict[str, str] = {}
    for r in await conn.fetch(
            "SELECT espn_athlete_id, athlete_id FROM athlete_crosswalk "
            "WHERE sport = 'mlb'"):
        mlb_id = str(r["athlete_id"])
        out[mlb_id] = mlb_id
        if r["espn_athlete_id"]:
            out[str(r["espn_athlete_id"])] = mlb_id
    return out


async def load_props(conn, spec, xw: dict[str, str],
                     games: list[tuple]) -> list[tuple]:
    """Prop rows joined to their settled outcome — JOINED IN PYTHON.

    Returns (game_date, athlete_id, line, over_price, under_price, actual).

    THE DATABASE NO LONGER DOES THIS JOIN. Three separate runs died on it: twice
    on the statement timeout and twice with DiskFullError writing to
    `base/pgsql_tmp`. Joining 1.3M prop rows against 727k player-games needs a
    hash table Postgres has to spill, and the database is at 79% of an 8 GB
    ceiling with no room to spill into. Moving the sort out helped and was not
    enough, because the JOIN itself is what needs the temp space.

    So each side is fetched on its own — a filtered scan, which the
    `(sport, type_name, game_date)` index now serves — and matched here against
    a dict keyed on (athlete, date). `games` is already loaded for the
    walk-forward and already carries the settling stat, so the outcome comes
    from the SAME rows the history is built from. That is not merely convenient:
    it makes it structurally impossible for the outcome and the history to
    disagree about what a player did, which is the class of defect that cost
    Phase 4 a full re-fit.
    """
    # DOUBLEHEADERS ARE AMBIGUOUS AND ARE DROPPED, NOT GUESSED AT. 6,617
    # (athlete, date) pairs in MLB history have TWO games. A prop is posted for a
    # player on a DATE, so on those days there is no way to know which game it
    # settles against — and both earlier versions of this loader got it wrong in
    # different directions. The SQL join emitted a row per game, scoring one prop
    # line against two different outcomes; a plain dict silently kept whichever
    # row arrived last. Same rule NHL's loader already applies to its own
    # ambiguous dates: drop, never guess.
    outcome: dict[tuple[str, object], float | None] = {}
    for gd, aid, stat, _ in games:
        key = (aid, gd)
        outcome[key] = None if key in outcome else stat
    ambiguous = sum(1 for v in outcome.values() if v is None)

    rows = await conn.fetch(
        "SELECT game_date, athlete_id, line, over_price, under_price "
        "  FROM prop_odds_archive "
        " WHERE sport = 'mlb' AND type_name = ANY($1::text[]) "
        "   AND line IS NOT NULL AND athlete_id IS NOT NULL",
        list(spec.names))

    out = []
    for r in rows:
        aid = xw.get(str(r["athlete_id"]))
        if aid is None:
            continue
        actual = outcome.get((aid, r["game_date"]))
        if actual is None:
            continue          # no settled game, or an ambiguous doubleheader
        out.append((r["game_date"], aid, float(r["line"]),
                    r["over_price"], r["under_price"], actual))
    out.sort(key=lambda t: (t[0], t[1]))
    if ambiguous:
        print(f"  {ambiguous:,} (athlete, date) pairs were doubleheaders "
              f"and were dropped as ambiguous")
    return out


def snapshot(props, games, lv):
    """Walk the history ONCE and record what every grid point will need per row.

    THE WALK IS THE EXPENSIVE PART AND IT DOES NOT DEPEND ON THE PARAMETERS.
    Re-folding 425k games for each of 672 grid points is 285 million adds per
    market, and every one of those folds produces the SAME history — only the
    projection computed from it varies. So the fold happens once and each row
    keeps the scalars any combo can be evaluated from, plus the mean volume at
    each candidate window, that being the one quantity a window changes.

    Strictly-before is enforced here, in the single place it can be: a game
    enters history only once its date is behind the prop's.
    """
    hist, out, i = {}, [], 0
    for gd, aid, line, op, up, actual in props:
        while i < len(games) and games[i][0] < gd:
            _, a2, ev, vol = games[i]
            hist.setdefault(a2, eng.PlayerHistory()).add(ev, vol)
            i += 1
        h = hist.get(aid)
        if h is not None and h.games >= MIN_PRIOR:
            out.append((gd, line, op, up, actual, h.events, h.volume, h.games,
                        tuple(h.mean_volume(lv, w) for w in VOLUME_WINDOWS)))
    return out


def evaluate(snap, wi, k, shape, lr, lv):
    """Score one grid point off the snapshot — no history walk, no allocation."""
    out = []
    for gd, line, op, up, actual, events, volume, games, vols in snap:
        vol = vols[wi]
        expected = vol * eng.shrunk_rate(events, volume, lr, k, lv)
        prob = eng.shape_prob_over(shape[0], shape[1], line, expected, vol)
        out.append((gd, line, op, up, actual, prob, expected))
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


async def run_market(conn, slug: str, persist: bool,
                     xw: dict[str, str]) -> dict | None:
    spec = mp.BY_SLUG[slug]
    # Games first: they carry the settling stat, so the outcome a prop is scored
    # against comes from the same rows its history is built from.
    games = await mp.load_game_history(slug, conn=conn)
    props = await load_props(conn, spec, xw, games)

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

    snap = snapshot(props, games, lv)
    if not snap:
        print(f"\n{slug}: no rows cleared the {MIN_PRIOR}-game floor")
        return None
    sel_snap = [r for r in snap if r[0] < CUTOFF]

    # SELECTION: best SELECT log-loss, TIE-BROKEN ON SELECT ORDERING.
    #
    # Hyperparameters were selected purely on log-loss while the gate is ordering
    # plus calibration — different objectives, and a config can win one while
    # losing the other. That bit for real on `doubles`: two configs scored
    # 0.43549 and 0.43551 on SELECT log-loss, indistinguishable, and the sweep
    # took the marginally better one, whose held-out ordering was INVERTED
    # (Q1 0.142 > Q2 0.138). A market went off the board on a fourth-decimal
    # coin-flip.
    #
    # Fixed by treating anything within TIE_TOL of the best log-loss as tied and
    # preferring, among those, a config whose ordering is monotone. Both criteria
    # are measured on SELECT, so nothing about the held-out window influences the
    # choice — this is a tiebreak, not a change of objective, and it cannot
    # rescue a config that log-loss genuinely rejects.
    TIE_TOL = 1e-3

    def sel_ordering_monotone(rows) -> bool:
        if len(rows) < 5 * 30:
            return False
        r = sorted(rows, key=lambda t: t[6])
        step = len(r) // 5
        means = []
        for i in range(5):
            chunk = r[i * step:(i + 1) * step if i < 4 else len(r)]
            means.append(sum(x[4] for x in chunk) / len(chunk))
        return all(means[i] <= means[i + 1] + 1e-9 for i in range(4))

    cands = []
    for wi, w in enumerate(VOLUME_WINDOWS):
        for k in SHRINK_KS:
            for sh in SHAPES:
                rows = evaluate(sel_snap, wi, k, sh, lr, lv)
                m = score(rows)
                if m:
                    cands.append((m["ll"], wi, w, k, sh, rows))
    if not cands:
        print()
        print(f"{slug}: nothing scored")
        return None
    floor = min(c[0] for c in cands)
    tied = [c for c in cands if c[0] <= floor + TIE_TOL]
    ordered = [c for c in tied if sel_ordering_monotone(c[5])]
    pool_ = ordered or tied
    best = min(pool_, key=lambda c: c[0])[:5]
    if ordered and len(ordered) < len(tied):
        print(f"  tiebreak: {len(tied)} configs within {TIE_TOL} of the best "
              f"SELECT log-loss; {len(ordered)} of them order monotonically")
    if best is None:
        print(f"\n{slug}: nothing scored")
        return None
    _, bwi, bw, bk, bsh = best
    sc = evaluate(snap, bwi, bk, bsh, lr, lv)
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
    async with pool.acquire(timeout=120.0) as conn:
        xw = await load_crosswalk(conn)
    print(f"crosswalk: {len(xw):,} external ids resolve to an MLB athlete")
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
                r = await run_market(conn, slug, persist, xw)
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
