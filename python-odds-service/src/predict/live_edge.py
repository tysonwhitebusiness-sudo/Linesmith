"""Originally a direct port of lib/odds/props/liveEdge.ts; the edge
computation itself was redesigned 2026-08-27 (see
docs/edge-redesign-and-prop-score-gameplan-2026-08-27.md), so this file
has diverged from that TS source on purpose — the TS side has not been
migrated (a real, separate decision, not an oversight).

Pure functions, no I/O — the caller (predict/prop_candidates.py) reads
prop_odds once per game via db.read_prop_odds_for_game and passes the
rows in here per candidate, same shape as pickHistoryLog.ts's
logSnapshotCandidates fetching once per gameId in TS.

Real audit before this redesign (2026-08-27): the original edge was
`our_own_model_probability - one_retail_book's_own_devigged_price` — our
model versus whatever single book happened to be chosen (the user's own
preferred book, or the best-paying one). That's "does our model disagree
with one book," not "does a sharp book disagree with a soft book" — and
it predates this app having real multi-book prop coverage (22 distinct
bookmakers confirmed live in prop_odds the night this was rewritten).
User's own research: the standard, more defensible approach compares a
genuinely sharp reference against the book you'd actually bet at, to
find real market inefficiency, rather than leaning on an internal
model's own (disclosed-guess-calibrated) belief.

New design, three tiers:
  Tier 1 — a named sharp book (SHARP_REFERENCE_PRIORITY below), first
    one with a genuine two-sided, non-stale price for this exact
    candidate wins.
  Tier 2 — no Tier-1 book available: the median devigged probability
    across every book that DOES have a genuine two-sided price for this
    candidate. Median, not mean, so one outlier book can't skew it — the
    same class of problem odds_math.is_plausible_decimal_odds guards
    against elsewhere in this codebase.
  Tier 3 — neither exists: edge is None, honest absence (Prop Score v1
    already redistributes E's weight over M/P/X in this case, unchanged
    by this redesign).

Real, checked coverage for MLB at the exact candidate level (not just
per-game): only 1,221 of 36,955 real (game, player, market, line)
combinations have a genuine Tier-1 price — 3.3%. Tier 2 exists
specifically to give a real, still-meaningfully-better-than-one-book
signal for the other 96.7%, rather than pretending broader Tier-1
coverage exists or silently reverting to the retired model-vs-one-book
design.
"""
import statistics
from dataclasses import dataclass

from db import PropOddsRow
from entity_resolution import candidate_category_to_side, candidate_dimension_to_market_key
from predict.odds_math import american_to_decimal, devig_two_way, is_plausible_decimal_odds

# A quote older than this is treated as having no genuine live price rather
# than an unreliable one.
_TOO_STALE_SECONDS = 600

# Priority order for Tier 1 — first one with a genuine two-sided price for
# the exact candidate wins. Pinnacle first: the most established,
# most-cited-in-sharp-betting-research reference. Circa second: the other
# real, widely-recognized sharp book (Las Vegas-based, known for taking
# large sharp action and moving fast) — added 2026-08-27 per explicit
# user request; checked live at the time and had zero rows in prop_odds
# or game_odds_book_lines, so it contributes no real coverage today, but
# is recognized the moment any provider surfaces it. Novig/Kalshi after:
# both structurally low/no-vig by design (a peer-to-peer exchange and a
# regulated prediction market, respectively, not just reputation), and
# both have denser real MLB coverage than Pinnacle (56/134 games vs
# 50/134, confirmed live) — real, legitimate sharp-adjacent references,
# not a weak fallback. This order is a reasoned starting default, not fit
# against real outcomes yet — same disclosed-guess status as every other
# hand-set constant in this codebase.
SHARP_REFERENCE_PRIORITY = ["pinnacle", "circa", "novig", "kalshi"]


def rows_for(rows: list[PropOddsRow], subject_id: str, market_key: str, line: float | None) -> list[PropOddsRow]:
    """All prices for one subject+market+line, across every provider/book fetched so far."""
    return [r for r in rows if r.subject_id == subject_id and r.market_key == market_key and r.line == line]


def best_price(rows: list[PropOddsRow], side: str) -> PropOddsRow | None:
    """Best (highest payout) American price for a side — among plausible
    rows only. Real bug found live 2026-08-27 while validating the edge
    redesign above: with no guard here, a garbage quote (a real MLB
    candidate's Kalshi row at +9900 American, ~1% implied) won this
    selection over every real book's real price purely because it's a
    bigger number — the same bug class already fixed twice tonight
    elsewhere (lib/odds/display.ts's bestMoneylineFromBooks,
    predict/mlb_game_lines.py's game_lines_from_book_lines), now fixed a
    third time here. Same shared constant
    (odds_math.MAX_PLAUSIBLE_DECIMAL_ODDS), all three languages/call
    sites now consistent."""
    sided = [r for r in rows if r.side == side and is_plausible_decimal_odds(american_to_decimal(r.american_odds))]
    if not sided:
        return None
    best = sided[0]
    for r in sided[1:]:
        if r.american_odds > best.american_odds:
            best = r
    return best


