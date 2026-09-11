"""Phase 5.0 — the storage audit Phase 5 is built on.

    python audit_storage.py              # DB checks only (~30s)
    python audit_storage.py --memory     # also profiles the worker (~3 min, no writes)

WHY THIS EXISTS. Phase 5 rests on measurements, and measurements go stale
silently. Worse, this project has twice inherited a storage claim that was
FALSE — once from an earlier audit, once from me mid-audit on 2026-09-09. Both
are re-checked here every run, because a wrong premise about storage is exactly
as expensive as a wrong premise about a model.

Each check asserts a CLAIM PHASE 5 DEPENDS ON, not a level. Levels move every
day and that is fine; a claim changing means the plan is stale. So:

  * `prop_odds_history` gaining a model reader would invalidate 5.3 outright.
  * A corpus span SHRINKING means irreplaceable data was deleted (5.2 says
    nothing here may ever be deleted, only moved).
  * `stats_reset` becoming non-NULL destroys the evidence 5.4's index drops
    rest on.
  * `load_game_history` ceasing to dominate egress means either the world
    changed or 5.1 landed — either way the plan's headline number is stale.

THE TWO CLAIMS THAT DID NOT SURVIVE RE-MEASUREMENT, kept here permanently so
they cannot be re-inherited a third time:

  1. "Historical data is sitting in live tables." FALSE. Retention works
     exactly as written — `prop_odds` holds a 6-day span against a 7-day rule
     with ZERO rows past it.
  2. "The `_team_ids()` scan is a 26 MB/call egress problem." FALSE, and this
     one was my own error. It reads 572,366 rows to yield 66 team names, but
     the `UNION` dedupes SERVER-SIDE — 14 KB crosses the wire, not 26 MB.
     ROWS SCANNED IS NOT ROWS SENT. Every egress number in Phase 5 is rows
     SENT, and `check_union_dedupe` re-proves that distinction on every run.
"""
import argparse
import asyncio
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

DB_LIMIT_MB = 8192          # Supabase Pro
WORKER_LIMIT_MB = 512       # Render plan — see measure_memory.py's own opening line
EGRESS_ALLOWANCE_GB = 250   # Supabase Pro monthly

# Tables whose contents are IRREPLACEABLE model fuel. 5.2 moves these to object
# storage; nothing may ever delete from them. A shrinking span here is the
# single worst outcome this audit can detect.
CORPUS = {
    "odds_archive":        ("game_date", 27.0),
    "game_result":         ("game_date", 26.5),
    "player_game_history": ("game_date", 15.5),
    "prop_odds_archive":   ("game_date",  1.4),
    "mlb_pitch_events":    ("game_date",  2.4),
}

# (table, timestamp column, retention window in days) — the rules that really
# exist in db.RETENTION_RULES. Claim 1 above is re-tested against these.
LIVE_RETENTION = [
    ("prop_odds", "fetched_at", 7),
    ("game_odds_book_lines", "fetched_at", 2),
]

# `retentionJob` runs every 24h (JOB_REGISTRY), so a table that ages
# continuously ALWAYS holds rows that crossed their boundary since the last
# pass. The first version of this check demanded zero and failed on its first
# run against 32 rows sitting 0.0 hours past the window, while retention was
# working perfectly and had deleted 17 rows on its previous pass.
#
# THE CLAIM IS NOT "nothing is ever past the window" — that is unachievable
# with a periodic cleaner. It is "nothing SURVIVES materially past it", so the
# leak threshold is the window plus one full retention interval. A row older
# than that was offered to retention at least once and was not taken.
RETENTION_INTERVAL_DAYS = 1

# Modules that must NOT read prop_odds_history. If any of them starts to, 5.3's
# premise ("no model reads it") is dead and the roll-up cannot ship.
MODEL_MODULES = [
    "src/predict/mlb_prop_serving.py", "src/predict/nhl_prop_serving.py",
    "src/predict/nfl_prop_serving.py", "src/predict/mlb_props.py",
    "fit_mlb_props.py", "fit_nfl_props.py", "fit_nfl_elo.py",
    "fit_nfl_longest.py", "fit_nfl_anytime_td.py",
]

