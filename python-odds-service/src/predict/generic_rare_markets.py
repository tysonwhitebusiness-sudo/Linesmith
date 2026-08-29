"""Phase 5 of docs/daily-picks-full-model-build-2026-08-27.md — real
rare-market (top-5 "exciting, low-probability") candidates for every
sport, extending prop_candidates.py's own RARE_EVENT_FLOOR admission-gate
pattern (MLB's home-runs, the real template — `{"base": 0.25,
"favorable_matchup": 0.2, "tough_matchup": 0.35}`, applied to a game's
RECENT (last 15) Over rate before a candidate is even generated, so a
rare market stays meaningfully rare instead of every player "passing"
just because the event is uncommon for everyone) to NFL/CFB
(anytime-td), Soccer (anytime-goalscorer), and NHL (goals — moved OUT of
generic_dimension_configs.NHL_DIMENSIONS so the same real bet never
surfaces in both the regular player-props tab and this one).

Two shapes, sharing one scoring core (`_build_rare_candidate`):
  - Single-field threshold (NHL goals, soccer anytime-goalscorer) — same
    shape as a normal DimensionConfig, just admission-gated.
  - Derived condition (NFL/CFB anytime-td, NBA triple-double) — a real,
    disclosed NEW path: history_entries()/build_candidate() only support
    a single g.stats[stat_name] > line threshold, but "did this player
    score any touchdown" or "did they record a triple-double" is a
    boolean condition across MULTIPLE fields at once.
    `derived_history_entries` produces the exact same HistoryEntry shape
    from an arbitrary condition callable, feeding the identical
    compute_model_probability/compute_prop_score pipeline unchanged.

Anytime-TD is rushing + receiving touchdowns only (real per-game fields
already in player_game_history's football rows) — not passing
touchdowns (a QB throwing a TD doesn't make them the "anytime touchdown
scorer" in the real sportsbook sense) and not defensive/return
touchdowns (no such field exists in player_game_history today, a real,
disclosed gap, not fabricated).
"""
from typing import Callable

from entity_resolution import candidate_dimension_to_market_key
from predict.edge_model import ModelProbabilityInput, compute_model_probability
from predict.generic_matchup_defense import TeamDefenseAllowed, matchup_favorable
from predict.generic_player_gamelog import PlayerGameStat
from predict.generic_prop_score import DimensionConfig, GenericPropCandidate, history_entries
from predict.good_bets import candidate_good_bet_signals
from predict.live_edge import real_line_for, resolve_candidate_edge
from predict.prop_score import compute_prop_score
from predict.windowed_stat import HistoryEntry, WindowedStatOk, fixed_window

# Exact same real values prop_candidates.py's own RARE_EVENT_FLOOR uses —
# one shared admission-gate bar across every sport's rare markets, not a
# per-sport reinvention.
RARE_EVENT_FLOOR = {"base": 0.25, "favorable_matchup": 0.2, "tough_matchup": 0.35}

# Same recent-form window prop_candidates.py's own HISTORY_WINDOW uses for
# this exact gate (a full-season rate would mask a real recent change in
# usage — the floor should read recent form, not a season-long average).
_ADMISSION_WINDOW = 15


def compute_derived_league_rate(
    sample_games_by_player: dict[str, list[PlayerGameStat]],
    condition: Callable[[dict], bool],
    min_minutes: float = 15.0,
    minutes_stat_name: str | None = "minutes",
) -> float | None:
    """Mirrors generic_prop_score.compute_league_rate exactly, for a
    derived condition instead of a single-field threshold — no `stat_name
    in g.stats` gate needed here since a derived condition always has a
    definitive answer via its own .get(..., 0.0) defaults (see
    derived_history_entries's own docstring)."""
    hits = total = 0
    for games in sample_games_by_player.values():
        for g in games:
            if minutes_stat_name is not None and g.stats.get(minutes_stat_name, 0.0) < min_minutes:
                continue
            total += 1
            if condition(g.stats):
                hits += 1
    # Task 4.12 (P3 M6) — same fix as compute_league_rate: None, not a
    # fabricated coin flip. See that function for the reasoning.
    if not total:
        return None
    return hits / total


def derived_history_entries(games: list[PlayerGameStat], condition: Callable[[dict], bool]) -> list[HistoryEntry]:
    """Missing fields default to 0 via the condition callable's own
    .get(..., 0.0) calls (see the condition functions below) — a player's
    box-score line simply not carrying a rushing/receiving category that
    game IS a real 0 for that category, not a "no data" case to exclude,
    so every real game this player appears in gets a definitive
    over/under entry."""
    return [HistoryEntry(category="over" if condition(g.stats) else "under", opponent_id=g.opponent_id, is_home=g.is_home) for g in games]


def anytime_td_condition(stats: dict) -> bool:
    return stats.get("rushing.rushingTouchdowns", 0.0) + stats.get("receiving.receivingTouchdowns", 0.0) > 0


def triple_double_condition(stats: dict) -> bool:
    return stats.get("points", 0.0) >= 10 and stats.get("rebounds", 0.0) >= 10 and stats.get("assists", 0.0) >= 10


