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
gameContext.ts's buildContextForGame), pulling `teamAbbr` from `meta.team`
when it's a string and `position` from `meta.role` (R6-F8: the role is what
separates a pitcher's strikeouts from a batter's).
"""
import asyncio
import json
import re
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

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
        home_team_id: str | None = None,
        away_team_id: str | None = None,
        venue: str | None = None,
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
        # M3: the rankings join on real team ids (ESPN's for the team sports,
        # StatsAPI's for MLB) and read the park by venue. Both were parsed and
        # dropped, so every consumer had to re-fetch or guess.
        self.home_team_id = home_team_id
        self.away_team_id = away_team_id
        self.venue = venue


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
        # R6-F8: the role is what tells a pitcher's strikeouts from a batter's.
        # ParlayAPI sends one generic "strikeouts"/"walks" market for both, and
        # without a position every pitcher row landed under the batter market
        # (29 pitchers under `batter-strikeouts` on 2026-09-15, 9 under `walks`).
        # The snapshot has carried `meta.role` all along; it was simply dropped.
        role = meta.get("role")
        roster.append(
            RosterEntry(
                subject_id=s.get("subjectId"),
                subject_name=s.get("subjectName"),
                team_abbr=team if isinstance(team, str) else None,
                position="P" if role == "pitcher" else None,
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
                # R11b (B3): the TS snapshot's `firstPitch` is being renamed
                # `startTime` for every sport. Read the new name first so the
                # worker is ready before the TypeScript side changes; drop the
                # fallback once no cached snapshot carries `firstPitch`.
                game_date=g.get("startTime") or g.get("firstPitch") or "",
                is_final=bool(re.search(r"final", state, re.IGNORECASE)),
                roster=_roster_for_mlb_game(subjects, game_pk),
                home_team_id=str(g.get("homeTeamId")) if g.get("homeTeamId") is not None else None,
                away_team_id=str(g.get("awayTeamId")) if g.get("awayTeamId") is not None else None,
                venue=g.get("venue"),
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


# ESPN files every game under its US EASTERN date, so the days asked for are
# Eastern dates, never UTC. After 00:00Z (8pm Eastern) a UTC "today" has
# already rolled to tomorrow and drops the evening's primetime game: ESPN
# returned DAL @ NYG (kickoff 00:20Z) for `dates=20260913` and not for
# 20260914. `teamSportEspn.ts` does the same (R1d, 2026-09-14).
_ESPN_TZ = ZoneInfo("America/New_York")


class EspnScheduleError(RuntimeError):
    """ESPN's scoreboard could not be read. Never the same thing as "no games".

    Until 2026-09-19 a failed fetch returned [], and that is how four days of
    NFL, CFB, EPL and MLS props, closing lines and results went missing
    without an error. ESPN started answering every team-sport date RANGE
    (`?dates=20260919-20261003`) with HTTP 400 around 2026-09-15 20:13 UTC;
    the loader read that as an empty schedule, the gameday tier went "cold",
    and every job skipped its paid providers as if it were an off week.
    Raising puts the failure in the job's own run log, where health_check
    reports it as a failed run instead of a quiet skip.
    """


def _espn_days(days_ahead: int) -> list:
    """Every Eastern date from today to today + days_ahead, both ends included.

    A negative days_ahead walks backwards (archiveResultsJob wants the last few
    days of finals). Ordered oldest first either way.
    """
    today = datetime.now(_ESPN_TZ).date()
    step = 1 if days_ahead >= 0 else -1
    days = [today + timedelta(days=i) for i in range(0, days_ahead + step, step)]
    return sorted(days)


# ONE DATE PER REQUEST. ESPN no longer accepts a range for team sports: every
# `dates=A-B` form tried on 2026-09-19 (past, future, one day, with `limit`, on
# both site hosts) returned 400, for NFL, CFB, EPL, MLS, NBA, NHL and MLB. A
# single `dates=YYYYMMDD` still works. The month form `dates=YYYYMM` answers
# 200 but is not complete (CFB's September came back as one Saturday's 25
# games), so it is not used. Tennis ranges still work and live elsewhere.
#
# Per-day requests multiply the call count, and the archival bridge loads
# every sport every five minutes, so each day's answer is kept in-process for
# a while. Today and yesterday change minute to minute (scores, finals); a day
# further out changes when a kickoff time moves, which half an hour covers.
_DAY_CACHE_NEAR_S = 60
_DAY_CACHE_FAR_S = 30 * 60
_DAY_CONCURRENCY = 4
_day_cache: dict[tuple[str, str, str], tuple[float, list[dict]]] = {}


def _parse_scoreboard_events(data: dict) -> list[dict]:
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
        # A finished game left in the list costs SportsGameOdds a real,
        # per-game-billed request for a market that is already closed.
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
                "venue": ((comp.get("venue") or {}).get("fullName")),
                # SCORES, added 2026-09-03 for archiveResultsJob. A completed
                # game with no score is left as None rather than 0 — 0-0 is a
                # real scoreline in soccer, so coercing would manufacture results.
                "homeScore": _int_or_none(home.get("score")),
                "awayScore": _int_or_none(away.get("score")),
            }
        )
    return games


async def _fetch_espn_scoreboard_day(client: httpx.AsyncClient, espn_sport: str, espn_league: str, day) -> list[dict]:
    """One Eastern date's games. Retries once, then raises EspnScheduleError."""
    ymd = day.strftime("%Y%m%d")
    key = (espn_sport, espn_league, ymd)
    today = datetime.now(_ESPN_TZ).date()
    ttl = _DAY_CACHE_NEAR_S if abs((day - today).days) <= 1 else _DAY_CACHE_FAR_S
    hit = _day_cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < ttl:
        return hit[1]

    url = f"{_ESPN_BASE}/{espn_sport}/{espn_league}/scoreboard?dates={ymd}"
    last = ""
    for attempt in range(2):
        try:
            res = await client.get(url, timeout=httpx.Timeout(10.0))
        except httpx.HTTPError as e:
            last = f"{type(e).__name__}: {e}"
        else:
            if res.status_code == 200:
                games = _parse_scoreboard_events(res.json())
                _day_cache[key] = (time.monotonic(), games)
                return games
            last = f"HTTP {res.status_code}: {res.text[:120]}"
        if attempt == 0:
            await asyncio.sleep(1.0)
    raise EspnScheduleError(f"ESPN scoreboard {espn_sport}/{espn_league} {ymd}: {last}")


