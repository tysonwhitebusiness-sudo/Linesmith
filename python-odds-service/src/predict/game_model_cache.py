"""Direct port of the gameModel/Elo composition slice of lib/sports/mlb/adapter.ts
— not the whole 2321-line file. Phase M of the TS cutover gameplan
(docs/mlb-prediction-engine-ts-cutover-gameplan-2026-08-22.md) scoped this
to exactly what compute_moneyline_model/get_current_elo/predict_home_win_prob
need — team season stats/standings (Phase K), weather (Phase L), the wOBA-
based lineup platoon factor (this file, adapter.ts:110-207, none of those
three functions are exported so they're ported verbatim from the just-read
source, not reconstructed), and Elo (Phase C, already built). Deliberately
excludes everything display-only in the real snapshot (rankings, ordinal
labels, division names) — none of that feeds a prediction.

Produces the exact same SnapshotGameModel/SnapshotElo shape
odds_lines_cycle.py already consumes from TS's snapshot — once Phase N
persists this to Postgres, odds_lines_cycle.py needs zero further changes
to read Python's own computation instead of TS's.
"""
import asyncio
from dataclasses import dataclass, field
from datetime import datetime

import httpx

import db

from . import statsapi
from .elo_model import get_current_elo, pitcher_adjustment, rest_and_travel_from_state
from .game_model import MoneylineDiagnostics as GameModelDiagnostics
from .game_model import MoneylineInput, OpposingStarter, TeamOffenseDefense, TeamRecordSplit, compute_moneyline_model
from .game_pick_lock import MoneylineDiagnostics as PickLockDiagnostics
from .odds_lines_cycle import SnapshotElo, SnapshotGameModel
from .weather import get_weather, weather_runs_factor


def _to_pick_lock_diagnostics(d: GameModelDiagnostics) -> PickLockDiagnostics:
    """game_model.py and game_pick_lock.py each declare their own
    MoneylineDiagnostics (matching the TS source's own duplication —
    gameModel.ts's inline diagnostics type and gamePickLock.ts's separately
    declared MoneylineDiagnostics interface are structurally identical but
    not the same declared type there either). TS's structural typing needs
    no conversion; Python's dataclasses do."""
    return PickLockDiagnostics(
        raw_log5_home_win_prob=d.raw_log5_home_win_prob,
        home_venue_edge=d.home_venue_edge,
        away_venue_edge=d.away_venue_edge,
        home_recent_edge=d.home_recent_edge,
        away_recent_edge=d.away_recent_edge,
        raw_home_recent_edge=d.raw_home_recent_edge,
        raw_away_recent_edge=d.raw_away_recent_edge,
        park_factor=d.park_factor,
    )


# ---------------------------------------------------------------------------
# wOBA-based lineup platoon factor (adapter.ts:110-207, module-private in
# the TS source — copied verbatim from the just-read file, not exported,
# not reconstructed from memory)
# ---------------------------------------------------------------------------

WOBA_WEIGHTS = {"walk": 0.69, "hitByPitch": 0.72, "single": 0.89, "double": 1.27, "triple": 1.62, "homeRun": 2.1}
# Below this many at-bats in the split, a batter's vs-handedness rate is too
# thin to trust.
MIN_AB_FOR_PLATOON_SPLIT = 20
# Bounds the whole lineup's platoon adjustment to +-15% of their normal
# scoring rate — one hot/cold platoon read shouldn't dominate the model.
MAX_PLATOON_FACTOR_DEVIATION = 0.15


@dataclass
class _HittingCounts:
    at_bats: float = 0.0
    walks: float = 0.0
    hit_by_pitch: float = 0.0
    sac_flies: float = 0.0
    singles: float = 0.0
    doubles: float = 0.0
    triples: float = 0.0
    home_runs: float = 0.0


def _num0(v) -> float:
    if v is None or isinstance(v, bool):
        return 0.0
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0.0
    return n if n == n else 0.0


