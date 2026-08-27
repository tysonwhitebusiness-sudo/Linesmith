"""Ties predict/generic_player_gamelog.py's real per-player data into a
real Prop Score (predict/prop_score.py) for sports beyond MLB — Phase 3
of docs/all-sports-prop-score-gameplan-2026-08-27.md, built on the
already-shipped Edge % redesign
(docs/edge-redesign-and-prop-score-gameplan-2026-08-27.md), not the
retired model-vs-one-book design.

Real, disclosed scope for this first build: no matchup-favorability (X)
signal yet — the uncommitted teamDefenseAllowed.ts groundwork
(NBA/NHL/CFB) is TS, not Python, and wiring it is real, separate work,
not attempted here. matchup_favorable is always None, so X always
contributes 0 to the score — an honest simplification, not a silent gap.
"""
from dataclasses import dataclass

from predict.edge_model import ModelProbabilityInput, compute_model_probability
from predict.generic_player_gamelog import PlayerGameStat
from predict.good_bets import candidate_good_bet_signals
from predict.live_edge import CandidateEdgeInfo, resolve_candidate_edge
from predict.prop_score import PropScore, compute_prop_score
from predict.windowed_stat import HistoryEntry, WindowedStatOk, fixed_window


@dataclass
class DimensionConfig:
    dimension: str  # matches prop_score/good_bets/edge_model's generic 'dimension' concept
    espn_stat_name: str  # ESPN gamelog's own stat field name, e.g. 'points'
    line: float  # a real, reasoned fixed threshold — same convention as MLB's own StatMarketDef (predict/prop_candidates.py)


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


def compute_league_rate(sample_games_by_player: dict[str, list[PlayerGameStat]], stat_name: str, line: float, min_minutes: float = MIN_MINUTES_FOR_LEAGUE_RATE) -> float:
    """Real, computed base rate from a real (if limited-sample) group of
    players' real games — not a guessed constant. Restricted to games
    where the player logged at least `min_minutes` (see
    MIN_MINUTES_FOR_LEAGUE_RATE's own docstring for why — real bug found
    live, not a preemptive guess). Disclosed limitation: whatever sample
    the caller fetched (e.g. one real team's roster), not the full
    league; a real, honest starting point, refined with a broader sample
    later, same "disclosed guess now, fit later" ethic as every other
    constant built tonight."""
    hits = total = 0
    for games in sample_games_by_player.values():
        for g in games:
            if stat_name in g.stats and g.stats.get("minutes", 0.0) >= min_minutes:
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
) -> GenericPropCandidate:
    """Pure — no I/O. `prop_rows` is the real live prop_odds rows for
    this candidate's game (already fetched by the caller), or None/empty
    when there's no live game to price against (e.g. off-season
    historical-only testing) — resolve_candidate_edge already handles an
    empty row list by returning no edge, same as MLB's own path."""
    history = history_entries(games, config.espn_stat_name, config.line)
    total_count = len(history)
    if total_count == 0:
        return GenericPropCandidate(dimension=config.dimension, line=config.line, model_prob=None, sample_size=0, league_rate=league_rate, score=None, edge_info=None)

    over_count = sum(1 for h in history if h.category == "over")
    l10 = fixed_window(history, "over", 10)
    recent_over = l10.hits if isinstance(l10, WindowedStatOk) else 0
    recent_total = l10.total if isinstance(l10, WindowedStatOk) else 0

    result = compute_model_probability(
        ModelProbabilityInput(
            dimension=config.dimension,
            league_rate=league_rate,
            over_count=over_count,
            total_count=total_count,
            matchup_favorable=None,  # real, disclosed gap — see module docstring
            recent_over_count=recent_over,
            recent_total_count=recent_total,
        )
    )

    edge_info = resolve_candidate_edge(subject_id, config.dimension, "over", config.line, result.prob, prop_rows or [], user_sportsbook)
    good_bet_signals = candidate_good_bet_signals(history, "over", None, None)
    score = compute_prop_score(config.dimension, result.prob, league_rate, total_count, None, good_bet_signals, edge_info)

    return GenericPropCandidate(dimension=config.dimension, line=config.line, model_prob=result.prob, sample_size=total_count, league_rate=league_rate, score=score, edge_info=edge_info)
