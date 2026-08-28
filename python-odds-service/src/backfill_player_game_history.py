"""One-shot, resumable historical backfill of `player_game_history` across
six sport/leagues — the multi-season, multi-team depth
predict/generic_prop_score.py's compute_league_rate currently lacks (see
docs/all-sports-prop-score-gameplan-2026-08-27.md, and
docs/model-build-backlog-2026-08-27.md for the follow-on wiring that is
explicitly NOT this script's job).

Game-based ingestion: sweep each real season's scoreboard for real game
ids, fetch each game's boxscore once, extract every player who appeared
from both teams. A per-player gamelog approach was tested and rejected
earlier — ESPN's athlete gamelog endpoint is confirmed broken for CFB and
Soccer.

Runs OUTSIDE the SequentialQueue/JOB_REGISTRY (like run_walkforward.py and
harvester_scrape.py) — a ~5 hour operation has no place in a worker with a
10-minute per-job timeout. Run from python-odds-service/:

    python src/backfill_player_game_history.py                 # full scope
    python src/backfill_player_game_history.py nba nhl          # only these sports
    python src/backfill_player_game_history.py --from-season 2018
    python src/backfill_player_game_history.py --list           # print scope + exit

Resumability (docs' hard requirement): before fetching a game, the script
checks player_game_history for any row with that (sport, event_id) and
skips the network call entirely if found. Each game's players from both
teams are parsed and written in one atomic batch, so a row only ever
exists for a fully-processed game. Killing and restarting this process is
always safe and never re-pays for completed work — the database is the
only progress state.

Rate limiting: one shared ~3 req/s limiter for the whole run, shared with
nothing (this is a standalone process) but deliberately gentle because it
draws on the same ESPN outbound budget the live app's real-time features
use. Adapts downward on 429s. Sports run sequentially through one queue —
never in parallel.
"""
import argparse
import asyncio
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

import httpx

import db
from db import PlayerGameHistoryInput

_ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports"
_NHL_BASE = "https://api-web.nhle.com/v1"

# ESPN's edge (Akamai) 403s a browser-looking User-Agent that lacks the
# rest of a browser's header set, but is fine with httpx's own default UA —
# same as every other ESPN call in this codebase (game_context.py,
# generic_matchup_defense.py), which all use httpx defaults. Don't set one.

# ---------------------------------------------------------------------------
# Scope — decided, not re-derived. Season label conventions differ per sport
# and match each sport's own upstream convention so the stored `season`
# integer lines up with what a live fetch would use:
#   NBA  -> ESPN season.year == END year   (2016 == the 2015-16 season)
#   NHL  -> START year                     (2015 == the 2015-16 season)
#   NFL  -> ESPN season.year == START year (2015 == the 2015 season)
#   CFB  -> ESPN season.year == START year
#   EPL  -> START year                     (2015 == the 2015-16 season)
#   MLS  -> calendar year
# ---------------------------------------------------------------------------


@dataclass
class SportConfig:
    sport: str  # value stored in player_game_history.sport
    seasons: list[int]
    discover: str  # "espn" | "nhl"
    espn_sport: str = ""
    espn_league: str = ""
    espn_groups: str | None = None  # CFB: "80" == FBS
    espn_regular_only: bool = True  # keep season.type == 2 only
    parser: str = ""  # "nba" | "football" | "soccer" | "nhl"
    # (start_month, start_day) .. (end_month_offset_year, end_month, end_day)
    # end tuple's first element is +N years from the season label.
    sweep_start: tuple[int, int] = (1, 1)
    sweep_end: tuple[int, int, int] = (0, 12, 31)
    mls_regular_slug: bool = False  # MLS: keep only slug startswith "regular-season"


