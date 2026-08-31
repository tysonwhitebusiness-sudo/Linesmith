"""Venue scoring factors for the sports that are not baseball — Phase 6.10.

============ WHY THE HOME TEAM IS THE VENUE ============

`park_factors` is keyed by a real MLB venue id. Nothing else can be: measured
2026-08-31, a tree-wide scan for a venue column found exactly two in the whole
database and both are on `park_factors` itself. **No other sport stores a venue
per historical game.**

What every sport does store is `player_game_history.is_home`, and in every
league except baseball a team plays its home games in one building for a
season. So the home team identifies the venue, which is why this writes
`venue_factors` (keyed by team) rather than adding a `sport` column to a table
whose key it could not fill.

============ THE FACTOR ============

    factor = (scoring per game in this team's HOME games)
             / (scoring per game in this team's AWAY games)

Both totals count BOTH teams' scoring. That is what makes it a statement about
the building rather than about the home side: the same team appears in the
numerator and the denominator, so its own quality largely cancels. A factor of
1.10 means the venue produced ten percent more scoring than that team's road
games did.

============ WHAT IT IS NOT ============

It is a season-level number off a few dozen games per side, so it is noisy, and
`home_games`/`away_games` are stored beside it so a reader can decline to show
one. It also cannot separate a genuine venue effect (altitude, a fast rink)
from ordinary home advantage — refereeing, travel, rest all sit inside it. The
honest name for what this measures is "how much more scoring happens when this
team is at home", and the card that renders it should say that rather than
imply a stadium-physics claim.

`SPORT_STATS` is deliberately narrow. A stat only earns a row if it is the
thing that venue plausibly moves and it is dense in the table: NBA points, NHL
goals, soccer goals, CFB/NFL passing yards. Cards, fouls and turnovers are
left out rather than ranked under a venue theory nobody has tested.
"""

from __future__ import annotations

from datetime import datetime, timezone

import db

# (sport, stat_key, minimum games per side before a factor is written).
# The floors are per-sport because the seasons are: an NBA team plays 41 home
# games and a CFB team plays six or seven, so one number would either exclude
# college football entirely or admit basketball noise.
SPORT_STATS: list[tuple[str, str, int]] = [
    ("nba", "points", 20),
    ("nhl", "goals", 20),
    ("soccer_epl", "totalGoals", 12),
    ("soccer_mls", "totalGoals", 12),
    ("cfb", "passing.passingYards", 4),
    ("nfl", "passing.passingYards", 5),
]


async def compute_for_sport(sport: str, stat_key: str, min_games: int, season: int | None = None) -> list[dict]:
    """One sport-season's factors, as rows ready for the writer.

    ONE QUERY, TWO GROUPING LEVELS. The inner level collapses a game to its two
    team-rows so `both_teams` is the total scoring in that game; the outer
    level splits a team's games by venue. Doing it in SQL keeps the whole
    season out of Python memory, which matters for CFB's 231 teams.

    `season` defaults to the newest the sport has. A season that has barely
    started produces no rows at all rather than a factor off two games, because
    every team falls under `min_games` — the same shape of guard
    `computeSeasonAggregates` needed for exactly the same reason.
    """
    pool = await db.get_pool()

    if season is None:
        season = await pool.fetchval(
            "SELECT max(season) FROM player_game_history WHERE sport = $1", sport
        )
        if season is None:
            return []

    rows = await pool.fetch(
        """
        WITH team_game AS (
            SELECT team_id, event_id, bool_or(is_home) AS is_home,
                   SUM((stats->>$3)::numeric) AS pts
              FROM player_game_history
             WHERE sport = $1 AND season = $2
               AND team_id IS NOT NULL AND is_home IS NOT NULL
             GROUP BY team_id, event_id
        ),
        game_total AS (
            SELECT event_id, SUM(pts) AS both_teams
              FROM team_game GROUP BY event_id
        )
        SELECT tg.team_id,
               COUNT(*) FILTER (WHERE tg.is_home)                        AS home_games,
               COUNT(*) FILTER (WHERE NOT tg.is_home)                    AS away_games,
               AVG(gt.both_teams) FILTER (WHERE tg.is_home)              AS home_rate,
               AVG(gt.both_teams) FILTER (WHERE NOT tg.is_home)          AS away_rate
          FROM team_game tg
          JOIN game_total gt ON gt.event_id = tg.event_id
         GROUP BY tg.team_id
        """,
        sport,
        season,
        stat_key,
    )

    out: list[dict] = []
    for r in rows:
        home_games = int(r["home_games"] or 0)
        away_games = int(r["away_games"] or 0)
        if home_games < min_games or away_games < min_games:
            continue
        home_rate = float(r["home_rate"] or 0)
        away_rate = float(r["away_rate"] or 0)
        # A zero road rate makes the ratio meaningless rather than infinite.
        # It happens when a stat key is absent for a sport, which is a data
        # problem worth skipping loudly rather than storing as a huge factor.
        if away_rate <= 0 or home_rate <= 0:
            continue
        out.append(
            {
                "sport": sport,
                "team_id": str(r["team_id"]),
                "season": int(season),
                "stat_key": stat_key,
                "factor": home_rate / away_rate,
                "home_rate": home_rate,
                "away_rate": away_rate,
                "home_games": home_games,
                "away_games": away_games,
            }
        )
    return out


