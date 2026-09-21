"""M3 — the Slate's odds-free rankings, frozen before the games start.

The Specials section ranks players for the promos books run — home run of the
day, most strikeouts, pick-3 anytime TD, anytime goalscorer, the day's longest
home run and longest catch, two goals in a game — from the player and the
circumstances, with **no odds in the ranking at all**. Each factor is a column
the card shows; the score is the mean of the factors' percentiles over that
day's pool, equal weights, until the pre-registered backtest sets them
(docs/design/m3-ranking-preregistration.md).

THREE THINGS THIS FILE IS CAREFUL ABOUT

1. **Frozen before first pitch.** A ranking recomputed after the games would
   grade itself against what already happened. Rows refresh until the sport's
   first game starts; then `frozen_at` is stamped and they never move. Receipts
   are graded the next morning from `player_game_history`.

2. **Every factor is real or absent.** Nothing is imputed. A batter with no
   Statcast split against the starter's hand gets NULL for that factor and is
   scored on the rest — never a league-average stand-in, which would rank him as
   if we knew something we do not. A roofed park has no wind factor, not a zero.

3. **It ranks, it does not predict.** The score is a composite of percentiles,
   not a probability, and nothing here touches a price. The register
   (`model_status.py`) keeps these separate from the models with gates.

PY-A (2026-09-21) added: `hit_rule` (a hit is not always "value > 0"), the
slate's actual leader for the "longest" rankings, a stat line per graded
player, a deterministic one-line read per ranked player, `kind` (a Special or
a Spotlight, which share this table and this writer), and team ids on every
row so the research pages can chip them.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Awaitable, Callable
from zoneinfo import ZoneInfo

import db
import game_context as gc

ET = ZoneInfo("America/New_York")


# ---------------------------------------------------------------------------
# shapes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Factor:
    key: str
    label: str
    higher_better: bool = True
    info: str = ""


@dataclass
class Candidate:
    subject_id: str
    subject_name: str
    team: str | None
    opponent: str | None
    game_id: str | None
    values: dict[str, float | None]
    team_id: str | None = None
    opponent_id: str | None = None


@dataclass(frozen=True)
class RankingDef:
    id: str
    sports: tuple[str, ...]
    title: str
    promo: str
    factors: tuple[Factor, ...]
    build: Callable[..., Awaitable[list[Candidate]]]
    grade_stat: str
    not_held: str = ""
    top_n: int = 10
    # 'any' (value > 0) · 'gte2' (two or more) · 'slate_max' (the slate's
    # highest value; ties all hit). Grading reads it; nothing else does.
    hit_rule: str = "any"
    # 'special' (a book promo, graded) or 'spotlight' (a research flag the
    # player/team/game pages chip). Same table, same freeze.
    kind: str = "special"
    # Which stat line `outcome.detail` prints for a graded player.
    detail: str = ""


HIT_RULES = ("any", "gte2", "slate_max")
KINDS = ("special", "spotlight")


def percentile_ranks(values: list[float | None], higher_better: bool) -> list[float | None]:
    present = sorted(v for v in values if v is not None)
    n = len(present)
    out: list[float | None] = []
    for v in values:
        if v is None or n == 0:
            out.append(None)
            continue
        below = sum(1 for p in present if p < v)
        equal = sum(1 for p in present if p == v)
        r = (below + 0.5 * equal) / n
        out.append(r if higher_better else 1 - r)
    return out


def score(cands: list[Candidate], factors: tuple[Factor, ...]) -> None:
    """Mean of each factor's percentile over today's pool. Equal weights, and
    the page says so. A missing factor is skipped for that player rather than
    filled in, so a player is never ranked on a number nobody measured."""
    ranks = {f.key: percentile_ranks([c.values.get(f.key) for c in cands], f.higher_better) for f in factors}
    for i, c in enumerate(cands):
        parts = [ranks[f.key][i] for f in factors if ranks[f.key][i] is not None]
        c.values["_score"] = round(100 * sum(parts) / len(parts), 1) if parts else None
        c.values["_pct"] = {f.key: round(100 * ranks[f.key][i]) for f in factors if ranks[f.key][i] is not None}


def is_hit(rule: str, value: float | None, leader: float | None = None) -> bool:
    """Whether a player who PLAYED did the thing. A did-not-play never reaches
    here: it is neither a hit nor a miss."""
    if value is None:
        return False
    if rule == "gte2":
        return value >= 2
    if rule == "slate_max":
        return leader is not None and value > 0 and value >= leader
    return value > 0


# ---------------------------------------------------------------------------
# the read: one plain sentence per ranked player, built from its factors
# ---------------------------------------------------------------------------
#
# Deterministic, no model: the player's two strongest factors by percentile,
# each through its own template. A template returns None when its number does
# not support the sentence (a wind blowing IN is not a reason to rank anyone),
# and the next factor is used. The no-edge guard's words are banned here too:
# `test_slate_rankings.py` renders every template and checks.

def _pl(n: float, one: str, many: str) -> str:
    return one if round(n) == 1 else many


READS: dict[str, Callable[[float, dict], str | None]] = {
    # MLB — home runs
    "hr_per_pa": lambda v, c: f"homers on {v:.1f}% of plate appearances",
    "vs_hand_hr_pa": lambda v, c: f"homers on {v:.1f}% against {'left' if c.get('_hand') == 'L' else 'right'}-handed pitching",
    "starter_hr_per_start": lambda v, c: f"faces a starter allowing {v:.2f} home runs a start",
    "park_factor": lambda v, c: (f"plays in a park scoring {abs(v - 1) * 100:.0f}% more runs than average" if v > 1.005 else None),
    "opp_staff_hr_rate": lambda v, c: f"faces a staff that allows a homer in {v * 100:.0f}% of games",
    "temp_f": lambda v, c: (f"gets {v:.0f}°F air at first pitch" if v >= 75 else None),
    "wind_out": lambda v, c: (f"has a {v:.0f} mph wind blowing out" if v >= 3 else None),
    "barrel_pct": lambda v, c: f"barrels {v:.1f}% of balls in play",
    "max_ev": lambda v, c: f"has hit one {v:.1f} mph this season",
    "avg_hr_dist": lambda v, c: f"averages {v:.0f} ft on home runs",
    "hr_430": lambda v, c: (f"has {v:.0f} {_pl(v, 'home run', 'home runs')} of 430 ft or more" if v >= 1 else None),
    "sp_hr9": lambda v, c: f"faces a starter allowing {v:.2f} home runs per nine",
    # MLB — strikeouts
    "projected_k": lambda v, c: f"is projected for {v:.1f} strikeouts",
    "k_per_start": lambda v, c: f"averages {v:.1f} strikeouts a start",
    "opp_k_per_game": lambda v, c: f"faces a lineup striking out {v:.1f} times a game",
    # football — touchdowns
    "td_per_game": lambda v, c: f"scores {v:.2f} touchdowns a game",
    "team_share": lambda v, c: f"holds {v:.0f}% of the team's touchdowns",
    "opp_td_allowed": lambda v, c: f"faces a defence allowing {v:.1f} touchdowns a game",
    "implied_points": lambda v, c: f"plays for a team expected to score {v:.1f}",
    # NFL — longest reception
    "adot": lambda v, c: f"averages {v:.1f} air yards a target",
    "deep_tgt_pg": lambda v, c: f"sees {v:.1f} deep targets a game",
    "air_share": lambda v, c: f"draws {v:.0f}% of the team's air yards",
    "yac_per_rec": lambda v, c: f"gains {v:.1f} yards after the catch",
    "avg_long": lambda v, c: f"averages a {v:.0f}-yard longest catch",
    "opp_20_allowed": lambda v, c: f"faces a defence allowing {v:.1f} completions of 20+ yards a game",
    # soccer — goals
    "goals_per_game": lambda v, c: f"scores {v:.2f} goals a game",
    "shots_per_game": lambda v, c: f"takes {v:.1f} shots a game",
    "sot_per_game": lambda v, c: f"puts {v:.1f} shots a game on target",
    "opp_goals_allowed": lambda v, c: f"faces a side conceding {v:.1f} goals a game",
    # NHL — two goals
    "goals_pg": lambda v, c: f"scores {v:.2f} goals a game",
    "sog_pg": lambda v, c: f"puts {v:.1f} shots a game on goal",
    "multi_goal_rate": lambda v, c: (f"scores twice in {v:.0f}% of games" if v > 0 else None),
    "pp_goals_pg": lambda v, c: f"scores {v:.2f} power-play goals a game",
    "toi": lambda v, c: f"plays {v:.1f} minutes a night",
    "opp_ga_pg": lambda v, c: f"faces a team allowing {v:.1f} goals a game",
    "opp_save_pct": lambda v, c: f"faces a team saving {v * 100:.1f}% of shots",
}

NO_STANDOUT = "No single factor stands out; the rank comes from the mix."


def read_line(factors: tuple[Factor, ...], values: dict) -> str:
    """The card's one-line "why" for a ranked player. Only factors in the top
    40% of today's pool are used, strongest first, at most two."""
    pct = values.get("_pct") or {}
    order = sorted((f for f in factors if pct.get(f.key) is not None and pct[f.key] >= 60),
                   key=lambda f: -pct[f.key])
    phrases: list[str] = []
    for f in order:
        v = values.get(f.key)
        tpl = READS.get(f.key)
        if v is None or tpl is None:
            continue
        p = tpl(float(v), values)
        if p:
            phrases.append(p)
        if len(phrases) == 2:
            break
    if not phrases:
        return NO_STANDOUT
    s = phrases[0] if len(phrases) == 1 else f"{phrases[0]}, and {phrases[1]}"
    return s[0].upper() + s[1:] + "."


