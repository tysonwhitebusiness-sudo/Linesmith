"""
Load football-data.co.uk's closing 1X2 files into `odds_import_staging`.

EPL had **400** trainable games and MLS **871** — one season each, because ESPN
core publishes about one season and neither league had a second source.
football-data has been free for both for over a decade. `USA.csv` had been
sitting on disk unread since 2026-08-31; the England files were never
downloaded until the operator supplied them on 2026-09-01.

  EPL   4,200 matches, 2015-08-08 -> 2026-08-31, 11 complete seasons
  MLS   6,130 matches, 2012-03-10 -> 2026-08-24, 15 seasons

One loader, two leagues: the odds columns are identically named in both files,
only the team and score columns differ, so the difference is a four-key schema
dict rather than a second script.

============ THE SCHEMA DRIFTS MID-HISTORY, AND IT DRIFTS SILENTLY ============

The England files change columns partway through their own history:

    2015-2019   PSCH/PSCD/PSCA   PSH/PSD/PSA   B365H/B365D/B365A
    2020-2026   PSCH/PSCD/PSCA   MaxCH/...     AvgCH/...   B365CH/...

Measured fill across all 4,200 rows: **PSCH 4,010**, but MaxCH / AvgCH / B365CH
only **2,680**. `PSCH` (Pinnacle closing) is the ONLY closing column present in
all eleven seasons — a loader keyed on `AvgCH` silently drops six of them and
looks entirely correct doing it, because the remaining five seasons parse fine.

So every book is optional and missing columns are skipped, never assumed.

The `C` matters: `PSCH` is Pinnacle's CLOSING price and `PSH` is its earlier
one. Both are loaded — close into `price`, the earlier number into
`open_price` — which is the only reason EPL gets opening lines at all.

============ THE TEAM CROSSWALK ============

football-data names clubs its own way and, unlike nflverse and CFBD, publishes
no id of any kind. Resolution is by normalized name against ESPN's own
per-season team lists for `eng.1` and `usa.1`, 2012-2026 — which is where the
historical clubs live, since our archive only held the 23 EPL sides that
appeared in 2025-26 and football-data spans 35.

That resolves 32 of 35 EPL names and 19 of 31 MLS names automatically. The rest
are listed explicitly below. **Middlesbrough is absent from ESPN's own 2016 and
2017 season lists** even though it played that season; its id was fetched
directly from ESPN (`.../eng.1/teams/369` returns "Middlesbrough") rather than
guessed, and is recorded as a verified constant.

MLS's ESPN team list also contains six entries that are not MLS clubs at all —
AS Roma, Chelsea, Liga MX, MLS All-Stars and two "TBD" placeholders, all
friendlies-and-fixtures noise. They are excluded, the same way the existing
importer excludes All-Star and 4 Nations sides.

Chivas USA is NOT excluded: defunct since 2014, but a real club with a real
ESPN id (4772) that really played these matches, and this is a historical
archive.

============ VERIFICATION ============

There is no shared event id here, so the check is the one gate 4.6 uses:
resolve both sides, join to `espn_core` on the team pair and the date, and
require the SCORES to be identical. A wrong name map cannot survive that — it
would have to produce a real game between the wrong teams on the right day with
the right score.

Usage (from python-odds-service/):
    ./.venv/Scripts/python.exe -u import_footballdata.py [--report]
Then: node scripts/gate/promote_odds.mjs
"""

import argparse
import asyncio
import glob
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, "src")
sys.path.insert(0, ".")
import db  # noqa: E402
from entity_resolution import strip_accents  # noqa: E402
from import_odds_staging import (game_result_row, impossible_price,  # noqa: E402
                                 insert, insert_results)

DL = "C:/Users/occy3/Downloads"
CACHE = Path(__file__).parent / ".crosswalk_cache" / "soccer_teams.json"
SOURCE = "footballdata"
SOURCE_PRIORITY = 70  # this repo's own table: closing 1X2, multi-book

LEAGUES = {
    "soccer_epl": {"glob": f"{DL}/E0*.csv", "espn": "eng.1",
                   "home": "HomeTeam", "away": "AwayTeam",
                   "hg": "FTHG", "ag": "FTAG"},
    "soccer_mls": {"glob": f"{DL}/USA.csv", "espn": "usa.1",
                   "home": "Home", "away": "Away",
                   "hg": "HG", "ag": "AG"},
}

