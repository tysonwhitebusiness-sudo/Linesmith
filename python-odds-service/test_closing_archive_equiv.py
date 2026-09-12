"""Gate for Step 1: the SQL closing-lines pivot must reproduce the Python one EXACTLY.

    .venv/Scripts/python.exe test_closing_archive_equiv.py

WHY FULL TUPLES AND NOT COUNTS. Two comparisons in this project have agreed with
a bug because they were keyed on the wrong columns -- the board comparison
matched stale rows by omitting `game_id`, and the prefix-vs-union check passed
while the OLD path was the wrong one. So this compares every field of every row
under an exact key, reports BOTH directions of difference, and prints real
examples rather than a verdict.

IT COMPARES FINAL STATE, NOT ROWS OFFERED, and that distinction is load-bearing.
`odds_archive_natural_key` does not include `provider` (this insert sets `source`
to the constant 'live_capture'), so two providers quoting the same book have
ALWAYS collapsed to one archive row. The old path offered both and let
executemany overwrite arbitrarily; the new path picks newest deterministically.
Comparing rows OFFERED would report 86 false failures on rows that never
coexisted in the table. So both sides are collapsed by the same newest-wins rule
and the collapse count is reported separately.

WHAT IT DOES NOT COVER, stated so nobody assumes otherwise:
  - The INSERT's ON CONFLICT behaviour. That clause is byte-identical to the one
    `upsert_live_capture` already uses, and is unchanged.
  - The `event_start > now()` freeze, for the same reason.
  - Team-id resolution, which still runs in Python and is shared by both paths.
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                      # noqa: E402
from archival_bridge import _games_for, _parse_start, _team_ids  # noqa: E402
from entity_resolution import normalize_team_name              # noqa: E402
from provider_matrix import MATRIX                             # noqa: E402


def _norm(v):
    """Compare values by identity of MEANING, not of repr.

    asyncpg hands back Decimal/float/date in shapes that differ between a
    fetch() and an unnest() round trip; a mismatch on 8.5 vs Decimal('8.5')
    would be noise, and noise in a gate is worse than no gate -- it trains you
    to ignore it.
    """
    if v is None:
        return None
    if isinstance(v, float):
        return round(v, 6)
    try:
        return round(float(v), 6)
    except (TypeError, ValueError):
        return str(v)


async def python_side(conn, sport: str, meta: dict) -> tuple[dict, int]:
    """What the OLD code built, COLLAPSED to what the archive can actually hold.

    THE COLLAPSE IS THE POINT, so read this before changing the comparison.
    `odds_archive_natural_key` keys on `source`, and this insert sets `source`
    to the constant 'live_capture' -- `provider` is NOT in the key. So two
    providers quoting the SAME book collapse to ONE archive row (measured: NFL
    fanduel moneyline from both oddsharvester and propline, -118 vs -124).

    The old path OFFERED both and let executemany overwrite, last row winning in
    whatever order the fetch returned -- so the archive has always kept an
    arbitrary one. Comparing rows OFFERED would therefore fail on rows that
    never coexisted in the table. What matters is the FINAL STATE, so this
    applies the same newest-wins rule the SQL now applies, and separately
    reports how many keys collapsed.
    """
    rows = await conn.fetch(
        """SELECT DISTINCT ON (game_id, market, side, bookmaker, source)
                  game_id, market, side, bookmaker, source, point, american_odds, fetched_at
             FROM game_odds_book_lines
            WHERE sport = $1 AND game_id = ANY($2)
            ORDER BY game_id, market, side, bookmaker, source, fetched_at DESC""",
        sport, list(meta))
    best: dict = {}
    for r in rows:
        gid = str(r["game_id"])
        if gid not in meta:
            continue
        nk = (gid, r["market"], r["side"], r["bookmaker"] or "")
        cur = best.get(nk)
        if cur is None or r["fetched_at"] > cur["fetched_at"]:
            best[nk] = r
    collapsed = len(rows) - len(best)
    out = {}
    for r in best.values():
        gid = str(r["game_id"])
        m = meta[gid]
        key = (gid, r["market"], r["side"], r["bookmaker"] or "")
        out[key] = (
            sport, gid, m["game_date"], m["event_start"],
            m["home_team_id"], m["away_team_id"], m["home_team_raw"], m["away_team_raw"],
            r["market"], r["side"], _norm(r["point"]), _norm(r["american_odds"]),
            r["bookmaker"], r["source"])
    return out, collapsed


async def sql_side(conn, sport: str, meta: dict) -> dict:
    """What the NEW server-side pivot produces, selected rather than inserted."""
    from db import _CLOSING_PIVOT
    ids = list(meta)
    rows = await conn.fetch(
        _CLOSING_PIVOT, sport, ids,
        [meta[i]["game_date"] for i in ids],
        [meta[i]["event_start"] for i in ids],
        [meta[i]["home_team_id"] for i in ids],
        [meta[i]["away_team_id"] for i in ids],
        [meta[i]["home_team_raw"] for i in ids],
        [meta[i]["away_team_raw"] for i in ids])
    out = {}
    for r in rows:
        key = (str(r["event_ref"]), r["market"], r["side"], r["bookmaker"] or "")
        out[key] = (
            r["sport"], str(r["event_ref"]), r["game_date"], r["event_start"],
            r["home_team_id"], r["away_team_id"], r["home_team_raw"], r["away_team_raw"],
            r["market"], r["side"], _norm(r["line"]), _norm(r["price"]),
            r["bookmaker"], r["provider"])
    return out


async def main() -> int:
    now = datetime.now(timezone.utc)
    pool = await db.get_pool()
    total_py = total_sql = mismatches = only_py = only_sql = total_collapsed = 0
    examples: list[str] = []

    print(f"\n{'=' * 78}\nCLOSING-LINES ARCHIVE: Python path vs server-side SQL\n{'=' * 78}")
    for sport in sorted(MATRIX):
        try:
            games = await _games_for(sport)
        except Exception as e:                                 # noqa: BLE001
            print(f"  {sport:<12} game load failed: {type(e).__name__}: {e}")
            continue

        idx = await _team_ids(sport)
        meta = {}
        for g in games:
            start = _parse_start(g.game_date)
            if start is None or start <= now:
                continue
            hid = idx.get(normalize_team_name(g.home_team_name))
            aid = idx.get(normalize_team_name(g.away_team_name))
            if not hid or not aid:
                continue          # excluded by BOTH paths, identically
            meta[str(g.game_id)] = {
                "game_date": start.date(), "event_start": start,
                "home_team_id": hid, "away_team_id": aid,
                "home_team_raw": g.home_team_name, "away_team_raw": g.away_team_name}
        if not meta:
            print(f"  {sport:<12} no upcoming games with resolvable team ids")
            continue

        async with pool.acquire(timeout=120.0) as conn:
            py, collapsed = await python_side(conn, sport, meta)
            sq = await sql_side(conn, sport, meta)

        total_collapsed += collapsed
        total_py += len(py)
        total_sql += len(sq)
        bad = 0
        for k in py.keys() | sq.keys():
            a, b = py.get(k), sq.get(k)
            if a is None:
                only_sql += 1
                bad += 1
                if len(examples) < 6:
                    examples.append(f"    SQL-ONLY  {k}\n      {b}")
            elif b is None:
                only_py += 1
                bad += 1
                if len(examples) < 6:
                    examples.append(f"    PY-ONLY   {k}\n      {a}")
            elif a != b:
                bad += 1
                if len(examples) < 6:
                    diff = [f"{i}: {x!r} != {y!r}" for i, (x, y) in enumerate(zip(a, b)) if x != y]
                    examples.append(f"    DIFFERS   {k}\n      " + "; ".join(diff))
        mismatches += bad
        flag = "OK" if bad == 0 else f"{bad} BAD"
        print(f"  {sport:<12} {len(meta):>4} games  python {len(py):>7,}  sql {len(sq):>7,}   {flag}")

    print(f"\n  python rows     : {total_py:,}")
    print(f"  sql rows        : {total_sql:,}")
    print(f"  mismatches      : {mismatches:,}  (py-only {only_py:,}, sql-only {only_sql:,})")
    print(f"  provider collapse: {total_collapsed:,} row(s) shared a natural key with")
    print("                     another provider and were ALWAYS overwritten --")
    print("                     arbitrarily before, newest-wins now")
    if examples:
        print("\n  examples:")
        for e in examples:
            print(e)

    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                          # noqa: BLE001
        pool.terminate()

    if mismatches:
        print(f"\n  FAILED: {mismatches:,} mismatch(es). Do NOT ship Step 1.\n")
        return 1
    if total_py == 0:
        print("\n  INCONCLUSIVE: zero rows on both sides. This proves nothing -- "
              "re-run when games are scheduled.\n")
        return 2
    print(f"\n  PASS: {total_py:,} rows identical on both paths, full tuples under an exact key.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
