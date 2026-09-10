"""Phase 5.S.3 — which indexes are actually dead, decided by the planner.

    python audit_index_usage.py              # report; changes nothing
    python audit_index_usage.py --ddl        # also print DROP/CREATE pairs
    python audit_index_usage.py --snapshot   # record today's counters durably

WHY THIS EXISTS RATHER THAN A `WHERE idx_scan = 0` QUERY.

5.S.3 was written with this gate: *"`pg_stat_database.stats_reset` is still NULL
at drop time — that is the only thing making `idx_scan = 0` mean 'never used'
rather than 'not used lately'."*

**THE GATE IS VOID, AND IT IS VOID IN THE DIRECTION THAT LOSES DATA.** Measured
2026-09-10: `stats_reset` IS NULL, and the counters were nonetheless 5.7 days
old. The decisive test — because a gate that cannot fail is not a gate:

    odds_import_staging   1,140,676 rows, every `ingested_at` on 2026-09-02
                          pg_stat_user_tables.n_tup_ins = 0
    historical_odds          37,922 rows, n_tup_ins = 0
    prop_odds_dedup_backup  178,238 rows, n_tup_ins = 0

The statistics were discarded at the 2026-09-04 23:33:51Z restart
(`pg_postmaster_start_time()`, which `pg_stat_statements_info.stats_reset`
matches to the millisecond) and **`stats_reset` stayed NULL straight through
it**. So NULL never meant "never reset"; it meant nobody had called
`pg_stat_reset()`, which is a different and much weaker claim.

WHAT THE COUNTER CAN AND CANNOT SEE. Over a 5.7-day window, `idx_scan = 0` is
strong evidence about the hourly worker's hot path and **no evidence at all**
about anything that runs weekly, seasonally, or by hand. Half the candidates
here belong to the second category: golf shot profiles (between events), tennis
surface fits, `scripts/gate/*` (run once, months ago).

SO THE EVIDENCE IS THE PLANNER, NOT THE COUNTER. For every candidate index this
module holds REAL QUERIES TAKEN FROM THE CODEBASE, each carrying its
`file:line`, and asks Postgres to plan them. A probe query invented to exercise
an index proves nothing about whether the codebase would ever issue it, which is
why every probe below cites where it came from and why adding one without a
citation should be refused in review.

An index is KEPT if any probe's plan names it. An index is DROPPABLE only if
**no probe plans onto it AND its counter is zero** — two independent signals
that have to agree. Where they disagree, the planner wins, because the counter's
window is known to be too short.

THE THIRD THING, which is the actual fix: `--snapshot` records
`pg_stat_user_indexes` into `index_usage_snapshot`. Deltas between snapshots
survive restarts (a counter that went DOWN is a reset, and the snapshot says so
rather than silently reading it as negative usage). That is what makes this
question answerable properly in a month instead of re-litigable forever.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                     # noqa: E402


class Probe:
    """One real query, and where in the tree it lives.

    `sql` must be the shape the codebase actually issues. Parameters are
    replaced by literals ONLY where the literal cannot change the plan shape —
    a constant equality is still a constant equality. Where a parameter's value
    WOULD change the plan (a selective vs unselective id), the comment says so.
    """

    def __init__(self, origin: str, sql: str, note: str = "",
                 params: list[str] | None = None):
        self.origin = origin
        self.sql = " ".join(sql.split())
        self.note = note
        # SQL that yields ONE REPRESENTATIVE VALUE for each `$n` in `sql`,
        # resolved against the live table at run time.
        #
        # WHY NOT HARDCODE THE VALUE, and why not leave `$1` in place. asyncpg
        # refuses to send a statement whose parameters it has not been given --
        # the failure is the DRIVER's, before Postgres ever sees the query, so
        # even PG17's `EXPLAIN (GENERIC_PLAN)` never gets a chance. And a
        # hardcoded id rots the first time the row is pruned. Resolving a real
        # value per run keeps the probe honest and self-maintaining.
        self.params = params or []


# Every candidate index of consequence, with the probes that could use it.
# Indexes under 1 MB are reported but not probed: dropping them frees nothing
# measurable, and on the user tables (`bets`, `picks`, `watchlist`,
# `tracked_lines`, all with 0-2 rows) a zero counter says only that the product
# has no users yet, which is not a reason to delete the index it will need.
CANDIDATES: dict[str, list[Probe]] = {
    "prop_odds_archive_close_lookup": [
        Probe("python-odds-service/build_athlete_crosswalk.py:338",
              """SELECT count(*) FROM prop_odds_archive p
                  JOIN (SELECT DISTINCT event_ref FROM prop_odds_archive LIMIT 50) e
                    ON e.event_ref = p.event_ref"""),
        Probe("python-odds-service/build_athlete_crosswalk.py:413",
              "SELECT DISTINCT athlete_id, event_ref FROM prop_odds_archive"),
        Probe("closing-line lookup the index is named for",
              """SELECT athlete_id, type_name, max(last_updated)
                   FROM prop_odds_archive
                  WHERE sport = 'nhl' AND event_start IS NOT NULL
                  GROUP BY 1, 2""",
              "the index's own shape: (sport, event_ref, athlete_id, "
              "type_name, last_updated) WHERE event_start IS NOT NULL"),
    ],
    "idx_prop_odds_game": [
        Probe("python-odds-service/src/db.py:650  read_prop_odds_for_game",
              """SELECT id, provider_id, game_id, subject_id, market_key, line, side,
                        bookmaker, american_odds, fetched_at
                   FROM prop_odds WHERE game_id = $1
                  ORDER BY subject_id, market_key, bookmaker""",
              "live serving path; game_id is not the leading column of "
              "prop_odds_natural_key, so this cannot use that index",
              params=["SELECT game_id FROM prop_odds LIMIT 1"]),
        Probe("python-odds-service/src/db.py:4393",
              """SELECT DISTINCT ON (game_id, subject_id, market_key, line, bookmaker, side)
                        game_id, subject_id, market_key, line, side, bookmaker
                   FROM prop_odds WHERE game_id = ANY($1)
                  ORDER BY game_id, subject_id, market_key, line, bookmaker, side,
                           fetched_at DESC""",
              params=["SELECT array_agg(g) FROM (SELECT DISTINCT game_id g "
                      "FROM prop_odds LIMIT 5) t"]),
    ],
    "odds_archive_pregame": [
        Probe("scripts/gate/gate9_model_readiness.mjs:40",
              """SELECT sport, source, bookmaker, game_date, count(*)
                   FROM odds_archive
                  WHERE market = 'moneyline' AND price IS NOT NULL
                    AND NOT is_live AND home_team_id IS NOT NULL
                  GROUP BY 1,2,3,4""",
              "NOTE: no `sport` predicate, and sport LEADS this index"),
        Probe("scripts/gate/gate5_archive.mjs:67",
              """SELECT sport, count(*) FROM odds_archive
                  WHERE market = 'moneyline' AND NOT is_live
                    AND sport NOT LIKE 'soccer%' GROUP BY 1"""),
        Probe("the index's own shape, sport-qualified",
              """SELECT count(*) FROM odds_archive
                  WHERE sport = 'nfl' AND market = 'moneyline'
                    AND NOT is_live AND game_date > '2025-01-01'"""),
    ],
    "prop_odds_archive_capture_latency": [
        Probe("python-odds-service/audit_storage.py (capture-latency reporting)",
              """SELECT sport, avg(extract(epoch FROM (event_start - captured_at)))
                   FROM prop_odds_archive
                  WHERE captured_at IS NOT NULL GROUP BY 1"""),
    ],
    "odds_archive_event_start": [
        Probe("python-odds-service/src/corpus_store.py FROZEN_PREDICATE",
              """SELECT count(*) FROM odds_archive
                  WHERE ((event_start IS NOT NULL AND event_start <= now())
                      OR (event_start IS NULL AND game_date < current_date - 1))""",
              "the corpus export's own freeze test, run over the whole table"),
        Probe("sport-qualified event_start range",
              """SELECT count(*) FROM odds_archive
                  WHERE sport = 'nfl' AND event_start > now() - interval '30 days'"""),
    ],
    "golf_shot_events_player_name_idx": [
        Probe("lib/sports/golf/shotProfile.ts:50  getGolfShotProfile",
              """SELECT from_lie, left_yds, distance_yds, is_putt
                   FROM golf_shot_events
                  WHERE lower(player_name) = lower($1)""",
              "expression index on lower(player_name); exact match",
              params=["SELECT player_name FROM golf_shot_events "
                      "WHERE player_name IS NOT NULL LIMIT 1"]),
    ],
    "golf_shot_events_player_season_idx": [
        Probe("lib/sports/golf/shotProfile.ts:50 (by id, if any caller uses it)",
              """SELECT count(*) FROM golf_shot_events
                  WHERE player_id = $1 AND season = $2""",
              params=["SELECT player_id FROM golf_shot_events "
                      "WHERE player_id IS NOT NULL LIMIT 1",
                      "SELECT season FROM golf_shot_events LIMIT 1"]),
    ],
    "idx_nba_shot_events_game": [
        Probe("python-odds-service/src/db.py:1213",
              "SELECT DISTINCT game_id FROM nba_shot_events WHERE season = $1",
              "filters on SEASON, not game_id",
              params=["SELECT season FROM nba_shot_events LIMIT 1"]),
        Probe("lib/sports/nba/shotProfile.ts:17  getNbaShotProfile",
              """SELECT x_coord, y_coord, point_value, made, shot_type
                   FROM nba_shot_events WHERE shooter_id = $1 AND season = $2""",
              "filters on (shooter_id, season), not game_id",
              params=["SELECT shooter_id FROM nba_shot_events LIMIT 1",
                      "SELECT season FROM nba_shot_events LIMIT 1"]),
    ],
    "game_result_surface_lookup": [
        Probe("python-odds-service/fit_tennis_elo.py:55",
              """SELECT sport, game_date, surface, home_team_raw, away_team_raw
                   FROM game_result
                  WHERE sport LIKE 'tennis%' AND surface IS NOT NULL""",
              "LIKE 'tennis%' on a non-C collation cannot range-scan a plain "
              "btree, but `surface IS NOT NULL` matches the partial predicate"),
    ],
    "game_result_source": [
        Probe("scripts/gate/gate9_model_readiness.mjs:44 (join on source)",
              """SELECT count(*) FROM game_result WHERE source = 'espn_core'"""),
    ],
    "odds_import_staging_source": [
        Probe("scripts/gate/promote_odds.mjs:39",
              """SELECT DISTINCT source FROM odds_import_staging
                  WHERE resolution_status = 'resolved'"""),
    ],
}

SNAPSHOT_DDL = """
CREATE TABLE IF NOT EXISTS index_usage_snapshot (
    taken_at        timestamptz NOT NULL DEFAULT now(),
    postmaster_at   timestamptz NOT NULL,
    schema_name     text        NOT NULL,
    table_name      text        NOT NULL,
    index_name      text        NOT NULL,
    idx_scan        bigint      NOT NULL,
    size_bytes      bigint      NOT NULL,
    PRIMARY KEY (taken_at, schema_name, index_name)
)
"""


async def stats_window(conn) -> dict:
    """How old the counters REALLY are, and the proof.

    Never reports `stats_reset IS NULL` as evidence of anything. The age comes
    from `pg_postmaster_start_time()`, and the corroborating test is a table
    whose rows are known to predate that restart: if its `n_tup_ins` is zero,
    the counters cannot possibly span the row's lifetime.
    """
    started = await conn.fetchval("SELECT pg_postmaster_start_time()")
    now = await conn.fetchval("SELECT now()")
    reset = await conn.fetchval(
        "SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()")
    witnesses = await conn.fetch(
        """SELECT relname, n_tup_ins, n_live_tup FROM pg_stat_user_tables
            WHERE relname IN ('odds_import_staging','historical_odds','odds_archive')""")
    return {
        "postmaster_start": started,
        "age_days": (now - started).total_seconds() / 86400.0,
        "stats_reset": reset,
        "witnesses": [dict(w) for w in witnesses],
    }


async def uses_index(conn, probe: "Probe", index: str) -> tuple[str, str]:
    """("USES" | "no" | "ERROR", plan text).

    THREE OUTCOMES, NOT TWO, AND THAT IS THE WHOLE POINT. The first version
    returned a bool and folded an EXPLAIN that RAISED into "does not use the
    index" — so four indexes were reported DROPPABLE on probes that had never
    executed. A measurement that errors is not evidence of absence, and an
    error that reads as a licence to delete is the exact failure shape this
    phase keeps finding. ERROR now blocks the drop verdict.

    (It bit twice: the bool also formatted as `0` under `{v:<5}`, which is what
    made the second wrong run visible. Prefer a string verdict to a bool for
    anything that gets printed next to a decision.)

    EXPLAIN without ANALYZE: the plan is the question, and running these for
    real would scan several hundred MB to learn nothing more.
    """
    args = []
    for resolver in probe.params:
        try:
            args.append(await conn.fetchval(resolver))
        except Exception as e:                              # noqa: BLE001
            return "ERROR", f"param resolver failed ({resolver}): {e}"
    if any(a is None for a in args):
        return "ERROR", "a param resolver returned NULL (empty table?)"
    try:
        rows = await conn.fetch(f"EXPLAIN (FORMAT TEXT) {probe.sql}", *args)
    except Exception as e:                                  # noqa: BLE001
        return "ERROR", f"EXPLAIN FAILED: {type(e).__name__}: {e}"
    plan = "\n".join(r[0] for r in rows)
    return ("USES" if index in plan else "no"), plan


async def subsumed_by(conn, index: str) -> list[str]:
    """Other indexes on the same table that make `index` redundant.

    An index is REDUNDANT when another index on the same table has its exact
    column list as a leading prefix, with the same or no partial predicate:
    every scan the narrow one can serve, the wide one serves too. This is the
    strongest evidence available here — stronger than "no probe planned onto
    it", because it holds for queries nobody has written yet.

    It is what `idx_prop_odds_game (game_id)` turned out to be:
    `idx_prop_odds_subject (game_id, subject_id, market_key)` leads with the
    same column, is 18.9 MB against its 52.0 MB, and already carries 3.1M
    scans. The planner picks the composite for `WHERE game_id = $1` and had no
    reason ever to touch the single-column one.
    """
    rows = await conn.fetch(
        """SELECT s2.indexrelname AS other,
                  pg_get_indexdef(s2.indexrelid) AS other_def,
                  pg_get_indexdef(s1.indexrelid) AS this_def,
                  s2.idx_scan, pg_relation_size(s2.indexrelid) AS bytes
             FROM pg_stat_user_indexes s1
             JOIN pg_stat_user_indexes s2
               ON s2.relid = s1.relid AND s2.indexrelid <> s1.indexrelid
            WHERE s1.indexrelname = $1""", index)
    out = []
    for r in rows:
        this_cols = _cols_of(r["this_def"])
        other_cols = _cols_of(r["other_def"])
        if not this_cols or len(other_cols) < len(this_cols):
            continue
        if other_cols[:len(this_cols)] != this_cols:
            continue
        # A partial index cannot be subsumed by one with a DIFFERENT predicate.
        if _where_of(r["this_def"]) != _where_of(r["other_def"]):
            continue
        out.append(f"{r['other']} ({float(r['bytes'])/1e6:.1f} MB, "
                   f"{r['idx_scan']:,} scans)")
    return out


def _cols_of(indexdef: str) -> list[str]:
    body = indexdef[indexdef.index("(") + 1:]
    depth, cur, cols = 1, "", []
    for ch in body:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                break
        if depth == 1 and ch == ",":
            cols.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        cols.append(cur.strip())
    return cols


def _where_of(indexdef: str) -> str:
    i = indexdef.find(" WHERE ")
    return "" if i < 0 else " ".join(indexdef[i + 7:].split())


async def main(do_ddl: bool, do_snapshot: bool, do_apply: bool) -> int:
    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        await conn.execute("SET statement_timeout = '120s'")

        win = await stats_window(conn)
        print(f"\n{'=' * 78}\n5.S.3  HOW OLD ARE THE COUNTERS, REALLY\n{'=' * 78}")
        print(f"  pg_postmaster_start_time  {win['postmaster_start']}")
        print(f"  counters span             {win['age_days']:.1f} days")
        print(f"  pg_stat_database.stats_reset  {win['stats_reset']}  "
              f"<- NOT evidence; see this module's docstring")
        print("  witnesses (rows that predate the restart):")
        for w in win["witnesses"]:
            verdict = ("counters PREDATE these rows" if w["n_tup_ins"] >= w["n_live_tup"] > 0
                       else "counters START AFTER these rows were written")
            print(f"     {w['relname']:<26} live={w['n_live_tup']:>10,} "
                  f"ins={w['n_tup_ins']:>10,}   {verdict}")

        print(f"\n{'=' * 78}\nPLANNER EVIDENCE, per candidate index\n{'=' * 78}")
        keep, drop, unknown = [], [], []
        for index, probes in CANDIDATES.items():
            row = await conn.fetchrow(
                """SELECT s.idx_scan, pg_relation_size(s.indexrelid) b, s.relname tbl,
                          pg_get_indexdef(s.indexrelid) def
                     FROM pg_stat_user_indexes s WHERE s.indexrelname = $1""", index)
            if row is None:
                print(f"\n  {index}: NO LONGER EXISTS")
                continue
            mb = float(row["b"]) / 1e6
            print(f"\n  {index}  ({mb:.1f} MB on {row['tbl']}, "
                  f"idx_scan={row['idx_scan']:,})")
            sub = await subsumed_by(conn, index)
            if sub:
                print(f"     [SUBSUMED] by {', '.join(sub)}")
            used_by, errors = [], []
            for p in probes:
                verdict, plan = await uses_index(conn, p, index)
                print(f"     [{verdict:<5}] {p.origin}")
                if p.note:
                    print(f"             note: {p.note}")
                if verdict == "ERROR":
                    errors.append((p.origin, plan))
                    print(f"             {plan}")
                elif verdict == "USES":
                    used_by.append(p.origin)
            if used_by:
                keep.append((index, mb, used_by))
                print(f"     => KEEP. Planned onto by {len(used_by)} real "
                      f"call site(s) despite a zero counter.")
            elif errors:
                # An index whose evidence did not run is NOT an index proved
                # unused. This branch exists because the first version of this
                # tool folded ERROR into "no" and reported four indexes
                # droppable on probes that never executed.
                unknown.append((index, mb, errors))
                print(f"     => UNKNOWN, NOT DROPPABLE. {len(errors)} probe(s) "
                      f"failed to run; a measurement that errored is not "
                      f"evidence of non-use.")
            else:
                drop.append((index, mb, row["def"], sub))
                why = (f"SUBSUMED by {sub[0]} — redundant for every query, not "
                       f"just the probed ones" if sub else
                       "No probe plans onto it, and the counter agrees")
                print(f"     => DROPPABLE. {why}.")

        print(f"\n{'=' * 78}\nVERDICT\n{'=' * 78}")
        kmb = sum(m for _, m, _ in keep)
        dmb = sum(m for _, m, _, _ in drop)
        print(f"  KEEP      {len(keep):>2} indexes  {kmb:>8.1f} MB  "
              f"(zero counter, but the planner uses them)")
        for i, m, u in keep:
            print(f"      {i:<44}{m:>7.1f} MB   <- {u[0]}")
        umb = sum(m for _, m, _ in unknown)
        if unknown:
            print(f"  UNKNOWN   {len(unknown):>2} indexes  {umb:>8.1f} MB  "
                  f"(probe failed to run — NOT droppable)")
            for i, m, errs in unknown:
                print(f"      {i:<44}{m:>7.1f} MB   {errs[0][1][:70]}")
        print(f"  DROPPABLE {len(drop):>2} indexes  {dmb:>8.1f} MB")
        for i, m, _, sb in drop:
            print(f"      {i:<44}{m:>7.1f} MB   "
                  f"{('subsumed by ' + sb[0]) if sb else 'no reader found'}")
        print(f"\n  5.S.3's headline was 314.8 MB across 25 indexes. "
              f"Provable here: {dmb:,.1f} MB.")

        if do_ddl and drop:
            print(f"\n{'=' * 78}\nDDL — the CREATE side is the undo, keep it in the commit\n{'=' * 78}")
            for i, _, d, _sb in drop:
                print(f"\n-- undo: {d};")
                print(f"DROP INDEX CONCURRENTLY IF EXISTS {i};")

        if do_apply and drop:
            print(f"\n{'=' * 78}\nDROPPING\n{'=' * 78}")
            for i, m, d, sb in drop:
                # CONCURRENTLY: `prop_odds` is written by the worker every few
                # minutes, and a plain DROP INDEX takes an ACCESS EXCLUSIVE lock
                # on the TABLE. Brief, but "brief" competing with a 15-connection
                # pooler is how a maintenance step becomes an outage. It cannot
                # run inside a transaction, which is why this is a bare execute.
                await conn.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {i}")
                print(f"  dropped {i}  ({m:.1f} MB)")
                print(f"    undo: {d};")
            after = await conn.fetchval(
                "SELECT pg_database_size(current_database())") / 1e6
            print(f"\n  database now {after:,.0f} MB")

        if do_snapshot:
            await conn.execute(SNAPSHOT_DDL)
            n = await conn.fetchval(
                """INSERT INTO index_usage_snapshot
                       (postmaster_at, schema_name, table_name, index_name,
                        idx_scan, size_bytes)
                   SELECT pg_postmaster_start_time(), n.nspname, s.relname,
                          s.indexrelname, s.idx_scan, pg_relation_size(s.indexrelid)
                     FROM pg_stat_user_indexes s
                     JOIN pg_class ic ON ic.oid = s.indexrelid
                     JOIN pg_namespace n ON n.oid = ic.relnamespace
                    WHERE n.nspname = 'public'
                   ON CONFLICT DO NOTHING
                   RETURNING 1""")
            cnt = await conn.fetchval(
                "SELECT count(*) FROM index_usage_snapshot WHERE taken_at > now() - interval '1 min'")
            print(f"\n  snapshot recorded: {cnt} index rows in index_usage_snapshot")
            print("  A LATER SNAPSHOT MINUS THIS ONE IS REAL USAGE. A counter that "
                  "went DOWN means a restart, not negative use — compare "
                  "postmaster_at before subtracting.")

    await pool.close()
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ddl", action="store_true")
    ap.add_argument("--snapshot", action="store_true")
    ap.add_argument("--apply", action="store_true",
                    help="drop the indexes proved droppable (CONCURRENTLY)")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.ddl, a.snapshot, a.apply)))
