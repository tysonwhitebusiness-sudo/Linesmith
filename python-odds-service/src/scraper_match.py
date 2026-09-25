"""Scraper games and players -> the app's own ids (P3 of the odds build, B1/B2).

The odds-scraper already clusters every source's event into one canonical
game (`canon_games` + `game_links`), so this maps each CANONICAL game once,
not each source's event. A miss is acceptable; a wrong link is not, so every
rule below declines rather than guesses:

- a game links only to an app game of the same sport starting within
  START_WINDOW_MIN, whose two teams (or tennis players) match the scraper's
  names in either orientation; two candidates are split only when the nearer
  start beats the next by DOUBLEHEADER_MARGIN_MIN, else "ambiguous";
- a link, once made, is kept: a re-run that finds a different app game
  records "relink-conflict" for a human (postponements get a new app game);
- a player links by exact normalized name on the game's roster, else by last
  name + team when exactly one of the two teams yields a match.

State lives in bridge.db (bridge_state.py), never in the scraper's own DB,
which is opened read-only. P6's bridge calls run_matching every cycle.
"""
from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from entity_resolution import RosterIndex, build_roster_index, match_team_pair, normalize_name, resolve_player

SCRAPER_TO_APP_SPORT = {
    ("baseball", "mlb"): "mlb", ("football", "nfl"): "nfl", ("football", "ncaaf"): "cfb",
    ("basketball", "nba"): "nba", ("hockey", "nhl"): "nhl", ("soccer", "epl"): "soccer_epl",
    ("soccer", "mls"): "soccer_mls", ("tennis", "atp"): "tennis_atp", ("tennis", "wta"): "tennis_wta",
}
START_WINDOW_MIN = 180        # app vs scraper start; the scraper itself clusters at 120
DOUBLEHEADER_MARGIN_MIN = 60  # the nearest candidate must beat the next by this much
GAME_CACHE_SECONDS = 600
PERSON_SPORTS = frozenset({"tennis_atp", "tennis_wta"})


@dataclass
class CanonGame:
    game_key: str
    sport: str
    league_key: str | None
    home_name: str
    away_name: str
    start_utc: datetime | None
    women: bool = False


@dataclass
class GameLink:
    game_key: str
    app_sport: str
    app_game_id: str
    reversed: bool
    method: str
    start_delta_min: float | None
    app_start: str | None


@dataclass
class PlayerLink:
    source: str
    player_norm: str
    app_game_id: str
    app_sport: str
    subject_id: str
    subject_name: str
    team_abbr: str | None
    position: str | None
    method: str


@dataclass
class Miss:
    reason: str
    detail: str | None = None


@dataclass
class MatchSummary:
    games: dict = field(default_factory=dict)    # app_sport -> {canon, linked, ambiguous, no-game-in-window, other}
    players: dict = field(default_factory=dict)  # app_sport -> {markets, linked_markets, not-on-roster, ambiguous, ...}
    no_app_sport: int = 0
    relink_conflicts: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Times
