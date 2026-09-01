"""
Load the tennis-data.co.uk match files into `odds_archive` and `game_result`.

57,386 ATP + WTA matches, 2015-2026, sitting in Downloads and untouched until
now because the team-shaped `import_odds_staging.py` cannot express a contest
between two people.

============ THE TARGET LEAKS INTO THE COLUMN NAME. READ THIS FIRST. ============

Every one of these files is keyed by OUTCOME, not by side:

    Winner  Loser  WRank  LRank  WPts  LPts  W1 L1 ... Wsets Lsets
    B365W   B365L  PSW    PSL    MaxW  MaxL  AvgW AvgL

There is no "player 1" and "player 2" anywhere in the file. Load it in file
order and `Winner` wins 100% of the time -- so does the lower of `AvgW`/`AvgL`,
and so does the better of `WRank`/`LRank`. A model trained on that scores ~100%
and is worth nothing, and the failure is invisible: every metric looks superb.
This is why the de-randomisation is mandatory IN THE LOADER, before anything
else touches the data. A downstream fix is not equivalent -- by then the leaked
orientation is what is in the database, and every consumer inherits it.

HOW THE ORIENTATION IS CHOSEN

    key  = tour | date | tournament | round | min(name) | max(name)
    bit  = md5(key)[0] & 1
    p1   = min(name) if bit == 0 else max(name)

Three properties, each load-bearing:

  - The key is OUTCOME-INDEPENDENT. The two names go in sorted, so nothing
    about who won can reach the hash. Feeding (winner, loser) in that order
    would have made the orientation a function of the result -- the same leak,
    one indirection further away and much harder to see.
  - It is DETERMINISTIC. Re-running produces the same p1 for every match, so
    the load is idempotent and the archive can never end up holding one match
    in both orientations.
  - It is INDEPENDENT OF THE ROW. Not a random draw at load time, which would
    be unreproducible, and not row position, which correlates with nothing here
    but would silently start to if the files were ever re-sorted.

Every paired column is swapped together or none of them are. Swapping the names
and leaving `AvgW` alone would leak the answer through the price instead, which
is the same bug wearing a different column name.

Measured after loading, and asserted by scripts/gate/gate8_tennis.mjs: p1 wins
50.31% of 56,386 matches, while the LOWER-PRICED side wins 68%. The first
number says the leak is gone; the second says the data is still real. Either
one alone could be produced by a broken loader -- a coin flip that discarded
the prices would satisfy the first perfectly.

============ WHAT IS AND IS NOT LOADED ============

Loaded, per match: the closing moneyline from four price series (Bet365,
Pinnacle, the best price across books, and the market average) into
`odds_archive`, and sets won into `game_result`.

NOT loaded: surface, round, seed ranks and ranking points. There is no column
for them in either shared table, and inventing a per-sport tennis table would
invert the convention `odds_archive`'s own migration argues for at length. They
stay in the files, and because the orientation above is a pure function of the
match key, a later loader re-derives exactly the same p1/p2 assignment and can
add them alongside. Deferring them costs nothing; getting the orientation wrong
once would cost everything downstream of it.

Player ids are NULL, deliberately. These files publish "Vukic A." and no id.
`player_game_history`'s tennis rows carry 4-digit ids from a different provider
with no name column to bridge them. A guessed id is the exact failure this
project has already paid for twice, so the names go in the *_team_raw columns
and the id columns stay empty until a real crosswalk exists.

Usage (from python-odds-service/):
    ./.venv/Scripts/python.exe -u import_tennis.py [--truncate] [--report]
"""

import argparse
import asyncio
import glob
import hashlib
import sys
import warnings
from datetime import datetime

import pandas as pd

sys.path.insert(0, "src")
import db  # noqa: E402

warnings.filterwarnings("ignore")

DL = "C:/Users/occy3/Downloads"
# tennis-data.co.uk ships one workbook per tour per year. The ATP file is
# `2025.xlsx`; the WTA file downloaded beside it becomes `2025 (1).xlsx`.
SOURCES = (("tennis_atp", f"{DL}/20[0-9][0-9].xlsx"),
           ("tennis_wta", f"{DL}/20[0-9][0-9] (1).xlsx"))
SOURCE = "tennis_data"
SOURCE_PRIORITY = 60  # see odds_archive's migration: below football-data's 70

# (winner column, loser column, bookmaker label). "max" is the best price
# available across books rather than one book's own, and "avg" the market
# average; both are labelled for what they are instead of being passed off as
# a bookmaker.
BOOKS = (("B365W", "B365L", "bet365"),
         ("PSW", "PSL", "pinnacle"),
         ("MaxW", "MaxL", "market_max"),
         ("AvgW", "AvgL", "market_avg"))

