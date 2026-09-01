"""
Load the SBR MLB workbooks into `odds_import_staging` as RAW PRICES.

MLB was never short of history — it had **37,907** games with a market number
and a result back to 2010. But the deep part of that lives in
`historical_odds` as **de-vigged consensus probabilities**, where every row
sums to exactly 1.0000, and only 4,593 games had raw American prices.

That distinction decides what can be asked of it. A de-vigged probability is
fine — arguably ideal — for "does the model beat the market's number". It
cannot express real ROI, CLV in price terms, or the vig itself, and
`odds_archive`'s own migration says as much: `historical_odds` was "useless for
the de-vig backtest" because the overround had already been divided out.

The raw prices were on disk the whole time. These are the same twelve
workbooks that were de-vigged into `historical_odds` in the first place.

Delivers **28,060 games, 2010–2021**, 100% closing-moneyline fill. 2020 is 949
games because that was the 60-game COVID season, not a gap.

`historical_odds` is left completely untouched — operator decision, 2026-09-01.
Different semantics behind two names is exactly what made the first one hard to
use; overwriting it would repeat that.

============ THREE LAYOUTS, AND THE PRICE COLUMNS HAVE NO NAMES ============

The twelve files do not share a schema, and the drift moves the unnamed
columns:

    2010-2013  21 cols  Open OU | Unnamed:18   Close OU | Unnamed:20
    2014-2019  23 cols  Run Line | Unnamed:18  Open OU | Unnamed:20  Close OU | Unnamed:22
    2020-2021  23 cols  same, spelled RunLine / OpenOU / CloseOU

So `Unnamed: 18` is the OPENING TOTAL'S PRICE in the 2010 file and the RUN
LINE'S PRICE in the 2019 one. A loader written against either and pointed at
the other reads a run line as a total price and never says a word — the same
failure that cost NHL its entire moneyline history, one file family over.

CURRENT.md's standing warning applies literally here: on SBR pages `CloseOU`
was the OPENING total with the close in `Unnamed: 14`. **Identify columns by
value distribution, not by name**, which is what was done below.

============ TWO ROWS PER GAME, AND THEY ARE NOT THE SAME MARKET ============

Each game is two rows, visitor then home. The moneyline splits the obvious way,
but the TOTAL does not: both rows repeat the same line and carry DIFFERENT
prices, because one is the over and one is the under.

Which is which was measured, not assumed, over 26,642 games with a decided
total:

    realised over rate      .4933
    row 1 (visitor) price   implied .5227, corr with over  **+0.0303**
    row 2 (home) price      implied .5236, corr with over  **-0.0291**

Equal and opposite. Both rows cannot be the over, and the one whose implied
probability rises with the over happening is the one that pays for it: **row 1
is the OVER, row 2 the UNDER.** The correlations are small in absolute terms
because an MLB total is close to a coin flip; against 26,642 games the sign
symmetry is roughly five standard errors either way.

============ EVERYTHING ELSE, ALSO CONFIRMED AGAINST OUTCOMES ============

  moneyline   booksum 1.0291. Home favourites (row 2 the shorter price) win
              .5906, home dogs .4337 — a +15.7pp gap, so visitor-then-home is
              the right way round.
  run line    home values are -1.5/+1.5 (plus a handful of 0.5 and 1.0),
              corr(home run line, home margin) = **-0.173** — already NEGATIVE
              when home is favoured, which is our archive's convention. No
              negation, unlike nflverse. Checked because the sources disagree.
  teams       34 distinct abbreviations, **0 unmapped** by the existing
              MLB_ABBR_TO_ID in import_odds_staging.py.
  dates       carry no year: "320" is March 20 and "1001" is October 1. The
              year comes from the filename, which is safe because a season runs
              March-October and never crosses a new year inside one file.

Source is `sbr_mlb`, not `sbr`. It genuinely is SBR — `provider` says so — but
`import_odds_staging.py` owns the `sbr` source and its `--truncate` deletes it,
so sharing the name would let one loader silently delete the other's work.

Usage (from python-odds-service/):
    ./.venv/Scripts/python.exe -u import_mlb_sbr.py [--report]
Then: node scripts/gate/promote_odds.mjs
"""