# ---------------------------------------------------------------------------
def parse_time(value) -> datetime | None:
    """ISO / SQLite text / datetime -> aware UTC datetime, or None. A date with
    no time (some feeds) is None: it cannot be compared to a start to 3 h."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip().replace("Z", "+00:00")
    if len(s) <= 10:
        return None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# The app's games
# ---------------------------------------------------------------------------
_games_cache: dict[str, tuple[float, list]] = {}


async def load_app_games(sport: str) -> list:
    """The app's games for one app sport, through game_context's own loaders
    (cached GAME_CACHE_SECONDS)."""
    hit = _games_cache.get(sport)
    if hit and time.time() - hit[0] < GAME_CACHE_SECONDS:
        return hit[1]
    from game_context import load_mlb_games, load_nhl_games, load_sport_games, load_tennis_games

    if sport == "mlb":
        games = await load_mlb_games()
        await _merge_mlb_active_rosters(games)
    elif sport == "nhl":
        games = await load_nhl_games()
        await _merge_nhl_rosters(games)
    elif sport in PERSON_SPORTS:
        games = await load_tennis_games(sport)
    else:
        games = await load_sport_games(sport)
    _games_cache[sport] = (time.time(), games)
    return games


MLB_ROSTER_URL = "https://statsapi.mlb.com/api/v1/teams/{team_id}/roster?rosterType=active"
MLB_ROSTER_SECONDS = 6 * 3600
_mlb_roster_cache: dict[str, tuple[float, list]] = {}


async def _merge_mlb_active_rosters(games: list) -> None:
    """P3's MLB fallback, measured necessary: load_mlb_games builds a game's
    roster from the snapshot's tracked subjects only (~20 a game, no
    positions), and linked 88.7% of MLB prop rows on 2026-09-24, under the
    spec's 95% line. Each team's StatsAPI active roster (cached 6 h) adds the
    players the snapshot lacks, and fills a missing position for those it has,
    so P2's position-dependent labels ("Strikeouts") can resolve."""
    import httpx

    from entity_resolution import RosterEntry

    async with httpx.AsyncClient(timeout=20) as client:
        for g in games:
            for team_id, abbr in ((g.home_team_id, g.home_abbr), (g.away_team_id, g.away_abbr)):
                if not team_id:
                    continue
                hit = _mlb_roster_cache.get(str(team_id))
                if hit and time.time() - hit[0] < MLB_ROSTER_SECONDS:
                    people = hit[1]
                else:
                    try:
                        r = await client.get(MLB_ROSTER_URL.format(team_id=team_id))
                        r.raise_for_status()
                        people = [(str(x["person"]["id"]), x["person"].get("fullName") or "",
                                   (x.get("position") or {}).get("abbreviation")) for x in r.json().get("roster", [])]
                    except Exception as exc:  # a miss, never a guess: the snapshot roster stands alone
                        print(f"[scraper_match] MLB roster {team_id} failed: {type(exc).__name__}: {exc}", flush=True)
                        continue
                    _mlb_roster_cache[str(team_id)] = (time.time(), people)
                by_id = {e.subject_id: e for e in g.roster}
                for pid, name, pos in people:
                    e = by_id.get(pid)
                    if e is None:
                        g.roster.append(RosterEntry(subject_id=pid, subject_name=name, team_abbr=abbr, position=pos))
                    elif not e.position and pos:
                        e.position = pos


NHL_ROSTER_URL = "https://api-web.nhle.com/v1/roster/{abbr}/current"
_nhl_roster_cache: dict[str, tuple[float, list]] = {}


async def _merge_nhl_rosters(games: list) -> None:
    """P3 routed to P6 (2026-09-25): `load_nhl_games` carries no roster, so no
    NHL player could link. The NHL's own roster endpoint (cached 6 h) gives
    the same NHL API ids the app keys NHL players by (`player_game_history.
    athlete_id` 8478109 etc.), with positions. A failed fetch is a miss for
    that team, never a guess."""
    import httpx

    from entity_resolution import RosterEntry

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        for g in games:
            for abbr in (g.home_abbr, g.away_abbr):
                if not abbr:
                    continue
                hit = _nhl_roster_cache.get(abbr)
                if hit and time.time() - hit[0] < MLB_ROSTER_SECONDS:
                    people = hit[1]
                else:
                    try:
                        r = await client.get(NHL_ROSTER_URL.format(abbr=abbr))
                        r.raise_for_status()
                        d = r.json()
                        people = [(str(x["id"]), f"{x['firstName']['default']} {x['lastName']['default']}",
                                   x.get("positionCode"))
                                  for grp in ("forwards", "defensemen", "goalies") for x in d.get(grp, [])]
                    except Exception as exc:  # a miss, never a guess
                        print(f"[scraper_match] NHL roster {abbr} failed: {type(exc).__name__}: {exc}", flush=True)
                        continue
                    _nhl_roster_cache[abbr] = (time.time(), people)
                have = {e.subject_id for e in g.roster}
                for pid, name, pos in people:
                    if pid not in have:
                        g.roster.append(RosterEntry(subject_id=pid, subject_name=name, team_abbr=abbr, position=pos))