# Order: smaller/faster sports first so a whole sport finishes early and the
# end-to-end pipeline (incl. the gameplan's §8 spot-checks) can be verified
# while the rest runs; NHL (biggest, and the one sport on a different API)
# last. Sports always run sequentially through the one shared limiter.
SCOPE: list[SportConfig] = [
    SportConfig(
        sport="nfl",
        seasons=list(range(2012, 2026)),
        discover="espn", espn_sport="football", espn_league="nfl", parser="football",
        sweep_start=(9, 1), sweep_end=(1, 2, 20),
    ),
    SportConfig(
        sport="cfb",
        seasons=list(range(2018, 2026)),
        discover="espn", espn_sport="football", espn_league="college-football",
        espn_groups="80", parser="football",
        sweep_start=(8, 15), sweep_end=(1, 1, 20),
    ),
    SportConfig(
        sport="soccer_mls",
        seasons=list(range(2015, 2026)),
        discover="espn", espn_sport="soccer", espn_league="usa.1", parser="soccer",
        espn_regular_only=False, mls_regular_slug=True,
        sweep_start=(2, 15), sweep_end=(0, 12, 15),
    ),
    SportConfig(
        sport="soccer_epl",
        seasons=list(range(2010, 2026)),
        discover="espn", espn_sport="soccer", espn_league="eng.1", parser="soccer",
        espn_regular_only=False,
        sweep_start=(8, 1), sweep_end=(1, 6, 5),
    ),
    SportConfig(
        sport="nba",
        seasons=list(range(2016, 2027)),  # 2015-16 .. 2025-26
        discover="espn", espn_sport="basketball", espn_league="nba", parser="nba",
        sweep_start=(10, 1), sweep_end=(1, 5, 15),  # Oct (year-1 implied) .. mid-May
    ),
    SportConfig(
        sport="nhl",
        seasons=list(range(2010, 2026)),  # 2010-11 .. 2025-26
        discover="nhl", parser="nhl",
        sweep_start=(9, 1), sweep_end=(1, 6, 15),
    ),
]

# NBA's sweep_start month is in the calendar year BEFORE the season label
# (Oct 2015 belongs to season 2016). Every other sport's sweep_start month
# is in the season-label year itself.
_START_IN_PRIOR_YEAR = {"nba"}


# ---------------------------------------------------------------------------
# Shared rate limiter — process-wide, ~3 req/s, adapts down on 429s.
# ---------------------------------------------------------------------------


class RateLimiter:
    def __init__(self, rps: float = 3.0):
        self._interval = 1.0 / rps
        self._min_interval = 1.0 / rps
        self._max_interval = 2.0
        self._next_at = 0.0
        self._lock = asyncio.Lock()
        self.request_count = 0

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self._next_at - now
            if wait > 0:
                await asyncio.sleep(wait)
                now = time.monotonic()
            self._next_at = now + self._interval
            self.request_count += 1

    def slow_down(self) -> None:
        self._interval = min(self._max_interval, self._interval * 1.5)
        print(f"[rate] backing off — interval now {self._interval:.2f}s/req", flush=True)

    def recover(self) -> None:
        if self._interval > self._min_interval:
            self._interval = max(self._min_interval, self._interval / 1.1)


# ---------------------------------------------------------------------------
# HTTP with retry
# ---------------------------------------------------------------------------


class FetchError(Exception):
    pass


async def fetch_json(client: httpx.AsyncClient, limiter: RateLimiter, url: str, *, params: dict | None = None, attempts: int = 4) -> dict:
    last: Exception | None = None
    for i in range(attempts):
        await limiter.acquire()
        try:
            res = await client.get(url, params=params, timeout=httpx.Timeout(25.0))
        except httpx.HTTPError as e:
            last = e
            await asyncio.sleep(3 * (i + 1))
            continue
        if res.status_code == 200:
            limiter.recover()
            try:
                return res.json()
            except ValueError as e:
                raise FetchError(f"non-JSON 200 from {url}") from e
        if res.status_code == 404:
            raise FetchError(f"404 {url}")  # genuinely absent — caller decides
        if res.status_code == 429:
            limiter.slow_down()
            retry_after = res.headers.get("Retry-After")
            delay = float(retry_after) if (retry_after or "").isdigit() else 5 * (i + 1)
            print(f"[rate] 429 from {url} — sleeping {delay:.0f}s", flush=True)
            await asyncio.sleep(delay)
            last = FetchError("429")
            continue
        if res.status_code in (500, 502, 503, 504):
            last = FetchError(f"{res.status_code} {url}")
            await asyncio.sleep(3 * (i + 1))
            continue
        raise FetchError(f"HTTP {res.status_code} {url}")
    raise FetchError(f"exhausted retries for {url}: {last}")


