"""Phase 3.1 — one club, one identity.

THE PROBLEM. A second source, `espn_core`, began ingesting in 2025 alongside
`footballdata`, using full club names where footballdata uses short ones. From
2025 onward the same match is therefore stored TWICE, under two different team
spellings, and every club is split into two teams:

    footballdata:  'Wolves'                   'Man United'
    espn_core:     'Wolverhampton Wanderers'  'Manchester United'

Measured 2026-09-04: EPL 2025 holds 378 footballdata + 186 espn_core rows
against a 380-match season; MLS 2025 holds 540 + 541.

Two harms, and the second is worse. Matches are double-counted across the most
recent period; and each club's attack and defence ratings are fitted on half its
data under each name. That is Phase 2.1's collision inverted — there two players
shared one identity, here one club holds two.

IT HIDES FROM THE OBVIOUS CHECK. De-duplicating on (date, home, away) catches
only 94 EPL and 167 MLS groups against 186 and 541 espn_core rows, because the
names never match.

IT IS ALSO IN THE ODDS TABLE. `odds_archive` carries both spellings too —
'Bournemouth' and 'AFC Bournemouth', 'CF Montreal' and 'CF Montréal' — so
canonicalisation has to be applied on BOTH sides of the odds join or the ship
gate silently loses rows.

CANONICAL FORM IS THE FOOTBALLDATA SHORT NAME, for two reasons rather than
taste: it has the longer history (EPL from 2015, MLS from 2012, against
espn_core's 2025) and it is the majority of rows, so canonicalising toward it
rewrites the fewest.

NO FUZZY MATCHING. 'Manchester United' and 'Manchester City' share a prefix and
are different clubs, as do several 'Sporting'/'Real'/'Atletico' sides. 35 EPL
and 31 MLS names is small enough to write out and verify by eye, and a mapping
error here silently merges two real clubs — the exact failure 3.1 exists to
prevent, reintroduced by the fix.
"""
from __future__ import annotations

# espn_core spelling -> canonical (footballdata) spelling. Names identical in
# both sources are deliberately omitted rather than listed as no-ops.
_EPL_ALIASES: dict[str, str] = {
    "AFC Bournemouth": "Bournemouth",
    "Brighton & Hove Albion": "Brighton",
    "Coventry City": "Coventry",
    "Hull City": "Hull",
    "Ipswich Town": "Ipswich",
    "Leeds United": "Leeds",
    "Manchester City": "Man City",
    "Manchester United": "Man United",
    "Newcastle United": "Newcastle",
    "Nottingham Forest": "Nott'm Forest",
    "Tottenham Hotspur": "Tottenham",
    "West Ham United": "West Ham",
    "Wolverhampton Wanderers": "Wolves",
}

_MLS_ALIASES: dict[str, str] = {
    "Atlanta United FC": "Atlanta Utd",
    "CF Montréal": "CF Montreal",          # accented form, espn_core only
    "Charlotte FC": "Charlotte",
    "Chicago Fire FC": "Chicago Fire",
    "D.C. United": "DC United",
    "Houston Dynamo FC": "Houston Dynamo",
    "Inter Miami CF": "Inter Miami",
    "LA Galaxy": "Los Angeles Galaxy",
    "LAFC": "Los Angeles FC",
    "Minnesota United FC": "Minnesota United",
    "New York City FC": "New York City",
    "Orlando City SC": "Orlando City",
    "Red Bull New York": "New York Red Bulls",
    "Seattle Sounders FC": "Seattle Sounders",
    "St. Louis CITY SC": "St. Louis City",
}

_ALIASES: dict[str, dict[str, str]] = {
    "soccer_epl": _EPL_ALIASES,
    "soccer_mls": _MLS_ALIASES,
}

# Exhibition sides that are NOT clubs. An All-Star game says nothing about any
# team's strength and must never reach a fit that estimates one. espn_core
# carries both; footballdata carries neither.
EXCLUDED_TEAMS: frozenset[str] = frozenset({
    "MLS All-Stars",
    "Liga MX All-Stars",
})


def canonical(sport: str, name: str) -> str:
    """The one spelling this club is known by. Unmapped names pass through."""
    if not name:
        return name
    n = name.strip()
    return _ALIASES.get(sport, {}).get(n, n)


def is_excluded(*names: str) -> bool:
    """True if any side is an exhibition/All-Star selection rather than a club."""
    return any((n or "").strip() in EXCLUDED_TEAMS for n in names)


def alias_count(sport: str) -> int:
    return len(_ALIASES.get(sport, {}))


# ---------------------------------------------------------------------------
# The loader. ONE place applies canonicalisation, exhibition filtering and
# de-duplication, so 3.2, 3.3 and 3.5 cannot drift apart on the rule — the same
# reasoning CLAUDE.md gives for canonical_bookmaker living at the shared writer.
# ---------------------------------------------------------------------------

# footballdata wins a duplicate: longer history (EPL 2015, MLS 2012 vs
# espn_core's 2025) and the majority of rows. Measured 2026-09-04, ALL 400 EPL
# and 604 MLS duplicate groups agree on the final score, so this precedence
# breaks no ties that matter — it is chosen for stability, not correctness.
_SOURCE_RANK = {"footballdata": 0, "espn_core": 1}


async def load_soccer_matches(sport: str, conn=None) -> list[dict]:
    """Canonical, exhibition-free, de-duplicated, chronological.

    Returns one dict per real match. The raw table still holds the duplicates —
    this removes them on the way out. Anything reading game_result directly for
    these sports is reading double from 2025 onward.
    """
    import db as _db

    sql = """SELECT game_date, home_team_raw h, away_team_raw a,
                    home_score hs, away_score a_s, source
               FROM game_result
              WHERE sport = $1 AND home_score IS NOT NULL AND away_score IS NOT NULL
              ORDER BY game_date"""
    if conn is not None:
        rows = await conn.fetch(sql, sport)
    else:
        pool = await _db.get_pool()
        async with pool.acquire(timeout=60.0) as c:
            rows = await c.fetch(sql, sport)

    best: dict[tuple, dict] = {}
    for r in rows:
        if is_excluded(r["h"], r["a"]):
            continue
        home = canonical(sport, r["h"])
        away = canonical(sport, r["a"])
        key = (r["game_date"], home, away)
        rank = _SOURCE_RANK.get(r["source"], 99)
        cur = best.get(key)
        if cur is not None and cur["_rank"] <= rank:
            continue
        best[key] = {
            "sport": sport,
            "played": r["game_date"],
            "home": home,
            "away": away,
            "home_goals": int(r["hs"]),
            "away_goals": int(r["a_s"]),
            "source": r["source"],
            "_rank": rank,
        }
    out = sorted(best.values(), key=lambda m: (m["played"], m["home"], m["away"]))
    for m in out:
        m.pop("_rank", None)
    return out
