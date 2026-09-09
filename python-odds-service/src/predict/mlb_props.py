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
    # Names whose line is a MILESTONE: an integer L meaning "L or more", not a
    # half-integer meaning "more than L". They are kept apart from `names`
    # because they need the off-by-one conversion in `load_props` and folding
    # them in would silently shift every one of their rows by a full unit.
    #
    # Measured on `Home Runs Milestones` (2026-09-07, n=31,238 joined):
    #     P(hr >= line)  = 0.1119     <- the correct reading
    #     P(hr >  line)  = 0.0069     <- what treating it as a normal line gives
    # against `Total Home Runs Hit` at its real 0.5 line, P(hr > 0.5) = 0.1170.
    # 0.1119 vs 0.1170 is the same event; 0.0069 is "two or more home runs".
    # The same trap is recorded for NFL in the master plan's Phase 6.
    milestone_names: tuple[str, ...] = ()
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
        milestone_names=("Home Runs Milestones",),
        note=("Three schemes, and the gap between them is only apparent. "
              "'Total Home Runs Hit' really does end 2025-11-02 and 'home-runs' "
              "(the live feed) starts 2026-09-03 — after player_game_history's "
              "last outcome — so on those two alone the market has NO held-out "
              "rows and Phase 3.2 was recorded as untestable. "
              "'Home Runs Milestones' covers 2026-04-11..2026-09-02, 37,252 rows, "
              "and was excluded only because nothing read its integer lines. "
              "See `milestone_names`."),
    ),
    MarketSpec(
        slug="walks", label="Walks", side="bat",
        stat_sql=_bat("bat_baseOnBalls"), required_keys=("bat_baseOnBalls",),
        names=("walks",),
        milestone_names=("Walks (Batter) Milestones",),
        note=("NOT FITTABLE, and the old reason here was the wrong one. It said "
              "'Total Walks (Batter)' was excluded for carrying no prices — true, "
              "but beside the point: that scheme is 2026-only (34,534 usable rows, "
              "all after the 2026-01-01 cutoff), as is 'Walks (Batter) Milestones' "
              "(35,090) and the live 'walks' feed. The market has 69,624 usable "
              "HELD-OUT rows and ZERO SELECT-era rows, so there is nothing to train "
              "on. Prices stopped mattering once Phase 3.0 moved calibration to the "
              "board line — the stats bar never reads one. The milestone name is "
              "declared here so this is ready the moment a pre-2026 source appears."),
    ),
    MarketSpec(
        slug="batter-strikeouts", label="Strikeouts (batter)", side="bat",
        stat_sql=_bat("bat_strikeOuts"), required_keys=("bat_strikeOuts",),
        names=("batter-strikeouts",),
        milestone_names=("Strikeouts (Batter) Milestones",),
    ),
    MarketSpec(
        slug="stolen-bases", label="Stolen bases", side="bat",
        stat_sql=_bat("bat_stolenBases"), required_keys=("bat_stolenBases",),
        names=("Total Stolen Bases", "stolen-bases"),
        milestone_names=("Stolen Bases Milestones",),
    ),
    MarketSpec(
        slug="pitcher-strikeouts", label="Strikeouts (pitcher)", side="pit",
        stat_sql=_bat("pit_strikeOuts"), required_keys=("pit_strikeOuts",),
        names=("Total Strikeouts", "pitcher-strikeouts"),
        milestone_names=("Strikeouts Thrown Milestones",),
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
    """
    if conn is not None:
        raw = await conn.fetch(sql)
    else:
        pool = await _db.get_pool()
        async with pool.acquire(timeout=300.0) as c:
            raw = await c.fetch(sql)
    # Sorted in Python: ordering 425k rows in Postgres spills to temp disk, and
    # the database has under 2 GB of headroom. See fit_mlb_props.load_props.
    out = [(r["game_date"], str(r["athlete_id"]), float(r["stat"]),
            float(r["volume"])) for r in raw]
    out.sort(key=lambda t: (t[0], t[1]))
    return out


def market_name_sql(slug: str) -> tuple[str, list[str]]:
    """`type_name` predicate covering every spelling of one market.

    Returns (sql_fragment, params). The fragment is `type_name = ANY($1)`, so a
    caller cannot accidentally match only the historical name and silently lose
    the live feed — which is the whole point of finding 1.
    """
    return "type_name = ANY($1)", [list(BY_SLUG[slug].names)]


# ---------------------------------------------------------------------------
# Phase 5.2 — resolving a prop row's athlete to the id player_game_history uses.
# ---------------------------------------------------------------------------

# `prop_odds_archive.athlete_id` HOLDS TWO DIFFERENT ID SPACES IN ONE COLUMN,
# split by the same 2026-09-03 cutover that renamed the markets:
#
#   historical (bookmaker NULL)  ESPN athlete ids     1,172 ids, length 4-7
#   live       (bookmaker set)   MLB StatsAPI ids       404 ids, length 6,
#                                                       range 453,286-815,873
#
# `build_athlete_crosswalk.py` assumes every id in this column is an ESPN id —
# true when it was written, and the reason it resolves 1,160 of 1,576 and stalls
# there. Its own log shows the bottleneck is upstream of matching: "espn
# metadata: 1162 resolved" out of 1,576, because ESPN has no athlete page for an
# MLB StatsAPI id. The 404 unresolved are not unmatched, they are in the other
# space.
#
# THE TWO SPACES ARE PROVABLY DISJOINT, which is what makes a COALESCE safe
# rather than a guess:
#
#   ids valid as an ESPN id for one player AND an MLB id for another        0
#   historical ids valid as ESPN 1,160 / valid as MLB                       0
#   live ids valid as ESPN           0 / valid as MLB                     398
#
# So an id can be tried as ESPN, then as MLB, and cannot be silently wrong.
#
# WHY THE DATE TEST CANNOT ADJUDICATE THIS. `player_game_history` for MLB ends
# 2026-08-28; the live feed spans 2026-09-03 to 2026-09-06. There is no overlap,
# so a date join is IMPOSSIBLE here, not failed — exactly the situation
# build_athlete_crosswalk.py documents for NHL. The evidence is instead the
# disjointness above plus direct name agreement: the live ids resolve through
# `athlete_crosswalk.athlete_id` to Max Scherzer (453286), Jose Altuve (514888)
# and Freddie Freeman (518692), and the feed's own `athlete_name` matches the
# crosswalk's on 366 of 398 (92.0%) — the residue being accents, apostrophes and
# generational suffixes, not different people.
RESOLVE_ATHLETE_SQL = """
    COALESCE(
      (SELECT x.athlete_id FROM athlete_crosswalk x
        WHERE x.sport = 'mlb' AND x.espn_athlete_id = {col}),
      (SELECT x.athlete_id FROM athlete_crosswalk x
        WHERE x.sport = 'mlb' AND x.athlete_id = {col})
    )"""


def resolve_athlete_sql(col: str = "p.athlete_id") -> str:
    """SQL resolving a prop row's athlete id to the `player_game_history` id.

    Handles BOTH id spaces. Coverage measured 2026-09-05: 1,558 of 1,576 prop
    athletes (98.9%), against 73.6% for the ESPN path alone.

    Use this everywhere a prop row is joined to an outcome. Joining on
    `athlete_id` directly matches 399 athletes by coincidence and 0.00% of those
    rows land on the right game date.
    """
    return RESOLVE_ATHLETE_SQL.format(col=col)


async def load_start_keys(conn=None) -> set[tuple]:
    """`(game_date, athlete_id)` for every pitcher appearance that was a START.

    WHY THIS EXISTS: `league_baseline_for` anchors Scan's cross-market ranking,
    and an anchor is only meaningful if it describes the same population as the
    number subtracted from it. A pitcher market is SERVED to tonight's probable
    starters, but a pitcher's history mixes starts with relief outings, and the
    two are not the same event. Measured 2026-09-09 on the live board:
    38.3% of `pitcher-hits-allowed`'s baseline rows were relief appearances
    (p10 = 3 outs, p25 = 7 outs), where clearing a starter's line is close to
    impossible. That dragged the baseline from 59.1% to 38.2% and handed every
    one of the 35 pitchers a fake +18.3pt edge, which swept the top 19 slots of
    the MLB board.

    ROLE, NOT VOLUME, IS THE DISCRIMINATOR, and that distinction was measured
    rather than assumed. Two threshold-free volume rules were tried first and
    BOTH were rejected because they moved markets that were already correct:
    volume-weighting left `pitcher-hits-allowed` at +4.1 while shifting all six
    batter markets down 3-4pt, and cutting at a percentile of tonight's
    projected volumes fixed the pitcher market only at p50, where it moved
    batters by 4-8pt. `pit_gamesStarted` is a fact in the row rather than a
    cutoff chosen to produce an answer, and because only `side == "pit"` markets
    consult it, every batter market is a NO-OP BY CONSTRUCTION — verified
    byte-identical across all seven.

    Stored as `"0.0"`/`"1.0"`, so the cast is float and the test is `>= 1`; an
    int cast raises on this data.
    """
    import db as _db

    sql = """
        SELECT game_date, athlete_id FROM player_game_history
         WHERE sport = 'mlb'
           AND stats ? 'pit_gamesStarted'
           AND (stats->>'pit_gamesStarted')::float >= 1
    """
    if conn is not None:
        raw = await conn.fetch(sql)
    else:
        pool = await _db.get_pool()
        async with pool.acquire(timeout=300.0) as c:
            raw = await c.fetch(sql)
    return {(r["game_date"], str(r["athlete_id"])) for r in raw}
