"""
Load nflverse's game file into `odds_import_staging`, resolved.

NFL had **285** trainable games before this — exactly one season, because ESPN
core publishes about one season of odds and NFL had no second source. nflverse
is free, open, and goes back to 1999. It was sitting in this repo's own
source-priority table at 80 and had never once been fetched.

Delivers **7,276** games with a spread and a total (1999–2025) and **5,295**
with a closing moneyline (2006–2025). Also, unlike the SBR files, it carries
real PRICES for the spread and total, not just the lines.

============ EVERY SEMANTIC CONFIRMED AGAINST OUTCOMES ============

Measured over the real file before a line of loader code was written:

  home/away_moneyline   booksum 1.0272; home favourites win .672. Orientation
                        right.
  total_line            mean 43.55 against an actual mean of 44.26, over rate
                        .4872. Right market, right side.
  spread_line           **THE SIGN IS INVERTED RELATIVE TO OUR ARCHIVE** — see
                        below. This is the whole hazard of this loader.

============ THE SIGN FLIP, WHICH IS THE ONLY REAL TRAP HERE ============

nflverse's `spread_line` is POSITIVE when the home team is favoured:
corr(+0.426) with home margin, mean +2.25 against a mean home margin of +2.34.

`odds_archive` uses the opposite — the ordinary betting convention, NEGATIVE
when home is favoured. Measured on the rows already in it: mean line −1.89
against a mean margin of +2.03, corr **−0.81** (NFL), −0.92 (CFB), −0.52 (NBA).
Gate 1.7 asserts `corr(-spread, home margin) >= 0.25`, which only makes sense
under that convention.

So `spread_line` is **negated** on the way in. Loading it raw would put NFL's
spread into the archive with the sign reversed against every other sport in the
same column — and a spread feature with the wrong sign is worse than no feature
at all, because a model will happily fit to it and be confidently backwards.

============ THE TEAM MAP ============

nflverse ships **35 team codes for 32 franchises**. `OAK`/`LV`, `SD`/`LAC` and
`STL`/`LA` are the same clubs under old and new cities, so the mapping is
deliberately MANY-TO-ONE — unlike an athlete crosswalk, where a many-to-one
mapping is the bug. Relocations are listed explicitly and never inferred.

**`LA` is the RAMS, not the Chargers.** Getting that one wrong files an entire
franchise's history under a different team, which is the Montreal-under-Toronto
failure in NFL form, and nothing downstream would report an error.

The map does not have to be trusted, though, and that is the good part:
nflverse publishes **ESPN's own event id on all 7,548 rows**. Every game that
overlaps our existing `espn_core` rows can therefore be checked on the same
event id — if the code→id map is right, the resolved home and away ids must
match exactly. That is a far stronger check than any name comparison, and
`--verify` runs it.

Writes to `odds_import_staging`, not straight to `odds_archive`, so this source
inherits the whole existing contract: nothing unresolved is ever promoted, gate
4's duplicate/date/team checks apply, and gate 5.8's value-projection check
catches a promotion that fails to carry it.

Usage (from python-odds-service/):
    ./.venv/Scripts/python.exe -u import_nflverse.py [--verify] [--report]
Then: node scripts/gate/promote_odds.mjs
"""

import argparse
import asyncio
import io
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pandas as pd

sys.path.insert(0, "src")
sys.path.insert(0, ".")
import db  # noqa: E402
from import_odds_staging import (COLS, GR_COLS, game_result_row,  # noqa: E402
                                 impossible_price, insert, insert_results)

URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv"
CACHE = Path(__file__).parent / ".crosswalk_cache" / "nflverse_games.csv"
SOURCE = "nflverse"
SOURCE_PRIORITY = 80  # this repo's own table: free, authoritative for its sport

