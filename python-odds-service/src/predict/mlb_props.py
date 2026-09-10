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


def required_keys_sql(spec: "MarketSpec") -> str:
    """The "this row carries the stats we need" test, in SQL BOTH ENGINES SPEAK.

    This used to be Postgres's `stats ? 'key'` jsonb containment operator, which
    is a parse error in DuckDB — so the same market SQL could not run against
    the Parquet corpus (Phase 5.2) without a per-query translation layer, and a
    translation layer between the fitter's SQL and the server's SQL is exactly
    where the two silently drift apart.

    `stats->>'key' IS NOT NULL` is accepted by both and, MEASURED ON THE REAL
    DATA 2026-09-09, selects identically:

        pit_hits      ? = 213,119   ->> IS NOT NULL = 213,119
        bat_hits      ? = 569,459   ->> IS NOT NULL = 569,459
        bat_doubles / bat_triples / bat_homeRuns    identical

    THE TWO ARE NOT EQUIVALENT IN GENERAL, and the difference is worth knowing:
    `?` is true for a key present with a JSON null value, where `->> IS NOT
    NULL` is false. There are ZERO such rows today (the `json_null` column of
    that measurement was 0 everywhere), and a row like that would be unusable
    anyway — the very next thing this SQL does is cast the value to float. If
    such rows ever appear, this filter drops them instead of failing the cast,
    which is the safer of the two behaviours rather than a silent change.
    """
    # PARENTHESISED, and that is load-bearing rather than tidy. DuckDB binds
    # `IS NOT NULL` tighter than `->>`, so the unparenthesised form parses as
    # `stats ->> ('key' IS NOT NULL)` and fails with "Could not convert string
    # ... to BOOL when casting from source column stats". Postgres happens to
    # parse it the intended way, so this is a difference that only appears on
    # the corpus path -- which is exactly the kind of divergence a shared SQL
    # string exists to prevent.
    return " AND ".join(f"(stats->>'{k}') IS NOT NULL" for k in spec.required_keys)


async def load_game_history(slug: str, conn=None,
                            athlete_ids: list[str] | None = None) -> list[tuple]:
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
    has_keys = required_keys_sql(spec)
    # `athlete_ids` NARROWS THE PULL TO THE PLAYERS THE CALLER WILL ACTUALLY
    # USE, and it is optional because the two callers need opposite things.
    #
    # THE SERVING PATH passes tonight's slate. Both of its consumers already
    # discard everything else in Python — `mlb_prop_serving.build`'s history
    # loop keeps only `aid in subjects`, and `league_baseline_for` skips the
    # rest — so the filter changes what is TRANSFERRED, never what is computed.
    # Measured 2026-09-09 before it existed: 299 players were served out of
    # 7,184,704 rows pulled, 74.2% of them discarded on arrival. That single
    # query family was 64.7% of every row this database returned, and the
    # 385 MB it materialised is what OOM-killed `mlbProjectionsJob` on a 512 MB
    # worker. NHL and NFL's pipes have always filtered this way; MLB is the
    # oldest and never caught up.
    #
    # THE WALK-FORWARD MUST NOT PASS IT and therefore gets `None`. This function
    # is THE ONE HISTORY SOURCE precisely so the model that is measured is the
    # model that is served, and a default that silently narrowed the corpus
    # would narrow every backtest with it — the same class of error as fitting
    # at a line you do not serve.
    #
    # Bound as a parameter rather than interpolated: everything else in this
    # SQL comes from `MarketSpec` constants, but an athlete list is caller data.
    args: list = []
    where_ids = ""
    if athlete_ids is not None:
        args.append(list(athlete_ids))
        where_ids = f" AND athlete_id = ANY(${len(args)}::text[])"
    # `id` IS SELECTED ONLY TO MAKE THE SORT TOTAL, and is dropped again below.
    # Sorting on (game_date, athlete_id) alone is not a total order: MLB plays
    # DOUBLEHEADERS, and there are 6,617 (game_date, athlete_id) pairs covering
    # 13,234 rows where one player has two games on one date. Python's sort is
    # stable, so those rows kept whatever order the database happened to return
    # them in -- and a bare SELECT has no ordering guarantee at all.
    #
    # THAT IS NOT COSMETIC. `PlayerHistory.recent_volume` is an ordered list and
    # `mean_volume(window=N)` takes the LAST N, so swapping a doubleheader pair
    # at the window boundary changes `projected_volume` and therefore the
    # projection. The Postgres path was already nondeterministic run to run;
    # this was only noticed because Parquet returned the same rows in a
    # different order and the 5.2b identity gate refused them.
    sql = f"""
        SELECT id, game_date, athlete_id,
               {spec.stat_sql} AS stat,
               {spec.volume_sql} AS volume
          FROM player_game_history
         WHERE sport = 'mlb'
           AND {has_keys}
           AND (stats->>'{spec.volume_key}') IS NOT NULL
           AND {spec.volume_sql} > 0{where_ids}
    """
    if conn is not None:
        raw = await conn.fetch(sql, *args)
    else:
        pool = await _db.get_pool()
        async with pool.acquire(timeout=300.0) as c:
            raw = await c.fetch(sql, *args)
    # Sorted in Python: ordering 425k rows in Postgres spills to temp disk, and
    # the database has under 2 GB of headroom. See fit_mlb_props.load_props.
    out = [(r["game_date"], str(r["athlete_id"]), float(r["stat"]),
            float(r["volume"]), r["id"]) for r in raw]
    out.sort(key=lambda t: (t[0], t[1], t[4]))
    return [t[:4] for t in out]


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