import argparse
import asyncio
import glob
import sys
import warnings
from datetime import date, datetime, timezone

import pandas as pd

sys.path.insert(0, "src")
sys.path.insert(0, ".")
import db  # noqa: E402
from import_odds_staging import (booksum_and_flag, clear_source,  # noqa: E402
                                 MLB_ABBR_TO_ID, game_result_row,  # noqa: E402
                                 impossible_price, insert, insert_results)

warnings.filterwarnings("ignore")

PATTERN = "C:/Users/occy3/Downloads/mlb-odds-*.xlsx"
SOURCE = "sbr_mlb"
SOURCE_PRIORITY = 100  # SBR: real closing lines, both sides

# (open_total, open_total_price, close_total, close_total_price,
#  run_line, run_line_price) by column count. See the docstring — `Unnamed: 18`
# means two different things depending on the file.
LAYOUT = {
    21: ("Open OU", "Unnamed: 18", "Close OU", "Unnamed: 20", None, None),
    23: ("Open OU", "Unnamed: 20", "Close OU", "Unnamed: 22", "Run Line", "Unnamed: 18"),
}

# 2020 and 2021 drop the spaces. Normalised so LAYOUT stays a two-entry dict
# rather than a four-entry one describing the same two shapes.
RENAME = {"RunLine": "Run Line", "OpenOU": "Open OU", "CloseOU": "Close OU"}

MAX_TOTAL, MIN_TOTAL = 20.0, 5.0     # a real MLB total; one file has a 98.0
MAX_RUN_LINE = 3.0                   # real run lines are +-1.5


def num(v):
    n = pd.to_numeric(v, errors="coerce")
    return None if pd.isna(n) else float(n)


def integer(v):
    n = num(v)
    return None if n is None else int(round(n))


def parse_date(raw, year):
    """"320" -> March 20, "1001" -> October 1. No year in the file; it comes
    from the filename, which is safe because an MLB season runs March to
    October and never crosses a new year inside one workbook."""
    n = integer(raw)
    if n is None:
        return None
    s = f"{n:d}"
    if len(s) == 3:
        mo, dy = int(s[0]), int(s[1:])
    elif len(s) == 4:
        mo, dy = int(s[:2]), int(s[2:])
    else:
        return None
    if not (1 <= mo <= 12 and 1 <= dy <= 31):
        return None
    try:
        return date(year, mo, dy)
    except ValueError:
        return None


def clamp(v, lo, hi):
    return None if v is None or not (lo <= abs(v) <= hi) else v


