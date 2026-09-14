"""One season convention, for every sport — R2 (Python half).

The mirror of ``lib/sports/shared/season.ts``. Both files exist because both
languages genuinely need the rule: Python writes ``player_game_history``'s
``season`` column, TypeScript renders it, and a page that labels a season
differently from the job that stored it is the "mislabeled seasons" complaint.

``tests/config-drift.test.ts``'s convention applies — the two tables are
asserted identical by ``tests/season-convention.test.ts``, which parses both
files textually rather than importing either. Add a sport to both or neither.

THE CONVENTIONS ARE NOT A CHOICE. Each matches its own upstream's, so the
stored ``season`` integer lines up with what a live fetch would use. This is
the same table ``backfill_player_game_history.py``'s ``SCOPE`` encodes, lifted
out of it so it is readable without reading a backfill script:

    NBA    -> the year the season ENDS   (2026 == the 2025-26 season)
    NHL    -> the year the season STARTS (2025 == the 2025-26 season)
    NFL    -> STARTS
    CFB    -> STARTS
    EPL    -> STARTS
    MLS    -> calendar year
    MLB    -> calendar year
    tennis -> calendar year

DATE RANGES follow ``_sweep_bounds`` exactly: the end offset counts from the
season's START year, not from its label. Backwards, that puts the 2025-26 NBA
season's end in May 2027.

MLB and tennis have no range in ``SCOPE`` (it marks their sweep fields unused —
both are queried by season, not by date window), so the two ranges here are
this module's own and are deliberately generous at the edges: they decide
whether a date falls in a season, they never drive a fetch.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

# ESPN and every North American league file games against the US Eastern date.
# The TypeScript half uses the same zone for the same reason (R1d).
_TZ = ZoneInfo("America/New_York")

# SEASON_CONVENTIONS_START — parsed by tests/season-convention.test.ts
SEASON_CONVENTIONS: dict[str, dict] = {
    "mlb": {"label": "calendar", "start": (3, 1), "end": (0, 11, 30)},
    "nfl": {"label": "start", "start": (9, 1), "end": (1, 2, 20)},
    "cfb": {"label": "start", "start": (8, 15), "end": (1, 1, 20)},
    "nba": {"label": "end", "start": (10, 1), "end": (1, 5, 15)},
    "nhl": {"label": "start", "start": (9, 1), "end": (1, 6, 15)},
    "soccer_epl": {"label": "start", "start": (8, 1), "end": (1, 6, 5)},
    "soccer_mls": {"label": "calendar", "start": (2, 15), "end": (0, 12, 15)},
    "tennis_atp": {"label": "calendar", "start": (1, 1), "end": (0, 12, 31)},
    "tennis_wta": {"label": "calendar", "start": (1, 1), "end": (0, 12, 31)},
}
# SEASON_CONVENTIONS_END

# 30% of the observed maximum games played. MEASURED, not chosen:
# `player_game_history` carries 9 NBA "teams" that do not exist — ids 31/32 on
# 2024-02-19, 130579/130580/130581/130754 on 2025-02-17 and
# 111386/132374/132375 on 2026-02-15/16, 130 rows, every one on All-Star
# weekend. They are why the table reports 39 NBA teams instead of 30. A
# fraction of the observed max needs no maintenance every February and works
# for CFB's 245 programs as well as the NBA's 30; the gap it separates is a
# real team's ~244 game days against All-Star's 1, so it is not delicate.
REAL_TEAM_MIN_GAMES_FRACTION = 0.3


def _convention(sport: str) -> dict:
    try:
        return SEASON_CONVENTIONS[sport]
    except KeyError:
        raise ValueError(f'No season convention for sport "{sport}"') from None


def season_start_year(sport: str, season: int) -> int:
    """The calendar year a season begins in."""
    return season - 1 if _convention(sport)["label"] == "end" else season


def season_label(sport: str, season: int) -> str:
    """"2025-26" for a season spanning two calendar years, "2025" otherwise."""
    conv = _convention(sport)
    start_year = season_start_year(sport, season)
    end_year = start_year + conv["end"][0]
    if end_year == start_year:
        return str(start_year)
    return f"{start_year}-{str(end_year)[-2:]}"


def season_date_range(sport: str, season: int) -> tuple[date, date]:
    """Inclusive bounds for a season."""
    conv = _convention(sport)
    start_year = season_start_year(sport, season)
    sm, sd = conv["start"]
    yoff, em, ed = conv["end"]
    return date(start_year, sm, sd), date(start_year + yoff, em, ed)


def date_in_season(sport: str, season: int, when: date) -> bool:
    start, end = season_date_range(sport, season)
    return start <= when <= end


def season_for_date(sport: str, when: datetime | None = None) -> int:
    """The season a moment belongs to, read on the US Eastern date.

    Before a season's start date the current season is still the previous one:
    between seasons, the most recent real data is last season's.
    """
    conv = _convention(sport)
    today = (when or datetime.now(_TZ)).astimezone(_TZ).date()
    if conv["label"] == "calendar":
        return today.year
    sm, sd = conv["start"]
    started = (today.month, today.day) >= (sm, sd)
    start_year = today.year if started else today.year - 1
    return start_year + 1 if conv["label"] == "end" else start_year


def real_teams(rows: list[dict]) -> list[dict]:
    """Team-seasons that really played, from ``{"team_id", "games"}`` dicts.

    Drops the All-Star-type entries described on
    ``REAL_TEAM_MIN_GAMES_FRACTION``.
    """
    if not rows:
        return []
    biggest = max(r["games"] for r in rows)
    if biggest <= 0:
        return []
    floor = biggest * REAL_TEAM_MIN_GAMES_FRACTION
    return [r for r in rows if r["games"] >= floor]
