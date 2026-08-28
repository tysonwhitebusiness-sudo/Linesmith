"""Phase 7 of docs/daily-picks-full-model-build-2026-08-27.md — real
prop-grading for the six sports Phase 4/5 produce candidates for. Real
gap found live while building Phase 7 (not assumed from the doc, which
only flagged it as unconfirmed): `pick_history` grading has NO generic
path anywhere in this codebase — `lib/odds/props/grading.ts`'s
`writeGrades` is the only writer, and its only real caller
(`lib/odds/props/grading.ts` itself) is entirely MLB-specific (imports
`sports/mlb/statsapi`/`sports/mlb/adapter`, MLB Stats API's own live
feed). Without this module, Phase 4/5's real candidates for NFL/CFB/NBA/
NHL/Soccer would accumulate forever as `outcome IS NULL` and Phase 7's
simulated bankroll would have nothing to compute against for any of
them.

Real per-player actuals come from `player_game_history` — the SAME table
Phase 4 already reads for history, not a second live fetch. A pick is
gradeable once (a) its game is confirmed final via ESPN (same
generic_team_elo.fetch_finished_games this file's own Phase 1 grading
job already uses) and (b) that subject's real stat row for that exact
game exists in player_game_history (written by generic_freshness_job.py
within its own LOOKBACK_DAYS window — real, same-day turnaround for a
freshly-finished game, not a multi-day lag).

Sport-key crosswalk: pick_history is keyed by the generic app-facing
sport ('soccer', not 'soccer_epl'/'soccer_mls' — see
generic_prop_production.py's own docstring for why), but
player_game_history is keyed by the internal routing key. For soccer,
this module tries both soccer_epl and soccer_mls when looking up a real
stat row — ESPN's own event/athlete ids are globally unique, so trying
both is a real, safe resolution (first real match wins), not a guess.

A DNP (no real player_game_history row for that game, even though the
game is confirmed final) is left ungraded rather than forced to a loss —
same "don't guess" ethic prop_pick_history.py's own vs-LHP/vs-RHP gap
already establishes. Real sportsbooks typically void a DNP prop; this
codebase has no 'push' outcome value yet (lib/db/client.ts's
simulatedProfit only ever computes win/loss), so leaving it ungraded is
the honest choice, not a silent wrong grade.
"""
from typing import Callable

import httpx

import db
from predict import generic_team_elo as gte
from predict.generic_dimension_configs import CFB_DIMENSIONS, NBA_DIMENSIONS, NFL_DIMENSIONS, NHL_DIMENSIONS, SOCCER_DIMENSIONS
from predict.generic_pick_capture import _APP_SPORT_BY_KEY
from predict.generic_rare_markets import (
    CFB_RARE_DIMENSION,
    NBA_RARE_DIMENSION,
    NFL_RARE_DIMENSION,
    NHL_RARE,
    SOCCER_RARE,
    anytime_td_condition,
    triple_double_condition,
)

# sport_key -> {dimension: espn_stat_name} for every single-field
# dimension (regular pool + the single-field rare markets) — the reverse
# of what generic_dimension_configs.py declares, built once here rather
# than re-deriving it inline per grading pass.
_STAT_NAME_BY_DIMENSION: dict[str, dict[str, str]] = {
    "nfl": {c.dimension: c.espn_stat_name for c in NFL_DIMENSIONS},
    "cfb": {c.dimension: c.espn_stat_name for c in CFB_DIMENSIONS},
    "nba": {c.dimension: c.espn_stat_name for c in NBA_DIMENSIONS},
    "nhl": {c.dimension: c.espn_stat_name for c in NHL_DIMENSIONS} | {NHL_RARE.dimension: NHL_RARE.espn_stat_name},
    "soccer_epl": {c.dimension: c.espn_stat_name for c in SOCCER_DIMENSIONS} | {SOCCER_RARE.dimension: SOCCER_RARE.espn_stat_name},
    "soccer_mls": {c.dimension: c.espn_stat_name for c in SOCCER_DIMENSIONS} | {SOCCER_RARE.dimension: SOCCER_RARE.espn_stat_name},
}

