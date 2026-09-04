"""Phase 2.1 — do two real tennis players share one identity in our data?

WHY THIS RUNS BEFORE THE FIT. Player identity in tennis-data is surname plus
initial: `Fery A.`, `Duckworth J.`. It is 100% populated across all 56,386
matches, so Elo can train on names alone with no crosswalk — but the key is
LOSSY. Two distinct players sharing a surname and an initial merge into a single
rating, and that rating is then wrong for both of them for as long as both are
active.

A collision cannot be caught later. It does not raise, and it does not produce
an obviously silly number — it produces a PLAUSIBLE rating for a player who does
not exist, internally consistent with itself, so calibration and walk-forward
both sign off on it happily. Before the fit is the only place it is findable.

FOUR INDEPENDENT CHECKS, because no single one is conclusive:

  1. CROSS-TOUR. A name appearing in both ATP and WTA is definitionally two
     people. This is the only check that proves a collision rather than
     suggesting one.
  2. CROSSWALK CONTRADICTION. Two ESPN athlete ids resolving to one
     tennis-data name inside one tour is direct external evidence.
  3. DATA INTEGRITY. The same name on both sides of one match is impossible.
  4. IMPLAUSIBLE VOLUME. A single player peaks around 80 matches a year; a
     merged identity can exceed that.

DELIBERATELY NOT A CHECK: long gaps in activity. Tried and rejected on
2026-09-04 — it returns 13 candidates at a >2y gap with >=15 matches either
side, and every one is a real player with a documented career break (Wozniacki
retired 2020 and returned 2023; Pironkova, Sevastova and Rodina maternity;
Haddad Maia suspension; Konjuh injury). In tennis a multi-year absence is
ordinary, so the signal is ~100% false positive and would only teach whoever
runs this to ignore its output. Those names are listed in CAREER_BREAKS so a
future reader does not re-derive the same dead end.

Run from python-odds-service/:
    python audit_tennis_name_collisions.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

import db  # noqa: E402

# Names whose ATP/WTA overlap is a confirmed collision, and the resolution.
# Keying every rating on (sport, name) resolves ALL of them at once, which is
# also correct on its own terms: ATP and WTA are separate competitive pools and
# must never share a rating, collision or not.
CROSS_TOUR_RESOLUTION = "key ratings on (sport, name) — ATP and WTA never share a pool"

# Real players with documented breaks. Not collisions. Listed so the rejected
# gap heuristic is not rediscovered as a finding.
CAREER_BREAKS = {
    "Wozniacki C.", "Pironkova T.", "Sevastova A.", "Rodina E.", "Konjuh A.",
    "Haddad Maia B.", "Chirico L.", "Zanevska M.", "Majchrzak K.", "Molcan A.",
    "Gasparyan M.", "Wang Y.", "Fett J.",
}

# A single player tops out near 80 matches a year across all levels.
MAX_PLAUSIBLE_PER_YEAR = 90

_findings: list[str] = []


async def check_cross_tour(conn) -> None:
    print("\n1. CROSS-TOUR — a name in both ATP and WTA is two people, provably")
    rows = await conn.fetch(
        """WITH n AS (
             SELECT sport, home_team_raw nm FROM game_result WHERE sport LIKE 'tennis%'
             UNION ALL
             SELECT sport, away_team_raw FROM game_result WHERE sport LIKE 'tennis%')
           SELECT nm, count(*) slots FROM n
           GROUP BY 1 HAVING count(DISTINCT sport) > 1
           ORDER BY slots DESC"""
    )
    for r in rows:
        print(f"     {r['nm']:<24} {r['slots']:>4} player-slots")
    print(f"   -> {len(rows)} confirmed collision(s)")
    print(f"   -> RESOLUTION: {CROSS_TOUR_RESOLUTION}")
    print("      Resolved by construction, so these are reported, not blocking.")


async def check_crosswalk(conn) -> None:
    print("\n2. CROSSWALK — two ESPN ids resolving to one name inside one tour")
    rows = await conn.fetch(
        """SELECT sport, athlete_name, count(DISTINCT espn_athlete_id) ids
             FROM athlete_crosswalk WHERE sport LIKE 'tennis%'
            GROUP BY 1, 2 HAVING count(DISTINCT espn_athlete_id) > 1
            ORDER BY ids DESC"""
    )
    for r in rows:
        _findings.append(f"crosswalk: {r['sport']}/{r['athlete_name']} -> {r['ids']} espn ids")
        print(f"     SUSPECT  {r['sport']:<11} {r['athlete_name']:<24} {r['ids']} ids")
    if not rows:
        print("     none — no name maps to more than one ESPN athlete")
    # Coverage caveat: the crosswalk covers 1,186 of 1,765 names, so a clean
    # result here is evidence, not proof, for the names it does not cover.
    cov = await conn.fetchrow(
        """SELECT (SELECT count(*) FROM athlete_crosswalk WHERE sport LIKE 'tennis%') xw,
                  (SELECT count(DISTINCT nm) FROM (
                     SELECT home_team_raw nm FROM game_result WHERE sport LIKE 'tennis%'
                     UNION SELECT away_team_raw FROM game_result WHERE sport LIKE 'tennis%') s) names"""
    )
    print(f"     (covers {cov['xw']:,} of {cov['names']:,} names — evidence for those, "
          f"silent on the rest)")


async def check_integrity(conn) -> None:
    print("\n3. INTEGRITY — the same name on both sides of one match is impossible")
    n = await conn.fetchval(
        "SELECT count(*) FROM game_result WHERE sport LIKE 'tennis%' "
        "AND home_team_raw = away_team_raw"
    )
    if n:
        _findings.append(f"integrity: {n} match(es) with identical names on both sides")
        print(f"     SUSPECT  {n} match(es)")
    else:
        print("     none — 0 self-matches")


async def check_volume(conn) -> None:
    print(f"\n4. VOLUME — above ~{MAX_PLAUSIBLE_PER_YEAR}/yr suggests a merged identity")
    rows = await conn.fetch(
        """WITH n AS (
             SELECT sport, home_team_raw nm, game_date d FROM game_result WHERE sport LIKE 'tennis%'
             UNION ALL
             SELECT sport, away_team_raw, game_date FROM game_result WHERE sport LIKE 'tennis%')
           SELECT sport, nm, count(*) slots,
                  (max(d) - min(d)) / 365.25 span_yrs,
                  count(*) / greatest(1, (max(d) - min(d)) / 365.25) per_yr
             FROM n GROUP BY 1, 2
            HAVING count(*) > 60
            ORDER BY per_yr DESC LIMIT 5"""
    )
    worst = rows[0] if rows else None
    for r in rows[:3]:
        flag = "SUSPECT" if r["per_yr"] > MAX_PLAUSIBLE_PER_YEAR else "ok     "
        if r["per_yr"] > MAX_PLAUSIBLE_PER_YEAR:
            _findings.append(f"volume: {r['sport']}/{r['nm']} at {r['per_yr']:.0f}/yr")
        print(f"     {flag}  {r['sport']:<11} {r['nm']:<22} {r['slots']:>4} over "
              f"{r['span_yrs']:.1f}y = {r['per_yr']:.0f}/yr")
    if worst and worst["per_yr"] <= MAX_PLAUSIBLE_PER_YEAR:
        print(f"     busiest name is {worst['per_yr']:.0f}/yr — under the bar, nothing flagged")


async def main() -> int:
    print("PHASE 2.1 — tennis name-collision audit\n" + "=" * 62)
    pool = await db.get_pool()
    async with pool.acquire(timeout=30.0) as conn:
        await check_cross_tour(conn)
        await check_crosswalk(conn)
        await check_integrity(conn)
        await check_volume(conn)

    print("\n" + "=" * 62)
    print(f"Rejected heuristic: activity gaps. {len(CAREER_BREAKS)} names have multi-year")
    print("breaks and all are real players (retirement, maternity, injury, suspension).")
    if _findings:
        print(f"\n{len(_findings)} UNRESOLVED finding(s) — resolve before fitting:")
        for f in _findings:
            print(f"  - {f}")
        return 1
    print("\nNo unresolved collisions. Cross-tour cases are resolved by construction")
    print("once ratings are keyed on (sport, name) — which Phase 2.2 must do.")
    return 0


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    sys.exit(asyncio.run(main()))
