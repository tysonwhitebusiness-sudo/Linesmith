"""M3 — the Slate's odds-free rankings, frozen before the games start.

The Specials section ranks players for the promos books run — home run of the
day, most strikeouts, pick-3 anytime TD, anytime goalscorer — from the player
and the circumstances, with **no odds in the ranking at all**. Each factor is a
column the card shows; the score is the mean of the factors' percentiles over
that day's pool, equal weights, until the pre-registered backtest sets them
(docs/design/m3-ranking-preregistration.md).

THREE THINGS THIS FILE IS CAREFUL ABOUT

1. **Frozen before first pitch.** A ranking recomputed after the games would
   grade itself against what already happened. Rows refresh until the sport's
   first game starts; then `frozen_at` is stamped and they never move. Receipts
   are graded the next morning from `player_game_history`.

2. **Every factor is real or absent.** Nothing is imputed. A batter with no
   Statcast split against the starter's hand gets NULL for that factor and is
   scored on the rest — never a league-average stand-in, which would rank him as
   if we knew something we do not.

3. **It ranks, it does not predict.** The score is a composite of percentiles,
   not a probability, and nothing here touches a price. The register
   (`model_status.py`) keeps these separate from the models with gates.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
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
    games = [g for g in await gc.load_sport_games(sport) if not g.is_final]
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


# ---------------------------------------------------------------------------
# MLB — home run of the day
# ---------------------------------------------------------------------------

MLB_HR_FACTORS = (
    Factor("hr_per_pa", "HR/PA", info="Share of plate appearances ending in a home run this season."),
    Factor("vs_hand_hr_pa", "vs hand", info="The same share against the hand this starter throws (Statcast split)."),
    Factor("starter_hr_per_start", "SP HR allowed", info="Home runs the opposing starter has allowed per start."),
    Factor("park_factor", "Park", info="Park run factor this season: 1.18 = 18% more runs than average."),
    Factor("opp_staff_hr_rate", "Staff HR%", info="Share of games the opposing staff has allowed a home run."),
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
    out: list[Candidate] = []
    for g in games:
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
                values={
                    "hr_per_pa": round(100 * float(b["hr"]) / float(b["pa"]), 3),
                    "vs_hand_hr_pa": (round(100 * split["hr"] / split["pa"], 3)
                                      if split.get("pa") and split.get("pa") >= 50 else None),
                    "starter_hr_per_start": (round(float(sp["hr"]) / sp["starts"], 3)
                                             if sp and sp["starts"] else None),
                    "park_factor": park.get(g.venue or ""),
                    "opp_staff_hr_rate": staff.get(str(g.away_team_id if is_home else g.home_team_id)),
                    "_starter": starter.subject_name if starter else None,
                    "_hand": hand,
                },
            ))
    return out


async def _starter_hands(games) -> dict[str, str]:
    """Which hand each probable starter throws, from StatsAPI. Without it the
    platoon factor is simply absent."""
    ids = sorted({str(r.subject_id) for g in games for r in g.roster if (r.position or "") == "P" and r.subject_id})
    if not ids:
        return {}
    import httpx

    out: dict[str, str] = {}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            for i in range(0, len(ids), 40):
                res = await client.get("https://statsapi.mlb.com/api/v1/people",
                                       params={"personIds": ",".join(ids[i:i + 40])})
                if res.status_code != 200:
                    continue
                for p in res.json().get("people") or []:
                    code = (p.get("pitchHand") or {}).get("code")
                    if code:
                        out[str(p["id"])] = code
    except Exception:                                         # noqa: BLE001
        return out
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
            out.append(Candidate(
                subject_id=sid, subject_name=entry.subject_name or sid, team=entry.team_abbr,
                opponent=g.away_abbr if is_home else g.home_abbr, game_id=g.game_id,
                values={
                    "projected_k": proj.get(sid),
                    "k_per_start": round(float(s["k"]) / s["starts"], 2) if s and s["starts"] else None,
                    "opp_k_per_game": (round(team_k[str(g.away_team_id if is_home else g.home_team_id)], 2)
                                       if str(g.away_team_id if is_home else g.home_team_id) in team_k else None),
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


def _roster_names(games) -> dict[str, str]:
    """{bare athlete id: name} from the games' own ESPN rosters.

    `player_game_history` stores no name, and only NFL has names in the prop
    archive — so without this a ranking renders raw ids. The roster is already
    loaded for every game, and its ids are the same ESPN ids the history uses,
    just prefixed (`espn:football:4430807`)."""
    out: dict[str, str] = {}
    for g in games:
        for r in g.roster:
            if r.subject_id and r.subject_name:
                out[str(r.subject_id).split(":")[-1]] = r.subject_name
    return out


async def build_football_td(conn, slate: date, sport: str) -> list[Candidate]:
    games = await _sport_games_today(sport, slate)
    if not games:
        return []
    teams = {}
    for g in games:
        teams[str(g.home_team_id or "")] = (g.home_abbr, str(g.away_team_id or ""), g.away_abbr, g.game_id, "home")
        teams[str(g.away_team_id or "")] = (g.away_abbr, str(g.home_team_id or ""), g.home_abbr, g.game_id, "away")
    teams.pop("", None)
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
            subject_name=names.get(str(r["athlete_id"]), str(r["athlete_id"])),
            team=abbr, opponent=opp_abbr, game_id=game_id,
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
    teams = {}
    for g in games:
        teams[str(g.home_team_id or "")] = (g.home_abbr, str(g.away_team_id or ""), g.away_abbr, g.game_id, "home")
        teams[str(g.away_team_id or "")] = (g.away_abbr, str(g.home_team_id or ""), g.home_abbr, g.game_id, "away")
    teams.pop("", None)
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
            subject_id=str(r["athlete_id"]), subject_name=names.get(str(r["athlete_id"]), str(r["athlete_id"])), team=abbr,
            opponent=opp_abbr, game_id=game_id,
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
# the registry
# ---------------------------------------------------------------------------

RANKINGS: tuple[RankingDef, ...] = (
    RankingDef("mlb-hr-of-the-day", ("mlb",), "HR of the day", "Player to hit a home run",
               MLB_HR_FACTORS, build_mlb_hr, grade_stat="bat_homeRuns",
               not_held="Lineup spot and wind direction relative to the park are not held."),
    RankingDef("mlb-most-strikeouts", ("mlb",), "Most strikeouts", "Most strikeouts on the slate",
               MLB_K_FACTORS, build_mlb_k, grade_stat="pit_strikeOuts"),
    RankingDef("nfl-anytime-td", ("nfl",), "Pick-3 anytime TD", "Pick 3 players to score a TD",
               TD_FACTORS, lambda c, d: build_football_td(c, d, "nfl"), grade_stat="_td",
               not_held="Red-zone role is not held."),
    RankingDef("cfb-anytime-td", ("cfb",), "Pick-3 anytime TD", "Pick 3 players to score a TD",
               TD_FACTORS, lambda c, d: build_football_td(c, d, "cfb"), grade_stat="_td",
               not_held="CFB holds no position-group split, so the opponent factor is team-wide."),
    RankingDef("soccer-anytime-goalscorer", ("soccer_epl", "soccer_mls"), "Anytime goalscorer", "Anytime goalscorer",
               GOAL_FACTORS, lambda c, d, s="soccer_epl": build_soccer_goals(c, d, s), grade_stat="totalGoals",
               not_held="Penalty takers and confirmed lineups are not held."),
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
                rows = []
                for i, c in enumerate(cands[: rdef.top_n], 1):
                    rows.append({
                        "sport": sport, "slate_date": slate, "ranking_id": rdef.id, "subject_id": c.subject_id,
                        "rank": i, "score": c.values.get("_score"), "subject_name": c.subject_name,
                        "team": c.team, "opponent": c.opponent, "game_id": c.game_id,
                        "factors": json.dumps({k: v for k, v in c.values.items() if not k.startswith("_")}
                                              | {"percentiles": c.values.get("_pct", {})}),
                    })
                written += await db.write_slate_rankings(rows)
                per_ranking[key] = f"{len(cands)} candidates -> top {len(rows)}"

    graded = await grade(grade_for)
    return {"slate": str(slate), "written": written, "frozen": frozen, "graded": graded,
            "rankings": per_ranking}


_GRADE_SQL = {
    "bat_homeRuns": "COALESCE((stats->>'bat_homeRuns')::numeric, 0)",
    "pit_strikeOuts": "COALESCE((stats->>'pit_strikeOuts')::numeric, 0)",
    "totalGoals": "COALESCE((stats->>'totalGoals')::numeric, 0)",
    "_td": ("COALESCE((stats->>'rushing.rushingTouchdowns')::numeric, 0) + "
            "COALESCE((stats->>'receiving.receivingTouchdowns')::numeric, 0)"),
}


async def grade(slate: date) -> int:
    """What actually happened, for the frozen top five of a past slate."""
    pending = await db.ungraded_frozen_rankings(slate)
    if not pending:
        return 0
    by_ranking = {r.id: r for r in RANKINGS}
    pool = await db.get_pool()
    out: list[dict] = []
    async with pool.acquire() as conn:
        for row in pending:
            rdef = by_ranking.get(row["ranking_id"])
            if rdef is None:
                continue
            expr = _GRADE_SQL.get(rdef.grade_stat)
            if expr is None:
                continue
            got = await conn.fetchval(
                f"""SELECT {expr} FROM player_game_history
                     WHERE sport = $1 AND athlete_id = $2 AND game_date = $3::date
                     ORDER BY fetched_at DESC LIMIT 1""",
                row["sport"], row["subject_id"], slate,
            )
            outcome = ({"played": False} if got is None
                       else {"played": True, "value": float(got), "hit": float(got) > 0})
            out.append({**row, "outcome": json.dumps(outcome)})
    return await db.write_ranking_outcomes(out)
