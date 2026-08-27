"""Closing Line Value (CLV) backtest — Phase 0/2 of
docs/mlb-market-centric-model-gameplan-2026-08-27.md.

Real question this answers: does this app's picks already beat the
closing line, or not? Not an outcome-accuracy check (log_loss/brier_score,
what walkforward.py scores) — CLV asks whether the price you got when you
picked moved toward your side by the time the market closed, a different,
market-centric measure of edge (the gameplan doc's own citation: this is
what "quant-predictor"'s strongest validation piece checked, not raw
outcome accuracy).

Reference book default: LowVig.ag, not Pinnacle, for a real, disclosed
reason, not an oversight — Pinnacle rows in game_odds_history only started
2026-08-27 (156 rows, confirmed live), too young to backtest against this
module's 2-week pick history. LowVig.ag has full 2-week coverage (1,902
rows since 2026-08-12) and is a recognized near-sharp reference in the
sports-betting-quant community when direct Pinnacle history isn't
available for the backtest window. Switch the default once Pinnacle's own
history has enough depth (gameplan Phase 1) — this is a real, temporary
substitution, not a claim that LowVig.ag IS Pinnacle.

Real bug found and fixed alongside this module (2026-08-27,
predict/odds_lines_cycle.py): game_odds_history's the-odds-api rows were
keyed by the-odds-api's own foreign UUID, never the real MLB game_pk —
confirmed live, 0 of the pre-fix rows joined to any real game_picks row.
Fixed at the write path so every row from now on is keyed correctly, but
that fix cannot retroactively repair the prior 2 weeks of history — those
rows are permanently unjoinable (would need re-fetching the-odds-api's
historical events, not attempted). Two real, honest consequences: (1) a
backtest run today will find close-price matches only for picks made
since this fix landed, not the full 2-week window Phase 0's own numbers
originally described; (2) this module falls back to
game_odds_book_lines's CURRENT-state snapshot (db.get_current_book_line)
when game_odds_history has no correctly-keyed row for a game — real data,
not fabricated, but note it's a "last known price" proxy for a finished
game rather than a true point-in-time historical log, and that table has
only existed since 2026-08-25. Coverage will grow correctly on its own
every day from here forward with zero further code changes needed.

CLV is computed as a plain implied-probability difference (close minus
entry) from the SAME reference book at both points in time, not a fully
de-vigged comparison — comparing one book's own two prices over time
mostly cancels its vig anyway (it doesn't change much game to game), and
this keeps the math simple and auditable for a first pass. A more exact
de-vigged version is a real, disclosed possible refinement, not required
to get a directionally honest first number (gameplan Phase 0's actual
goal).
"""
import asyncio
from dataclasses import dataclass
from datetime import datetime

import db
from predict.odds_math import american_to_decimal

DEFAULT_REFERENCE_BOOKMAKER = "LowVig.ag"


def _parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s[:-1] + "+00:00" if s.endswith("Z") else s)


def implied_prob(american_odds: int) -> float | None:
    decimal = american_to_decimal(american_odds)
    return 1 / decimal if decimal else None


@dataclass
class PickClvResult:
    game_id: str
    matchup: str | None
    market: str  # 'moneyline' | 'total'
    side: str
    entry_price: int
    entry_captured_at: datetime | None
    close_price: int
    close_observed_at: datetime
    close_bookmaker: str
    clv_prob_points: float  # close_implied_prob - entry_implied_prob; positive = you beat the close


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


@dataclass
class ClvBacktestResult:
    market: str
    reference_bookmaker: str
    picks_considered: int
    picks_with_reference_close: int
    results: list[PickClvResult]
    mean_clv_prob_points: float | None
    median_clv_prob_points: float | None
    positive_clv_rate: float | None  # fraction of matched picks with clv > 0

    def summary_line(self) -> str:
        if not self.results:
            return (
                f"{self.market}: {self.picks_considered} picks considered, 0 matched a "
                f"{self.reference_bookmaker} closing price — nothing to report yet"
            )
        return (
            f"{self.market}: {self.picks_with_reference_close}/{self.picks_considered} picks matched a "
            f"{self.reference_bookmaker} close | mean CLV {self.mean_clv_prob_points:+.4f} prob-pts | "
            f"median {self.median_clv_prob_points:+.4f} | positive-CLV rate {self.positive_clv_rate:.1%}"
        )


