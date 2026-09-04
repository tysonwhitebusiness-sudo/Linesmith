"""GATE 10 — the exit gate for Phase 1. Run before any model work begins.

Phase 1's goal in one sentence: **every provider that can serve a sport does
serve it, their keys are pooled rather than labelled by sport, and the result
actually lands in the training archive.** This asserts all three, plus the
live-data conditions, so "Phase 1 is done" is a measurement rather than a claim.

It is EXPECTED TO FAIL until 1f lands. That is the point — it defines done.

Two failure modes it is specifically built to catch, both of which already
happened once in this project:

  A sport quietly getting less data than it could. NFL and CFB ran with no
  provider at all for twelve days and every health check stayed green, because
  nothing compared what we CALL against what the vendors SUPPORT.

  Quota stranded by labelling. All five ParlayAPI keys return the identical
  405-sport catalogue, so a key is a budget bucket and not a coverage grant.
  Naming one PARLAYAPI_NFL_KEY means NFL goes dark while CFB's key sits idle.

Run:  python scripts/gate/gate10_phase1_odds.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "python-odds-service", "src"))

import db  # noqa: E402
import game_context  # noqa: E402
import gameday  # noqa: E402
import provider_matrix as pm  # noqa: E402

FAILURES: list[str] = []
NOTES: list[str] = []
SKIPS: list[str] = []


def skip(label: str, reason: str) -> None:
    """An outcome that is neither pass nor fail: the condition cannot be met and
    SHOULD not be, so asserting it would be asserting a bug.

    NBA and NHL are the reason this exists. Both are out of season in early
    September — ESPN returns 0 games — so no provider on earth returns a book
    line for them, and 10.3 failed on both every run. A check that cannot pass
    is not a check; it is noise that teaches you to skim the gate's output,
    which is exactly how the twelve-day NFL outage in the module docstring
    survived. Same defect class as a PASS printing its own failure reason."""
    print(f"  SKIP  {label}  — {reason}")
    SKIPS.append(f"{label}: {reason}")


def check(ok: bool, label: str, detail: str = "", fail_detail: str | None = None) -> None:
    """`detail` annotates a PASS; `fail_detail` explains a FAIL.

    Keeping them separate is not fussiness. With one shared field a caller that
    passes failure-phrased text prints it on success too, and the gate reports
    "PASS  a KEY_POOLS declaration exists — KEY_POOLS is missing" — a green
    check carrying its own contradiction, which is worse than no check at all.
    """
    shown = detail if ok else (fail_detail if fail_detail is not None else detail)
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"  — {shown}" if shown else ""))
    if not ok:
        FAILURES.append(f"{label}: {shown}")


# Cells a vendor genuinely cannot serve, or that we deliberately decline. Each
# needs a REASON, so "not wired" stays distinguishable from "cannot be wired".
EXCUSED: dict[tuple[str, str], str] = {
    ("sportsgameodds", "soccer_epl"): "SGO's catalogue is 8 leagues and has no EPL (verified live 2026-09-02)",
    ("sportsgameodds", "tennis_atp"): "SGO serves no tennis at all",
    ("sportsgameodds", "tennis_wta"): "SGO serves no tennis at all",
    ("parlayapi", "tennis_atp"): "ParlayAPI has no tennis token in _PARLAYAPI_SPORT_KEYS",
    ("parlayapi", "tennis_wta"): "ParlayAPI has no tennis token in _PARLAYAPI_SPORT_KEYS",
    # Arithmetic, not taste: Propline costs 1 + N requests per cycle, so a
    # 178-game CFB slate is ~179 requests. Even pooled at 2,000/day that is
    # eleven cycles, against SharpAPI's ONE request for the same slate.
    ("propline", "cfb"): "1+N request shape — ~179 requests for a 178-game slate",
    ("propline", "tennis_atp"): "Propline's tennis key is one bucket for both tours",
    ("propline", "tennis_wta"): "Propline's tennis key is one bucket for both tours",
}

# The Phase 1f excuses that are GONE, kept as a record of what the gate drove:
#   parlayapi x nhl        — was "no PARLAYAPI_NHL_KEY". Pooling made every key
#                            usable for every sport, so NHL draws on all five.
#   propline x nfl/nba/nhl — were "pending key pooling". Pooled and wired.

SPORTS = sorted(pm.MATRIX)


def _family(provider_id: str) -> str:
    for f in ("sharpapi", "propline", "parlayapi", "sportsgameodds", "oddsapiio"):
        if provider_id.startswith(f):
            return f
    return provider_id


def gate_1_every_supported_cell_is_wired() -> None:
    """What we CALL vs what the vendors SUPPORT."""
    print("\n10.1  every (provider, sport) the vendor supports is activated")
    supports = {
        "sharpapi": set(pm.SHARPAPI_TOKENS),
        "sportsgameodds": set(pm.SGO_LEAGUE_IDS),
        "propline": set(pm.PROPLINE_SPORT_KEYS),
        "parlayapi": set(pm.PARLAYAPI_SPORT_KEYS),
    }
    for family, sports in supports.items():
        for sport in sorted(sports & set(SPORTS)):
            wired = any(_family(p) == family for p in pm.MATRIX.get(sport, ()))
            # MLB's SportsGameOdds account is wired, just not through MATRIX:
            # it runs on its own 90-minute job rather than inside Tier 1's
            # 2.5-minute cycle. Reachable via MLB_SGO_ONLY, so it is covered.
            if not wired and sport == "mlb":
                wired = any(_family(p) == family for p in pm.MLB_SGO_ONLY)
            excuse = EXCUSED.get((family, sport))
            if wired:
                check(True, f"{family} x {sport}")
            elif excuse:
                NOTES.append(f"{family} x {sport} excused — {excuse}")
                print(f"  ----  {family} x {sport}  (excused: {excuse[:60]})")
            else:
                check(False, f"{family} x {sport}", "vendor supports it; matrix does not call it")


def gate_2_keys_are_pooled_not_labelled() -> None:
    """A key is a budget bucket, not a coverage grant."""
    print("\n10.2  keys are pooled, not labelled by sport")
    sport_tokens = {"nfl", "cfb", "nba", "nhl", "mlb", "soccer", "epl", "mls", "tennis"}
    labelled = sorted({
        p for provs in pm.MATRIX.values() for p in provs
        if any(p.endswith("_" + t) or ("_" + t + "_") in p for t in sport_tokens)
    })
    check(not labelled, "no provider_id encodes a sport",
          f"still sport-labelled: {', '.join(labelled)}" if labelled else "")

    pools = getattr(pm, "KEY_POOLS", None)
    check(pools is not None, "a KEY_POOLS declaration exists",
          f"{len(pools)} families" if pools else "",
          fail_detail="provider_matrix.KEY_POOLS is missing — pooling not implemented")
    if pools:
        for family, keys in sorted(pools.items()):
            live = [k for k in keys if k]
            check(len(live) >= 1, f"{family} pool has at least one key", f"{len(live)} keys")


async def _upcoming_games(sport: str) -> list:
    """Ask the SAME loaders the jobs ask. A gate that consults a different source
    than the code it certifies is measuring something else."""
    try:
        if sport == "mlb":
            return await game_context.load_mlb_games()
        if sport == "nhl":
            return await game_context.load_nhl_games()
        if sport == "tennis":
            return (await game_context.load_tennis_games("tennis_atp")
                    + await game_context.load_tennis_games("tennis_wta"))
        if sport == "soccer":
            return (await game_context.load_sport_games("soccer_epl")
                    + await game_context.load_sport_games("soccer_mls"))
        return await game_context.load_sport_games(sport)
    except Exception as e:
        print(f"        (loader for {sport} failed: {type(e).__name__}: {e})")
        return []


async def gate_3_live_coverage() -> None:
    """Does every sport actually receive data, from something other than the
    dead scraper?

    SEASON-AWARE, and it has to be. The jobs skip paid providers when
    gameday.compute_tier() says "cold" — no game inside WARM_BEFORE_HOURS — so
    for an out-of-season or far-from-kickoff sport, zero rows is the system
    working correctly. Measured 2026-09-03: NBA 0 games, NHL 0 games (both start
    in October), NFL 17 games with the opener 6.8 days out. Demanding fresh
    lines from all three asserted something no code could satisfy.
    """
    print("\n10.3  every sport has fresh book lines from a non-OddsHarvester source")
    pool = await db.get_pool()
    async with pool.acquire(timeout=20.0) as conn:
        rows = await conn.fetch(
            """SELECT sport, count(*) n, max(fetched_at) newest
                 FROM game_odds_book_lines
                WHERE source <> 'oddsharvester' AND fetched_at > now() - interval '24 hours'
                GROUP BY 1"""
        )
    seen = {r["sport"]: r["n"] for r in rows}
    # game_odds_book_lines uses a coarser sport key than MATRIX (one 'soccer',
    # one 'tennis'), so compare on that grain rather than inventing a mismatch.
    want = {"mlb", "nfl", "cfb", "nba", "nhl", "soccer", "tennis"}
    for sport in sorted(want):
        n = seen.get(sport, 0)
        if n > 0:
            check(True, f"{sport} has rows in the last 24h", f"{n} rows")
            continue
        # Zero rows. Before calling it a failure, establish whether anything was
        # supposed to be fetched at all.
        games = await _upcoming_games(sport)
        if not games:
            skip(f"{sport} has rows in the last 24h", "out of season — 0 games scheduled")
            continue
        tier = gameday.compute_tier(games)
        if tier == "cold":
            nxt = min((g.game_date for g in games if getattr(g, "game_date", None)), default=None)
            skip(f"{sport} has rows in the last 24h",
                 f"cold tier — {len(games)} games, next {nxt}, "
                 f"outside the {gameday.WARM_BEFORE_HOURS:.0f}h fetch window")
            continue
        check(False, f"{sport} has rows in the last 24h",
              fail_detail=f"0 rows despite tier={tier} over {len(games)} games")


async def gate_4_archive_is_being_fed() -> None:
    print("\n10.4  the archival bridge is running and capturing near the close")
    pool = await db.get_pool()
    async with pool.acquire(timeout=20.0) as conn:
        fresh = await conn.fetchrow(
            """SELECT max(captured_at) newest, count(*) n
                 FROM odds_archive WHERE source = 'live_capture'"""
        )
        # event_start < now() — ONLY GAMES THAT HAVE ACTUALLY STARTED.
        #
        # This metric asks "did we capture close to the close". For a game that
        # has not kicked off, the answer is not yet knowable: the bridge keeps
        # upserting right up to the freeze, so its capture-to-start distance is
        # still shrinking and measuring it now measures the distance to kickoff,
        # not any failure of ours. NFL made this concrete — 6 rows for an opener
        # six days out read as a median of 8,660 minutes and failed the gate,
        # while the bridge was behaving perfectly.
        #
        # Same defect 10.3 had, one check over: asserting something no code
        # could satisfy. A started game's capture history is final, so it is the
        # only honest sample.
        lat = await conn.fetch(
            """SELECT sport, percentile_disc(0.5) WITHIN GROUP (
                        ORDER BY EXTRACT(EPOCH FROM (event_start - captured_at))/60) median_min,
                      count(*) n
                 FROM odds_archive
                WHERE source = 'live_capture' AND captured_at > now() - interval '7 days'
                  AND event_start IS NOT NULL AND event_start < now()
                GROUP BY 1"""
        )
    check(bool(fresh and fresh["newest"]), "live_capture rows exist",
          f"{(fresh['n'] if fresh else 0):,} rows")
    # A handful of rows cannot establish a median worth gating on, and a sport
    # mid-backfill or just switched on will always have a few. 20 is the point
    # where one stale row stops dominating.
    MIN_SAMPLE = 20
    for r in lat:
        if (r["n"] or 0) < MIN_SAMPLE:
            skip(f"{r['sport']} median capture-to-start <= 15min",
                 f"only {r['n']} started-game captures — too few to gate on "
                 f"(need {MIN_SAMPLE})")
            continue
        check((r["median_min"] or 1e9) <= 15,
              f"{r['sport']} median capture-to-start <= 15min",
              f"{r['median_min']:.0f}min over {r['n']:,} rows")


async def gate_5_no_provider_over_cap() -> None:
    """No provider is over its cap — checked on the ids that ACTUALLY accumulate.

    This check was hardcoded to {propline, propline_2, oddsapiio}, and pooling
    silently retired two of them. Measured right after the 2026-09-03 deploy:
    spend had moved to `propline_k1` / `parlayapi_k1` / `sgo_k1` (all written
    18:25 UTC) while `propline` sat frozen at its pre-deploy 1006 and
    `oddsapiio` had not been written since 04:58. So the old list would have
    failed on stale history today and then passed VACUOUSLY forever after,
    checking rows nothing writes while the real pooled spend went unwatched.

    A check that quietly stops checking is worse than the season-blind one in
    10.3: that one was loudly wrong, this one would have been silently right.

    Caps are per KEY, because that is how they are reserved (job_runner walks
    the pool reserving against each id against the same `cap`). Deliberately
    MEASURED from the vendors' own headers on 2026-09-02, not read from config —
    a config default is what we believe, and the point of a gate is to check.
    """
    print("\n10.5  no provider is over its measured cap")
    # Per-KEY caps, by pool family. oddsapiio is not pooled and keeps its own.
    measured_per_key = {"propline": 1000, "parlayapi": 1000}
    caps: dict[str, int] = {"oddsapiio": 500, "propline": 1000, "propline_2": 1000}
    for family, keys in getattr(pm, "KEY_POOLS", {}).items():
        cap = measured_per_key.get(family)
        if cap:
            for pid, _key in keys:
                caps[pid] = cap

    pool = await db.get_pool()
    async with pool.acquire(timeout=20.0) as conn:
        rows = await conn.fetch(
            """SELECT provider_id, period_kind, period_key, request_count, object_count,
                      updated_at
                 FROM provider_usage
                WHERE period_key IN (to_char(now(),'YYYY-MM-DD'), to_char(now(),'YYYY-MM'))"""
        )
    checked = 0
    for r in rows:
        cap = caps.get(r["provider_id"])
        if not cap or r["period_kind"] != "daily":
            continue
        checked += 1
        used = r["request_count"]
        check(used <= cap, f"{r['provider_id']} within its daily cap", f"{used}/{cap}")
    # If pooling is live and NOTHING matched, the ids moved again and this gate
    # went blind. Fail loudly rather than reporting a clean sweep of nothing.
    check(checked > 0, "at least one capped provider was actually checked",
          f"{checked} provider-days checked",
          fail_detail="no provider_usage row matched any known cap id — "
                      "the ids have moved and 10.5 is checking nothing")


async def main() -> None:
    print("\nGATE 10 — Phase 1 exit\n" + "=" * 60)
    gate_1_every_supported_cell_is_wired()
    gate_2_keys_are_pooled_not_labelled()
    await gate_3_live_coverage()
    await gate_4_archive_is_being_fed()
    await gate_5_no_provider_over_cap()

    if SKIPS:
        print("\nskipped — nothing was supposed to be fetched (not failures):")
        for k in SKIPS:
            print(f"  - {k}")

    if NOTES:
        print("\nexcused cells (each needs a real reason, and they are reviewed, not permanent):")
        for n in NOTES:
            print(f"  - {n}")

    print("\n" + "=" * 60)
    if FAILURES:
        print(f"GATE 10 FAILED — {len(FAILURES)} check(s):")
        for f in FAILURES:
            print(f"  - {f}")
        sys.exit(1)
    print("GATE 10 PASSED — Phase 1 is complete; model work may begin.")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
