"""Phase 4.5 — the NHL prop engine: volume x rate x shape.

THE MODEL, in the order the ingredients matter:

  VOLUME — projected time on ice. This is most of the answer: a player who takes
  2.5 shots in 18 minutes takes ~1.4 in 10. `toiMinutes` is present on 100% of
  724,002 rows, which is why NHL is the right sport to build the first prop
  model in.

  RATE — shots per minute, from the player's own history, SHRUNK toward the
  league mean by a sample-size weight. Without shrinkage a fourth-liner with two
  games carries a superstar's rate off one good night; the weight n/(n+k) makes
  a short history defer to the league and a long one stand on its own.

  SHAPE — turning an expectation into P(over the line). Shots are OVERDISPERSED
  relative to Poisson (a player's minutes and role vary game to game, so the
  variance exceeds the mean), so a negative binomial is used and its dispersion
  is fitted rather than assumed.

THE JOIN IS THE HARD PART, AND THE PLAN'S DESCRIPTION OF IT WAS INCOMPLETE.

It says NHL props join `player_game_history` at -1 day and that joining at zero
silently loses 35%. Both halves are true and neither is sufficient, because
THERE IS NO DIRECT JOIN AT ALL:

  prop_odds_archive.athlete_id   is an ESPN id      ('2273')
  player_game_history.athlete_id is an NHL API id   ('8470621')

Measured 2026-09-04: at every date offset from -2 to +2, a direct join returns
ZERO rows. `athlete_crosswalk` is the bridge and resolves 864 of 885 prop
athletes (97.6%), and `prop_odds_archive.athlete_name` is NULL for every NHL row
so there is no name fallback.

Only THEN does the date question arise, and the plan's -1 is confirmed: 4,169
rows (52.7%) at -1 against 2,709 (34.2%) at 0 — a 35% loss, exactly as warned.

BUT A FIXED OFFSET IS NOT THE BEST RULE. Measured over the 7,863 resolvable
rows:

    game on BOTH -1 and 0 (ambiguous)   761   9.7%
    only -1                           3,408  43.3%
    only  0                           1,948  24.8%
    NEITHER (player did not play)     1,746  22.2%

So an UNAMBIGUOUS rule — take -1 where only -1 exists, 0 where only 0 exists,
drop where both do — yields 5,356 usable rows (68.1%) against a fixed offset's
4,169. The 9.7% ambiguous are dropped rather than guessed: an NHL player plays
every ~2 days, so picking one of two adjacent games would silently attach the
wrong outcome, which is worse than a smaller sample.

The 22.2% who did not play are not a defect. A prop is posted before the lineup
is known; a scratched player has no shot count, so there is no outcome to score
either way.

WHY NOT AN EXACT JOIN. `prop_odds_archive.event_ref` matches
`game_result.event_ref` on 100% of rows, and `player_game_history` carries an
`event_id` — but that column is the NHL API's game id (`2025021311`) while
event_ref is ESPN's (`401801798`). **There is no game-id crosswalk in this
database**, only an athlete one. The same gap blocked Phase 4.3's overtime
measurement. Building one is the single highest-value piece of plumbing this
sport is missing.

GOALIES ARE EXCLUDED. They sit in the same table flagged `isGoalie`, carrying
`saves`/`shotsAgainst` where skaters carry `sog`. A goalie's `sog` is not a shot
he took.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

from predict import count_prop_engine as _engine
from predict.count_prop_engine import (  # re-exported under NHL's names: see the note below
    PlayerHistory,
    Projection,
    nb_prob_over,
)

# Shrinkage strength: the number of prior games at which a player's own rate and
# the league mean carry equal weight. 10 is roughly an eighth of a season —
# enough that a regular stands on his own record by midseason, while a callup
# with three games still defers to the league.
SHRINK_K = 10.0

# Fallback league shots-per-minute, used only before any history exists.
LEAGUE_SOG_PER_MIN = 0.13


@dataclass
class PropRow:
    played: date
    athlete_id: str          # NHL API id, the player_game_history space
    espn_id: str             # ESPN id, the prop_odds_archive space
    line: float
    over_price: float | None
    under_price: float | None
    open_over: float | None
    open_under: float | None
    bookmaker: str
    actual_sog: int
    toi: float


# ---------------------------------------------------------------------------
# THE MATH LIVES IN count_prop_engine.py. Phase 1.2 of
# docs/master-plan-2026-09-06.md (2026-09-06).
#
# This file grew the engine first, and 5.3 extracted it so MLB could share it
# rather than get a second copy. That left NHL running the original and MLB the
# extraction — two implementations of one model, which is exactly the state the
# extraction existed to prevent. `test_count_prop_engine.py` asserted they
# agreed, and it passed, which is the good case; the bad case is the one where
# it stops passing and somebody picks a winner under time pressure.
#
# So the duplicate is gone. `PlayerHistory`, `Projection`, `project`,
# `shrunk_rate` and `nb_prob_over` are re-exported from the engine below under
# the names this file's callers already use, and the NHL-specific constant that
# was hard-coded in the old `shrunk_rate` — 18 minutes as one regular's game —
# is now passed in as `volume_per_game`, which is what it always was.
#
# WHAT CHANGED NUMERICALLY: nothing that any caller can reach.
#   - `shrunk_rate`/`project`/`PlayerHistory` were bit-identical already, and
#     `nhl_props_golden.json` pins 1,500 pre-migration projections that the
#     engine still reproduces exactly (test_nhl_props.py).
#   - `nb_prob_over` differs by at most 2.72e-6, and only at the Poisson limit,
#     where the engine takes the exact limit and this file evaluated the NB at a
#     very large r. Four orders of magnitude below the fit's gate tolerance, and
#     the 1,200 pinned probabilities in the same golden file bound it.
#   - The engine's recent-volume buffer holds 200 entries where this file held
#     40. Unreachable here: TOI_WINDOWS tops out at 40, so both take the same
#     last-40 slice, and window=0 reads the running totals rather than the
#     buffer at all.
# ---------------------------------------------------------------------------

# 18 min ~ one regular's game. Converts minutes into games-equivalent so that
# SHRINK_K is a number of GAMES rather than of minutes — see the engine's
# `shrunk_rate` docstring for why that distinction is load-bearing across
# sports.
MINUTES_PER_GAME = 18.0


def shrunk_rate(player_events: float, player_minutes: float,
                league_rate: float, k: float = SHRINK_K) -> float:
    """Shots per minute, shrunk toward the league by sample size. NHL's binding
    of the shared engine's `shrunk_rate`."""
    return _engine.shrunk_rate(player_events, player_minutes, league_rate, k,
                               MINUTES_PER_GAME)


