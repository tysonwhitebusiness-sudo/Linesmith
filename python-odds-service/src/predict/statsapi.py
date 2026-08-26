"""Direct port of lib/sports/mlb/statsapi.ts — not a reimplementation.
MLB Stats API client (statsapi.mlb.com — official, free, no key).

Originally scoped to exactly what Layer 1 needed (confirmed against the
real imports in simRates.ts and eloModel.ts): get_people_with_game_logs,
get_league_batter_season_rows, get_league_starting_pitcher_stats,
get_league_pitcher_role_pools, get_active_roster, get_schedule_range,
get_live_feed, eastern_date, get_team_bullpen_era. Phase K of the TS
cutover gameplan (docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md)
added get_team_season_stats/rank_teams, get_standings, and get_handedness —
the team-level inputs adapter.ts's own gameModel computation needs, none of
which the player/lineup-focused Phases B-D required. Still NOT ported:
injuries, team identity (getAllTeams/getTeamInfo), recent-results — genuinely
unused by the prediction pipeline, only by Teams/Diagnostics pages.

Two disclosed adaptations, neither a behavior change a caller could observe:
- Every function takes `client: httpx.AsyncClient` as an explicit first
  argument, matching this worker's existing convention (providers.py,
  game_context.py) rather than TS's implicit global `fetch`.
- The in-process response cache (TTL + stale-while-revalidate + background-
  refresh dedup) is preserved exactly, but keyed off `time.monotonic()`
  instead of wall-clock `Date.now()` — immune to a system clock adjustment,
  otherwise identical arithmetic.

Everything else — batching (40 ids/batch), concurrency limit (3), the
field-trimming allow-list on the game-log endpoint (this specific tuning is
hard-won: the TS comment documents it fixed a real silent-data-loss bug from
request timeouts) — is preserved verbatim, not just "call the endpoint."
"""
import asyncio
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

_BASE = "https://statsapi.mlb.com/api"

# ---------------------------------------------------------------------------
# In-process response cache — TTL + stale-while-revalidate + background-
# refresh dedup, same shape as the TS source's module-local Map/Set.
# ---------------------------------------------------------------------------


class _CacheEntry:
    __slots__ = ("value", "expires_at")

    def __init__(self, value, expires_at: float):
        self.value = value
        self.expires_at = expires_at


_cache: dict[str, _CacheEntry] = {}
# Keys with a background refresh already in flight — collapses concurrent
# callers hitting the same stale key into a single upstream fetch instead of
# each firing its own.
_refreshing: set[str] = set()

# Dedicated, persistent client for background refreshes only — deliberately
# NOT the caller's own `client` argument. Real bug found live (Render logs,
# 2026-08-22): every caller passes a short-lived client from its own
# `async with httpx.AsyncClient() as client:` block, which closes as soon as
# that caller's own job function returns. `asyncio.create_task` only
# schedules the background refresh — it doesn't run before the caller's
# `async with` exits — so a refresh queued near the end of a job's run would
# fire against an already-closed client (`RuntimeError: Cannot send a
# request, as the client has been closed`), crash, and leave an unretrieved
# task exception. A refresh client that outlives any single caller's own
# client removes the race at its root instead of requiring every caller to
# remember to await pending refreshes before closing its own client.
_background_client: httpx.AsyncClient | None = None


def _get_background_client() -> httpx.AsyncClient:
    global _background_client
    if _background_client is None or _background_client.is_closed:
        _background_client = httpx.AsyncClient()
    return _background_client

_FETCH_ERROR_LIMIT = 20
_fetch_errors: list[dict] = []


def recent_fetch_errors() -> list[dict]:
    """Why the most recent fetches failed. _get_json returns None on every
    kind of failure (the right shape for callers, but indistinguishable from
    a genuinely empty result) — this keeps the last handful of reasons for a
    diagnostics surface to show what actually broke."""
    return list(_fetch_errors)


def _note_failure(url: str, reason: str) -> None:
    _fetch_errors.insert(0, {"url": url[:160], "reason": reason, "at": datetime.now(timezone.utc).isoformat()})
    del _fetch_errors[_FETCH_ERROR_LIMIT:]


async def _get_json(client: httpx.AsyncClient, url: str, timeout_s: float = 30.0):
    try:
        res = await client.get(url, timeout=httpx.Timeout(timeout_s), headers={"accept": "application/json"})
    except httpx.HTTPError as e:
        _note_failure(url, f"{type(e).__name__}: {e}")
        return None
    if res.status_code != 200:
        _note_failure(url, f"HTTP {res.status_code}")
        return None
    try:
        return res.json()
    except ValueError as e:
        _note_failure(url, f"{type(e).__name__}: {e}")
        return None