async def _backtest(
    sport: str,
    market: str,
    side_field: str,
    price_field: str,
    captured_at_field: str,
    reference_bookmaker: str,
) -> ClvBacktestResult:
    picks = await db.list_captured_game_picks(sport)
    results: list[PickClvResult] = []
    considered = 0
    for p in picks:
        side = getattr(p, side_field)
        price = getattr(p, price_field)
        captured_at = getattr(p, captured_at_field)
        if side is None or price is None or not p.commence_time:
            continue
        considered += 1
        try:
            commence_dt = _parse_iso(p.commence_time)
        except ValueError:
            continue
        closing = await db.get_closing_price(p.game_id, market, side, commence_dt, reference_bookmaker)
        if closing is not None:
            close_price, close_observed_at, close_bookmaker = closing.american_odds, closing.observed_at, closing.bookmaker
        else:
            # Fallback: game_odds_history has no correctly-keyed row for
            # this game (either it predates the 2026-08-27 event_id fix,
            # or this book/market simply wasn't observed before commence).
            # game_odds_book_lines's current-state snapshot is a real,
            # if short-window, second try before giving up on this pick.
            current = await db.get_current_book_line(sport, p.game_id, market, side, reference_bookmaker)
            if current is None:
                continue
            close_price, close_observed_at, close_bookmaker = current.american_odds, _parse_iso(current.fetched_at), current.bookmaker
        entry_p = implied_prob(price)
        close_p = implied_prob(close_price)
        if entry_p is None or close_p is None:
            continue
        results.append(
            PickClvResult(
                game_id=p.game_id,
                matchup=p.matchup,
                market=market,
                side=side,
                entry_price=price,
                entry_captured_at=_parse_iso(captured_at) if captured_at else None,
                close_price=close_price,
                close_observed_at=close_observed_at,
                close_bookmaker=close_bookmaker,
                clv_prob_points=close_p - entry_p,
            )
        )
    clv_values = [r.clv_prob_points for r in results]
    return ClvBacktestResult(
        market=market,
        reference_bookmaker=reference_bookmaker,
        picks_considered=considered,
        picks_with_reference_close=len(results),
        results=results,
        mean_clv_prob_points=sum(clv_values) / len(clv_values) if clv_values else None,
        median_clv_prob_points=_median(clv_values),
        positive_clv_rate=(sum(1 for v in clv_values if v > 0) / len(clv_values)) if clv_values else None,
    )


async def backtest_moneyline_clv(sport: str = "mlb", reference_bookmaker: str = DEFAULT_REFERENCE_BOOKMAKER) -> ClvBacktestResult:
    """CLV for the side actually picked at INITIAL capture — not
    ml_final_side, which can be a different side than what was originally
    entered if the model's own pick flipped between captures (real CLV
    needs the closing price of the side you entered, not whichever side
    happened to be priced at the final snapshot)."""
    return await _backtest(sport, "moneyline", "ml_initial_side", "ml_initial_price", "ml_initial_captured_at", reference_bookmaker)


async def backtest_total_clv(sport: str = "mlb", reference_bookmaker: str = DEFAULT_REFERENCE_BOOKMAKER) -> ClvBacktestResult:
    """Same idea as backtest_moneyline_clv, for the total market — side is
    'over'/'under' rather than 'home'/'away', matching game_odds_history's
    own schema comment for the total market."""
    return await _backtest(sport, "total", "total_initial_side", "total_initial_price", "total_initial_captured_at", reference_bookmaker)


async def main() -> None:
    ml = await backtest_moneyline_clv()
    total = await backtest_total_clv()
    print(f"[clv_backtest] {datetime.now().isoformat()}")
    print(f"  {ml.summary_line()}")
    print(f"  {total.summary_line()}")


if __name__ == "__main__":
    asyncio.run(main())