# ---------------------------------------------------------------------------
# shared reads
# ---------------------------------------------------------------------------

async def _mlb_games_today(slate: date) -> list:
    games = [g for g in await gc.load_mlb_games() if not g.is_final]
    return [g for g in games if _et_date(g.game_date) == slate]


def _et_date(iso: str | None) -> date | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(ET).date()
    except ValueError:
        return None


async def _sport_games_today(sport: str, slate: date) -> list:
    loaded = await (gc.load_nhl_games() if sport == "nhl" else gc.load_sport_games(sport))
    games = [g for g in loaded if not g.is_final]
    return [g for g in games if _et_date(g.game_date) == slate]


async def first_start(sport: str, slate: date) -> datetime | None:
    games = await (_mlb_games_today(slate) if sport == "mlb" else _sport_games_today(sport, slate))
    starts = []
    for g in games:
        try:
            starts.append(datetime.fromisoformat((g.game_date or "").replace("Z", "+00:00")))
        except ValueError:
            continue
    return min(starts) if starts else None


def _roster_names(games) -> dict[str, str]:
    """{bare athlete id: name} from the games' own ESPN rosters.

    `player_game_history` stores no name, and only NFL has names in the prop
    archive — so without this a ranking renders raw ids. The roster is already
    loaded for every game, and its ids are the same ESPN ids the history uses,
    just prefixed (`espn:football:4430807`)."""
    out: dict[str, str] = {}
    for g in games:
        for r in getattr(g, "roster", None) or []:
            if r.subject_id and r.subject_name:
                out[str(r.subject_id).split(":")[-1]] = r.subject_name
    return out


UNKNOWN_PLAYER = "Unknown player"


async def _crosswalk_names(conn, sport: str, ids: list[str]) -> dict[str, str]:
    """The second place a name can come from: `athlete_crosswalk`, keyed by
    either id space (MLB's rankings use StatsAPI ids, the rest ESPN ids)."""
    if not ids:
        return {}
    out: dict[str, str] = {}
    for r in await conn.fetch(
            """SELECT espn_athlete_id, athlete_id, athlete_name FROM athlete_crosswalk
                WHERE sport = $1 AND athlete_name IS NOT NULL
                  AND (espn_athlete_id = ANY($2::text[]) OR athlete_id = ANY($2::text[]))""",
            sport, ids):
        for k in (r["espn_athlete_id"], r["athlete_id"]):
            if k in ids:
                out[str(k)] = r["athlete_name"]
    return out


async def _name_all(conn, sport: str, cands: list[Candidate]) -> None:
    """The `4. 4241372 · no` fix, at the writer: a name is the roster's, then
    the crosswalk's, then "Unknown player" — never the id."""
    missing = [c.subject_id for c in cands if not c.subject_name or c.subject_name == c.subject_id]
    names = await _crosswalk_names(conn, sport, missing) if missing else {}
    # Then the source itself: a handful of lookups for the top ten at most.
    for sid in [m for m in missing if m not in names][:20]:
        found = await _source_name(sport, sid)
        if found:
            names[sid] = found
    for c in cands:
        if not c.subject_name or c.subject_name == c.subject_id:
            c.subject_name = names.get(c.subject_id) or UNKNOWN_PLAYER


def _team_sides(games) -> dict[str, tuple]:
    """{team id: (abbr, opponent id, opponent abbr, game id, 'home'|'away')}."""
    teams: dict[str, tuple] = {}
    for g in games:
        teams[str(g.home_team_id or "")] = (g.home_abbr, str(g.away_team_id or ""), g.away_abbr, g.game_id, "home")
        teams[str(g.away_team_id or "")] = (g.away_abbr, str(g.home_team_id or ""), g.home_abbr, g.game_id, "away")
    teams.pop("", None)
    return teams


async def _current_team(conn, sport: str, team_ids: list[str], seasons: tuple[int, ...]) -> dict[str, str]:
    """{athlete: team} from each player's LATEST game, restricted to today's
    teams — so a player traded since last season is counted where he plays
    now, and once."""
    return {str(r["athlete_id"]): str(r["team_id"]) for r in await conn.fetch(
        """SELECT DISTINCT ON (athlete_id) athlete_id, team_id
             FROM player_game_history
            WHERE sport = $1 AND season = ANY($2::int[])
            ORDER BY athlete_id, game_date DESC""", sport, list(seasons))
        if str(r["team_id"]) in team_ids}


def _ip(v) -> float:
    """StatsAPI innings are thirds written as tenths: 6.1 is 6 1/3."""
    x = float(v or 0)
    whole = math.floor(x)
    return whole + round((x - whole) * 10) / 3


# ---------------------------------------------------------------------------
# MLB — weather and the park, from the one weather feed
# ---------------------------------------------------------------------------

WEATHER_FACTORS = (
    Factor("temp_f", "Temp", info="Temperature at first pitch (Open-Meteo); warm air carries. Roofed parks are left out."),
    Factor("wind_out", "Wind out", info="Wind blowing out toward center at first pitch, mph; negative blows in. Roofed parks are left out."),
)


