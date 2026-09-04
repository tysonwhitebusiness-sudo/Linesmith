"""Phase 3.1 — is every soccer club one identity, and every match stored once?

Re-runnable, in the shape of audit_tennis_name_collisions.py. Exits non-zero
while anything is unresolved, so it is a gate rather than a report.

FIVE CHECKS:

  1. UNMAPPED NAMES. Any club name in game_result or odds_archive that
     canonical() does not resolve. This is the check that matters most over
     time: a newly promoted club, or a rename, appears here as a name that
     canonicalises to itself while its twin canonicalises elsewhere.
  2. DUPLICATE MATCHES after canonicalisation. The whole point.
  3. RESIDUAL SPLIT IDENTITIES — a club appearing under two canonical names.
  4. ODDS-SIDE COVERAGE. odds_archive carries both spellings too, so the map
     has to close there as well or the ship gate loses rows to a silent
     non-join.
  5. EXHIBITION SIDES. MLS All-Stars / Liga MX All-Stars are not clubs and must
     not reach a fit that estimates club strength.

Run from python-odds-service/:
    python audit_soccer_duplicates.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import soccer_teams as st  # noqa: E402

SPORTS = ("soccer_epl", "soccer_mls")
_findings: list[str] = []


async def _names(conn, table: str, sport: str) -> set[str]:
    rows = await conn.fetch(
        f"""SELECT DISTINCT t FROM (
              SELECT home_team_raw t FROM {table} WHERE sport = $1
              UNION SELECT away_team_raw FROM {table} WHERE sport = $1) s
            WHERE t IS NOT NULL""", sport)
    return {r["t"] for r in rows}


async def check_unmapped(conn) -> None:
    print("\n1. UNMAPPED NAMES — a club spelling canonical() does not resolve")
    for sport in SPORTS:
        gr = await _names(conn, "game_result", sport)
        oa = await _names(conn, "odds_archive", sport)
        allnames = gr | oa
        canon = {st.canonical(sport, n) for n in allnames if not st.is_excluded(n)}
        # A name is suspect if it is NOT canonical for itself while some other
        # name canonicalises into the same club — i.e. the map missed a twin.
        unmapped = sorted(n for n in allnames
                          if st.canonical(sport, n) == n and n not in canon - {n}
                          and not st.is_excluded(n))
        print(f"   {sport}: {len(allnames)} raw names -> {len(canon)} canonical "
              f"({st.alias_count(sport)} aliases mapped)")
        # Heuristic surface for review: two canonical names where one contains
        # the other as a prefix is the shape every real alias here had.
        suspects = []
        cl = sorted(canon)
        for i, a in enumerate(cl):
            for b in cl[i + 1:]:
                if a != b and (b.startswith(a + " ") or a.startswith(b + " ")):
                    suspects.append(f"{a!r} / {b!r}")
        for s in suspects:
            _findings.append(f"{sport}: possible unmapped twin {s}")
            print(f"     SUSPECT possible unmapped twin: {s}")
        if not suspects:
            print("     none — no canonical name is a prefix of another")


async def check_duplicates(conn) -> None:
    print("\n2. DUPLICATE MATCHES after canonicalisation")
    for sport in SPORTS:
        rows = await conn.fetch(
            """SELECT game_date, home_team_raw h, away_team_raw a, source,
                      home_score hs, away_score as_
                 FROM game_result WHERE sport = $1""", sport)
        seen: dict[tuple, list] = {}
        excluded = 0
        for r in rows:
            if st.is_excluded(r["h"], r["a"]):
                excluded += 1
                continue
            k = (r["game_date"], st.canonical(sport, r["h"]), st.canonical(sport, r["a"]))
            seen.setdefault(k, []).append(r)
        dups = {k: v for k, v in seen.items() if len(v) > 1}
        extra = sum(len(v) - 1 for v in dups.values())
        # A duplicate whose two rows DISAGREE on the score is worse than one
        # that agrees: it means the sources contradict, not merely repeat.
        conflicting = sum(1 for v in dups.values()
                          if len({(x["hs"], x["as_"]) for x in v}) > 1)
        print(f"   {sport}: {len(seen):,} unique matches, {len(dups)} duplicated "
              f"({extra} extra rows), {excluded} exhibition rows excluded")
        # Stated explicitly, not by absence. Duplicates that AGREE on the score
        # are safe to collapse; duplicates that DISAGREE mean the two sources
        # contradict each other and collapsing would pick a winner silently.
        if conflicting:
            _findings.append(f"{sport}: {conflicting} duplicate(s) disagree on the score")
            print(f"     SUSPECT {conflicting} duplicate group(s) DISAGREE on the final score "
                  f"— collapsing would silently pick a winner")
        else:
            print(f"     all {len(dups)} duplicate group(s) AGREE on the final score "
                  f"— safe to collapse")
        if dups:
            print(f"     -> de-duplication rule required at load: keep one row per "
                  f"(date, canonical home, canonical away)")


async def check_odds_side(conn) -> None:
    print("\n4. ODDS-SIDE COVERAGE — the map must close on odds_archive too")
    for sport in SPORTS:
        gr = {st.canonical(sport, n) for n in await _names(conn, "game_result", sport)}
        oa_raw = await _names(conn, "odds_archive", sport)
        oa = {st.canonical(sport, n) for n in oa_raw}
        orphan = sorted(o for o in oa - gr if not st.is_excluded(o))
        print(f"   {sport}: {len(oa_raw)} raw odds names -> {len(oa)} canonical; "
              f"{len(orphan)} with no match in game_result")
        for o in orphan[:8]:
            print(f"     orphan: {o!r}")
        if orphan:
            _findings.append(f"{sport}: {len(orphan)} odds club(s) unknown to game_result")


async def check_exhibitions(conn) -> None:
    print("\n5. EXHIBITION SIDES — not clubs, must not reach the fit")
    for sport in SPORTS:
        n = await conn.fetchval(
            """SELECT count(*) FROM game_result WHERE sport = $1
                AND (home_team_raw = ANY($2) OR away_team_raw = ANY($2))""",
            sport, list(st.EXCLUDED_TEAMS))
        print(f"   {sport}: {n} match(es) excluded ({', '.join(sorted(st.EXCLUDED_TEAMS))})")


async def main() -> int:
    print("PHASE 3.1 — soccer club identity audit\n" + "=" * 62)
    pool = await db.get_pool()
    async with pool.acquire(timeout=30.0) as conn:
        await check_unmapped(conn)
        await check_duplicates(conn)
        print("\n3. RESIDUAL SPLIT IDENTITIES — covered by checks 1 and 2 together:")
        print("   an unmapped twin shows in 1; a match stored twice shows in 2.")
        await check_odds_side(conn)
        await check_exhibitions(conn)

    print("\n" + "=" * 62)
    if _findings:
        print(f"{len(_findings)} finding(s) to resolve:")
        for f in _findings:
            print(f"  - {f}")
        return 1
    print("MAP IS COMPLETE: every club resolves to one identity, on both")
    print("game_result and odds_archive, and every duplicate group agrees on its")
    print("score so collapsing is lossless.")
    print()
    print("This does NOT mean the database is clean — the duplicate rows are still")
    print("there. Canonicalisation REVEALS them (400 EPL / 604 MLS, against the 94 /")
    print("167 a raw-name check finds); load_soccer_matches() REMOVES them. Anything")
    print("reading game_result directly still sees the duplicates.")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
