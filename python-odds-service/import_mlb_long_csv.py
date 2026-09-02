"""Load `mlb_games_odds_2021_2025_all_books_long.csv` into `odds_archive` and
`game_result` -- the RAW prices behind the three MLB seasons the archive had no
prices for at all.

WHY THIS EXISTS. The 2026-09-02 pre-flight audit found MLB 2022, 2023 and 2024
entirely absent from `odds_archive`: the SBR xlsx files stop at 2021 and ESPN
starts at 2025. `historical_odds` *did* hold those seasons, but only as
consensus probabilities that sum to exactly 1.0000 -- already de-vigged by
`lib/sports/mlb/historicalOddsIngest.ts` on the way in. No vig means no EV and
no closing-line value, so the plan wrote those seasons off as a training signal
and nothing more.

That was the wrong conclusion, and the operator said so. The de-vigging happened
at INGEST, not in the source. This file is the source, it was sitting in
`data/historical-odds-import/`, and it carries raw American prices per book:

    open_home, open_away, close_home, close_away,
    open_home_line, close_home_line, open_total, close_total

for six books (bet365, bet_rivers_ny, betmgm, caesars, draftkings, fanduel)
across three markets, with ZERO nulls on any close price, 100% of rows carrying
a final score, and `start_date_utc` giving a real `event_start`.

WHAT IT ADDS BEYOND FILLING THE HOLE. The pointspread market here is TWO-SIDED
with real prices on both ends, which the ESPN rows are not (audit finding 0.5 --
ESPN stores home only, so its spread cannot be de-vigged).

SOURCE PRIORITY 85 -- deliberately BELOW espn_core (90) and sbr/sbr_mlb (100).
2021 and 2025 are already covered by those two and both have been through their
own gates. Sitting below them means `model_game_odds` keeps serving exactly what
it served before for every season that already had a price, so this loader is
purely additive on 2022-2024, and the overlap stays usable as a real
cross-source check rather than a silent overwrite.

TWO LIMITS OF THIS SOURCE, both measured, neither a reason not to load it:

  - NO DOUBLEHEADERS. Keyed on (date, home, away) the file has exactly one game
    per matchup per day -- 2,384 regular+postseason games in 2022 against a real
    2,430-game season. The second game of a doubleheader is absent, roughly 2%
    of a season. 2% missing beats 100% missing, and the natural key still
    carries the UTC start time so a later source CAN add them without colliding.
  - `game_type` is 'Unknown' on 4,378 rows, all 2021 or 2025 and all real Finals
    with scores. They are KEPT. Only 'S' (spring training) and 'A' (all-star)
    are dropped, because neither is a real game to model.

SPREAD SIGN IS NOT NEGATED. Measured on this file: corr(close_home_line, home
margin) = -0.2167, i.e. a negative home line already means the home team is
favoured, which is this archive's own convention. Same call CFBD got, opposite
of nflverse, which publishes positive-means-home-favoured and IS negated by its
loader. Verified rather than assumed, because getting it backwards produces a
model that looks fine and bets every game the wrong way.

VERIFIED AFTER LOADING, against the 2021/2025 overlap and against outcomes:
espn_core corr 0.9288 / mean-abs-diff 0.0191, sbr_mlb corr 0.8113 / 0.0319, and
on the newly-filled 2022-2024 the de-vigged home price tracks the realised home
win rate inside 1.5pp across every populated bucket (0.490 -> 0.475,
0.632 -> 0.631, 0.703 -> 0.717).
"""

import argparse
import asyncio
import sys
from datetime import date as _date
from pathlib import Path

import pandas as pd

sys.path.insert(0, "src")
sys.path.insert(0, ".")
import db  # noqa: E402
from import_odds_staging import (  # noqa: E402
    MLB_ABBR_TO_ID, booksum_and_flag, clear_source, game_result_row,
    integer, num, parse_event_start,
)
from src import entity_resolution  # noqa: E402

# Repo-relative, resolved from this file rather than the cwd: every other
# loader here is run as `python <script>.py` from python-odds-service/.
SRC = (Path(__file__).resolve().parent.parent
       / "data/historical-odds-import/mlb_games_odds_2021_2025_all_books_long.csv")
SOURCE = "mlb_long_csv"
SOURCE_PRIORITY = 85
SPORT = "mlb"

# Spring training and the all-star game are not games to model. Everything else
# -- R, the four postseason types (F/D/L/W) and the 'Unknown' rows, which are
# real Finals -- is kept.
DROP_TYPES = {"S", "A"}

OC = ["sport", "event_ref", "game_date", "home_team_raw", "away_team_raw", "home_team_id",
      "away_team_id", "market", "side", "line", "price", "open_line", "open_price",
      "bookmaker", "provider", "source", "source_priority", "booksum", "ml_flag",
      "event_start", "is_live"]
RC = ["sport", "event_ref", "game_date", "home_team_raw", "away_team_raw",
      "home_team_id", "away_team_id", "home_score", "away_score", "venue", "source",
      "event_start"]

