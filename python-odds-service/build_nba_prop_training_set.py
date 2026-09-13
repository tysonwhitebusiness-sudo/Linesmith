"""Phase 7 step 1 — the NBA prop training set, and its self-validation gate.

    python build_nba_prop_training_set.py              # report only
    python build_nba_prop_training_set.py --out nba_props_train.csv

WHAT A ROW IS. One two-sided player-prop quote joined to what the player
actually did: `(athlete, game_date, market, line, over_price, under_price)`
against the realised stat from `player_game_history.stats`. The de-vigged
implied probability is what the model must beat; the realised over/under is
the outcome it is graded on.

THE GATE IS NOT THE ROW COUNT. De-vig the two-sided prices, bucket by implied
probability, and compare to the realised over-rate. A near-calibrated market
means the join, the sign convention and the de-vig are all right at once. A
skew means OUR code is wrong -- suspect it before concluding anything about
the market. This is the same self-validation that cleared the CFB set
(residual mean -0.03 over 13,650 games).

FOUR THINGS THE PHASE BRIEF GOT WRONG, all measured 2026-09-13:

1. **THE PRICED WINDOW IS SIX WEEKS, NOT A SEASON.** The brief says "one
   season, 2025-10-21 -> 2026-06-14". That is the range of prop ROWS. Rows
   carrying an actual two-sided PRICE stop on **2025-12-01**: ESPN BET
   (`espn_core`) supplies every one of them, and when the provider flips to
   DraftKings in December the archive keeps recording lines and records **zero
   prices** -- 11,978 rows, `over_price` and `under_price` null throughout.
   Same shape as CFB and as NBA game lines: results are plentiful, prices are
   the scarce thing.

2. **"36,335 two-sided props" COUNTS TEAM AND QUARTER MARKETS.** Restricted to
   the nine player stat markets a model can actually project, it is **30,437**.
   The remainder is `Team Total Points`, `1st Quarter Total`, `1st Half Total`
   and the `Basketball Player Prop` bucket -- the last of which is 24,668 rows
   under a single `type_id` (158) that never says WHICH stat is being priced,
   so it is unusable no matter how many of them carry a price.

3. **RESULTS STOP AT 2026-04-13, BEFORE THE PLAYOFFS.** `player_game_history`
   for nba ends at the last day of the regular season, so the 10,062 April-June
   prop rows join to nothing. Irrelevant to the priced set (which ended in
   December) but fatal to any plan to use the later lines.

4. **PROPS DO CARRY OPENING LINES, unlike NBA game lines.** `open_line` differs
   from `line` on 14,423 of 181,894 ESPN rows and `open_over_price` is present
   on all 36,011 two-sided ones. The master plan's finding that NBA CLV is
   unmeasurable is true of `odds_archive` (zero `captured_at`, zero
   `open_line`); it is NOT true of `prop_odds_archive`. Open-to-close movement
   on props is measurable. Carried into the output for step 4.

THREE CHOICES THAT WOULD SILENTLY CORRUPT THIS, each handled:

* **SEVERAL QUOTES PER PROP.** 4,797 of 25,439 props carry more than one row --
  the same book at different times, not different books (there is exactly one
  provider). Taking an arbitrary one is the non-determinism that made
  OddsHarvester's reference line a coin flip. Takes the FRESHEST by
  `last_updated`, tie-broken on `id`: the closest thing to a closing line this
  data has, and deterministic.

* **THE JOIN IS ON `event_ref`, NOT `(athlete_id, game_date)`,** and that is not
  a preference. Joining on the date first produced 25,442 result rows from
  25,333 props -- 100.4%, which is impossible for a one-to-one join and is the
  only reason the fault was visible at all. `player_game_history` holds **1,863
  (athlete, game_date) pairs carrying two rows under two different `event_id`s**
  -- different opponents, different minutes, 1,608 of them disagreeing on
  points. NBA teams do not play twice in a day, so these are two real games
  stamped with one calendar date, a date-boundary artefact of a late tip-off.
  288 priced prop rows land on such a pair, and on those the date join silently
  grades the prop against the WRONG game. `prop_odds_archive.event_ref` and
  `player_game_history.event_id` are the same id space -- 299 of 299 priced
  event_refs resolve -- so the exact join is simply available, costs nothing,
  and removes the ambiguity rather than tolerating it. It also joins 25,420 of
  25,439 (99.93%), so nothing is lost by being exact.

* **DE-VIG METHOD CHANGES THE ANSWER, and not uniformly.** Phase 5.1 measured
  that multiplicative de-vigging overstates a longshot's probability, realised
  below implied in 14 of 14 MLB markets, with the gap correlating +0.637 with
  distance from 50%. Half these NBA markets are asymmetric in exactly that way
  (`Total 3-Point Field Goals` averages -21 over against -83 under). So the
  gate reports all four methods. A multiplicative-only skew on the longshot
  markets is the EXPECTED result, not a broken join -- what would indict the
  join is a skew that survives every method, or one that appears on the
  symmetric combo markets too.

`athlete_name` IS NULL ON EVERY NBA PROP ROW — all 25,420. The column is kept
because `athlete_id` is what joins and the name is what a human reads, so any
diagnostic built on this set will print blank names until something backfills
them. Better to have the empty column say so than to drop it and rediscover the
gap in a report.

ZERO PUSHES IS CORRECT, NOT A MISSING CASE. All 36,008 priced NBA prop lines
are half-points; there is no integer line for a realised integer stat to land
on. The push branch stays because the next provider need not share that habit,
and a push counted as a loss would bias every rate in this file.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

from predict.odds_math import american_to_decimal, devig_by, DEVIG_METHODS  # noqa: E402

# market -> the expression over `player_game_history.stats` that grades it.
# Keys are `prop_odds_archive.type_name` verbatim; the combos are summed here
# rather than stored, because the archive prices the combo and the history
# stores the parts.
MARKETS: dict[str, str] = {
    "Total Points":                        "points",
    "Total Rebounds":                      "rebounds",
    "Total Assists":                       "assists",
    "Total 3-Point Field Goals":           "threePointFieldGoalsMade",
    "Total Steals":                        "steals",
    "Total Blocks":                        "blocks",
    "Total Points and Rebounds":           "points + rebounds",
    "Total Points and Assists":            "points + assists",
    "Total Points, Rebounds, and Assists": "points + rebounds + assists",
}

# A price outside this band is not a price. Phase 9's sourcing backlog states
# the rule; the archive holds -5000 and +800 on thin markets, both real, and
# nothing beyond the band.
MIN_PRICE, MAX_PRICE = -20000, 20000


def _stat_sql(expr: str) -> str:
    """`points + rebounds` -> the JSON extraction for each part, summed."""
    parts = [p.strip() for p in expr.split("+")]
    return " + ".join(
        "COALESCE(json_extract(h.stats, '$." + p + "')::DOUBLE, 0)" for p in parts)


def _case_arms() -> str:
    return "\n".join(
        "             WHEN p.type_name = '" + name + "' THEN " + _stat_sql(expr)
        for name, expr in MARKETS.items())


async def build(conn):
    """Every two-sided player prop joined to its realised stat. One row per
    (athlete, game_date, market) — the freshest quote wins."""
    import corpus_reads

    con = corpus_reads.duck_connection()
    try:
        con.execute("INSTALL json; LOAD json;")
    except Exception:                                            # noqa: BLE001
        pass
    await corpus_reads.union_view(con, conn, "prop_odds_archive")
    await corpus_reads.union_view(con, conn, "player_game_history")

    sql = f"""
        WITH priced AS (
            SELECT p.*,
                   row_number() OVER (
                       PARTITION BY p.athlete_id, p.event_ref, p.type_name
                       ORDER BY p.last_updated DESC NULLS LAST, p.id DESC) AS rn
              FROM prop_odds_archive p
             WHERE p.sport = 'nba'
               AND p.athlete_id IS NOT NULL
               AND p.line       IS NOT NULL
               AND p.over_price IS NOT NULL AND p.under_price IS NOT NULL
               AND p.over_price  BETWEEN {MIN_PRICE} AND {MAX_PRICE}
               AND p.under_price BETWEEN {MIN_PRICE} AND {MAX_PRICE}
               AND list_contains(?::VARCHAR[], p.type_name)
        )
        SELECT p.event_ref, p.game_date, p.athlete_id, p.athlete_name,
               p.type_name AS market, p.line, p.over_price, p.under_price,
               p.open_line, p.open_over_price, p.open_under_price,
               CASE
{_case_arms()}
               END AS actual,
               json_extract(h.stats, '$.minutes')::DOUBLE  AS minutes,
               h.is_home, h.team_id, h.opponent_id, h.season
          FROM priced p
          JOIN player_game_history h
            ON h.sport = 'nba' AND h.athlete_id = p.athlete_id
           AND h.event_id = p.event_ref
         WHERE p.rn = 1
         ORDER BY p.game_date, p.athlete_id, p.type_name
    """
    rows = con.execute(sql, [list(MARKETS)]).fetchall()
    cols = [d[0] for d in con.description]
    # How many priced props FAILED to join — the number that would otherwise be
    # invisible, and the one that says whether the join is sound.
    n_priced = con.execute(
        "SELECT count(*) FROM (SELECT 1 FROM prop_odds_archive p WHERE p.sport='nba' "
        " AND p.athlete_id IS NOT NULL AND p.line IS NOT NULL "
        " AND p.over_price IS NOT NULL AND p.under_price IS NOT NULL "
        " AND list_contains(?::VARCHAR[], p.type_name) "
        " GROUP BY p.athlete_id, p.event_ref, p.type_name)", [list(MARKETS)]).fetchone()[0]
    con.close()
    return [dict(zip(cols, r)) for r in rows], n_priced


# ---------------------------------------------------------------------------
# THE GATE
# ---------------------------------------------------------------------------

def _devig(row, method: str):
    over = american_to_decimal(row["over_price"])
    under = american_to_decimal(row["under_price"])
    pair = devig_by(method, over, under)
    return None if pair is None else pair[0]


def _wilson(k: int, n: int) -> tuple[float, float]:
    """95% interval. A bucket without one invites reading noise as a result."""
    if n == 0:
        return (0.0, 1.0)
    import math
    z, p = 1.959963985, k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)


def gate(rows: list[dict]) -> int:
    import statistics as st

    graded = [r for r in rows if r["actual"] is not None and r["actual"] != r["line"]]
    pushes = [r for r in rows if r["actual"] is not None and r["actual"] == r["line"]]
    for r in graded:
        r["over"] = 1 if r["actual"] > r["line"] else 0

    print("\n" + "=" * 78)
    print("GATE — de-vigged implied probability vs realised over-rate")
    print("=" * 78)
    print(f"  graded props {len(graded):,}   pushes excluded {len(pushes):,}   "
          f"realised over-rate {100.0 * sum(r['over'] for r in graded) / max(len(graded), 1):.2f}%")

    worst = 0.0
    for method in DEVIG_METHODS:
        for r in graded:
            r["p"] = _devig(r, method)
        ok = [r for r in graded if r["p"] is not None]
        if not ok:
            continue
        mean_p = st.mean(r["p"] for r in ok)
        realised = sum(r["over"] for r in ok) / len(ok)
        resid = realised - mean_p
        # `worst_case` is EXCLUDED from the verdict on purpose. It is the one
        # method whose two sides deliberately sum to 2 - S rather than to 1 --
        # "a floor, not a model", in `odds_math`'s own words -- so a positive
        # residual is the conservatism it was written to provide, not evidence
        # of anything. Scoring it as a miss would fail a correct join every
        # time. It is still PRINTED, because the size of its gap is a reading
        # of the vig.
        if method != "worst_case":
            worst = max(worst, abs(resid))
        print("\n  --- " + method + " " + "-" * (66 - len(method)))
        print(f"  mean implied P(over) {mean_p * 100:6.2f}%   realised {realised * 100:6.2f}%   "
              f"RESIDUAL {resid * 100:+6.2f}pt   (n={len(ok):,})")
        print(f"    {'implied P(over)':<18}{'n':>7}{'implied':>10}{'realised':>10}{'resid':>9}   95% CI")
        edges = [0.0, .30, .40, .45, .50, .55, .60, .70, 1.01]
        for lo, hi in zip(edges, edges[1:]):
            b = [r for r in ok if lo <= r["p"] < hi]
            if not b:
                continue
            k, n = sum(r["over"] for r in b), len(b)
            imp = st.mean(r["p"] for r in b)
            clo, chi = _wilson(k, n)
            flag = "" if clo <= imp <= chi else "   <-- implied outside CI"
            print(f"    {lo:.2f}-{hi:.2f}      {n:>7,}{imp * 100:>9.2f}%{100.0 * k / n:>9.2f}%"
                  f"{(k / n - imp) * 100:>+8.2f}pt   [{clo * 100:5.2f},{chi * 100:5.2f}]{flag}")

    # Per-market, on the method the rest of the repo defaults to.
    for r in graded:
        r["p"] = _devig(r, "multiplicative")
    print("\n  --- per market (multiplicative) " + "-" * 45)
    print(f"    {'market':<38}{'n':>7}{'implied':>10}{'realised':>10}{'resid':>9}")
    for m in MARKETS:
        b = [r for r in graded if r["market"] == m and r["p"] is not None]
        if not b:
            continue
        k, n = sum(r["over"] for r in b), len(b)
        imp = st.mean(r["p"] for r in b)
        print(f"    {m[:37]:<38}{n:>7,}{imp * 100:>9.2f}%{100.0 * k / n:>9.2f}%"
              f"{(k / n - imp) * 100:>+8.2f}pt")

    print(f"\n  VERDICT: worst residual across the three point-estimate methods "
          f"{worst * 100:.2f}pt — ", end="")
    if worst <= 0.02:
        print("PASS. The join, the sign convention and the de-vig agree with reality.")
        return 0
    print("INVESTIGATE. Suspect this code before concluding anything about the market.")
    return 1


async def main(out: str | None) -> int:
    import db

    pool = await db.get_pool()
    async with pool.acquire(timeout=300.0) as conn:
        rows, n_priced = await build(conn)
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                            # noqa: BLE001
        pool.terminate()

    print("\n" + "=" * 78)
    print("NBA PROP TRAINING SET")
    print("=" * 78)
    print(f"  two-sided player props (freshest quote per prop) : {n_priced:,}")
    print(f"  JOINED to a player result                        : {len(rows):,}"
          f"   ({100.0 * len(rows) / max(n_priced, 1):.1f}%)")
    if not rows:
        print("\n  nothing joined — check athlete_id alignment before going further.\n")
        return 1

    dates = sorted({r["game_date"] for r in rows})
    print(f"  dates {dates[0]} .. {dates[-1]}   ({len(dates)} game days)")
    print(f"  athletes {len({r['athlete_id'] for r in rows}):,}   "
          f"markets {len({r['market'] for r in rows})}")
    no_stat = sum(1 for r in rows if r["actual"] is None)
    no_min = sum(1 for r in rows if r["minutes"] is None)
    moved = sum(1 for r in rows if r["open_line"] is not None and r["open_line"] != r["line"])
    print(f"  rows with no gradeable stat {no_stat:,}   with no minutes {no_min:,}")
    print(f"  line moved from open        {moved:,}   ({100.0 * moved / len(rows):.1f}%)")

    rc = gate(rows)

    if out:
        import csv
        keys = ["event_ref", "game_date", "athlete_id", "athlete_name", "market",
                "line", "over_price", "under_price", "open_line", "open_over_price",
                "open_under_price", "actual", "minutes", "is_home", "team_id",
                "opponent_id", "season"]
        with open(out, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(keys)
            for r in rows:
                w.writerow([r[k] for k in keys])
        print(f"\n  wrote {len(rows):,} rows -> {out}")
    else:
        print("\n  REPORT ONLY. Pass --out <file.csv> to write the set.")
    print()
    return rc


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="write the joined set to this CSV")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.out)))