# ---------------------------------------------------------------------------
# Games
# ---------------------------------------------------------------------------
def link_game(canon: CanonGame, names: list[tuple[str, str]], games: list) -> GameLink | Miss:
    app_sport = SCRAPER_TO_APP_SPORT.get((canon.sport, canon.league_key))
    if app_sport is None:
        return Miss("no-app-sport")
    if canon.women and app_sport != "tennis_wta":
        return Miss("women")
    if canon.start_utc is None:
        return Miss("no-start")
    window = []
    for g in games:
        gs = parse_time(g.game_date)
        if gs is None:
            continue
        delta = (canon.start_utc - gs).total_seconds() / 60
        if abs(delta) <= START_WINDOW_MIN:
            window.append((g, gs, delta))
    if not window:
        return Miss("no-game-in-window")

    pairs = list(dict.fromkeys([*names, (canon.home_name, canon.away_name)]))
    person = app_sport in PERSON_SPORTS
    matched = []
    for g, gs, delta in window:
        for home, away in pairs:
            if not home or not away:
                continue
            m = match_team_pair(home, away, g, person=person)
            if m:
                matched.append((abs(delta), delta, g, gs, m))
                break
    if not matched:
        return Miss("no-name-match", detail=",".join(str(g.game_id) for g, _, _ in window)[:200])
    matched.sort(key=lambda x: x[0])
    if len(matched) > 1 and matched[1][0] - matched[0][0] < DOUBLEHEADER_MARGIN_MIN:
        return Miss("ambiguous", detail=",".join(str(m[2].game_id) for m in matched))
    _, delta, g, gs, (method, rev) = matched[0]
    return GameLink(game_key=canon.game_key, app_sport=app_sport, app_game_id=str(g.game_id), reversed=rev,
                    method=method, start_delta_min=round(delta, 1), app_start=gs.isoformat())


# ---------------------------------------------------------------------------
# Players
# ---------------------------------------------------------------------------
_index_cache: dict[int, RosterIndex] = {}


def _index(game) -> RosterIndex:
    key = id(game)
    idx = _index_cache.get(key)
    if idx is None:
        idx = _index_cache[key] = build_roster_index(game.roster)
    return idx


def link_player(source: str, player_norm: str, raw_name: str, game, app_sport: str | None = None) -> PlayerLink | Miss:
    index = _index(game)
    sport = app_sport or getattr(game, "sport", "")

    def link(entry, method):
        return PlayerLink(source=source, player_norm=player_norm, app_game_id=str(game.game_id), app_sport=sport,
                          subject_id=str(entry.subject_id), subject_name=entry.subject_name,
                          team_abbr=entry.team_abbr, position=entry.position, method=method)

    for name in (raw_name, player_norm):
        n = normalize_name(name or "")
        if n and n in index.by_full_name:
            return link(index.by_full_name[n], "exact")
    hits = []
    for team in (game.home_abbr, game.away_abbr):
        if not team:
            continue
        entry = resolve_player(raw_name or player_norm, team, index)
        if entry is not None:
            hits.append(entry)
    unique = {h.subject_id: h for h in hits}
    if len(unique) == 1:
        return link(next(iter(unique.values())), "last_team")
    if len(unique) > 1:
        return Miss("ambiguous")
    return Miss("not-on-roster")


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------
def _sqlite_ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _read_canon_games(scraper: sqlite3.Connection, now: datetime, sports: set | None,
                      horizon_hours: float = 14 * 24) -> list[CanonGame]:
    rows = scraper.execute(
        "SELECT game_key, sport, league_key, home_name, away_name, start_utc, women FROM canon_games "
        "WHERE start_utc >= ? AND start_utc <= ?",
        (_sqlite_ts(now - timedelta(hours=6)), _sqlite_ts(now + timedelta(hours=horizon_hours))),
    ).fetchall()
    out = []
    for key, sport, league, home, away, start, women in rows:
        app = SCRAPER_TO_APP_SPORT.get((sport, league))
        if sports is not None and app not in sports:
            continue
        out.append(CanonGame(key, sport, league, home or "", away or "", parse_time(start), bool(women)))
    return out


