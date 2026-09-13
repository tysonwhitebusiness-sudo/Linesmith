"""Gate: the server-side hot-window aggregate must equal the Python fold EXACTLY.

    .venv/Scripts/python.exe test_hot_window_agg_equiv.py

THIS GUARDS THE MODEL SERVING PATH. `load_game_history` + the Python fold in
`summary_rows` produce the six numbers every MLB prop projection is built from.
If the SQL version differs by so much as one game in `games`, or one position in
`recent_volume`, the projection moves and the output still looks entirely
plausible -- there is no downstream check that would catch it.

So this compares EVERY athlete in EVERY market on ALL SIX aggregates, and
reports the first real differences rather than a pass/fail count. Two earlier
comparisons in this project agreed with a bug because they were keyed wrongly
(the board comparison omitted `game_id`; the prefix-vs-union check passed while
the OLD path was the wrong one).

WHAT IT DOES NOT COVER: the prefix half. This is the HOT WINDOW only -- the same
split the caller applies. The concatenation of prefix tail + hot window, and the
MAX_RECENT cap that follows it, stay in Python and are unchanged.
"""
from __future__ import annotations

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                      # noqa: E402
from predict import mlb_props as mp                            # noqa: E402
from predict.mlb_board_lines import BOARD_LINES                # noqa: E402


def python_fold(rows, line, eligible):
    """The existing fold, lifted verbatim from summary_rows -- minus the prefix
    seed and the MAX_RECENT cap, which belong to the caller, not to this half."""
    agg: dict[str, list] = {}
    for gd, aid, ev, vol in rows:
        a = agg.get(aid)
        if a is None:
            a = agg[aid] = [0.0, 0.0, 0, [], 0, 0]
        a[0] += ev
        a[1] += vol
        a[2] += 1
        a[3].append(vol)
        if line is not None and (eligible is None or (gd, aid) in eligible):
            a[5] += 1
            if ev > line:
                a[4] += 1
    return agg


async def main() -> int:
    from datetime import date, timedelta
    as_of = date.today() + timedelta(days=1)    # include everything present

    pool = await db.get_pool()
    bad = 0
    checked = 0
    rows_old = rows_new = 0
    examples: list[str] = []

    print(f"\n{'=' * 78}\nHOT WINDOW: python fold vs server-side aggregate\n{'=' * 78}")
    async with pool.acquire(timeout=600.0) as conn:
        start_keys = await mp.load_start_keys(conn=conn)
        for slug in mp.BY_SLUG:
            spec = mp.BY_SLUG[slug]
            line = BOARD_LINES.get(slug)
            eligible = start_keys if spec.side == "pit" else None

            raw = await mp.load_game_history(slug, conn=conn)
            raw = [r for r in raw if r[0] < as_of]
            old = python_fold(raw, line, eligible)
            new = await mp.load_hot_window_agg(
                slug, conn=conn, as_of=as_of, line=line,
                eligible_start_keys=(spec.side == "pit"))

            rows_old += len(raw)
            rows_new += len(new)
            slug_bad = 0
            for aid in old.keys() | new.keys():
                a, b = old.get(aid), new.get(aid)
                checked += 1
                if a is None or b is None:
                    slug_bad += 1
                    if len(examples) < 8:
                        examples.append(f"    {slug} {aid}: "
                                        f"{'missing in SQL' if b is None else 'missing in python'}")
                    continue
                # events, volume, games, recent_volume, baseline_over, baseline_total
                diffs = []
                if abs(a[0] - b[0]) > 1e-6: diffs.append(f"events {a[0]} != {b[0]}")
                if abs(a[1] - b[1]) > 1e-6: diffs.append(f"volume {a[1]} != {b[1]}")
                if a[2] != b[2]:            diffs.append(f"games {a[2]} != {b[2]}")
                if [round(x, 6) for x in a[3]] != [round(x, 6) for x in b[3]]:
                    diffs.append(f"recent_volume len {len(a[3])} vs {len(b[3])} / order")
                if a[4] != b[4]:            diffs.append(f"baseline_over {a[4]} != {b[4]}")
                if a[5] != b[5]:            diffs.append(f"baseline_total {a[5]} != {b[5]}")
                if diffs:
                    slug_bad += 1
                    if len(examples) < 8:
                        examples.append(f"    {slug} {aid}: " + "; ".join(diffs))
            bad += slug_bad
            print(f"  {slug:<26} rows {len(raw):>7,} -> {len(new):>5,} athletes   "
                  f"{'OK' if slug_bad == 0 else str(slug_bad) + ' BAD'}")

    print(f"\n  athlete-markets compared : {checked:,}")
    print(f"  differences              : {bad:,}")
    print(f"  rows on the wire         : {rows_old:,} -> {rows_new:,}  "
          f"({100 - 100 * rows_new / max(rows_old, 1):.1f}% fewer)")
    print(f"  at a MEASURED 109 B/row  : "
          f"{(rows_old - rows_new) * 109 / 1e6:,.1f} MB saved per full pass")
    if examples:
        print("\n  first differences:")
        for e in examples:
            print(e)

    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                          # noqa: BLE001
        pool.terminate()

    if bad:
        print(f"\n  FAILED: {bad:,} athlete-market(s) differ. Do NOT ship.\n")
        return 1
    if checked == 0:
        print("\n  INCONCLUSIVE: nothing compared.\n")
        return 2
    print(f"\n  PASS: {checked:,} athlete-markets identical on all six aggregates.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
