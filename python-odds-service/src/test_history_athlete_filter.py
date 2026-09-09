"""Phase 5.1 — the slate filter must narrow TRANSFER without narrowing MEANING.

Runs against the real database, like `test_write_prop_odds.py`. Uses
`pitcher-hits-allowed` (209,924 rows) rather than a batter market (511,257)
because one full pull is unavoidable here and this is the cheapest one.

WHAT THIS PROTECTS. `mlb_prop_serving` used to pull every MLB player-game for a
market and discard 74% of it in Python. Measured 2026-09-09: 299 players served
out of 7,184,704 rows, that query family was 64.7% of every row the database
returned, and the 385 MB it materialised OOM-killed `mlbProjectionsJob` on a
512 MB worker for thirteen hours.

Pushing the filter into SQL is only safe if it is EXACTLY the filter that was
already happening in Python. `test_sql_filter_equals_python_filter` asserts that
directly rather than trusting the two to agree.

AND THE DEFAULT MUST STAY UNFILTERED. `load_game_history` is THE ONE HISTORY
SOURCE, so the model that is measured is the model that is served. Every fitter
and the walk-forward call it with no `athlete_ids`; a default that silently
narrowed the corpus would narrow every backtest with it — the same class of
error as calibrating at a line you do not serve, which cost Phase 3.0 a full
re-fit. `test_default_is_unfiltered` is the guard.
"""
import asyncio
import sys

sys.path.insert(0, "src")
import db as _db
import predict.mlb_props as mp

SLUG = "pitcher-hits-allowed"
_state: dict = {}


def check(name, got, want):
    assert got == want, f"FAIL {name}: got {got!r}, want {want!r}"
    print(f"PASS  {name}")


async def _load():
    """One full pull, reused by every test below."""
    pool = await _db.get_pool()
    async with pool.acquire(timeout=600.0) as conn:
        full = await mp.load_game_history(SLUG, conn=conn)
        # A stable, real sample of athletes — taken from the data so this test
        # needs no fixture and cannot drift out of date.
        ids = sorted({r[1] for r in full})[:40]
        filtered = await mp.load_game_history(SLUG, conn=conn, athlete_ids=ids)
        empty = await mp.load_game_history(SLUG, conn=conn, athlete_ids=[])
    _state.update(full=full, ids=ids, filtered=filtered, empty=empty)


def test_default_is_unfiltered():
    """THE GUARD ON EVERY BACKTEST. No argument means the whole corpus."""
    full = _state["full"]
    assert len(full) > 100_000, f"default returned only {len(full):,} rows"
    print(f"PASS  default returns the whole corpus ({len(full):,} rows)")


def test_sql_filter_equals_python_filter():
    """THE CORRECTNESS PROPERTY. The SQL filter must be byte-for-byte the same
    selection the serving path used to make in Python."""
    ids = set(_state["ids"])
    in_python = sorted([r for r in _state["full"] if r[1] in ids])
    from_sql = sorted(_state["filtered"])
    check("SQL filter returns exactly the Python filter's rows", from_sql, in_python)


def test_filter_actually_narrows_transfer():
    full, filt = len(_state["full"]), len(_state["filtered"])
    assert filt < full, "the filter did not reduce the row count at all"
    print(f"PASS  transfer narrowed {full:,} -> {filt:,} rows "
          f"({(1 - filt / full) * 100:.1f}% less)")


def test_every_returned_row_is_a_requested_athlete():
    ids = set(_state["ids"])
    stray = {r[1] for r in _state["filtered"]} - ids
    check("no unrequested athlete comes back", stray, set())


def test_empty_list_returns_nothing_rather_than_everything():
    """An empty slate must return zero rows. `ANY('{}')` matches nothing, but
    a `not athlete_ids` truthiness check would treat [] as None and silently
    return the entire corpus — the exact inversion this guards."""
    check("empty athlete list -> zero rows", len(_state["empty"]), 0)


def test_ordering_is_preserved():
    """`build` walks the list and `break`s at `as_of`, which is only correct
    while the rows stay sorted by (game_date, athlete_id)."""
    rows = _state["filtered"]
    check("filtered rows keep their sort order",
          rows, sorted(rows, key=lambda t: (t[0], t[1])))


async def main():
    await _load()
    for fn in (test_default_is_unfiltered,
               test_sql_filter_equals_python_filter,
               test_filter_actually_narrows_transfer,
               test_every_returned_row_is_a_requested_athlete,
               test_empty_list_returns_nothing_rather_than_everything,
               test_ordering_is_preserved):
        fn()
    print("\nall history-filter checks passed")


if __name__ == "__main__":
    asyncio.run(main())
