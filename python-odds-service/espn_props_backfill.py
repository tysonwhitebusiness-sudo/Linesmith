"""
Backfill historical PLAYER PROPS from ESPN's core API.

WHY THIS MATTERS: `prop_odds` has ZERO rows for NFL, CFB, NBA and NHL today.
This is the first prop line data those sports will ever have.

MEASURED 2026-08-31, resolving the refs rather than checking the field exists:
    NFL 2025    3 of 6 games have props, avg 1,018 per game
    NBA 2025-26 3 of 12,                 avg   511
    NHL 2025-26 3 of 12,                 avg   362
    CFB 2025    2 of 6,                  avg   235
Props exist on roughly 25-50% of games and only on recent seasons.

An earlier pass concluded "props absent for NBA/NHL/CFB". That was wrong -- it
tested whether `p.propBets` existed on the FIRST odds item instead of scanning
every item and following the ref. Scan all items.

TWO COST DECISIONS, both deliberate:
  * ONE provider per game -- the first item carrying a propBets ref. All books
    would multiply the run with heavily overlapping lines.
  * `athlete_id` is PARSED FROM THE $ref URL, never fetched. Resolving the
    athlete endpoint is one extra request per prop and would triple the run.

NO raw_json. Operator decision 2026-08-31: ~1.85M rows x ~600 bytes would add
1.5-2.5 GB to a 3,141 MB database against an 8 GB ceiling. Every PARSED field
is kept; only the unparsed blob is dropped.

Usage:
    python espn_props_backfill.py --outdir ../../Downloads/espn_props
"""

import argparse
import asyncio
import csv
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import httpx

SITE = "https://site.api.espn.com/apis/site/v2/sports"
CORE = "https://sports.core.api.espn.com/v2/sports"

# Same shape as the game-lines backfill: (label, sport, site path, core sport,
# core league, first, last). Props only exist on recent seasons, so this is the
# last completed season plus the current one where a season is live.
BLOCKS = [
    ("mlb_2025", "mlb", "baseball/mlb", "baseball", "mlb", date(2025, 3, 20), date(2025, 11, 5)),
    ("mlb_2026", "mlb", "baseball/mlb", "baseball", "mlb", date(2026, 3, 20), date(2026, 9, 1)),
    ("nfl_2025", "nfl", "football/nfl", "football", "nfl", date(2025, 9, 1), date(2026, 2, 15)),
    ("cfb_2025", "cfb", "football/college-football", "football", "college-football", date(2025, 8, 20), date(2026, 1, 25)),
    ("cfb_2026", "cfb", "football/college-football", "football", "college-football", date(2026, 8, 20), date(2026, 9, 1)),
    ("epl_2025-26", "soccer_epl", "soccer/eng.1", "soccer", "eng.1", date(2025, 8, 1), date(2026, 5, 31)),
    ("epl_2026-27", "soccer_epl", "soccer/eng.1", "soccer", "eng.1", date(2026, 8, 1), date(2026, 9, 1)),
    ("mls_2025", "soccer_mls", "soccer/usa.1", "soccer", "usa.1", date(2025, 2, 20), date(2025, 12, 15)),
    ("mls_2026", "soccer_mls", "soccer/usa.1", "soccer", "usa.1", date(2026, 2, 20), date(2026, 9, 1)),
    ("nba_2025-26", "nba", "basketball/nba", "basketball", "nba", date(2025, 10, 20), date(2026, 6, 25)),
    ("nhl_2025-26", "nhl", "hockey/nhl", "hockey", "nhl", date(2025, 10, 1), date(2026, 6, 30)),
]

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Linesmith/1.0)"}
CHECKPOINT_ROWS = 5000

FIELDS = [
    "block", "sport", "event_id", "event_date", "home_team", "away_team",
    "provider", "athlete_id", "type_id", "type_name",
    "line", "over_price", "under_price",
    "open_line", "open_over_price", "open_under_price", "last_updated",
]

_ATHLETE_RE = re.compile(r"/athletes/(\d+)")


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, str):
        v = v.replace("+", "").strip()
        if v.lower() == "even":
            return 100.0
        if v == "":
            return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _dig(obj, *path):
    cur = obj
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


async def _get(client, url, retries=3):
    url = url.replace("http://", "https://")
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