def build(today):
    rows, results = [], []
    stats = {"games": 0, "unpaired": 0, "no_date": 0, "no_result": 0, "bad_total": 0}
    for path in sorted(glob.glob(PATTERN)):
        year = int(path[-9:-5])
        d = pd.read_excel(path)
        d.columns = [RENAME.get(str(c), str(c)) for c in d.columns]
        if len(d.columns) not in LAYOUT:
            raise SystemExit(f"{path}: unknown layout, {len(d.columns)} columns")
        otl, otp, ctl, ctp, rlc, rlp = LAYOUT[len(d.columns)]

        for i in range(0, len(d) - 1, 2):
            a, b = d.iloc[i], d.iloc[i + 1]
            # Visitor row then home row. 'N' is a neutral-site game (the 2019
            # Japan series); the pairing still holds, the second row is still
            # the nominal home side.
            if str(a.VH).upper() not in ("V", "N") or str(b.VH).upper() not in ("H", "N"):
                stats["unpaired"] += 1
                continue
            game_date = parse_date(a.Date, year)
            if game_date is None:
                stats["no_date"] += 1
                continue
            stats["games"] += 1

            aabbr, habbr = str(a.Team).upper(), str(b.Team).upper()
            aid = MLB_ABBR_TO_ID.get(aabbr)
            hid = MLB_ABBR_TO_ID.get(habbr)

            # DOUBLEHEADERS ARE REAL, AND event_ref IS WHAT KEEPS THEM.
            # Measured: 358 of these 28,060 games share a (date, away, home)
            # key with another game. With event_ref NULL, game_result's unique
            # index collapsed every one of them and 361 games vanished on
            # insert with no error -- the exact failure migration
            # 20260901170000 was written for, walked into from the other side.
            #
            # SBR's rotation number distinguishes all 358, and it is the
            # source's own identifier for the game. PREFIXED `rot` on purpose:
            # a bare number in event_ref alongside ESPN's 401772510s is an
            # invitation to join two id systems that have nothing to do with
            # each other, which is the single most expensive mistake in this
            # repo's history.
            rot = integer(a.Rot)
            base = dict(
                sport="mlb", event_ref=f"rot{rot}" if rot is not None else None,
                game_date=game_date,
                home_team_raw=habbr, away_team_raw=aabbr,
                home_team_id=str(hid) if hid else None,
                away_team_id=str(aid) if aid else None,
                bookmaker="sbr_consensus", provider="sbr", source=SOURCE,
                source_priority=SOURCE_PRIORITY,
                **dict(zip(("booksum", "ml_flag"),
                           booksum_and_flag(integer(b.Close), integer(a.Close)))),
                resolution_status="resolved" if (hid and aid) else "unresolved",
                resolution_note=None if (hid and aid) else "unresolved_team",
            )

            ct = clamp(num(a[ctl]), MIN_TOTAL, MAX_TOTAL)
            ot = clamp(num(a[otl]), MIN_TOTAL, MAX_TOTAL)
            if num(a[ctl]) is not None and ct is None:
                stats["bad_total"] += 1
            rl_home = clamp(num(b[rlc]), 0, MAX_RUN_LINE) if rlc else None
            rl_away = clamp(num(a[rlc]), 0, MAX_RUN_LINE) if rlc else None

            for market, side, line, price, oline, oprice in (
                ("moneyline", "home", None, integer(b.Close), None, integer(b.Open)),
                ("moneyline", "away", None, integer(a.Close), None, integer(a.Open)),
                # Row 1 is the OVER, row 2 the UNDER — measured, see docstring.
                ("total", "over", ct, integer(a[ctp]), ot, integer(a[otp])),
                ("total", "under", ct, integer(b[ctp]), ot, integer(b[otp])),
                ("spread", "home", rl_home, integer(b[rlp]) if rlp else None, None, None),
                ("spread", "away", rl_away, integer(a[rlp]) if rlp else None, None, None),
            ):
                if price is None and line is None:
                    continue
                row = {**base, "market": market, "side": side, "line": line,
                       "price": price, "open_line": oline, "open_price": oprice}
                if impossible_price(market, price):
                    row["resolution_status"] = "unresolved"
                    row["resolution_note"] = "impossible_american_price"
                rows.append(row)

            hs, as_ = integer(b.Final), integer(a.Final)
            gr = game_result_row("mlb", base["event_ref"], game_date, habbr, aabbr, hid, aid,
                                 hs, as_, None, SOURCE, today)
            if gr:
                results.append(gr)
            else:
                stats["no_result"] += 1
    return rows, results, stats


# Two cheap queries rather than one expensive one. The first version joined
# game_result to odds_import_staging (1.1M rows) per game and then to
# historical_odds, and could not finish inside any sane timeout. Splitting it
# costs nothing in rigour: the score check and the price check are independent
# claims and each reads one small pair of tables.
SCORE_SQL = """
WITH mine AS (
  SELECT game_date, home_team_id::int hid, away_team_id::int aid,
         home_score, away_score,
         count(*) OVER (PARTITION BY game_date, home_team_id, away_team_id) same_day
  FROM game_result WHERE sport='mlb' AND source=$1 AND home_team_id IS NOT NULL)
SELECT (m.same_day > 1) AS doubleheader, count(*)::int n,
  count(*) FILTER (WHERE m.home_score=h.home_score AND m.away_score=h.away_score)::int exact
FROM mine m JOIN historical_odds h
  ON h.game_date=m.game_date AND h.home_team_id=m.hid AND h.away_team_id=m.aid
GROUP BY 1 ORDER BY 1
"""