def _read_names(scraper: sqlite3.Connection, game_keys: list[str]) -> dict[str, list[tuple[str, str]]]:
    """The latest (home, away) of every source event linked to each canonical
    game, oriented to the canonical game by game_links.reversed."""
    scraper.execute("CREATE TEMP TABLE IF NOT EXISTS want_games (game_key TEXT PRIMARY KEY)")
    scraper.execute("DELETE FROM want_games")
    scraper.executemany("INSERT OR IGNORE INTO want_games VALUES (?)", [(k,) for k in game_keys])
    rows = scraper.execute(
        "SELECT l.game_key, l.reversed, e.home_name, e.away_name FROM game_links l "
        "JOIN want_games w ON w.game_key = l.game_key "
        "JOIN events e ON e.id = (SELECT max(e2.id) FROM events e2 WHERE e2.external_id = l.external_id AND e2.source = l.source)"
    ).fetchall()
    out: dict[str, list[tuple[str, str]]] = {}
    for key, rev, home, away in rows:
        pair = (away or "", home or "") if rev else (home or "", away or "")
        out.setdefault(key, []).append(pair)
    return out


def _read_players(scraper: sqlite3.Connection, game_keys: list[str], since: datetime) -> list[tuple]:
    """(source, player_norm, raw player, game_key, markets) for the prop markets
    of these canonical games first seen since `since`."""
    scraper.execute("CREATE TEMP TABLE IF NOT EXISTS want_events (source TEXT, external_id TEXT, game_key TEXT)")
    scraper.execute("DELETE FROM want_events")
    scraper.execute("DELETE FROM want_games")
    scraper.executemany("INSERT OR IGNORE INTO want_games VALUES (?)", [(k,) for k in game_keys])
    scraper.execute("INSERT INTO want_events SELECT l.source, l.external_id, l.game_key FROM game_links l "
                    "JOIN want_games w ON w.game_key = l.game_key")
    return scraper.execute(
        "SELECT pm.source, pm.player_norm, max(pm.player), we.game_key, count(*) FROM want_events we "
        "JOIN prop_markets pm ON pm.parent_external_id = we.external_id AND pm.source = we.source "
        "WHERE pm.first_seen_at >= ? AND pm.player_norm IS NOT NULL AND pm.player_norm != '' "
        "GROUP BY pm.source, pm.player_norm, we.game_key",
        (_sqlite_ts(since),),
    ).fetchall()