# (close_home, close_draw, close_away, open_home, open_draw, open_away, label).
# EVERY ONE IS OPTIONAL — see the docstring. The England files carry PSC across
# all eleven seasons and MaxC/AvgC/B365C on only five.
BOOKS = [
    ("PSCH", "PSCD", "PSCA", "PSH", "PSD", "PSA", "pinnacle"),
    ("MaxCH", "MaxCD", "MaxCA", None, None, None, "market_max"),
    ("AvgCH", "AvgCD", "AvgCA", None, None, None, "market_avg"),
    ("B365CH", "B365CD", "B365CA", "B365H", "B365D", "B365A", "bet365"),
    ("BFECH", "BFECD", "BFECA", None, None, None, "betfair_exchange"),
]

# football-data spelling -> ESPN shortDisplayName, resolved through the cached
# per-season lists. Only the names automatic normalization does not catch.
ALIAS = {
    "soccer_epl": {"norwich": "Norwich City", "tottenham": "Spurs"},
    "soccer_mls": {
        "atlantautd": "Atlanta", "chicagofire": "Chicago",
        "houstondynamo": "Houston", "intermiami": "Miami",
        "losangelesfc": "LAFC", "losangelesgalaxy": "LA Galaxy",
        "minnesotaunited": "Minnesota", "newyorkcity": "NYCFC",
        "newyorkredbulls": "Red Bull NY", "orlandocity": "Orlando",
        "seattlesounders": "Seattle", "stlouiscity": "St. Louis",
    },
}

# Fetched directly from ESPN because its own 2016/2017 eng.1 season lists omit
# the club that actually played that season. A verified id, not a guess.
EXTRA_TEAMS = {"soccer_epl": {"middlesbrough": "369"}}

# In ESPN's usa.1 team list but not MLS clubs — friendlies and fixture
# placeholders. Same category as the existing importer's All-Star entries.
PHANTOM = {"soccer_mls": {"104", "363", "20279", "9817", "18888", "18887"}}


def norm(s):
    return "".join(ch for ch in strip_accents(str(s)).lower() if ch.isalnum())


def build_index(sport):
    ref = json.load(open(CACHE, encoding="utf-8"))[sport]
    phantom = PHANTOM.get(sport, set())
    idx = {}
    for tid, t in ref.items():
        if tid in phantom:
            continue
        for v in (t.get("name"), t.get("short"), t.get("abbr")):
            if v:
                idx.setdefault(norm(v), tid)
    for raw, espn_short in ALIAS.get(sport, {}).items():
        tid = idx.get(norm(espn_short))
        if tid:
            idx[raw] = tid
    idx.update(EXTRA_TEAMS.get(sport, {}))
    return idx


def dec(v):
    n = pd.to_numeric(v, errors="coerce")
    if pd.isna(n) or float(n) <= 1.01:
        return None
    return float(n)


def american(d):
    if d is None:
        return None
    return int(round((d - 1) * 100)) if d >= 2.0 else -int(round(100 / (d - 1)))


def ml_flag_for(book, booksum):
    # market_max is the best price across books, so summing below 1 is a
    # cross-book arbitrage rather than a broken market — same reasoning as
    # import_tennis.py, same flag.
    if book == "market_max":
        return "best_of_market"
    if booksum is None:
        return "missing"
    return "three_way" if booksum >= 1.0 else "sub_one_not_two_way"


