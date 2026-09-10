"""Phase 5.2 — a stored summary must reproduce a replayed PlayerHistory.

This is what lets `player_game_history` leave Postgres. The serving pipes
replayed 2,807,445 rows to compute four numbers per player-market; a summary is
~20k rows and reproduces the model, so the history can live in object storage
and the hot path never touches it.

WHY NOT JUST TRIM POSTGRES INSTEAD: measured 2026-09-10, a 3-season window moved
59.7% of projections (median 0.0167, p95 0.115, max 0.862) and dropped 44 rows
below MIN_PRIOR_GAMES, because `shrunk_rate` uses LIFETIME totals. The history is
load-bearing, so it has to be reproduced rather than shortened.

WHY NOT HAVE SERVING READ THE CORPUS DIRECTLY: measured 13-17s per market from
S3, hourly, across 12 markets -- and it spends Supabase Storage egress every
run, partially undoing what 5.1 saved.
"""
import math
import random
import sys

sys.path.insert(0, "src")
import predict.count_prop_engine as eng

TOL = 1e-9          # far below anything the board renders (2 decimal places)


def check(name, ok, detail=""):
    assert ok, f"FAIL {name}: {detail}"
    print(f"PASS  {name}")


def replay(rows):
    h = eng.PlayerHistory()
    for ev, vol in rows:
        h.add(ev, vol)
    return h


def summarised(rows):
    return eng.history_from_summary(
        sum(r[0] for r in rows), sum(r[1] for r in rows), len(rows),
        [r[1] for r in rows])


def test_projection_is_unchanged():
    """THE REAL GATE. Not bit-equal totals -- see history_from_summary."""
    random.seed(7)
    for n in (5, 50, 350, 900):
        rows = [(random.uniform(0, 4), random.uniform(1, 6)) for _ in range(n)]
        a, b = replay(rows), summarised(rows)
        for window in (0, 5, 40, 200):
            pa = eng.project(a, 0.25, 4.3, k=640.0, volume_window=window)
            pb = eng.project(b, 0.25, 4.3, k=640.0, volume_window=window)
            check(f"n={n:<4} window={window:<4} projection reproduced",
                  abs(pa.expected - pb.expected) < TOL
                  and abs(pa.projected_volume - pb.projected_volume) < TOL
                  and pa.games_of_history == pb.games_of_history,
                  f"{pa.expected!r} vs {pb.expected!r}")


def test_totals_differ_only_by_float_accumulation():
    """Pins the reason the gate is a tolerance, so nobody 'fixes' it later."""
    random.seed(11)
    rows = [(random.uniform(0, 4), random.uniform(1, 6)) for _ in range(350)]
    a, b = replay(rows), summarised(rows)
    check("totals agree to 1e-9", abs(a.events - b.events) < TOL)
    check("summary matches math.fsum (it is the MORE accurate one)",
          b.events == math.fsum(r[0] for r in rows))


def test_recent_volume_is_order_sensitive():
    """`mean_volume(window=N)` takes the LAST N, so a summary built from a
    differently-ordered history is a different model."""
    rows = [(1.0, float(i)) for i in range(10)]
    fwd = summarised(rows)
    rev = summarised(list(reversed(rows)))
    check("reversing history changes the windowed mean",
          fwd.mean_volume(4.0, 3) != rev.mean_volume(4.0, 3),
          "order did not matter, which would hide a corrupt summary")


def test_recent_volume_is_capped_and_keeps_the_TAIL():
    rows = [(1.0, float(i)) for i in range(eng.MAX_RECENT + 60)]
    h = summarised(rows)
    check(f"capped at MAX_RECENT ({eng.MAX_RECENT})",
          len(h.recent_volume) == eng.MAX_RECENT)
    check("keeps the most recent, not the oldest",
          h.recent_volume[-1] == float(eng.MAX_RECENT + 59))


def test_empty_history_is_not_a_zero_history():
    """No games must fall back to the league mean, not to 0.0 -- a zero volume
    would project every unseen player at zero rather than at the baseline."""
    h = eng.history_from_summary(0.0, 0.0, 0, [])
    check("empty summary -> league volume", h.mean_volume(4.3, 0) == 4.3)
    check("empty summary -> zero games", h.games == 0)


for fn in (test_projection_is_unchanged,
           test_totals_differ_only_by_float_accumulation,
           test_recent_volume_is_order_sensitive,
           test_recent_volume_is_capped_and_keeps_the_TAIL,
           test_empty_history_is_not_a_zero_history):
    fn()
print("\nall history-summary checks passed")
