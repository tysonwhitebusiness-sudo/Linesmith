"""Phase 5.1 — MLB prop data layer: the market map and the ONE history loader.

THIS FILE IS WRITTEN BEFORE ANY MLB MODEL EXISTS, ON PURPOSE. Phase 4's most
expensive defect was that the walk-forward and the serving path built player
history from different sources — 18.8 games per player against 553.8, projections
disagreeing by a mean 0.38 shots, only 16% agreeing within 0.10. Both were
individually correct; only comparing them found it, and the fix forced a full
re-fit that flipped four of six verdicts. Here the single loader exists first and
both callers are written against it.

FOUR THINGS THE 5.1 AUDIT FOUND, none of which were in the plan:

1. THE MARKET NAMES CHANGED ON 2026-09-03, AND THE OLD ONES ARE GONE. There are
   two disjoint naming schemes in `prop_odds_archive`:

     historical  bookmaker NULL      1,244,476 rows  36 markets  2025-03-27 -> 2026-09-02
     live        bookmaker present      90,435 rows  18 markets  2026-09-03 -> 2026-09-06

   Zero overlap on (athlete, date) — the live feed began the day after the
   archive ended. A model fitted on "Total Hits" would match NOTHING going
   forward, because live rows are named "hits". The board would go blank at
   go-live and it would look like a broken model rather than a renamed market.
   `MARKETS` below carries both spellings for every market.

2. SINGLES MUST BE DERIVED. There is no `bat_singles` key — zero rows have one.
   Singles are hits minus doubles minus triples minus home runs. Exact, unlike
   NHL's Power Play Points (where the data held `powerPlayGoals` while the market
   settled goals + assists, so the computed outcome was not the settled one and
   the market could not be scored at all).

3. `pit_inningsPitched` IS BASEBALL NOTATION, NOT A DECIMAL. "1.2" means one
   inning and TWO OUTS — five outs — not 1.2 innings. Measured distribution
   confirms it: the only fractional parts present are .0, .1 and .2. Multiplying
   by three gives 3.6 instead of 5 and would silently corrupt every pitcher
   projection. `_OUTS_SQL` does the real conversion.

4. "Total Strikeouts" IS THE PITCHER MARKET. Resolved by line magnitude, since
   the name alone is ambiguous: mean line 4.78, against `pitcher-strikeouts` 4.92
   and `batter-strikeouts` 2.23. The batter market carries an explicit "(Batter)"
   suffix in the historical scheme.

EXCLUDED, WITH REASONS:
  - `points` (live, 1,234 rows, every line 0.5, from draftkings/betmgm/espnbet/
    caesars). Baseball has no "points" market. Unresolved provenance, so it is
    not guessed at.
  - `Total Walks (Batter)` (35,466 rows) is one-sided in practice: every line is
    exactly 0.5 and NOT ONE ROW carries both prices. It cannot be de-vigged and
    has no under side to score against. The live `walks` market is two-sided and
    is used instead.
  - All `* Milestones` markets — one-sided by construction, same as NHL.
  - `Baseball Player Prop` / `Baseball Team Prop` / `Baseball Game Prop` — generic
    provider buckets whose actual market is not identified by the row.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# `pit_inningsPitched` is stored the way a box score prints it: the digit after
# the point is a count of OUTS (0, 1 or 2), not a fraction of an inning. See
# finding 3 above.
_IP = "(stats->>'pit_inningsPitched')::float"
_OUTS_SQL = f"(floor({_IP}) * 3 + round(({_IP} - floor({_IP})) * 10))"

# Volume, the MLB analogue of ice time: what the rate gets multiplied by.
_BAT_VOLUME = "(stats->>'bat_plateAppearances')::float"
_PIT_VOLUME = _OUTS_SQL


@dataclass(frozen=True)
class MarketSpec:
    """One real market, under every name the archive has ever used for it."""

    slug: str
    label: str
    side: str                      # 'bat' | 'pit'
    stat_sql: str                  # settling stat, computed from the stats jsonb
    required_keys: tuple[str, ...]  # every jsonb key stat_sql reads
    names: tuple[str, ...]         # historical AND live spellings
    two_sided: bool = True
    note: str = ""

    @property
    def volume_sql(self) -> str:
        return _BAT_VOLUME if self.side == "bat" else _PIT_VOLUME

    @property
    def volume_key(self) -> str:
        return "bat_plateAppearances" if self.side == "bat" else "pit_inningsPitched"


def _bat(key: str) -> str:
    return f"(stats->>'{key}')::float"


MARKETS: list[MarketSpec] = [
    MarketSpec(
        slug="hits", label="Hits", side="bat",
        stat_sql=_bat("bat_hits"), required_keys=("bat_hits",),
        names=("Total Hits", "hits"),
    ),
    MarketSpec(
        slug="total-bases", label="Total bases", side="bat",
        stat_sql=_bat("bat_totalBases"), required_keys=("bat_totalBases",),
        names=("Total Bases", "total-bases"),
    ),
    MarketSpec(
        slug="rbis", label="RBIs", side="bat",
        stat_sql=_bat("bat_rbi"), required_keys=("bat_rbi",),
        names=("Total RBIs", "rbis"),
    ),
    MarketSpec(
        slug="runs", label="Runs scored", side="bat",
        stat_sql=_bat("bat_runs"), required_keys=("bat_runs",),
        names=("Total Runs Scored", "runs"),
    ),
    MarketSpec(
        slug="hits-runs-rbis", label="Hits + runs + RBIs", side="bat",
        stat_sql=f"({_bat('bat_hits')} + {_bat('bat_runs')} + {_bat('bat_rbi')})",
        required_keys=("bat_hits", "bat_runs", "bat_rbi"),
        names=("Total Hits + Runs + RBIs", "hits-runs-rbis"),
        note="A sum of three stored stats, so it settles exactly.",
    ),
    MarketSpec(
        slug="singles", label="Singles", side="bat",
        stat_sql=(f"({_bat('bat_hits')} - {_bat('bat_doubles')} "
                  f"- {_bat('bat_triples')} - {_bat('bat_homeRuns')})"),
        required_keys=("bat_hits", "bat_doubles", "bat_triples", "bat_homeRuns"),
        names=("Total Singles Hit", "singles"),
        note="DERIVED — there is no bat_singles key. Exact, not approximate.",
    ),
    MarketSpec(
        slug="doubles", label="Doubles", side="bat",
        stat_sql=_bat("bat_doubles"), required_keys=("bat_doubles",),
        names=("Total Doubles Hit", "doubles"),
    ),
    MarketSpec(
        slug="triples", label="Triples", side="bat",
        stat_sql=_bat("bat_triples"), required_keys=("bat_triples",),
        names=("triples",),
        note="Live scheme only — the historical archive never carried it.",
    ),
    MarketSpec(
        slug="home-runs", label="Home runs", side="bat",
        stat_sql=_bat("bat_homeRuns"), required_keys=("bat_homeRuns",),
        names=("Total Home Runs Hit", "home-runs"),
        note=("Historical coverage ENDS 2025-11-02, ten months before the rest of "
              "the archive. Real gap, not a filter artifact."),
    ),
    MarketSpec(
        slug="walks", label="Walks", side="bat",
        stat_sql=_bat("bat_baseOnBalls"), required_keys=("bat_baseOnBalls",),
        names=("walks",),
        note=("Live scheme only. The historical 'Total Walks (Batter)' is excluded: "
              "every line is 0.5 and no row carries both prices."),
    ),
    MarketSpec(
        slug="batter-strikeouts", label="Strikeouts (batter)", side="bat",
        stat_sql=_bat("bat_strikeOuts"), required_keys=("bat_strikeOuts",),
        names=("batter-strikeouts",),
    ),
    MarketSpec(
        slug="stolen-bases", label="Stolen bases", side="bat",
        stat_sql=_bat("bat_stolenBases"), required_keys=("bat_stolenBases",),
        names=("Total Stolen Bases", "stolen-bases"),
    ),
    MarketSpec(
        slug="pitcher-strikeouts", label="Strikeouts (pitcher)", side="pit",
        stat_sql=_bat("pit_strikeOuts"), required_keys=("pit_strikeOuts",),
        names=("Total Strikeouts", "pitcher-strikeouts"),
        note="'Total Strikeouts' resolved to the PITCHER market by line magnitude.",
    ),
    MarketSpec(
        slug="pitcher-hits-allowed", label="Hits allowed", side="pit",
        stat_sql=_bat("pit_hits"), required_keys=("pit_hits",),
        names=("Total Hits Allowed", "pitcher-hits-allowed"),
    ),
    MarketSpec(
        slug="pitcher-walks-allowed", label="Walks allowed", side="pit",
        stat_sql=_bat("pit_baseOnBalls"), required_keys=("pit_baseOnBalls",),
        names=("Total Walks Allowed", "pitcher-walks-allowed"),
    ),
    MarketSpec(
        slug="pitcher-outs", label="Outs recorded", side="pit",
        stat_sql=_OUTS_SQL, required_keys=("pit_inningsPitched",),
        names=("Total Outs Recorded", "pitcher-outs"),
        note="Outs, not innings — see finding 3.",
    ),
    MarketSpec(
        slug="earned-runs", label="Earned runs", side="pit",
        stat_sql=_bat("pit_earnedRuns"), required_keys=("pit_earnedRuns",),
        names=("Earned Runs Allowed", "earned-runs"),
    ),
]

BY_SLUG: dict[str, MarketSpec] = {m.slug: m for m in MARKETS}

# Markets deliberately NOT modelled, and why. Kept in code rather than in a
# commit message so the next person does not re-derive the same exclusions.
EXCLUDED: dict[str, str] = {
    "points": "baseball has no 'points' market; every line 0.5, provenance unresolved",
    "Total Walks (Batter)": "one-sided in practice — all lines 0.5, no row has both prices",
    "Baseball Player Prop": "generic provider bucket, actual market not identified by the row",
    "Baseball Team Prop": "team market, not a player prop",
    "Baseball Game Prop": "game market, not a player prop",
    "1st 5 Innings Run Line": "game market",
    "1st 5 Innings Total Runs": "game market",
    "Team Total Runs": "team market",
    "First Team to Score": "game market, one-sided",
    "1st Inning Team to Score": "game market, one-sided",
}


async def load_game_history(slug: str, conn=None) -> list[tuple]:
    """Every player-game for one market, as (game_date, athlete_id, stat, volume).

    THE ONE HISTORY SOURCE. Both the walk-forward and the serving path call this
    and nothing else, so the model that is measured is the model that is served.
    Phase 4 shipped a board whose projections differed from the validated ones by
    a mean 0.38 shots because that was not true there.

    Extraction happens in SQL, not by parsing 727,613 jsonb documents in Python:
    only four scalars per row are ever used. Rows missing the settling stat or
    the volume are dropped here rather than by each caller, so no caller can
    forget.
    """
    import db as _db

    spec = BY_SLUG[slug]
    has_keys = " AND ".join(f"stats ? '{k}'" for k in spec.required_keys)
    sql = f"""
        SELECT game_date, athlete_id,
               {spec.stat_sql} AS stat,
               {spec.volume_sql} AS volume
          FROM player_game_history
         WHERE sport = 'mlb'
           AND {has_keys}
           AND stats ? '{spec.volume_key}'
           AND {spec.volume_sql} > 0
         ORDER BY game_date, athlete_id
    """
    if conn is not None:
        raw = await conn.fetch(sql)
    else:
        pool = await _db.get_pool()
        async with pool.acquire(timeout=300.0) as c:
            raw = await c.fetch(sql)
    return [(r["game_date"], str(r["athlete_id"]), float(r["stat"]),
             float(r["volume"])) for r in raw]


def market_name_sql(slug: str) -> tuple[str, list[str]]:
    """`type_name` predicate covering every spelling of one market.

    Returns (sql_fragment, params). The fragment is `type_name = ANY($1)`, so a
    caller cannot accidentally match only the historical name and silently lose
    the live feed — which is the whole point of finding 1.
    """
    return "type_name = ANY($1)", [list(BY_SLUG[slug].names)]
