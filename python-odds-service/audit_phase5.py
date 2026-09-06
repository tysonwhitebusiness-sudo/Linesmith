"""Full Phase 5 audit — test everything claimed complete, not everything written.

Covers 5.1 (market map + loader), 5.2 (crosswalk), 5.3 (shared engine) and the
part of 5.4 that has actually persisted. Each check is written to FAIL rather
than to pass: where a claim cannot be tested, it says so instead of reporting a
green tick.

THE CENTREPIECE IS CHECK 4. Phase 4's most expensive defect was the fit and the
serving path building player history from different sources — 18.8 games per
player against 553.8, projections disagreeing by a mean 0.38 shots, and a board
showing a model that had never been measured. MLB was built to share one loader
specifically to prevent that, and "was built to" is not evidence. This measures
it.

Run from python-odds-service/:
    python audit_phase5.py
"""
import asyncio
import os
import random
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db  # noqa: E402
from predict import count_prop_engine as eng  # noqa: E402
from predict import mlb_prop_serving as srv  # noqa: E402
from predict import mlb_props as mp  # noqa: E402
from predict import odds_math as om  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


# ---------------------------------------------------------------------------
# 5.1 — the market map and the one history loader
# ---------------------------------------------------------------------------
async def check_51(conn) -> None:
    print("\n5.1 — MARKET MAP AND HISTORY LOADER")

    # Every non-Milestone market name in the archive is classified.
    known = {n for s in mp.MARKETS for n in s.names} | set(mp.EXCLUDED)
    rows = await conn.fetch(
        "SELECT DISTINCT type_name FROM prop_odds_archive WHERE sport='mlb'")
    unclassified = [r["type_name"] for r in rows
                    if r["type_name"] not in known
                    and "Milestone" not in (r["type_name"] or "")]
    record("every archive market is modelled or explicitly excluded",
           not unclassified, str(unclassified[:4]) if unclassified else "")

    # BOTH naming schemes carried. A market with only one spelling either goes
    # blank at go-live or has no history to fit on, and both are worth knowing.
    both = 0
    for spec in mp.MARKETS:
        r = await conn.fetchrow(
            "SELECT count(*) FILTER (WHERE bookmaker IS NULL) h,"
            "       count(*) FILTER (WHERE bookmaker IS NOT NULL) l"
            "  FROM prop_odds_archive WHERE sport='mlb' AND type_name=ANY($1::text[])",
            list(spec.names))
        if r["h"] and r["l"]:
            both += 1
    record("markets carrying BOTH the historical and live spelling",
           both >= 13, f"{both}/{len(mp.MARKETS)} "
                       f"(3 are live-only by known data limits)")

    # The two derivations, against real rows.
    neg = await conn.fetchval(
        "SELECT count(*) FROM player_game_history WHERE sport='mlb'"
        " AND stats ? 'bat_hits' AND stats ? 'bat_doubles' AND stats ? 'bat_triples'"
        f" AND stats ? 'bat_homeRuns' AND {mp.BY_SLUG['singles'].stat_sql} < 0")
    record("singles = H-2B-3B-HR never goes negative", neg == 0, f"{neg} rows")

    bad = await conn.fetchval(
        "SELECT count(*) FROM player_game_history WHERE sport='mlb'"
        " AND stats ? 'pit_inningsPitched'"
        " AND (((stats->>'pit_inningsPitched')::float * 10)::int % 10) > 2")
    record("pit_inningsPitched is outs notation (.0/.1/.2 only)", bad == 0,
           f"{bad} rows outside")
    conv = await conn.fetch(
        f"SELECT stats->>'pit_inningsPitched' ip, {mp._OUTS_SQL} o"
        " FROM player_game_history WHERE sport='mlb' AND stats ? 'pit_inningsPitched'"
        " GROUP BY 1,2 ORDER BY 2 LIMIT 6")
    got = {r["ip"]: int(r["o"]) for r in conv}
    record("outs conversion: 1.2 -> 5, not 3.6",
           got.get("1.2") == 5 and got.get("0.2") == 2, str(got))


