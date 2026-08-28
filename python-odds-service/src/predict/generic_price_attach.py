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


def _reference_row(rows: list["db.GameOddsBookLineRow"], game_id: str, market: str, side: str) -> "db.GameOddsBookLineRow | None":
    candidates = [r for r in rows if r.game_id == game_id and r.market == market and r.side == side]
    if not candidates:
        return None
    for name in SHARP_REFERENCE_PRIORITY:
        for r in candidates:
            if r.bookmaker.lower() == name:
                return r
    return max(candidates, key=lambda r: r.fetched_at)


async def attach_prices_for_sport(sport_key: str, app_sport: str) -> dict:
    rows = await db.read_game_odds_book_lines_for_sport(app_sport)
    if not rows:
        return {"sport": sport_key, "rows_seen": 0, "games": 0, "attached": 0}

    game_ids = sorted({r.game_id for r in rows})
    attached = 0
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

        for slot, total_side in (("initial", pick.total_initial_side), ("final", pick.total_final_side)):
            if not total_side:
                continue
            ref = _reference_row(rows, game_id, "total", total_side)
            if ref is not None:
                await db.attach_total_price(app_sport, game_id, slot, total_side, int(ref.american_odds))
                attached += 1

    return {"sport": sport_key, "rows_seen": len(rows), "games": len(game_ids), "attached": attached}


async def attach_prices_all_sports() -> list[dict]:
    from predict.generic_pick_capture import _APP_SPORT_BY_KEY

    return [await attach_prices_for_sport(sport_key, app_sport) for sport_key, app_sport in _APP_SPORT_BY_KEY.items()]