def _sum_hitting_counts(logs: list[statsapi.GameLogSplit]) -> _HittingCounts:
    out = _HittingCounts()
    for g in logs:
        stat = g.stat or {}
        hits = _num0(stat.get("hits"))
        doubles = _num0(stat.get("doubles"))
        triples = _num0(stat.get("triples"))
        home_runs = _num0(stat.get("homeRuns"))
        out.at_bats += _num0(stat.get("atBats"))
        out.walks += _num0(stat.get("baseOnBalls"))
        out.hit_by_pitch += _num0(stat.get("hitByPitch"))
        out.sac_flies += _num0(stat.get("sacFlies"))
        out.singles += hits - doubles - triples - home_runs
        out.doubles += doubles
        out.triples += triples
        out.home_runs += home_runs
    return out


def _woba_from_counts(c: _HittingCounts) -> float | None:
    denom = c.at_bats + c.walks + c.sac_flies + c.hit_by_pitch
    if denom <= 0:
        return None
    numer = (
        WOBA_WEIGHTS["walk"] * c.walks
        + WOBA_WEIGHTS["hitByPitch"] * c.hit_by_pitch
        + WOBA_WEIGHTS["single"] * c.singles
        + WOBA_WEIGHTS["double"] * c.doubles
        + WOBA_WEIGHTS["triple"] * c.triples
        + WOBA_WEIGHTS["homeRun"] * c.home_runs
    )
    return numer / denom


def lineup_platoon_factor(
    lineup_ids: list[int],
    opposing_hand: str | None,
    batters: dict[int, statsapi.PersonStats],
    starters_by_game: dict[int, dict],
    hand_by_id: dict[int, statsapi.HandednessEntry],
) -> float:
    """How much today's actual lineup — specifically facing this handedness
    of starter — should be expected to out- or under-perform its own
    overall rate. 1.0 (no adjustment) whenever there isn't enough real
    signal: unknown opposing hand, a batter missing from the fetched
    stats, or too few plate appearances in the split to trust it for that
    one batter."""
    if not opposing_hand or not lineup_ids:
        return 1.0

    ratio_sum = 0.0
    count = 0
    for id_ in lineup_ids:
        person = batters.get(id_)
        if not person:
            continue

        vs_hand_logs = []
        for split in person.game_log:
            if not split.game_pk:
                continue
            starters = starters_by_game.get(split.game_pk)
            if not starters:
                continue
            opposing_id = starters.get("away_id") if split.is_home else starters.get("home_id")
            if not opposing_id:
                continue
            entry = hand_by_id.get(opposing_id)
            if entry is not None and entry.pitch_hand == opposing_hand:
                vs_hand_logs.append(split)

        vs_hand_counts = _sum_hitting_counts(vs_hand_logs)
        if vs_hand_counts.at_bats < MIN_AB_FOR_PLATOON_SPLIT:
            continue

        overall_counts = _sum_hitting_counts(person.game_log)
        vs_hand_woba = _woba_from_counts(vs_hand_counts)
        overall_woba = _woba_from_counts(overall_counts)
        if vs_hand_woba is None or overall_woba is None or overall_woba <= 0:
            continue

        ratio_sum += vs_hand_woba / overall_woba
        count += 1

    if count == 0:
        return 1.0
    avg_ratio = ratio_sum / count
    return min(1 + MAX_PLATOON_FACTOR_DEVIATION, max(1 - MAX_PLATOON_FACTOR_DEVIATION, avg_ratio))


# ---------------------------------------------------------------------------
# Slate-wide shared context (adapter.ts's own batch-loaded maps, one fetch
# each per slate rather than once per game)
# ---------------------------------------------------------------------------

# How many days back the starters-by-game lookup (for platoon-factor
# opponent resolution) spans — matches adapter.ts's RANGE_DAYS exactly.
RANGE_DAYS = 45


@dataclass
class SlateContext:
    season: int
    standings: dict[int, statsapi.TeamRecord]
    hitting_by_id: dict[int, statsapi.TeamStatLine]
    pitching_by_id: dict[int, statsapi.TeamStatLine]
    pitcher_stats_by_id: dict[int, statsapi.PitcherStatLine]
    starts_by_pitcher_id: dict[int, int]
    starters_by_game: dict[int, dict]
    hand_by_id: dict[int, statsapi.HandednessEntry]
    park_factor_by_venue: dict[int, float]