# ---------------------------------------------------------------------------
# Parsers — one per boxscore shape. Each returns rows for BOTH teams.
# All four verified live against a real historical game before being trusted
# (2026-08-27).
# ---------------------------------------------------------------------------

_NUM_RE = re.compile(r"^[+-]?\d+(\.\d+)?$")
_COMBO_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*([/-])\s*(\d+(?:\.\d+)?)$")


def _num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and _NUM_RE.match(v.strip()):
        return float(v.strip().lstrip("+"))
    return None


def _expand_stat(key: str, value) -> dict[str, float]:
    """One raw (key, value) -> zero or more numeric stat entries.

    Plain number -> {key: n}. A made/attempted combo like "6-13" (NBA
    'fieldGoalsMade-fieldGoalsAttempted') or "26/35" (football
    'completions/passingAttempts') is split into its two real component
    names taken from the key itself when the key carries the same
    delimiter (it almost always does in ESPN's boxscore shape), else a
    generic Made/Attempted pair. Non-numeric junk ("--", "") is dropped."""
    n = _num(value)
    if n is not None:
        return {key: n}
    if not isinstance(value, str):
        return {}
    m = _COMBO_RE.match(value.strip())
    if not m:
        return {}
    left_v, delim, right_v = m.group(1), m.group(2), m.group(3)
    if delim in key:
        parts = key.split(delim, 1)
    elif "/" in key:
        parts = key.split("/", 1)
    elif "-" in key:
        parts = key.split("-", 1)
    else:
        parts = [f"{key}Made", f"{key}Attempted"]
    return {parts[0]: float(left_v), parts[1]: float(right_v)}


def _toi_minutes(toi: str | None) -> float | None:
    if not toi or ":" not in toi:
        return None
    try:
        m, s = toi.split(":")
        return round(int(m) + int(s) / 60.0, 2)
    except (ValueError, TypeError):
        return None


@dataclass
class _Sides:
    """home/away team identity for one game."""
    home_id: str | None
    away_id: str | None

    def opp_and_home(self, team_id: str | None) -> tuple[str | None, bool]:
        if team_id and self.home_id and str(team_id) == str(self.home_id):
            return self.away_id, True
        if team_id and self.away_id and str(team_id) == str(self.away_id):
            return self.home_id, False
        return None, False


def _espn_sides(summary: dict) -> _Sides:
    comps = (summary.get("header") or {}).get("competitions") or []
    comp = comps[0] if comps else {}
    home_id = away_id = None
    for c in comp.get("competitors") or []:
        tid = str((c.get("team") or {}).get("id") or "") or None
        if c.get("homeAway") == "home":
            home_id = tid
        elif c.get("homeAway") == "away":
            away_id = tid
    return _Sides(home_id, away_id)


def _espn_game_date(summary: dict) -> str:
    comps = (summary.get("header") or {}).get("competitions") or []
    d = (comps[0] if comps else {}).get("date") or ""
    return d[:10]


def parse_nba(summary: dict, sport: str, event_id: str, season: int) -> list[PlayerGameHistoryInput]:
    box = (summary.get("boxscore") or {}).get("players") or []
    if not box:
        return []
    sides = _espn_sides(summary)
    game_date = _espn_game_date(summary)
    if not game_date:
        return []
    rows: list[PlayerGameHistoryInput] = []
    for group in box:
        team_id = str((group.get("team") or {}).get("id") or "") or None
        opp_id, is_home = sides.opp_and_home(team_id)
        for sg in group.get("statistics") or []:
            keys = sg.get("keys") or sg.get("names") or []
            for a in sg.get("athletes") or []:
                if a.get("didNotPlay"):
                    continue
                ath = a.get("athlete") or {}
                aid = str(ath.get("id") or "")
                if not aid:
                    continue
                raw = a.get("stats") or []
                stats: dict[str, float] = {}
                for k, v in zip(keys, raw):
                    stats.update(_expand_stat(k, v))
                if not stats:
                    continue
                rows.append(PlayerGameHistoryInput(
                    sport=sport, athlete_id=aid, team_id=team_id, season=season,
                    event_id=event_id, game_date=game_date, opponent_id=opp_id,
                    is_home=is_home, stats=stats,
                ))
    return rows