async def load_start_keys(conn=None,
                          athlete_ids: list[str] | None = None) -> set[tuple]:
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

    # Same optional narrowing as `load_game_history`, for the same reason: the
    # only consumer is `league_baseline_for`, which counts rows for the slate's
    # own pitchers and ignores every other start. Unfiltered this returns every
    # start in 16 years of history to answer a question about tonight's 35.
    args: list = []
    where_ids = ""
    if athlete_ids is not None:
        args.append(list(athlete_ids))
        where_ids = f" AND athlete_id = ANY(${len(args)}::text[])"
    sql = f"""
        SELECT game_date, athlete_id FROM player_game_history
         WHERE sport = 'mlb'
           AND stats ? 'pit_gamesStarted'
           AND (stats->>'pit_gamesStarted')::float >= 1{where_ids}
    """
    if conn is not None:
        raw = await conn.fetch(sql, *args)
    else:
        pool = await _db.get_pool()
        async with pool.acquire(timeout=300.0) as c:
            raw = await c.fetch(sql, *args)
    return {(r["game_date"], str(r["athlete_id"])) for r in raw}


def load_game_history_parquet(slug: str, parquet_path: str | None = None,
                              athlete_ids: list[str] | None = None) -> list[tuple]:
    """`load_game_history`, reading the Parquet corpus instead of Postgres.

    THE POINT IS THAT THE SQL IS THE SAME SQL. `stat_sql`, `volume_sql` and
    `required_keys_sql` are shared verbatim with the Postgres path, so the two
    backends cannot drift into computing different numbers from the same rows —
    which is precisely the failure this module's header opens with, where the
    walk-forward and the serving path built history from different sources and
    disagreed by a mean 0.38 shots without either being obviously wrong.

    Only three things differ, and none of them touch the arithmetic:
      * the FROM clause reads a file rather than a table,
      * `sport` is still filtered here even though a per-sport export makes it
        redundant, because a shared export must not silently widen the result,
      * the athlete filter binds a DuckDB list parameter instead of `ANY($n)`.

    Returns the identical shape to `load_game_history` — (game_date,
    athlete_id, stat, volume), sorted the same way — because `build` walks the
    list and `break`s on `as_of`, which is only correct while it stays sorted.
    """
    spec = BY_SLUG[slug]
    where = [f"sport = 'mlb'",
             required_keys_sql(spec),
             f"(stats->>'{spec.volume_key}') IS NOT NULL",
             f"{spec.volume_sql} > 0"]
    params: list = []
    if athlete_ids is not None:
        where.append("list_contains(?::VARCHAR[], athlete_id)")
        params.append(list(athlete_ids))
    sql = (f"SELECT id, game_date, athlete_id, {spec.stat_sql} AS stat, "
           f"{spec.volume_sql} AS volume "
           f"FROM read_parquet(?) WHERE {' AND '.join(where)}")
    # The connection and the glob both come from `corpus_location`, so this
    # query is byte-identical whether the corpus is a local directory or an
    # S3 bucket — moving it is an env var, not a code change.
    from corpus_location import corpus_location, read_parquet_glob

    if parquet_path is None:
        con, parquet_path = read_parquet_glob(corpus_location(), "player_game_history")
    else:
        import duckdb

        con = duckdb.connect()
        con.execute("INSTALL json; LOAD json;")
    try:
        raw = con.execute(sql, [parquet_path, *params]).fetchall()
    finally:
        con.close()
    # Same total order as the Postgres path -- see `load_game_history` for the
    # doubleheader that makes the `id` tiebreaker necessary rather than tidy.
    out = [(r[1], str(r[2]), float(r[3]), float(r[4]), r[0]) for r in raw]
    out.sort(key=lambda t: (t[0], t[1], t[4]))
    return [t[:4] for t in out]