async def _fetch_espn_scoreboard(client: httpx.AsyncClient, espn_sport: str, espn_league: str, days_ahead: int) -> list[dict]:
    """Every game from today to today + days_ahead (negative walks back).

    Raises EspnScheduleError if ANY day could not be read: a schedule with a
    hole in it is how a real game day reads as a cold one, so a partial answer
    is not returned as if it were whole. The job fails this cycle and the next
    cycle retries.
    """
    days = _espn_days(days_ahead)
    sem = asyncio.Semaphore(_DAY_CONCURRENCY)

    async def one(day):
        async with sem:
            return await _fetch_espn_scoreboard_day(client, espn_sport, espn_league, day)

    results = await asyncio.gather(*(one(d) for d in days), return_exceptions=True)
    failures = [r for r in results if isinstance(r, BaseException)]
    if failures:
        raise EspnScheduleError(f"{len(failures)} of {len(days)} days unreadable; first: {failures[0]}")

    # A game sits under one Eastern date, but a postponed game can surface on
    # two; keep the first.
    seen: set[str] = set()
    games: list[dict] = []
    for day_games in results:
        for g in day_games:
            if g["gameId"] not in seen:
                seen.add(g["gameId"])
                games.append(g)
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
        # Negative days_ahead walks backwards from today, one date per request.
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
                    home_team_id=g.get("homeTeamId"),
                    away_team_id=g.get("awayTeamId"),
                    venue=g.get("venue"),
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
            # PY-A: the NHL ranking joins history on these, the same NHL API
            # ids `player_game_history.team_id` carries. Parsed and dropped
            # until now, like MLB's were before M3.
            home_team_id=g.get("homeTeamId"),
            away_team_id=g.get("awayTeamId"),
        )
        for g in by_id.values()
    ]


_TENNIS_TOUR_LEAGUE = {"tennis_atp": "atp", "tennis_wta": "wta"}