def parse_football(summary: dict, sport: str, event_id: str, season: int) -> list[PlayerGameHistoryInput]:
    box = (summary.get("boxscore") or {}).get("players") or []
    if not box:
        return []
    sides = _espn_sides(summary)
    game_date = _espn_game_date(summary)
    if not game_date:
        return []
    by_ath: dict[str, PlayerGameHistoryInput] = {}
    for group in box:
        team_id = str((group.get("team") or {}).get("id") or "") or None
        opp_id, is_home = sides.opp_and_home(team_id)
        for sg in group.get("statistics") or []:
            cat = sg.get("name") or "misc"
            keys = sg.get("keys") or sg.get("labels") or []
            for a in sg.get("athletes") or []:
                ath = a.get("athlete") or {}
                aid = str(ath.get("id") or "")
                if not aid:
                    continue
                raw = a.get("stats") or []
                if not raw:
                    continue
                row = by_ath.get(aid)
                if row is None:
                    row = PlayerGameHistoryInput(
                        sport=sport, athlete_id=aid, team_id=team_id, season=season,
                        event_id=event_id, game_date=game_date, opponent_id=opp_id,
                        is_home=is_home, stats={},
                    )
                    by_ath[aid] = row
                for k, v in zip(keys, raw):
                    for name, num in _expand_stat(k, v).items():
                        row.stats[f"{cat}.{name}"] = num
    return [r for r in by_ath.values() if r.stats]


def parse_soccer(summary: dict, sport: str, event_id: str, season: int) -> list[PlayerGameHistoryInput]:
    rosters = summary.get("rosters") or []
    if not rosters:
        return []
    # soccer summary carries no header.competitions competitors id reliably
    # across all seasons; rosters[].homeAway + rosters[].team.id is the
    # stable source (verified live 2011 -> 2024).
    home_id = away_id = None
    for r in rosters:
        tid = str((r.get("team") or {}).get("id") or "") or None
        if r.get("homeAway") == "home":
            home_id = tid
        elif r.get("homeAway") == "away":
            away_id = tid
    sides = _Sides(home_id, away_id)
    game_date = _espn_game_date(summary)
    if not game_date:
        # soccer header sometimes lacks date; fall back to gameInfo/comp
        d = ((summary.get("header") or {}).get("competitions") or [{}])[0].get("date") or ""
        game_date = d[:10]
    if not game_date:
        return []
    rows: list[PlayerGameHistoryInput] = []
    for r in rosters:
        team_id = str((r.get("team") or {}).get("id") or "") or None
        opp_id, is_home = sides.opp_and_home(team_id)
        for e in r.get("roster") or []:
            if not (e.get("starter") or e.get("subbedIn")):
                continue
            ath = e.get("athlete") or {}
            aid = str(ath.get("id") or "")
            if not aid:
                continue
            stats: dict[str, float] = {}
            for s in e.get("stats") or []:
                name = s.get("name")
                n = _num(s.get("value"))
                if name and n is not None:
                    stats[name] = n
            stats["isStarter"] = 1.0 if e.get("starter") else 0.0
            if e.get("subbedIn"):
                sv = _num(e.get("subbedIn"))
                if sv is not None:
                    stats["subbedInMinute"] = sv
            rows.append(PlayerGameHistoryInput(
                sport=sport, athlete_id=aid, team_id=team_id, season=season,
                event_id=event_id, game_date=game_date, opponent_id=opp_id,
                is_home=is_home, stats=stats,
            ))
    return rows