async def write_venue_factors(rows: list[dict]) -> int:
    """Upsert on the full key, so a re-run mid-season updates rather than duplicates."""
    if not rows:
        return 0
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO venue_factors
                (sport, team_id, season, stat_key, factor, home_rate, away_rate,
                 home_games, away_games, computed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (sport, team_id, season, stat_key) DO UPDATE SET
                factor      = excluded.factor,
                home_rate   = excluded.home_rate,
                away_rate   = excluded.away_rate,
                home_games  = excluded.home_games,
                away_games  = excluded.away_games,
                computed_at = excluded.computed_at
            """,
            [
                (
                    r["sport"], r["team_id"], r["season"], r["stat_key"],
                    r["factor"], r["home_rate"], r["away_rate"],
                    r["home_games"], r["away_games"],
                    datetime.now(timezone.utc),
                )
                for r in rows
            ],
        )
    return len(rows)


# How many seasons back to look when the newest one has no qualifying team.
#
# I PREDICTED THIS IN THIS FILE'S OWN DOCSTRING AND THEN DID NOT IMPLEMENT IT.
# The first run wrote 94 rows for NBA, NHL and NFL and **zero** for soccer and
# CFB, because `max(season)` is 2026 for those and that season holds 8 to 15
# events -- so every team fell under `min_games` and the sport silently produced
# nothing. It is the identical trap `computeSeasonAggregates` needed a walk-back
# for, on the identical three sports.
SEASON_FALLBACK_ATTEMPTS = 2


async def refresh_all() -> dict:
    """Every configured sport-stat pair. Returns the summary `_run_timed` expects.

    WALKS BACK ONLY ON AN EMPTY RESULT, never speculatively: a sport in
    mid-season resolves on the first attempt and pays nothing extra, and only a
    sport whose newest season is a stub costs a second query.
    """
    pool = await db.get_pool()
    written = 0
    per_sport: dict[str, int] = {}
    seasons_used: dict[str, int | None] = {}

    for sport, stat_key, min_games in SPORT_STATS:
        latest = await pool.fetchval(
            "SELECT max(season) FROM player_game_history WHERE sport = $1", sport
        )
        rows: list[dict] = []
        used: int | None = None
        if latest is not None:
            for back in range(SEASON_FALLBACK_ATTEMPTS + 1):
                candidate = int(latest) - back
                rows = await compute_for_sport(sport, stat_key, min_games, season=candidate)
                if rows:
                    used = candidate
                    break
        n = await write_venue_factors(rows)
        written += n
        per_sport[f"{sport}:{stat_key}"] = n
        seasons_used[f"{sport}:{stat_key}"] = used

    return {"venue_factors_written": written, "per_sport": per_sport, "seasons": seasons_used}