# nflverse code -> our NFL team id, which IS ESPN's (32/32 confirmed; NFL is
# loaded through ESPN in game_context.py).
NFLVERSE_TO_ESPN = {
    "ARI": "22", "ATL": "1", "BAL": "33", "BUF": "2", "CAR": "29", "CHI": "3",
    "CIN": "4", "CLE": "5", "DAL": "6", "DEN": "7", "DET": "8", "GB": "9",
    "HOU": "34", "IND": "11", "JAX": "30", "KC": "12", "LAC": "24", "LV": "13",
    "MIA": "15", "MIN": "16", "NE": "17", "NO": "18", "NYG": "19", "NYJ": "20",
    "PHI": "21", "PIT": "23", "SEA": "26", "SF": "25", "TB": "27", "TEN": "10",
    # Spelling difference only — ESPN writes WSH.
    "WAS": "28",
    # RELOCATIONS. The same franchise under a former city, mapped explicitly
    # because a historical archive should file it under the club that still
    # exists. Never inferred from a prefix or a city name.
    "OAK": "13",   # Raiders, Oakland -> Las Vegas, 2020
    "SD": "24",    # Chargers, San Diego -> Los Angeles, 2017
    "STL": "14",   # Rams, St. Louis -> Los Angeles, 2016
    "LA": "14",    # Rams. NOT the Chargers — LAC is its own code above.
    "LAR": "14",   # defensive: the modern spelling, in case it ever appears
}


def load_games(refresh=False):
    """One fetch, cached. The file is ~2 MB and completely static for past
    seasons; re-running the parse must not mean re-downloading it."""
    CACHE.parent.mkdir(exist_ok=True)
    if refresh or not CACHE.exists():
        r = httpx.get(URL, timeout=120, follow_redirects=True)
        r.raise_for_status()
        CACHE.write_text(r.text, encoding="utf-8")
    return pd.read_csv(io.StringIO(CACHE.read_text(encoding="utf-8")), low_memory=False)


def num(v):
    n = pd.to_numeric(v, errors="coerce")
    return None if pd.isna(n) else float(n)


def integer(v):
    n = num(v)
    return None if n is None else int(round(n))


def implied(american):
    if american is None:
        return None
    a = float(american)
    return 100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0)


def booksum_and_flag(home_ml, away_ml):
    """nflverse publishes both moneylines, so the overround is computable and
    there is no reason to leave it null. Gate 5.3 asserts that every sport has
    a large body of rows flagged `two_way`, and a source that ships a real
    two-way market with no flag drags its whole sport under the threshold --
    NFL fell to 6% before this, purely because 40,366 unflagged rows landed on
    top of 724 flagged ones. The flag is data, not decoration."""
    h, a = implied(home_ml), implied(away_ml)
    if h is None or a is None:
        return None, "missing"
    bs = h + a
    return bs, ("two_way" if bs >= 1.0 else "sub_one_not_two_way")


def build(df, today):
    rows, results = [], []
    unresolved = {"unknown_code": 0, "no_date": 0}
    for r in df.itertuples(index=False):
        d = pd.to_datetime(getattr(r, "gameday", None), errors="coerce")
        if pd.isna(d):
            unresolved["no_date"] += 1
            continue
        game_date = d.date()
        hid = NFLVERSE_TO_ESPN.get(str(r.home_team).strip().upper())
        aid = NFLVERSE_TO_ESPN.get(str(r.away_team).strip().upper())
        if not hid or not aid:
            unresolved["unknown_code"] += 1
        event_ref = None
        if not pd.isna(getattr(r, "espn", None)):
            event_ref = str(int(r.espn))

        bs, flag = booksum_and_flag(integer(getattr(r, "home_moneyline", None)),
                                    integer(getattr(r, "away_moneyline", None)))
        base = dict(
            sport="nfl", event_ref=event_ref, game_date=game_date,
            home_team_raw=str(r.home_team), away_team_raw=str(r.away_team),
            home_team_id=hid, away_team_id=aid,
            bookmaker="nflverse_consensus", provider=SOURCE, source=SOURCE,
            source_priority=SOURCE_PRIORITY, booksum=bs, ml_flag=flag,
            resolution_status="resolved" if (hid and aid) else "unresolved",
            resolution_note=None if (hid and aid) else "unresolved_team",
        )

        # THE NEGATION. nflverse: positive = home favoured. odds_archive:
        # negative = home favoured. See the module docstring — this single
        # minus sign is the difference between a usable spread and a
        # confidently backwards one.
        sl = num(getattr(r, "spread_line", None))
        home_line = None if sl is None else -sl
        away_line = None if sl is None else sl
        tl = num(getattr(r, "total_line", None))

        for market, side, line, price in (
            ("moneyline", "home", None, integer(getattr(r, "home_moneyline", None))),
            ("moneyline", "away", None, integer(getattr(r, "away_moneyline", None))),
            ("spread", "home", home_line, integer(getattr(r, "home_spread_odds", None))),
            ("spread", "away", away_line, integer(getattr(r, "away_spread_odds", None))),
            ("total", "over", tl, integer(getattr(r, "over_odds", None))),
            ("total", "under", tl, integer(getattr(r, "under_odds", None))),
        ):
            if price is None and line is None:
                continue
            row = {**base, "market": market, "side": side, "line": line,
                   "price": price, "open_line": None, "open_price": None}
            if impossible_price(market, price):
                row["resolution_status"] = "unresolved"
                row["resolution_note"] = "impossible_american_price"
            rows.append(row)

        gr = game_result_row("nfl", event_ref, game_date, str(r.home_team),
                             str(r.away_team), hid, aid,
                             integer(getattr(r, "home_score", None)),
                             integer(getattr(r, "away_score", None)),
                             str(getattr(r, "stadium", "") or "") or None,
                             SOURCE, today)
        if gr:
            results.append(gr)
    return rows, results, unresolved