# This file's own market names -> the archive's.
MARKET = {"moneyline": "moneyline", "pointspread": "spread", "total": "total"}

# American price -> implied probability. Used only by verify(); see its docstring
# for why comparing the raw American numbers is meaningless.
IMPLIED = "CASE WHEN price>0 THEN 100.0/(price+100) ELSE (-price)/((-price)+100.0) END"


def event_ref(row) -> str:
    """Doubleheader-safe even though this file has none.

    The UTC start time is what distinguishes two games between the same teams on
    the same day, so it goes in the key whether or not this particular file
    exercises it. game_result's natural key includes COALESCE(event_ref,''), and
    a key that cannot express a doubleheader silently collapses games -- which is
    exactly what happened to the SBR loader before it grew `rot{N}`.
    """
    t = str(row.start_date_utc or "")
    stamp = t[11:16].replace(":", "") if len(t) >= 16 else "0000"
    return f"lc{row.date}T{stamp}"


def build(d: pd.DataFrame):
    odds, results = [], []
    stats = {"games": 0, "rows": 0, "unmapped": 0, "no_score": 0}
    today = _date.today()

    d = d[~d.game_type.isin(DROP_TYPES)].copy()

    for _gkey, g in d.groupby(["date", "home_team_abbr", "away_team_abbr",
                               "start_date_utc"], sort=False):
        first = g.iloc[0]
        hid = MLB_ABBR_TO_ID.get(first.home_team_abbr)
        aid = MLB_ABBR_TO_ID.get(first.away_team_abbr)
        if not hid or not aid:
            stats["unmapped"] += 1
            continue

        gd = pd.to_datetime(first.date).date()
        start = parse_event_start(first.start_date_utc)
        ref = event_ref(first)
        hs, as_ = integer(first.home_score), integer(first.away_score)

        base = dict(sport=SPORT, event_ref=ref, game_date=gd,
                    home_team_raw=str(first.home_team), away_team_raw=str(first.away_team),
                    home_team_id=str(hid), away_team_id=str(aid),
                    provider=None, source=SOURCE, source_priority=SOURCE_PRIORITY,
                    event_start=start, is_live=False)

        rr = game_result_row(SPORT, ref, gd, str(first.home_team), str(first.away_team),
                             hid, aid, hs, as_, str(first.venue or "") or None,
                             SOURCE, today, event_start=start)
        if rr:
            results.append(rr)
        else:
            stats["no_score"] += 1
        stats["games"] += 1

        for r in g.itertuples(index=False):
            market = MARKET.get(r.market)
            if market is None:
                continue
            # canonical_bookmaker, not normalize_bookmaker: an unfamiliar
            # spelling must be stored cleaned, never dropped. Task 5.3.
            book = entity_resolution.canonical_bookmaker(str(r.sportsbook))
            ch, ca = num(r.close_home), num(r.close_away)
            oh, oa = num(r.open_home), num(r.open_away)
            bs, flag = booksum_and_flag(ch, ca)

            if market == "moneyline":
                pairs = [("home", ch, oh, None, None), ("away", ca, oa, None, None)]
            elif market == "spread":
                # NOT negated -- see the module docstring. The away line is the
                # mirror of the home line, which is how a spread market works.
                cl, ol = num(r.close_home_line), num(r.open_home_line)
                pairs = [("home", ch, oh, cl, ol),
                         ("away", ca, oa, None if cl is None else -cl,
                          None if ol is None else -ol)]
            else:  # total -- this file shares close_home/close_away for over/under
                ct, ot = num(r.close_total), num(r.open_total)
                pairs = [("over", ch, oh, ct, ot), ("under", ca, oa, ct, ot)]

            for side, price, open_price, line, open_line in pairs:
                if price is None and line is None:
                    continue
                odds.append({**base, "market": market, "side": side,
                             "line": line, "price": integer(price),
                             "open_line": open_line, "open_price": integer(open_price),
                             "bookmaker": book, "booksum": bs, "ml_flag": flag})
                stats["rows"] += 1

    return odds, results, stats


async def insert(pool, table, cols, rows, batch=1000):
    if not rows:
        return 0
    ph = ",".join(f"${i + 1}" for i in range(len(cols)))
    sql = f"INSERT INTO {table} ({','.join(cols)}) VALUES ({ph}) ON CONFLICT DO NOTHING"
    n = 0
    for i in range(0, len(rows), batch):
        chunk = [[r.get(c) for c in cols] for r in rows[i:i + batch]]
        async with pool.acquire() as c:
            await c.executemany(sql, chunk)
        n += len(chunk)
    return n