# The source spells its own status inconsistently -- "Rrtired", "Walkoer" are
# both in the files. Normalised rather than matched exactly, because a typo
# must not quietly promote a walkover into a played match.
PLAYED = ("completed", "retired", "rrtired", "disqualified", "awarded")


def decimal_price(v):
    """These columns are not reliably numeric: a handful of cells arrive as
    strings, so pandas types the whole column as object and any comparison
    against a float raises. Coerced here rather than at read time, where a
    blanket `astype(float)` would turn a stray non-numeric cell into a silent
    NaN across the sheet."""
    if v is None:
        return None
    n = pd.to_numeric(v, errors="coerce")
    return None if pd.isna(n) else float(n)


def american(v):
    """Decimal -> American. A decimal price at or below 1.01 is not a real
    quote (it implies >99% and pays nothing); treated as missing."""
    d = decimal_price(v)
    if d is None or d <= 1.01:
        return None
    return int(round((d - 1) * 100)) if d >= 2.0 else -int(round(100 / (d - 1)))


def ml_flag(book, booksum):
    """`market_max` is not a bookmaker. It is the BEST price available across
    books on each side, so its two implied probabilities routinely sum to less
    than 1 -- that is a cross-book arbitrage, and in tennis it happens on about
    36% of matches (41,494 rows, mean booksum 1.0029). Labelling those
    `sub_one_not_two_way`, the flag that means "this market is not a clean
    two-way close", would be false: nothing is wrong with them.

    A REAL book below 1.0 is a different thing entirely and is rare -- 68 rows
    of 449,796. Djokovic at +1600 in a Rome semi-final and Isner at +16000 in a
    final are misplaced decimal points in the source, not prices. Those keep
    the existing flag, so they stay visible and stay excluded from anything
    that reads a clean two-way market.
    """
    if book == "market_max":
        return "best_of_market"
    if booksum is None:
        return "missing"
    return "sub_one_not_two_way" if booksum < 1.0 else "two_way"


def orientation(tour, date, tournament, rnd, a, b):
    """Returns (p1, p2, swapped) where swapped says whether p1 is the LOSER.

    The names go into the key sorted, so the key -- and therefore the
    orientation -- cannot depend on who won. See the module docstring.
    """
    lo, hi = (a, b) if a <= b else (b, a)
    key = f"{tour}|{date}|{tournament}|{rnd}|{lo}|{hi}"
    bit = hashlib.md5(key.encode("utf-8")).digest()[0] & 1
    p1 = lo if bit == 0 else hi
    return key, p1, (p1 != a)


def load_files():
    frames = []
    for sport, pattern in SOURCES:
        for path in sorted(glob.glob(pattern)):
            d = pd.read_excel(path)
            d["sport"] = sport
            frames.append(d)
    return pd.concat(frames, ignore_index=True)


def build(df):
    odds, results, skipped = [], [], {"no_date": 0, "not_played": 0, "no_sets": 0,
                                       "no_decision_in_score": 0}
    for r in df.itertuples(index=False):
        d = pd.to_datetime(getattr(r, "Date", None), errors="coerce")
        if pd.isna(d):
            skipped["no_date"] += 1
            continue
        game_date = d.date()
        winner, loser = str(r.Winner).strip(), str(r.Loser).strip()
        key, p1, swapped = orientation(
            r.sport, game_date.isoformat(), str(r.Tournament).strip(),
            str(r.Round).strip(), winner, loser)
        p2 = loser if not swapped else winner

        comment = str(getattr(r, "Comment", "") or "").strip().lower()
        played = comment in PLAYED

        for wcol, lcol, book in BOOKS:
            dw = decimal_price(getattr(r, wcol, None))
            dl = decimal_price(getattr(r, lcol, None))
            # SWAP TOGETHER OR NOT AT ALL. Orienting the names and leaving the
            # price alone leaks the outcome through AvgW instead.
            p1_price, p2_price = (dl, dw) if swapped else (dw, dl)
            a1, a2 = american(p1_price), american(p2_price)
            if a1 is None and a2 is None:
                continue
            booksum = None
            if p1_price and p2_price:
                booksum = 1.0 / p1_price + 1.0 / p2_price
            flag = ml_flag(book, booksum)
            base = dict(sport=r.sport, event_ref=key, game_date=game_date,
                        home_team_raw=p1, away_team_raw=p2,
                        home_team_id=None, away_team_id=None,
                        market="moneyline", line=None, open_line=None,
                        open_price=None, bookmaker=book, provider="tennis_data",
                        source=SOURCE, source_priority=SOURCE_PRIORITY,
                        booksum=booksum, ml_flag=flag)
            odds.append({**base, "side": "home", "price": a1})
            odds.append({**base, "side": "away", "price": a2})

        if not played:
            skipped["not_played"] += 1
            continue
        ws, ls = getattr(r, "Wsets", None), getattr(r, "Lsets", None)
        if ws is None or ls is None or pd.isna(ws) or pd.isna(ls):
            skipped["no_sets"] += 1
            continue
        h, a = (int(ls), int(ws)) if swapped else (int(ws), int(ls))
        # A MATCH WHOSE SCORE CANNOT EXPRESS ITS OWN OUTCOME IS WORSE THAN NO
        # ROW. 269 matches are retirements in the FIRST SET, so both players
        # took zero sets and game_result's two score columns are equal. The
        # match did have a winner -- the file knows it, the score does not --
        # and writing the row anyway encodes `home_score > away_score` as
        # false, which teaches every downstream consumer that p1 lost when p1
        # may well have won. That is 269 deliberately mislabelled targets, and
        # it also dragged the measured p1 win rate to 0.4959 where the real
        # figure is 0.4980. Dropped, and counted, so the gap is visible.
        if h == a:
            skipped["no_decision_in_score"] += 1
            continue
        results.append(dict(sport=r.sport, event_ref=key, game_date=game_date,
                            home_team_raw=p1, away_team_raw=p2,
                            home_team_id=None, away_team_id=None,
                            home_score=h, away_score=a,
                            venue=str(getattr(r, "Location", "") or "") or None,
                            source=SOURCE))
    return odds, results, skipped