async def build_slate_context(client: httpx.AsyncClient, season: int, today: str, starter_ids: list[int]) -> SlateContext:
    """`starter_ids` should be today's actual probable starters (home+away
    across every game in the slate) — all `hand_by_id` needs is enough
    coverage to resolve each game's `opposingHand`, not every starter
    across the whole 45-day range."""
    range_games = await statsapi.get_schedule_range(client, statsapi.shift_date(today, -RANGE_DAYS), today)
    starters_by_game: dict[int, dict] = {}
    for game in range_games:
        home_id = ((game.teams.get("home") or {}).get("probablePitcher") or {}).get("id")
        away_id = ((game.teams.get("away") or {}).get("probablePitcher") or {}).get("id")
        starters_by_game[game.game_pk] = {"home_id": home_id, "away_id": away_id}

    team_hitting, team_pitching, standings, league_pitcher_stats, park_factor_rows, hand_by_id = await asyncio.gather(
        statsapi.get_team_season_stats(client, season, "hitting"),
        statsapi.get_team_season_stats(client, season, "pitching"),
        statsapi.get_standings(client, season),
        statsapi.get_league_starting_pitcher_stats(client, season),
        db.read_park_factors(season),
        statsapi.get_handedness(client, starter_ids),
    )

    return SlateContext(
        season=season,
        standings=standings,
        hitting_by_id={t.team_id: t for t in team_hitting},
        pitching_by_id={t.team_id: t for t in team_pitching},
        pitcher_stats_by_id={p.person_id: p for p in league_pitcher_stats},
        starts_by_pitcher_id={p.person_id: p.games_started for p in league_pitcher_stats},
        starters_by_game=starters_by_game,
        hand_by_id=hand_by_id,
        park_factor_by_venue={r.venue_id: r.factor for r in park_factor_rows},
    )


def _record_split(rec: statsapi.StandingsRecordSplit | None) -> TeamRecordSplit | None:
    return TeamRecordSplit(wins=int(rec.wins), losses=int(rec.losses)) if rec is not None else None


def _per_game_runs(line: statsapi.TeamStatLine | None) -> float | None:
    if line is None or line.games_played == 0:
        return None
    runs = line.values.get("runs")
    return runs / line.games_played if runs is not None else None


def team_offense_defense(context: SlateContext, team_id: int, is_home: bool) -> TeamOffenseDefense | None:
    """teamContext's runs-in/runs-allowed-plus-record slice — the subset
    compute_moneyline_model actually reads. None when a team's runs data
    isn't available yet (matches gameModelFor's own null-return guard)."""
    hitting = context.hitting_by_id.get(team_id)
    pitching = context.pitching_by_id.get(team_id)
    runs_scored = _per_game_runs(hitting)
    runs_allowed = _per_game_runs(pitching)
    if runs_scored is None or runs_allowed is None:
        return None

    record = context.standings.get(team_id)
    venue_record = (record.home_record if is_home else record.away_record) if record is not None else None
    return TeamOffenseDefense(
        runs_scored_per_game=runs_scored,
        runs_allowed_per_game=runs_allowed,
        season_record=_record_split(record) if record is not None else None,
        venue_record=_record_split(venue_record),
        recent_record=_record_split(record.last_ten if record is not None else None),
    )


def starter_info_for(context: SlateContext, starter_id: int | None) -> OpposingStarter | None:
    if starter_id is None:
        return None
    stat = context.pitcher_stats_by_id.get(starter_id)
    era = stat.values.get("era") if stat else None
    if era is None:
        return None
    return OpposingStarter(era=era, starts=context.starts_by_pitcher_id.get(starter_id, 0))


# ---------------------------------------------------------------------------
# Per-game composition
# ---------------------------------------------------------------------------


@dataclass
class GameModelGameInput:
    game_pk: int
    home_team_id: int
    away_team_id: int
    # Display names, carried alongside the ids so a caller writing
    # pick_history rows has the subject_name column's value without a second
    # slate fetch — logGameModelPredictions' TS original read them straight
    # off the snapshot's own game objects. None when the MLB API omits one.
    home_team_name: str | None
    away_team_name: str | None
    venue_id: int | None
    venue_name: str | None
    venue_latitude: float | None
    venue_longitude: float | None
    game_date_iso: str
    home_starter_id: int | None
    away_starter_id: int | None
    # 'pre' | 'live' | 'done' | 'unknown' — matches adapter.ts's statusFor.
    # Callers writing predictions must gate on 'pre': a prediction for a
    # game already in progress or final isn't a prediction, same principle
    # game_pick_lock.py's grade_finished_game_picks already documents.
    status: str = "unknown"
    home_lineup_ids: list[int] = field(default_factory=list)
    away_lineup_ids: list[int] = field(default_factory=list)
    # Whether each lineup is PROJECTED rather than officially posted.
    # Carried through from TeamSide (which has always had it) because
    # game_sim_cache.ensure_game_sims keys its "should I re-simulate?"
    # decision on exactly this: a projected-lineup sim is upgraded to a
    # posted-lineup one once the real card is out, and without this flag
    # every caller would either re-simulate constantly or never upgrade.
    home_lineup_projected: bool = True
    away_lineup_projected: bool = True


