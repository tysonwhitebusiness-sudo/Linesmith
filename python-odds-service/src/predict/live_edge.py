"""Direct port of lib/odds/props/liveEdge.ts — not a reimplementation.
Pure functions, no I/O — the caller (predict/prop_candidates.py) reads
prop_odds once per game via db.read_prop_odds_for_game and passes the
rows in here per candidate, same shape as pickHistoryLog.ts's
logSnapshotCandidates fetching once per gameId in TS.
"""
from dataclasses import dataclass

from db import PropOddsRow
from entity_resolution import candidate_category_to_side, candidate_dimension_to_market_key
from predict.odds_math import american_to_decimal, devig_two_way

# A quote older than this is treated as having no genuine live price rather
# than an unreliable one.
_TOO_STALE_SECONDS = 600


def rows_for(rows: list[PropOddsRow], subject_id: str, market_key: str, line: float | None) -> list[PropOddsRow]:
    """All prices for one subject+market+line, across every provider/book fetched so far."""
    return [r for r in rows if r.subject_id == subject_id and r.market_key == market_key and r.line == line]


def best_price(rows: list[PropOddsRow], side: str) -> PropOddsRow | None:
    """Best (highest payout) American price for a side."""
    sided = [r for r in rows if r.side == side]
    if not sided:
        return None
    best = sided[0]
    for r in sided[1:]:
        if r.american_odds > best.american_odds:
            best = r
    return best


def user_book_price(rows: list[PropOddsRow], side: str, user_sportsbook: str) -> PropOddsRow | None:
    for r in rows:
        if r.side == side and r.bookmaker == user_sportsbook:
            return r
    return None


@dataclass
class CandidateEdgeInfo:
    price: int | None
    price_source: str | None
    price_captured_at: str | None
    bookmaker: str | None
    book_count: int
    # Raw, vig included — normalising needs both sides, and only one is priced.
    implied_raw: float | None
    edge: float | None
    model_prob: float | None
    market_prob: float | None


def resolve_candidate_edge(
    subject_id: str,
    dimension: str,
    category: str,
    line: float | None,
    raw_model_prob: float | None,
    prop_rows: list[PropOddsRow],
    user_sportsbook: str,
) -> CandidateEdgeInfo:
    """The price/edge resolution: model probability (already computed,
    per candidate) against a genuinely de-vigged market price — both sides
    from the same book, not mixed, and not badly stale. No genuine
    two-sided price, or a >10-minute-old quote, yields no edge rather than
    an unreliable one."""
    side = candidate_category_to_side(category) or "over"
    market_key = candidate_dimension_to_market_key(dimension)
    matched = rows_for(prop_rows, subject_id, market_key, line) if market_key else []
    mine = user_book_price(matched, side, user_sportsbook)
    chosen = mine or best_price(matched, side)
    book_count = len({r.bookmaker for r in matched})

    price = chosen.american_odds if chosen else None
    price_source = chosen.provider_id if chosen else None
    price_captured_at = chosen.fetched_at if chosen else None
    bookmaker = chosen.bookmaker if chosen else None
    decimal = american_to_decimal(price) if price is not None else None

    other_side = "under" if side == "over" else "over"
    counterpart = None
    if chosen:
        for r in matched:
            if r.side == other_side and r.bookmaker == chosen.bookmaker and r.provider_id == chosen.provider_id:
                counterpart = r
                break

    def too_stale(r: PropOddsRow) -> bool:
        return r.delay_seconds is not None and r.delay_seconds > _TOO_STALE_SECONDS

    edge: float | None = None
    model_prob: float | None = None
    market_prob: float | None = None
    if chosen and counterpart and raw_model_prob is not None:
        over_row = chosen if side == "over" else counterpart
        under_row = counterpart if side == "over" else chosen
        if not too_stale(over_row) and not too_stale(under_row):
            devigged = devig_two_way(american_to_decimal(over_row.american_odds), american_to_decimal(under_row.american_odds))
            if devigged:
                model_prob = raw_model_prob
                market_prob = devigged[0]
                edge = raw_model_prob - devigged[0]

    return CandidateEdgeInfo(
        price=price,
        price_source=price_source,
        price_captured_at=price_captured_at,
        bookmaker=bookmaker,
        book_count=book_count,
        implied_raw=(1 / decimal) if decimal is not None else None,
        edge=edge,
        model_prob=model_prob,
        market_prob=market_prob,
    )