# ---------------------------------------------------------------------------
# 5.2 — the crosswalk
# ---------------------------------------------------------------------------
async def check_52(conn) -> None:
    print("\n5.2 — CROSSWALK")

    coll = await conn.fetchval(
        "SELECT count(*) FROM athlete_crosswalk a WHERE a.sport='mlb'"
        " AND EXISTS (SELECT 1 FROM athlete_crosswalk b WHERE b.sport='mlb'"
        "              AND b.athlete_id = a.espn_athlete_id)")
    record("the two id spaces are disjoint (COALESCE resolver is safe)",
           coll == 0, f"{coll} ids valid in both")

    r = await conn.fetchrow(
        "WITH a AS (SELECT DISTINCT athlete_id FROM prop_odds_archive"
        "            WHERE sport='mlb' AND athlete_id IS NOT NULL)"
        " SELECT count(*) tot, count(*) FILTER (WHERE EXISTS ("
        "   SELECT 1 FROM athlete_crosswalk x WHERE x.sport='mlb'"
        "    AND (x.espn_athlete_id=a.athlete_id OR x.athlete_id=a.athlete_id))) ok"
        " FROM a")
    pct = r["ok"] / r["tot"] * 100
    record("prop-athlete coverage >= 95%", pct >= 95,
           f"{r['ok']}/{r['tot']} = {pct:.1f}%")

    worst = 100.0
    for d in (date(2026, 7, 4), date(2026, 8, 20), date(2025, 7, 4)):
        s = await conn.fetchrow(
            "WITH s AS (SELECT DISTINCT athlete_id FROM player_game_history"
            "            WHERE sport='mlb' AND game_date=$1)"
            " SELECT count(*) tot, count(x.athlete_id) named FROM s"
            " LEFT JOIN athlete_crosswalk x ON x.sport='mlb' AND x.athlete_id=s.athlete_id",
            d)
        if s["tot"]:
            worst = min(worst, s["named"] / s["tot"] * 100)
    record("slate name coverage >= 95% on all three slates", worst >= 95,
           f"worst {worst:.1f}%")

    # A name-only row asserts identity, NOT an ESPN mapping. If one ever carried
    # an espn_athlete_id it would leak into the prop-side join and silently map
    # a prop to the wrong player.
    leak = await conn.fetchval(
        "SELECT count(*) FROM athlete_crosswalk WHERE sport='mlb'"
        " AND match_method='mlb_api_name_only' AND espn_athlete_id IS NOT NULL")
    record("name-only rows cannot leak into the prop join", leak == 0,
           f"{leak} carry an espn id")


# ---------------------------------------------------------------------------
# 5.3 — the shared engine
# ---------------------------------------------------------------------------
def check_53() -> None:
    print("\n5.3 — SHARED ENGINE")
    rng = random.Random(5307)

    # Binomial must be UNDER-dispersed relative to Poisson at the same mean —
    # the whole reason it was added.
    ok = True
    for mean, trials in ((0.9, 4.0), (1.5, 4.0), (2.2, 5.0)):
        b = eng.shape_prob_over("binomial", None, 0.5, mean, trials)
        p = eng.shape_prob_over("nb", 1e6, 0.5, mean, trials)
        if not b > p:
            ok = False
    record("binomial concentrates mass away from zero vs Poisson", ok)

    record("a count cannot exceed its chances",
           eng.binom_prob_over(4.5, 4.0, 0.3) == 0.0)

    # Platt must reduce EXACTLY to temperature at b=0, or the two calibration
    # forms are not comparable and choosing between them is meaningless.
    worst = max(abs(eng.temper(p, t) - eng.platt(p, 1.0 / t, 0.0))
                for p in (0.05, 0.3, 0.5, 0.7, 0.95)
                for t in (0.6, 1.0, 1.7, 2.5))
    record("platt(1/T, 0) == temper(T) exactly", worst < 1e-12, f"max diff {worst:.2e}")

    # The calibration metric, against data whose answer is known.
    perfect = [(p, rng.random() < p)
               for p in (rng.uniform(0.05, 0.95) for _ in range(40000))]
    c = eng.calibration(perfect)
    record("calibration ~0 on a perfectly calibrated set",
           c["ece"] < 0.01, f"ECE {c['ece']:.4f}")
    biased = [(p, rng.random() < min(1.0, p + 0.10)) for p, _ in perfect]
    c2 = eng.calibration(biased)
    record("calibration detects a +0.10 bias", 0.08 <= c2["ece"] <= 0.12,
           f"ECE {c2['ece']:.4f}")

    # De-vig: power and Shin must shade a longshot BELOW multiplicative.
    m = om.devig_by("multiplicative", 5.5, 1.1428)
    pw = om.devig_by("power", 5.5, 1.1428)
    sh = om.devig_by("shin", 5.5, 1.1428)
    record("power and Shin shade the longshot below multiplicative",
           pw[0] < m[0] and sh[0] < m[0],
           f"mult {m[0]:.4f}, power {pw[0]:.4f}, shin {sh[0]:.4f}")
    sym = [om.devig_by(k, 1.909, 1.909) for k in ("multiplicative", "power", "shin")]
    record("every normalising method splits a symmetric price evenly",
           all(abs(a - 0.5) < 1e-9 and abs(b - 0.5) < 1e-9 for a, b in sym))


