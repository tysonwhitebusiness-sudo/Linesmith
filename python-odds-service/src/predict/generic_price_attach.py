"""Generalizes odds_lines_cycle.py's attach_prices_from_lines (confirmed
MLB-only by reading it — every call inside is hardcoded to sport="mlb") to
the six sports predict/generic_pick_capture.py already captures picks for.
Phase 1 of docs/daily-picks-full-model-build-2026-08-27.md: without this,
game_picks rows for NFL/CFB/NBA/NHL/Soccer-EPL/Soccer-MLS never get a
price attached, so Phase 7's simulated $10 bankroll would have no real
odds to compute simulatedProfit from for these sports.

MLB's version needs team-name matching because its GameLine objects come
from the-odds-api (a foreign UUID), with SharpAPI as a game_id-keyed
fallback. These six sports don't have that problem: every
game_odds_book_lines row already carries the same ESPN event id
game_picks.game_id uses (providers.py's game-line builders and
generic_pick_capture.py's own ScheduledGame.game_id both come from the
same Game.game_id, set by game_context.py's ESPN-backed loaders for these
sports — confirmed by reading both call sites, not assumed) — so this
reads db.read_game_odds_book_lines_for_sport(app_sport) directly and joins
on game_id, no name-matching layer needed.

Picks one reference bookmaker's price per (game_id, market, side): a named
sharp book first (live_edge.SHARP_REFERENCE_PRIORITY — the same priority
order the player-prop edge model already uses), else whichever book's row
was fetched most recently. This is a capture/grading price (what would a
real $10 bet have paid), not a claim that the chosen book is optimal.
"""
import db
from predict.live_edge import SHARP_REFERENCE_PRIORITY
from predict.odds_math import american_to_decimal, devig_two_way, is_plausible_decimal_odds


def _reference_row(rows: list["db.GameOddsBookLineRow"], game_id: str, market: str, side: str) -> "db.GameOddsBookLineRow | None":
    candidates = [r for r in rows if r.game_id == game_id and r.market == market and r.side == side]
    if not candidates:
        return None
    for name in SHARP_REFERENCE_PRIORITY:
        for r in candidates:
            if r.bookmaker.lower() == name:
                return r
    return max(candidates, key=lambda r: r.fetched_at)


_OPPOSITE = {"home": "away", "away": "home", "over": "under", "under": "over"}


def _market_prob_for(
    rows: list["db.GameOddsBookLineRow"], game_id: str, market: str, side: str
) -> tuple[float, str] | None:
    """De-vigged market probability of `side`, from ONE book's two-sided price.

    Q28 / task 4.2 — the market reference the game model is measured against.

    Three rules, and each one is the difference between a real probability and
    a number that looks like one:

      1. BOTH SIDES FROM THE SAME BOOK. A price from FanDuel de-vigged against
         a price from DraftKings is not either book's opinion. (This is also
         why task 5.3's bookmaker canonicalisation had to land first: while
         `FanDuel` and `fanduel` were distinct strings, the same book's two
         sides never paired, which is part of why 4.1's resolution rate sat at
         18%.)
      2. FOR TOTALS, BOTH SIDES AT THE SAME POINT. Over 8.5 and under 9.5 are
         different bets. This is P3 C1, which task 5.5 fixed on the display
         side; reintroducing it here would put the same defect straight into
         the scoreboard.
      3. SHARP BOOKS FIRST, in SHARP_REFERENCE_PRIORITY order — the same
         priority the player-prop edge model already uses, so "the market" means
         one thing across the app.

    Returns None when no single book quotes both sides. That is the honest
    answer for a genuinely one-sided market, and it keeps 4.2's coverage a real
    measurement rather than an assumption.
    """
    other = _OPPOSITE.get(side)
    if other is None:
        return None
    mine = [r for r in rows if r.game_id == game_id and r.market == market and r.side == side]
    theirs = [r for r in rows if r.game_id == game_id and r.market == market and r.side == other]
    if not mine or not theirs:
        return None

    by_book: dict[str, tuple] = {}
    for a in mine:
        for b in theirs:
            if a.bookmaker != b.bookmaker:
                continue
            # Rule 2: totals and spreads must agree on the point.
            if market != "moneyline" and a.point != b.point:
                continue
            existing = by_book.get(a.bookmaker)
            # Freshest pair per book, so a stale quote never wins.
            if existing is None or max(a.fetched_at, b.fetched_at) > existing[2]:
                by_book[a.bookmaker] = (a, b, max(a.fetched_at, b.fetched_at))

    if not by_book:
        return None

    ordered = [bk for bk in SHARP_REFERENCE_PRIORITY if bk in by_book]
    ordered += sorted(bk for bk in by_book if bk not in SHARP_REFERENCE_PRIORITY)

    for bookmaker in ordered:
        a, b, _ = by_book[bookmaker]
        a_dec = a.decimal_odds if a.decimal_odds is not None else american_to_decimal(a.american_odds)
        b_dec = b.decimal_odds if b.decimal_odds is not None else american_to_decimal(b.american_odds)
        if not (is_plausible_decimal_odds(a_dec) and is_plausible_decimal_odds(b_dec)):
            continue
        devigged = devig_two_way(a_dec, b_dec)
        if devigged is None:
            continue
        return devigged[0], bookmaker
    return None


async def attach_prices_for_sport(sport_key: str, app_sport: str) -> dict:
    rows = await db.read_game_odds_book_lines_for_sport(app_sport)
    if not rows:
        return {"sport": sport_key, "rows_seen": 0, "games": 0, "attached": 0, "market_probs": 0}

    game_ids = sorted({r.game_id for r in rows})
    attached = 0
    market_probs = 0
    for game_id in game_ids:
        pick = await db.get_game_pick(app_sport, game_id)
        if pick is None:
            continue

        for slot, ml_side in (("initial", pick.ml_initial_side), ("final", pick.ml_final_side)):
            if not ml_side:
                continue
            ref = _reference_row(rows, game_id, "moneyline", ml_side)
            if ref is not None:
                await db.attach_moneyline_price(app_sport, game_id, slot, ml_side, int(ref.american_odds))
                attached += 1
            # Q28: the market reference 4.2's activation gate is measured
            # against. Independent of the price above — the price answers "what
            # would this bet have paid", this answers "what did the market
            # think the chance was", and only the second can judge a model.
            mp = _market_prob_for(rows, game_id, "moneyline", ml_side)
            if mp is not None:
                await db.attach_market_prob(app_sport, game_id, "ml", slot, mp[0], mp[1])
                market_probs += 1

        for slot, total_side in (("initial", pick.total_initial_side), ("final", pick.total_final_side)):
            if not total_side:
                continue
            ref = _reference_row(rows, game_id, "total", total_side)
            if ref is not None:
                await db.attach_total_price(app_sport, game_id, slot, total_side, int(ref.american_odds))
                attached += 1
            mp = _market_prob_for(rows, game_id, "total", total_side)
            if mp is not None:
                await db.attach_market_prob(app_sport, game_id, "total", slot, mp[0], mp[1])
                market_probs += 1

    return {
        "sport": sport_key,
        "rows_seen": len(rows),
        "games": len(game_ids),
        "attached": attached,
        "market_probs": market_probs,
    }


async def attach_prices_all_sports() -> list[dict]:
    from predict.generic_pick_capture import _APP_SPORT_BY_KEY

    return [await attach_prices_for_sport(sport_key, app_sport) for sport_key, app_sport in _APP_SPORT_BY_KEY.items()]
