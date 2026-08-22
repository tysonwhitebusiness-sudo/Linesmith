"""Direct port of lib/sports/golf/espn.ts (fetchGolfEvent) and
lib/sports/golf/schedule.ts (getSeasonSchedule) — not a reimplementation.

ESPN public golf endpoints. Neither feed is sufficient alone, which is
why this fetches both:
  leaderboard?league=pga -> course (incl. per-hole par), player status
                            (thru / current hole / tee time), position —
                            but NO per-hole scores.
  pga/scoreboard         -> per-hole scores for every round — but no
                            course, no tee time and no thru.
They are merged on `competitor.id`, the ESPN athlete id in both.
"""
import json
from dataclasses import dataclass, field

import httpx

import db

_LEADERBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga"
_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard"


async def _get_json(client: httpx.AsyncClient, url: str, timeout_s: float = 12.0):
    try:
        res = await client.get(url, timeout=httpx.Timeout(timeout_s), headers={"accept": "application/json"})
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json()
    except ValueError:
        return None


@dataclass
class EspnHole:
    number: int
    shots_to_par: float
    total_yards: float | None = None


@dataclass
class EspnCourse:
    id: str
    name: str
    shots_to_par: float
    total_yards: float | None
    holes: list[EspnHole]


@dataclass
class EspnPlayerStatus:
    thru: int | None
    start_hole: int | None
    tee_time: str | None
    position_display_name: str | None
    finished: bool


@dataclass
class EspnRoundHole:
    hole: int
    strokes: int | None
    relative_to_par: str | None  # e.g. '-1' | 'E' | '+2'


@dataclass
class EspnRound:
    period: int
    total: int | None
    holes: list[EspnRoundHole] = field(default_factory=list)


@dataclass
class EspnGolfer:
    id: str
    name: str
    country: str | None
    headshot_url: str | None
    flag_url: str | None
    amateur: bool
    total_score: str | None
    status: EspnPlayerStatus
    rounds: list[EspnRound]


@dataclass
class EspnGolfEvent:
    id: str
    name: str
    state: str  # 'pre' | 'in' | 'post' | 'unknown'
    completed: bool
    current_round: int | None
    course: EspnCourse | None
    golfers: list[EspnGolfer]
    warnings: list[str] = field(default_factory=list)


def _pick_event(events: list) -> dict | None:
    """One in progress beats an upcoming one beats a finished one."""
    if not events:
        return None

    def by_state(state: str) -> dict | None:
        return next((e for e in events if (e.get("status") or {}).get("type", {}).get("state") == state), None)

    return by_state("in") or by_state("pre") or events[0]


def _parse_course(event: dict) -> EspnCourse | None:
    courses = event.get("courses") or []
    raw = next((c for c in courses if c.get("host")), courses[0] if courses else None)
    if not raw:
        return None
    holes = [
        EspnHole(number=h.get("number"), shots_to_par=h.get("shotsToPar"), total_yards=h.get("totalYards"))
        for h in (raw.get("holes") or [])
    ]
    return EspnCourse(
        id=str(raw.get("id") or ""),
        name=raw.get("name") or "Course",
        shots_to_par=raw.get("shotsToPar") or 72,
        total_yards=raw.get("totalYards"),
        holes=holes,
    )


def _index_scoreboard_holes(scoreboard: dict) -> dict[str, dict[int, list[EspnRoundHole]]]:
    """Per-hole scores live on the scoreboard feed, keyed by athlete id,
    then by round period."""
    out: dict[str, dict[int, list[EspnRoundHole]]] = {}
    events = scoreboard.get("events") or []
    competitors = (((events[0] if events else {}).get("competitions") or [{}])[0]).get("competitors") or []

    for competitor in competitors:
        cid = str(competitor.get("id") or "")
        if not cid:
            continue
        by_round: dict[int, list[EspnRoundHole]] = {}
        for round_ in competitor.get("linescores") or []:
            period = round_.get("period")
            if period is None:
                continue
            holes = []
            for h in round_.get("linescores") or []:
                value = h.get("value")
                display = (h.get("scoreType") or {}).get("displayValue")
                holes.append(EspnRoundHole(hole=h.get("period"), strokes=value if isinstance(value, (int, float)) else None, relative_to_par=display if isinstance(display, str) else None))
            if holes:
                by_round[period] = holes
        if by_round:
            out[cid] = by_round
    return out


def _read_score(score) -> str | None:
    if score is None:
        return None
    if isinstance(score, dict):
        display = score.get("displayValue")
        return str(display) if display is not None else None
    return str(score)


