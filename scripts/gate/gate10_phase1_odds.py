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
import provider_matrix as pm  # noqa: E402

FAILURES: list[str] = []
NOTES: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"  — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(f"{label}: {detail}")


# Cells a vendor genuinely cannot serve, or that we deliberately decline. Each
# needs a REASON, so "not wired" stays distinguishable from "cannot be wired".
EXCUSED: dict[tuple[str, str], str] = {
    ("sportsgameodds", "soccer_epl"): "SGO's catalogue is 8 leagues and has no EPL (verified live 2026-09-02)",
    ("sportsgameodds", "tennis_atp"): "SGO serves no tennis at all",
    ("sportsgameodds", "tennis_wta"): "SGO serves no tennis at all",
    ("parlayapi", "nhl"): "no PARLAYAPI_NHL_KEY provisioned — a provisioning gap, not a capability one",
    ("parlayapi", "tennis_atp"): "ParlayAPI has no tennis token in _PARLAYAPI_SPORT_KEYS",
    ("parlayapi", "tennis_wta"): "ParlayAPI has no tennis token in _PARLAYAPI_SPORT_KEYS",
    ("propline", "cfb"): "1+N request shape: a 178-game slate is ~179 requests against 1,000/day",
    ("propline", "nfl"): "pending key pooling — see 1f",
    ("propline", "nba"): "pending key pooling — see 1f",
    ("propline", "nhl"): "pending key pooling — see 1f",
    ("propline", "tennis_atp"): "pending key pooling — see 1f",
    ("propline", "tennis_wta"): "pending key pooling — see 1f",
}

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
          "provider_matrix.KEY_POOLS is missing — pooling not implemented")
    if pools:
        for family, keys in sorted(pools.items()):
            live = [k for k in keys if k]
            check(len(live) >= 1, f"{family} pool has at least one key", f"{len(live)} keys")


async def gate_3_live_coverage() -> None:
    """Does every sport actually receive data, from something other than the
    dead scraper?"""
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
        check(seen.get(sport, 0) > 0, f"{sport} has rows in the last 24h",
              f"{seen.get(sport, 0)} rows")


async def gate_4_archive_is_being_fed() -> None:
    print("\n10.4  the archival bridge is running and capturing near the close")
    pool = await db.get_pool()
    async with pool.acquire(timeout=20.0) as conn:
        fresh = await conn.fetchrow(
            """SELECT max(captured_at) newest, count(*) n
                 FROM odds_archive WHERE source = 'live_capture'"""
        )
        lat = await conn.fetch(
            """SELECT sport, percentile_disc(0.5) WITHIN GROUP (
                        ORDER BY EXTRACT(EPOCH FROM (event_start - captured_at))/60) median_min,
                      count(*) n
                 FROM odds_archive
                WHERE source = 'live_capture' AND captured_at > now() - interval '7 days'
                  AND event_start IS NOT NULL
                GROUP BY 1"""
        )
    check(bool(fresh and fresh["newest"]), "live_capture rows exist",
          f"{(fresh['n'] if fresh else 0):,} rows")
    for r in lat:
        check((r["median_min"] or 1e9) <= 15,
              f"{r['sport']} median capture-to-start <= 15min",
              f"{r['median_min']:.0f}min over {r['n']:,} rows")


async def gate_5_no_provider_over_cap() -> None:
    print("\n10.5  no provider is over its measured cap")
    pool = await db.get_pool()
    async with pool.acquire(timeout=20.0) as conn:
        rows = await conn.fetch(
            """SELECT provider_id, period_kind, period_key, request_count, object_count
                 FROM provider_usage
                WHERE period_key IN (to_char(now(),'YYYY-MM-DD'), to_char(now(),'YYYY-MM'))"""
        )
    # Measured 2026-09-02, from the vendors' own headers — not config defaults.
    caps = {"propline": 1000, "propline_2": 1000, "oddsapiio": 500}
    for r in rows:
        cap = caps.get(r["provider_id"])
        if cap and r["period_kind"] == "daily":
            used = r["request_count"]
            check(used <= cap, f"{r['provider_id']} within its daily cap", f"{used}/{cap}")


async def main() -> None:
    print("\nGATE 10 — Phase 1 exit\n" + "=" * 60)
    gate_1_every_supported_cell_is_wired()
    gate_2_keys_are_pooled_not_labelled()
    await gate_3_live_coverage()
    await gate_4_archive_is_being_fed()
    await gate_5_no_provider_over_cap()

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