PRICE_SQL = """
WITH ml AS (
  SELECT game_date, home_team_id::int hid, away_team_id::int aid,
         max(price) FILTER (WHERE side='home') hml,
         max(price) FILTER (WHERE side='away') aml
  FROM odds_import_staging
  WHERE source=$1 AND market='moneyline' AND price IS NOT NULL AND home_team_id IS NOT NULL
  GROUP BY 1,2,3)
SELECT count(*)::int n, avg(abs(
    (CASE WHEN m.hml>0 THEN 100.0/(m.hml+100) ELSE (-m.hml)/((-m.hml)+100.0) END)
    / NULLIF((CASE WHEN m.hml>0 THEN 100.0/(m.hml+100) ELSE (-m.hml)/((-m.hml)+100.0) END)
           + (CASE WHEN m.aml>0 THEN 100.0/(m.aml+100) ELSE (-m.aml)/((-m.aml)+100.0) END), 0)
    - h.ml_home_consensus_prob))::float gap
FROM ml m JOIN historical_odds h
  ON h.game_date=m.game_date AND h.home_team_id=m.hid AND h.away_team_id=m.aid
WHERE m.hml IS NOT NULL AND m.aml IS NOT NULL AND h.ml_home_consensus_prob IS NOT NULL
"""


async def verify(pool):
    """`historical_odds` holds an INDEPENDENT EARLIER PARSE of these same twelve
    workbooks, de-vigged into consensus probabilities. There is no ESPN overlap
    to check against — espn_core's MLB starts in 2025 and these files end in
    2021 — so this is the check available, and it is a real one: two separate
    parses of the same source must agree on the scores exactly, and my
    de-vigged home probability must land on their consensus number.

    A column mis-read shows up immediately. Reading the run line as a total
    price, or the visitor row as the home row, moves the implied probability far
    more than the rounding difference between two de-vig implementations.

    SPLIT BY DOUBLEHEADER, because the headline number is misleading otherwise.
    Measured: single games agree on the score **100.0%** (27,262 of 27,269),
    while doubleheaders sit at **50.4%** — which is not a parse disagreement but
    the signature of `historical_odds` having COLLAPSED them. It has no
    event_ref, so its natural key keeps one game per (date, team pair) and the
    join then matches both of mine against their surviving one. Pooling the two
    reports 98.7% and hides both facts.
    """
    async with pool.acquire() as c:
        async with c.transaction():
            await c.execute("SET LOCAL statement_timeout = '600s'")
            scores = await c.fetch(SCORE_SQL, SOURCE)
            price = await c.fetchrow(PRICE_SQL, SOURCE)
    return scores, price


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()
    today = datetime.now(timezone.utc).date()

    rows, results, stats = build(today)
    print(f"mlb sbr: {stats['games']:,} games -> {len(rows):,} odds rows, "
          f"{len(results):,} results")
    print(f"  {stats}")

    if args.report:
        print("--report: nothing written")
        return

    pool = await db.get_pool()
    for t, n in (await clear_source(pool, SOURCE)).items():
        print(f"cleared {t} for {SOURCE}: {n}")
    print(f"staged: {await insert(pool, rows):,}")
    print(f"game_result: {await insert_results(pool, results):,} offered")

    scores, price = await verify(pool)
    if not scores:
        print("\nno historical_odds overlap to verify against")
        return
    print("\nVERIFICATION against historical_odds' independent parse of the same files:")
    for r in scores:
        kind = "doubleheaders" if r["doubleheader"] else "single games"
        print(f"  {kind:<14} {r['exact']}/{r['n']} scores identical "
              f"({r['exact'] / r['n'] * 100:.1f}%)")
    if price and price["n"]:
        print(f"  mean |my de-vigged home prob - their consensus|  "
              f"{price['gap']:.4f}  (n={price['n']:,})")
    print("  doubleheaders sit near 50% because historical_odds COLLAPSED them —"
          " it has no event_ref. Not a parse disagreement.")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