async def fetch_golf_event(client: httpx.AsyncClient) -> EspnGolfEvent | None:
    """Fetch and merge both ESPN golf feeds into one normalised event."""
    leaderboard = await _get_json(client, _LEADERBOARD_URL)
    scoreboard = await _get_json(client, _SCOREBOARD_URL)

    if not leaderboard:
        return None  # without the leaderboard we have no course and no live status at all

    warnings: list[str] = []
    if not scoreboard:
        warnings.append("ESPN scoreboard feed unavailable — per-hole scores are missing this refresh.")

    event = _pick_event(leaderboard.get("events") or [])
    if not event:
        return None

    competition = (event.get("competitions") or [{}])[0]
    competitors = competition.get("competitors") or []
    hole_index = _index_scoreboard_holes(scoreboard) if scoreboard else {}

    golfers: list[EspnGolfer] = []
    for competitor in competitors:
        cid = str(competitor.get("id") or "")
        holes_by_round = hole_index.get(cid, {})

        rounds: list[EspnRound] = []
        for round_ in competitor.get("linescores") or []:
            period = round_.get("period")
            value = round_.get("value")
            rounds.append(EspnRound(period=period, total=value if isinstance(value, (int, float)) else None, holes=holes_by_round.get(period, [])))

        athlete = competitor.get("athlete") or {}
        status_raw = competitor.get("status") or {}
        position = (status_raw.get("position") or {}).get("displayName")
        status = EspnPlayerStatus(
            thru=status_raw.get("thru"),
            start_hole=status_raw.get("startHole"),
            tee_time=status_raw.get("teeTime"),
            position_display_name=position,
            finished=bool((status_raw.get("type") or {}).get("completed")),
        )

        golfers.append(
            EspnGolfer(
                id=cid,
                name=athlete.get("displayName") or athlete.get("fullName") or "Unknown",
                country=(athlete.get("flag") or {}).get("alt"),
                headshot_url=(athlete.get("headshot") or {}).get("href") or (f"https://a.espncdn.com/i/headshots/golf/players/full/{cid}.png" if cid else None),
                flag_url=(athlete.get("flag") or {}).get("href"),
                amateur=bool(competitor.get("amateur")),
                total_score=_read_score(competitor.get("score")),
                status=status,
                rounds=rounds,
            )
        )

    if golfers and all(not r.holes for g in golfers for r in g.rounds):
        warnings.append("No per-hole scores available yet for this event.")

    status_type = (event.get("status") or {}).get("type") or {}
    current_round_raw = (competition.get("status") or {}).get("period")

    return EspnGolfEvent(
        id=str(event.get("id") or ""),
        name=event.get("name") or "PGA Tour",
        state=status_type.get("state") or "unknown",
        completed=bool(status_type.get("completed")),
        current_round=current_round_raw if isinstance(current_round_raw, (int, float)) else None,
        course=_parse_course(event),
        golfers=golfers,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Season schedule (lib/sports/golf/schedule.ts)
# ---------------------------------------------------------------------------

# Deliberately IDENTICAL to TS's own lib/sports/golf/schedule.ts internal
# cache key (bare array payload) — NOT app/api/golf/schedule/route.ts's
# own, different key (`golf:schedule:route:{year}`, a wrapped
# {events,fetchedAt,...} shape for its own cachedRoute() response). Grepped
# for this before picking it — CLAUDE.md documents this exact collision
# already happening once for this same cache-key family; confirmed live
# this session when an earlier draft of this file picked the route's key
# by accident and broke on the wrapped shape already sitting there.
_SCHEDULE_CACHE_KEY_PREFIX = "golf:schedule:"
# A season's schedule barely changes week to week — refetching more than
# daily buys nothing.
_SCHEDULE_TTL_MS = 24 * 60 * 60 * 1000


@dataclass
class ScheduleEvent:
    id: str
    name: str
    start_date: str
    end_date: str
    status: str  # 'pre' | 'in' | 'post'
    completed: bool


async def _fetch_schedule_from_espn(client: httpx.AsyncClient, year: int) -> list[ScheduleEvent] | None:
    res = await _get_json(client, f"https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates={year}")
    if res is None:
        return None
    events = res.get("events") or []
    out = []
    for e in events:
        status_type = (e.get("status") or {}).get("type") or {}
        out.append(
            ScheduleEvent(
                id=str(e.get("id")),
                name=e.get("name"),
                start_date=e.get("date"),
                end_date=e.get("endDate"),
                status=status_type.get("state") or "pre",
                completed=bool(status_type.get("completed")),
            )
        )
    return out


def _schedule_to_json(events: list[ScheduleEvent]) -> list[dict]:
    return [{"id": e.id, "name": e.name, "startDate": e.start_date, "endDate": e.end_date, "status": e.status, "completed": e.completed} for e in events]


def _schedule_from_json(rows: list[dict]) -> list[ScheduleEvent]:
    return [ScheduleEvent(id=r["id"], name=r["name"], start_date=r["startDate"], end_date=r["endDate"], status=r["status"], completed=r["completed"]) for r in rows]


async def get_season_schedule(client: httpx.AsyncClient, year: int) -> list[ScheduleEvent]:
    """The full season schedule, oldest first. 24h cached."""
    cache_key = f"{_SCHEDULE_CACHE_KEY_PREFIX}{year}"
    cached = await db.read_snapshot_with_age(cache_key)
    if cached is not None:
        payload, age_seconds = cached
        if age_seconds * 1000 < _SCHEDULE_TTL_MS:
            return _schedule_from_json(json.loads(payload))

    events = await _fetch_schedule_from_espn(client, year)
    if events is None:
        if cached is not None:
            return _schedule_from_json(json.loads(cached[0]))
        return []

    await db.write_snapshot(cache_key, json.dumps(_schedule_to_json(events)))
    return events
