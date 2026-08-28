"""Phase 4 of docs/daily-picks-full-model-build-2026-08-27.md — the real
per-sport production job: for every real scheduled game today, every
rostered player, every applicable DimensionConfig (Phase 2), builds a real
prop candidate from `player_game_history` (Phase 0's table — NOT a live
per-player fetch, the entire point of the unified architecture) and logs
it to `pick_history` via `db.log_surfaced`, reusing `build_candidate`
(generic_prop_score.py) exactly as-is.

Mirrors `predict.prop_pick_history.candidate_to_surfaced_entry`'s job
(convert a candidate to a `db.SurfacedEntry`), but simpler: `build_candidate`
already resolves the live edge and prop score internally (unlike MLB's
`CandidateResult`, which needs `prop_pick_history.py` to do that
afterward), so `_candidate_to_entry` below is a straight field copy, no
recomputation. `category` is always "over" — same real, disclosed
convention `build_candidate` itself already uses internally for every
counting-stat dimension.

Sport-key vs app-sport: `player_game_history`/ESPN discovery use each
sport's own internal routing key (`soccer_epl`/`soccer_mls` kept
separate, matching backfill_player_game_history.py's own SCOPE), but
`pick_history` — read by the frontend's generic `Sport` type
(lib/core/types.ts has one `'soccer'` value, no EPL/MLS split) — is
written under the generic app-facing sport, same `_APP_SPORT_BY_KEY`
normalization `generic_pick_capture.py` and db.py's own
`_GENERIC_SPORT_KEY` already use for game_picks/game_odds_book_lines.

X-signal wiring, per sport (Phase 3's real, disclosed scope):
  - NFL: build_nfl_team_defense_index, keyed by ESPN abbreviation —
    resolved via a real team_id->abbr map (ESPN's own scoreboard, same
    discovery pattern generic_matchup_defense.py's team-discovery
    functions already use). position_group is the DIMENSION's own stat
    category (passing/rushing/receiving), not the subject's roster
    position — see generic_matchup_defense._nfl_position_group's own
    docstring for why.
  - NBA/NHL: build_nba_team_defense_index/build_nhl_team_defense_index,
    same ESPN-abbr resolution as NFL. position_group here IS the
    subject's own roster position (guards/forwards/centers;
    forwards/defense), via generic_matchup_defense._nba_position_group/
    _nhl_position_group and the real position ESPN's roster endpoint
    returns (fetch_roster_athlete_ids's third tuple element).
  - CFB: build_cfb_team_defense_index, resolved via fuzzy_lookup_cfb_defense
    against the opponent's real ESPN display name (no numeric-id
    crosswalk needed — CFBD has none to ESPN's ids, same real gap
    cfbd.ts's own module docstring discloses). Real, currently-exhausted
    monthly CFBD quota (user-confirmed 2026-08-27, accepted as-is) means
    this returns an empty index today — build_candidate already treats
    that as "no X signal", same as before Phase 3 existed.
  - Soccer EPL: build_understat_team_defense_index +
    fuzzy_lookup_understat_defense, only for the three genuinely
    attacking-output dimensions (assists/shots/shots-on-target) per
    understat.py's own module docstring — yellow-cards/saves never get a
    defense_index passed, same "absent, not fabricated" behavior.
  - Soccer MLS: no X-signal (user-confirmed 2026-08-27) — defense_index
    always None.

Phase 5 (rare markets) runs in the SAME pass, per player, reusing the
exact roster/history/X-signal data already fetched for the regular
dimensions — no separate job, no second roster/history fetch. See
predict/generic_rare_markets.py for the admission-gate + derived-
condition machinery (NFL/CFB anytime-td, NHL goals, soccer
anytime-goalscorer, NBA triple-double).
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

import config
import db
from entity_resolution import candidate_dimension_to_market_key
from predict import generic_team_elo as gte
from predict.cfbd import build_cfb_team_defense_index, fuzzy_lookup_cfb_defense
from predict.generic_dimension_configs import CFB_DIMENSIONS, NBA_DIMENSIONS, NFL_DIMENSIONS, NHL_DIMENSIONS, SOCCER_DIMENSIONS
from predict.generic_matchup_defense import (
    TeamDefenseAllowed,
    _nba_position_group,
    _nfl_position_group,
    _nhl_position_group,
    build_nba_team_defense_index,
    build_nfl_team_defense_index,
    build_nhl_team_defense_index,
)
from predict.generic_pick_capture import _APP_SPORT_BY_KEY, fetch_scheduled_games
from predict.generic_player_gamelog import PlayerGameStat, fetch_roster_athlete_ids
from predict.generic_prop_score import DimensionConfig, GenericPropCandidate, build_candidate, compute_league_rate
from predict.generic_rare_markets import (
    CFB_RARE_DIMENSION,
    CFB_RARE_LINE,
    NBA_RARE_DIMENSION,
    NBA_RARE_LINE,
    NFL_RARE_DIMENSION,
    NFL_RARE_LINE,
    NHL_RARE,
    SOCCER_RARE,
    anytime_td_condition,
    build_derived_rare_candidate,
    build_rare_candidate,
    compute_derived_league_rate,
    triple_double_condition,
)
from predict.prop_pick_history import trust_tier_map
from predict.understat import build_understat_team_defense_index, fuzzy_lookup_understat_defense

_DIMENSIONS_BY_SPORT_KEY: dict[str, list[DimensionConfig]] = {
    "nfl": NFL_DIMENSIONS,
    "cfb": CFB_DIMENSIONS,
    "nba": NBA_DIMENSIONS,
    "nhl": NHL_DIMENSIONS,
    "soccer_epl": SOCCER_DIMENSIONS,
    "soccer_mls": SOCCER_DIMENSIONS,
}

# See generic_prop_score.compute_league_rate's own docstring for why these
# differ per sport — NBA's real key is "minutes", NHL's is "toiMinutes",
# football/soccer have no per-player time-on-field field in ESPN's
# boxscore at all.
_MINUTES_STAT_NAME: dict[str, str | None] = {
    "nfl": None,
    "cfb": None,
    "nba": "minutes",
    "nhl": "toiMinutes",
    "soccer_epl": None,
    "soccer_mls": None,
}

# The three Understat-backed dimensions a real defensive signal is
# actually meaningful for — see understat.py's own module docstring.
_SOCCER_X_SIGNAL_DIMENSIONS = {"assists", "shots", "shots-on-target"}


async def _fetch_espn_team_abbr_map(client: httpx.AsyncClient, espn_sport: str, espn_league: str, days: int = 45) -> dict[str, str]:
    """Real (ESPN team_id -> abbreviation) map from a real scoreboard
    sweep — same discovery pattern generic_matchup_defense.py's own
    _fetch_nba_current_teams/_fetch_nfl_current_teams use for team
    discovery, generalized here to resolve a ScheduledGame's numeric
    ESPN team id into the abbreviation build_nba_team_defense_index/
    build_nhl_team_defense_index/build_nfl_team_defense_index key their
    leaderboards by. NHL's own leaderboard is keyed by api-web.nhle.com's
    own abbreviation, not ESPN's — assumed equivalent (every real NHL
    team's abbreviation is the same well-known 2-3 letter code in both
    systems), a real, disclosed simplification, not a verified crosswalk."""
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)
    url = f"https://site.api.espn.com/apis/site/v2/sports/{espn_sport}/{espn_league}/scoreboard"
    try:
        res = await client.get(url, params={"dates": f"{start:%Y%m%d}-{now:%Y%m%d}", "limit": 1000}, timeout=httpx.Timeout(15.0))
        data = res.json() if res.status_code == 200 else {}
    except httpx.HTTPError:
        data = {}
    out: dict[str, str] = {}
    for ev in data.get("events") or []:
        comps = (ev.get("competitions") or [{}])[0].get("competitors") or []
        for c in comps:
            team = c.get("team") or {}
            tid, abbr = team.get("id"), team.get("abbreviation")
            if tid and abbr:
                out[str(tid)] = abbr
    return out


def _candidate_to_entry(app_sport: str, subject_id: str, subject_name: str, game_id: str, candidate: GenericPropCandidate, trust_tiers: dict[str, str]) -> "db.SurfacedEntry | None":
    if candidate.model_prob is None:
        return None  # sample_size==0 (dimension doesn't apply to this player) — nothing real to log
    return db.SurfacedEntry(
        sport=app_sport,
        subject_id=subject_id,
        subject_name=subject_name,
        dimension=candidate.dimension,
        category="over",
        market_key=candidate_dimension_to_market_key(candidate.dimension),
        line=candidate.line,
        game_id=game_id,
        sample_size=candidate.sample_size,
        distance=None,
        event_context=None,
        model_prob=candidate.model_prob,
        market_prob=candidate.edge_info.market_prob if candidate.edge_info else None,
        edge=candidate.edge_info.edge if candidate.edge_info else None,
        price_source=candidate.edge_info.price_source if candidate.edge_info else None,
        bookmaker=candidate.edge_info.bookmaker if candidate.edge_info else None,
        price_captured_at=candidate.edge_info.price_captured_at if candidate.edge_info else None,
        prop_score=candidate.score.score if candidate.score else None,
        score_grade=candidate.score.grade if candidate.score else None,
        trust_tier=trust_tiers.get(candidate.dimension, "building"),
        edge_source=candidate.edge_info.edge_source if candidate.edge_info else None,
        price=candidate.edge_info.price if candidate.edge_info else None,
    )


@dataclass
class _RosterPlayer:
    athlete_id: str
    name: str
    position_abbr: str | None
    games: list[PlayerGameStat]


async def _load_roster_with_history(sport_key: str, team_id: str, season: int, espn_sport: str, espn_league: str, client: httpx.AsyncClient) -> list[_RosterPlayer]:
    roster = await fetch_roster_athlete_ids(client, espn_sport, espn_league, team_id)
    out: list[_RosterPlayer] = []
    for athlete_id, name, position_abbr in roster:
        games = await db.fetch_player_games_from_db(sport_key, athlete_id, season)
        out.append(_RosterPlayer(athlete_id=athlete_id, name=name, position_abbr=position_abbr, games=games))
    return out


async def _x_signal_for_sport(sport_key: str, season: int, client: httpx.AsyncClient) -> tuple[dict[str, TeamDefenseAllowed] | None, dict[str, str]]:
    """Returns (defense_index, espn_team_id -> resolvable_key map).
    `resolvable_key` is already whatever key that sport's own index uses
    (ESPN abbr for NFL/NBA/NHL) — CFB/Soccer-EPL don't need this map at
    all (they resolve straight from the opponent's ESPN display name via
    a fuzzy lookup, called per-candidate instead), so they return an
    empty map here; MLS returns (None, {})."""
    if sport_key == "nfl":
        idx = await build_nfl_team_defense_index(season_year=season)
        abbr_map = await _fetch_espn_team_abbr_map(client, "football", "nfl")
        return idx, abbr_map
    if sport_key == "nba":
        idx = await build_nba_team_defense_index(season_year=season)
        abbr_map = await _fetch_espn_team_abbr_map(client, "basketball", "nba")
        return idx, abbr_map
    if sport_key == "nhl":
        idx = await build_nhl_team_defense_index()
        abbr_map = await _fetch_espn_team_abbr_map(client, "hockey", "nhl")
        return idx, abbr_map
    if sport_key == "cfb":
        idx = await build_cfb_team_defense_index(season=str(season))
        return idx, {}
    if sport_key == "soccer_epl":
        idx = await build_understat_team_defense_index()
        return idx, {}
    return None, {}  # soccer_mls — no real X-signal source (user-confirmed 2026-08-27)


def _position_group_for(sport_key: str, cfg: DimensionConfig, subject_position_abbr: str | None) -> str | None:
    if sport_key in ("nfl", "cfb"):
        return _nfl_position_group(cfg.espn_stat_name)
    if sport_key == "nba":
        return _nba_position_group(subject_position_abbr)
    if sport_key == "nhl":
        return _nhl_position_group(subject_position_abbr or "")
    if sport_key in ("soccer_epl", "soccer_mls"):
        return "attacking" if cfg.dimension in _SOCCER_X_SIGNAL_DIMENSIONS else None
    return None


def _opponent_abbr_for(sport_key: str, opponent_team_id: str, opponent_team_name: str, abbr_map: dict[str, str], defense_index: dict[str, TeamDefenseAllowed] | None) -> str | None:
    if defense_index is None:
        return None
    if sport_key in ("nfl", "nba", "nhl"):
        return abbr_map.get(opponent_team_id)
    if sport_key == "cfb":
        entry = fuzzy_lookup_cfb_defense(defense_index, opponent_team_name)
        return entry.abbr if entry else None
    if sport_key == "soccer_epl":
        entry = fuzzy_lookup_understat_defense(defense_index, opponent_team_name)
        return entry.abbr if entry else None
    return None


def _rare_candidate_for_player(
    sport_key: str,
    team_id: str,
    player: "_RosterPlayer",
    roster: list["_RosterPlayer"],
    league_rate_cache: dict[tuple[str, str], float],
    minutes_stat_name: str | None,
    prop_rows: list,
    defense_index: dict[str, TeamDefenseAllowed] | None,
    opponent_abbr: str | None,
) -> GenericPropCandidate | None:
    """One rare-market candidate per player, or None for a sport with no
    real rare market wired (Golf/Tennis are out of scope entirely; MLB's
    home-runs stays in prop_candidates.py, the existing reference). NFL/
    CFB's anytime-td and NBA's triple-double pass position_group=None —
    a combined-stat market has no single clean position-group bucket to
    check a defense_index against, an honest "no X signal" rather than a
    guessed one. NHL goals and soccer's anytime-goalscorer DO get a real
    X signal, matching their own regular-dimension counterparts exactly
    (NHL: the player's own roster position; soccer: "attacking", the same
    bucket build_understat_team_defense_index's single real signal maps
    to for every genuinely attacking-output dimension)."""
    if sport_key in ("nfl", "cfb"):
        dimension = NFL_RARE_DIMENSION if sport_key == "nfl" else CFB_RARE_DIMENSION
        line = NFL_RARE_LINE if sport_key == "nfl" else CFB_RARE_LINE
        cache_key = (team_id, dimension)
        if cache_key not in league_rate_cache:
            sample = {p.athlete_id: p.games for p in roster}
            league_rate_cache[cache_key] = compute_derived_league_rate(sample, anytime_td_condition, minutes_stat_name=minutes_stat_name)
        return build_derived_rare_candidate(
            player.games, dimension, line, anytime_td_condition, player.athlete_id,
            league_rate_cache[cache_key], prop_rows, config.USER_SPORTSBOOK,
        )
    if sport_key == "nba":
        cache_key = (team_id, NBA_RARE_DIMENSION)
        if cache_key not in league_rate_cache:
            sample = {p.athlete_id: p.games for p in roster}
            league_rate_cache[cache_key] = compute_derived_league_rate(sample, triple_double_condition, minutes_stat_name=minutes_stat_name)
        return build_derived_rare_candidate(
            player.games, NBA_RARE_DIMENSION, NBA_RARE_LINE, triple_double_condition, player.athlete_id,
            league_rate_cache[cache_key], prop_rows, config.USER_SPORTSBOOK,
        )
    if sport_key == "nhl":
        cache_key = (team_id, NHL_RARE.dimension)
        if cache_key not in league_rate_cache:
            sample = {p.athlete_id: p.games for p in roster}
            league_rate_cache[cache_key] = compute_league_rate(sample, NHL_RARE.espn_stat_name, NHL_RARE.line, minutes_stat_name=minutes_stat_name)
        position_group = _nhl_position_group(player.position_abbr or "")
        return build_rare_candidate(
            player.games, NHL_RARE, player.athlete_id, league_rate_cache[cache_key], prop_rows, config.USER_SPORTSBOOK,
            defense_index=defense_index, opponent_abbr=opponent_abbr, position_group=position_group,
        )
    if sport_key in ("soccer_epl", "soccer_mls"):
        cache_key = (team_id, SOCCER_RARE.dimension)
        if cache_key not in league_rate_cache:
            sample = {p.athlete_id: p.games for p in roster}
            league_rate_cache[cache_key] = compute_league_rate(sample, SOCCER_RARE.espn_stat_name, SOCCER_RARE.line, minutes_stat_name=minutes_stat_name)
        return build_rare_candidate(
            player.games, SOCCER_RARE, player.athlete_id, league_rate_cache[cache_key], prop_rows, config.USER_SPORTSBOOK,
            defense_index=defense_index, opponent_abbr=opponent_abbr, position_group="attacking",
        )
    return None


async def run_sport(sport_key: str, client: httpx.AsyncClient, date: str | None = None) -> dict:
    """One real production pass for one sport, today's real scheduled
    games only. Returns a summary dict — candidates_logged==0 for a
    sport with no player_game_history rows yet is a clean, expected
    no-op (Phase 0 hasn't caught up for that sport), never an error."""
    app_sport = _APP_SPORT_BY_KEY[sport_key]
    sport_config = gte.SPORT_CONFIGS[sport_key]
    date = date or datetime.now(timezone.utc).strftime("%Y%m%d")
    season = gte._season_for_date(f"{date[:4]}-{date[4:6]}-{date[6:8]}", sport_config)
    dimensions = _DIMENSIONS_BY_SPORT_KEY[sport_key]
    minutes_stat_name = _MINUTES_STAT_NAME[sport_key]

    games = await fetch_scheduled_games(client, sport_config, date)
    if not games:
        return {"sport": sport_key, "games": 0, "candidates_logged": 0}

    defense_index, abbr_map = await _x_signal_for_sport(sport_key, season, client)
    trust_tiers = await trust_tier_map(app_sport)

    roster_cache: dict[str, list[_RosterPlayer]] = {}

    async def roster_for(team_id: str) -> list[_RosterPlayer]:
        key = str(team_id)
        if key not in roster_cache:
            roster_cache[key] = await _load_roster_with_history(sport_key, key, season, sport_config.espn_sport, sport_config.espn_league, client)
        return roster_cache[key]

    league_rate_cache: dict[tuple[str, str], float] = {}

    def league_rate_for(team_id: str, cfg: DimensionConfig, roster: list[_RosterPlayer]) -> float:
        cache_key = (str(team_id), cfg.dimension)
        if cache_key not in league_rate_cache:
            sample = {p.athlete_id: p.games for p in roster}
            league_rate_cache[cache_key] = compute_league_rate(sample, cfg.espn_stat_name, cfg.line, minutes_stat_name=minutes_stat_name)
        return league_rate_cache[cache_key]

    logged = 0
    for g in games:
        # Real live prop_odds rows for this game — fetched once per game,
        # not per player/dimension, and passed into every build_candidate
        # call so live_edge.real_line_for can resolve each subject's real
        # per-player line before falling back to config.line (see
        # DimensionConfig.line's own docstring for why skipping this and
        # passing prop_rows=None would silently zero out the live edge for
        # every real candidate).
        prop_rows = await db.read_prop_odds_for_game(g.game_id)

        for subject_team_id, opponent_team_id, opponent_team_name in (
            (g.home_team_id, g.away_team_id, g.away_team_name),
            (g.away_team_id, g.home_team_id, g.home_team_name),
        ):
            roster = await roster_for(subject_team_id)
            opponent_abbr = _opponent_abbr_for(sport_key, str(opponent_team_id), opponent_team_name, abbr_map, defense_index)

            entries: list[db.SurfacedEntry] = []
            for player in roster:
                for cfg in dimensions:
                    league_rate = league_rate_for(subject_team_id, cfg, roster)
                    position_group = _position_group_for(sport_key, cfg, player.position_abbr)
                    candidate = build_candidate(
                        player.games,
                        cfg,
                        league_rate,
                        player.athlete_id,
                        prop_rows=prop_rows,
                        user_sportsbook=config.USER_SPORTSBOOK,
                        defense_index=defense_index if position_group is not None else None,
                        opponent_abbr=opponent_abbr,
                        position_group=position_group,
                    )
                    entry = _candidate_to_entry(app_sport, player.athlete_id, player.name, g.game_id, candidate, trust_tiers)
                    if entry is not None:
                        entries.append(entry)

                # Phase 5 — one rare-market pass per player, same roster/
                # history/X-signal data already loaded for the regular
                # dimensions above, no second fetch.
                rare_candidate = _rare_candidate_for_player(
                    sport_key, str(subject_team_id), player, roster, league_rate_cache, minutes_stat_name, prop_rows, defense_index, opponent_abbr,
                )
                if rare_candidate is not None:
                    rare_entry = _candidate_to_entry(app_sport, player.athlete_id, player.name, g.game_id, rare_candidate, trust_tiers)
                    if rare_entry is not None:
                        entries.append(rare_entry)
            if entries:
                await db.log_surfaced(entries)
                logged += len(entries)

    return {"sport": sport_key, "games": len(games), "candidates_logged": logged}


async def run_all_sports(client: httpx.AsyncClient) -> list[dict]:
    return [await run_sport(sport_key, client) for sport_key in _DIMENSIONS_BY_SPORT_KEY]