HERE = os.path.dirname(os.path.abspath(__file__))


def _hdr(title):
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


async def check_ceilings(conn) -> bool:
    """5.0a — the three ceilings. REPORTS levels, gates on the database only.

    Deliberately not a pass/fail on egress or RAM: neither is readable from
    Postgres, and a check that silently guesses is worse than one that says it
    cannot see. Egress is reported as a ROW rate, which is what
    pg_stat_statements actually knows.
    """
    _hdr("5.0a  THE THREE CEILINGS")
    size = await conn.fetchval("SELECT pg_database_size(current_database())")
    mb = size / 1e6
    pct = mb / DB_LIMIT_MB * 100
    print(f"  database   {mb:>10,.0f} MB of {DB_LIMIT_MB:,} MB   {pct:>5.1f}% full")

    reset = await conn.fetchval("SELECT stats_reset FROM pg_stat_statements_info")
    now = await conn.fetchval("SELECT now()")
    rows_day = None
    if reset:
        days = float((now - reset).total_seconds()) / 86400.0
        total = float(await conn.fetchval(
            "SELECT COALESCE(sum(rows),0) FROM pg_stat_statements WHERE query ILIKE 'select%'"))
        rows_day = total / max(days, 1e-9)
        print(f"  egress     {rows_day:>10,.0f} rows/day returned "
              f"(pg_stat_statements window {days:.2f}d)")
        print(f"             allowance {EGRESS_ALLOWANCE_GB} GB/mo — bytes are NOT "
              f"visible here; verify on Supabase's own graph")
    else:
        print("  egress     pg_stat_statements has no window; cannot rate-check")

    print(f"  worker     {WORKER_LIMIT_MB} MB limit — run with --memory to profile")

    # The gate: this phase exists because the database is near its ceiling. If
    # it is comfortably clear, the phase's premise has changed and somebody
    # should notice rather than keep executing a plan for a problem that moved.
    ok = pct > 25.0
    print(f"\n  VERDICT: {'PASS' if ok else 'FAIL'} — "
          f"{'database still above the 25% floor this phase was written for'
             if ok else 'database is far below the level Phase 5 assumes; re-read the plan'}")
    return ok


async def check_growth(conn) -> bool:
    """5.0b — WHAT is growing, as a rate. The level is not the finding."""
    _hdr("5.0b  GROWTH RATE BY TABLE (last 7 days)")
    tables = [("prop_odds_history", "observed_at"), ("prop_odds_archive", "ingested_at"),
              ("game_odds_history", "observed_at"), ("odds_archive", "captured_at"),
              ("player_game_history", "fetched_at"), ("game_result", "ingested_at")]
    sizes = {r["t"]: (r["tot"], max(r["est"], 1)) for r in await conn.fetch(
        """SELECT c.relname t, pg_total_relation_size(c.oid) tot, c.reltuples::bigint est
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'""")}
    out = []
    for tab, col in tables:
        if tab not in sizes:
            continue
        n = await conn.fetchval(
            f"SELECT count(*) FROM {tab} WHERE {col} > now() - interval '7 days'")
        tot, est = sizes[tab]
        mb_day = (n / 7.0) * (tot / est) / 1e6
        out.append((mb_day, tab, n / 7.0))
    out.sort(reverse=True)
    total = sum(o[0] for o in out) or 1e-9
    print(f"  {'table':<24}{'rows/day':>12}{'MB/day':>9}{'share':>8}")
    print("  " + "-" * 53)
    for mb_day, tab, per_day in out:
        print(f"  {tab:<24}{per_day:>12,.0f}{mb_day:>9,.1f}{mb_day / total * 100:>7.1f}%")
    print(f"  {'TOTAL':<24}{'':<12}{total:>9,.1f}")

    # The claim: ONE table dominates growth. 5.3 is scoped to that table alone,
    # so if growth becomes broad-based the phase is aimed at the wrong thing.
    top_mb, top_tab, _ = out[0]
    share = top_mb / total * 100
    ok = share > 50.0
    print(f"\n  top table: {top_tab} at {share:.0f}% of growth")
    print(f"  VERDICT: {'PASS' if ok else 'FAIL'} — "
          f"{'growth is concentrated, so 5.3 is aimed correctly'
             if ok else 'growth is no longer concentrated; 5.3 alone will not bound it'}")
    return ok