async def run_matching(scraper_db: str, state_db: str, sports: list[str] | None = None,
                       now: datetime | None = None, player_days: int = 3,
                       horizon_hours: float = 14 * 24) -> MatchSummary:
    """P3's run. The P6 bridge calls it (through `scraper_match_run.py
    --horizon-hours 36`) every 5 minutes for games starting in the next 36 h
    and those started in the last 6 h."""
    from bridge_state import open_state

    now = now or datetime.now(timezone.utc)
    stamp = now.isoformat()
    want = set(sports) if sports else None
    scraper = sqlite3.connect(f"file:{scraper_db}?mode=ro", uri=True, timeout=30, isolation_level=None)  # no implicit txn: see scraper_bridge_run
    state = open_state(state_db)
    summary = MatchSummary()
    try:
        canon = _read_canon_games(scraper, now, want, horizon_hours)
        names = _read_names(scraper, [c.game_key for c in canon])
        existing = {r[0]: r for r in state.execute(
            "SELECT game_key, app_sport, app_game_id, reversed, method FROM game_links")}
        app_games: dict[str, list] = {}
        linked_keys: dict[str, tuple[str, str]] = {}   # game_key -> (app_sport, app_game_id)
        # Every network load BEFORE the first bridge.db write (P6, 2026-09-25):
        # a write opens SQLite's write transaction, and holding it across the
        # roster fetches (MLB + NHL, minutes) locked the live bridge out of its
        # own state DB ("database is locked" every cycle).
        for app_sport in sorted({SCRAPER_TO_APP_SPORT.get((c.sport, c.league_key)) for c in canon} - {None}):
            app_games[app_sport] = await load_app_games(app_sport)

        for c in canon:
            app_sport = SCRAPER_TO_APP_SPORT.get((c.sport, c.league_key))
            if app_sport is None:
                summary.no_app_sport += 1
                continue
            stats = summary.games.setdefault(app_sport, {"canon": 0, "linked": 0, "ambiguous": 0,
                                                         "no-game-in-window": 0, "other": 0})
            stats["canon"] += 1
            result = link_game(c, names.get(c.game_key, []), app_games[app_sport])
            old = existing.get(c.game_key)
            if isinstance(result, GameLink):
                if old and old[2] != result.app_game_id:
                    state.execute("INSERT OR REPLACE INTO game_link_misses VALUES (?,?,?,?,?)",
                                  (c.game_key, app_sport, "relink-conflict", f"kept {old[2]}, found {result.app_game_id}", stamp))
                    summary.relink_conflicts.append((c.game_key, old[2], result.app_game_id))
                    linked_keys[c.game_key] = (app_sport, old[2])
                else:
                    state.execute("INSERT OR REPLACE INTO game_links (game_key, app_sport, app_game_id, reversed, method, "
                                  "start_delta_min, app_start, linked_at) VALUES (?,?,?,?,?,?,?,?)",
                                  (c.game_key, app_sport, result.app_game_id, int(result.reversed), result.method,
                                   result.start_delta_min, result.app_start, stamp))
                    state.execute("DELETE FROM game_link_misses WHERE game_key = ?", (c.game_key,))
                    linked_keys[c.game_key] = (app_sport, result.app_game_id)
                stats["linked"] += 1
            else:
                if old:  # a link, once made, is kept
                    linked_keys[c.game_key] = (app_sport, old[2])
                    stats["linked"] += 1
                    continue
                state.execute("INSERT OR REPLACE INTO game_link_misses VALUES (?,?,?,?,?)",
                              (c.game_key, app_sport, result.reason, result.detail, stamp))
                bucket = result.reason if result.reason in ("ambiguous", "no-game-in-window") else "other"
                stats[bucket] += 1
        # The app's team names on every link (P6 §8b reads them for power ratings).
        by_id = {(s, str(g.game_id)): g for s, gs in app_games.items() for g in gs}
        for key, (app_sport, app_game_id) in linked_keys.items():
            g = by_id.get((app_sport, app_game_id))
            if g is not None:
                state.execute("UPDATE game_links SET app_home = ?, app_away = ? WHERE game_key = ?",
                              (g.home_team_name, g.away_team_name, key))
        state.commit()

        # Players, for linked games only.
        rows = _read_players(scraper, list(linked_keys), now - timedelta(days=player_days))
        for source, player_norm, raw, game_key, n in rows:
            app_sport, app_game_id = linked_keys[game_key]
            pstats = summary.players.setdefault(app_sport, {"markets": 0, "linked_markets": 0, "players": 0,
                                                             "linked_players": 0, "not-on-roster": 0, "ambiguous": 0,
                                                             "no-app-game": 0})
            pstats["markets"] += n
            pstats["players"] += 1
            game = by_id.get((app_sport, app_game_id))
            if game is None:
                pstats["no-app-game"] += n
                continue
            result = link_player(source, player_norm, raw, game, app_sport)
            if isinstance(result, PlayerLink):
                state.execute("INSERT OR REPLACE INTO player_links VALUES (?,?,?,?,?,?,?,?,?,?)",
                              (source, player_norm, app_game_id, app_sport, result.subject_id, result.subject_name,
                               result.team_abbr, result.position, result.method, stamp))
                state.execute("DELETE FROM player_link_misses WHERE source=? AND player_norm=? AND app_game_id=?",
                              (source, player_norm, app_game_id))
                pstats["linked_markets"] += n
                pstats["linked_players"] += 1
            else:
                state.execute("INSERT OR REPLACE INTO player_link_misses VALUES (?,?,?,?,?)",
                              (source, player_norm, app_game_id, result.reason, stamp))
                pstats[result.reason] = pstats.get(result.reason, 0) + n
        state.commit()
    finally:
        scraper.close()
        state.close()
    return summary
