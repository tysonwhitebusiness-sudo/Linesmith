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


def shrunk_rate(player_events: float, player_minutes: float,
                league_rate: float, k: float = SHRINK_K) -> float:
    """Shots per minute, shrunk toward the league by sample size.

    The weight is on GAMES-worth of minutes rather than raw minutes, so that a
    player with many short appearances is not treated as more certain than one
    with a few long ones.
    """
    if player_minutes <= 0:
        return league_rate
    own = player_events / player_minutes
    games_equiv = player_minutes / 18.0        # 18 min ~ one regular's game
    w = games_equiv / (games_equiv + k)
    return w * own + (1.0 - w) * league_rate


def nb_prob_over(line: float, mean: float, dispersion: float) -> float:
    """P(X > line) for a negative binomial with the given mean.

    `dispersion` is the NB size parameter r: variance = mean + mean^2 / r, so a
    LARGE r approaches Poisson and a small r is heavily overdispersed. Shots are
    overdispersed because minutes and role vary between games, which a single
    Poisson rate cannot express.
    """
    if mean <= 0:
        return 0.0
    r = max(1e-6, dispersion)
    p = r / (r + mean)                          # P(success) in the NB param
    # P(X <= floor(line)) summed directly; lines are 0.5-steps so floor is exact.
    k_max = int(math.floor(line))
    if k_max < 0:
        return 1.0
    cum = 0.0
    term = p ** r                               # P(X = 0)
    cum += term
    for k in range(1, k_max + 1):
        term *= (r + k - 1) / k * (1.0 - p)
        cum += term
    return max(0.0, min(1.0, 1.0 - cum))


class PlayerHistory:
    """Running, strictly-before-only history for one player."""

    __slots__ = ("sog", "minutes", "games")

    def __init__(self):
        self.sog = 0.0
        self.minutes = 0.0
        self.games = 0

    def add(self, sog: float, minutes: float) -> None:
        self.sog += sog
        self.minutes += minutes
        self.games += 1

    def mean_toi(self, league_toi: float) -> float:
        return self.minutes / self.games if self.games else league_toi


@dataclass
class Projection:
    expected_sog: float
    projected_toi: float
    rate_per_min: float
    games_of_history: int


def project(hist: PlayerHistory, league_rate: float, league_toi: float,
            k: float = SHRINK_K) -> Projection:
    """Volume x rate. Shape is applied separately, at the line."""
    toi = hist.mean_toi(league_toi)
    rate = shrunk_rate(hist.sog, hist.minutes, league_rate, k)
    return Projection(expected_sog=toi * rate, projected_toi=toi,
                      rate_per_min=rate, games_of_history=hist.games)


# ---------------------------------------------------------------------------
# The loader. ONE place applies the crosswalk, the unambiguous date rule and the
# goalie filter, so 4.6 and 4.7 cannot drift apart on any of them.
# ---------------------------------------------------------------------------


async def load_shot_props(conn=None, market: str = "Total Shots on Goal") -> dict:
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
        if "sog" not in st or "toiMinutes" not in st:
            no_sog += 1
            continue
        rows.append(PropRow(
            played=r["played"], athlete_id=r["nhl_id"], espn_id=r["espn_id"],
            line=float(r["line"]),
            over_price=r["over_price"], under_price=r["under_price"],
            open_over=r["open_over_price"], open_under=r["open_under_price"],
            bookmaker=r["bookmaker"] or "",
            actual_sog=int(st["sog"]), toi=float(st["toiMinutes"])))
    rows.sort(key=lambda x: (x.played, x.athlete_id))
    return {"rows": rows,
            "stats": {"joined": len(raw), "goalies_dropped": goalies,
                      "missing_stats": no_sog, "usable": len(rows)}}
