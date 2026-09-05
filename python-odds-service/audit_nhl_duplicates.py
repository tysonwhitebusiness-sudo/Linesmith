"""Phase 4.1 — is every NHL franchise one identity, and every game stored once?

Re-runnable, in the shape of audit_soccer_duplicates.py. Exits non-zero while
anything is unresolved, so it is a gate rather than a report.

SIX CHECKS:

  1. FRANCHISE COUNT. The NHL has 32 clubs. Any other number after
     canonicalisation means the map is wrong in one direction or the other, and
     it is the single cheapest assertion available here — soccer had no
     equivalent, because EPL's club count changes with promotion.
  2. UNMAPPED NAMES / PREFIX TWINS. A newly renamed or relocated club shows up
     as a canonical name that is a prefix of, or suffixed variant of, another.
  3. DUPLICATE GAMES after canonicalisation, and whether the duplicates AGREE
     on the score. Agreement makes collapsing lossless; disagreement means the
     sources contradict and a collapse would silently pick a winner.
  4. ODDS-SIDE CLOSURE. odds_archive AND odds_import_staging both carry team
     names; the map has to close on both or the ship gate loses rows to a
     silent non-join rather than an error.
  5. NON-CLUB ENTITIES. National sides and All-Star rosters must be excluded.
  6. WHITESPACE COLLAPSE. 'LosAngeles' and 'Los Angeles' must not both survive.

Run from python-odds-service/:
    python audit_nhl_duplicates.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402
from predict import nhl_teams as nt  # noqa: E402

NHL_FRANCHISES = 32
_findings: list[str] = []


async def _names(conn, table: str) -> set[str]:
    rows = await conn.fetch(
        f"""SELECT DISTINCT t FROM (
              SELECT home_team_raw t FROM {table} WHERE sport = 'nhl'
              UNION SELECT away_team_raw FROM {table} WHERE sport = 'nhl') s
            WHERE t IS NOT NULL""")
    return {r["t"] for r in rows}


async def main() -> int:
    print("PHASE 4.1 — NHL franchise identity audit\n" + "=" * 64)
    pool = await db.get_pool()
    async with pool.acquire(timeout=60.0) as conn:
        games = await nt.load_nhl_games(conn)
        teams = {m["home"] for m in games} | {m["away"] for m in games}

        print(f"\n1. FRANCHISE COUNT — the NHL has {NHL_FRANCHISES}")
        print(f"   {len(teams)} after canonicalisation "
              f"({nt.alias_count()} aliases mapped)")
        if len(teams) != NHL_FRANCHISES:
            _findings.append(f"{len(teams)} franchises, expected {NHL_FRANCHISES}")
            print(f"   SUSPECT expected {NHL_FRANCHISES}: {sorted(teams)}")
        else:
            print("   correct")

        print("\n2. PREFIX / VARIANT TWINS among canonical names")
        cl = sorted(teams)
        sus = [f"{a!r} / {b!r}" for i, a in enumerate(cl) for b in cl[i + 1:]
               if b.startswith(a) or a.startswith(b)
               or b.replace(" ", "") == a.replace(" ", "")]
        for s in sus:
            _findings.append(f"possible unmapped twin {s}")
            print(f"   SUSPECT {s}")
        if not sus:
            print("   none — no canonical name is a prefix or spacing variant of another")

        print("\n3. DUPLICATE GAMES after canonicalisation")
        raw = await conn.fetch(
            """SELECT game_date, home_team_raw h, away_team_raw a, home_score hs,
                      away_score a_s, event_ref FROM game_result WHERE sport = 'nhl'""")
        seen: dict[tuple, list] = {}
        excluded = 0
        for r in raw:
            if nt.is_excluded(r["h"], r["a"]):
                excluded += 1
                continue
            k = (r["game_date"], nt.canonical(r["h"]), nt.canonical(r["a"]))
            seen.setdefault(k, []).append(r)
        dups = {k: v for k, v in seen.items() if len(v) > 1}

        # TWO REAL GAMES vs A GENUINE CONFLICT — this distinction is the whole
        # value of the check. Six groups here disagree on the score, and all six
        # turned out to be DISTINCT games sharing a date: Carolina v Dallas on
        # 2021-01-31 carries event_refs 401272220 (4-1) and 401272230 (4-3), in
        # the COVID-shortened 2020-21 season. Treating them as duplicates would
        # have deleted a real game and called it de-duplication.
        #
        # A group with more than one non-null event_ref is therefore FINE. A
        # group that disagrees on the score WITHOUT distinct refs is a real
        # source conflict and blocks.
        multi_ref = {k: v for k, v in dups.items()
                     if len({x["event_ref"] for x in v if x["event_ref"] is not None}) > 1}
        conflicting = {k: v for k, v in dups.items()
                       if k not in multi_ref
                       and len({(x["hs"], x["a_s"]) for x in v}) > 1}
        print(f"   {len(raw):,} raw rows -> {len(seen):,} date/team groups, "
              f"{len(dups)} with more than one row, {excluded} non-club rows excluded")
        print(f"   {len(multi_ref)} group(s) hold two DISTINCT games (different "
              f"event_ref, same date) — kept, not collapsed")
        if conflicting:
            _findings.append(f"{len(conflicting)} group(s) disagree on the score "
                             f"with no distinct event_ref")
            for k in list(conflicting)[:3]:
                print(f"   SUSPECT {k[0]} {k[1]} v {k[2]} — scores differ, refs do not")
        else:
            print(f"   no group disagrees on the score without a distinct event_ref "
                  f"— safe to collapse")

        print("\n4. ODDS-SIDE CLOSURE — the map must close on every table")
        for tbl in ("odds_archive", "odds_import_staging"):
            raw_names = await _names(conn, tbl)
            orphan = sorted({nt.canonical(n) for n in raw_names}
                            - teams - set(nt.EXCLUDED_TEAMS))
            print(f"   {tbl:<22} {len(raw_names):>3} raw names -> "
                  f"{len(orphan)} orphan(s)")
            for o in orphan[:6]:
                print(f"     orphan: {o!r}")
            if orphan:
                _findings.append(f"{tbl}: {len(orphan)} club(s) unknown to game_result")

        print("\n5. NON-CLUB ENTITIES excluded")
        n = await conn.fetchval(
            """SELECT count(*) FROM game_result WHERE sport = 'nhl'
                AND (home_team_raw = ANY($1) OR away_team_raw = ANY($1))""",
            list(nt.EXCLUDED_TEAMS))
        print(f"   {n} game(s) excluded: {', '.join(sorted(nt.EXCLUDED_TEAMS))}")

        print("\n6. WHITESPACE COLLAPSE")
        allraw = await _names(conn, "game_result")
        squashed: dict[str, set] = {}
        for x in allraw:
            if nt.is_excluded(x):
                continue
            squashed.setdefault(nt.canonical(x).replace(" ", "").lower(), set()).add(
                nt.canonical(x))
        bad = {k: v for k, v in squashed.items() if len(v) > 1}
        if bad:
            for k, v in bad.items():
                _findings.append(f"whitespace variants survive: {sorted(v)}")
                print(f"   SUSPECT {sorted(v)}")
        else:
            print("   none — no two canonical names differ only by spacing or case")

    print("\n" + "=" * 64)
    if _findings:
        print(f"{len(_findings)} finding(s) to resolve:")
        for f in _findings:
            print(f"  - {f}")
        return 1
    print("MAP IS COMPLETE: 32 franchises, no surviving duplicates, no orphans on")
    print("either odds table, non-clubs excluded.")
    print()
    print("The duplicate rows remain in game_result — load_nhl_games() removes them")
    print("on the way out. Anything reading that table directly still sees them.")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