def parse_nhl(box: dict, sport: str, event_id: str, season: int) -> list[PlayerGameHistoryInput]:
    pbgs = box.get("playerByGameStats") or {}
    if not pbgs:
        return []
    home = box.get("homeTeam") or {}
    away = box.get("awayTeam") or {}
    home_id = str(home.get("id") or "") or None
    away_id = str(away.get("id") or "") or None
    game_date = (box.get("gameDate") or "")[:10]
    if not game_date:
        return []
    _SKATER_KEYS = ("goals", "assists", "points", "plusMinus", "pim", "hits",
                    "powerPlayGoals", "sog", "blockedShots", "shifts",
                    "giveaways", "takeaways", "faceoffWinningPctg")
    _GOALIE_KEYS = ("saves", "shotsAgainst", "goalsAgainst", "pim",
                    "evenStrengthGoalsAgainst", "powerPlayGoalsAgainst",
                    "shorthandedGoalsAgainst")
    rows: list[PlayerGameHistoryInput] = []
    for side_key, team_id, opp_id, is_home in (
        ("homeTeam", home_id, away_id, True),
        ("awayTeam", away_id, home_id, False),
    ):
        side = pbgs.get(side_key) or {}
        for grp in ("forwards", "defense"):
            for p in side.get(grp) or []:
                aid = str(p.get("playerId") or "")
                if not aid:
                    continue
                stats: dict[str, float] = {}
                for k in _SKATER_KEYS:
                    n = _num(p.get(k))
                    if n is not None:
                        stats[k] = n
                toi = _toi_minutes(p.get("toi"))
                if toi is not None:
                    stats["toiMinutes"] = toi
                if not stats:
                    continue
                rows.append(PlayerGameHistoryInput(
                    sport=sport, athlete_id=aid, team_id=team_id, season=season,
                    event_id=event_id, game_date=game_date, opponent_id=opp_id,
                    is_home=is_home, stats=stats,
                ))
        for p in side.get("goalies") or []:
            aid = str(p.get("playerId") or "")
            if not aid:
                continue
            if (p.get("toi") or "00:00") == "00:00":
                continue  # dressed backup who never took the ice
            stats = {}
            for k in _GOALIE_KEYS:
                n = _num(p.get(k))
                if n is not None:
                    stats[k] = n
            toi = _toi_minutes(p.get("toi"))
            if toi is not None:
                stats["toiMinutes"] = toi
            stats["isGoalie"] = 1.0
            if not stats:
                continue
            rows.append(PlayerGameHistoryInput(
                sport=sport, athlete_id=aid, team_id=team_id, season=season,
                event_id=event_id, game_date=game_date, opponent_id=opp_id,
                is_home=is_home, stats=stats,
            ))
    return rows


PARSERS = {"nba": parse_nba, "football": parse_football, "soccer": parse_soccer, "nhl": parse_nhl}


# ---------------------------------------------------------------------------
# Season-wide game discovery
# ---------------------------------------------------------------------------


def _sweep_bounds(cfg: SportConfig, season: int) -> tuple[date, date]:
    start_year = season - 1 if cfg.sport in _START_IN_PRIOR_YEAR else season
    sm, sd = cfg.sweep_start
    start = date(start_year, sm, sd)
    yoff, em, ed = cfg.sweep_end
    end = date(start_year + yoff, em, ed)
    today = datetime.now(timezone.utc).date()
    return start, min(end, today)


async def discover_espn(client, limiter, cfg: SportConfig, season: int) -> list[tuple[str, str]]:
    start, end = _sweep_bounds(cfg, season)
    step = timedelta(days=7 if cfg.sport == "cfb" else 14)
    found: dict[str, str] = {}
    cur = start
    while cur <= end:
        wnd_end = min(cur + step - timedelta(days=1), end)
        params = {"dates": f"{cur:%Y%m%d}-{wnd_end:%Y%m%d}", "limit": 1000}
        if cfg.espn_groups:
            params["groups"] = cfg.espn_groups
        url = f"{_ESPN_SITE}/{cfg.espn_sport}/{cfg.espn_league}/scoreboard"
        try:
            data = await fetch_json(client, limiter, url, params=params)
        except FetchError as e:
            print(f"  [discover] {cfg.sport} {season} window {cur}..{wnd_end} failed: {e}", flush=True)
            cur += step
            continue
        events = data.get("events") or []
        if len(events) >= 1000:
            print(f"  [discover] WARNING {cfg.sport} {season} {cur}..{wnd_end} hit 1000-event cap", flush=True)
        for ev in events:
            s = ev.get("season") or {}
            if s.get("year") != season:
                continue
            if cfg.espn_regular_only and s.get("type") != 2:
                continue
            if cfg.mls_regular_slug and not str(s.get("slug") or "").startswith("regular-season"):
                continue
            comp = (ev.get("competitions") or [{}])[0]
            status = ((comp.get("status") or {}).get("type") or {})
            if not status.get("completed"):
                continue
            eid = str(ev.get("id") or "")
            if eid:
                found[eid] = (ev.get("date") or "")[:10]
        cur += step
    return sorted(found.items())