async def check_egress_attribution(conn) -> bool:
    """5.0c — WHICH query family dominates rows sent. 5.1's entire case."""
    _hdr("5.0c  EGRESS ATTRIBUTION (rows SENT, not scanned)")
    total = float(await conn.fetchval(
        "SELECT COALESCE(sum(rows),0) FROM pg_stat_statements WHERE query ILIKE 'select%'"))
    if total <= 0:
        print("  pg_stat_statements empty — cannot attribute")
        return False
    fam = float(await conn.fetchval(
        """SELECT COALESCE(sum(rows),0) FROM pg_stat_statements
            WHERE query ILIKE 'select%' AND query ILIKE '%FROM player_game_history%'"""))
    share = fam / total * 100
    print(f"  all SELECTs               {total:>16,.0f} rows")
    print(f"  player_game_history reads {fam:>16,.0f} rows   {share:>5.1f}%")
    print("\n  top families:")
    for r in await conn.fetch(
        """SELECT calls, rows, left(regexp_replace(query, E'\\\\s+', ' ', 'g'), 56) q
             FROM pg_stat_statements WHERE query ILIKE 'select%'
            ORDER BY rows DESC LIMIT 5"""):
        print(f"    {float(r['rows']) / total * 100:>5.1f}%  {r['calls']:>8,} calls  {r['q']}")

    # Before 5.1 this family is the majority of all egress. After 5.1 it should
    # collapse. Either state is fine; what matters is that the plan says which.
    ok = share > 40.0
    print(f"\n  VERDICT: {'PASS (pre-5.1 state)' if ok else 'FAIL'} — "
          f"{'the corpus pull still dominates egress, as Phase 5 states'
             if ok else 'the corpus pull no longer dominates: 5.1 has landed or the world changed — UPDATE THE PLAN'}")
    return ok


async def check_retention_claim(conn) -> bool:
    """5.0d(1) — re-test the inherited claim that history sits in live tables."""
    _hdr("5.0d  CLAIM 1: 'historical data is sitting in live tables'")
    ok = True
    for tab, col, days in LIVE_RETENTION:
        leak_days = days + RETENTION_INTERVAL_DAYS
        r = await conn.fetchrow(
            f"""SELECT count(*) n,
                       count(*) FILTER (WHERE {col} < now() - interval '{days} days') pending,
                       count(*) FILTER (WHERE {col} < now() - interval '{leak_days} days') leaked
                  FROM {tab}""")
        bad = (r["leaked"] or 0) > 0
        ok = ok and not bad
        print(f"  {tab:<24} {r['n']:>10,} rows   {r['pending']:>7,} awaiting the next pass"
              f"   {r['leaked']:>6,} past {leak_days}d   {'LEAK' if bad else 'clean'}")
    print(f"\n  VERDICT: {'PASS' if ok else 'FAIL'} — "
          f"{'retention works as written; the inherited claim remains FALSE'
             if ok else 'rows are now surviving past their window — retention is broken'}")
    return ok


async def check_union_dedupe(conn) -> bool:
    """5.0d(2) — re-test MY error: rows scanned vs rows sent."""
    _hdr("5.0d  CLAIM 2: '_team_ids() sends 26 MB per rebuild'")
    scanned = await conn.fetchval(
        """SELECT count(*) FROM odds_archive
            WHERE sport = 'mlb' AND home_team_id IS NOT NULL AND home_team_raw IS NOT NULL""")
    sent = await conn.fetch(
        """SELECT home_team_raw AS raw, home_team_id AS id FROM odds_archive
            WHERE sport = 'mlb' AND home_team_id IS NOT NULL AND home_team_raw IS NOT NULL
           UNION
           SELECT away_team_raw, away_team_id FROM odds_archive
            WHERE sport = 'mlb' AND away_team_id IS NOT NULL AND away_team_raw IS NOT NULL""")
    wire_kb = sum(len(str(x["raw"])) + len(str(x["id"])) for x in sent) / 1024
    print(f"  rows SCANNED by the query : {scanned:>10,}")
    print(f"  rows SENT over the wire   : {len(sent):>10,}   ({wire_kb:.1f} KB)")
    ok = len(sent) < scanned / 100
    print(f"\n  VERDICT: {'PASS' if ok else 'FAIL'} — "
          f"{'UNION dedupes server-side; the claim remains FALSE and rows-scanned != rows-sent'
             if ok else 'the UNION is no longer collapsing; re-examine the egress numbers'}")
    return ok


