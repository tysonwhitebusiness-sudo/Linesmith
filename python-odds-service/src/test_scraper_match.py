"""P3 (odds build, 2026-09-24): scraper games and players -> app ids.
Hermetic (fixtures only, no DB, no network). A miss is acceptable; a wrong
link is not, so half of these cases prove a link is REFUSED.

    python -u src/test_scraper_match.py
"""
import os
import sqlite3
import tempfile
from datetime import datetime, timezone

from bridge_state import open_state
from entity_resolution import RosterEntry
from scraper_match import CanonGame, GameLink, Miss, PlayerLink, link_game, link_player

_failures = 0


def check(label, actual, expected):
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


class G:
    """Stand-in for game_context.Game: the attributes the matcher reads."""

    def __init__(self, gid, home, away, start, home_abbr="", away_abbr="", roster=None, sport=""):
        self.game_id, self.home_team_name, self.away_team_name = gid, home, away
        self.home_abbr, self.away_abbr, self.game_date = home_abbr, away_abbr, start
        self.roster, self.sport = roster or [], sport


def t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def canon(sport, league, home, away, start, women=False, key="g1"):
    return CanonGame(key, sport, league, home, away, t(start) if start else None, women)


def outcome(r):
    if isinstance(r, GameLink):
        return ("link", r.app_game_id, r.method, r.reversed)
    if isinstance(r, PlayerLink):
        return ("link", r.subject_id, r.method)
    return ("miss", r.reason)


def main():
    nfl = [G("401", "Green Bay Packers", "Dallas Cowboys", "2026-09-27T20:25Z", "GB", "DAL")]
    # (1) exact names, same start
    check("(1) exact", outcome(link_game(canon("football", "nfl", "Green Bay Packers", "Dallas Cowboys", "2026-09-27T20:25Z"), [], nfl)),
          ("link", "401", "exact", False))
    # (2) the scraper's home/away swapped
    check("(2) swapped -> reversed", outcome(link_game(canon("football", "nfl", "Dallas Cowboys", "Green Bay Packers", "2026-09-27T20:25Z"), [], nfl)),
          ("link", "401", "exact", True))
    # (3) MLB doubleheader: 13:05 and 18:40
    dh = [G("g1", "New York Yankees", "Boston Red Sox", "2026-09-26T13:05Z", "NYY", "BOS"),
          G("g2", "New York Yankees", "Boston Red Sox", "2026-09-26T18:40Z", "NYY", "BOS")]
    check("(3a) doubleheader 18:35 -> the 18:40 game",
          outcome(link_game(canon("baseball", "mlb", "New York Yankees", "Boston Red Sox", "2026-09-26T18:35Z"), [], dh)),
          ("link", "g2", "exact", False))
    r = link_game(canon("baseball", "mlb", "New York Yankees", "Boston Red Sox", "2026-09-26T15:50Z"), [], dh)
    check("(3b) doubleheader 15:50 (both in window, margin < 60) -> ambiguous", outcome(r), ("miss", "ambiguous"))
    # (4) CFB "TCU" vs ESPN "TCU Horned Frogs" / abbr TCU
    cfb = [G("c1", "TCU Horned Frogs", "Baylor Bears", "2026-09-26T19:00Z", "TCU", "BAY")]
    check("(4) CFB abbreviation", outcome(link_game(canon("football", "ncaaf", "TCU", "Baylor Bears", "2026-09-26T19:00Z"), [], cfb)),
          ("link", "c1", "abbr", False))
    # (5) EPL "Man City" -> Manchester City; "Man Utd" must NOT link to it
    epl = [G("e1", "Manchester City", "Arsenal", "2026-09-27T15:30Z", "MNC", "ARS")]
    r = link_game(canon("soccer", "epl", "Man City", "Arsenal", "2026-09-27T15:30Z"), [], epl)
    check("(5a) Man City -> Manchester City", outcome(r)[:2], ("link", "e1"))
    check("(5b) Man Utd never links to Manchester City",
          outcome(link_game(canon("soccer", "epl", "Man Utd", "Arsenal", "2026-09-27T15:30Z"), [], epl)), ("miss", "no-name-match"))
    # (6) start 5 h apart
    check("(6) 5 h apart -> no-game-in-window",
          outcome(link_game(canon("football", "nfl", "Green Bay Packers", "Dallas Cowboys", "2026-09-28T01:25Z"), [], nfl)),
          ("miss", "no-game-in-window"))
    # (7) a league the app does not cover
    check("(7) CFL -> no-app-sport", outcome(link_game(canon("football", "cfl", "A", "B", "2026-09-27T20:25Z"), [], nfl)),
          ("miss", "no-app-sport"))
    # (8) a re-run that finds another id keeps the old link and records a conflict (run_matching's rule)
    check("(8) relink-conflict", relink_case(), True)
    # (9) tennis "Sinner J." vs "Jannik Sinner"
    atp = [G("t1", "Jannik Sinner", "Carlos Alcaraz", "2026-09-27T12:00Z")]
    check("(9) tennis person match", outcome(link_game(canon("tennis", "atp", "Sinner J.", "Alcaraz C.", "2026-09-27T12:00Z"), [], atp)),
          ("link", "t1", "person", False))
    check("(9b) a women's game in a men's sport -> women",
          outcome(link_game(canon("football", "nfl", "Green Bay Packers", "Dallas Cowboys", "2026-09-27T20:25Z", women=True), [], nfl)),
          ("miss", "women"))
    check("(9c) no start -> no-start",
          outcome(link_game(canon("football", "nfl", "Green Bay Packers", "Dallas Cowboys", None), [], nfl)), ("miss", "no-start"))

    # Players
    roster = [RosterEntry("p1", "Ja'Marr Chase", "CIN", "WR"), RosterEntry("p2", "Ronald Acuña Jr.", "ATL", "RF"),
              RosterEntry("p3", "Jaylen Smith", "DAL", "WR"), RosterEntry("p4", "Tarik Skubal", "DET", "SP")]
    g = G("401", "Cincinnati Bengals", "Dallas Cowboys", "2026-09-27T20:25Z", "CIN", "DAL", roster, "nfl")
    check("(10) Ja'Marr / JaMarr -> exact", outcome(link_player("dk", "jamarr chase", "JaMarr Chase", g)), ("link", "p1", "exact"))
    check("(11) Acuña Jr. -> exact", outcome(link_player("dk", "ronald acuna", "Ronald Acuña Jr.", g)), ("link", "p2", "exact"))
    check("(12) J. Smith, one Smith (away) -> last_team", outcome(link_player("dk", "j smith", "J. Smith", g)), ("link", "p3", "last_team"))
    both = G("402", "Cincinnati Bengals", "Dallas Cowboys", "2026-09-27T20:25Z", "CIN", "DAL",
             roster + [RosterEntry("p5", "Kevin Smith", "CIN", "RB")], "nfl")
    check("(13) Smith on both rosters -> ambiguous", outcome(link_player("dk", "j smith", "J. Smith", both)), ("miss", "ambiguous"))
    check("(14) not on either roster", outcome(link_player("dk", "tom brady", "Tom Brady", g)), ("miss", "not-on-roster"))
    p = link_player("pinnacle", "tarik skubal", "Tarik Skubal", g)
    check("(15) the roster position is copied", (outcome(p), getattr(p, "position", None)), (("link", "p4", "exact"), "SP"))

    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    if _failures:
        raise SystemExit(1)


