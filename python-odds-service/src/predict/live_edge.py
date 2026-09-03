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
from datetime import datetime, timezone
from dataclasses import dataclass

from db import PropOddsRow
from entity_resolution import candidate_category_to_side, candidate_dimension_to_market_key
from predict.odds_math import american_to_decimal, devig_two_way, is_plausible_decimal_odds

# A quote older than this is treated as having no genuine live price rather
# than an unreliable one.
_TOO_STALE_SECONDS = 600
# Real row age (now - fetched_at), the quantity _too_stale was always supposed
# to measure. 30 minutes: long enough that the gameday-gated 20-minute generic
# sport jobs aren't marked stale by construction, short enough to catch the
# 17.5-hour-old prices the audit found being shown as live. See _too_stale.
_MAX_ROW_AGE_SECONDS = 30 * 60

# Task 4.1. The MARKET REFERENCE tolerates more age than a DISPLAYED price,
# and conflating the two is the dominant cause of market_prob's ~2.85%
# coverage — not either of the two causes the plan names.
#
# MEASURED 2026-08-29, and this is the whole argument:
#   5,877 same-book same-provider two-sided pairs exist in prop_odds.
#   Exactly 2 of them fall inside the 30-minute bound at any given instant.
# Not because the prices are bad, but because refreshTier1 rewrites ~238 rows
# per cycle against a 49,000-row table, so almost everything is always "old"
# relative to now(). The reference was being thrown away for a refresh-cadence
# reason that has nothing to do with whether the price is informative.
#
# The two bounds answer different questions:
#   _MAX_ROW_AGE_SECONDS  — "could a user bet this right now?"  Stays 30 min.
#                            A stale price shown as live is what P3 C4 was
#                            about, and that bound is not relaxed here.
#   _MAX_REFERENCE_AGE_SECONDS — "did the market believe this today?"  A
#                            four-hour-old de-vigged consensus is a perfectly
#                            good estimate of a market's opinion on a game that
#                            has not started; it is simply not a price you can
#                            still take.
#
# 6 hours, not unbounded, and still well inside a single slate — the 17.5-hour
# prices the audit found remain rejected, which was the failure the original
# bound existed to catch.
_MAX_REFERENCE_AGE_SECONDS = 6 * 60 * 60

# The two sides of a de-vig must be contemporaneous WITH EACH OTHER, or the
# overround is an artefact of the gap rather than the book's real margin. This
# is the bound that actually protects the arithmetic; age-since-now does not.
_MAX_PAIR_SKEW_SECONDS = 30 * 60

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


def real_line_for(rows: list[PropOddsRow], subject_id: str, market_key: str) -> float | None:
    """The real line the market is actually offering for this subject+market
    right now — needed because, unlike MLB's own props (genuinely
    standardized fixed thresholds across nearly every batter: total bases
    O/U 1.5, home runs O/U 0.5, ported as-is in prop_candidates.py's
    StatMarketDef), the counting-stat props generic_prop_score.py serves
    for NBA/NFL/NHL/Soccer (points, yards, etc.) are priced per player —
    there is no single universal number a fixed DimensionConfig.line could
    correctly stand in for. rows_for()'s exact-match line lookup would
    silently match nothing for almost every real player if called with an
    arbitrary fixed guess instead of the real posted line — E would read
    as "no live price" for nearly the whole slate, not a loud error.

    Mode (most-common line across books): most books cluster within a
    point of each other for the same real player, and a handful of
    outlier books shouldn't decide which number "is" the market's. Ties
    break toward the lower value — a bettor-conservative default, not
    load-bearing since ties are rare with real multi-book coverage."""
    candidates = [r.line for r in rows if r.subject_id == subject_id and r.market_key == market_key and r.line is not None]
    if not candidates:
        return None
    counts: dict[float, int] = {}
    for c in candidates:
        counts[c] = counts.get(c, 0) + 1
    best_count = max(counts.values())
    return min(line for line, count in counts.items() if count == best_count)


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


