"""Phase 4.1 — one franchise, one identity.

THE PROBLEM, and it is worse than Phase 3.1's. 84 distinct team names across
`game_result` for a 32-team league, from two sources that overlap:

    sbr        2007-2022, city only:   'Boston'  'Los Angeles'  'NY Rangers'
    espn_core  2021-2026, full name:   'Boston Bruins'  'Los Angeles Kings'

1,316 espn_core rows fall inside sbr's date range (2021-01 → 2022-11), and a
raw-name duplicate check finds only 8 groups because the names never match —
exactly the trap soccer had, where canonicalisation revealed 4x more.

THREE DISTINCT PROBLEMS, not one:

  1. TWO CONVENTIONS, as above.

  2. WHITESPACE AND TYPO VARIANTS INSIDE A SINGLE SOURCE. sbr carries both
     'Los Angeles' and 'LosAngeles', 'New Jersey' and 'NewJersey', 'NY Rangers'
     and 'NYRangers', 'San Jose'/'SanJose', 'St. Louis'/'St.Louis',
     'Tampa Bay'/'TampaBay', 'Winnipeg'/'WinnipegJets', and THREE spellings of
     Seattle ('Seattle', 'Seattle Kraken', 'SeattleKraken'). Plus 'Arizonas',
     which is simply a typo.

  3. ENTITIES THAT ARE NOT CLUBS. espn_core carries 'Canada', 'Finland',
     'Sweden' and 'USA' (the February 2025 4 Nations Face-Off) and 'Team
     Hughes', 'Team MacKinnon', 'Team Matthews', 'Team McDavid' (All-Star Game
     rosters). A tournament of national sides or a drafted all-star team tells
     you nothing about club strength, exactly as soccer's 'MLS All-Stars' did
     not.

FRANCHISE CONTINUITY IS A MODELLING DECISION, RECORDED HERE RATHER THAN LEFT TO
THE NAME MAP. Three cases, all resolved the same way — the franchise keeps its
identity — because a relocation or rename carries the roster with it, and a
roster is what the rating is actually about:

    Phoenix -> Arizona                  (2014 rename)
    Arizona -> Utah Hockey Club -> Utah Mammoth   (2024 relocation, 2025 rename)
    Atlanta -> Winnipeg                 (2011 relocation)

Under the fitted time decay (Phase 3.4 chose a 347-day half-life) the 2011 case
carries no weight either way, but the 2024 Utah move is recent and would
otherwise split a live franchise across three names in the most important
period. Canonical form is the CURRENT identity, so history flows forward into
the team that exists today.

NO FUZZY MATCHING. 'NY Rangers' and 'NY Islanders' share a prefix and are
different clubs, as do the two Utah spellings and 'Team Matthews' vs a real
club. 84 names is small enough to write out and check by eye, and a mapping
error here silently merges two franchises — 4.1's own failure mode, reintroduced
by its fix.
"""
from __future__ import annotations

# Every observed spelling -> the canonical franchise. Names already canonical
# are omitted rather than listed as no-ops.
_ALIASES: dict[str, str] = {
    # --- espn_core full names -> city form -----------------------------------
    "Anaheim Ducks": "Anaheim",
    "Boston Bruins": "Boston",
    "Buffalo Sabres": "Buffalo",
    "Calgary Flames": "Calgary",
    "Carolina Hurricanes": "Carolina",
    "Chicago Blackhawks": "Chicago",
    "Colorado Avalanche": "Colorado",
    "Columbus Blue Jackets": "Columbus",
    "Dallas Stars": "Dallas",
    "Detroit Red Wings": "Detroit",
    "Edmonton Oilers": "Edmonton",
    "Florida Panthers": "Florida",
    "Los Angeles Kings": "Los Angeles",
    "Minnesota Wild": "Minnesota",
    "Montreal Canadiens": "Montreal",
    "Nashville Predators": "Nashville",
    "New Jersey Devils": "New Jersey",
    "New York Islanders": "NY Islanders",
    "New York Rangers": "NY Rangers",
    "Ottawa Senators": "Ottawa",
    "Philadelphia Flyers": "Philadelphia",
    "Pittsburgh Penguins": "Pittsburgh",
    "San Jose Sharks": "San Jose",
    "St. Louis Blues": "St. Louis",
    "Tampa Bay Lightning": "Tampa Bay",
    "Toronto Maple Leafs": "Toronto",
    "Vancouver Canucks": "Vancouver",
    "Vegas Golden Knights": "Vegas",
    "Washington Capitals": "Washington",
    "Winnipeg Jets": "Winnipeg",

    # --- sbr whitespace variants ---------------------------------------------
    "LosAngeles": "Los Angeles",
    "NewJersey": "New Jersey",
    "NYIslanders": "NY Islanders",
    "NYRangers": "NY Rangers",
    "SanJose": "San Jose",
    "St.Louis": "St. Louis",
    "TampaBay": "Tampa Bay",
    "SeattleKraken": "Seattle",
    "Seattle Kraken": "Seattle",
    "WinnipegJets": "Winnipeg",

    # --- a straight typo ------------------------------------------------------
    "Arizonas": "Utah",

    # --- franchise continuity (see the module docstring) ---------------------
    "Phoenix": "Utah",             # 2014 rename to Arizona
    "Arizona": "Utah",             # 2024 relocation to Salt Lake City
    "Arizona Coyotes": "Utah",
    "Utah Hockey Club": "Utah",    # 2025 rename to Mammoth
    "Utah Mammoth": "Utah",
    "Atlanta": "Winnipeg",         # 2011 relocation
}

