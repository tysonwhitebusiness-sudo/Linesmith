"""Phase 5.2 — the sport-agnostic read side of `player_history_summary`.

WHY THIS IS SHARED AND THE WRITE SIDE IS NOT. Every sport needs the same four
numbers back — events, volume, games, the last N volumes — so the READ is one
function. But each sport derives (stat, volume) from its own `stats` jsonb in
its own way: MLB extracts in SQL through `MarketSpec.stat_sql`, NHL reads
`toiMinutes` and skips goalies, NFL sums tuples of keys across receiving and
rushing. Forcing one writer to cover all three would mean a switch on sport
inside it, which is exactly the shape CLAUDE.md's adapter rule exists to
prevent. Each sport builds its own summary and writes it through
`upsert_rows` here.

THE BASELINE TRAVELS WITH THE HISTORIES because it is derived from the same
population. Summing `baseline_over / baseline_total` across a slate reproduces
`league_baseline_for` exactly, including its starts-only rule for MLB pitcher
markets — the fix that took `pitcher-hits-allowed` from a fake +18.3pt edge
(which swept the top 19 rows of the board) to -2.6.
"""
from __future__ import annotations

from . import count_prop_engine as eng

UPSERT = """
    INSERT INTO player_history_summary
      (sport, market, athlete_id, as_of, events, volume, games,
       recent_volume, baseline_over, baseline_total, board_line, computed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
    ON CONFLICT (sport, market, athlete_id, as_of) DO UPDATE SET
      events = excluded.events, volume = excluded.volume,
      games = excluded.games, recent_volume = excluded.recent_volume,
      baseline_over = excluded.baseline_over,
      baseline_total = excluded.baseline_total,
      board_line = excluded.board_line, computed_at = now()
"""


class Accumulator:
    """Builds one athlete's summary the way a replay would.

    Kept as a class rather than a dict-of-lists so the ORDER contract is stated
    where the append happens: `mean_volume(window=N)` takes the LAST N, so
    `add` must be called in the same date order the replay used. Both MLB
    loaders return a total order (game_date, athlete_id, id) — the `id`
    tiebreaker exists because MLB doubleheaders put two rows on one
    (game_date, athlete_id), and an unstable sort here is a silently different
    model.
    """

    __slots__ = ("events", "volume", "games", "recent", "over", "total")

    def __init__(self) -> None:
        self.events = 0.0
        self.volume = 0.0
        self.games = 0
        self.recent: list[float] = []
        self.over = 0
        self.total = 0

    def add(self, stat: float, volume: float, *, line: float | None = None,
            eligible: bool = True) -> None:
        self.events += stat
        self.volume += volume
        self.games += 1
        self.recent.append(volume)
        if len(self.recent) > eng.MAX_RECENT:
            self.recent.pop(0)
        # The baseline counts a DIFFERENT population from the projection:
        # eligible rows only, counted over the board line rather than summed.
        if line is not None and eligible:
            self.total += 1
            if stat > line:
                self.over += 1

    def row(self, sport: str, market: str, athlete_id: str, as_of,
            line: float | None) -> tuple:
        return (sport, market, athlete_id, as_of, self.events, self.volume,
                self.games, self.recent, self.over, self.total, line)


async def upsert_rows(conn, rows: list[tuple]) -> int:
    if not rows:
        return 0
    await conn.executemany(UPSERT, rows)
    return len(rows)


async def latest_as_of(conn, sport: str, market: str, as_of) -> "date | None":
    """The newest summary at or before `as_of`.

    AN EXACT-DATE LOOKUP BLANKS THE BOARD AT MIDNIGHT, and it did. The summary
    was written for 2026-09-09; the date rolled to 2026-09-10 and serving found
    nothing, so it produced ZERO projections -- indistinguishable from "no slate"
    and silent. That is the same class of failure as mlbProjectionsJob's OOM
    writing no breadcrumb, and it is worse here because the history has since
    been trimmed, so there is nothing to fall back to.

    Falling back to the newest earlier summary is CONSERVATIVE rather than
    leaky: a summary for date D contains history strictly before D, so using it
    on D+1 omits D's games. It under-informs, never over-informs, which is the
    correct direction for a leakage control. `staleness_days` reports the gap so
    a stale board is visible instead of merely wrong.
    """
    return await conn.fetchval(
        "SELECT max(as_of) FROM player_history_summary "
        " WHERE sport = $1 AND market = $2 AND as_of <= $3", sport, market, as_of)


async def read(conn, sport: str, market: str, as_of,
               athlete_ids: list[str] | None = None,
               exact: bool = False) -> tuple[dict, float | None]:
    """({athlete_id: PlayerHistory}, league_baseline) for one sport-market.

    Uses the newest summary at or before `as_of` unless `exact=True`. See
    `latest_as_of` for why an exact match is the wrong default.
    """
    if not exact:
        resolved = await latest_as_of(conn, sport, market, as_of)
        if resolved is None:
            return {}, None
        as_of = resolved
    args: list = [sport, market, as_of]
    where = "sport = $1 AND market = $2 AND as_of = $3"
    if athlete_ids is not None:
        args.append(list(athlete_ids))
        where += f" AND athlete_id = ANY(${len(args)}::text[])"
    rows = await conn.fetch(
        f"SELECT athlete_id, events, volume, games, recent_volume, "
        f"       baseline_over, baseline_total "
        f"  FROM player_history_summary WHERE {where}", *args)
    hists = {str(r["athlete_id"]): eng.history_from_summary(
        r["events"], r["volume"], r["games"], r["recent_volume"]) for r in rows}
    over = sum(int(r["baseline_over"]) for r in rows)
    total = sum(int(r["baseline_total"]) for r in rows)
    return hists, (over / total if total else None)


async def coverage(conn, sport: str, as_of) -> dict:
    """What the summary holds for one sport on one date.

    Exists so a serving path can tell "this market genuinely has no players"
    from "the summary job has not run", which otherwise look identical: both
    produce an empty board.
    """
    rows = await conn.fetch(
        "SELECT market, count(*) n, max(computed_at) computed_at "
        "  FROM player_history_summary WHERE sport = $1 AND as_of = $2 "
        " GROUP BY market ORDER BY market", sport, as_of)
    return {r["market"]: {"players": r["n"], "computed_at": r["computed_at"]}
            for r in rows}
