"""Phase 3.5 — closing line value, rebuilt from PREGAME prices only.

    python clv_pregame_rebuild.py

WHY THIS EXISTS RATHER THAN JUST RUNNING `clv_backtest`. That module takes its
entry price from `game_picks.ml_initial_price`, and those stored values are
contaminated: both price-attach paths recorded whatever the book was quoting
when their job happened to run, and those jobs run during games. Measured
2026-09-08, `game_odds_book_lines` is overwhelmingly a POST-commence snapshot —
100% of its implausible MLB moneylines (|odds| >= 1000) and 85.4% of its
ordinary ones were fetched after first pitch. 22 of 291 MLB picks ended up with
an entry price of |odds| >= 1000, nine at exactly -10000 sitting beside a
pinnacle market probability of 0.50.

Comparing an in-play entry against a real pregame close produced CLV of -57
probability points on single picks and dragged the reported mean to -0.079.
**That is a broken measurement, not a broken model**, and the distinction is the
whole of Phase 3.5.

The write paths are now guarded (`_reference_row` takes a commence_time,
`odds_lines_cycle` skips started games), so picks captured from here on are
clean. But only 6 of 295 historical MLB picks have any pregame row in
`game_odds_book_lines`, so the stored prices cannot be repaired in place.

`game_odds_history` can rebuild them. It is a genuine point-in-time log —
223,995 rows over 735 events, 51.9% pregame coverage of MLB picks, and only
0.76% implausible.

METHOD, and every constraint here is load-bearing:

  - **Entry** is the last observation at or before the pick's own capture time.
    Not the earliest available price, and not the best one.
  - **Close** is the last observation at or before first pitch.
  - **Both from the SAME bookmaker.** Comparing one book's entry against
    another's close measures the spread between books, not line movement, and
    a same-book comparison also cancels most of that book's vig.
  - **Entry strictly before close.** Where a pick was captured after the last
    pregame observation the two collapse to the same row and CLV is trivially
    zero; those are excluded rather than counted as neutral evidence.
  - Sharp books first, then whichever book has the most usable pairs.

CLV is a plain implied-probability difference (close minus entry) from one
book, matching `clv_backtest`'s convention so the two numbers are comparable.
"""
import asyncio
import math
import os
import statistics as st
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

SPORT = "mlb"


def implied(american: int) -> float | None:
    if american is None:
        return None
    a = float(american)
    if a > 0:
        return 100.0 / (a + 100.0)
    if a < 0:
        return (-a) / ((-a) + 100.0)
    return None


def summarise(vals: list[float], label: str) -> None:
    if len(vals) < 10:
        print(f"  {label:<38} n={len(vals):>4}   too few to judge")
        return
    m = st.mean(vals)
    sd = st.pstdev(vals)
    t = m / (sd / math.sqrt(len(vals))) if sd > 0 else float("nan")
    pos = sum(1 for v in vals if v > 0)
    verdict = ("POSITIVE CLV" if t > 1.96 else
               "NEGATIVE CLV" if t < -1.96 else "NOT DISTINGUISHABLE FROM ZERO")
    print(f"  {label:<38} n={len(vals):>4}  mean {m:+.5f}  median {st.median(vals):+.5f}"
          f"  beat {100*pos/len(vals):>5.1f}%  t={t:+.2f}  {verdict}")


async def main() -> int:
    import db

    pool = await db.get_pool()
    async with pool.acquire(timeout=1800.0) as c:
        rows = await c.fetch(
            """
            WITH picks AS (
              SELECT game_id, matchup, commence_time,
                     ml_initial_side  AS side,
                     ml_initial_captured_at AS captured_at,
                     'moneyline' AS market
                FROM game_picks
               WHERE sport = $1 AND ml_initial_side IS NOT NULL
                 AND ml_initial_captured_at IS NOT NULL AND commence_time IS NOT NULL
              UNION ALL
              SELECT game_id, matchup, commence_time,
                     total_initial_side, total_initial_captured_at, 'total'
                FROM game_picks
               WHERE sport = $1 AND total_initial_side IS NOT NULL
                 AND total_initial_captured_at IS NOT NULL AND commence_time IS NOT NULL
            ),
            entry AS (
              SELECT DISTINCT ON (p.game_id, p.market, h.bookmaker)
                     p.game_id, p.market, p.side, p.matchup, h.bookmaker,
                     h.american_odds AS entry_odds, h.observed_at AS entry_at
                FROM picks p
                JOIN game_odds_history h
                  ON h.event_id = p.game_id AND h.market = p.market AND h.side = p.side
                 AND h.observed_at <= p.captured_at
                 AND h.observed_at <= p.commence_time
               ORDER BY p.game_id, p.market, h.bookmaker, h.observed_at DESC
            ),
            close AS (
              SELECT DISTINCT ON (p.game_id, p.market, h.bookmaker)
                     p.game_id, p.market, h.bookmaker,
                     h.american_odds AS close_odds, h.observed_at AS close_at
                FROM picks p
                JOIN game_odds_history h
                  ON h.event_id = p.game_id AND h.market = p.market AND h.side = p.side
                 AND h.observed_at <= p.commence_time
               ORDER BY p.game_id, p.market, h.bookmaker, h.observed_at DESC
            )
            SELECT e.game_id, e.market, e.side, e.matchup, e.bookmaker,
                   e.entry_odds, e.entry_at, k.close_odds, k.close_at
              FROM entry e
              JOIN close k
                ON k.game_id = e.game_id AND k.market = e.market
               AND k.bookmaker = e.bookmaker
             WHERE k.close_at > e.entry_at
            """,
            SPORT,
        )

    print(f"pregame entry/close pairs found: {len(rows):,}")
    if not rows:
        print("nothing measurable")
        return 1

    by_book: dict[str, list] = {}
    for r in rows:
        by_book.setdefault(r["bookmaker"], []).append(r)
    print("coverage by book:",
          sorted(((b, len(v)) for b, v in by_book.items()), key=lambda x: -x[1])[:8])

    # REPORT EVERY BOOK WITH REAL COVERAGE, not one.
    #
    # Sharp priority puts `pinnacle` first, but it carries only 35 pairs per
    # market here — far too thin to decide anything, and a single thin feed is
    # exactly how a spurious verdict gets published. Line movement is a property
    # of the market, so a real effect should show up across books; one book
    # disagreeing with seven is a data story, not a model story.
    MIN_PAIRS = 60
    books = sorted((b for b, v in by_book.items() if len(v) >= MIN_PAIRS),
                   key=lambda b: -len(by_book[b]))
    print(f"\nbooks with >= {MIN_PAIRS} pairs: {len(books)}\n")

    for market in ("moneyline", "total"):
        print(f"=== {market.upper()} ===")
        pooled_by_pick: dict[str, list[float]] = {}
        for book in books:
            vals = []
            for r in by_book[book]:
                if r["market"] != market:
                    continue
                if abs(r["entry_odds"]) >= 1000 or abs(r["close_odds"]) >= 1000:
                    continue
                e, k = implied(r["entry_odds"]), implied(r["close_odds"])
                if e is None or k is None:
                    continue
                vals.append(k - e)
                pooled_by_pick.setdefault(r["game_id"], []).append(k - e)
            summarise(vals, book)
        # One value per PICK, averaged across books, so a pick quoted by eight
        # books does not count eight times toward significance.
        cons = [st.mean(v) for v in pooled_by_pick.values()]
        print()
        summarise(cons, "CONSENSUS (one value per pick)")
        print()

    print("Positive CLV means the market moved TOWARD the pick after it was made,")
    print("which is the standard evidence that a model is finding real edge.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
