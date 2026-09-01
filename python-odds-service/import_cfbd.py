"""
Load CollegeFootballData's betting lines into `odds_import_staging`, resolved.

CFB had **849** trainable games before this — one FBS season, because ESPN core
publishes about one season and CFB had no second source. CFBD is free with a
registered key, goes back to 2013, and was in this repo's own source-priority
table at 80 without ever being called.

Delivers **13,728** games with a spread and **13,223** with a total (2013–2025),
plus **4,137** with a moneyline. Moneylines do not exist at CFBD before 2021 —
that is the source, not the loader, and it is why CFB's spread/total model has
thirteen seasons and its moneyline model has five.

============ THE ENTITY QUESTION, ANSWERED BY JOINING, NOT BY LOOKING ============

CFBD's team ids LOOK like ESPN's and its game ids LOOK like ESPN event ids. The
whole point of this project's entity discipline is that looking is not evidence:
30 of 39 ESPN NHL team ids "matched" `player_game_history` and every one of them
was wrong.

So it was tested. Taking every CFBD game whose id equals an `event_ref` already
in `odds_archive` from `espn_core` — the same game, by ESPN's own id — and
comparing the resolved team ids:

    942 shared games
      team ids AGREE   942 (100.0%)
      home/away SWAP     0
      neither            0

**CFBD's ids ARE ESPN's**, so CFB is an identity mapping and the 147-team name
crosswalk this was scoped to need is not needed. That is a real answer, and it
is only trustworthy because it came from a join on real games rather than from
the ids sharing a shape.

============ EVERY SEMANTIC CONFIRMED AGAINST OUTCOMES ============

Measured over 38,394 spread rows and 34,893 totals from the cached files:

  spread      corr(spread, home margin) = **-0.6934**, mean -5.36 against a
              mean home margin of +5.29. So CFBD already uses OUR convention —
              negative when the home team is favoured. **No negation**, unlike
              nflverse, whose sign is inverted. Checked rather than assumed
              precisely because the two sources disagree with each other.
  total       mean line 54.93 against an actual mean of 55.30, over rate .4850.
  moneyline   booksum 1.0431, home favourites win .7477.

============ KNOWN AND DELIBERATE ============

CFBD ships **12 provider spellings**, of which `DraftKings`/`Draft Kings` (117
rows) are one book, and `Caesars` / `Caesars (Pennsylvania)` / `Caesars
Sportsbook (Colorado)` are three regional skins of another. They are stored
**verbatim**, because every other source in `odds_archive` stores its provider
string verbatim too — `espn_core` holds "ESPN BET" and "Caesars Sportsbook (New
Jersey)" today. Canonicalising one source while leaving the rest raw would be
half a fix that reads like a whole one. Archive-wide canonicalisation is a
separate decision; CLAUDE.md's existing rule covers the LIVE tables
(`game_odds_book_lines`, `game_odds_history`, `prop_odds`), which predate this
archive.

`consensus` is an aggregate, not a book, and is stored under its own name so a
consumer can include or exclude it deliberately.

Fetches are CACHED PER (year, season type) because the API is flaky under load —
2016 postseason took three attempts and 2025 postseason took six across two
runs, returning 502s and 504s. A loader that re-fetches on every parse would
fail most times it ran.

Usage (from python-odds-service/):
    ./.venv/Scripts/python.exe -u import_cfbd.py [--refresh] [--report] [--verify]
Then: node scripts/gate/promote_odds.mjs
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, "src")
sys.path.insert(0, ".")
import db  # noqa: E402
from import_odds_staging import (clear_source,  # noqa: E402
                                 game_result_row, impossible_price,  # noqa: E402
                                 insert, insert_results)

CACHE = Path(__file__).parent / ".crosswalk_cache"
SOURCE = "cfbd"
SOURCE_PRIORITY = 80
SEASONS = range(2013, 2027)
API = "https://api.collegefootballdata.com/lines"


def api_key():
    env = (Path(__file__).parent.parent / ".env.local").read_text(encoding="utf-8")
    m = re.search(r"^CFBD_API_KEY=(.*)$", env, re.M)
    if not m:
        raise SystemExit("CFBD_API_KEY not found in .env.local")
    return m.group(1).strip().strip("\"'")


def fetch_all(refresh=False):
    """One file per (year, season type), retried. See the header: the API
    returns 502/504 under load often enough that a single-shot fetch is not a
    reliable way to load fourteen seasons."""
    CACHE.mkdir(exist_ok=True)
    key = api_key()
    with httpx.Client(timeout=300, headers={"Authorization": f"Bearer {key}"}) as c:
        for yr in SEASONS:
            for st in ("regular", "postseason"):
                f = CACHE / f"cfbd_lines_{yr}_{st}.json"
                if f.exists() and not refresh:
                    continue
                for attempt in range(6):
                    try:
                        r = c.get(API, params={"year": yr, "seasonType": st})
                        if r.status_code == 200:
                            f.write_text(json.dumps(r.json()), encoding="utf-8")
                            print(f"    {yr} {st}: {len(r.json())}", flush=True)
                            break
                        print(f"    {yr} {st}: HTTP {r.status_code}, retrying", flush=True)
                    except Exception as e:
                        print(f"    {yr} {st}: {type(e).__name__}, retrying", flush=True)
                    time.sleep(4 * (attempt + 1))
                else:
                    raise SystemExit(f"CFBD {yr} {st} failed after 6 attempts — rerun later")
    return sorted(CACHE.glob("cfbd_lines_*.json"))


def load_cached():
    files = sorted(CACHE.glob("cfbd_lines_*.json"))
    if not files:
        raise SystemExit("no cached CFBD files — run without --report first")
    out = []
    for f in files:
        out.extend(json.load(open(f, encoding="utf-8")))
    return out


def implied(a):
    return None if a is None else (100.0 / (a + 100.0) if a > 0 else -a / (-a + 100.0))


def booksum_and_flag(h, a):
    hi, ai = implied(h), implied(a)
    if hi is None or ai is None:
        return None, "missing"
    bs = hi + ai
    return bs, ("two_way" if bs >= 1.0 else "sub_one_not_two_way")


def integer(v):
    return None if v is None else int(round(float(v)))


def build(games, today):
    rows, results, skipped = [], [], {"no_date": 0, "no_teams": 0, "no_lines": 0}
    seen_events = set()
    for g in games:
        d = (g.get("startDate") or "")[:10]
        if not d:
            skipped["no_date"] += 1
            continue
        game_date = datetime.strptime(d, "%Y-%m-%d").date()
        hid, aid = g.get("homeTeamId"), g.get("awayTeamId")
        if not hid or not aid:
            skipped["no_teams"] += 1
            continue
        event_ref = str(g["id"]) if g.get("id") else None

        for l in (g.get("lines") or []):
            book = l.get("provider")
            bs, flag = booksum_and_flag(l.get("homeMoneyline"), l.get("awayMoneyline"))
            base = dict(
                sport="cfb", event_ref=event_ref, game_date=game_date,
                home_team_raw=g.get("homeTeam"), away_team_raw=g.get("awayTeam"),
                home_team_id=str(hid), away_team_id=str(aid),
                bookmaker=book, provider=SOURCE, source=SOURCE,
                source_priority=SOURCE_PRIORITY, booksum=bs, ml_flag=flag,
                resolution_status="resolved", resolution_note=None,
            )
            # CFBD's `spread` is ALREADY the home line in our convention
            # (negative = home favoured), confirmed at corr -0.69 against real
            # margins. The away side is its mirror.
            sp = l.get("spread")
            spo = l.get("spreadOpen")
            # A TOTAL IS A POSITIVE NUMBER OF POINTS. CFBD publishes an
            # overUnder of -1 for Georgia/Florida on 2018-10-27 from Caesars --
            # a placeholder wearing a number, the same class as ESPN's
            # close_total == 0. Two rows, but a negative total would poison any
            # over/under rate computed without noticing it.
            pos = lambda v: v if (v is not None and v > 0) else None  # noqa: E731
            tot, toto = pos(l.get("overUnder")), pos(l.get("overUnderOpen"))
            for market, side, line, price, oline in (
                ("moneyline", "home", None, integer(l.get("homeMoneyline")), None),
                ("moneyline", "away", None, integer(l.get("awayMoneyline")), None),
                ("spread", "home", sp, None, spo),
                ("spread", "away", None if sp is None else -sp, None,
                 None if spo is None else -spo),
                ("total", "over", tot, None, toto),
                ("total", "under", tot, None, toto),
            ):
                if price is None and line is None:
                    continue
                row = {**base, "market": market, "side": side, "line": line,
                       "price": price, "open_line": oline, "open_price": None}
                if impossible_price(market, price):
                    row["resolution_status"] = "unresolved"
                    row["resolution_note"] = "impossible_american_price"
                rows.append(row)

        if event_ref and event_ref not in seen_events:
            seen_events.add(event_ref)
            gr = game_result_row("cfb", event_ref, game_date, g.get("homeTeam"),
                                 g.get("awayTeam"), hid, aid,
                                 g.get("homeScore"), g.get("awayScore"),
                                 None, SOURCE, today)
            if gr:
                results.append(gr)
    return rows, results, skipped


async def verify(pool):
    """Join to espn_core on ESPN'S OWN EVENT ID and demand the team ids agree.
    See the header — this is what established that CFBD's ids are ESPN's rather
    than merely shaped like them."""
    async with pool.acquire() as c:
        return await c.fetchrow("""
            WITH n AS (SELECT DISTINCT event_ref, home_team_id, away_team_id
                       FROM odds_import_staging
                       WHERE source=$1 AND event_ref IS NOT NULL AND home_team_id IS NOT NULL),
                 e AS (SELECT DISTINCT event_ref, home_team_id, away_team_id
                       FROM odds_archive
                       WHERE sport='cfb' AND source='espn_core' AND event_ref IS NOT NULL)
            SELECT count(*)::int n,
              count(*) FILTER (WHERE n.home_team_id=e.home_team_id
                                 AND n.away_team_id=e.away_team_id)::int agree,
              count(*) FILTER (WHERE n.home_team_id=e.away_team_id
                                 AND n.away_team_id=e.home_team_id)::int swapped
            FROM n JOIN e USING (event_ref)
        """, SOURCE)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="re-fetch every season")
    ap.add_argument("--verify", action="store_true")
    args = ap.parse_args()
    pool = await db.get_pool()

    if args.verify:
        r = await verify(pool)
        print(f"event-id overlap with espn_core: {r['n']} games")
        print(f"  team ids agree      {r['agree']} ({r['agree']/max(r['n'],1)*100:.1f}%)")
        print(f"  home/away SWAPPED   {r['swapped']}  <- must be 0")
        return

    if args.refresh or not list(CACHE.glob("cfbd_lines_*.json")):
        fetch_all(args.refresh)
    games = load_cached()
    today = datetime.now(timezone.utc).date()
    print(f"cfbd: {len(games):,} game records across {len(SEASONS)} seasons")
    rows, results, skipped = build(games, today)
    print(f"built {len(rows):,} odds rows, {len(results):,} results; skipped {skipped}")

    if args.report:
        print("--report: nothing written")
        return

    for t, n in (await clear_source(pool, SOURCE)).items():
        print(f"cleared {t} for {SOURCE}: {n}")
    print(f"staged: {await insert(pool, rows):,}")
    print(f"game_result: {await insert_results(pool, results):,} offered")

    r = await verify(pool)
    print(f"\nEVENT-ID VERIFICATION against espn_core on {r['n']} shared games:")
    print(f"  team ids agree    {r['agree']} ({r['agree']/max(r['n'],1)*100:.1f}%)")
    print(f"  home/away swapped {r['swapped']}  (must be 0)")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