# sport_key -> {dimension: condition} for derived (multi-field) markets —
# graded by evaluating the same real condition function build_derived_
# rare_candidate used to generate the candidate in the first place.
_DERIVED_CONDITION_BY_DIMENSION: dict[str, dict[str, Callable[[dict], bool]]] = {
    "nfl": {NFL_RARE_DIMENSION: anytime_td_condition},
    "cfb": {CFB_RARE_DIMENSION: anytime_td_condition},
    "nba": {NBA_RARE_DIMENSION: triple_double_condition},
}

# app_sport -> real internal sport_key candidates to try, in order — one
# entry for every sport except soccer, which has two real leagues sharing
# one app-facing key.
_SPORT_KEYS_BY_APP_SPORT: dict[str, list[str]] = {}
for _sport_key, _app_sport in _APP_SPORT_BY_KEY.items():
    _SPORT_KEYS_BY_APP_SPORT.setdefault(_app_sport, []).append(_sport_key)


def _grade_one(sport_key: str, dimension: str, line: float | None, stats: dict) -> tuple[str, float] | None:
    """(outcome, actual_value) for one real row, or None when this
    dimension isn't gradeable from real data (shouldn't happen for a
    dimension this module actually produced, but real defense against a
    stale/unknown dimension rather than a crash)."""
    derived = _DERIVED_CONDITION_BY_DIMENSION.get(sport_key, {}).get(dimension)
    if derived is not None:
        hit = derived(stats)
        return ("win" if hit else "loss"), (1.0 if hit else 0.0)
    stat_name = _STAT_NAME_BY_DIMENSION.get(sport_key, {}).get(dimension)
    if stat_name is None:
        return None
    if stat_name not in stats:
        return None  # this specific game's box score has no row for this category (e.g. a WR with no rushing that game) — genuinely ungradeable, not a 0
    actual = stats[stat_name]
    if line is None:
        return None
    return ("win" if actual > line else "loss"), float(actual)


async def grade_sport(app_sport: str) -> dict:
    """One real grading pass for one app-facing sport. Real, expected
    no-op when there's nothing ungraded yet or nothing has finished —
    never an error."""
    ungraded = await db.ungraded_pick_history_for_sport(app_sport)
    if not ungraded:
        return {"sport": app_sport, "ungraded": 0, "graded": 0, "still_pending": 0}

    sport_keys = _SPORT_KEYS_BY_APP_SPORT.get(app_sport, [])
    finished_game_ids: set[str] = set()
    async with httpx.AsyncClient() as client:
        for sport_key in sport_keys:
            config = gte.SPORT_CONFIGS.get(sport_key)
            if config is None:
                continue
            games = await gte.fetch_finished_games_range(client, config, days_back=5)
            finished_game_ids.update(g.game_id for g in games)

    grades: list["db.PickHistoryGrade"] = []
    still_pending = 0
    for row in ungraded:
        if row.game_id not in finished_game_ids:
            still_pending += 1
            continue
        result = None
        for sport_key in sport_keys:
            stats = await db.fetch_player_game_stat(sport_key, row.subject_id, row.game_id)
            if stats is None:
                continue
            result = _grade_one(sport_key, row.dimension, row.line, stats)
            if result is not None:
                break
        if result is None:
            continue  # real DNP or genuinely ungradeable this pass — left for a future pass, never guessed
        outcome, actual_value = result
        grades.append(db.PickHistoryGrade(id=row.id, outcome=outcome, actual_value=actual_value))

    graded = await db.write_pick_history_grades(grades)
    return {"sport": app_sport, "ungraded": len(ungraded), "graded": graded, "still_pending": still_pending}


async def grade_all_sports() -> list[dict]:
    return [await grade_sport(app_sport) for app_sport in _SPORT_KEYS_BY_APP_SPORT]
