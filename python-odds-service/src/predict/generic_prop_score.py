"""Ties predict/generic_player_gamelog.py's real per-player data into a
real Prop Score (predict/prop_score.py) for sports beyond MLB — Phase 3
of docs/all-sports-prop-score-gameplan-2026-08-27.md, built on the
already-shipped Edge % redesign
(docs/edge-redesign-and-prop-score-gameplan-2026-08-27.md), not the
retired model-vs-one-book design.

Matchup-favorability (X) signal: wired for NBA/NHL only (2026-08-27),
via predict/generic_matchup_defense.py's real opponent-defense-allowed
leaderboards — ported from the previously-uncommitted teamDefenseAllowed.ts
groundwork and re-verified live in Python. CFB/NFL/Soccer still pass
matchup_favorable=None (X contributes 0, same "absent, not fabricated"
behavior as before) — each needs its own separate data-source
integration, tracked in docs/model-build-backlog-2026-08-27.md rather
than rushed here.
"""
from dataclasses import dataclass

from entity_resolution import candidate_dimension_to_market_key
from predict.edge_model import ModelProbabilityInput, compute_model_probability
from predict.generic_matchup_defense import TeamDefenseAllowed, matchup_favorable
from predict.generic_player_gamelog import PlayerGameStat
from predict.good_bets import candidate_good_bet_signals
from predict.live_edge import CandidateEdgeInfo, real_line_for, resolve_candidate_edge
from predict.prop_score import PropScore, compute_prop_score
from predict.windowed_stat import HistoryEntry, WindowedStatOk, fixed_window


@dataclass
class DimensionConfig:
    dimension: str  # matches prop_score/good_bets/edge_model's generic 'dimension' concept; must equal a real canonical market key (entity_resolution.CANONICAL_MARKET_KEYS) or resolve_candidate_edge can never find a live price for it
    espn_stat_name: str  # ESPN gamelog's own stat field name, e.g. 'points'
    line: float
    """Fallback default only — used when no real live price exists for
    this subject (no game today, off-season/historical-only testing).
    NOT a per-dimension constant the way MLB's StatMarketDef.line is:
    MLB's own props (total bases, home runs, etc.) are genuinely
    standardized at the same fixed threshold across nearly every real
    batter, but generic_prop_score.py's own counting-stat dimensions
    (NBA points, NFL yards, NHL points, soccer shots) are priced
    per-player by real sportsbooks — there is no single number that's
    "the" line for a whole league. build_candidate resolves the REAL
    live line per subject via live_edge.real_line_for() first and only
    falls back to this value when that comes back empty; using a fixed
    guess here as the primary line would make resolve_candidate_edge's
    exact-match lookup silently find no price for nearly every real
    player (E permanently None), a real bug found live while designing
    this — see real_line_for's own docstring for the full explanation."""


def history_entries(games: list[PlayerGameStat], stat_name: str, line: float) -> list[HistoryEntry]:
    """Ascending (games are already sorted oldest-first by
    fetch_player_gamelog) — required for fixed_window's own "last N
    games" and current_streak's "most recent" semantics to mean what
    they say."""
    return [
        HistoryEntry(category="over" if g.stats[stat_name] > line else "under", opponent_id=g.opponent_id, is_home=g.is_home)
        for g in games
        if stat_name in g.stats
    ]


# Real bug found live while validating this against Jayson Tatum's own
# real gamelog: an unfiltered full-roster league rate for 'points > 17.5'
# came out to 14.6% (dragged down by low-minute bench players who rarely
# clear a starter-level threshold), which then pulled his own real,
# strong 81% season rate down to a 53% model probability — a real
# superstar reading as a coinflip. A league rate for a stat threshold
# should be conditioned on players who'd plausibly have that prop offered
# at all (rotation players), not literally every name on a roster.
# 'minutes' is a real field ESPN's gamelog already returns for every
# sport checked so far; this is a real, if still rough, fix — the right
# per-sport minutes floor is itself a real design question (this default
# is basketball-shaped; other sports' own "meaningfully used" cutoff
# needs its own real thought, not assumed to be the same number).
MIN_MINUTES_FOR_LEAGUE_RATE = 15.0