async def discover_nhl(client, limiter, cfg: SportConfig, season: int) -> list[tuple[str, str]]:
    start, end = _sweep_bounds(cfg, season)
    want_season = int(f"{season}{season + 1}")
    found: dict[str, str] = {}
    cur = start
    guard = 0
    while cur <= end and guard < 80:
        guard += 1
        url = f"{_NHL_BASE}/schedule/{cur:%Y-%m-%d}"
        try:
            data = await fetch_json(client, limiter, url)
        except FetchError as e:
            print(f"  [discover] nhl {season} week {cur} failed: {e}", flush=True)
            cur += timedelta(days=7)
            continue
        for day in data.get("gameWeek") or []:
            ddate = day.get("date") or ""
            for g in day.get("games") or []:
                if g.get("gameType") != 2:
                    continue
                if g.get("season") != want_season:
                    continue
                if g.get("gameState") not in ("OFF", "FINAL"):
                    continue
                gid = str(g.get("id") or "")
                if gid:
                    found[gid] = (g.get("gameDate") or ddate or "")[:10]
        nxt = data.get("nextStartDate")
        if nxt:
            try:
                nd = datetime.strptime(nxt, "%Y-%m-%d").date()
                cur = nd if nd > cur else cur + timedelta(days=7)
            except ValueError:
                cur += timedelta(days=7)
        else:
            cur += timedelta(days=7)
    return sorted(found.items())


async def fetch_boxscore(client, limiter, cfg: SportConfig, event_id: str) -> dict:
    if cfg.discover == "nhl":
        return await fetch_json(client, limiter, f"{_NHL_BASE}/gamecenter/{event_id}/boxscore")
    return await fetch_json(client, limiter, f"{_ESPN_SITE}/{cfg.espn_sport}/{cfg.espn_league}/summary", params={"event": event_id})


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


@dataclass
class RunStats:
    games_seen: int = 0
    games_skipped: int = 0
    games_fetched: int = 0
    games_empty: int = 0
    games_failed: int = 0
    rows_written: int = 0
    failures: list[tuple[str, str, str]] = field(default_factory=list)  # sport, event, reason


