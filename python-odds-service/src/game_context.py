"""Reads real game context. MLB reads 'mlb:snapshot' from Postgres (existing,
proactively kept fresh by the TS refreshMlb job — that one's still TS-owned).

NFL/CFB/Soccer fetch DIRECTLY from ESPN (2026-08-20 rewrite) — this used to
read a Postgres snapshot ('odds-context:{sport}') that only got refreshed as
a side effect of TS's loadGameContextsForSport running. Real bug found the
same night: once lib/scheduler.ts's cutover removed the automatic calls to
refreshNfl/refreshCfb/refreshSoccerEpl (see docs/phase2-hardening-gameplan-
2026-08-20.md), NOTHING wrote that snapshot anymore except a manual API
trigger — so this worker's own NFL/CFB/Soccer jobs would have silently gone
stale over time with no error, reading an ever-older game list. Now
self-sufficient: direct port of lib/sports/multiSport/teamSportEspn.ts's
fetchScoreboard/fetchTeamRoster (same URLs, same 14-day/7-day lookahead
window, same 1h roster TTL, same shared snapshot_cache table for the roster
cache specifically — reusable by either app, whichever ran more recently).

Rough parsing only for MLB. MLB's shape has zero schema enforcement today
(documented gap in docs/phase2-python-odds-migration-audit-2026-08-19.md) —
this replicates gameContext.ts's exact quirk (team abbreviations derived by
splitting `matchup` on '@', not read from a dedicated field) since that's
what the real payload actually contains.

Roster parsing added to feed entity_resolution.resolve_player — MLB's roster
is built by filtering the snapshot's top-level `subjects[]` down to whichever
ones have `meta.gamePk` equal to this game's gamePk (ported directly from
gameContext.ts's buildContextForGame, no role/batter-vs-pitcher filtering,
matching the TS reference exactly), pulling `teamAbbr` from `meta.team` when
it's a string.
"""
import asyncio
import json
import re
from datetime import datetime, timedelta, timezone

import httpx

from db import read_snapshot, read_snapshot_with_age, write_snapshot
from entity_resolution import RosterEntry


class Game:
    def __init__(
        self,
        sport: str,
        game_id: str,
        away_team_name: str,
        home_team_name: str,
        away_abbr: str,
        home_abbr: str,
        game_date: str,
        is_final: bool = False,
        roster: list[RosterEntry] | None = None,
    ):
        self.sport = sport
        self.game_id = game_id
        self.away_team_name = away_team_name
        self.home_team_name = home_team_name
        self.away_abbr = away_abbr
        self.home_abbr = home_abbr
        self.game_date = game_date
        self.is_final = is_final
        self.roster = roster or []


def _roster_for_mlb_game(subjects: list[dict], game_pk) -> list[RosterEntry]:
    """Mirrors gameContext.ts:37-45's buildContextForGame roster derivation
    exactly: filter snapshot.subjects by meta.gamePk === this game's gamePk
    (JS strict equality — both sides are the raw JSON number, no string
    coercion; game_pk here is passed through as whatever json.loads already
    decoded it to, for the same reason), map to {subjectId, subjectName,
    teamAbbr from meta.team if it's a string else None}."""
    roster: list[RosterEntry] = []
    for s in subjects:
        meta = s.get("meta") or {}
        if not isinstance(meta, dict):
            continue
        if meta.get("gamePk") != game_pk:
            continue
        team = meta.get("team")
        roster.append(
            RosterEntry(
                subject_id=s.get("subjectId"),
                subject_name=s.get("subjectName"),
                team_abbr=team if isinstance(team, str) else None,
            )
        )
    return roster


