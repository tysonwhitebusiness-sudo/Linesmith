"""Phase 3.4 — does the plate-appearance simulation beat the direct model at
the direct model's own job?

    python compare_sim_vs_direct.py [--iters 10000] [market ...]

THE QUESTION, and why it is a real one. Phase 3.3 built a simulation that
reproduces baseball at the league level. That is necessary and nowhere near
sufficient: the board does not ask "how many runs does an average team score",
it asks "will THIS batter get a hit tonight". The direct model already answers
that, validated on ~31,000 held-out rows per market with a correct calibration
since Phase 3.0. **The simulation has to beat it, or it does not get the board.**

THE COMPARISON IS DELIBERATELY UNFAIR IN THE SIMULATION'S FAVOUR. The direct
model sees one thing: the batter's own history. The simulation additionally sees
the opposing starting pitcher (through log5), the rest of the lineup, and an
explicit plate-appearance count distribution that falls out of the base-out
state. If more information does not win, the verdict is worth something.

MARKETS: PURE PLATE-APPEARANCE OUTCOMES ONLY, and this is not a convenience.
Phase 3.3 measured the simulation ~0.3 runs/team-game light, because it scores
only through plate appearances while real baseball also scores on errors, steals
and wild pitches. That deficit biases anything depending on ADVANCEMENT — runs,
RBIs, hits-runs-rbis, and every game total. It does not touch hits, singles,
total bases or home runs at all. Comparing on the biased markets would reject
the simulation for a known, separable defect rather than on the merits.

    compared:  hits, singles, home-runs, total-bases
    excluded:  rbis, runs, hits-runs-rbis   (advancement-dependent)
               stolen-bases                 (the simulation does not model steals)
               every pitcher market         (the simulation projects batters)

METHOD. Same SELECT/HELD-OUT split as `fit_mlb_props.py` (2026-01-01), same
held-out prop rows, same strictly-before leakage rule, and the same paired
t-test the fitter already uses for its betting bar. Both models are scored on
identical rows, so the comparison is paired and the t-test is the right one.

The direct model's numbers come from the PERSISTED calibration in
`model_calibration` — the parameters actually being served — not from a fresh
fit. That is the control the board really has.
"""
import asyncio
import json
import math
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CUTOFF = "2026-01-01"
MIN_PRIOR_GAMES = 5
# Shrink toward the league, in plate appearances / batters faced. A simulation
# fed unshrunk rates off 20 PA produces confident nonsense for exactly the
# players a board most needs care with.
BATTER_PRIOR_PA = 150.0
PITCHER_PRIOR_BF = 200.0

# (market slug, the simulated tally it maps to). Pure PA outcomes only.
MARKETS = {
    "hits": "H",
    "singles": "1B",
    "home-runs": "HR",
    "total-bases": "TB",
}


def ll(p: float) -> float:
    return -math.log(min(1 - 1e-12, max(1e-12, p)))


def paired_t(a: list[float], b: list[float]) -> tuple[float, float]:
    """Mean difference and its t-statistic. Negative t favours `a`."""
    d = [x - y for x, y in zip(a, b)]
    n = len(d)
    m = sum(d) / n
    if n < 2:
        return m, float("nan")
    var = sum((x - m) ** 2 for x in d) / (n - 1)
    se = math.sqrt(var / n)
    return m, (m / se if se > 0 else float("nan"))


async def load_everything(conn):
    """Batter and pitcher per-game counts, plus the game roster for every date."""
    bat = await conn.fetch("""
        SELECT athlete_id, game_date, event_id, team_id, is_home,
               (stats->>'bat_plateAppearances')::numeric pa,
               (stats->>'bat_hits')::numeric h,
               (stats->>'bat_doubles')::numeric d,
               (stats->>'bat_triples')::numeric t3,
               (stats->>'bat_homeRuns')::numeric hr,
               (stats->>'bat_baseOnBalls')::numeric bb,
               (stats->>'bat_hitByPitch')::numeric hbp,
               (stats->>'bat_strikeOuts')::numeric k
          FROM player_game_history
         WHERE sport='mlb' AND event_id IS NOT NULL
           AND stats ? 'bat_plateAppearances'
           AND (stats->>'bat_plateAppearances')::numeric > 0
         ORDER BY game_date""")
    pit = await conn.fetch("""
        SELECT athlete_id, game_date, event_id, team_id, is_home,
               (stats->>'pit_atBats')::numeric ab,
               (stats->>'pit_hits')::numeric h,
               (stats->>'pit_doubles')::numeric d,
               (stats->>'pit_triples')::numeric t3,
               (stats->>'pit_homeRuns')::numeric hr,
               (stats->>'pit_baseOnBalls')::numeric bb,
               (stats->>'pit_hitByPitch')::numeric hbp,
               (stats->>'pit_strikeOuts')::numeric k,
               COALESCE((stats->>'pit_gamesStarted')::numeric, 0) gs
          FROM player_game_history
         WHERE sport='mlb' AND event_id IS NOT NULL
           AND stats ? 'pit_inningsPitched'
           AND (stats->>'pit_inningsPitched')::numeric > 0
         ORDER BY game_date""")
    return bat, pit