def user_book_price(rows: list[PropOddsRow], side: str, user_sportsbook: str) -> PropOddsRow | None:
    """Same plausibility guard as best_price above, for the same reason —
    a garbage quote at the user's own preferred book is just as likely to
    be a data error as one that would have won best_price's own
    selection, and skipping it here means resolve_candidate_edge falls
    through to best_price instead of using it as-is."""
    for r in rows:
        if r.side == side and r.bookmaker == user_sportsbook and is_plausible_decimal_odds(american_to_decimal(r.american_odds)):
            return r
    return None


def _too_stale(r: PropOddsRow) -> bool:
    return r.delay_seconds is not None and r.delay_seconds > _TOO_STALE_SECONDS


def _two_sided_devigged_for_row(matched: list[PropOddsRow], side: str, row: PropOddsRow) -> float | None:
    """Given one row (a specific bookmaker+provider's price for `side`),
    finds that SAME bookmaker+provider's opposite-side price (never mixed
    across providers even when the nominal bookmaker name matches — a
    provider can report a different price for the same real book) and
    returns the devigged probability for `side`. None if no genuine,
    non-stale two-sided pair exists from that exact source."""
    other_side = "under" if side == "over" else "over"
    counterpart = next((r for r in matched if r.side == other_side and r.bookmaker == row.bookmaker and r.provider_id == row.provider_id), None)
    if counterpart is None or _too_stale(row) or _too_stale(counterpart):
        return None
    over_row = row if side == "over" else counterpart
    under_row = counterpart if side == "over" else row
    devigged = devig_two_way(american_to_decimal(over_row.american_odds), american_to_decimal(under_row.american_odds))
    return devigged[0] if devigged else None


def _sharp_reference_prob(matched: list[PropOddsRow], side: str) -> tuple[float, str] | None:
    """Tier 1 — first book in SHARP_REFERENCE_PRIORITY with a genuine
    two-sided, non-stale price for this exact candidate wins."""
    for name in SHARP_REFERENCE_PRIORITY:
        row = next((r for r in matched if r.side == side and r.bookmaker == name), None)
        if row is None:
            continue
        prob = _two_sided_devigged_for_row(matched, side, row)
        if prob is not None:
            return prob, name
    return None


def _consensus_reference_prob(matched: list[PropOddsRow], side: str) -> tuple[float, str] | None:
    """Tier 2 — median devigged probability across every distinct
    (bookmaker, provider) pair with a genuine two-sided, non-stale price.
    Median, not mean, so one outlier book can't skew it — the same class
    of problem odds_math.is_plausible_decimal_odds guards against
    elsewhere in this codebase."""
    seen: set[tuple[str, str]] = set()
    probs: list[float] = []
    for row in matched:
        if row.side != side:
            continue
        key = (row.bookmaker, row.provider_id)
        if key in seen:
            continue
        seen.add(key)
        prob = _two_sided_devigged_for_row(matched, side, row)
        if prob is not None:
            probs.append(prob)
    if not probs:
        return None
    return statistics.median(probs), "consensus"


@dataclass
class CandidateEdgeInfo:
    price: int | None
    price_source: str | None
    price_captured_at: str | None
    bookmaker: str | None
    book_count: int
    # Raw, vig included — the price you'd actually get at the bettable
    # book, deliberately NOT devigged (see module docstring: the vig at
    # that book is part of the disadvantage this measures, and devigging
    # it away would erase it).
    implied_raw: float | None
    edge: float | None
    model_prob: float | None
    market_prob: float | None
    # 'pinnacle'/'circa'/'novig'/'kalshi' (Tier 1) or 'consensus' (Tier 2)
    # — which real reference actually produced market_prob/edge. None
    # when neither tier had anything for this candidate.
    edge_source: str | None


def resolve_candidate_edge(
    subject_id: str,
    dimension: str,
    category: str,
    line: float | None,
    raw_model_prob: float | None,
    prop_rows: list[PropOddsRow],
    user_sportsbook: str,
) -> CandidateEdgeInfo:
    """The price/edge resolution — real sharp-vs-soft market edge (see
    module docstring for the full redesign rationale, 2026-08-27), plus
    the real bettable price/book info this app surfaces regardless of
    whether an edge could be computed for this candidate.

    `raw_model_prob` is accepted (and still returned on the result, for
    display/debugging) purely for signature stability with existing
    callers — it no longer feeds the edge computation itself. M
    (predict/prop_score.py's own model-vs-league-rate component) is
    where the model's own belief already enters the score; folding it
    into E again under a different name would double-count it.
    """
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
    implied_raw = (1 / decimal) if decimal is not None else None

    edge: float | None = None
    market_prob: float | None = None
    edge_source: str | None = None
    if implied_raw is not None:
        reference = _sharp_reference_prob(matched, side) or _consensus_reference_prob(matched, side)
        if reference is not None:
            market_prob, edge_source = reference
            edge = market_prob - implied_raw

    return CandidateEdgeInfo(
        price=price,
        price_source=price_source,
        price_captured_at=price_captured_at,
        bookmaker=bookmaker,
        book_count=book_count,
        implied_raw=implied_raw,
        edge=edge,
        model_prob=raw_model_prob,
        market_prob=market_prob,
        edge_source=edge_source,
    )