async def load_mlb_games() -> list[Game]:
    payload = await read_snapshot("mlb:snapshot")
    if not payload:
        return []
    data = json.loads(payload)
    raw_games = ((data.get("context") or {}).get("other") or {}).get("games") or []
    subjects = data.get("subjects") or []

    games: list[Game] = []
    for g in raw_games:
        matchup = g.get("matchup") or ""
        parts = [p.strip() for p in matchup.split("@")]
        away_abbr = parts[0] if len(parts) == 2 else ""
        home_abbr = parts[1] if len(parts) == 2 else ""
        away_name = g.get("awayTeamName")
        home_name = g.get("homeTeamName")
        if not away_name or not home_name:
            continue  # gameContext.ts drops games missing either name — mirrored here
        state = (g.get("state") or "")
        game_pk = g.get("gamePk")
        games.append(
            Game(
                sport="mlb",
                game_id=str(game_pk),
                away_team_name=away_name,
                home_team_name=home_name,
                away_abbr=away_abbr,
                home_abbr=home_abbr,
                game_date=g.get("firstPitch") or "",
                is_final=bool(re.search(r"final", state, re.IGNORECASE)),
                roster=_roster_for_mlb_game(subjects, game_pk),
            )
        )
    return games


_ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports"

# Direct port of multiSportGameContext.ts's SPORT_CONFIG (team-sport entries
# only — tennis isn't part of this worker's scope).
_ESPN_SPORT_CONFIG: dict[str, tuple[str, str]] = {
    "nfl": ("football", "nfl"),
    "cfb": ("football", "college-football"),
    "soccer_epl": ("soccer", "eng.1"),
    "soccer_mls": ("soccer", "usa.1"),
    "nba": ("basketball", "nba"),
}

_ROSTER_TTL_SECONDS = 60 * 60  # 1h — matches teamSportEspn.ts's ROSTER_TTL_MS


def _int_or_none(v) -> int | None:
    try:
        return int(str(v))
    except (TypeError, ValueError):
        return None


def _date_range_param(days_ahead: int) -> str:
    """ESPN wants YYYYMMDD-YYYYMMDD with the EARLIER date first.

    A negative `days_ahead` therefore has to swap the ends, not just subtract:
    passing -3 naively yields "20260903-20260831", which is a backwards range
    and returns nothing. archiveResultsJob asks for a backwards window, so this
    orders the pair rather than assuming the caller wants the future.
    """
    now = datetime.now(timezone.utc)
    other = now + timedelta(days=days_ahead)
    start, end = (now, other) if days_ahead >= 0 else (other, now)
    return f"{start.strftime('%Y%m%d')}-{end.strftime('%Y%m%d')}"