async def run_season(client, limiter, cfg: SportConfig, season: int, stats: RunStats, started: float) -> None:
    parser = PARSERS[cfg.parser]
    done = await db.player_game_history_done_events(cfg.sport, season)
    if cfg.discover == "nhl":
        games = await discover_nhl(client, limiter, cfg, season)
    else:
        games = await discover_espn(client, limiter, cfg, season)
    todo = [(eid, gdate) for eid, gdate in games if eid not in done]
    print(
        f"[{cfg.sport} {season}] discovered {len(games)} games, {len(done)} already done, {len(todo)} to fetch",
        flush=True,
    )
    # Producer (rate-limited ESPN/NHL fetch + parse) and consumer (one
    # multi-row DB write per game) run concurrently through a small bounded
    # queue, so a game's write overlaps the next game's rate-limit wait
    # instead of adding to it. Still exactly one fetch and one write in
    # flight at a time — the shared limiter is the only throttle, and each
    # queue item is one game's complete row set, so the per-game atomic
    # write (and therefore skip-before-fetch resume safety) is unchanged.
    # A game fetched but not yet written when the process dies is simply
    # re-fetched on the next run — no partial rows ever reach the table.
    queue: asyncio.Queue = asyncio.Queue(maxsize=16)
    total = len(todo)
    progress = {"written": 0, "done": 0, "last_log": time.monotonic()}

    async def producer() -> None:
        for eid, _gdate in todo:
            stats.games_seen += 1
            try:
                raw = await fetch_boxscore(client, limiter, cfg, eid)
            except FetchError as e:
                stats.games_failed += 1
                stats.failures.append((cfg.sport, eid, str(e)))
                continue
            try:
                rows = parser(raw, cfg.sport, eid, season)
            except Exception as e:  # one odd payload must not kill the run
                stats.games_failed += 1
                stats.failures.append((cfg.sport, eid, f"parse: {type(e).__name__}: {e}"))
                continue
            stats.games_fetched += 1
            if not rows:
                stats.games_empty += 1
                continue
            await queue.put((eid, rows))
        await queue.put(None)

    async def consumer() -> None:
        while True:
            item = await queue.get()
            if item is None:
                return
            eid, rows = item
            try:
                n = await db.write_player_game_history(rows)
            except Exception as e:
                stats.games_failed += 1
                stats.failures.append((cfg.sport, eid, f"write: {type(e).__name__}: {e}"))
                continue
            stats.rows_written += n
            progress["written"] += n
            progress["done"] += 1
            if progress["done"] % 50 == 0 or (time.monotonic() - progress["last_log"]) > 120:
                elapsed = time.monotonic() - started
                print(
                    f"  [{cfg.sport} {season}] {progress['done']}/{total} games written | "
                    f"+{progress['written']} rows this season | {stats.rows_written} rows total | "
                    f"{stats.games_failed} failed | {limiter.request_count} reqs | {elapsed/60:.1f} min elapsed",
                    flush=True,
                )
                progress["last_log"] = time.monotonic()

    await asyncio.gather(producer(), consumer())
    print(f"[{cfg.sport} {season}] done — {progress['written']} rows written this season", flush=True)


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("sports", nargs="*", help="restrict to these sport labels (nba nhl nfl cfb soccer_epl soccer_mls)")
    ap.add_argument("--from-season", type=int, default=None, help="skip seasons before this (by stored label)")
    ap.add_argument("--to-season", type=int, default=None)
    ap.add_argument("--rps", type=float, default=3.0)
    ap.add_argument("--list", action="store_true", help="print scope and exit")
    args = ap.parse_args()

    selected = [c for c in SCOPE if not args.sports or c.sport in args.sports]
    if args.sports:
        unknown = set(args.sports) - {c.sport for c in SCOPE}
        if unknown:
            print(f"unknown sport labels: {sorted(unknown)}", flush=True)
            sys.exit(2)

    plan: list[tuple[SportConfig, int]] = []
    for cfg in selected:
        for s in cfg.seasons:
            if args.from_season is not None and s < args.from_season:
                continue
            if args.to_season is not None and s > args.to_season:
                continue
            plan.append((cfg, s))

    print("=== backfill plan ===", flush=True)
    for cfg, s in plan:
        print(f"  {cfg.sport:12s} {s}", flush=True)
    print(f"=== {len(plan)} (sport, season) units ===", flush=True)
    if args.list:
        return

    limiter = RateLimiter(rps=args.rps)
    stats = RunStats()
    started = time.monotonic()
    async with httpx.AsyncClient(follow_redirects=True) as client:
        for cfg, s in plan:
            try:
                await run_season(client, limiter, cfg, s, stats, started)
            except Exception as e:
                print(f"!!! [{cfg.sport} {s}] season aborted: {type(e).__name__}: {e}", flush=True)
                raise

    elapsed = (time.monotonic() - started) / 60
    print("\n=== RUN COMPLETE ===", flush=True)
    print(f"elapsed {elapsed:.1f} min | requests {limiter.request_count}", flush=True)
    print(
        f"games: seen={stats.games_seen} fetched={stats.games_fetched} "
        f"empty={stats.games_empty} failed={stats.games_failed}",
        flush=True,
    )
    print(f"rows written: {stats.rows_written}", flush=True)
    if stats.failures:
        print(f"\n{len(stats.failures)} failures (will be retried automatically on the next run):", flush=True)
        for sport, eid, reason in stats.failures[:60]:
            print(f"  {sport} {eid}: {reason}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
