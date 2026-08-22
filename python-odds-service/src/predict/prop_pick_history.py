"""Direct port of lib/odds/props/pickHistoryLog.ts's player-prop path —
not a reimplementation. Converts predict.prop_candidates.CandidateResult
into db.SurfacedEntry rows and writes them via db.log_surfaced (Track A2).

`candidateToSurfacedEntry`'s team-candidate branch (isPlayerCandidate)
isn't ported — this module's caller (predict.prop_candidates) never
builds team-total-runs candidates in the first place (that market's TS
counterpart, teamStatMarketCandidates, is a display-only Scan Table
feature, not part of the Beta-Binomial prediction pipeline this port
covers), so there is nothing to filter out here.
"""
import config
import db
from entity_resolution import candidate_dimension_to_market_key
from predict.good_bets import candidate_good_bet_signals
from predict.live_edge import resolve_candidate_edge
from predict.market_trust import trust_tier_from_live_bss
from predict.prop_candidates import CandidateResult
from predict.prop_score import compute_prop_score


async def trust_tier_map(sport: str) -> dict[str, str]:
    """Prop Score v1's per-dimension trust tier, computed once per
    snapshot (not once per candidate) from live_market_skill's live-only
    Brier Skill Score."""
    out: dict[str, str] = {}
    for m in await db.live_market_skill(sport):
        out[m.dimension] = trust_tier_from_live_bss(m.bss, m.n)
    return out


def candidate_to_surfaced_entry(
    sport: str,
    candidate: CandidateResult,
    prop_rows: list[db.PropOddsRow],
    trust_tiers: dict[str, str],
) -> db.SurfacedEntry:
    trust_tier = trust_tiers.get(candidate.dimension, "building")

    prop_score = None
    score_grade = None
    if trust_tier != "excluded":
        edge_info = resolve_candidate_edge(
            candidate.subject_id,
            candidate.dimension,
            candidate.category,
            candidate.line,
            candidate.model_prob,
            prop_rows,
            config.USER_SPORTSBOOK,
        )
        good_bet_signals = candidate_good_bet_signals(candidate.history, candidate.category, candidate.opponent_team_id, candidate.matchup_favorable)
        score = compute_prop_score(
            candidate.dimension,
            candidate.model_prob,
            candidate.league_rate,
            candidate.sample_size,
            candidate.matchup_favorable,
            good_bet_signals,
            edge_info,
        )
        if score:
            prop_score = score.score
            score_grade = score.grade
    else:
        edge_info = None

    return db.SurfacedEntry(
        sport=sport,
        subject_id=candidate.subject_id,
        subject_name=candidate.subject_name,
        dimension=candidate.dimension,
        category=candidate.category,
        market_key=candidate_dimension_to_market_key(candidate.dimension),
        line=candidate.line,
        game_id=candidate.game_id,
        sample_size=candidate.sample_size,
        distance=None,
        event_context=None,
        model_prob=candidate.model_prob,
        model_version=candidate.model_version,
        market_prob=edge_info.market_prob if edge_info else None,
        edge=edge_info.edge if edge_info else None,
        price_source=edge_info.price_source if edge_info else None,
        bookmaker=edge_info.bookmaker if edge_info else None,
        price_captured_at=edge_info.price_captured_at if edge_info else None,
        prop_score=prop_score,
        score_grade=score_grade,
        trust_tier=trust_tier,
    )


async def log_snapshot_candidates(sport: str, candidates: list[CandidateResult]) -> None:
    """Logs every player-level candidate in a snapshot. Safe to call on
    every refresh — log_surfaced's INSERT ... ON CONFLICT DO NOTHING
    dedupes, first-surfaced-wins."""
    if not candidates:
        return
    game_ids = {c.game_id for c in candidates}
    prop_rows_by_game: dict[str, list[db.PropOddsRow]] = {}
    for game_id in game_ids:
        prop_rows_by_game[game_id] = await db.read_prop_odds_for_game(game_id)

    trust_tiers = await trust_tier_map(sport)
    entries = [candidate_to_surfaced_entry(sport, c, prop_rows_by_game.get(c.game_id, []), trust_tiers) for c in candidates]
    await db.log_surfaced(entries)