def _row_age_seconds(r: PropOddsRow, now: datetime | None = None) -> float | None:
    """Seconds since this row was fetched, or None if unparseable."""
    if not r.fetched_at:
        return None
    raw = r.fetched_at
    try:
        parsed = raw if isinstance(raw, datetime) else datetime.fromisoformat(
            str(raw).replace("Z", "+00:00")
        )
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return ((now or datetime.now(timezone.utc)) - parsed).total_seconds()


def _too_stale_for_reference(r: PropOddsRow, now: datetime | None = None) -> bool:
    """Staleness bound for a MARKET REFERENCE, not for a bettable price.

    Task 4.1. See _MAX_REFERENCE_AGE_SECONDS above for the measurement that
    forced the split. The provider's own advertised feed delay is still
    disqualifying at the same threshold — a provider that admits to a long lag
    is untrustworthy for either purpose.
    """
    if r.delay_seconds is not None and r.delay_seconds > _TOO_STALE_SECONDS:
        return True
    age = _row_age_seconds(r, now)
    return age is not None and age > _MAX_REFERENCE_AGE_SECONDS


def _too_stale(r: PropOddsRow, now: datetime | None = None) -> bool:
    """Two independent ways a quote can be unusable, and before Phase 1.2 this
    only checked the one that never fires.

    `delay_seconds` is the provider's *advertised feed delay*, written at fetch
    time from static config — 60 for SharpAPI, ~300 for SportsGameOdds, null for
    everyone else. Measured across the whole prop_odds table on 2026-08-28: the
    maximum value is 60, against a 600 threshold, so **no row has ever tripped
    this gate and none can**. The docstring above resolve_candidate_edge claimed
    a ">10-minute-old quote yields no edge"; it never did (audit P3 C4).

    The quantity that actually answers "is this price current" is `fetched_at`,
    which was sitting on the row being ignored. Both are checked now: a
    provider that admits to a long delay is untrustworthy, and so is a row we
    simply have not refreshed.

    _MAX_ROW_AGE_SECONDS is 30 minutes rather than the 10 the old comment
    claimed, because 10 would mark every non-MLB sport stale by construction —
    MLB Tier 1 refreshes every 2.5 minutes, but the generic-sport jobs are
    gameday-gated at 20-minute intervals and legitimately hold rows older than
    that. 30 minutes still catches the failure this was written for: during the
    outage the audit observed, prices were 17.5 hours old and nothing said so.
    """
    if r.delay_seconds is not None and r.delay_seconds > _TOO_STALE_SECONDS:
        return True
    age = _row_age_seconds(r, now)
    return age is not None and age > _MAX_ROW_AGE_SECONDS


def _two_sided_devigged_for_row(matched: list[PropOddsRow], side: str, row: PropOddsRow) -> float | None:
    """Given one row (a specific bookmaker+provider's price for `side`),
    finds that SAME bookmaker+provider's opposite-side price (never mixed
    across providers even when the nominal bookmaker name matches — a
    provider can report a different price for the same real book) and
    returns the devigged probability for `side`. None if no genuine,
    non-stale two-sided pair exists from that exact source."""
    other_side = "under" if side == "over" else "over"
    counterpart = next((r for r in matched if r.side == other_side and r.bookmaker == row.bookmaker and r.provider_id == row.provider_id), None)
    if counterpart is None or _too_stale_for_reference(row) or _too_stale_for_reference(counterpart):
        return None
    # Both sides must describe the same moment, within _MAX_PAIR_SKEW_SECONDS —
    # otherwise the overround measures the gap between two fetches rather than
    # the book's margin (task 4.1).
    row_age, cp_age = _row_age_seconds(row), _row_age_seconds(counterpart)
    if row_age is not None and cp_age is not None and abs(row_age - cp_age) > _MAX_PAIR_SKEW_SECONDS:
        return None
    over_row = row if side == "over" else counterpart
    under_row = counterpart if side == "over" else row
    devigged = devig_two_way(american_to_decimal(over_row.american_odds), american_to_decimal(under_row.american_odds))
    if not devigged:
        return None
    # devig_two_way returns (over, under) because over_row is passed first.
    # Returning [0] unconditionally — which this did before Phase 1.1 — handed
    # back the OVER's probability for an under candidate, i.e. the probability
    # of the proposition the caller is not asking about. That fed market_prob
    # and, since the 2026-08-27 edge redesign, `edge = market_prob -
    # implied_raw` as well, so the sign error outlived the calculation it was
    # originally found in (audit P3 C3).
    return devigged[0] if side == "over" else devigged[1]


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