def project(hist: PlayerHistory, league_rate: float, league_toi: float,
            k: float = SHRINK_K, toi_window: int = 0) -> Projection:
    """Volume x rate, with NHL's minutes-per-game binding. Shape is applied
    separately, at the line."""
    return _engine.project(hist, league_rate, league_toi, k=k,
                           volume_window=toi_window,
                           volume_per_game=MINUTES_PER_GAME)


# ---------------------------------------------------------------------------
# The loader. ONE place applies the crosswalk, the unambiguous date rule and the
# goalie filter, so 4.6 and 4.7 cannot drift apart on any of them.
# ---------------------------------------------------------------------------


# market -> the player_game_history stat that settles it. Phase 4.8.
#
# Total Power Play Points is DELIBERATELY MAPPED TO AN INCOMPLETE STAT. The
# market settles on power-play goals PLUS power-play assists; the data carries
# only `powerPlayGoals`. Assists are roughly two thirds of all points, so this
# projection is structurally low and cannot be fixed by tuning. It is included so
# the size of that bias is measured rather than assumed, and it must not ship.
MARKET_STAT = {
    "Total Shots on Goal": "sog",
    "Total Points": "points",
    "Total Assists": "assists",
    "Total Goals": "goals",
    "Total Blocked Shots": "blockedShots",
    "Total Hits": "hits",
    "Total Power Play Points": "powerPlayGoals",     # incomplete, see above
}