# Tables 5.2d has deliberately trimmed in POSTGRES, whose full span now lives
# in the Parquet corpus. For these the span must be asked of the CORPUS, or the
# check fails forever on the success of the very thing it is auditing.
#
# THIS WAS WRONG FOR EXACTLY ONE RUN AND IT MATTERED. After 5.2d trimmed
# `player_game_history` to a three-season hot window, 5.0e reported
# "A CORPUS SPAN SHRANK — irreplaceable model fuel was deleted" on a database
# where nothing had been lost: all 2,807,445 rows and the full 16.1 years sat in
# Supabase Storage, readable. An audit that cries data loss over a planned prune
# is an audit people learn to skip, which is the one failure it cannot afford.
PRUNED_TO_HOT_WINDOW = {"player_game_history", "mlb_pitch_events",
                        "prop_odds_archive", "odds_archive"}


def _corpus_span(table: str, col: str):
    """(min, max) of `col` in the Parquet corpus, or None if unreadable.

    Unreadable is a FAILURE, not a skip: for a table Postgres has trimmed, the
    corpus is the ONLY copy, and "we could not check the only copy" is exactly
    the state this audit exists to shout about.
    """
    try:
        from corpus_location import corpus_location, read_parquet_glob

        con, glob = read_parquet_glob(corpus_location(), table)
        try:
            row = con.execute(
                f"SELECT min({col}), max({col}) FROM read_parquet(?)", [glob]
            ).fetchone()
        finally:
            con.close()
        return (row[0], row[1]) if row and row[0] else None
    except Exception as e:                                  # noqa: BLE001
        print(f"      corpus read failed: {type(e).__name__}: {e}")
        return None


async def check_corpus_intact(conn) -> bool:
    """5.0e — the corpus is IRREPLACEABLE. A shrinking span means data loss.

    "The corpus" is now Postgres AND object storage, so each table is asked
    wherever its full history actually lives.
    """
    _hdr("5.0e  CORPUS SPANS (nothing here may ever be deleted)")
    ok = True
    for tab, (col, min_years) in sorted(CORPUS.items()):
        if tab in PRUNED_TO_HOT_WINDOW:
            # THE SPAN IS THE UNION, NOT THE CORPUS ALONE. The corpus holds only
            # FROZEN rows, so it ends at the last finished game; Postgres holds
            # the unfrozen tail, which includes FUTURE scheduled dates. Checking
            # the corpus by itself understates the top of the range and reported
            # `odds_archive` as SHRANK at 27.0y the moment it was pruned —
            # against a corpus that had lost nothing, while Postgres still held
            # game_dates out to 2026-12-25. Third time today that reading one
            # half of a split table produced a confident wrong answer.
            where = "corpus+pg"
            span = _corpus_span(tab, col)
            if span is None:
                print(f"  {tab:<24} CORPUS UNREADABLE — and Postgres no longer "
                      f"holds this span")
                ok = False
                continue
            lo, hi = span
            live = await conn.fetchrow(
                f"SELECT min({col}) a, max({col}) b FROM {tab}")
            if live and live["a"]:
                lo = min(lo, live["a"])
                hi = max(hi, live["b"])
        else:
            where = "postgres"
            r = await conn.fetchrow(f"SELECT min({col}) a, max({col}) b FROM {tab}")
            if not r["a"]:
                print(f"  {tab:<24} EMPTY")
                ok = False
                continue
            lo, hi = r["a"], r["b"]
        years = (hi - lo).days / 365.25
        bad = years < min_years
        ok = ok and not bad
        print(f"  {tab:<24} {str(lo)[:10]} -> {str(hi)[:10]}   {years:>5.1f}y"
              f"   (floor {min_years}y)   {'SHRANK' if bad else 'intact'}"
              f"   [{where}]")
    print(f"\n  VERDICT: {'PASS' if ok else 'FAIL'} — "
          f"{'every corpus span is intact'
             if ok else 'A CORPUS SPAN SHRANK — irreplaceable model fuel was deleted'}")
    return ok