async def _fetch_and_cache(client: httpx.AsyncClient, key: str, url: str, ttl_s: float, retries: int):
    value = await _get_json(client, url)
    # One retry. A single transient failure in a batched fetch silently drops
    # every player in that batch — 40 at a time — with no indication which
    # players are missing or why.
    attempt = 0
    while value is None and attempt < retries:
        value = await _get_json(client, url)
        attempt += 1
    # Only cache successes; a failed fetch should be retried on the next refresh.
    if value is not None:
        _cache[key] = _CacheEntry(value, time.monotonic() + ttl_s)
    return value


async def _cached_json(client: httpx.AsyncClient, key: str, url: str, ttl_s: float, retries: int = 1):
    """Stale-while-revalidate: a key that has been fetched before is always
    answered from cache immediately, even past its TTL, while a background
    fetch quietly brings it current for next time. Only a key that has never
    been fetched blocks its caller on the network."""
    hit = _cache.get(key)
    if hit is not None:
        if hit.expires_at <= time.monotonic() and key not in _refreshing:
            _refreshing.add(key)

            async def _background_refresh():
                try:
                    # Deliberately the module's own long-lived client, not
                    # the caller's `client` — see _background_client's
                    # comment above for why.
                    await _fetch_and_cache(_get_background_client(), key, url, ttl_s, retries)
                except Exception as e:
                    # Best-effort: a failed background refresh just leaves
                    # the cache stale until the next attempt, same as any
                    # other _get_json failure. Logged, not silent — but
                    # never allowed to surface as an unretrieved task
                    # exception, which is noise, not a real signal.
                    print(f"[statsapi] background refresh failed for {key}: {type(e).__name__}: {e}", flush=True)
                finally:
                    _refreshing.discard(key)

            asyncio.create_task(_background_refresh())
        return hit.value
    return await _fetch_and_cache(client, key, url, ttl_s, retries)


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

_EASTERN = ZoneInfo("America/New_York")


def eastern_date(now: datetime | None = None) -> str:
    """MLB's "today" is the US Eastern date, not the server's local date."""
    dt = (now if now is not None else datetime.now(timezone.utc)).astimezone(_EASTERN)
    return dt.strftime("%Y-%m-%d")


def shift_date(iso_date: str, days: int) -> str:
    d = datetime.fromisoformat(f"{iso_date}T12:00:00+00:00") + timedelta(days=days)
    return d.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------


@dataclass
class MlbGame:
    game_pk: int
    game_date: str
    detailed_state: str
    abstract_state: str
    day_night: str | None
    # venue/teams/lineups/linescore are passed through as raw dicts, same as
    # the TS source's own loosely-typed nested fields — flatten_games doesn't
    # reparse them, only lifts them out of the schedule/date/game nesting.
    venue: dict | None
    teams: dict
    lineups: dict | None
    linescore: dict | None


def _flatten_games(schedule: dict | None) -> list[MlbGame]:
    out: list[MlbGame] = []
    for date in (schedule or {}).get("dates") or []:
        for game in (date or {}).get("games") or []:
            status = game.get("status") or {}
            out.append(
                MlbGame(
                    game_pk=game.get("gamePk"),
                    game_date=game.get("gameDate"),
                    detailed_state=status.get("detailedState") or "Unknown",
                    abstract_state=status.get("abstractGameState") or "Unknown",
                    day_night=game.get("dayNight"),
                    venue=game.get("venue"),
                    teams=game.get("teams") or {},
                    lineups=game.get("lineups"),
                    linescore=game.get("linescore"),
                )
            )
    return out


async def get_schedule_range(client: httpx.AsyncClient, start_date: str, end_date: str) -> list[MlbGame]:
    """A window of past games carrying per-inning linescores and probable
    pitchers. One request replaces hundreds of per-game fetches. `score` has
    to be named explicitly in `fields` — the Stats API's fields allow-list
    drops anything not listed, and its absence silently makes every team's
    final score missing."""
    url = (
        f"{_BASE}/v1/schedule?sportId=1&startDate={start_date}&endDate={end_date}"
        "&gameType=R&hydrate=linescore,probablePitcher,team,venue"
        "&fields=dates,games,gamePk,gameDate,status,detailedState,abstractGameState,teams,away,home,team,id,name,abbreviation,score,probablePitcher,fullName,linescore,innings,num,runs,venue"
    )
    json_data = await _cached_json(client, f"range:{start_date}:{end_date}", url, 30 * 60)
    return _flatten_games(json_data) if json_data else []


async def get_slate(client: httpx.AsyncClient, date: str) -> list[MlbGame]:
    """Today's slate, with probables, posted lineups and venue coordinates."""
    url = f"{_BASE}/v1/schedule?sportId=1&date={date}" "&hydrate=probablePitcher,linescore,team,lineups,venue(location)"
    json_data = await _cached_json(client, f"slate:{date}", url, 60)
    return _flatten_games(json_data) if json_data else []