async def load_shot_props(conn=None, market: str = "Total Shots on Goal",
                          stat_key: str | None = None) -> dict:
    """Prop rows joined to the player's actual outcome.

    Returns {"rows": [PropRow], "stats": {...}} — the stats are counted, not
    estimated, because a join that silently loses rows is the failure this whole
    module is written around.
    """
    import db as _db

    sql = """
        WITH resolved AS (
            SELECT p.id, p.game_date, p.athlete_id AS espn_id, x.athlete_id AS nhl_id,
                   p.line, p.over_price, p.under_price,
                   p.open_over_price, p.open_under_price, p.bookmaker
              FROM prop_odds_archive p
              JOIN athlete_crosswalk x
                ON x.sport = 'nhl' AND x.espn_athlete_id = p.athlete_id
             WHERE p.sport = 'nhl' AND p.type_name = $1 AND p.line IS NOT NULL
        ),
        cand AS (
            SELECT r.*,
                   MAX(CASE WHEN g.game_date = r.game_date - 1 THEN 1 ELSE 0 END) AS has_m1,
                   MAX(CASE WHEN g.game_date = r.game_date     THEN 1 ELSE 0 END) AS has_0
              FROM resolved r
              LEFT JOIN player_game_history g
                ON g.sport = 'nhl' AND g.athlete_id = r.nhl_id
               AND g.game_date BETWEEN r.game_date - 1 AND r.game_date
             GROUP BY r.id, r.game_date, r.espn_id, r.nhl_id, r.line, r.over_price,
                      r.under_price, r.open_over_price, r.open_under_price, r.bookmaker
        )
        SELECT c.*, g.game_date AS played, g.stats
          FROM cand c
          JOIN player_game_history g
            ON g.sport = 'nhl' AND g.athlete_id = c.nhl_id
           AND g.game_date = c.game_date - (CASE WHEN c.has_m1 = 1 THEN 1 ELSE 0 END)
         WHERE NOT (c.has_m1 = 1 AND c.has_0 = 1)      -- ambiguous: drop, never guess
    """
    if conn is not None:
        raw = await conn.fetch(sql, market)
    else:
        pool = await _db.get_pool()
        async with pool.acquire(timeout=60.0) as c:
            raw = await c.fetch(sql, market)

    rows, goalies, no_sog = [], 0, 0
    for r in raw:
        st = r["stats"] or {}
        if isinstance(st, str):
            import json
            st = json.loads(st or "{}")
        if st.get("isGoalie"):
            goalies += 1                 # a goalie's sog is not a shot he took
            continue
        key = stat_key or MARKET_STAT.get(market, "sog")
        if key not in st or "toiMinutes" not in st:
            no_sog += 1
            continue
        rows.append(PropRow(
            played=r["played"], athlete_id=r["nhl_id"], espn_id=r["espn_id"],
            line=float(r["line"]),
            over_price=r["over_price"], under_price=r["under_price"],
            open_over=r["open_over_price"], open_under=r["open_under_price"],
            bookmaker=r["bookmaker"] or "",
            actual_sog=int(st[key]), toi=float(st["toiMinutes"])))
    rows.sort(key=lambda x: (x.played, x.athlete_id))
    return {"rows": rows,
            "stats": {"joined": len(raw), "goalies_dropped": goalies,
                      "missing_stats": no_sog, "usable": len(rows)}}


async def load_game_history(stat_key: str = "sog", conn=None) -> list[tuple]:
    """Every skater game, as (game_date, athlete_id, stat, toi), date-ordered.

    THE WALK-FORWARD AND THE SERVING PATH MUST BUILD HISTORY THE SAME WAY, and
    before this existed they did not. `fit_nhl_props_all.walk()` accumulated a
    player's history from the PROP ROWS it was scoring — so a player carried
    only the games that happened to have a prop line. `nhl_prop_serving.build`
    accumulates from every row of `player_game_history`.

    Measured on 2026-01-14 before this was fixed: serving saw 29.5x more history
    (553.8 games per player against 18.8), and the two constructions disagreed by
    a mean 0.38 shots on the same player, same date, same constants — with only
    16% of players agreeing within 0.10. The gate was therefore passed by one
    model and the board was showing another.

    Extraction happens in SQL rather than by parsing 683k jsonb blobs in Python:
    only four scalars per row are ever used, and pulling the whole document to
    read two fields is what makes this loader slow enough to discourage using it.
    """
    import db as _db

    sql = f"""
        SELECT game_date, athlete_id,
               (stats->>'{stat_key}')::float AS stat,
               (stats->>'toiMinutes')::float AS toi
          FROM player_game_history
         WHERE sport = 'nhl'
           AND NOT (stats ? 'isGoalie')
           AND stats ? 'toiMinutes'
           AND stats ? '{stat_key}'
         ORDER BY game_date, athlete_id
    """
    if conn is not None:
        raw = await conn.fetch(sql)
    else:
        pool = await _db.get_pool()
        async with pool.acquire(timeout=180.0) as c:
            raw = await c.fetch(sql)
    return [(r["game_date"], str(r["athlete_id"]), r["stat"], r["toi"]) for r in raw]
