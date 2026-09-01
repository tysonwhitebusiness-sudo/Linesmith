"""
Backfill historical game odds from ESPN's pickcenter, for the blocks the
Sportsbook Reviews archive cannot cover.

WHY THIS EXISTS
---------------
SBR is frozen after 2022-23 and is missing NHL 2020-21 entirely, and its
2022-23 pages are truncated (NBA stops 2023-01-16, NHL stops 2022-11-27).
ESPN's summary endpoint still carries a `pickcenter` block on completed games,
and it is FAST -- measured 0.027s/game at concurrency 12, 0.043s at 6.

MEASURED COVERAGE BOUNDARIES (probed 2026-08-31, both land on a season edge):
  NBA  pickcenter present through 2023-04-01, gone by 2023-11-01
  NHL  pickcenter present through 2024-04-01, gone by 2024-10-01

So this covers exactly four blocks, and OddsHarvester has to cover the rest.

QUALITY CAVEAT, for whoever loads this: these are NOT book closes of the
quality SBR gives. NHL carries a single book (Unibet); NBA carries `consensus`
and `teamrankings`, which are aggregates rather than a real book's closing
price. Load them at a LOWER source_priority than SBR so an SBR row always wins
on the overlap.

Deliberately writes CSV, not Postgres -- the staging table and resolution pass
are a separate step, and nothing unresolved should touch a live table.

Usage:
    python espn_odds_backfill.py --outdir ../../Downloads/espn_odds
"""

import argparse
import asyncio
import csv
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import httpx

BASE = "https://site.api.espn.com/apis/site/v2/sports"

# (label, espn path, first day, last day). Ranges are generous at both ends --
# a day with no games costs one cheap scoreboard call and returns nothing.
BLOCKS = [
    ("nba_2022-23", "basketball/nba", date(2022, 10, 15), date(2023, 6, 15)),
    ("nhl_2020-21", "hockey/nhl", date(2021, 1, 10), date(2021, 7, 10)),
    ("nhl_2022-23", "hockey/nhl", date(2022, 10, 5), date(2023, 6, 15)),
    ("nhl_2023-24", "hockey/nhl", date(2023, 10, 1), date(2024, 6, 30)),
]

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Linesmith/1.0)"}

FIELDS = [
    "block", "sport", "event_id", "event_date", "short_name",
    "home_team", "home_abbr", "home_id", "home_score",
    "away_team", "away_abbr", "away_id", "away_score",
    "completed", "venue", "provider", "details",
    "spread", "over_under", "over_odds", "under_odds",
    "home_ml", "away_ml", "home_spread_odds", "away_spread_odds",
    "ml_booksum", "ml_flag",
    "open_json", "current_json", "raw_json",
]


def _implied(american):
    """American odds -> implied probability."""
    if american is None:
        return None
    return 100.0 / (american + 100.0) if american > 0 else (-american) / ((-american) + 100.0)


def _ml_flag(home_ml, away_ml):
    """Classify the two-sided moneyline by its booksum, and say so in the data.

    MEASURED 2026-08-31, and it differs by sport:
      NBA  booksum 1.0416 -- a normal ~4% overround, a real TWO-WAY market
      NHL  booksum 0.8285 -- impossible for two-way. Unibet is European and
           quotes NHL as a THREE-WAY REGULATION market; the missing ~17% is
           the draw (NHL reaches OT ~23% of the time). Loading it as a two-way
           close would understate every favourite.

    So this is not a hardcoded per-sport rule -- it is computed per row, which
    also catches ESPN's own bad rows (one 2020-21 game carries an identical
    +148 on both sides).
    """
    if home_ml is None or away_ml is None:
        return None, "missing"
    if home_ml == away_ml:
        return None, "identical_prices"
    bs = (_implied(home_ml) or 0) + (_implied(away_ml) or 0)
    if bs < 1.0:
        return round(bs, 4), "sub_one_not_two_way"
    if bs > 1.20:
        return round(bs, 4), "wide"
    return round(bs, 4), "two_way"


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


async def _get(client, url, retries=3):
    for attempt in range(retries):
        try:
            r = await client.get(url, headers=HEADERS, timeout=25.0)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 503):
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            return None
        except Exception:
            await asyncio.sleep(1.0 * (attempt + 1))
    return None


async def event_ids_for_day(client, path, day):
    js = await _get(client, f"{BASE}/{path}/scoreboard?dates={day:%Y%m%d}")
    return [e["id"] for e in (js or {}).get("events", []) if e.get("id")]