OC = ["sport", "event_ref", "game_date", "home_team_raw", "away_team_raw", "home_team_id",
      "away_team_id", "market", "side", "line", "price", "open_line", "open_price",
      "bookmaker", "provider", "source", "source_priority", "booksum", "ml_flag"]
RC = ["sport", "event_ref", "game_date", "home_team_raw", "away_team_raw",
      "home_team_id", "away_team_id", "home_score", "away_score", "venue", "source"]


async def insert(pool, table, cols, rows, batch=1000):
    if not rows:
        return 0
    ph = ",".join(f"${i+1}" for i in range(len(cols)))
    sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({ph}) ON CONFLICT DO NOTHING"
    n = 0
    async with pool.acquire() as conn:
        for i in range(0, len(rows), batch):
            chunk = rows[i:i + batch]
            await conn.executemany(sql, [tuple(r[c] for c in cols) for r in chunk])
            n += len(chunk)
            if n % 40000 == 0:
                print(f"    {table}: {n:,}", flush=True)
    return n


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--truncate", action="store_true",
                    help="delete this source's rows first (scoped to tennis_data)")
    ap.add_argument("--report", action="store_true", help="build and print, write nothing")
    args = ap.parse_args()

    df = load_files()
    print(f"read {len(df):,} matches from {len(glob.glob(SOURCES[0][1])) + len(glob.glob(SOURCES[1][1]))} files")
    odds, results, skipped = build(df)
    print(f"built {len(odds):,} odds rows, {len(results):,} results; skipped {skipped}")

    # THE CHECK THAT MATTERS, RUN BEFORE ANYTHING IS WRITTEN. If the
    # orientation had leaked, p1 would win ~100% and this would say so here
    # rather than after 1.6M rows are in Postgres.
    if results:
        p1 = sum(1 for r in results if r["home_score"] > r["away_score"]) / len(results)
        print(f"  p1 win rate {p1:.4f} over {len(results):,} played matches "
              f"(a leak reads as ~1.0000)")
        if not 0.47 <= p1 <= 0.53:
            print("  REFUSING TO WRITE: orientation is not balanced")
            return

    if args.report:
        print("--report: nothing written")
        return

    pool = await db.get_pool()
    if args.truncate:
        async with pool.acquire() as c:
            for t in ("odds_archive", "game_result"):
                await c.execute(f"DELETE FROM {t} WHERE source = $1", SOURCE)
        print(f"cleared existing {SOURCE} rows")
    print(f"odds_archive: {await insert(pool, 'odds_archive', OC, odds):,} offered")
    print(f"game_result:  {await insert(pool, 'game_result', RC, results):,} offered")
    async with pool.acquire() as c:
        for r in await c.fetch("""
            SELECT sport, count(*)::int n, min(game_date)::text lo, max(game_date)::text hi,
                   count(DISTINCT bookmaker)::int books
            FROM odds_archive WHERE source = $1 GROUP BY 1 ORDER BY 1""", SOURCE):
            print(f"  {r['sport']:<12} {r['n']:>7,} rows  {r['lo']} -> {r['hi']}  "
                  f"{r['books']} price series")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