def status_for(abstract_state: str | None) -> str:
    return {"Live": "live", "Preview": "pre", "Final": "done"}.get(abstract_state or "", "unknown")


async def compute_game_model_for_game(client: httpx.AsyncClient, context: SlateContext, batters: dict[int, statsapi.PersonStats], g: GameModelGameInput) -> SnapshotGameModel | None:
    home = team_offense_defense(context, g.home_team_id, True)
    away = team_offense_defense(context, g.away_team_id, False)
    if home is None or away is None:
        return None

    park_factor = context.park_factor_by_venue.get(g.venue_id, 1.0) if g.venue_id is not None else 1.0

    weather_factor = 1.0
    if g.venue_latitude is not None and g.venue_longitude is not None:
        at = datetime.fromisoformat(g.game_date_iso[:-1] + "+00:00" if g.game_date_iso.endswith("Z") else g.game_date_iso)
        weather = await get_weather(client, g.venue_latitude, g.venue_longitude, False, at)
        weather_factor = weather_runs_factor(g.venue_name, weather.temp_f if weather else None)

    home_hand = context.hand_by_id.get(g.away_starter_id) if g.away_starter_id else None
    away_hand = context.hand_by_id.get(g.home_starter_id) if g.home_starter_id else None
    home_opposing_hand = home_hand.pitch_hand if home_hand else None
    away_opposing_hand = away_hand.pitch_hand if away_hand else None

    home_platoon = lineup_platoon_factor(g.home_lineup_ids, home_opposing_hand, batters, context.starters_by_game, context.hand_by_id)
    away_platoon = lineup_platoon_factor(g.away_lineup_ids, away_opposing_hand, batters, context.starters_by_game, context.hand_by_id)

    result = compute_moneyline_model(
        MoneylineInput(
            home=TeamOffenseDefense(
                runs_scored_per_game=home.runs_scored_per_game * home_platoon,
                runs_allowed_per_game=home.runs_allowed_per_game,
                season_record=home.season_record,
                venue_record=home.venue_record,
                recent_record=home.recent_record,
            ),
            away=TeamOffenseDefense(
                runs_scored_per_game=away.runs_scored_per_game * away_platoon,
                runs_allowed_per_game=away.runs_allowed_per_game,
                season_record=away.season_record,
                venue_record=away.venue_record,
                recent_record=away.recent_record,
            ),
            home_starter=starter_info_for(context, g.home_starter_id),
            away_starter=starter_info_for(context, g.away_starter_id),
            park_factor=park_factor * weather_factor,
        )
    )

    return SnapshotGameModel(
        home_expected_runs=result.home_expected_runs,
        away_expected_runs=result.away_expected_runs,
        home_win_prob=result.home_win_prob,
        away_win_prob=result.away_win_prob,
        diagnostics=_to_pick_lock_diagnostics(result.diagnostics),
    )


async def compute_elo_for_game(season: int, home_team_id: int, away_team_id: int, game_date: str, home_starter_id: int | None, away_starter_id: int | None) -> SnapshotElo:
    home_state, away_state = await asyncio.gather(get_current_elo(home_team_id, season), get_current_elo(away_team_id, season))
    home_rt = rest_and_travel_from_state(home_state, game_date, home_team_id)
    away_rt = rest_and_travel_from_state(away_state, game_date, home_team_id)
    home_pitcher_adj, away_pitcher_adj = await asyncio.gather(
        pitcher_adjustment(home_starter_id, home_team_id, season, game_date),
        pitcher_adjustment(away_starter_id, away_team_id, season, game_date),
    )
    return SnapshotElo(
        home_elo=home_state.elo,
        home_games_played=home_state.games_played,
        away_elo=away_state.elo,
        away_games_played=away_state.games_played,
        home_rest_days=home_rt.rest_days,
        away_rest_days=away_rt.rest_days,
        home_travel_miles=home_rt.miles,
        away_travel_miles=away_rt.miles,
        home_pitcher_adj=home_pitcher_adj,
        away_pitcher_adj=away_pitcher_adj,
    )