def _build_rare_candidate(
    history: list[HistoryEntry],
    dimension: str,
    effective_line: float,
    subject_id: str,
    league_rate: float,
    prop_rows: list | None,
    user_sportsbook: str,
    defense_index: dict[str, TeamDefenseAllowed] | None,
    opponent_abbr: str | None,
    position_group: str | None,
) -> GenericPropCandidate:
    total_count = len(history)
    if total_count == 0:
        return GenericPropCandidate(dimension=dimension, line=effective_line, model_prob=None, sample_size=0, league_rate=league_rate, score=None, edge_info=None)

    favorable = matchup_favorable(defense_index, opponent_abbr, position_group) if defense_index is not None else None
    recent = history[-_ADMISSION_WINDOW:]
    if favorable is None:
        floor = RARE_EVENT_FLOOR["base"]
    else:
        floor = RARE_EVENT_FLOOR["favorable_matchup"] if favorable else RARE_EVENT_FLOOR["tough_matchup"]
    recent_over_rate = sum(1 for h in recent if h.category == "over") / len(recent) if recent else 0.0
    if recent_over_rate < floor:
        return GenericPropCandidate(dimension=dimension, line=effective_line, model_prob=None, sample_size=total_count, league_rate=league_rate, score=None, edge_info=None)

    over_count = sum(1 for h in history if h.category == "over")
    l10 = fixed_window(history, "over", 10)
    recent_over = l10.hits if isinstance(l10, WindowedStatOk) else 0
    recent_total = l10.total if isinstance(l10, WindowedStatOk) else 0

    result = compute_model_probability(
        ModelProbabilityInput(
            dimension=dimension,
            league_rate=league_rate,
            over_count=over_count,
            total_count=total_count,
            matchup_favorable=favorable,
            recent_over_count=recent_over,
            recent_total_count=recent_total,
        )
    )
    edge_info = resolve_candidate_edge(subject_id, dimension, "over", effective_line, result.prob, prop_rows or [], user_sportsbook)
    good_bet_signals = candidate_good_bet_signals(history, "over", None, None)
    score = compute_prop_score(dimension, result.prob, league_rate, total_count, favorable, good_bet_signals, edge_info)
    return GenericPropCandidate(dimension=dimension, line=effective_line, model_prob=result.prob, sample_size=total_count, league_rate=league_rate, score=score, edge_info=edge_info)


def build_rare_candidate(
    games: list[PlayerGameStat],
    cfg: DimensionConfig,
    subject_id: str,
    league_rate: float,
    prop_rows: list | None,
    user_sportsbook: str,
    defense_index: dict[str, TeamDefenseAllowed] | None = None,
    opponent_abbr: str | None = None,
    position_group: str | None = None,
) -> GenericPropCandidate:
    """Single-field rare market (NHL goals, soccer anytime-goalscorer) —
    same shape as generic_prop_score.build_candidate, admission-gated by
    RARE_EVENT_FLOOR before scoring."""
    market_key = candidate_dimension_to_market_key(cfg.dimension)
    real_line = real_line_for(prop_rows or [], subject_id, market_key) if market_key else None
    effective_line = real_line if real_line is not None else cfg.line
    history = history_entries(games, cfg.espn_stat_name, effective_line)
    return _build_rare_candidate(history, cfg.dimension, effective_line, subject_id, league_rate, prop_rows, user_sportsbook, defense_index, opponent_abbr, position_group)


def build_derived_rare_candidate(
    games: list[PlayerGameStat],
    dimension: str,
    default_line: float,
    condition: Callable[[dict], bool],
    subject_id: str,
    league_rate: float,
    prop_rows: list | None,
    user_sportsbook: str,
    defense_index: dict[str, TeamDefenseAllowed] | None = None,
    opponent_abbr: str | None = None,
    position_group: str | None = None,
) -> GenericPropCandidate:
    """Derived-condition rare market (NFL/CFB anytime-td, NBA
    triple-double) — `condition` is a real boolean function of one game's
    stats dict, not a single-field threshold."""
    market_key = candidate_dimension_to_market_key(dimension)
    real_line = real_line_for(prop_rows or [], subject_id, market_key) if market_key else None
    effective_line = real_line if real_line is not None else default_line
    history = derived_history_entries(games, condition)
    return _build_rare_candidate(history, dimension, effective_line, subject_id, league_rate, prop_rows, user_sportsbook, defense_index, opponent_abbr, position_group)


# Real per-sport rare-market registry — one entry per sport that has one.
# MLB (home-runs) stays where it already lives (prop_candidates.py,
# out of scope — "MLB stays as reference"). Golf/Tennis have no rare
# market (out of scope for the whole daily-picks build).
NFL_RARE_DIMENSION = "anytime-td"
NFL_RARE_LINE = 0.5
CFB_RARE_DIMENSION = "anytime-td"
CFB_RARE_LINE = 0.5
NHL_RARE = DimensionConfig(dimension="goals", espn_stat_name="goals", line=0.5)
SOCCER_RARE = DimensionConfig(dimension="anytime-goalscorer", espn_stat_name="totalGoals", line=0.5)
NBA_RARE_DIMENSION = "triple-double"
NBA_RARE_LINE = 0.5