def build(sport, cfg, idx, today):
    rows, results = [], []
    stats = {"rows": 0, "unresolved_team": 0, "no_date": 0, "no_result": 0}
    seen = set()
    for path in sorted(glob.glob(cfg["glob"])):
        d = pd.read_csv(path, low_memory=False, encoding="utf-8-sig")
        have = [b for b in BOOKS if b[0] in d.columns]
        for r in d.to_dict("records"):
            stats["rows"] += 1
            dt = pd.to_datetime(r.get("Date"), dayfirst=True, errors="coerce")
            if pd.isna(dt):
                stats["no_date"] += 1
                continue
            game_date = dt.date()
            hraw, araw = str(r.get(cfg["home"])), str(r.get(cfg["away"]))
            hid, aid = idx.get(norm(hraw)), idx.get(norm(araw))
            if not hid or not aid:
                stats["unresolved_team"] += 1
            # No event id in these files, so the natural key is the match
            # itself. Two clubs do not play twice on one day.
            key = f"{sport}|{game_date}|{norm(hraw)}|{norm(araw)}"
            if key in seen:
                continue
            seen.add(key)

            for ch, cd, ca, oh, od, oa, book in have:
                dh, dd, da = dec(r.get(ch)), dec(r.get(cd)), dec(r.get(ca))
                if dh is None and dd is None and da is None:
                    continue
                booksum = None
                if dh and dd and da:
                    booksum = 1 / dh + 1 / dd + 1 / da
                base = dict(
                    sport=sport, event_ref=None, game_date=game_date,
                    home_team_raw=hraw, away_team_raw=araw,
                    home_team_id=hid, away_team_id=aid,
                    market="moneyline", line=None, open_line=None,
                    bookmaker=book, provider=SOURCE, source=SOURCE,
                    source_priority=SOURCE_PRIORITY, booksum=booksum,
                    ml_flag=ml_flag_for(book, booksum),
                    resolution_status="resolved" if (hid and aid) else "unresolved",
                    resolution_note=None if (hid and aid) else "unresolved_team",
                )
                for side, close, open_ in (("home", dh, dec(r.get(oh)) if oh else None),
                                           ("draw", dd, dec(r.get(od)) if od else None),
                                           ("away", da, dec(r.get(oa)) if oa else None)):
                    price = american(close)
                    if price is None:
                        continue
                    row = {**base, "side": side, "price": price,
                           "open_price": american(open_)}
                    if impossible_price("moneyline", price):
                        row["resolution_status"] = "unresolved"
                        row["resolution_note"] = "impossible_american_price"
                    rows.append(row)

            hg = pd.to_numeric(r.get(cfg["hg"]), errors="coerce")
            ag = pd.to_numeric(r.get(cfg["ag"]), errors="coerce")
            if pd.isna(hg) or pd.isna(ag):
                stats["no_result"] += 1
                continue
            gr = game_result_row(sport, None, game_date, hraw, araw, hid, aid,
                                 int(hg), int(ag), None, SOURCE, today)
            if gr:
                results.append(gr)
    return rows, results, stats


VERIFY_SQL = """
WITH f AS (SELECT DISTINCT game_date, home_team_id, away_team_id, home_score, away_score
           FROM game_result WHERE sport=$1 AND source=$2 AND home_team_id IS NOT NULL),
     e AS (SELECT DISTINCT game_date, home_team_id, away_team_id, home_score, away_score
           FROM game_result WHERE sport=$1 AND source='espn_core' AND home_team_id IS NOT NULL)
SELECT count(*)::int n,
  count(*) FILTER (WHERE f.home_score=e.home_score AND f.away_score=e.away_score)::int exact,
  count(*) FILTER (WHERE f.home_score=e.away_score AND f.away_score=e.home_score
                     AND f.home_score<>f.away_score)::int flipped
FROM f JOIN e ON e.home_team_id=f.home_team_id AND e.away_team_id=f.away_team_id
   AND e.game_date BETWEEN f.game_date-1 AND f.game_date+1
"""


async def verify(pool, sport):
    async with pool.acquire() as c:
        return await c.fetchrow(VERIFY_SQL, sport, SOURCE)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()
    pool = await db.get_pool()
    today = datetime.now(timezone.utc).date()

    all_rows, all_results = [], []
    for sport, cfg in LEAGUES.items():
        idx = build_index(sport)
        rows, results, stats = build(sport, cfg, idx, today)
        unresolved_names = sorted({r["home_team_raw"] for r in rows if not r["home_team_id"]} |
                                  {r["away_team_raw"] for r in rows if not r["away_team_id"]})
        print(f"{sport}: {stats['rows']:,} source rows -> {len(rows):,} odds, "
              f"{len(results):,} results  {stats}")
        if unresolved_names:
            print(f"  UNRESOLVED NAMES: {' | '.join(unresolved_names)}")
        all_rows += rows
        all_results += results

    if args.report:
        print(f"\n--report: {len(all_rows):,} rows built, nothing written")
        return

    async with pool.acquire() as c:
        n = await c.execute("DELETE FROM odds_import_staging WHERE source=$1", SOURCE)
        print(f"cleared prior staging rows for {SOURCE}: {n}")
    print(f"staged: {await insert(pool, all_rows):,}")
    print(f"game_result: {await insert_results(pool, all_results):,} offered")

    for sport in LEAGUES:
        r = await verify(pool, sport)
        if not r["n"]:
            print(f"\n{sport}: no espn_core overlap to verify against")
            continue
        print(f"\n{sport} SCORE VERIFICATION vs espn_core on {r['n']} shared games:")
        print(f"  identical         {r['exact']} ({r['exact']/r['n']*100:.1f}%)")
        print(f"  home/away flipped {r['flipped']}  (must be 0)")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
