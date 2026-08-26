"""Standalone verification for predict/mlb_bradley_terry.py. Synthetic
round-robin with a known true strength ordering (no network), a symmetry
check on bt_win_prob, then one real live run against a real past MLB
season (network, no DB) confirming a plausible game count with no
exceptions — matching this repo's "live-tested, not assumed" standard for
anything touching a real external API. Same convention as
test_game_pick_lock.py.
"""
import asyncio
import sys

import httpx

sys.path.insert(0, "src")

from predict.mlb_bradley_terry import BTGameRow, build_bradley_terry_training_set, bt_win_prob, fit_bradley_terry

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r}")


def check_close(label: str, actual: float, expected: float, tol: float = 1e-6) -> None:
    global _failures
    if abs(actual - expected) <= tol:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — got {actual!r}, expected {expected!r} (tol {tol})")


def check_true(label: str, condition: bool) -> None:
    global _failures
    if condition:
        print(f"PASS: {label}")
    else:
        _failures += 1
        print(f"FAIL: {label} — condition was False")


# Fake, obviously-out-of-range team ids so this can never collide with a real MLB team_id.
TEAM_A, TEAM_B, TEAM_C, TEAM_D = 999901, 999902, 999903, 999904


def test_fit_recovers_known_ordering() -> None:
    # A>B>C>D round-robin: A beats everyone, D loses to everyone, with a
    # few upsets mixed in so the fit isn't trivially perfect-separation.
    games: list[BTGameRow] = []
    schedule = [
        (TEAM_A, TEAM_B, 1), (TEAM_A, TEAM_C, 1), (TEAM_A, TEAM_D, 1),
        (TEAM_B, TEAM_C, 1), (TEAM_B, TEAM_D, 1), (TEAM_C, TEAM_D, 1),
        (TEAM_B, TEAM_A, 0), (TEAM_C, TEAM_A, 0), (TEAM_D, TEAM_A, 0),
        (TEAM_C, TEAM_B, 0), (TEAM_D, TEAM_B, 0), (TEAM_D, TEAM_C, 0),
        (TEAM_D, TEAM_A, 1),  # one real upset, keeps the fit non-degenerate
    ]
    for i, (home, away, home_won) in enumerate(schedule * 8):  # repeat for a real sample size
        games.append(BTGameRow(home_team_id=home, away_team_id=away, home_won=home_won, game_date=f"2023-{(i % 12) + 1:02d}-01", season=2023))

    params = fit_bradley_terry(games, iterations=1500, decay_half_life_games=100000.0)  # effectively no decay for this synthetic check
    r = params.team_ratings
    check_true("fitted ordering: A > B", r[TEAM_A] > r[TEAM_B])
    check_true("fitted ordering: B > C", r[TEAM_B] > r[TEAM_C])
    check_true("fitted ordering: C > D", r[TEAM_C] > r[TEAM_D])


def test_bt_win_prob_symmetry() -> None:
    p_home = bt_win_prob(0.3, -0.1, 0.05)
    p_away = bt_win_prob(-0.1, 0.3, -0.05)
    check_close("bt_win_prob(a,b,h) == 1 - bt_win_prob(b,a,-h)", p_home, 1 - p_away)

    check_close("bt_win_prob with equal ratings, zero home_advantage is 0.5", bt_win_prob(1.0, 1.0, 0.0), 0.5)


async def test_live_training_set() -> None:
    async with httpx.AsyncClient() as client:
        rows = await build_bradley_terry_training_set(client, [2023])
    # A real MLB season is ~2430 regular-season games; allow real slack for
    # postponements/doubleheader quirks rather than asserting an exact count.
    check_true(f"2023 season returned a plausible game count ({len(rows)})", 2000 <= len(rows) <= 2500)
    check_true("all rows have a real season tag", all(r.season == 2023 for r in rows))
    check_true("home_won is always 0 or 1", all(r.home_won in (0, 1) for r in rows))


async def main() -> bool:
    test_fit_recovers_known_ordering()
    test_bt_win_prob_symmetry()
    await test_live_training_set()
    print(f"\n{'ALL PASS' if _failures == 0 else f'{_failures} FAILURE(S)'}")
    return _failures == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    raise SystemExit(0 if ok else 1)