async def check_rollup_is_safe(conn) -> bool:
    """5.0f — 5.3's premise: no model reads prop_odds_history, and its volume
    is genuine rather than a dedup bug."""
    _hdr("5.0f  IS prop_odds_history SAFE TO ROLL UP?")
    readers = []
    for mod in MODEL_MODULES:
        path = os.path.join(HERE, mod)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            if "prop_odds_history" in fh.read():
                readers.append(mod)
    print(f"  model/serving modules referencing it : {readers or 'none'}")

    r = await conn.fetchrow(
        """SELECT seq_scan + idx_scan AS reads, n_tup_ins AS ins
             FROM pg_stat_user_tables WHERE relname = 'prop_odds_history'""")
    ratio = (r["ins"] or 0) / max(r["reads"] or 1, 1)
    print(f"  lifetime reads {r['reads']:>12,}   inserts {r['ins']:>12,}   1:{ratio:,.0f}")

    dup = await conn.fetchrow(
        """WITH s AS (
             SELECT american_odds,
                    LAG(american_odds) OVER (
                      PARTITION BY provider_id, game_id, subject_id, market_key,
                                   line, side, bookmaker ORDER BY observed_at) prev
               FROM prop_odds_history WHERE observed_at > now() - interval '6 hours')
           SELECT count(*) n, count(*) FILTER (WHERE prev = american_odds) same FROM s""")
    dup_pct = (dup["same"] or 0) / max(dup["n"] or 1, 1) * 100
    print(f"  consecutive identical prices (6h)    : {dup_pct:.1f}%  (movement-only rule)")

    ok = not readers and dup_pct < 5.0
    print(f"\n  VERDICT: {'PASS' if ok else 'FAIL'} — "
          f"{'no model reads it and its volume is real movement, so 5.3 may proceed'
             if ok else 'a model now reads it, or the dedup broke — 5.3 must be re-scoped'}")
    return ok