# ---------------------------------------------------------------------------
# Today's real slate + lineup resolution (adapter.ts:438-1899's makeSide /
# buildRecentLineups) — genuinely new scope discovered while building this
# phase: without today's REAL posted-or-projected lineup, gameModel would
# be computed against a stand-in roster rather than TS's real prediction
# input, defeating the point of Phase N (Python becoming a genuine second
# source, not an approximate one).
# ---------------------------------------------------------------------------


@dataclass
class TeamSide:
    team_id: int | None
    team_name: str | None
    abbreviation: str | None
    is_home: bool
    lineup: list[int]
    lineup_projected: bool
    starter_id: int | None
    starter_name: str | None


def build_recent_lineups(games: list[statsapi.MlbGame]) -> dict[int, dict]:
    """Most recent posted batting order per team, used to project today's
    lineup before it's announced. Later games overwrite earlier ones
    (games sorted ascending by date first), leaving the most recent."""
    out: dict[int, dict] = {}
    for game in sorted(games, key=lambda g: g.game_date):
        for side in ("away", "home"):
            players = (game.lineups or {}).get(f"{side}Players")
            if not players:
                continue
            team_id = ((game.teams.get(side) or {}).get("team") or {}).get("id")
            if team_id is None:
                continue
            out[team_id] = {"ids": [p["id"] for p in players], "date": game.game_date}
    return out


def _make_side(game: statsapi.MlbGame, which: str, recent_lineups: dict[int, dict]) -> TeamSide:
    team = (game.teams.get(which) or {}).get("team") or {}
    posted = (game.lineups or {}).get(f"{which}Players")
    fallback = recent_lineups.get(team.get("id"))
    use_posted = bool(posted)
    starter = (game.teams.get(which) or {}).get("probablePitcher") or {}
    team_name = team.get("name") or ""
    return TeamSide(
        team_id=team.get("id"),
        team_name=team_name,
        abbreviation=team.get("abbreviation") or team_name[:3].upper(),
        is_home=which == "home",
        lineup=[p["id"] for p in posted] if use_posted else (fallback.get("ids") if fallback else []),
        lineup_projected=not use_posted,
        starter_id=starter.get("id"),
        starter_name=starter.get("fullName"),
    )


async def build_slate_game_inputs(client: httpx.AsyncClient, today: str) -> list[GameModelGameInput]:
    """Today's real games with real posted-or-projected lineups and real
    starters — the caller-supplied inputs compute_game_model_for_game needs,
    resolved the same way adapter.ts's own makeSide does."""
    slate = await statsapi.get_slate(client, today)
    recent_lineup_games = await statsapi.get_recent_lineups(client, today, 4)
    recent_lineups = build_recent_lineups(recent_lineup_games)

    inputs: list[GameModelGameInput] = []
    for game in slate:
        home = _make_side(game, "home", recent_lineups)
        away = _make_side(game, "away", recent_lineups)
        venue = game.venue or {}
        coords = (venue.get("location") or {}).get("defaultCoordinates") or {}
        inputs.append(
            GameModelGameInput(
                game_pk=game.game_pk,
                home_team_id=home.team_id,
                away_team_id=away.team_id,
                home_team_name=home.team_name,
                away_team_name=away.team_name,
                venue_id=venue.get("id"),
                venue_name=venue.get("name"),
                venue_latitude=coords.get("latitude"),
                venue_longitude=coords.get("longitude"),
                game_date_iso=game.game_date,
                home_starter_id=home.starter_id,
                away_starter_id=away.starter_id,
                status=status_for(game.abstract_state),
                home_lineup_ids=home.lineup,
                away_lineup_ids=away.lineup,
                home_lineup_projected=home.lineup_projected,
                away_lineup_projected=away.lineup_projected,
            )
        )
    return inputs