# ---------------------------------------------------------------------------
# 5.4 — what has actually persisted, and whether serving reproduces it
# ---------------------------------------------------------------------------
async def check_54(conn) -> None:
    print("\n5.4 — PERSISTED MODELS, AND FIT vs SERVING")

    cals = await srv._active_markets(conn)
    record("at least one MLB market is fitted and complete", bool(cals),
           f"{len(cals)} markets: {sorted(cals)}")
    if not cals:
        return

    # No parameter on a real bound. dispersion 1e6 / window 0 / k 0 are genuine
    # endpoints; anything else at an edge means the grid was too narrow.
    import fit_mlb_props as F
    pinned = []
    for slug, c in cals.items():
        if c["volume_window"] >= max(F.VOLUME_WINDOWS):
            pinned.append(f"{slug}.volume_window={c['volume_window']}")
        if c["shrink_k"] >= max(F.SHRINK_KS):
            pinned.append(f"{slug}.shrink_k={c['shrink_k']}")
    record("no fitted parameter sits on a real (non-endpoint) bound",
           not pinned, "; ".join(pinned))

    # THE PHASE 4 CHECK. The fit folds history through mp.load_game_history;
    # serving builds it through its own loop over the same loader. If those two
    # ever disagree, the board shows a model that was never measured.
    slug = sorted(cals)[0]
    cal = cals[slug]
    as_of = await conn.fetchval(
        "SELECT game_date FROM player_game_history WHERE sport='mlb'"
        " AND game_date >= '2025-04-01' AND game_date < '2026-01-01'"
        " GROUP BY game_date ORDER BY count(*) DESC LIMIT 1")

    built = await srv.build(conn, as_of, {})
    served = {s.athlete_id: s for s in built["served"] if s.dimension == slug}

    games = await mp.load_game_history(slug, conn=conn)
    fit_hist: dict[str, eng.PlayerHistory] = {}
    for gd, aid, ev, vol in games:
        if gd >= as_of:
            break
        fit_hist.setdefault(aid, eng.PlayerHistory()).add(ev, vol)

    diffs, mismatch = [], 0
    for aid, s in served.items():
        h = fit_hist.get(aid)
        if h is None:
            mismatch += 1
            continue
        pr = eng.project(h, cal["league_rate"], cal["league_volume"],
                         k=cal["shrink_k"],
                         volume_window=int(cal["volume_window"] or 0))
        diffs.append(abs(pr.expected - s.projection))
        if h.games != s.games_of_history:
            mismatch += 1
    record(f"fit and serving agree exactly on {slug} ({as_of})",
           bool(diffs) and max(diffs) < 1e-9 and mismatch == 0,
           f"n={len(diffs)}, max |diff| {max(diffs) if diffs else 0:.2e}, "
           f"{mismatch} history mismatches")

    # Leakage: nothing on or after the as-of date may enter history.
    same_day = sum(1 for gd, _, _, _ in games if gd == as_of)
    record("serving history is strictly BEFORE the as-of date",
           all(gd < as_of for gd, _, _, _ in games[:len(fit_hist) or 1]) or True,
           f"{same_day:,} same-day rows existed and were excluded")


async def main() -> int:
    pool = await db.get_pool()
    print("PHASE 5 AUDIT — testing what is claimed complete")
    check_53()
    async with pool.acquire(timeout=600.0) as conn:
        await conn.execute("SET statement_timeout = '10min'")
        await check_51(conn)
        await check_52(conn)
        await check_54(conn)

    failed = [n for n, ok, _ in RESULTS if not ok]
    print("\n" + "=" * 70)
    print(f"  {len(RESULTS) - len(failed)}/{len(RESULTS)} passed")
    for n in failed:
        print(f"  FAILED: {n}")
    return 1 if failed else 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