def _prop_rows(meta, provider, items):
    out = []
    for it in items or []:
        ref = _dig(it, "athlete", "$ref") or ""
        m = _ATHLETE_RE.search(ref)
        cur, opn = it.get("current") or {}, it.get("open") or {}
        row = dict(meta)
        row.update({
            "provider": provider,
            "athlete_id": m.group(1) if m else None,
            "type_id": _dig(it, "type", "id"),
            "type_name": _dig(it, "type", "name"),
            "line": _num(_dig(cur, "target", "value")),
            "over_price": _num(_dig(cur, "over", "american")),
            "under_price": _num(_dig(cur, "under", "american")),
            "open_line": _num(_dig(opn, "target", "value")),
            "open_over_price": _num(_dig(opn, "over", "american")),
            "open_under_price": _num(_dig(opn, "under", "american")),
            "last_updated": it.get("lastUpdated"),
        })
        out.append(row)
    return out


async def run_block(client, block, sport, site_path, sp, lg, first, last, conc, writer, fh, counters, state):
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    sem = asyncio.Semaphore(conc)

    async def day_events(d):
        async with sem:
            js = await _get(client, f"{SITE}/{site_path}/scoreboard?dates={d:%Y%m%d}")
        out = []
        for e in (js or {}).get("events", []):
            if not e.get("id"):
                continue
            comp = (e.get("competitions") or [{}])[0]
            cs = comp.get("competitors") or []
            home = next((c for c in cs if c.get("homeAway") == "home"), {})
            away = next((c for c in cs if c.get("homeAway") == "away"), {})
            out.append({
                "block": block, "sport": sport, "event_id": e["id"], "event_date": e.get("date"),
                "home_team": _dig(home, "team", "displayName"),
                "away_team": _dig(away, "team", "displayName"),
            })
        return out

    metas = []
    for i in range(0, len(days), 60):
        for got in await asyncio.gather(*(day_events(d) for d in days[i:i + 60])):
            metas.extend(got)
    print(f"  [{block}] {len(metas)} events", flush=True)

    done = with_props = rows_out = 0

    async def one(meta):
        nonlocal done, with_props, rows_out
        eid = meta["event_id"]
        async with sem:
            odds = await _get(client, f"{CORE}/{sp}/leagues/{lg}/events/{eid}/competitions/{eid}/odds")
        done += 1
        # SCAN EVERY ITEM, not just the first -- the earlier false negative.
        target = None
        for p in (odds or {}).get("items", []):
            if _dig(p, "propBets", "$ref"):
                target = p
                break
        if not target:
            return
        provider = _dig(target, "provider", "name")
        ref = _dig(target, "propBets", "$ref")
        async with sem:
            page1 = await _get(client, ref)
        if not page1 or not page1.get("items"):
            return
        with_props += 1
        rows = _prop_rows(meta, provider, page1["items"])
        pages = int(page1.get("pageCount") or 1)
        if pages > 1:
            sep = "&" if "?" in ref else "?"

            async def page(n):
                async with sem:
                    return await _get(client, f"{ref}{sep}page={n}")

            for js in await asyncio.gather(*(page(n) for n in range(2, pages + 1))):
                if js and js.get("items"):
                    rows.extend(_prop_rows(meta, provider, js["items"]))
        for r in rows:
            writer.writerow(r)
        rows_out += len(rows)
        state["rows"] += len(rows)
        if state["rows"] - state["flushed"] >= CHECKPOINT_ROWS:
            fh.flush()
            state["flushed"] = state["rows"]
        if done % 200 == 0:
            print(f"  [{block}] {done}/{len(metas)} events, {with_props} with props, {rows_out} rows", flush=True)

    for i in range(0, len(metas), 200):
        await asyncio.gather(*(one(m) for m in metas[i:i + 200]))

    fh.flush()
    print(f"  [{block}] DONE {done} events, {with_props} with props, {rows_out} rows", flush=True)
    counters.append({"block": block, "events": done, "with_props": with_props, "rows": rows_out})


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default="./espn_props")
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--blocks", nargs="*", default=None)
    args = ap.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    out = outdir / "espn_props_all.csv"
    blocks = [b for b in BLOCKS if not args.blocks or b[0] in args.blocks]
    counters, state = [], {"rows": 0, "flushed": 0}

    with open(out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        limits = httpx.Limits(max_connections=args.concurrency + 2, max_keepalive_connections=args.concurrency)
        async with httpx.AsyncClient(limits=limits, follow_redirects=True) as client:
            for block, sport, site_path, sp, lg, first, last in blocks:
                print(f"[{block}] {first} -> {last}", flush=True)
                await run_block(client, block, sport, site_path, sp, lg, first, last,
                                args.concurrency, writer, fh, counters, state)

    print(f"\nwrote {state['rows']} prop rows -> {out}", flush=True)
    with open(outdir / "block_summary.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["block", "events", "with_props", "rows"])
        w.writeheader()
        w.writerows(counters)


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