async def write_history_summary(conn, as_of, athlete_ids: list[str] | None = None,
                                slugs: list[str] | None = None,
                                source: str = "corpus") -> dict:
    """Compute per-(market, athlete) aggregates and store them.

    THIS IS WHAT LETS `player_game_history` LEAVE POSTGRES. The serving pipes
    replayed 2,807,445 rows every hour to derive four numbers per player-market;
    this derives them once and stores ~20k rows. See the migration
    `20260910030000_player_history_summary.sql` for why trimming the history
    instead was rejected (it moves 59.7% of projections) and why serving reading
    Parquet hourly was rejected (13-17s per market, and Storage egress).

    `source='corpus'` reads the Parquet corpus, which holds ALL history and is
    the point of the exercise. `source='postgres'` reads the live table and
    exists so the two can be compared -- a summary nobody has checked against
    the thing it replaces is not a summary, it is a guess.

    THE ARRAY IS WRITTEN IN THE ORDER THE REPLAY WOULD HAVE PRODUCED, because
    `mean_volume(window=N)` takes the LAST N. Both loaders already return a
    total order (game_date, athlete_id, id), so this preserves it rather than
    re-sorting.
    """
    from . import count_prop_engine as eng

    from .mlb_board_lines import BOARD_LINES

    slugs = slugs or [s for s in BY_SLUG]
    subject_filter = set(athlete_ids) if athlete_ids else None
    written = 0
    per_market: dict[str, int] = {}
    # Pitcher markets count STARTS ONLY toward the baseline. That is the
    # population fix that took `pitcher-hits-allowed` from a fake +18.3pt edge
    # (which swept the top 19 rows of the board) to -2.6 -- 38.3% of its
    # baseline rows were relief outings. Loaded once, and only if a pitcher
    # market is being summarised.
    start_keys = None
    if any(BY_SLUG[s].side == "pit" for s in slugs if s in BY_SLUG):
        start_keys = await load_start_keys(conn=conn, athlete_ids=athlete_ids)

    for slug in slugs:
        if source == "corpus":
            rows = load_game_history_parquet(slug, athlete_ids=athlete_ids)
        else:
            rows = await load_game_history(slug, conn=conn, athlete_ids=athlete_ids)

        spec = BY_SLUG[slug]
        line = BOARD_LINES.get(slug)
        eligible = start_keys if spec.side == "pit" else None

        agg: dict[str, list] = {}
        for gd, aid, ev, vol in rows:
            if gd >= as_of:
                break                       # leakage control, same as the replay
            if subject_filter is not None and aid not in subject_filter:
                continue
            a = agg.get(aid)
            if a is None:
                a = agg[aid] = [0.0, 0.0, 0, [], 0, 0]
            a[0] += ev
            a[1] += vol
            a[2] += 1
            a[3].append(vol)
            if len(a[3]) > eng.MAX_RECENT:
                a[3].pop(0)
            # The baseline counts a DIFFERENT population from the projection:
            # eligible rows only, and it is a count over the board line rather
            # than a sum. Kept per athlete so `league_baseline_for` can sum
            # across whatever slate it is given.
            if line is not None and (eligible is None or (gd, aid) in eligible):
                a[5] += 1
                if ev > line:
                    a[4] += 1

        if not agg:
            continue
        payload = [("mlb", slug, aid, as_of, a[0], a[1], a[2], a[3], a[4], a[5], line)
                   for aid, a in agg.items()]
        await conn.executemany(
            """INSERT INTO player_history_summary
                 (sport, market, athlete_id, as_of, events, volume, games,
                  recent_volume, baseline_over, baseline_total, board_line,
                  computed_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
               ON CONFLICT (sport, market, athlete_id, as_of) DO UPDATE SET
                 events = excluded.events, volume = excluded.volume,
                 games = excluded.games, recent_volume = excluded.recent_volume,
                 baseline_over = excluded.baseline_over,
                 baseline_total = excluded.baseline_total,
                 board_line = excluded.board_line,
                 computed_at = now()""", payload)
        written += len(payload)
        per_market[slug] = len(payload)

    return {"written": written, "markets": per_market, "source": source,
            "as_of": str(as_of)}


async def read_history_summary(conn, as_of, slug: str,
                               athlete_ids: list[str] | None = None) -> tuple:
    """({athlete_id: PlayerHistory}, league_baseline) for one market.

    The baseline comes back with the histories because it is derived from the
    SAME population -- summing `baseline_over / baseline_total` across the slate
    reproduces `league_baseline_for` exactly, including its starts-only rule for
    pitcher markets.
    """
    from . import count_prop_engine as eng

    args: list = ["mlb", slug, as_of]
    where = "sport = $1 AND market = $2 AND as_of = $3"
    if athlete_ids is not None:
        args.append(list(athlete_ids))
        where += f" AND athlete_id = ANY(${len(args)}::text[])"
    rows = await conn.fetch(
        f"SELECT athlete_id, events, volume, games, recent_volume, "
        f"       baseline_over, baseline_total "
        f"  FROM player_history_summary WHERE {where}", *args)
    hists = {str(r["athlete_id"]): eng.history_from_summary(
        r["events"], r["volume"], r["games"], r["recent_volume"]) for r in rows}
    over = sum(int(r["baseline_over"]) for r in rows)
    total = sum(int(r["baseline_total"]) for r in rows)
    return hists, (over / total if total else None)