async def _fetch_espn_scoreboard(client: httpx.AsyncClient, espn_sport: str, espn_league: str, days_ahead: int) -> list[dict]:
    """Direct port of teamSportEspn.ts's fetchScoreboard — same URL, same
    date-range window, same graceful-empty-on-failure behavior (a fetch
    failure here must never crash the job; the caller just sees no games
    this cycle and tries again next cycle)."""
    try:
        res = await client.get(
            f"{_ESPN_BASE}/{espn_sport}/{espn_league}/scoreboard?dates={_date_range_param(days_ahead)}",
            timeout=httpx.Timeout(10.0),
        )
    except httpx.HTTPError:
        return []
    if res.status_code != 200:
        return []
    data = res.json()
    games: list[dict] = []
    for ev in data.get("events") or []:
        competitions = ev.get("competitions") or []
        comp = competitions[0] if competitions else {}
        competitors = comp.get("competitors") or []
        home = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away = next((c for c in competitors if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        # Real, live-confirmed shape (2026-08-20): comp.status.type.completed.
        # Ported from nothing — the old snapshot-based path (and TS's own
        # GameLookupContext type, which has no isFinal field at all) never
        # tracked this for NFL/CFB/Soccer, unlike MLB's real is_final
        # parsing. Real gap: SportsGameOdds bills per-game, so a finished
        # game left in the list means a genuinely wasted live HTTP request
        # (and rate-limit consumption) for a market that's already closed.
        status = ((comp.get("status") or {}).get("type") or {})
        games.append(
            {
                "gameId": str(ev.get("id")),
                "date": ev.get("date"),
                "homeTeamId": str(home["team"]["id"]),
                "homeTeamName": home["team"]["displayName"],
                "homeAbbr": home["team"]["abbreviation"],
                "awayTeamId": str(away["team"]["id"]),
                "awayTeamName": away["team"]["displayName"],
                "awayAbbr": away["team"]["abbreviation"],
                "isFinal": bool(status.get("completed")),
                # SCORES, added 2026-09-03 for archiveResultsJob. They were
                # always in this payload and always discarded: ESPN puts them on
                # the competitor, beside the team block this already reads. A
                # completed game with no score is left as None rather than 0 —
                # 0-0 is a real scoreline in soccer, so coercing would
                # manufacture results.
                "homeScore": _int_or_none(home.get("score")),
                "awayScore": _int_or_none(away.get("score")),
            }
        )
    return games


async def _fetch_espn_roster(client: httpx.AsyncClient, espn_sport: str, espn_league: str, team_id: str) -> list[dict]:
    """Direct port of teamSportEspn.ts's fetchTeamRoster — same 1h TTL, same
    shared snapshot_cache table/key format (espn-roster:{sport}:{league}:{id}),
    so this and the TS app's own roster fetches share one real cache
    regardless of which one last populated it. Field names in the cached
    payload MUST match TS's real EspnAthlete shape exactly (subjectId,
    fullName, positionAbbr, headshotUrl) — a mismatched shape here breaks on
    a real cache entry TS already wrote, caught live 2026-08-20 (first
    attempt used subjectName/position, not fullName/positionAbbr, and
    KeyError'd reading a real pre-existing cache row). Returns raw dicts, not
    RosterEntry — team_abbr isn't intrinsic to a roster entry (it's "which
    side of this specific game"), same reason TS's fetchTeamRoster doesn't
    set it either; the caller attaches it per-game."""
    cache_key = f"espn-roster:{espn_sport}:{espn_league}:{team_id}"
    cached = await read_snapshot_with_age(cache_key)
    if cached and cached[1] < _ROSTER_TTL_SECONDS:
        return json.loads(cached[0])

    try:
        res = await client.get(f"{_ESPN_BASE}/{espn_sport}/{espn_league}/teams/{team_id}/roster", timeout=httpx.Timeout(10.0))
    except httpx.HTTPError:
        return json.loads(cached[0]) if cached else []
    if res.status_code != 200:
        return json.loads(cached[0]) if cached else []

    data = res.json()
    athletes: list[dict] = []
    for entry in data.get("athletes") or []:
        raw_list = entry.get("items") if "items" in entry else [entry]
        for a in raw_list or []:
            athletes.append(
                {
                    "subjectId": f"espn:{espn_sport}:{a.get('id')}",
                    "fullName": a.get("fullName"),
                    "positionAbbr": (a.get("position") or {}).get("abbreviation"),
                    "headshotUrl": (a.get("headshot") or {}).get("href"),
                }
            )
    await write_snapshot(cache_key, json.dumps(athletes))
    return athletes


async def completed_espn_games(sport: str, days_back: int = 3) -> list[dict]:
    """Recently-COMPLETED games with real scores, for archiveResultsJob.

    Reuses _fetch_espn_scoreboard rather than adding a second scoreboard path,
    so there is one place where ESPN's shape is parsed. Returns raw dicts, not
    Game objects: Game deliberately carries no score, and widening it for one
    consumer would touch every sport's loader.
    """
    espn_sport, espn_league = _ESPN_SPORT_CONFIG[sport]
    async with httpx.AsyncClient() as client:
        # Negative days_ahead walks backwards from today — the same range param,
        # which already accepts a start earlier than the end.
        raw = await _fetch_espn_scoreboard(client, espn_sport, espn_league, -days_back)
    return [g for g in raw
            if g.get("isFinal") and g.get("homeScore") is not None and g.get("awayScore") is not None]


async def load_sport_games(sport: str) -> list[Game]:
    """sport: 'nfl' | 'cfb' | 'soccer_epl' | 'soccer_mls' — fetches directly
    from ESPN (2026-08-20), not from the Postgres snapshot TS used to keep
    fresh. See this module's docstring for why that snapshot could no
    longer be trusted."""
    espn_sport, espn_league = _ESPN_SPORT_CONFIG[sport]
    days_ahead = 7 if sport in ("soccer_epl", "soccer_mls") else 14

    async with httpx.AsyncClient() as client:
        raw_games = await _fetch_espn_scoreboard(client, espn_sport, espn_league, days_ahead)

        games: list[Game] = []
        for g in raw_games:
            home_raw, away_raw = await asyncio.gather(
                _fetch_espn_roster(client, espn_sport, espn_league, g["homeTeamId"]),
                _fetch_espn_roster(client, espn_sport, espn_league, g["awayTeamId"]),
            )
            # .get() throughout, not direct indexing — a real TS-written cache
            # entry can be MISSING positionAbbr/headshotUrl entirely (JS's
            # JSON.stringify drops undefined-valued keys, unlike Python's
            # None -> null), not just null.
            roster = [
                RosterEntry(subject_id=r["subjectId"], subject_name=r.get("fullName"), team_abbr=g["homeAbbr"], position=r.get("positionAbbr"), headshot_url=r.get("headshotUrl"))
                for r in home_raw
            ] + [
                RosterEntry(subject_id=r["subjectId"], subject_name=r.get("fullName"), team_abbr=g["awayAbbr"], position=r.get("positionAbbr"), headshot_url=r.get("headshotUrl"))
                for r in away_raw
            ]
            games.append(
                Game(
                    sport=sport,
                    game_id=g["gameId"],
                    away_team_name=g["awayTeamName"],
                    home_team_name=g["homeTeamName"],
                    away_abbr=g["awayAbbr"],
                    home_abbr=g["homeAbbr"],
                    game_date=g["date"] or "",
                    is_final=g.get("isFinal", False),
                    roster=roster,
                )
            )
    return games


_NHL_BASE = "https://api-web.nhle.com/v1"


def _nhl_team_display_name(team: dict) -> str:
    """Direct port of nhle.ts's teamDisplayName: NHL's schedule payload has
    no single "team name" field, just placeName ("Toronto") + commonName
    ("Maple Leafs") that TS already joins the same way — falls back to the
    abbreviation on the rare payload that's missing both (matches TS)."""
    place = (team.get("placeName") or {}).get("default")
    common = (team.get("commonName") or {}).get("default")
    name = " ".join(p for p in (place, common) if p)
    return name or team.get("abbrev", "")


async def _fetch_nhl_week(client: httpx.AsyncClient, from_date: str) -> list[dict]:
    """One call = one 7-day window (NHL's own API shape, unlike ESPN's
    single date-range param) — see lib/sports/nhl/nhle.ts's fetchWeekSchedule,
    ported here directly rather than through ESPN: this repo deliberately
    uses the NHL's own real official API for NHL, not ESPN (see NHL's TS
    adapter for why). gameType == 2 keeps only real regular-season games,
    same filter TS's fetchWeekSchedule/fetchTeamSeasonSchedule both apply -
    excludes preseason (gameType 1) and playoffs (gameType 3)."""
    try:
        res = await client.get(f"{_NHL_BASE}/schedule/{from_date}", timeout=httpx.Timeout(10.0))
    except httpx.HTTPError:
        return []
    if res.status_code != 200:
        return []
    data = res.json()
    games: list[dict] = []
    for day in data.get("gameWeek") or []:
        for g in day.get("games") or []:
            if g.get("gameType") != 2:
                continue
            home, away = g.get("homeTeam") or {}, g.get("awayTeam") or {}
            if not home.get("id") or not away.get("id"):
                continue
            games.append(
                {
                    "gameId": str(g.get("id")),
                    "date": g.get("startTimeUTC"),
                    "homeTeamId": str(home["id"]),
                    "homeTeamName": _nhl_team_display_name(home),
                    "homeAbbr": home.get("abbrev", ""),
                    "awayTeamId": str(away["id"]),
                    "awayTeamName": _nhl_team_display_name(away),
                    "awayAbbr": away.get("abbrev", ""),
                    "isFinal": g.get("gameState") in ("OFF", "FINAL"),
                }
            )
    return games


async def load_nhl_games() -> list[Game]:
    """No roster — nothing in this app resolves NHL player props through
    game_context yet (unlike MLB/NFL/soccer's roster-fed entity resolution
    above), so fetching per-team rosters here would be speculative work for
    a caller that doesn't exist. Add it the same way load_sport_games does
    if/when NHL prop resolution is built. Two sequential 7-day-window calls
    (today, today+7) match the ~14-day lookahead every other non-MLB sport
    loader uses; deduplicated by gameId since NHL's own week boundaries
    could in principle overlap depending on time-of-day at call time."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    next_week = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d")
    async with httpx.AsyncClient() as client:
        week1, week2 = await asyncio.gather(_fetch_nhl_week(client, today), _fetch_nhl_week(client, next_week))

    by_id: dict[str, dict] = {}
    for g in week1 + week2:
        by_id[g["gameId"]] = g

    return [
        Game(
            sport="nhl",
            game_id=g["gameId"],
            away_team_name=g["awayTeamName"],
            home_team_name=g["homeTeamName"],
            away_abbr=g["awayAbbr"],
            home_abbr=g["homeAbbr"],
            game_date=g["date"] or "",
            is_final=g["isFinal"],
        )
        for g in by_id.values()
    ]


_TENNIS_TOUR_LEAGUE = {"tennis_atp": "atp", "tennis_wta": "wta"}


async def load_tennis_games(sport: str) -> list[Game]:
    """Direct port of espnTennis.ts's fetchTennisMatches — structurally
    different from every other team-sport loader above: one ESPN "event" is
    a whole tournament, containing groupings (Men's/Women's Singles) of
    individual match "competitions". A match's own competitors[] already
    carries both players directly — no separate roster fetch, the two
    players IN the match are the entire roster relevant to that match's
    props, same as the TS version. subjectId matches TS's own scheme
    (`espn:tennis:{athleteId}`) so entity resolution stays consistent
    with whatever the TS side already writes for the same real athlete.
    """
    tour = _TENNIS_TOUR_LEAGUE[sport]
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{_ESPN_BASE}/tennis/{tour}/scoreboard", timeout=httpx.Timeout(10.0))
    except httpx.HTTPError:
        return []
    if res.status_code != 200:
        return []
    data = res.json()

    games: list[Game] = []
    for ev in data.get("events") or []:
        for grouping in ev.get("groupings") or []:
            for comp in grouping.get("competitions") or []:
                competitors = comp.get("competitors") or []
                home = next((c for c in competitors if c.get("homeAway") == "home"), None)
                away = next((c for c in competitors if c.get("homeAway") == "away"), None)
                home_athlete = (home or {}).get("athlete") or {}
                away_athlete = (away or {}).get("athlete") or {}
                # The athlete id is the competitor object's own "id", NOT
                # athlete["id"] — the nested athlete dict carries guid/
                # displayName/fullName/flag/links but no bare id field
                # (confirmed live against ESPN's real response). Reading
                # athlete["id"] here always misses, which silently dropped
                # every tennis match (this loader returned an empty list).
                home_id = (home or {}).get("id")
                away_id = (away or {}).get("id")
                if not home_id or not away_id:
                    continue
                status = ((comp.get("status") or {}).get("type") or {})
                games.append(
                    Game(
                        sport=sport,
                        game_id=str(comp.get("id")),
                        away_team_name=away_athlete.get("fullName") or "",
                        home_team_name=home_athlete.get("fullName") or "",
                        away_abbr=away_athlete.get("fullName") or "",
                        home_abbr=home_athlete.get("fullName") or "",
                        game_date=comp.get("date") or "",
                        is_final=bool(status.get("completed")),
                        roster=[
                            RosterEntry(subject_id=f"espn:tennis:{home_id}", subject_name=home_athlete.get("fullName") or ""),
                            RosterEntry(subject_id=f"espn:tennis:{away_id}", subject_name=away_athlete.get("fullName") or ""),
                        ],
                    )
                )
    return games