def relink_case() -> bool:
    """Exercise run_matching's keep-the-old-link rule against real SQLite files."""
    import asyncio
    import scraper_match as sm

    d = tempfile.mkdtemp(prefix="p3_relink_")
    scraper_db, state_db = os.path.join(d, "scraper.db"), os.path.join(d, "bridge.db")
    s = sqlite3.connect(scraper_db)
    s.executescript("""
      CREATE TABLE canon_games (game_key TEXT PRIMARY KEY, sport TEXT, league_key TEXT, home_name TEXT, away_name TEXT,
                                start_utc TEXT, women INTEGER, created_at TEXT);
      CREATE TABLE game_links (source TEXT, external_id TEXT, game_key TEXT, method TEXT, reversed INTEGER, linked_at TEXT);
      CREATE TABLE events (id INTEGER PRIMARY KEY, external_id TEXT, source TEXT, home_name TEXT, away_name TEXT);
      CREATE TABLE prop_markets (id INTEGER PRIMARY KEY, external_id TEXT, source TEXT, parent_external_id TEXT,
                                 player TEXT, stat TEXT, line REAL, first_seen_at TEXT, player_norm TEXT);
      INSERT INTO canon_games VALUES ('gk', 'football', 'nfl', 'Green Bay Packers', 'Dallas Cowboys', '2026-09-27 20:25:00.000000', 0, '');
    """)
    s.commit()
    s.close()
    st = open_state(state_db)
    st.execute("INSERT INTO game_links VALUES ('gk','nfl','OLD',0,'exact',0,'','x')")
    st.commit()
    st.close()
    sm._games_cache["nfl"] = (1e18, [G("NEW", "Green Bay Packers", "Dallas Cowboys", "2026-09-27T20:25Z", "GB", "DAL")])
    summary = asyncio.run(sm.run_matching(scraper_db, state_db, ["nfl"], now=t("2026-09-27T12:00Z")))
    st = sqlite3.connect(state_db)
    kept = st.execute("SELECT app_game_id FROM game_links WHERE game_key='gk'").fetchone()[0]
    miss = st.execute("SELECT reason FROM game_link_misses WHERE game_key='gk'").fetchone()
    st.close()
    sm._games_cache.clear()
    return kept == "OLD" and miss == ("relink-conflict",) and summary.relink_conflicts == [("gk", "OLD", "NEW")]


if __name__ == "__main__":
    main()