async def _mlb_weather(slate: date) -> dict[str, dict]:
    """{game id: {temp_f, wind_out, wind_label}} at first pitch.

    Coordinates and the venue id come from StatsAPI's schedule (the same
    passthrough the game model reads); the reading is `predict/weather.py`'s
    `get_weather`, the one client everything else uses. A roofed park gets the
    roof's label and no numbers: its weather is not the day's."""
    import httpx

    from predict import park_orientation as po
    from predict import statsapi
    from predict.weather import get_weather

    out: dict[str, dict] = {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            for g in await statsapi.get_slate(client, slate.isoformat()):
                venue = g.venue or {}
                park = po.park_for(venue.get("id"), venue.get("name"))
                row: dict = {"temp_f": None, "wind_out": None, "wind_label": po.wind_label(park, None, None)}
                coords = (venue.get("location") or {}).get("defaultCoordinates") or {}
                if park is not None and park.roof == "open" and coords.get("latitude") is not None:
                    try:
                        at = datetime.fromisoformat((g.game_date or "").replace("Z", "+00:00"))
                    except ValueError:
                        at = None
                    w = await get_weather(client, float(coords["latitude"]), float(coords["longitude"]), False, at)
                    if w is not None:
                        out_mph = po.wind_out_mph(park, w.wind_mph, w.wind_from_deg)
                        row = {"temp_f": float(w.temp_f) if w.temp_f is not None else None,
                               "wind_out": out_mph, "wind_label": po.wind_label(park, w.wind_mph, out_mph)}
                out[str(g.game_pk)] = row
    except Exception:                                         # noqa: BLE001
        return out
    return out


# ---------------------------------------------------------------------------
# MLB — home run of the day
# ---------------------------------------------------------------------------

MLB_HR_FACTORS = (
    Factor("hr_per_pa", "HR/PA", info="Share of plate appearances ending in a home run this season."),
    Factor("vs_hand_hr_pa", "vs hand", info="The same share against the hand this starter throws (Statcast split)."),
    Factor("starter_hr_per_start", "SP HR allowed", info="Home runs the opposing starter has allowed per start."),
    Factor("park_factor", "Park", info="Park run factor this season: 1.18 = 18% more runs than average."),
    Factor("opp_staff_hr_rate", "Staff HR%", info="Share of games the opposing staff has allowed a home run."),
    Factor("temp_f", "Temp", info="Temperature at first pitch (Open-Meteo); warm air carries. Roofed parks are left out."),
    Factor("wind_out", "Wind out", info="Wind blowing out toward center at first pitch, mph; negative blows in. Roofed parks are left out."),
)


async def build_mlb_hr(conn, slate: date) -> list[Candidate]:
    games = await _mlb_games_today(slate)
    if not games:
        return []

    park = {r["venue_name"]: float(r["factor"]) for r in
            await conn.fetch("SELECT venue_name, factor FROM park_factors WHERE season = 2026")}
    staff = {str(r["team_id"]): (r["games_with_hr_allowed"] / r["games_faced"]) if r["games_faced"] else None
             for r in await conn.fetch("SELECT team_id, games_faced, games_with_hr_allowed FROM team_hr_rate_allowed WHERE season = 2026")}

    # Season batting from the history table, not from a snapshot: one source for
    # both the ranking and the grading that follows it.
    bat = {str(r["athlete_id"]): r for r in await conn.fetch(
        """SELECT athlete_id,
                  sum((stats->>'bat_homeRuns')::numeric)        AS hr,
                  sum((stats->>'bat_plateAppearances')::numeric) AS pa
             FROM player_game_history
            WHERE sport = 'mlb' AND season = 2026 AND stats ? 'bat_plateAppearances'
            GROUP BY 1""")}
    pit = {str(r["athlete_id"]): r for r in await conn.fetch(
        """SELECT athlete_id, sum((stats->>'pit_homeRuns')::numeric) AS hr, count(*) AS starts
             FROM player_game_history
            WHERE sport = 'mlb' AND season = 2026 AND (stats->>'pit_gamesStarted')::numeric > 0
            GROUP BY 1""")}
    splits = {str(r["player_id"]): (json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"])
              for r in await conn.fetch(
                  "SELECT player_id, payload FROM mlb_statcast_player_season WHERE season = 2026 AND role = 'bat'")}

    hands = await _starter_hands(games)
    weather = await _mlb_weather(slate)
    out: list[Candidate] = []
    for g in games:
        wx = weather.get(str(g.game_id)) or {}
        # The snapshot's roster is this game's two clubs, with `position == 'P'`
        # marking the probable starters (M0 carried the role through), so the
        # opposing pitcher is found on the card rather than re-fetched.
        for entry in g.roster:
            if (entry.position or "") == "P" or not entry.subject_id:
                continue
            sid = str(entry.subject_id)
            b = bat.get(sid)
            if not b or not b["pa"] or float(b["pa"]) < 150:
                continue
            is_home = entry.team_abbr == g.home_abbr
            opp_abbr = g.away_abbr if is_home else g.home_abbr
            opp_pitchers = [r for r in g.roster if (r.position or "") == "P" and r.team_abbr == opp_abbr]
            starter = opp_pitchers[0] if opp_pitchers else None
            hand = hands.get(str(starter.subject_id)) if starter else None
            sp = pit.get(str(starter.subject_id)) if starter else None
            split = ((splits.get(sid) or {}).get("splitsByHand") or {}).get(hand or "", {})
            out.append(Candidate(
                subject_id=sid, subject_name=entry.subject_name or sid, team=entry.team_abbr,
                opponent=opp_abbr, game_id=g.game_id,
                team_id=str(g.home_team_id if is_home else g.away_team_id) if g.home_team_id else None,
                opponent_id=str(g.away_team_id if is_home else g.home_team_id) if g.home_team_id else None,
                values={
                    "hr_per_pa": round(100 * float(b["hr"]) / float(b["pa"]), 3),
                    "vs_hand_hr_pa": (round(100 * split["hr"] / split["pa"], 3)
                                      if split.get("pa") and split.get("pa") >= 50 else None),
                    "starter_hr_per_start": (round(float(sp["hr"]) / sp["starts"], 3)
                                             if sp and sp["starts"] else None),
                    "park_factor": park.get(g.venue or ""),
                    "opp_staff_hr_rate": staff.get(str(g.away_team_id if is_home else g.home_team_id)),
                    "temp_f": wx.get("temp_f"),
                    "wind_out": wx.get("wind_out"),
                    "_starter": starter.subject_name if starter else None,
                    "_hand": hand,
                    "_wind_label": wx.get("wind_label"),
                },
            ))
    return out


async def _starter_hands(games) -> dict[str, str]:
    """Which hand each probable starter throws, from StatsAPI. Without it the
    platoon factor is simply absent."""
    ids = sorted({str(r.subject_id) for g in games for r in g.roster if (r.position or "") == "P" and r.subject_id})
    people = await _statsapi_people(ids)
    return {pid: p["hand"] for pid, p in people.items() if p.get("hand")}


async def _statsapi_people(ids: list[str]) -> dict[str, dict]:
    """{id: {name, hand}} from StatsAPI's people endpoint."""
    if not ids:
        return {}
    import httpx

    out: dict[str, dict] = {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            for i in range(0, len(ids), 40):
                res = await client.get("https://statsapi.mlb.com/api/v1/people",
                                       params={"personIds": ",".join(ids[i:i + 40])})
                if res.status_code != 200:
                    continue
                for p in res.json().get("people") or []:
                    out[str(p["id"])] = {"name": p.get("fullName"), "hand": (p.get("pitchHand") or {}).get("code")}
    except Exception:                                         # noqa: BLE001
        return out
    return out


# ---------------------------------------------------------------------------
# MLB — the day's longest home run
# ---------------------------------------------------------------------------

MLB_LONG_HR_FACTORS = (
    Factor("barrel_pct", "Barrel %", info="Share of balls in play hit 98+ mph at 26 to 30 degrees this season (Statcast)."),
    Factor("max_ev", "Max EV", info="The hardest-hit ball this season, mph (Statcast)."),
    Factor("avg_hr_dist", "Avg HR", info="Average true distance of this season's home runs, feet (Statcast)."),
    Factor("hr_430", "430+ HR", info="Home runs of 430 feet or more this season (Statcast)."),
    Factor("sp_hr9", "SP HR/9", info="Home runs per nine innings the opposing starter has allowed this season."),
    Factor("temp_f", "Temp", info="Temperature at first pitch (Open-Meteo); warm air carries. Roofed parks are left out."),
    Factor("wind_out", "Wind out", info="Wind blowing out toward center at first pitch, mph; negative blows in. Roofed parks are left out."),
)

# A longest-HR candidate needs a record of hitting them far: three home runs
# is the floor for an average distance to mean anything.
MIN_HR_FOR_DISTANCE = 3


async def build_mlb_longest_hr(conn, slate: date) -> list[Candidate]:
    games = await _mlb_games_today(slate)
    if not games:
        return []
    pa = {str(r["athlete_id"]): float(r["pa"] or 0) for r in await conn.fetch(
        """SELECT athlete_id, sum((stats->>'bat_plateAppearances')::numeric) AS pa
             FROM player_game_history
            WHERE sport = 'mlb' AND season = 2026 AND stats ? 'bat_plateAppearances'
            GROUP BY 1""")}
    pit = {str(r["athlete_id"]): r for r in await conn.fetch(
        """SELECT athlete_id, sum((stats->>'pit_homeRuns')::numeric) AS hr,
                  array_agg((stats->>'pit_inningsPitched')::numeric) AS ip
             FROM player_game_history
            WHERE sport = 'mlb' AND season = 2026 AND stats ? 'pit_inningsPitched'
            GROUP BY 1""")}
    statcast = {str(r["player_id"]): (json.loads(r["payload"]) if isinstance(r["payload"], str) else r["payload"])
                for r in await conn.fetch(
                    "SELECT player_id, payload FROM mlb_statcast_player_season WHERE season = 2026 AND role = 'bat'")}
    weather = await _mlb_weather(slate)

    out: list[Candidate] = []
    for g in games:
        wx = weather.get(str(g.game_id)) or {}
        for entry in g.roster:
            if (entry.position or "") == "P" or not entry.subject_id:
                continue
            sid = str(entry.subject_id)
            sc = statcast.get(sid) or {}
            dists = [float(h["distance"]) for h in sc.get("hrList") or [] if h.get("distance") is not None]
            if pa.get(sid, 0) < 150 or len(dists) < MIN_HR_FOR_DISTANCE:
                continue
            is_home = entry.team_abbr == g.home_abbr
            opp_abbr = g.away_abbr if is_home else g.home_abbr
            opp = [r for r in g.roster if (r.position or "") == "P" and r.team_abbr == opp_abbr]
            sp = pit.get(str(opp[0].subject_id)) if opp else None
            ip = sum(_ip(x) for x in (sp["ip"] or [])) if sp else 0.0
            out.append(Candidate(
                subject_id=sid, subject_name=entry.subject_name or sid, team=entry.team_abbr,
                opponent=opp_abbr, game_id=g.game_id,
                team_id=str(g.home_team_id if is_home else g.away_team_id) if g.home_team_id else None,
                opponent_id=str(g.away_team_id if is_home else g.home_team_id) if g.home_team_id else None,
                values={
                    "barrel_pct": sc.get("barrelish"),
                    "max_ev": sc.get("maxEV"),
                    "avg_hr_dist": round(sum(dists) / len(dists), 1),
                    "hr_430": float(sum(1 for d in dists if d >= 430)),
                    "sp_hr9": round(9 * float(sp["hr"] or 0) / ip, 2) if sp and ip >= 20 else None,
                    "temp_f": wx.get("temp_f"),
                    "wind_out": wx.get("wind_out"),
                    "_starter": opp[0].subject_name if opp else None,
                    "_wind_label": wx.get("wind_label"),
                },
            ))
    return out


# ---------------------------------------------------------------------------
# MLB — most strikeouts
# ---------------------------------------------------------------------------

MLB_K_FACTORS = (
    Factor("projected_k", "Proj K", info="The MLB prop model's projected strikeouts for this start."),
    Factor("k_per_start", "K/start", info="Strikeouts per start this season."),
    Factor("opp_k_per_game", "Opp K/G", info="Strikeouts the opponent's batters take per game this season."),
)


async def build_mlb_k(conn, slate: date) -> list[Candidate]:
    games = await _mlb_games_today(slate)
    if not games:
        return []
    proj = {str(r["subject_id"]): float(r["projection"]) for r in await conn.fetch(
        """SELECT DISTINCT ON (subject_id) subject_id, projection
             FROM prop_model_cache
            WHERE sport = 'mlb' AND dimension = 'pitcher-strikeouts' AND projection IS NOT NULL
            ORDER BY subject_id, computed_at DESC""")}
    season = {str(r["athlete_id"]): r for r in await conn.fetch(
        """SELECT athlete_id, sum((stats->>'pit_strikeOuts')::numeric) AS k, count(*) AS starts
             FROM player_game_history
            WHERE sport = 'mlb' AND season = 2026 AND (stats->>'pit_gamesStarted')::numeric > 0
            GROUP BY 1""")}
    team_k = {str(r["team_id"]): float(r["k"]) for r in await conn.fetch(
        """SELECT team_id, avg((stats->>'bat_strikeOuts')::numeric) AS k
             FROM team_game_production
            WHERE sport = 'mlb' AND season = 2026 AND pos_group = 'all'
              AND stats ? 'bat_strikeOuts'
            GROUP BY 1""")}
    out: list[Candidate] = []
    for g in games:
        for entry in g.roster:
            if (entry.position or "") != "P" or not entry.subject_id:
                continue
            sid = str(entry.subject_id)
            s = season.get(sid)
            if sid not in proj and not s:
                continue
            is_home = entry.team_abbr == g.home_abbr
            opp_id = str(g.away_team_id if is_home else g.home_team_id)
            out.append(Candidate(
                subject_id=sid, subject_name=entry.subject_name or sid, team=entry.team_abbr,
                opponent=g.away_abbr if is_home else g.home_abbr, game_id=g.game_id,
                team_id=str(g.home_team_id if is_home else g.away_team_id) if g.home_team_id else None,
                opponent_id=opp_id if g.home_team_id else None,
                values={
                    "projected_k": proj.get(sid),
                    "k_per_start": round(float(s["k"]) / s["starts"], 2) if s and s["starts"] else None,
                    "opp_k_per_game": round(team_k[opp_id], 2) if opp_id in team_k else None,
                },
            ))
    return out


# ---------------------------------------------------------------------------
# football — pick-3 anytime TD
# ---------------------------------------------------------------------------

TD_FACTORS = (
    Factor("td_per_game", "TD/G", info="Rushing + receiving touchdowns per game, last two seasons."),
    Factor("team_share", "Team TD share", info="The player's share of the team's rushing + receiving touchdowns."),
    Factor("opp_td_allowed", "Opp TD/G", info="Touchdowns the opponent allows per game to this position group."),
    Factor("implied_points", "Team pts", info="The team's implied points from today's spread and total."),
)


async def build_football_td(conn, slate: date, sport: str) -> list[Candidate]:
    games = await _sport_games_today(sport, slate)
    if not games:
        return []
    teams = _team_sides(games)
    if not teams:
        return []

    pos_group = "RB" if sport == "nfl" else "all"
    allowed = {str(r["opponent_id"]): float(r["td"]) for r in await conn.fetch(
        """SELECT opponent_id,
                  avg(COALESCE((stats->>'rushing.rushingTouchdowns')::numeric, 0)
                      + COALESCE((stats->>'receiving.receivingTouchdowns')::numeric, 0)) AS td
             FROM team_game_production
            WHERE sport = $1 AND season = 2026 AND pos_group = $2
            GROUP BY 1""", sport, pos_group)}

    rows = await conn.fetch(
        """SELECT athlete_id, team_id, count(*) AS g,
                  sum(COALESCE((stats->>'rushing.rushingTouchdowns')::numeric, 0)
                      + COALESCE((stats->>'receiving.receivingTouchdowns')::numeric, 0)) AS td
             FROM player_game_history
            WHERE sport = $1 AND season IN (2025, 2026) AND team_id = ANY($2::text[])
            GROUP BY 1, 2""", sport, list(teams))
    team_td: dict[str, float] = {}
    for r in rows:
        team_td[str(r["team_id"])] = team_td.get(str(r["team_id"]), 0.0) + float(r["td"] or 0)

    names = _roster_names(games)

    implied = await _implied_points(conn, sport, [g.game_id for g in games])
    out: list[Candidate] = []
    for r in rows:
        tid = str(r["team_id"])
        if tid not in teams or not r["td"] or r["g"] < 3:
            continue
        abbr, opp_id, opp_abbr, game_id, home_away = teams[tid]
        out.append(Candidate(
            subject_id=str(r["athlete_id"]),
            subject_name=names.get(str(r["athlete_id"]), ""),
            team=abbr, opponent=opp_abbr, game_id=game_id, team_id=tid, opponent_id=opp_id,
            values={
                "td_per_game": round(float(r["td"]) / r["g"], 3),
                "team_share": round(100 * float(r["td"]) / team_td[tid], 1) if team_td.get(tid) else None,
                "opp_td_allowed": round(allowed[opp_id], 3) if opp_id in allowed else None,
                "implied_points": implied.get((game_id, home_away)),
                "_games": int(r["g"]),
            },
        ))
    return out


async def _implied_points(conn, sport: str, game_ids: list[str]) -> dict[tuple[str, str], float]:
    """Each side's implied points from the consensus spread and total — the only
    odds anywhere near these rankings, and only as a measure of how much scoring
    the market expects. Absent when the game has no lines yet."""
    if not game_ids:
        return {}
    rows = await conn.fetch(
        """SELECT game_id, market, side, percentile_disc(0.5) WITHIN GROUP (ORDER BY point) AS point
             FROM game_odds_book_lines
            WHERE sport = $1 AND game_id = ANY($2::text[]) AND market IN ('spread', 'total') AND point IS NOT NULL
            GROUP BY 1, 2, 3""", "soccer" if sport.startswith("soccer") else sport, game_ids)
    total: dict[str, float] = {}
    spread: dict[str, float] = {}
    for r in rows:
        if r["market"] == "total" and r["side"] == "over":
            total[r["game_id"]] = float(r["point"])
        elif r["market"] == "spread" and r["side"] == "home":
            spread[r["game_id"]] = float(r["point"])
    out: dict[tuple[str, str], float] = {}
    for gid, t in total.items():
        s = spread.get(gid)
        if s is None:
            continue
        out[(gid, "home")] = round((t - s) / 2, 2)
        out[(gid, "away")] = round((t + s) / 2, 2)
    return out


# ---------------------------------------------------------------------------
# NFL — the slate's longest reception
# ---------------------------------------------------------------------------

LONG_REC_FACTORS = (
    Factor("adot", "aDOT", info="Average air yards per target, last two seasons (nflverse play-by-play)."),
    Factor("deep_tgt_pg", "Deep tgt/G", info="Targets thrown 20+ air yards downfield, per game."),
    Factor("air_share", "Air share", info="Share of the team's air yards in the games the player played."),
    Factor("yac_per_rec", "YAC/rec", info="Yards after the catch per reception."),
    Factor("avg_long", "Avg long", info="Average longest catch per game, last two seasons."),
    Factor("opp_20_allowed", "Opp 20+/G", info="Completions of 20+ yards the opponent's defense allows per game."),
)

# ESPN's team codes where nflverse spells them differently.
_NFLVERSE_ABBR = {"LAR": "LA", "WSH": "WAS"}
MIN_TARGETS = 15


async def build_nfl_longest_reception(conn, slate: date, games=None) -> list[Candidate]:
    import httpx

    import nfl_pbp

    games = games if games is not None else await _sport_games_today("nfl", slate)
    if not games:
        return []
    teams = _team_sides(games)
    if not teams:
        return []
    async with httpx.AsyncClient() as client:
        gsis = await nfl_pbp.espn_to_gsis(client)

    current = await _current_team(conn, "nfl", list(teams), (2025, 2026))
    longs = {str(r["athlete_id"]): r for r in await conn.fetch(
        """SELECT athlete_id, count(*) AS g, avg((stats->>'receiving.longReception')::numeric) AS avg_long
             FROM player_game_history
            WHERE sport = 'nfl' AND season IN (2025, 2026) AND athlete_id = ANY($1::text[])
              AND (stats->>'receiving.receptions')::numeric > 0
            GROUP BY 1""", list(current))}
    tgt = {r["receiver_id"]: r for r in await conn.fetch(
        """WITH rg AS (
               SELECT receiver_id, game_id, team, count(*) AS n, sum(air_yards) AS air
                 FROM nfl_target_events
                WHERE season IN (2025, 2026) AND receiver_id IS NOT NULL
                GROUP BY 1, 2, 3),
             t AS (
               SELECT game_id, team, sum(air_yards) AS team_air
                 FROM nfl_target_events WHERE season IN (2025, 2026) GROUP BY 1, 2)
           SELECT e.receiver_id, count(*) AS targets, count(DISTINCT e.game_id) AS g,
                  avg(e.air_yards) AS adot,
                  count(*) FILTER (WHERE e.air_yards >= 20) AS deep,
                  avg(e.yards_after_catch) FILTER (WHERE e.complete_pass) AS yac,
                  (SELECT sum(rg.air) / NULLIF(sum(t.team_air), 0)
                     FROM rg JOIN t USING (game_id, team) WHERE rg.receiver_id = e.receiver_id) AS share
             FROM nfl_target_events e
            WHERE e.season IN (2025, 2026) AND e.receiver_id = ANY($1::text[])
            GROUP BY 1""", [gsis[a] for a in current if a in gsis])}
    allowed = {r["defense"]: float(r["per_game"]) for r in await conn.fetch(
        """SELECT CASE WHEN team = split_part(game_id, '_', 3) THEN split_part(game_id, '_', 4)
                       ELSE split_part(game_id, '_', 3) END AS defense,
                  count(*) FILTER (WHERE complete_pass AND air_yards + COALESCE(yards_after_catch, 0) >= 20)::numeric
                    / NULLIF(count(DISTINCT game_id), 0) AS per_game
             FROM nfl_target_events WHERE season IN (2025, 2026)
            GROUP BY 1""") if r["per_game"] is not None}

    names = _roster_names(games)
    out: list[Candidate] = []
    for aid, tid in current.items():
        t = tgt.get(gsis.get(aid, ""))
        lg = longs.get(aid)
        if t is None or t["targets"] < MIN_TARGETS or t["g"] < 3:
            continue
        abbr, opp_id, opp_abbr, game_id, _ = teams[tid]
        out.append(Candidate(
            subject_id=aid, subject_name=names.get(aid, ""), team=abbr, opponent=opp_abbr,
            game_id=game_id, team_id=tid, opponent_id=opp_id,
            values={
                "adot": round(float(t["adot"]), 1) if t["adot"] is not None else None,
                "deep_tgt_pg": round(float(t["deep"]) / t["g"], 2),
                "air_share": round(100 * float(t["share"]), 1) if t["share"] is not None else None,
                "yac_per_rec": round(float(t["yac"]), 1) if t["yac"] is not None else None,
                "avg_long": round(float(lg["avg_long"]), 1) if lg and lg["g"] >= 3 and lg["avg_long"] is not None else None,
                "opp_20_allowed": (round(allowed[_NFLVERSE_ABBR.get(opp_abbr or "", opp_abbr or "")], 2)
                                   if _NFLVERSE_ABBR.get(opp_abbr or "", opp_abbr or "") in allowed else None),
                "_targets": int(t["targets"]),
            },
        ))
    return out


# ---------------------------------------------------------------------------
# soccer — anytime goalscorer
# ---------------------------------------------------------------------------

GOAL_FACTORS = (
    Factor("goals_per_game", "Goals/G", info="Goals per appearance, last two seasons."),
    Factor("shots_per_game", "Shots/G", info="Shots per appearance."),
    Factor("sot_per_game", "On target/G", info="Shots on target per appearance."),
    Factor("opp_goals_allowed", "Opp allows/G", info="Goals the opponent concedes per game this season."),
)


async def build_soccer_goals(conn, slate: date, sport: str) -> list[Candidate]:
    games = await _sport_games_today(sport, slate)
    if not games:
        return []
    teams = _team_sides(games)
    if not teams:
        return []
    allowed = {str(r["opponent_id"]): float(r["g"]) for r in await conn.fetch(
        """SELECT opponent_id, avg((stats->>'totalGoals')::numeric) AS g
             FROM team_game_production
            WHERE sport = $1 AND season = 2026 AND pos_group = 'all'
            GROUP BY 1""", sport)}
    names = _roster_names(games)
    rows = await conn.fetch(
        """SELECT athlete_id, team_id, count(*) AS apps,
                  sum(COALESCE((stats->>'totalGoals')::numeric, 0))   AS goals,
                  sum(COALESCE((stats->>'totalShots')::numeric, 0))   AS shots,
                  sum(COALESCE((stats->>'shotsOnTarget')::numeric, 0)) AS sot
             FROM player_game_history
            WHERE sport = $1 AND season IN (2025, 2026) AND team_id = ANY($2::text[])
            GROUP BY 1, 2""", sport, list(teams))
    out: list[Candidate] = []
    for r in rows:
        tid = str(r["team_id"])
        if tid not in teams or r["apps"] < 5:
            continue
        abbr, opp_id, opp_abbr, game_id, home_away = teams[tid]
        apps = int(r["apps"])
        out.append(Candidate(
            subject_id=str(r["athlete_id"]), subject_name=names.get(str(r["athlete_id"]), ""), team=abbr,
            opponent=opp_abbr, game_id=game_id, team_id=tid, opponent_id=opp_id,
            values={
                "goals_per_game": round(float(r["goals"]) / apps, 3),
                "shots_per_game": round(float(r["shots"]) / apps, 3),
                "sot_per_game": round(float(r["sot"]) / apps, 3),
                "opp_goals_allowed": round(allowed[opp_id], 3) if opp_id in allowed else None,
                "_apps": apps,
            },
        ))
    return out


# ---------------------------------------------------------------------------
# NHL — two or more goals
# ---------------------------------------------------------------------------

NHL_TWO_GOAL_FACTORS = (
    Factor("goals_pg", "Goals/G", info="Goals per game, last two seasons."),
    Factor("sog_pg", "Shots/G", info="Shots on goal per game."),
    Factor("multi_goal_rate", "2+ G games", info="Share of games with two or more goals, last two seasons."),
    Factor("pp_goals_pg", "PP goals/G", info="Power-play goals per game."),
    Factor("toi", "TOI", info="Average time on ice per game, minutes."),
    Factor("opp_ga_pg", "Opp GA/G", info="Goals the opponent allows per game, last two seasons."),
    Factor("opp_save_pct", "Opp SV%", info="The opponent's team save percentage, last two seasons.", higher_better=False),
)

# NHL `season` is the year it starts: 2025 is 2025-26.
NHL_SEASONS = (2025, 2026)


async def build_nhl_two_goals(conn, slate: date, games=None) -> list[Candidate]:
    games = games if games is not None else await _sport_games_today("nhl", slate)
    if not games:
        return []
    teams = _team_sides(games)
    if not teams:
        return []
    current = await _current_team(conn, "nhl", list(teams), NHL_SEASONS)
    rows = {str(r["athlete_id"]): r for r in await conn.fetch(
        """SELECT athlete_id, count(*) AS g,
                  sum(COALESCE((stats->>'goals')::numeric, 0)) AS goals,
                  sum(COALESCE((stats->>'sog')::numeric, 0)) AS sog,
                  sum(COALESCE((stats->>'powerPlayGoals')::numeric, 0)) AS ppg,
                  avg((stats->>'toiMinutes')::numeric) AS toi,
                  count(*) FILTER (WHERE (stats->>'goals')::numeric >= 2) AS multi
             FROM player_game_history
            WHERE sport = 'nhl' AND season = ANY($1::int[]) AND athlete_id = ANY($2::text[])
              AND stats ? 'goals'
            GROUP BY 1""", list(NHL_SEASONS), list(current))}
    opp = {str(r["team_id"]): r for r in await conn.fetch(
        """SELECT team_id, avg((stats->>'goalsAgainst')::numeric) AS ga,
                  sum((stats->>'saves')::numeric) / NULLIF(sum((stats->>'shotsAgainst')::numeric), 0) AS sv
             FROM team_game_production
            WHERE sport = 'nhl' AND season = ANY($1::int[]) AND pos_group = 'all'
            GROUP BY 1""", list(NHL_SEASONS))}
    out: list[Candidate] = []
    for aid, tid in current.items():
        r = rows.get(aid)
        if r is None or r["g"] < 20 or float(r["goals"] or 0) < 5:
            continue
        abbr, opp_id, opp_abbr, game_id, _ = teams[tid]
        g = int(r["g"])
        o = opp.get(opp_id)
        out.append(Candidate(
            subject_id=aid, subject_name="", team=abbr, opponent=opp_abbr, game_id=game_id,
            team_id=tid, opponent_id=opp_id,
            values={
                "goals_pg": round(float(r["goals"]) / g, 3),
                "sog_pg": round(float(r["sog"]) / g, 2),
                "multi_goal_rate": round(100 * float(r["multi"]) / g, 1),
                "pp_goals_pg": round(float(r["ppg"]) / g, 3),
                "toi": round(float(r["toi"]), 1) if r["toi"] is not None else None,
                "opp_ga_pg": round(float(o["ga"]), 2) if o and o["ga"] is not None else None,
                "opp_save_pct": round(float(o["sv"]), 4) if o and o["sv"] is not None else None,
                "_games": g,
            },
        ))
    return out


# ---------------------------------------------------------------------------
# the registry
# ---------------------------------------------------------------------------

RANKINGS: tuple[RankingDef, ...] = (
    RankingDef("mlb-hr-of-the-day", ("mlb",), "HR of the day", "Player to hit a home run",
               MLB_HR_FACTORS, build_mlb_hr, grade_stat="bat_homeRuns",
               not_held="Lineup spot is not held.", detail="mlb_bat"),
    RankingDef("mlb-longest-hr", ("mlb",), "Longest home run", "Hit the day's longest home run",
               MLB_LONG_HR_FACTORS, build_mlb_longest_hr, grade_stat="_hr_distance",
               not_held="A park distance factor and the lineup spot are not held.",
               hit_rule="slate_max", detail="mlb_hr_distance"),
    RankingDef("mlb-most-strikeouts", ("mlb",), "Most strikeouts", "Most strikeouts on the slate",
               MLB_K_FACTORS, build_mlb_k, grade_stat="pit_strikeOuts", detail="mlb_pit"),
    RankingDef("nfl-anytime-td", ("nfl",), "Pick-3 anytime TD", "Pick 3 players to score a TD",
               TD_FACTORS, lambda c, d: build_football_td(c, d, "nfl"), grade_stat="_td",
               not_held="Red-zone role is not held.", detail="football_td"),
    RankingDef("nfl-longest-reception", ("nfl",), "Longest reception", "Make the slate's longest catch",
               LONG_REC_FACTORS, lambda c, d: build_nfl_longest_reception(c, d), grade_stat="receiving.longReception",
               not_held="Coverage shell and the quarterback's deep accuracy are not held.",
               hit_rule="slate_max", detail="football_rec"),
    RankingDef("cfb-anytime-td", ("cfb",), "Pick-3 anytime TD", "Pick 3 players to score a TD",
               TD_FACTORS, lambda c, d: build_football_td(c, d, "cfb"), grade_stat="_td",
               not_held="CFB holds no position-group split, so the opponent factor is team-wide.", detail="football_td"),
    RankingDef("soccer-anytime-goalscorer", ("soccer_epl", "soccer_mls"), "Anytime goalscorer", "Anytime goalscorer",
               GOAL_FACTORS, lambda c, d, s="soccer_epl": build_soccer_goals(c, d, s), grade_stat="totalGoals",
               not_held="Penalty takers and confirmed lineups are not held.", detail="soccer"),
    RankingDef("nhl-two-goals", ("nhl",), "Two goals", "Player to score 2+ goals",
               NHL_TWO_GOAL_FACTORS, lambda c, d: build_nhl_two_goals(c, d), grade_stat="goals",
               not_held="Expected goals, power-play ice time and the confirmed starting goalie are not held.",
               hit_rule="gte2", detail="nhl"),
)


# ---------------------------------------------------------------------------
# the run: compute, freeze, grade
# ---------------------------------------------------------------------------

async def run(slate: date | None = None, grade_for: date | None = None) -> dict:
    """One pass. Safe to call every few minutes.

    Each ranking is recomputed while its sport's first game is still ahead of
    us, then frozen. Yesterday's frozen top five is graded from
    `player_game_history`, which is the same table the ranking's own factors
    came from — so a receipt is measured the way the ranking was.
    """
    now = datetime.now(timezone.utc)
    slate = slate or now.astimezone(ET).date()
    grade_for = grade_for or (slate - timedelta(days=1))

    pool = await db.get_pool()
    written = frozen = 0
    per_ranking: dict[str, str] = {}

    async with pool.acquire() as conn:
        for rdef in RANKINGS:
            for sport in rdef.sports:
                key = f"{rdef.id}:{sport}" if len(rdef.sports) > 1 else rdef.id
                start = await first_start(sport, slate)
                if start is None:
                    per_ranking[key] = "no games today"
                    continue
                if now >= start:
                    n = await db.freeze_slate_rankings(sport, slate, [rdef.id])
                    frozen += n
                    per_ranking[key] = f"frozen ({n} rows)" if n else "already frozen"
                    continue
                try:
                    cands = await rdef.build(conn, slate) if len(rdef.sports) == 1 else await rdef.build(conn, slate, sport)
                except TypeError:
                    cands = await rdef.build(conn, slate)
                if not cands:
                    per_ranking[key] = "no candidates"
                    continue
                score(cands, rdef.factors)
                cands = [c for c in cands if c.values.get("_score") is not None]
                cands.sort(key=lambda c: -(c.values["_score"] or 0))
                top = cands[: rdef.top_n]
                await _name_all(conn, sport, top)
                written += await db.write_slate_rankings(ranking_rows(rdef, sport, slate, top))
                per_ranking[key] = f"{len(cands)} candidates -> top {len(top)}"

    graded = await grade(grade_for)
    return {"slate": str(slate), "written": written, "frozen": frozen, "graded": graded,
            "rankings": per_ranking}


def ranking_rows(rdef: RankingDef, sport: str, slate: date, top: list[Candidate]) -> list[dict]:
    """The rows `write_slate_rankings` stores. `factors` carries every
    measured value, its percentile, and the card's words (`_read`, and the
    Wind cell's `_wind_label` where there is one)."""
    rows = []
    for i, c in enumerate(top, 1):
        factors = {k: v for k, v in c.values.items() if not k.startswith("_")}
        factors["percentiles"] = c.values.get("_pct", {})
        factors["_read"] = read_line(rdef.factors, c.values)
        if c.values.get("_wind_label"):
            factors["_wind_label"] = c.values["_wind_label"]
        rows.append({
            "sport": sport, "slate_date": slate, "ranking_id": rdef.id, "subject_id": c.subject_id,
            "rank": i, "score": c.values.get("_score"), "subject_name": c.subject_name,
            "team": c.team, "opponent": c.opponent, "game_id": c.game_id,
            "factors": json.dumps(factors), "kind": rdef.kind,
            "team_id": c.team_id, "opponent_id": c.opponent_id,
        })
    return rows


# ---------------------------------------------------------------------------
# grading
# ---------------------------------------------------------------------------

_GRADE_SQL = {
    "bat_homeRuns": "COALESCE((stats->>'bat_homeRuns')::numeric, 0)",
    "pit_strikeOuts": "COALESCE((stats->>'pit_strikeOuts')::numeric, 0)",
    "totalGoals": "COALESCE((stats->>'totalGoals')::numeric, 0)",
    "goals": "COALESCE((stats->>'goals')::numeric, 0)",
    "receiving.longReception": "COALESCE((stats->>'receiving.longReception')::numeric, 0)",
    "_td": ("COALESCE((stats->>'rushing.rushingTouchdowns')::numeric, 0) + "
            "COALESCE((stats->>'receiving.receivingTouchdowns')::numeric, 0)"),
}
# Graded from somewhere other than `player_game_history`'s stats: the day's
# home-run distances live in the Statcast rollup's `hrList`.
_GRADE_ELSEWHERE = {"_hr_distance"}


def _i(stats: dict, key: str) -> int:
    v = stats.get(key)
    try:
        return int(round(float(v))) if v is not None else 0
    except (TypeError, ValueError):
        return 0


def _toi(minutes) -> str:
    m = float(minutes or 0)
    return f"{int(m)}:{round((m - int(m)) * 60):02d}"


def detail_line(kind: str, stats: dict, value: float | None = None) -> str:
    """The graded player's stat line for the receipts table.

    Keys are `player_game_history`'s, the same the per-sport form lines read
    in TypeScript (C2.1); C2 adds the test that the two agree."""
    if kind == "mlb_bat":
        return f"{_i(stats, 'bat_homeRuns')} HR · {_i(stats, 'bat_hits')}-{_i(stats, 'bat_atBats')} · {_i(stats, 'bat_rbi')} RBI"
    if kind == "mlb_hr_distance":
        head = f"HR {value:.0f} ft" if value else "No HR"
        return f"{head} · {_i(stats, 'bat_hits')}-{_i(stats, 'bat_atBats')}"
    if kind == "mlb_pit":
        ip = stats.get("pit_inningsPitched")
        ip_s = f"{float(ip):.1f}" if ip is not None else "0.0"
        return f"{_i(stats, 'pit_strikeOuts')} K · {ip_s} IP · {_i(stats, 'pit_earnedRuns')} ER"
    if kind == "football_td":
        parts = []
        if _i(stats, "rushing.rushingAttempts"):
            parts.append(f"{_i(stats, 'rushing.rushingAttempts')} car · {_i(stats, 'rushing.rushingYards')} yds")
        if _i(stats, "receiving.receptions"):
            parts.append(f"{_i(stats, 'receiving.receptions')} rec · {_i(stats, 'receiving.receivingYards')} yds")
        td = _i(stats, "rushing.rushingTouchdowns") + _i(stats, "receiving.receivingTouchdowns")
        parts.append(f"{td} TD")
        return " · ".join(parts)
    if kind == "football_rec":
        return (f"{_i(stats, 'receiving.receptions')} rec · {_i(stats, 'receiving.receivingYards')} yds"
                f" · long {_i(stats, 'receiving.longReception')}")
    if kind == "soccer":
        g = _i(stats, "totalGoals")
        return f"{g} {'goal' if g == 1 else 'goals'} · {_i(stats, 'totalShots')} shots · {_i(stats, 'shotsOnTarget')} on target"
    if kind == "nhl":
        return f"{_i(stats, 'goals')} G · {_i(stats, 'sog')} SOG · {_toi(stats.get('toiMinutes'))} TOI"
    return ""


DID_NOT_PLAY = "Did not play"


async def _history_row(conn, sport: str, athlete_id: str, slate: date) -> dict | None:
    r = await conn.fetchrow(
        """SELECT stats FROM player_game_history
            WHERE sport = $1 AND athlete_id = $2 AND game_date = $3::date
            ORDER BY fetched_at DESC LIMIT 1""", sport, athlete_id, slate)
    if r is None:
        return None
    return r["stats"] if isinstance(r["stats"], dict) else json.loads(r["stats"] or "{}")


async def _team_landed(conn, sport: str, team_id: str | None, slate: date) -> bool:
    """Whether this team's game has reached the history table. A player whose
    team HAS landed but who has no row did not play; one whose team has not
    landed yet is not graded this pass (a late game, not a did-not-play).
    Rows written before PY-A carry no team id and keep the old rule."""
    if not team_id:
        return True
    return bool(await conn.fetchval(
        """SELECT EXISTS (SELECT 1 FROM player_game_history
                           WHERE sport = $1 AND team_id = $2 AND game_date = $3::date)""",
        sport, team_id, slate))


async def _hr_distances(conn, slate: date) -> dict[str, float] | None:
    """{batter: the day's longest HR, ft} from the Statcast rollup, or None
    while the rollup has not been rebuilt since the slate ended (it runs
    daily; grading waits for it rather than scoring everyone zero)."""
    built = await conn.fetchval(
        "SELECT max(computed_at) FROM mlb_statcast_player_season WHERE season = $1 AND role = 'bat'", slate.year)
    ready_after = datetime.combine(slate + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=12)
    if built is None or built < ready_after:
        return None
    out: dict[str, float] = {}
    for r in await conn.fetch(
            """SELECT s.player_id, max((h->>'distance')::numeric) AS d
                 FROM mlb_statcast_player_season s, jsonb_array_elements(s.payload->'hrList') h
                WHERE s.season = $1 AND s.role = 'bat' AND h->>'date' = $2 AND h->>'distance' IS NOT NULL
                GROUP BY 1""", slate.year, slate.isoformat()):
        out[str(r["player_id"])] = float(r["d"])
    return out


async def _source_name(sport: str, athlete_id: str) -> str | None:
    """A name from the feed the id came from: StatsAPI for MLB, ESPN's athlete
    endpoint for the rest. Used for a ranked player the roster did not name,
    and for a slate leader we did not rank."""
    if sport == "mlb":
        return ((await _statsapi_people([athlete_id])).get(athlete_id) or {}).get("name")
    import httpx

    if sport == "nhl":
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
                res = await client.get(f"https://api-web.nhle.com/v1/player/{athlete_id}/landing")
                if res.status_code == 200:
                    j = res.json() or {}
                    first, last = (j.get("firstName") or {}).get("default"), (j.get("lastName") or {}).get("default")
                    return f"{first} {last}" if first and last else None
        except Exception:                                     # noqa: BLE001
            return None
        return None
    path = {"nfl": "football/nfl", "cfb": "football/college-football",
            "soccer_epl": "soccer/eng.1", "soccer_mls": "soccer/usa.1"}.get(sport)
    if path is None:
        return None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            res = await client.get(f"https://site.web.api.espn.com/apis/common/v3/sports/{path}/athletes/{athlete_id}")
            if res.status_code == 200:
                return ((res.json() or {}).get("athlete") or {}).get("displayName")
    except Exception:                                         # noqa: BLE001
        return None
    return None


async def grade(slate: date) -> int:
    """What actually happened, for the frozen top five of a past slate.

    A ranking is graded by its own `hit_rule`. For a "longest" ranking the
    slate's actual leader is found too — ranked by us or not — and written as
    the `__leader__` row that drives "Yesterday: longest was 468 ft · our #3"."""
    pending = await db.ungraded_frozen_rankings(slate)
    if not pending:
        return 0
    by_ranking = {r.id: r for r in RANKINGS}
    groups: dict[tuple[str, str], list[dict]] = {}
    for row in pending:
        groups.setdefault((row["sport"], row["ranking_id"]), []).append(row)

    pool = await db.get_pool()
    out: list[dict] = []
    async with pool.acquire() as conn:
        for (sport, ranking_id), rows in groups.items():
            rdef = by_ranking.get(ranking_id)
            if rdef is None:
                continue
            distances: dict[str, float] | None = None
            if rdef.grade_stat in _GRADE_ELSEWHERE:
                distances = await _hr_distances(conn, slate)
                if distances is None:
                    continue
            elif rdef.grade_stat not in _GRADE_SQL:
                continue

            graded_rows: list[tuple[dict, dict]] = []
            for row in rows:
                if not await _team_landed(conn, sport, row.get("team_id"), slate):
                    continue
                stats = await _history_row(conn, sport, row["subject_id"], slate)
                if stats is None:
                    graded_rows.append((row, {"played": False, "detail": DID_NOT_PLAY}))
                    continue
                if distances is not None:
                    value = distances.get(row["subject_id"], 0.0)
                else:
                    value = float(await conn.fetchval(
                        f"SELECT {_GRADE_SQL[rdef.grade_stat]} FROM (SELECT $1::jsonb AS stats) s",
                        json.dumps(stats)) or 0)
                graded_rows.append((row, {"played": True, "value": value,
                                          "detail": detail_line(rdef.detail, stats, value)}))

            leader = None
            if rdef.hit_rule == "slate_max":
                leader = await _slate_leader(conn, rdef, sport, slate, distances)
            for row, outcome in graded_rows:
                if outcome["played"]:
                    outcome["hit"] = is_hit(rdef.hit_rule, outcome["value"], leader["value"] if leader else None)
                out.append({**row, "outcome": json.dumps(outcome)})

            if leader is not None:
                ours = next((r["rank"] for r, _ in graded_rows if r["subject_id"] == leader["leaderId"]), None)
                if ours is None:
                    ours = await conn.fetchval(
                        """SELECT rank FROM slate_rankings WHERE sport = $1 AND slate_date = $2::date
                              AND ranking_id = $3 AND subject_id = $4""", sport, slate, ranking_id, leader["leaderId"])
                name = await conn.fetchval(
                    """SELECT subject_name FROM slate_rankings WHERE sport = $1 AND slate_date = $2::date
                          AND subject_id = $3 AND subject_name IS NOT NULL LIMIT 1""", sport, slate, leader["leaderId"])
                leader["leaderName"] = name or await _source_name(sport, leader["leaderId"]) or UNKNOWN_PLAYER
                leader["ourRank"] = ours
                await db.write_ranking_leader({
                    "sport": sport, "slate_date": slate, "ranking_id": ranking_id, "kind": rdef.kind,
                    "subject_name": leader["leaderName"], "team": None, "outcome": json.dumps(leader)})
    return await db.write_ranking_outcomes(out)


async def _slate_leader(conn, rdef: RankingDef, sport: str, slate: date,
                        distances: dict[str, float] | None) -> dict | None:
    """The slate's actual leader for a `slate_max` ranking."""
    if distances is not None:
        if not distances:
            return None
        lid = max(distances, key=lambda k: distances[k])
        return {"leaderId": lid, "value": distances[lid]}
    r = await conn.fetchrow(
        f"""SELECT athlete_id, {_GRADE_SQL[rdef.grade_stat]} AS v FROM player_game_history
             WHERE sport = $1 AND game_date = $2::date
             ORDER BY v DESC NULLS LAST LIMIT 1""", sport, slate)
    if r is None or r["v"] is None or float(r["v"]) <= 0:
        return None
    return {"leaderId": str(r["athlete_id"]), "value": float(r["v"])}
