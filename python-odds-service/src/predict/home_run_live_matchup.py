"""Direct port of lib/sports/mlb/homeRunLiveMatchup.ts — not a
reimplementation.

Home Run model's live pitcher-matchup lookup — the active model (see
home_run_model_fit.py) was fit using a real team-level HR-rate-allowed
signal; this closes the live-wiring gap so predict/prop_candidates.py's
home-run blend can feed it a real signal instead of a hardcoded neutral.

Same shape as park_factors.py: an expensive `refresh_*` computation
(pulls every qualified batter's current-season game log — the same pull
home_run_model_fit.py's training builder does), persisted to Postgres,
and a cheap `load_*_cache` read for the live request path. Never
recomputed per-request — that would mean re-running the full qualified-
batter pull on every snapshot build.
"""
from dataclasses import dataclass

import httpx

import db
from predict.home_run_model_fit import compute_league_and_team_hr_rates

# Same thin-sample guard as the training builder's team_hr_rate_allowed
# (LeagueAndTeamHrRates.team_hr_rate_allowed) — must match exactly, since
# this cache is read against a fitted weight learned under that exact guard.
MIN_GAMES_FACED_FOR_TEAM_RATE = 10

FALLBACK_LEAGUE_HR_RATE = 0.11


async def refresh_team_hr_rate_allowed(client: httpx.AsyncClient, season: int) -> None:
    """Recomputes this season's team HR-rate-allowed from live MLB data
    and persists it. Expensive — pulls the full qualified-batter pool's
    game logs, same cost as a training-row build for one season. Call
    this periodically (e.g. once a day), not per-request."""
    rates = await compute_league_and_team_hr_rates(client, season)
    team_ids = set(rates.team_games_faced.keys()) | set(rates.team_games_with_hr_allowed.keys())
    rows = [
        db.TeamHrRateAllowedRow(
            team_id=team_id,
            season=season,
            games_faced=rates.team_games_faced.get(team_id, 0),
            games_with_hr_allowed=rates.team_games_with_hr_allowed.get(team_id, 0),
            league_hr_rate=rates.league_hr_rate,
            computed_at="",
        )
        for team_id in team_ids
    ]
    await db.write_team_hr_rate_allowed(season, rates.league_hr_rate, rows)


@dataclass
class TeamHrRateAllowedCache:
    league_hr_rate: float
    _by_team: dict[int, db.TeamHrRateAllowedRow]

    def rate_for(self, team_id: int | None) -> float:
        """Already resolved to the fallback league rate for any team
        below the trust floor, or missing entirely — a caller just calls
        this, no guard logic needed at the call site."""
        if team_id is None:
            return self.league_hr_rate
        row = self._by_team.get(team_id)
        if row is None or row.games_faced < MIN_GAMES_FACED_FOR_TEAM_RATE:
            return self.league_hr_rate
        return row.games_with_hr_allowed / row.games_faced


async def load_team_hr_rate_allowed_cache(season: int) -> TeamHrRateAllowedCache:
    """Live-path lookup, read once per snapshot build rather than per
    candidate — same pattern as park_factors.py's load path. Falls back
    to a fixed neutral league rate (not 0 — home_run_model.py's
    pitcher_matchup_signal's log-odds baseline is the league rate, not
    zero) when the cache has never been refreshed for this season yet."""
    rows = await db.read_team_hr_rate_allowed(season)
    if not rows:
        return TeamHrRateAllowedCache(league_hr_rate=FALLBACK_LEAGUE_HR_RATE, _by_team={})
    league_hr_rate = rows[0].league_hr_rate
    by_team = {r.team_id: r for r in rows}
    return TeamHrRateAllowedCache(league_hr_rate=league_hr_rate, _by_team=by_team)