# THE TOUR ENDPOINT IS NOT THE TOUR. ESPN's atp and wta scoreboards both return
# every grouping of a joint event: at the 2026 US Open each returned men's AND
# women's singles, both doubles and the mixed doubles (measured 2026-09-13).
# Unfiltered, every joint-event match was loaded under BOTH tours, which is why
# prop_odds_archive held every ATP row a second time as tennis_wta, and doubles
# pairs arrived as "matches" with no athlete name at all. lib/sports/tennis/
# schedule.ts already filters on these slugs; this loader never did.
_TENNIS_SINGLES_SLUG = {"tennis_atp": "mens-singles", "tennis_wta": "womens-singles"}


async def _tennis_singles_competitions(sport: str) -> list[dict]:
    """This tour's singles competitions from ESPN's scoreboard, each with its
    tournament event attached as `_event`. [] on any fetch failure."""
    tour = _TENNIS_TOUR_LEAGUE[sport]
    slug = _TENNIS_SINGLES_SLUG[sport]
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{_ESPN_BASE}/tennis/{tour}/scoreboard", timeout=httpx.Timeout(10.0))
    except httpx.HTTPError:
        return []
    if res.status_code != 200:
        return []
    data = res.json()
    out: list[dict] = []
    for ev in data.get("events") or []:
        for grouping in ev.get("groupings") or []:
            if ((grouping.get("grouping") or {}).get("slug")) != slug:
                continue
            for comp in grouping.get("competitions") or []:
                out.append({**comp, "_event": ev})
    return out


def _tennis_sides(comp: dict) -> tuple[dict, dict] | None:
    competitors = comp.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    # The athlete id is the competitor object's own "id", NOT athlete["id"] —
    # the nested athlete dict carries guid/displayName/fullName/flag/links but
    # no bare id field (confirmed live against ESPN's real response). Reading
    # athlete["id"] here always misses, which silently dropped every tennis
    # match (this loader returned an empty list).
    if not home or not away or not home.get("id") or not away.get("id"):
        return None
    return home, away


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

    SINGLES OF THIS TOUR ONLY — see _TENNIS_SINGLES_SLUG.
    """
    games: list[Game] = []
    for comp in await _tennis_singles_competitions(sport):
        sides = _tennis_sides(comp)
        if sides is None:
            continue
        home, away = sides
        home_athlete = home.get("athlete") or {}
        away_athlete = away.get("athlete") or {}
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
                    RosterEntry(subject_id=f"espn:tennis:{home['id']}", subject_name=home_athlete.get("fullName") or ""),
                    RosterEntry(subject_id=f"espn:tennis:{away['id']}", subject_name=away_athlete.get("fullName") or ""),
                ],
            )
        )
    return games


async def completed_tennis_matches(sport: str) -> list[dict]:
    """Finished singles matches for this tour, in the dict shape
    archival_bridge.archive_results builds rows from.

    SCORES ARE SETS WON, the convention tennis_data's game_result rows already
    use. `homeWinner`/`awayWinner` carry ESPN's own winner flag separately,
    because a retirement can leave the set count level or even favour the
    player who lost."""
    out: list[dict] = []
    for comp in await _tennis_singles_competitions(sport):
        status = ((comp.get("status") or {}).get("type") or {})
        if not status.get("completed"):
            continue
        sides = _tennis_sides(comp)
        if sides is None:
            continue
        home, away = sides
        out.append({
            "gameId": str(comp.get("id")),
            "date": comp.get("date"),
            "homeAthleteId": str(home["id"]),
            "awayAthleteId": str(away["id"]),
            "homeTeamName": (home.get("athlete") or {}).get("fullName") or "",
            "awayTeamName": (away.get("athlete") or {}).get("fullName") or "",
            "homeScore": sum(1 for ls in (home.get("linescores") or []) if ls.get("winner")),
            "awayScore": sum(1 for ls in (away.get("linescores") or []) if ls.get("winner")),
            "homeWinner": bool(home.get("winner")),
            "awayWinner": bool(away.get("winner")),
            "venue": ((comp.get("venue") or {}).get("fullName")),
            "statusName": status.get("name"),
        })
    return out
