"""Season-aggregate league/opponent home-run rates, shared by the live
matchup cache (home_run_live_matchup.py).

This file used to also carry the historical training-row builder and the
`fit_home_run_weights` walk-forward fit (a direct port of
lib/sports/mlb/homeRunModelFit.ts). Removed 2026-09-23 as dead code — zero
real callers anywhere in this repo for `build_home_run_season_rows`,
`build_home_run_training_set`, `fit_home_run_weights`, or the Python-side
`current_season()` (the live one is `homeRunModelFit.ts`'s own TS version,
called from `app/api/mlb/refresh-hr-matchup/route.ts` and
`app/api/props/fit-home-run-weights/route.ts` — a separate implementation,
not this file). What's kept below is exactly what
`home_run_live_matchup.py` actually imports.
"""
from dataclasses import dataclass, field

import httpx

from predict import statsapi


def _num(v) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    return f if f == f else 0.0


@dataclass
class LeagueAndTeamHrRates:
    league_hr_rate: float
    # team_id -> games faced / games with an opponent HR, both real counts
    # (not just the rate) so a caller can see sample size before trusting
    # a thin one.
    team_games_faced: dict[int, int] = field(default_factory=dict)
    team_games_with_hr_allowed: dict[int, int] = field(default_factory=dict)

    def team_hr_rate_allowed(self, team_id: int | None) -> float:
        if team_id is None:
            return self.league_hr_rate
        faced = self.team_games_faced.get(team_id, 0)
        if faced < 10:  # thin sample against one team this season — neutral rather than noisy
            return self.league_hr_rate
        return self.team_games_with_hr_allowed.get(team_id, 0) / faced


def aggregate_league_and_team_hr_rates(logs_by_id: dict[int, statsapi.PersonStats]) -> LeagueAndTeamHrRates:
    """Season-aggregate league HR rate and each team's opponent-batter-
    games HR rate — pure aggregation over already-fetched game logs,
    pulled out as its own function so this stays the single source both
    the live lookup and (formerly) the training builder shared identical
    math from their own independently-fetched log pools."""
    league_games = 0
    league_games_with_hr = 0
    team_games_faced: dict[int, int] = {}
    team_games_with_hr_allowed: dict[int, int] = {}

    for person in logs_by_id.values():
        for g in person.game_log:
            pa = _num((g.stat or {}).get("plateAppearances"))
            if pa <= 0:
                continue  # no real plate appearance this game — nothing to grade
            had_hr = 1 if _num((g.stat or {}).get("homeRuns")) >= 1 else 0
            league_games += 1
            league_games_with_hr += had_hr
            if g.opponent_id is not None:
                team_games_faced[g.opponent_id] = team_games_faced.get(g.opponent_id, 0) + 1
                if had_hr:
                    team_games_with_hr_allowed[g.opponent_id] = team_games_with_hr_allowed.get(g.opponent_id, 0) + 1

    # Fallback matches the neutral-rate spirit used throughout — only hit
    # if a season somehow returns zero usable rows.
    league_hr_rate = league_games_with_hr / league_games if league_games > 0 else 0.11
    return LeagueAndTeamHrRates(league_hr_rate=league_hr_rate, team_games_faced=team_games_faced, team_games_with_hr_allowed=team_games_with_hr_allowed)


async def compute_league_and_team_hr_rates(client: httpx.AsyncClient, season: int) -> LeagueAndTeamHrRates:
    """Fetches the current qualified-batter pool and their game logs, then
    aggregates — the standalone entry point for anything that just wants
    this season's rates (see home_run_live_matchup.py)."""
    batter_pool = await statsapi.get_league_batter_season_rows(client, season)
    batter_ids = [b.person_id for b in batter_pool]
    logs_by_id = await statsapi.get_people_with_game_logs(client, batter_ids, "hitting", season)
    return aggregate_league_and_team_hr_rates(logs_by_id)