async def check_reclaimable(conn) -> bool:
    """5.0g — 5.4's targets, and the evidence they rest on."""
    _hdr("5.0g  RECLAIMABLE WITHOUT TOUCHING MODEL DATA")
    dead = await conn.fetch(
        """SELECT c.relname t, pg_total_relation_size(c.oid) sz
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
              AND (c.relname LIKE '%backup%' OR c.relname LIKE '%staging%'
                   OR c.relname LIKE '%quarantine%')
            ORDER BY sz DESC""")
    dead_mb = sum(r["sz"] for r in dead) / 1e6
    for r in dead[:6]:
        print(f"  dead table  {r['t'][:44]:<46}{r['sz'] / 1e6:>8,.0f} MB")
    print(f"  {'':<58}{dead_mb:>8,.0f} MB total")

    reset = await conn.fetchval(
        "SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()")
    idx = await conn.fetch(
        """SELECT s.indexrelname i, pg_relation_size(s.indexrelid) sz
             FROM pg_stat_user_indexes s JOIN pg_index x ON x.indexrelid = s.indexrelid
            WHERE s.idx_scan = 0 AND NOT x.indisunique AND NOT x.indisprimary
            ORDER BY sz DESC""")
    idx_mb = sum(r["sz"] for r in idx) / 1e6
    for r in idx[:5]:
        print(f"  cold index  {r['i'][:44]:<46}{r['sz'] / 1e6:>8,.0f} MB")
    print(f"  {'':<58}{idx_mb:>8,.0f} MB total")
    print(f"\n  reclaimable: {dead_mb + idx_mb:,.0f} MB")

    # THE EVIDENCE CHECK, AND IT USED TO BE THE WRONG ONE.
    #
    # It read: `stats_reset IS NULL` proves the counters cover the database's
    # lifetime, so `idx_scan = 0` means "never used". **That test cannot fail.**
    # Measured 2026-09-10: `stats_reset` was NULL and the counters were 5.7 days
    # old, because they had been discarded at the 2026-09-04 restart and
    # `stats_reset` stayed NULL straight through it. NULL only ever meant
    # "nobody called pg_stat_reset()", which is a far weaker claim.
    #
    # The real age comes from `pg_postmaster_start_time()`, corroborated by a
    # witness: rows known to predate the restart whose `n_tup_ins` reads zero.
    # And even a long window says nothing about weekly or hand-run consumers —
    # 9 of 11 "cold" indexes turned out to be planned onto by real call sites —
    # so this now reports the counter as a HINT and points at the tool that
    # actually decides. See `audit_index_usage.py`.
    started = await conn.fetchval("SELECT pg_postmaster_start_time()")
    now = await conn.fetchval("SELECT now()")
    age_days = (now - started).total_seconds() / 86400.0
    witness = await conn.fetchrow(
        """SELECT n_tup_ins, n_live_tup FROM pg_stat_user_tables
            WHERE relname = 'historical_odds'""")
    stale = bool(witness and (witness["n_live_tup"] or 0) == 0
                 and (witness["n_tup_ins"] or 0) == 0)
    print(f"  pg_stat_database.stats_reset = {reset}   "
          f"<- NOT evidence of anything; see this function's comment")
    print(f"  counters actually span {age_days:.1f} days "
          f"(postmaster started {started})")
    # PASS means "the evidence is correctly characterised", not "these indexes
    # are safe to drop". Nothing here authorises a drop; audit_index_usage.py
    # does, on planner evidence.
    ok = True
    print(f"\n  VERDICT: PASS — reported as a HINT, not a licence. The counter "
          f"window is {age_days:.1f} days"
          f"{' and the witness says stats were reset' if stale else ''}, which "
          f"says nothing about weekly or hand-run consumers. Run "
          f"`audit_index_usage.py` before dropping any of the above.")
    return ok


def check_worker_memory() -> bool:
    """5.0h — the ceiling the plan never tracked. Costly, so opt-in."""
    _hdr("5.0h  WORKER MEMORY (opt-in: --memory)")
    script = os.path.join(HERE, "measure_projection_memory.py")
    if not os.path.exists(script):
        print(f"  helper not present ({os.path.basename(script)}); skipping")
        print("  VERDICT: SKIP")
        return True
    res = subprocess.run([sys.executable, script], capture_output=True, text=True)
    print(res.stdout.strip() or res.stderr.strip()[:800])
    return res.returncode == 0


async def main(with_memory: bool) -> int:
    import db as _db

    pool = await _db.get_pool()
    async with pool.acquire(timeout=600.0) as conn:
        results = {
            "5.0a ceilings":                 await check_ceilings(conn),
            "5.0b growth concentration":     await check_growth(conn),
            "5.0c egress attribution":       await check_egress_attribution(conn),
            "5.0d claim 1 (live tables)":    await check_retention_claim(conn),
            "5.0d claim 2 (rows sent)":      await check_union_dedupe(conn),
            "5.0e corpus intact":            await check_corpus_intact(conn),
            "5.0f roll-up safe":             await check_rollup_is_safe(conn),
            "5.0g reclaimable evidence":     await check_reclaimable(conn),
        }
    if with_memory:
        results["5.0h worker memory"] = check_worker_memory()

    _hdr("PHASE 5.0 SUMMARY")
    for name, ok in results.items():
        print(f"  {name:<32}{'PASS' if ok else 'FAIL'}")
    failed = [n for n, ok in results.items() if not ok]
    print()
    if failed:
        print(f"  {len(failed)} check(s) FAILED — Phase 5's premises no longer match the data.")
        print("  Re-read the plan before executing any further step.")
    else:
        print("  All checks pass. Phase 5's measurements still describe this database.")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Phase 5.0 storage audit")
    ap.add_argument("--memory", action="store_true",
                    help="also profile worker RSS (~3 min, writes nothing)")
    sys.exit(asyncio.run(main(ap.parse_args().memory)))