async def get_recent_lineups(client: httpx.AsyncClient, end_date: str, days: int = 4) -> list[MlbGame]:
    """Recent posted lineups, used to project a lineup before today's is announced."""
    start = shift_date(end_date, -days)
    url = f"{_BASE}/v1/schedule?sportId=1&startDate={start}&endDate={end_date}&hydrate=lineups,team"
    json_data = await _cached_json(client, f"lineups:{start}:{end_date}", url, 15 * 60)
    return _flatten_games(json_data) if json_data else []


# ---------------------------------------------------------------------------
# Live feed
# ---------------------------------------------------------------------------


@dataclass
class MlbLiveFeed:
    game_pk: int
    linescore: dict
    boxscore: dict
    game_data: dict
    plays: dict


async def get_live_feed(client: httpx.AsyncClient, game_pk: int) -> MlbLiveFeed | None:
    """Deliberately uncached: this is the only genuinely live data in the app."""
    json_data = await _get_json(client, f"{_BASE}/v1.1/game/{game_pk}/feed/live")
    if not json_data:
        return None
    live_data = json_data.get("liveData") or {}
    return MlbLiveFeed(
        game_pk=game_pk,
        linescore=live_data.get("linescore") or {},
        boxscore=live_data.get("boxscore") or {},
        game_data=json_data.get("gameData") or {},
        plays=live_data.get("plays") or {},
    )


# ---------------------------------------------------------------------------
# People / stats
# ---------------------------------------------------------------------------


@dataclass
class GameLogSplit:
    date: str
    is_home: bool
    game_pk: int | None
    opponent_id: int | None
    opponent_name: str | None
    team_id: int | None
    stat: dict


@dataclass
class PersonStats:
    id: int
    full_name: str
    bat_side: str | None
    pitch_hand: str | None
    primary_position: str | None
    game_log: list[GameLogSplit]


def _parse_people(json_data: dict | None) -> list[PersonStats]:
    out: list[PersonStats] = []
    for person in (json_data or {}).get("people") or []:
        logs = next(
            (s for s in (person.get("stats") or []) if ((s or {}).get("type") or {}).get("displayName") == "gameLog"),
            None,
        )
        splits = (logs or {}).get("splits") or []
        out.append(
            PersonStats(
                id=person.get("id"),
                full_name=person.get("fullName"),
                bat_side=(person.get("batSide") or {}).get("code"),
                pitch_hand=(person.get("pitchHand") or {}).get("code"),
                primary_position=(person.get("primaryPosition") or {}).get("abbreviation"),
                game_log=[
                    GameLogSplit(
                        date=split.get("date"),
                        is_home=bool(split.get("isHome")),
                        game_pk=(split.get("game") or {}).get("gamePk"),
                        opponent_id=(split.get("opponent") or {}).get("id"),
                        opponent_name=(split.get("opponent") or {}).get("name"),
                        team_id=(split.get("team") or {}).get("id"),
                        stat=split.get("stat") or {},
                    )
                    for split in splits
                ],
            )
        )
    return out


# Ask only for the fields we read (see module docstring — this specific
# tuning fixed a real silent-data-loss bug from request timeouts on the
# unfiltered payload). MLB's `fields` parameter is a flat allow-list of key
# names matched at any depth, so nested keys are listed by their leaf name —
# anything a consumer needs must appear here.
GAME_LOG_FIELDS = "fields=" + ",".join(
    [
        "people,id,fullName,batSide,code,pitchHand,primaryPosition,abbreviation",
        "stats,type,displayName,splits,date,isHome,game,gamePk,opponent,name,team",
        "stat,hits,atBats,plateAppearances,gamesStarted,runs,doubles,triples,homeRuns",
        "rbi,baseOnBalls,strikeOuts,totalBases,stolenBases,hitByPitch,earnedRuns,inningsPitched",
    ]
)