async def verify(pool):
    """THE CHECK THAT MATTERS: join to `espn_core` on ESPN'S OWN EVENT ID and
    demand the resolved team ids agree.

    A name or abbreviation map can be wrong in a way that still looks tidy —
    30 of 39 ESPN NHL team ids once "matched" and every one was wrong. Here
    there is no need to argue about it: both sources carry the same event id,
    so a correct map produces identical team ids on the same game and an
    incorrect one produces a visible mismatch.

    The shuffled control is run alongside, for the same reason gate 7 runs one:
    an agreement rate means nothing without knowing what a WRONG map scores.
    """
    async with pool.acquire() as c:
        row = await c.fetchrow("""
            WITH n AS (SELECT DISTINCT event_ref, home_team_id, away_team_id
                       FROM odds_import_staging
                       WHERE source=$1 AND event_ref IS NOT NULL AND home_team_id IS NOT NULL),
                 e AS (SELECT DISTINCT event_ref, home_team_id, away_team_id
                       FROM odds_archive
                       WHERE sport='nfl' AND source='espn_core' AND event_ref IS NOT NULL)
            SELECT count(*)::int n,
              count(*) FILTER (WHERE n.home_team_id=e.home_team_id
                                 AND n.away_team_id=e.away_team_id)::int agree,
              -- the control: same join, teams deliberately swapped
              count(*) FILTER (WHERE n.home_team_id=e.away_team_id
                                 AND n.away_team_id=e.home_team_id)::int swapped
            FROM n JOIN e USING (event_ref)
        """, SOURCE)
    return row


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="build and print, write nothing")
    ap.add_argument("--refresh", action="store_true", help="re-download the file")
    ap.add_argument("--verify", action="store_true", help="run the event-id check and exit")
    args = ap.parse_args()
    pool = await db.get_pool()

    if args.verify:
        r = await verify(pool)
        pct = (r["agree"] / r["n"] * 100) if r["n"] else 0
        print(f"event-id overlap with espn_core: {r['n']} games")
        print(f"  team ids agree      {r['agree']} ({pct:.1f}%)")
        print(f"  home/away SWAPPED   {r['swapped']}  <- must be 0")
        return

    df = load_games(args.refresh)
    today = datetime.now(timezone.utc).date()
    print(f"nflverse: {len(df):,} games, seasons {df.season.min()}–{df.season.max()}")
    rows, results, unresolved = build(df, today)
    print(f"built {len(rows):,} odds rows, {len(results):,} results; unresolved {unresolved}")
    codes = set(df.home_team.dropna()) | set(df.away_team.dropna())
    missing = sorted(c for c in codes if c.upper() not in NFLVERSE_TO_ESPN)
    print(f"team codes: {len(codes)} seen, {len(missing)} unmapped {missing if missing else ''}")

    if args.report:
        print("--report: nothing written")
        return

    # Scoped to this source so the loader is independently re-runnable and
    # cannot duplicate itself. odds_import_staging has no unique index.
    async with pool.acquire() as c:
        n = await c.execute("DELETE FROM odds_import_staging WHERE source=$1", SOURCE)
        print(f"cleared prior staging rows for {SOURCE}: {n}")
    print(f"staged: {await insert(pool, rows):,}")
    print(f"game_result: {await insert_results(pool, results):,} offered")

    r = await verify(pool)
    if r["n"]:
        print(f"\nEVENT-ID VERIFICATION against espn_core on {r['n']} shared games:")
        print(f"  team ids agree    {r['agree']} ({r['agree']/r['n']*100:.1f}%)")
        print(f"  home/away swapped {r['swapped']}  (must be 0)")
    else:
        print("\nno event-id overlap with espn_core to verify against")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