def compute_league_rate(
    sample_games_by_player: dict[str, list[PlayerGameStat]],
    stat_name: str,
    line: float,
    min_minutes: float = MIN_MINUTES_FOR_LEAGUE_RATE,
    minutes_stat_name: str | None = "minutes",
) -> float:
    """Real, computed base rate from a real (if limited-sample) group of
    players' real games — not a guessed constant. Restricted to games
    where the player logged at least `min_minutes` of `minutes_stat_name`
    (see MIN_MINUTES_FOR_LEAGUE_RATE's own docstring for why — real bug
    found live, not a preemptive guess). `minutes_stat_name` defaults to
    "minutes" (NBA's real player_game_history key, confirmed live) — NOT
    a safe default for every sport: NHL's real key is "toiMinutes" (a
    second real bug found live 2026-08-27, verifying Phase 2's dimension
    configs against real rows — the plain "minutes" default would have
    silently zeroed out every NHL game's eligibility), and football
    (NFL/CFB) has no per-player time-on-field field in ESPN's boxscore at
    all — pass minutes_stat_name=None there, which skips the floor
    entirely (every row present in a stat category is already a real
    participant ESPN itself filtered to, unlike NBA's full-roster bench
    problem this floor exists for). Disclosed limitation: whatever sample
    the caller fetched (e.g. one real team's roster), not the full
    league; a real, honest starting point, refined with a broader sample
    later, same "disclosed guess now, fit later" ethic as every other
    constant built tonight."""
    hits = total = 0
    for games in sample_games_by_player.values():
        for g in games:
            if stat_name not in g.stats:
                continue
            if minutes_stat_name is not None and g.stats.get(minutes_stat_name, 0.0) < min_minutes:
                continue
            total += 1
            if g.stats[stat_name] > line:
                hits += 1
    return hits / total if total else 0.5


@dataclass
class GenericPropCandidate:
    dimension: str
    line: float
    model_prob: float | None
    sample_size: int
    league_rate: float
    score: PropScore | None
    edge_info: CandidateEdgeInfo | None


def build_candidate(
    games: list[PlayerGameStat],
    config: DimensionConfig,
    league_rate: float,
    subject_id: str,
    prop_rows: list | None,
    user_sportsbook: str,
    defense_index: dict[str, TeamDefenseAllowed] | None = None,
    opponent_abbr: str | None = None,
    position_group: str | None = None,
) -> GenericPropCandidate:
    """Pure — no I/O. `prop_rows` is the real live prop_odds rows for
    this candidate's game (already fetched by the caller), or None/empty
    when there's no live game to price against (e.g. off-season
    historical-only testing) — resolve_candidate_edge already handles an
    empty row list by returning no edge, same as MLB's own path.

    `defense_index`/`opponent_abbr`/`position_group` are the X signal's
    real inputs (NBA/NHL only, see module docstring) — the caller passes
    a pre-built generic_matchup_defense leaderboard plus this subject's
    own position group and this game's real opponent. Any left as None
    (a sport without a defense_index yet, or a subject with no resolvable
    position) falls back to matchup_favorable=None, X contributing 0 —
    the same behavior every sport already had before this was wired.

    Line resolution: the REAL live line for this subject (from
    `prop_rows`, via live_edge.real_line_for) is used whenever one
    exists — required for resolve_candidate_edge's exact-match price
    lookup to ever find anything for a per-player-priced stat, see
    DimensionConfig.line's own docstring. `config.line` is the fallback
    only for a subject with no live price at all."""
    market_key = candidate_dimension_to_market_key(config.dimension)
    real_line = real_line_for(prop_rows or [], subject_id, market_key) if market_key else None
    effective_line = real_line if real_line is not None else config.line

    history = history_entries(games, config.espn_stat_name, effective_line)
    total_count = len(history)
    if total_count == 0:
        return GenericPropCandidate(dimension=config.dimension, line=effective_line, model_prob=None, sample_size=0, league_rate=league_rate, score=None, edge_info=None)

    over_count = sum(1 for h in history if h.category == "over")
    l10 = fixed_window(history, "over", 10)
    recent_over = l10.hits if isinstance(l10, WindowedStatOk) else 0
    recent_total = l10.total if isinstance(l10, WindowedStatOk) else 0

    favorable = matchup_favorable(defense_index, opponent_abbr, position_group) if defense_index is not None else None

    result = compute_model_probability(
        ModelProbabilityInput(
            dimension=config.dimension,
            league_rate=league_rate,
            over_count=over_count,
            total_count=total_count,
            matchup_favorable=favorable,
            recent_over_count=recent_over,
            recent_total_count=recent_total,
        )
    )

    edge_info = resolve_candidate_edge(subject_id, config.dimension, "over", effective_line, result.prob, prop_rows or [], user_sportsbook)
    good_bet_signals = candidate_good_bet_signals(history, "over", None, None)
    score = compute_prop_score(config.dimension, result.prob, league_rate, total_count, favorable, good_bet_signals, edge_info)

    return GenericPropCandidate(dimension=config.dimension, line=effective_line, model_prob=result.prob, sample_size=total_count, league_rate=league_rate, score=score, edge_info=edge_info)