def _chunk(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


async def _map_limit(items: list, limit: int, fn) -> list:
    """Map with bounded concurrency — same reasoning as the TS source: firing
    every batch at once is measurably worse against this API than running a
    few at a time. No lock needed around `next_index`: like JS, Python
    asyncio is single-threaded cooperative concurrency, and there's no
    `await` between reading and incrementing it, so no other coroutine can
    interleave mid-increment."""
    results: list = [None] * len(items)
    next_index = 0

    async def worker():
        nonlocal next_index
        while next_index < len(items):
            index = next_index
            next_index += 1
            results[index] = await fn(items[index])

    worker_count = min(limit, len(items))
    await asyncio.gather(*(worker() for _ in range(worker_count)))
    return results


def _is_finite_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


async def get_people_with_game_logs(
    client: httpx.AsyncClient,
    ids: list[int],
    group: str,  # 'hitting' | 'pitching'
    season: int,
    batch_size: int = 40,
) -> dict[int, PersonStats]:
    """Batched player fetch with season game logs. `ids` accepts many per
    request, which is what keeps a full slate to a handful of calls."""
    unique = list(dict.fromkeys(i for i in ids if _is_finite_number(i)))
    out: dict[int, PersonStats] = {}
    if not unique:
        return out

    batches = _chunk(unique, batch_size)

    async def fetch_batch(batch: list[int]):
        ids_param = ",".join(str(i) for i in batch)
        key = f"people:{group}:{season}:{ids_param}"
        url = f"{_BASE}/v1/people?personIds={ids_param}" f"&hydrate=stats(group={group},type=gameLog,season={season})" f"&{GAME_LOG_FIELDS}"
        return await _cached_json(client, key, url, 10 * 60)

    results = await _map_limit(batches, 3, fetch_batch)
    for json_data in results:
        for person in _parse_people(json_data):
            out[person.id] = person
    return out


# ---------------------------------------------------------------------------
# League-wide pitcher season rows / role pools
# ---------------------------------------------------------------------------


def _num(v) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n == n and n not in (float("inf"), float("-inf")) else None


def _parse_innings_pitched(raw) -> float | None:
    """IP is reported as e.g. "6.1" meaning 6 and 1/3 innings, not 6.1
    innings — the fractional part is thirds, not tenths."""
    s = raw if isinstance(raw, str) else ("" if raw is None else str(raw))
    m = re.match(r"^(-?\d+)(?:\.(\d))?$", s)
    if not m:
        return None
    whole = float(m.group(1))
    thirds = float(m.group(2)) if m.group(2) else 0.0
    if thirds > 2:
        return None
    return whole + thirds / 3


def _compute_fip(hr: float, bb: float, hbp: float, k: float, ip: float) -> float | None:
    """Same run-value scale as ERA, built only from what a pitcher directly
    controls (HR/BB/HBP/K). Standard constant of 3.10."""
    if not (ip > 0):
        return None
    return (13 * hr + 3 * (bb + hbp) - 2 * k) / ip + 3.10


def _compute_kbb_pct(k: float, bb: float, batters_faced: float) -> float | None:
    if not (batters_faced > 0):
        return None
    return ((k - bb) / batters_faced) * 100


@dataclass
class RawPitcherSeasonLine:
    """Everything classify_pitcher_role needs, straight off the season-stats
    response — kept separate from PitcherStatLine.values since these are role
    signals, not ranked stats."""

    person_id: int
    full_name: str
    team_id: int | None
    games_started: int
    games_pitched: int
    games_finished: int
    innings_pitched: float
    saves: int
    save_opportunities: int
    holds: int
    blown_saves: int


@dataclass
class PitcherStatLine:
    person_id: int
    full_name: str
    games_started: int
    values: dict = field(default_factory=dict)


# Team-level opponent rank (rank_teams) is whole-staff, bullpen included —
# real, but blunt: a batter facing a team's ace tonight is facing a
# different pitcher than the one who dragged that team's bullpen ERA down.
# This ranks the individual starter against every other MLB starter, for
# exactly the stats a batter-prop matchup bullet cares about.
PITCHER_RANK_KEYS: list[dict] = [
    {"key": "era", "decimals": 2},
    {"key": "strikeOuts", "decimals": 0},
    {"key": "baseOnBalls", "decimals": 0},
    {"key": "hits", "decimals": 0},
    {"key": "homeRuns", "decimals": 0},
    {"key": "whip", "decimals": 2},
    {"key": "fip", "decimals": 2},
    {"key": "kbbPct", "decimals": 1},
    # Statcast quality metrics — only populated for pitchers merged with
    # savant.py's rates before ranking; get_league_starting_pitcher_stats
    # (the live per-scan hot path) never sets these, so they silently drop
    # out of that pool's cards rather than showing as zero/undefined.
    {"key": "whiffPct", "decimals": 1},
    {"key": "barrelPct", "decimals": 1},
    {"key": "exitVelo", "decimals": 1},
    {"key": "hardHitPct", "decimals": 1},
]

# Lower reads as better pitching for these; strikeouts/K-BB%/whiff% are the
# ones that invert (more is better), same reasoning as
# PITCHING_RANK_INVERTED_KEYS above.
PITCHER_RANK_LOWER_IS_BETTER = {"era", "baseOnBalls", "hits", "homeRuns", "whip", "fip", "barrelPct", "exitVelo", "hardHitPct"}


def rank_pitchers(lines: list[PitcherStatLine]) -> dict[int, dict[str, int]]:
    """Rank among starters only (not the full 700+ league pool, which would
    dilute a rookie starter's rank with relief-only arms). 1 = best."""
    ranks: dict[int, dict[str, int]] = {line.person_id: {} for line in lines}

    for entry in PITCHER_RANK_KEYS:
        key = entry["key"]
        lower_is_better = key in PITCHER_RANK_LOWER_IS_BETTER
        with_value = [line for line in lines if line.values.get(key) is not None]
        with_value.sort(key=lambda line: line.values[key], reverse=not lower_is_better)

        for index, line in enumerate(with_value):
            bucket = ranks.get(line.person_id)
            if bucket is not None:
                bucket[key] = index + 1

    return ranks


@dataclass
class LeaguePitcherSeasonRow:
    raw: RawPitcherSeasonLine
    stat: PitcherStatLine


async def _get_league_pitcher_season_rows(client: httpx.AsyncClient, season: int) -> list[LeaguePitcherSeasonRow]:
    """Every pitcher who's appeared this season, league-wide, in one cached
    call — starters and relievers alike. `playerPool=all` is needed because
    the default pool applies MLB's own "qualified" innings threshold, which
    mid-season excludes recent call-ups, injury-return starters, and most
    relievers entirely."""
    url = f"{_BASE}/v1/stats?stats=season&group=pitching&season={season}&sportId=1&limit=1000&gameType=R&playerPool=all"
    json_data = await _cached_json(client, f"pitcher-league-stats:{season}", url, 60 * 60)
    stats = (json_data or {}).get("stats") or []
    splits = (stats[0].get("splits") if stats else None) or []

    out: list[LeaguePitcherSeasonRow] = []
    for s in splits:
        person_id = (s.get("player") or {}).get("id")
        if person_id is None:
            continue
        stat = s.get("stat") or {}
        ip = _parse_innings_pitched(stat.get("inningsPitched"))
        hr = _num(stat.get("homeRuns")) or 0
        bb = _num(stat.get("baseOnBalls")) or 0
        hbp = _num(stat.get("hitBatsmen")) or 0
        k = _num(stat.get("strikeOuts")) or 0
        batters_faced = _num(stat.get("battersFaced"))
        team_id = (s.get("team") or {}).get("id")
        full_name = (s.get("player") or {}).get("fullName") or ""
        games_started = int(_num(stat.get("gamesStarted")) or 0)

        out.append(
            LeaguePitcherSeasonRow(
                raw=RawPitcherSeasonLine(
                    person_id=person_id,
                    full_name=full_name,
                    team_id=team_id if _is_finite_number(team_id) else None,
                    games_started=games_started,
                    games_pitched=int(_num(stat.get("gamesPitched")) or 0),
                    games_finished=int(_num(stat.get("gamesFinished")) or 0),
                    innings_pitched=ip or 0,
                    saves=int(_num(stat.get("saves")) or 0),
                    save_opportunities=int(_num(stat.get("saveOpportunities")) or 0),
                    holds=int(_num(stat.get("holds")) or 0),
                    blown_saves=int(_num(stat.get("blownSaves")) or 0),
                ),
                stat=PitcherStatLine(
                    person_id=person_id,
                    full_name=full_name,
                    games_started=games_started,
                    values={
                        "era": _num(stat.get("era")),
                        "strikeOuts": k,
                        "baseOnBalls": bb,
                        "hits": _num(stat.get("hits")),
                        "homeRuns": hr,
                        "whip": _num(stat.get("whip")),
                        "fip": _compute_fip(hr, bb, hbp, k, ip) if ip is not None else None,
                        "kbbPct": _compute_kbb_pct(k, bb, batters_faced) if batters_faced is not None else None,
                    },
                ),
            )
        )
    return out


_MIN_APPEARANCES_FOR_RELIEF_RANK = 10
# Save-opportunity share above which a reliever reads as "the closer," not
# just someone who picked up a save.
_CLOSER_SAVE_OPPORTUNITY_SHARE = 0.4


def classify_pitcher_role(line: RawPitcherSeasonLine) -> str | None:
    """A pitcher's role this season, from usage pattern alone. None means
    "not enough appearances of any kind to classify" — deliberately excluded
    from every pool rather than guessed at. Closer is checked before
    reliever: a real 9th-inning arm still qualifies even in a season with
    relatively few appearances so far, as long as a good share were save
    chances."""
    if line.games_started >= 3:
        return "starter"
    relief = line.games_pitched - line.games_started
    if relief < _MIN_APPEARANCES_FOR_RELIEF_RANK:
        return None
    save_share = (line.save_opportunities / relief) if relief > 0 else 0
    if line.save_opportunities >= 5 and save_share >= _CLOSER_SAVE_OPPORTUNITY_SHARE:
        return "closer"
    return "reliever"


async def get_league_starting_pitcher_stats(client: httpx.AsyncClient, season: int) -> list[PitcherStatLine]:
    """Every pitcher with at least one start this season, league-wide."""
    rows = await _get_league_pitcher_season_rows(client, season)
    return [r.stat for r in rows if r.raw.games_started > 0]


@dataclass
class LeaguePitcherPools:
    """The full league pool split into role-classified groups — starters
    (same pool get_league_starting_pitcher_stats returns), plus closers and
    relievers, which the starters-only view excludes entirely."""

    starters: list[LeaguePitcherSeasonRow]
    closers: list[LeaguePitcherSeasonRow]
    relievers: list[LeaguePitcherSeasonRow]


async def get_league_pitcher_role_pools(client: httpx.AsyncClient, season: int) -> LeaguePitcherPools:
    rows = await _get_league_pitcher_season_rows(client, season)
    pools = LeaguePitcherPools(starters=[], closers=[], relievers=[])
    for row in rows:
        role = classify_pitcher_role(row.raw)
        if role == "starter":
            pools.starters.append(row)
        elif role == "closer":
            pools.closers.append(row)
        elif role == "reliever":
            pools.relievers.append(row)
    return pools


# ---------------------------------------------------------------------------
# League-wide batter season rows
# ---------------------------------------------------------------------------


@dataclass
class RawBatterSeasonLine:
    """Batters have no traditional-stat-merged ranking pipeline the way
    pitchers do — this exists to answer "which team and position is this
    batter", id + team + position, plus the traditional rate/count stats
    already sitting in the same response."""

    person_id: int
    full_name: str
    team_id: int | None
    position: str
    avg: float | None = None
    obp: float | None = None
    slg: float | None = None
    ops: float | None = None
    home_runs: float | None = None
    rbi: float | None = None


async def get_league_batter_season_rows(client: httpx.AsyncClient, season: int) -> list[RawBatterSeasonLine]:
    url = f"{_BASE}/v1/stats?stats=season&group=hitting&season={season}&sportId=1&limit=1500&gameType=R&playerPool=all"
    json_data = await _cached_json(client, f"batter-league-teamids:{season}", url, 60 * 60)
    stats = (json_data or {}).get("stats") or []
    splits = (stats[0].get("splits") if stats else None) or []

    out: list[RawBatterSeasonLine] = []
    for s in splits:
        person_id = (s.get("player") or {}).get("id")
        position = (s.get("position") or {}).get("abbreviation")
        # Pitchers' own occasional at-bats (position 'P') are excluded —
        # this pool is "batters", not "everyone who's ever swung a bat".
        if person_id is None or not position or position == "P":
            continue
        stat = s.get("stat") or {}
        team_id = (s.get("team") or {}).get("id")
        out.append(
            RawBatterSeasonLine(
                person_id=person_id,
                full_name=(s.get("player") or {}).get("fullName") or "",
                team_id=team_id if _is_finite_number(team_id) else None,
                position=position,
                avg=_num(stat.get("avg")),
                obp=_num(stat.get("obp")),
                slg=_num(stat.get("slg")),
                ops=_num(stat.get("ops")),
                home_runs=_num(stat.get("homeRuns")),
                rbi=_num(stat.get("rbi")),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Team identity / roster (active roster only — Layer 1 scope)
# ---------------------------------------------------------------------------


@dataclass
class RosterEntry:
    """Distinct from entity_resolution.RosterEntry — same name, different
    module/namespace (predict.statsapi.RosterEntry), matching the TS
    source's own separate RosterEntry interface in statsapi.ts. Watch for
    this if a future phase imports both unqualified into the same file."""

    id: int
    full_name: str
    position: str


async def get_team_bullpen_era(client: httpx.AsyncClient, team_id: int, season: int, ttl_s: float = 60 * 60) -> float | None:
    """A team's season-aggregate RELIEF-only ERA — `stats=statSplits&sitCodes=rp`
    is the verified query shape that actually isolates bullpen work from the
    team's whole pitching staff."""
    url = f"{_BASE}/v1/teams/{team_id}/stats?stats=statSplits&group=pitching&season={season}&sportId=1&gameType=R&sitCodes=rp"
    json_data = await _cached_json(client, f"bullpen-era:{team_id}:{season}", url, ttl_s)
    stats = (json_data or {}).get("stats") or []
    splits = (stats[0].get("splits") if stats else None) or []
    era = (splits[0].get("stat") or {}).get("era") if splits else None
    return _num(era)


async def get_active_roster(client: httpx.AsyncClient, team_id: int, season: int) -> list[RosterEntry]:
    """The active 26-man roster, not the full-season one — a listing of
    every player who's been on the roster at any point this year (call-ups,
    released, traded away) would misrepresent who's actually on the team
    today."""
    url = f"{_BASE}/v1/teams/{team_id}/roster?rosterType=active&season={season}"
    json_data = await _cached_json(client, f"roster-active:{team_id}:{season}", url, 60 * 60)
    out: list[RosterEntry] = []
    for entry in (json_data or {}).get("roster") or []:
        person = entry.get("person") or {}
        if person.get("id") is None:
            continue
        out.append(
            RosterEntry(
                id=person["id"],
                full_name=person.get("fullName") or "Unknown",
                position=(entry.get("position") or {}).get("abbreviation") or "",
            )
        )
    return out


# ---------------------------------------------------------------------------
# Team season stats and league ranks (Phase K of the prediction-engine port)
# ---------------------------------------------------------------------------

# The stat set both reference products compare teams on, in their order.
# `key` is what the API calls it; `label` is what a scoreboard calls it.
TEAM_STAT_KEYS: list[dict] = [
    {"key": "runs", "label": "R", "decimals": 0},
    {"key": "hits", "label": "H", "decimals": 0},
    {"key": "singles", "label": "1B", "decimals": 0},
    {"key": "doubles", "label": "2B", "decimals": 0},
    {"key": "triples", "label": "3B", "decimals": 0},
    {"key": "totalBases", "label": "TB", "decimals": 0},
    {"key": "earnedRuns", "label": "ER", "decimals": 0},
    {"key": "homeRuns", "label": "HR", "decimals": 0},
    {"key": "rbi", "label": "RBI", "decimals": 0},
    {"key": "baseOnBalls", "label": "BB", "decimals": 0},
    {"key": "strikeOuts", "label": "SO", "decimals": 0},
    {"key": "stolenBases", "label": "SB", "decimals": 0},
    {"key": "avg", "label": "AVG", "decimals": 3},
    {"key": "obp", "label": "OBP", "decimals": 3},
    {"key": "slg", "label": "SLG", "decimals": 3},
    {"key": "ops", "label": "OPS", "decimals": 3},
]
TEAM_STAT_KEY_NAMES: list[str] = [k["key"] for k in TEAM_STAT_KEYS]


@dataclass
class TeamStatLine:
    team_id: int
    team_name: str
    games_played: int
    values: dict = field(default_factory=dict)


def _read_stat_line(split: dict) -> TeamStatLine:
    """Singles aren't reported directly — they're hits minus the
    extra-base hits. Deriving it here keeps the comparison table's stat
    list complete without inventing a number, since every term is a real
    reported figure."""
    raw = split.get("stat") or {}
    hits = _num(raw.get("hits"))
    doubles = _num(raw.get("doubles"))
    triples = _num(raw.get("triples"))
    home_runs = _num(raw.get("homeRuns"))
    singles = hits - doubles - triples - home_runs if None not in (hits, doubles, triples, home_runs) else None

    return TeamStatLine(
        team_id=(split.get("team") or {}).get("id"),
        team_name=(split.get("team") or {}).get("name") or "",
        games_played=_num(raw.get("gamesPlayed")) or 0,
        values={
            "runs": _num(raw.get("runs")),
            "hits": hits,
            "singles": singles,
            "doubles": doubles,
            "triples": triples,
            "totalBases": _num(raw.get("totalBases")),
            "earnedRuns": _num(raw.get("earnedRuns")),
            "homeRuns": home_runs,
            "rbi": _num(raw.get("rbi")),
            "baseOnBalls": _num(raw.get("baseOnBalls")),
            "strikeOuts": _num(raw.get("strikeOuts")),
            "stolenBases": _num(raw.get("stolenBases")),
            "avg": _num(raw.get("avg")),
            "obp": _num(raw.get("obp")),
            "slg": _num(raw.get("slg")),
            "ops": _num(raw.get("ops")),
        },
    )


async def get_team_season_stats(client: httpx.AsyncClient, season: int, group: str) -> list[TeamStatLine]:
    """Season totals for all 30 teams in one call, per group ('hitting' |
    'pitching'). `hitting` is what a team does; `pitching` is what it
    allows — which is what makes an opponent's pitching rank a genuine
    defensive-matchup signal rather than a guess."""
    url = f"{_BASE}/v1/teams/stats?season={season}&stats=season&group={group}&sportIds=1"
    json_data = await _cached_json(client, f"teamstats:{group}:{season}", url, 60 * 60)
    stats = (json_data or {}).get("stats") or []
    splits = (stats[0].get("splits") if stats else None) or []
    lines = [_read_stat_line(s) for s in splits]
    return [line for line in lines if _is_finite_number(line.team_id)]


# Pitching's one exception to "fewer allowed is better": strikeouts are
# something the pitching staff *records*, not something it *allows* — a
# staff that strikes out more batters is pitching better, the opposite
# direction from hits/walks/runs/HR allowed.
PITCHING_RANK_INVERTED_KEYS = {"strikeOuts"}

TeamRanks = dict  # team_id -> {stat_key: rank}


def rank_teams(lines: list[TeamStatLine], higher_is_better: bool, invert_keys: set[str] | None = None) -> dict[int, dict[str, int]]:
    """League rank per team per stat, 1 = best. "Best" depends on which
    side of the ball you're on: for a team's own hitting, more runs is
    better; for what it allows, fewer is better. `higher_is_better` flips
    the sort so a rank of 1 always reads as "strongest" and 30 as "most
    exploitable". `invert_keys` flips that default back for the specific
    stats (see PITCHING_RANK_INVERTED_KEYS) where the group's general rule
    doesn't hold."""
    invert_keys = invert_keys or set()
    ranks: dict[int, dict[str, int]] = {line.team_id: {} for line in lines}

    for key in TEAM_STAT_KEY_NAMES:
        want_higher = (not higher_is_better) if key in invert_keys else higher_is_better
        with_value = [line for line in lines if line.values.get(key) is not None]
        with_value.sort(key=lambda line: line.values[key], reverse=want_higher)

        for index, line in enumerate(with_value):
            bucket = ranks.get(line.team_id)
            if bucket is not None:
                bucket[key] = index + 1

    return ranks


# ---------------------------------------------------------------------------
# Standings
# ---------------------------------------------------------------------------


@dataclass
class StandingsRecordSplit:
    wins: int
    losses: int


@dataclass
class TeamRecord:
    team_id: int
    wins: int
    losses: int
    division_rank: str
    home_record: StandingsRecordSplit | None = None
    away_record: StandingsRecordSplit | None = None
    last_ten: StandingsRecordSplit | None = None
    # e.g. "American League East" / "AL East" — absent from the response
    # unless division/league are hydrated explicitly.
    division_name: str | None = None
    division_short_name: str | None = None
    league_name: str | None = None
    # "-" for the division leader, otherwise a games-back string like "3.5".
    games_back: str | None = None


async def get_standings(client: httpx.AsyncClient, season: int) -> dict[int, TeamRecord]:
    """Records, division placement and league/division names for every
    team, in one call."""
    url = f"{_BASE}/v1/standings?leagueId=103,104&season={season}&standingsTypes=regularSeason&hydrate=team,division,league"
    json_data = await _cached_json(client, f"standings:{season}", url, 30 * 60)
    out: dict[int, TeamRecord] = {}

    for record in (json_data or {}).get("records") or []:
        division_name = (record.get("division") or {}).get("name")
        division_short_name = (record.get("division") or {}).get("nameShort")
        league_name = (record.get("league") or {}).get("name")

        for entry in record.get("teamRecords") or []:
            team_id = (entry.get("team") or {}).get("id")
            if not team_id:
                continue

            # Home/away live under overallRecords; lastTen only under splitRecords.
            splits = ((entry.get("records") or {}).get("overallRecords") or []) + ((entry.get("records") or {}).get("splitRecords") or [])

            def find(split_type: str) -> StandingsRecordSplit | None:
                hit = next((s for s in splits if s.get("type") == split_type), None)
                return StandingsRecordSplit(wins=_num(hit.get("wins")) or 0, losses=_num(hit.get("losses")) or 0) if hit else None

            games_back = entry.get("gamesBack")
            out[team_id] = TeamRecord(
                team_id=team_id,
                wins=int(_num(entry.get("wins")) or 0),
                losses=int(_num(entry.get("losses")) or 0),
                division_rank=str(entry.get("divisionRank") or ""),
                home_record=find("home"),
                away_record=find("away"),
                last_ten=find("lastTen"),
                division_name=division_name,
                division_short_name=division_short_name,
                league_name=league_name,
                games_back=str(games_back) if games_back is not None else None,
            )
    return out


# ---------------------------------------------------------------------------
# Handedness
# ---------------------------------------------------------------------------


@dataclass
class HandednessEntry:
    pitch_hand: str | None
    bat_side: str | None
    full_name: str


async def get_handedness(client: httpx.AsyncClient, ids: list[int]) -> dict[int, HandednessEntry]:
    """Handedness lookup only — much smaller than pulling stats."""
    unique = list(dict.fromkeys(i for i in ids if _is_finite_number(i)))
    out: dict[int, HandednessEntry] = {}
    if not unique:
        return out

    async def fetch_batch(batch: list[int]):
        ids_param = ",".join(str(i) for i in batch)
        return await _cached_json(client, f"hand:{ids_param}", f"{_BASE}/v1/people?personIds={ids_param}", 6 * 60 * 60)

    results = await asyncio.gather(*(fetch_batch(batch) for batch in _chunk(unique, 100)))

    for json_data in results:
        for person in (json_data or {}).get("people") or []:
            out[person["id"]] = HandednessEntry(
                pitch_hand=(person.get("pitchHand") or {}).get("code"),
                bat_side=(person.get("batSide") or {}).get("code"),
                full_name=person.get("fullName"),
            )
    return out
