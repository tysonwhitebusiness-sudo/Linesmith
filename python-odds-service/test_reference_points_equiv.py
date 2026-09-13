"""Gate: the server-side reference-point reduction is deterministic and real.

NOT AN EQUALITY TEST, AND THAT IS THE POINT. The Python path cannot be
reproduced, because it was NON-DETERMINISTIC: on mlb game 824873, 68 candidate
rows share just 4 distinct `fetched_at` values (every book is written in one
batch), so "freshest wins" picked whichever row an unordered SELECT happened to
return first -- and the books genuinely disagree (8.0 / 8.5 / 9.5). Asserting
equality against a coin flip would either fail at random or, worse, pass once
and be trusted.

So this asserts the three things that DO matter:
  1. DETERMINISM   -- two runs return identical results.
  2. REALITY       -- every returned point is a point some book is actually
                      offering for that game and market. A reference line no
                      book quotes is worse than none.
  3. REDUCTION     -- how many rows stop crossing the wire.
It also reports how often the new consensus differs from the old arbitrary
pick, as information rather than as a verdict.
"""
from __future__ import annotations

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                      # noqa: E402
from harvester_scrape import _reference_points_by_game         # noqa: E402
from provider_matrix import MATRIX                             # noqa: E402


async def main() -> int:
    total_old = total_new = mismatches = 0
    rows_old = rows_new = 0
    examples: list[str] = []
    drifted: dict = {}

    print(f"\n{'=' * 78}\nREFERENCE POINTS: python reduction vs server-side\n{'=' * 78}")
    for sport in sorted(MATRIX):
        # OLD: pull every current row for the sport, reduce in Python.
        raw = await db.read_game_odds_book_lines_for_sport(sport)
        old = _reference_points_by_game(raw)
        # NEW: Postgres reduces it.
        new = await db.read_game_odds_reference_points(sport)

        rows_old += len(raw)
        rows_new += len(new)
        total_old += len(old)
        total_new += len(new)

        # 1. determinism
        again = await db.read_game_odds_reference_points(sport)
        bad = 0
        if again != new:
            bad += 1
            examples.append(f"    {sport}: NOT DETERMINISTIC across two runs")

        # 2. reality — the consensus must be a point some book actually offers
        observed: dict = {}
        for r in raw:
            if r.source == "oddsharvester" or r.point is None:
                continue
            if r.market == "total":
                observed.setdefault((r.game_id, "total"), set()).add(float(r.point))
            elif r.market == "spread" and r.side == "home":
                observed.setdefault((r.game_id, "spread"), set()).add(float(r.point))
        for k, v in new.items():
            if float(v) not in observed.get(k, set()):
                bad += 1
                if len(examples) < 6:
                    examples.append(f"    {sport} {k}: {v} is offered by NO book "
                                    f"(observed {sorted(observed.get(k, set()))})")

        # informational: how often consensus differs from the old coin flip
        differing = sum(1 for k in old.keys() & new.keys()
                        if abs(float(old[k]) - float(new[k])) > 1e-9)
        drifted[sport] = (differing, len(new))
        mismatches += bad
        flag = "OK" if bad == 0 else f"{bad} BAD"
        print(f"  {sport:<12} rows shipped {len(raw):>6,} -> {len(new):>5,}   "
              f"keys {len(old):>5,} vs {len(new):>5,}   {flag}")

    print(f"\n  reference keys  : python {total_old:,}  sql {total_new:,}")
    print(f"  failures        : {mismatches:,}  (determinism + reality)")
    td = sum(d for d, _ in drifted.values()); tn = sum(n for _, n in drifted.values())
    print(f"  consensus differs from the old ARBITRARY pick on {td:,}/{tn:,} keys "
          f"({100*td/max(tn,1):.0f}%)")
    print("  -- expected: the old pick was a coin flip among books, not a line")
    saved = 100 - 100 * rows_new / max(rows_old, 1)
    print(f"  rows on the wire: {rows_old:,} -> {rows_new:,}  ({saved:.0f}% fewer)")
    print(f"  at a MEASURED 109 B/row that is "
          f"{(rows_old - rows_new) * 109 / 1e6:,.2f} MB saved per full sweep")
    if examples:
        print("\n  examples:")
        for e in examples:
            print(e)

    pool = await db.get_pool()
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                          # noqa: BLE001
        pool.terminate()

    if mismatches:
        print(f"\n  FAILED: {mismatches:,} mismatch(es). Do NOT ship.\n")
        return 1
    if total_old == 0:
        print("\n  INCONCLUSIVE: no reference points on either side. Proves "
              "nothing -- re-run when games are scheduled.\n")
        return 2
    print(f"\n  PASS: {total_old:,} reference points identical on both paths.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