# Not clubs. National sides from the 2025 4 Nations Face-Off, and All-Star Game
# rosters drafted across the league. Neither says anything about club strength.
EXCLUDED_TEAMS: frozenset[str] = frozenset({
    "Canada", "Finland", "Sweden", "USA",
    "Team Hughes", "Team MacKinnon", "Team Matthews", "Team McDavid",
})

# footballdata's NHL equivalent: sbr has the longer history (18,204 rows,
# 2007-2022) against espn_core's 6,685 (2021-2026), so it wins a duplicate.
_SOURCE_RANK = {"sbr": 0, "espn_core": 1}


def canonical(name: str) -> str:
    """The one franchise this name belongs to. Unmapped names pass through."""
    if not name:
        return name
    return _ALIASES.get(name.strip(), name.strip())


def is_excluded(*names: str) -> bool:
    """True if any side is a national team or an All-Star roster."""
    return any((n or "").strip() in EXCLUDED_TEAMS for n in names)


def alias_count() -> int:
    return len(_ALIASES)


async def load_nhl_games(conn=None) -> list[dict]:
    """Canonical, non-club-free, de-duplicated, chronological.

    ONE place applies the rule, so 4.2-4.8 cannot drift apart on it — the same
    reasoning as soccer_teams.load_soccer_matches and CLAUDE.md's argument for
    canonical_bookmaker living at the shared writer.

    NOTE: `home_score`/`away_score` are FINAL scores, including overtime and
    shootout. NHL shows 0 ties across 24,889 games for exactly that reason.
    Regulation scores are not in this table — see Phase 4.2.
    """
    import db as _db

    sql = """SELECT game_date, home_team_raw h, away_team_raw a,
                    home_score hs, away_score a_s, source, event_ref
               FROM game_result
              WHERE sport = 'nhl' AND home_score IS NOT NULL AND away_score IS NOT NULL
              ORDER BY game_date"""
    if conn is not None:
        rows = await conn.fetch(sql)
    else:
        pool = await _db.get_pool()
        async with pool.acquire(timeout=60.0) as c:
            rows = await c.fetch(sql)

    # TWO GAMES CAN SHARE A DATE AND BOTH TEAMS, so (date, home, away) is NOT a
    # unique key for NHL. Found by the 4.1 audit: six "conflicting duplicates"
    # in the COVID-shortened 2020-21 season turned out to be DISTINCT games with
    # different event_refs — e.g. Carolina v Dallas on 2021-01-31 carries refs
    # 401272220 (4-1) and 401272230 (4-3). Collapsing on the coarse key would
    # have silently deleted a real game and called it de-duplication.
    #
    # So: group on (date, home, away) as before, but keep ONE ROW PER DISTINCT
    # event_ref within a group. A group whose refs are all NULL or all the same
    # collapses to one row, which is the ordinary cross-source case; a group
    # holding two real event_refs keeps both.
    groups: dict[tuple, list] = {}
    for r in rows:
        if is_excluded(r["h"], r["a"]):
            continue
        home, away = canonical(r["h"]), canonical(r["a"])
        if home == away:
            continue                      # a canonicalisation collapse, not a game
        groups.setdefault((r["game_date"], home, away), []).append(r)

    best: dict[tuple, dict] = {}
    for (played, home, away), rs in groups.items():
        refs = {r["event_ref"] for r in rs if r["event_ref"] is not None}
        # Sub-key by event_ref only when the group genuinely holds more than one.
        # Otherwise every null-ref row would key separately and never de-dup.
        multi = len(refs) > 1
        for r in rs:
            sub = r["event_ref"] if multi else None
            key = (played, home, away, sub)
            rank = _SOURCE_RANK.get(r["source"], 99)
            cur = best.get(key)
            if cur is not None and cur["_rank"] <= rank:
                continue
            best[key] = {
                "sport": "nhl", "played": played, "home": home, "away": away,
                "home_goals": int(r["hs"]), "away_goals": int(r["a_s"]),
                "source": r["source"], "event_ref": r["event_ref"], "_rank": rank,
            }
    out = sorted(best.values(), key=lambda m: (m["played"], m["home"], m["away"]))
    for m in out:
        m.pop("_rank", None)
    return out
