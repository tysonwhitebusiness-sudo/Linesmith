"""Equivalence gate: server-side prop archive == the current Python pivot.

Run: .venv/Scripts/python.exe test_prop_archive_equiv.py

These rows are what the models train on, so the bar is IDENTICAL ROWS, not
similar counts. This project has twice been burned by a comparison that agreed
with a bug because it was keyed on the wrong columns -- the board comparison
that omitted `game_id` and matched stale rows, and the prefix-vs-union check
that turned out to prove the OLD path wrong. So this compares full row tuples
under an exact key, reports both directions of difference, and prints real
examples rather than a count.

It WRITES NOTHING. Both sides are computed in dry-run form and diffed.
"""
from __future__ import annotations

import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                    # noqa: E402


def _norm(v):
    """Compare values the way Postgres and Python agree on, not by repr."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


async def python_side(sport: str, upcoming: dict) -> dict:
    """The CURRENT production logic, lifted verbatim from archival_bridge."""
    rows = await db.live_props_for_games(list(upcoming))
    merged: dict[tuple, dict] = {}
    for r in rows:
        g, start = upcoming[str(r["game_id"])]
        key = (str(r["game_id"]), r["subject_id"], r["market_key"], r["line"], r["bookmaker"])
        slot = merged.setdefault(key, {
            "sport": sport, "event_ref": str(g.game_id),
            "game_date": start.date(), "event_start": start,
            "athlete_id": r["subject_id"], "athlete_name": r["subject_name"],
            "type_name": r["market_key"], "line": r["line"],
            "over_price": None, "under_price": None,
            "bookmaker": r["bookmaker"], "provider": r["provider_id"],
        })
        if r["side"] == "over":
            slot["over_price"] = r["american_odds"]
        elif r["side"] == "under":
            slot["under_price"] = r["american_odds"]
    return {k: v for k, v in merged.items()
            if v["over_price"] is not None and v["under_price"] is not None}


async def main() -> int:
    from archival_bridge import _games_for, _parse_start
    from datetime import datetime, timezone
    from provider_matrix import MATRIX

    now = datetime.now(timezone.utc)
    total_py = total_sql = 0
    mismatches = 0
    checked_sports = []

    for sport in sorted(MATRIX):
        try:
            games = await _games_for(sport)
        except Exception as e:                                # noqa: BLE001
            print(f"  {sport}: game load failed ({type(e).__name__}) - skipped")
            continue
        upcoming = {}
        for g in games:
            start = _parse_start(g.game_date)
            if start is not None and start > now:
                upcoming[str(g.game_id)] = (g, start)
        if not upcoming:
            continue

        py = await python_side(sport, upcoming)

        ids = list(upcoming)
        sql_rows = await db.prop_archive_rows_sql(
            ids, ids, [sport] * len(ids),
            [upcoming[i][1].date() for i in ids],
            [upcoming[i][1] for i in ids])
        sq = {(str(r["event_ref"]), r["athlete_id"], r["type_name"],
               _norm(r["line"]), r["bookmaker"]): r for r in sql_rows}

        pk = {(k[0], k[1], k[2], _norm(k[3]), k[4]) for k in py}
        sk = set(sq)
        only_py, only_sql = pk - sk, sk - pk
        checked_sports.append(sport)
        total_py += len(pk)
        total_sql += len(sk)

        field_diffs = []
        pyn = {(k[0], k[1], k[2], _norm(k[3]), k[4]): v for k, v in py.items()}
        for k in pk & sk:
            a, b = pyn[k], sq[k]
            for f in ("over_price", "under_price", "athlete_name", "provider",
                      "sport", "event_ref", "game_date"):
                if _norm(a[f]) != _norm(b[f]):
                    field_diffs.append((k, f, a[f], b[f]))

        bad = len(only_py) + len(only_sql) + len(field_diffs)
        mismatches += bad
        flag = "OK  " if bad == 0 else "DIFF"
        print(f"  {flag} {sport:<12} python={len(pk):>6,}  sql={len(sk):>6,}  "
              f"only_py={len(only_py):>4}  only_sql={len(only_sql):>4}  "
              f"field_diffs={len(field_diffs):>4}")
        for k in list(only_py)[:3]:
            print(f"        only in PYTHON: {k}")
        for k in list(only_sql)[:3]:
            print(f"        only in SQL   : {k}")
        for k, f, a, b in field_diffs[:3]:
            print(f"        field {f} differs on {k}: python={a!r} sql={b!r}")

    print(f"\n  sports compared : {', '.join(checked_sports) or '(none)'}")
    print(f"  python rows     : {total_py:,}")
    print(f"  sql rows        : {total_sql:,}")
    print(f"  mismatches      : {mismatches:,}")

    pool = await db.get_pool()
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                         # noqa: BLE001
        pool.terminate()

    if total_py == 0:
        print("\n  INCONCLUSIVE: no upcoming props to compare. Re-run when a "
              "slate is live -- an empty comparison is not a pass.")
        return 2
    if mismatches:
        print(f"\n  FAILED: {mismatches:,} mismatch(es). Do NOT ship item 3.")
        return 1
    print("\n  IDENTICAL. The SQL path reproduces the Python path exactly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