def _bat_counts(r) -> dict:
    f = lambda k: float(r[k] or 0)
    singles = f("h") - f("d") - f("t3") - f("hr")
    return {"1B": max(0.0, singles), "2B": f("d"), "3B": f("t3"), "HR": f("hr"),
            "BB": f("bb"), "HBP": f("hbp"), "K": f("k"), "PA": f("pa")}


def _pit_counts(r) -> dict:
    f = lambda k: float(r[k] or 0)
    singles = f("h") - f("d") - f("t3") - f("hr")
    # Batters faced is not stored; AB + BB + HBP is the standard reconstruction
    # (it omits sacrifices, which this schema does not carry either).
    bf = f("ab") + f("bb") + f("hbp")
    return {"1B": max(0.0, singles), "2B": f("d"), "3B": f("t3"), "HR": f("hr"),
            "BB": f("bb"), "HBP": f("hbp"), "K": f("k"), "PA": bf}


def main() -> int:
    import db
    from predict import count_prop_engine as eng
    from predict import mlb_pa_sim as S
    from predict import mlb_props as mp
    import fit_mlb_props as F

    iters = 10_000
    if "--iters" in sys.argv:
        iters = int(sys.argv[sys.argv.index("--iters") + 1])
    wanted = [a for a in sys.argv[1:] if not a.startswith("--") and a in MARKETS]
    slugs = wanted or list(MARKETS)

    async def run():
        pool = await db.get_pool()
        async with pool.acquire(timeout=3600.0) as conn:
            print("loading rosters and per-game counts ...", flush=True)
            bat, pit = await load_everything(conn)
            print(f"  {len(bat):,} batter-games, {len(pit):,} pitcher-games", flush=True)

            xw = await F.load_crosswalk(conn)
            cals, props, hist = {}, {}, {}
            for slug in slugs:
                row = await conn.fetchrow(
                    "SELECT params_json FROM model_calibration "
                    "WHERE sport='mlb' AND market=$1 AND active=true "
                    "ORDER BY version DESC LIMIT 1", slug)
                if row is None:
                    print(f"  {slug}: no active calibration — skipped")
                    continue
                cals[slug] = json.loads(row["params_json"])
                spec = mp.BY_SLUG[slug]
                hist[slug] = await mp.load_game_history(slug, conn=conn)
                props[slug] = await F.load_props(conn, spec, xw, hist[slug])
                held = [p for p in props[slug] if str(p[0]) >= CUTOFF]
                print(f"  {slug}: {len(held):,} held-out prop rows", flush=True)
        return bat, pit, cals, props, hist

    bat, pit, cals, props, hist = asyncio.run(run())
    if not cals:
        print("nothing to compare")
        return 1

    # ---- which (athlete, date) pairs do we actually need simulated? ---------
    # BOTH ERAS, and the SELECT half is not optional.
    #
    # The direct model's probability comes out of a fitted Platt calibration;
    # the simulation's comes out of raw Monte Carlo frequencies. Comparing those
    # two directly is not a comparison of models, it is a comparison of one
    # calibrated thing against one uncalibrated thing — and the first run showed
    # exactly that, with the simulation biased high on all four markets (hits
    # 0.600 predicted against 0.562 actual, and so on) while the direct model
    # sat within ~1.4pt of the truth everywhere.
    #
    # So the simulation gets the same treatment: its own Platt fitted on the
    # SELECT window and applied to HELD OUT. That needs SELECT-era games
    # simulated too, which roughly doubles the run. Fitting the calibration on
    # the held-out rows themselves would be leakage and would flatter the
    # simulation into a win it had not earned.
    needed: dict[tuple[str, object], list] = defaultdict(list)
    for slug in cals:
        for gd, aid, line, _op, _up, actual in props[slug]:
            needed[(aid, gd)].append((slug, line, actual))
    n_sel = sum(1 for (_a, gd) in needed if str(gd) < CUTOFF)
    print(f"\n{len(needed):,} (athlete, date) pairs need a simulated game "
          f"({n_sel:,} SELECT, {len(needed) - n_sel:,} HELD OUT)", flush=True)

    # ---- walk forward, accumulating each player's prior counts -------------
    def blank():
        return {k: 0.0 for k in ("1B", "2B", "3B", "HR", "BB", "HBP", "K", "PA")} | {"G": 0.0}

    bacc: dict[str, dict] = defaultdict(blank)
    pacc: dict[str, dict] = defaultdict(blank)

    # Index rosters by (date, event) so a game can be assembled at its own date.
    games: dict[object, dict] = defaultdict(
        lambda: {"bat": [], "pit": [], "date": None})
    for r in bat:
        g = games[r["event_id"]]
        g["date"] = r["game_date"]
        g["bat"].append(r)
    for r in pit:
        g = games[r["event_id"]]
        g["date"] = r["game_date"]
        g["pit"].append(r)

    by_date: dict[object, list] = defaultdict(list)
    for ev, g in games.items():
        by_date[g["date"]].append(ev)

    def rates_from(acc: dict, prior: float) -> "S.PaRates":
        return S.PaRates.from_counts(acc, acc["PA"], prior_pa=prior)

    # sim_out[(aid, date)][stat] = list of per-iteration values (as a histogram)
    sim_out: dict[tuple, dict[str, list]] = {}
    league = S.PaRates(S.LEAGUE_PA)

    # Any date carrying a prop row we need, in EITHER era — SELECT games feed
    # the simulation's own calibration, held-out games feed the comparison.
    #
    # EVERY held-out date is simulated, because every held-out row is scored.
    # SELECT dates are SAMPLED: they exist only to fit two Platt parameters, and
    # a few thousand rows determine those as well as forty thousand do. Running
    # the full SELECT era roughly doubled the job for no gain in the answer.
    all_dates = sorted({gd for (_a, gd) in needed})
    held_dates = [d for d in all_dates if str(d) >= CUTOFF]
    sel_dates = [d for d in all_dates if str(d) < CUTOFF]
    keep_every = max(1, len(sel_dates) // 60)      # ~60 SELECT dates
    sel_keep = sel_dates[::keep_every]
    dates_needed = set(held_dates) | set(sel_keep)
    print(f"  simulating {len(held_dates)} held-out dates and "
          f"{len(sel_keep)} of {len(sel_dates)} SELECT dates "
          f"(calibration only)", flush=True)
    dates = sorted(by_date)
    simulated = 0
    for gd in dates:
        if gd in dates_needed:
            for ev in by_date[gd]:
                g = games[ev]
                # Sides
                sides = {True: [], False: []}
                for r in g["bat"]:
                    sides[bool(r["is_home"])].append(r)
                starters = {}
                for r in g["pit"]:
                    if float(r["gs"] or 0) > 0:
                        starters[bool(r["is_home"])] = r
                if len(sides[True]) < 8 or len(sides[False]) < 8:
                    continue
                if True not in starters or False not in starters:
                    continue

                def lineup(rows):
                    # Batting order is not stored. Order by prior PA per game
                    # descending as a proxy — better hitters bat earlier — and
                    # take nine. Slot only affects how many PA a batter gets.
                    scored = []
                    for r in rows:
                        a = bacc.get(str(r["athlete_id"]))
                        ppg = (a["PA"] / a["G"]) if (a and a["G"] > 0) else 0.0
                        scored.append((ppg, r))
                    scored.sort(key=lambda t: -t[0])
                    return [r for _, r in scored[:9]]

                away_rows, home_rows = lineup(sides[False]), lineup(sides[True])
                if len(away_rows) < 9 or len(home_rows) < 9:
                    continue

                def to_rates(rows):
                    out = []
                    for r in rows:
                        a = bacc.get(str(r["athlete_id"]))
                        out.append(rates_from(a, BATTER_PRIOR_PA)
                                   if a and a["G"] >= MIN_PRIOR_GAMES else league)
                    return out

                def pit_rates(r):
                    a = pacc.get(str(r["athlete_id"]))
                    return (rates_from(a, PITCHER_PRIOR_BF)
                            if a and a["G"] >= 3 and a["PA"] > 0 else league)

                res = S.simulate_game(
                    to_rates(away_rows), to_rates(home_rows),
                    pit_rates(starters[False]), pit_rates(starters[True]),
                    n_iter=iters, seed=abs(hash(ev)) % (2**31))
                simulated += 1
                if simulated % 200 == 0:
                    print(f"    simulated {simulated:,} games ...", flush=True)

                for side, rows in (("away", away_rows), ("home", home_rows)):
                    for slot, r in enumerate(rows):
                        key = (str(r["athlete_id"]), gd)
                        if key not in needed:
                            continue
                        # HISTOGRAMS, NOT RAW ITERATIONS. Keeping the per-
                        # iteration values would be 28,306 pairs x 4 stats x
                        # 10,000 draws — over a billion Python ints, which does
                        # not fit. A batter's per-game total is a small integer,
                        # so a count-by-value array carries the same information
                        # in ~10 slots and P(stat > line) reads straight off it.
                        # ONE pass over the iterations, updating all four
                        # histograms together. Four separate passes (plus the
                        # intermediate `tallies` list) roughly doubled the cost
                        # of the whole run — measured at ~4.3s/game against a
                        # ~1s/game simulation, which projected to five hours.
                        # Buckets are clamped rather than grown. Nothing here is
                        # ever asked about a line above ~3.5, so collapsing the
                        # tail loses nothing — and an unbounded inning (no outs,
                        # forever) would otherwise IndexError an hour into a run.
                        hH = [0] * 32
                        h1 = [0] * 32
                        hR = [0] * 32
                        hT = [0] * 64          # total bases reaches higher
                        away = side == "away"
                        for x in res:
                            t = (x.away_bat if away else x.home_bat)[slot]
                            v = t["H"]
                            hH[v if v < 32 else 31] += 1
                            v = t["1B"]
                            h1[v if v < 32 else 31] += 1
                            v = t["HR"]
                            hR[v if v < 32 else 31] += 1
                            v = t["TB"]
                            hT[v if v < 64 else 63] += 1
                        sim_out[key] = {"H": hH, "1B": h1, "HR": hR, "TB": hT}

        # Fold this date's games into history AFTER simulating it.
        for ev in by_date[gd]:
            for r in games[ev]["bat"]:
                a = bacc[str(r["athlete_id"])]
                for k, v in _bat_counts(r).items():
                    a[k] += v
                a["G"] += 1
            for r in games[ev]["pit"]:
                a = pacc[str(r["athlete_id"])]
                for k, v in _pit_counts(r).items():
                    a[k] += v
                a["G"] += 1

    print(f"\nsimulated {simulated:,} held-out games at {iters:,} iterations each",
          flush=True)

    # ---- score both models on identical rows -------------------------------
    diag = defaultdict(lambda: {"n": 0, "p_direct": 0.0, "p_sim": 0.0,
                                "actual": 0, "zero": 0, "one": 0})
    print(f"\n{'market':<16}{'n':>8}{'direct':>11}{'sim':>11}{'delta':>11}{'t':>8}  verdict")
    print("-" * 78)
    overall_d, overall_s = [], []
    for slug in cals:
        cal = cals[slug]
        stat = MARKETS[slug]
        shape = (cal.get("shape_kind", "nb"), cal.get("shape_param"))
        # Rebuild the direct model's projection exactly as the serving pipe does.
        games_h = hist[slug]
        hists: dict[str, "eng.PlayerHistory"] = {}
        idx = 0
        rows_d, rows_s = [], []

        def sim_p(aid_, gd_, line_):
            """Raw Monte Carlo P(stat > line), Laplace-smoothed."""
            h_ = sim_out.get((aid_, gd_), {}).get(stat)
            if h_ is None:
                return None
            n_ = sum(h_)
            k_ = sum(c for v, c in enumerate(h_) if v > line_)
            # LAPLACE, NOT k/N. A count of zero means "below 1/N", not zero, and
            # scoring it as zero costs ll(1e-12)=27.6 on one row — sinking the
            # simulation on sample size rather than merit.
            return (k_ + 1) / (n_ + 2)

        # THE SIMULATION GETS A CALIBRATION TOO, fitted on SELECT only.
        # Without this the comparison pits a Platt-calibrated direct model
        # against raw simulator frequencies, which is not a model comparison.
        sel_pairs = []
        for gd_, aid_, line_, _o, _u, act_ in props[slug]:
            if str(gd_) >= CUTOFF:
                continue
            p_ = sim_p(aid_, gd_, line_)
            if p_ is not None:
                sel_pairs.append((p_, act_ > line_))
        if len(sel_pairs) >= 500:
            sim_a, sim_b = eng.fit_platt(sel_pairs)
        else:
            sim_a, sim_b = 1.0, 0.0
        print(f"  {slug}: simulation calibration fitted on {len(sel_pairs):,} "
              f"SELECT rows -> a={sim_a:.3f} b={sim_b:+.3f}", flush=True)

        held = sorted((p for p in props[slug] if str(p[0]) >= CUTOFF),
                      key=lambda p: p[0])
        # Walk history forward alongside the held-out rows, strictly before.
        for gd, aid, line, _op, _up, actual in held:
            while idx < len(games_h) and games_h[idx][0] < gd:
                _d, a2, ev_, vol_ = games_h[idx]
                hists.setdefault(a2, eng.PlayerHistory()).add(ev_, vol_)
                idx += 1
            h = hists.get(aid)
            key = (aid, gd)
            if h is None or h.games < MIN_PRIOR_GAMES or key not in sim_out:
                continue
            pr = eng.project(h, cal["league_rate"], cal["league_volume"],
                             k=cal["shrink_k"],
                             volume_window=int(cal["volume_window"] or 0))
            raw = eng.shape_prob_over(shape[0], shape[1], line,
                                      pr.expected, pr.projected_volume)
            p_direct = eng.platt(raw, cal["calibration_a"], cal["calibration_b"])
            raw_sim = sim_p(aid, gd, line)
            # The simulation's own Platt, fitted on SELECT above. This is what
            # makes the two models comparable: both now emit a calibrated
            # probability rather than one calibrated and one raw.
            p_sim = eng.platt(raw_sim, sim_a, sim_b)
            hist_ = sim_out[key][stat]
            k = sum(c for v, c in enumerate(hist_) if v > line)
            n_iter_ = sum(hist_)
            hit = actual > line
            diag[slug]["n"] += 1
            diag[slug]["p_direct"] += p_direct
            diag[slug]["p_sim"] += p_sim
            diag[slug]["actual"] += 1 if hit else 0
            if k == 0:
                diag[slug]["zero"] += 1
            if k == n_iter_:
                diag[slug]["one"] += 1
            rows_d.append(ll(p_direct if hit else 1 - p_direct))
            rows_s.append(ll(p_sim if hit else 1 - p_sim))

        if len(rows_d) < 200:
            print(f"{slug:<16}{len(rows_d):>8,}   too few rows — untested, not passing")
            continue
        md, ts = paired_t(rows_s, rows_d)
        d_mean = sum(rows_d) / len(rows_d)
        s_mean = sum(rows_s) / len(rows_s)
        verdict = ("SIM BETTER" if ts < -1.96 else
                   "DIRECT BETTER" if ts > 1.96 else "TIE")
        print(f"{slug:<16}{len(rows_d):>8,}{d_mean:>11.5f}{s_mean:>11.5f}"
              f"{md:>11.5f}{ts:>8.2f}  {verdict}")
        overall_d += rows_d
        overall_s += rows_s

    if overall_d:
        md, ts = paired_t(overall_s, overall_d)
        verdict = ("SIM BETTER" if ts < -1.96 else
                   "DIRECT BETTER" if ts > 1.96 else "TIE")
        print("-" * 78)
        print(f"{'ALL POOLED':<16}{len(overall_d):>8,}"
              f"{sum(overall_d)/len(overall_d):>11.5f}"
              f"{sum(overall_s)/len(overall_s):>11.5f}{md:>11.5f}{ts:>8.2f}  {verdict}")
        print("\n=== CALIBRATION DIAGNOSTIC: is the simulation BIASED or merely NOISY? ===")
        print(f"  {'market':<16}{'mean p_direct':>15}{'mean p_sim':>12}{'actual':>9}"
              f"{'sim=0':>8}{'sim=1':>8}")
        for slug, d in diag.items():
            if not d["n"]:
                continue
            print(f"  {slug:<16}{d['p_direct']/d['n']:>15.4f}{d['p_sim']/d['n']:>12.4f}"
                  f"{d['actual']/d['n']:>9.4f}{d['zero']:>8,}{d['one']:>8,}")
        print("  A mean p far from `actual` is BIAS, which is a real defect.")
        print("  sim=0 / sim=1 count how often the Monte Carlo saturated — that is")
        print("  sample size, and Laplace smoothing is what keeps it from being fatal.")
        print("\nNegative delta and t favour the SIMULATION. The direct model is the")
        print("incumbent: a TIE means the board does not change, because the")
        print("simulation is the more expensive thing to run and maintain.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