def rows_from_summary(block, sport, event_id, js):
    """One row per (event, odds provider). No pickcenter -> no rows."""
    pc = (js or {}).get("pickcenter") or []
    if not pc:
        return []

    header = (js or {}).get("header") or {}
    comp = ((header.get("competitions") or [{}])[0]) or {}
    competitors = comp.get("competitors") or []
    home = next((c for c in competitors if c.get("homeAway") == "home"), {})
    away = next((c for c in competitors if c.get("homeAway") == "away"), {})
    gi = (js or {}).get("gameInfo") or {}

    base = {
        "block": block,
        "sport": sport,
        "event_id": event_id,
        "event_date": comp.get("date") or header.get("date"),
        "short_name": header.get("shortName") or comp.get("shortName"),
        "home_team": (home.get("team") or {}).get("displayName"),
        "home_abbr": (home.get("team") or {}).get("abbreviation"),
        "home_id": (home.get("team") or {}).get("id"),
        "home_score": home.get("score"),
        "away_team": (away.get("team") or {}).get("displayName"),
        "away_abbr": (away.get("team") or {}).get("abbreviation"),
        "away_id": (away.get("team") or {}).get("id"),
        "away_score": away.get("score"),
        "completed": ((comp.get("status") or {}).get("type") or {}).get("completed"),
        "venue": (gi.get("venue") or {}).get("fullName"),
    }

    out = []
    for p in pc:
        hto = p.get("homeTeamOdds") or {}
        ato = p.get("awayTeamOdds") or {}
        row = dict(base)
        _bs, _flag = _ml_flag(_num(hto.get("moneyLine")), _num(ato.get("moneyLine")))
        row.update({
            "ml_booksum": _bs,
            "ml_flag": _flag,
            "provider": (p.get("provider") or {}).get("name"),
            "details": p.get("details"),
            "spread": _num(p.get("spread")),
            "over_under": _num(p.get("overUnder")),
            "over_odds": _num(p.get("overOdds")),
            "under_odds": _num(p.get("underOdds")),
            "home_ml": _num(hto.get("moneyLine")),
            "away_ml": _num(ato.get("moneyLine")),
            "home_spread_odds": _num(hto.get("spreadOdds")),
            "away_spread_odds": _num(ato.get("spreadOdds")),
            # Kept whole: ESPN nests open/current differently per sport and per
            # era, and a one-time scrape should not throw away what it did not
            # anticipate. Parse these at load time, not here.
            "open_json": json.dumps(p.get("open"), separators=(",", ":")) if p.get("open") else None,
            "current_json": json.dumps(p.get("current"), separators=(",", ":")) if p.get("current") else None,
            "raw_json": json.dumps(p, separators=(",", ":")),
        })
        out.append(row)
    return out


async def run_block(client, block, path, first, last, concurrency, writer, counters):
    sport = "nba" if "basketball" in path else "nhl"
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]

    # Schedule pass: cheap, and it tells us the real denominator up front.
    ids = []
    sem = asyncio.Semaphore(concurrency)

    async def one_day(d):
        async with sem:
            return await event_ids_for_day(client, path, d)

    for chunk_start in range(0, len(days), 60):
        chunk = days[chunk_start:chunk_start + 60]
        for got in await asyncio.gather(*(one_day(d) for d in chunk)):
            ids.extend(got)
    print(f"  [{block}] {len(ids)} events across {len(days)} days", flush=True)

    done = 0
    with_odds = 0
    rows_written = 0

    async def one_event(eid):
        nonlocal done, with_odds, rows_written
        async with sem:
            js = await _get(client, f"{BASE}/{path}/summary?event={eid}")
        rows = rows_from_summary(block, sport, eid, js)
        done += 1
        if rows:
            with_odds += 1
            for r in rows:
                writer.writerow(r)
            rows_written += len(rows)
        if done % 250 == 0:
            print(f"  [{block}] {done}/{len(ids)} events, {with_odds} with odds", flush=True)

    for chunk_start in range(0, len(ids), 300):
        chunk = ids[chunk_start:chunk_start + 300]
        await asyncio.gather(*(one_event(e) for e in chunk))

    print(f"  [{block}] DONE {done} events, {with_odds} with odds, {rows_written} rows", flush=True)
    counters.append({"block": block, "events": done, "with_odds": with_odds, "rows": rows_written})


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default="./espn_odds")
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--blocks", nargs="*", default=None)
    args = ap.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    out_path = outdir / "espn_odds_all.csv"

    blocks = [b for b in BLOCKS if not args.blocks or b[0] in args.blocks]
    counters = []

    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        limits = httpx.Limits(max_connections=args.concurrency + 2, max_keepalive_connections=args.concurrency)
        async with httpx.AsyncClient(limits=limits, follow_redirects=True) as client:
            for block, path, first, last in blocks:
                print(f"[{block}] {first} -> {last}", flush=True)
                await run_block(client, block, path, first, last, args.concurrency, writer, counters)

    total_rows = sum(c["rows"] for c in counters)
    total_odds = sum(c["with_odds"] for c in counters)
    print(f"\nwrote {total_rows} odds rows for {total_odds} games -> {out_path}", flush=True)
    with open(outdir / "block_summary.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["block", "events", "with_odds", "rows"])
        w.writeheader()
        w.writerows(counters)


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