def _staleness(row) -> float:
    """How old a quote is, for picking between two providers quoting the same
    book. `delay_seconds` is the vendor's own declared delay (SharpAPI's free
    tier reports 60s); an undeclared delay sorts as fresher than a declared one,
    and a row flagged is_delayed with no number sorts worst."""
    if row.delay_seconds is not None:
        return float(row.delay_seconds)
    return 1e9 if row.is_delayed else 0.0


def _consensus_reference_prob(
    matched: list[PropOddsRow], side: str, exclude_bookmaker: str | None = None
) -> tuple[float, str] | None:
    """Tier 2 — median devigged probability across every distinct
    (bookmaker, provider) pair with a genuine two-sided, non-stale price.
    Median, not mean, so one outlier book can't skew it — the same class
    of problem odds_math.is_plausible_decimal_odds guards against
    elsewhere in this codebase.

    `exclude_bookmaker` is the book the caller is about to COMPARE against
    this reference (task 5.7, P3 M14). Leaving it in biases every comparison
    toward "fair": the subject book is one of the terms in the median it is
    then measured against, so it partly sets its own benchmark, and the
    measured edge shrinks toward zero. With few books quoting a prop — the
    common case here — a book can be most of its own reference.

    Excluding it can leave nothing behind, and that returns None rather than
    a one-book "consensus". A median of one book is that book's price, which
    is precisely the number this is supposed to be independent of.
    """
    # ONE VOTE PER BOOKMAKER, not per (bookmaker, provider).
    #
    # This keyed on (bookmaker, provider_id) until 2026-09-03, so the SAME book
    # arriving from two providers cast two votes in the median. That is not
    # hypothetical: measured on live prop_odds, fanatics, draftkings and fanduel
    # each arrive from THREE providers, ten books arrive from more than one, and
    # 19,131 of 88,856 priced props (21.5%) had at least one book counted more
    # than once. A median is supposed to be one price per market participant;
    # counting DraftKings three times makes it partly a DraftKings average.
    #
    # It gets worse with breadth, which is the trap: every provider added to
    # widen coverage adds another duplicate of the same handful of books, so the
    # consensus degrades exactly as the data appears to improve.
    #
    # Where a book quotes through several providers, keep the FRESHEST quote —
    # same book, so the only thing to choose between them is staleness.
    best: dict[str, object] = {}
    for row in matched:
        if row.side != side:
            continue
        if exclude_bookmaker is not None and row.bookmaker == exclude_bookmaker:
            continue
        current = best.get(row.bookmaker)
        if current is None or _staleness(row) < _staleness(current):
            best[row.bookmaker] = row

    probs: list[float] = []
    for row in best.values():
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
        # The compared book is excluded from its own Tier-2 reference (5.7).
        # Tier 1 needs no such exclusion: it is a named sharp book, and if the
        # candidate's own price IS that sharp book, _sharp_reference_prob
        # comparing it to itself yields edge 0, which is the honest answer.
        reference = _sharp_reference_prob(matched, side) or _consensus_reference_prob(
            matched, side, exclude_bookmaker=bookmaker
        )
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