async def verify(pool):
    """Cross-source check on the overlap, plus calibration on the gap.

    2021 and 2025 are also covered by sbr_mlb and espn_core, so if this loader's
    closing moneyline agrees with theirs on the same games the parse is right.
    That is what makes the 2022-2024 fill believable, since by definition it has
    nothing to compare against.

    COMPARED IN IMPLIED PROBABILITY, NOT RAW AMERICAN PRICE, and that is not
    cosmetic. The first version of this function averaged the American numbers
    and reported mean-abs-diff 865.7 and corr 0.108 against sbr_mlb, which reads
    as a total parse failure. It was the metric: American odds are discontinuous
    across +/-100, so a book at -105 and a book at +101 -- two nearly identical
    prices -- average to -2. Converting first gives corr 0.8113 on the same rows.

    AND `NOT is_live`, which is the rest of it. Against espn_core that fix moved
    corr from 0.4323 to 0.9288 and mean-abs-diff from 0.1105 to 0.0191: the whole
    apparent disagreement was in-play prices averaged in with pre-game ones. The
    same trap as the original 48,489-row finding, hit from the other direction.
    """
    async with pool.acquire() as c:
        print("\n  games in odds_archive per year, by source:")
        for r in await c.fetch("""
            SELECT date_part('year',game_date)::int y, source,
                   count(DISTINCT (game_date,home_team_id,away_team_id)) g
            FROM odds_archive WHERE sport='mlb' AND market='moneyline'
            GROUP BY 1,2 ORDER BY 1,2"""):
            print(f"    {r['y']}  {r['source']:<14} {r['g']:>6,}")

        print("\n  cross-source agreement on shared games (de-vigged home ML):")
        for other in ("sbr_mlb", "espn_core"):
            r = await c.fetchrow(f"""
                WITH a AS (SELECT game_date,home_team_id,away_team_id,avg({IMPLIED}) p
                             FROM odds_archive WHERE sport='mlb' AND market='moneyline'
                              AND side='home' AND source=$1 AND price IS NOT NULL
                              AND NOT is_live GROUP BY 1,2,3),
                     b AS (SELECT game_date,home_team_id,away_team_id,avg({IMPLIED}) p
                             FROM odds_archive WHERE sport='mlb' AND market='moneyline'
                              AND side='home' AND source=$2 AND price IS NOT NULL
                              AND NOT is_live GROUP BY 1,2,3)
                SELECT count(*) n, round(avg(abs(a.p-b.p))::numeric,4) mad,
                       round(corr(a.p,b.p)::numeric,4) r
                FROM a JOIN b USING (game_date,home_team_id,away_team_id)""",
                SOURCE, other)
            if r and r["n"]:
                print(f"    vs {other:<11} n={r['n']:>6,}  meanAbsDiff={r['mad']}"
                      f"  corr={r['r']}")
            else:
                print(f"    vs {other:<11} no shared games")

        print("\n  calibration of the newly-filled seasons (2022-2024):")
        for r in await c.fetch(f"""
            WITH p AS (SELECT game_date,home_team_id,away_team_id,
                  avg({IMPLIED}) FILTER (WHERE side='home') hp,
                  avg({IMPLIED}) FILTER (WHERE side='away') ap
                FROM odds_archive WHERE sport='mlb' AND market='moneyline' AND source=$1
                  AND price IS NOT NULL AND date_part('year',game_date) BETWEEN 2022 AND 2024
                GROUP BY 1,2,3),
            j AS (SELECT p.hp/(p.hp+p.ap) fair, (g.home_score>g.away_score)::int won
                FROM p JOIN game_result g ON g.sport='mlb' AND g.game_date=p.game_date
                  AND g.home_team_id=p.home_team_id AND g.away_team_id=p.away_team_id)
            SELECT width_bucket(fair,0.3,0.75,6) b, count(*) n,
                   round(avg(fair)::numeric,3) implied, round(avg(won)::numeric,3) realised
            FROM j GROUP BY 1 ORDER BY 1""", SOURCE):
            print(f"    implied={r['implied']}  realised={r['realised']}  n={r['n']:>5,}")

        r = await c.fetchrow("""
            SELECT count(*) FILTER (WHERE side='home') h, count(*) FILTER (WHERE side='away') a,
                   count(*) FILTER (WHERE price IS NOT NULL) priced
            FROM odds_archive WHERE sport='mlb' AND market='spread' AND source=$1""", SOURCE)
        print(f"\n  new spread rows are two-sided: home={r['h']:,} away={r['a']:,}"
              f" priced={r['priced']:,}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()

    pool = await db.get_pool()
    if args.verify_only:
        await verify(pool)
        return

    d = pd.read_csv(SRC, low_memory=False)
    print(f"read {len(d):,} rows from {SRC.name}", flush=True)

    odds, results, stats = build(d)
    print(f"  games {stats['games']:,} | odds rows {stats['rows']:,} | "
          f"results {len(results):,} | unmapped {stats['unmapped']} | "
          f"no score {stats['no_score']}", flush=True)

    # Clear BOTH tables this loader owns before writing, or a re-run accumulates
    # rather than replaces -- see clear_source's own docstring on the
    # 28,057 -> 55,756 incident.
    await clear_source(pool, SOURCE, tables=("odds_archive", "game_result"))

    print(f"odds_archive: {await insert(pool, 'odds_archive', OC, odds):,} offered", flush=True)
    print(f"game_result:  {await insert(pool, 'game_result', RC, results):,} offered", flush=True)
    await verify(pool)


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
