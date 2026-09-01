"""
Backfill historical game odds from ESPN's CORE API.

WHY THIS REPLACES espn_odds_backfill.py
---------------------------------------
The first version used the SITE API's `summary?event=` -> `pickcenter`. That
endpoint stops carrying odds after NBA 2023-04 and NHL 2024-04, which looked
like ESPN dropping recent odds. It is not -- the odds MOVED to the core API,
which has them for every season we need, from more books, with real open and
close values.

Measured 2026-08-31, per-season, 100% coverage on every gap block:

    NBA 2023-24   12/12 games, close+open, booksum 1.0603, 6+ books
    NBA 2024-25   12/12, booksum 1.0455        NBA 2025-26   9/9, booksum 1.0438
    NHL 2024-25    5/5,  booksum 1.0426        NHL 2025-26   5/5, booksum 1.0448
    NHL 2022-23   10/10, booksum 1.0387, 6+ books

The booksums matter. The SITE api's NHL moneyline summed to 0.83 -- a THREE-WAY
regulation market that cannot be used as a two-way close -- and its NHL total
was a constant 5.5 placeholder (standard deviation exactly 0.00 across 1,400+
games). The CORE api gives a real two-way market and a real varying total for
the same games. So the NHL blocks are re-pulled here, not merely extended.

REACH (probed): NBA has items back to ~2015 and none by 2010; NHL back to
2020-21 and none by 2019. That covers every gap; SBR remains the better source
for the older seasons it does cover, so load this at a lower source_priority
where they overlap.

Deliberately writes CSV, not Postgres -- staging and resolution are a separate
step, and nothing unresolved should touch a live table.

Usage:
    python espn_core_odds_backfill.py --outdir ../../Downloads/espn_core_odds
"""

import argparse
import asyncio
import csv
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import httpx

SITE = "https://site.api.espn.com/apis/site/v2/sports"
CORE = "https://sports.core.api.espn.com/v2/sports"

# (label, SPORT, site path, core sport, core league, first day, last day).
# `sport` is explicit rather than derived from the site path -- the old
# `"nba" if "basketball" in path else "nhl"` was correct while only two sports
# existed and silently mislabels all five added below.
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
    ("nba_2022-23", "nba", "basketball/nba", "basketball", "nba", date(2022, 10, 15), date(2023, 6, 15)),
    ("nba_2023-24", "nba", "basketball/nba", "basketball", "nba", date(2023, 10, 20), date(2024, 6, 25)),
    ("nba_2024-25", "nba", "basketball/nba", "basketball", "nba", date(2024, 10, 20), date(2025, 6, 25)),
    ("nba_2025-26", "nba", "basketball/nba", "basketball", "nba", date(2025, 10, 20), date(2026, 6, 25)),
    ("nhl_2020-21", "nhl", "hockey/nhl", "hockey", "nhl", date(2021, 1, 10), date(2021, 7, 10)),
    ("nhl_2022-23", "nhl", "hockey/nhl", "hockey", "nhl", date(2022, 10, 5), date(2023, 6, 15)),
    ("nhl_2023-24", "nhl", "hockey/nhl", "hockey", "nhl", date(2023, 10, 1), date(2024, 6, 30)),
    ("nhl_2024-25", "nhl", "hockey/nhl", "hockey", "nhl", date(2024, 10, 1), date(2025, 6, 30)),
    ("nhl_2025-26", "nhl", "hockey/nhl", "hockey", "nhl", date(2025, 10, 1), date(2026, 6, 30)),
]

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Linesmith/1.0)"}

FIELDS = [
    "block", "sport", "event_id", "event_date", "short_name",
    "home_team", "home_abbr", "home_id", "home_score",
    "away_team", "away_abbr", "away_id", "away_score", "venue",
    "provider", "details",
    "cur_spread", "cur_total", "cur_home_ml", "cur_away_ml",
    "open_total", "open_over_odds", "open_under_odds",
    "close_total", "close_over_odds", "close_under_odds",
    "open_home_ml", "open_away_ml", "close_home_ml", "close_away_ml",
    "open_home_spread", "close_home_spread",
    "draw_ml", "open_draw_ml",
    "ml_booksum", "ml_flag", "raw_json",
]


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, str):
        v = v.replace("+", "").strip()
        if v in ("", "EVEN", "even"):
            return 100.0 if v else None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _nz(v):
    """Like _num, but treats 0 as MISSING for fields where 0 is impossible.

    MEASURED 2026-08-31: ESPN returns `close.total.value == 0` on all 4,046 MLB
    rows that carry a close block, and `close.moneyLine == 0` on 1,233. A total
    of 0 and a moneyline of 0 are both impossible, so these are placeholders --
    the same defect class as the site API's constant 5.5 NHL total. Coalescing
    them as real values dragged the MLB total mean to 3.71 against a true 8.47.

    NOT used for spreads: a spread of 0 is a legitimate pick'em.
    """
    n = _num(v)
    return None if n == 0 else n


def _dig(obj, *path):
    """Walk a nested dict, returning None the moment anything is missing."""
    cur = obj
    for k in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _implied(american):
    if american is None:
        return None
    return 100.0 / (american + 100.0) if american > 0 else (-american) / ((-american) + 100.0)


def _ml_flag(home_ml, away_ml, draw_ml=None):
    """Booksum sanity, computed per row rather than assumed per sport.

    This is why the site-API version had to be abandoned: its NHL moneyline
    summed to 0.83 (a three-way regulation market). Anything below 1.0 is not
    a two-way price and must not be loaded as one.
    """
    if home_ml is None or away_ml is None:
        return None, "missing"
    if home_ml == away_ml and draw_ml is None:
        return None, "identical_prices"
    bs = (_implied(home_ml) or 0) + (_implied(away_ml) or 0)
    if draw_ml is not None:
        # SOCCER IS THREE-WAY. Verified 2026-08-31 on a real EPL row:
        # home -210 / away +550 / draw +370 sums to 1.0440. Without the draw
        # leg it sums to 0.831 and would be flagged as a broken two-way market
        # -- the exact false positive the NHL site-API finding taught us to
        # look for, in reverse.
        bs += _implied(draw_ml) or 0
        return round(bs, 4), ("three_way" if 1.0 < bs <= 1.25 else "three_way_odd")
    if bs < 1.0:
        return round(bs, 4), "sub_one_not_two_way"
    if bs > 1.20:
        return round(bs, 4), "wide"
    return round(bs, 4), "two_way"


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


def _scoreboard_meta(ev):
    comp = (ev.get("competitions") or [{}])[0]
    cs = comp.get("competitors") or []
    home = next((c for c in cs if c.get("homeAway") == "home"), {})
    away = next((c for c in cs if c.get("homeAway") == "away"), {})
    return {
        "event_id": ev.get("id"),
        "event_date": ev.get("date"),
        "short_name": ev.get("shortName"),
        "home_team": _dig(home, "team", "displayName"),
        "home_abbr": _dig(home, "team", "abbreviation"),
        "home_id": _dig(home, "team", "id"),
        "home_score": home.get("score"),
        "away_team": _dig(away, "team", "displayName"),
        "away_abbr": _dig(away, "team", "abbreviation"),
        "away_id": _dig(away, "team", "id"),
        "away_score": away.get("score"),
        "venue": _dig(comp, "venue", "fullName"),
    }


def rows_from_odds(block, sport, meta, items):
    out = []
    for p in items or []:
        hto = p.get("homeTeamOdds") or {}
        ato = p.get("awayTeamOdds") or {}
        # SKIP NON-GAME-LINE ITEMS. Soccer returns a second item shape (seen
        # from Bet 365) carrying decimal outright odds under
        # `homeTeamOdds.odds.value` with no `moneyLine`, no `overUnder` and no
        # `spread`. Parsing it would write a row of nulls with a real provider
        # name attached, which reads as coverage that is not there.
        if hto.get("moneyLine") is None and p.get("overUnder") is None and p.get("spread") is None:
            continue
        draw_ml = _nz(_dig(p, "drawOdds", "moneyLine"))
        close_h = _nz(_dig(hto, "close", "moneyLine", "american")) or _nz(hto.get("moneyLine"))
        close_a = _nz(_dig(ato, "close", "moneyLine", "american")) or _nz(ato.get("moneyLine"))
        bs, flag = _ml_flag(close_h, close_a, draw_ml)
        row = dict(meta)
        row.update({
            "block": block,
            "sport": sport,
            "provider": _dig(p, "provider", "name"),
            "details": p.get("details"),
            "cur_spread": _num(p.get("spread")),
            "cur_total": _nz(p.get("overUnder")),
            "cur_home_ml": _nz(hto.get("moneyLine")),
            "cur_away_ml": _nz(ato.get("moneyLine")),
            "open_total": _nz(_dig(p, "open", "total", "value")),
            "open_over_odds": _num(_dig(p, "open", "over", "american")),
            "open_under_odds": _num(_dig(p, "open", "under", "american")),
            "close_total": _nz(_dig(p, "close", "total", "value")),
            "close_over_odds": _num(_dig(p, "close", "over", "american")),
            "close_under_odds": _num(_dig(p, "close", "under", "american")),
            "open_home_ml": _nz(_dig(hto, "open", "moneyLine", "american")),
            "open_away_ml": _nz(_dig(ato, "open", "moneyLine", "american")),
            "close_home_ml": close_h,
            "close_away_ml": close_a,
            "open_home_spread": _num(_dig(hto, "open", "pointSpread", "american")),
            "close_home_spread": _num(_dig(hto, "close", "pointSpread", "american")),
            "draw_ml": draw_ml,
            "open_draw_ml": _num(_dig(p, "drawOdds", "open", "moneyLine", "american")),
            "ml_booksum": bs,
            "ml_flag": flag,
            "raw_json": json.dumps(p, separators=(",", ":")),
        })
        out.append(row)
    return out


async def run_block(client, block, sport, site_path, sp, lg, first, last, concurrency, writer, counters):
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    sem = asyncio.Semaphore(concurrency)

    async def day_events(d):
        async with sem:
            js = await _get(client, f"{SITE}/{site_path}/scoreboard?dates={d:%Y%m%d}")
        return [_scoreboard_meta(e) for e in (js or {}).get("events", []) if e.get("id")]

    metas = []
    for i in range(0, len(days), 60):
        for got in await asyncio.gather(*(day_events(d) for d in days[i:i + 60])):
            metas.extend(got)
    print(f"  [{block}] {len(metas)} events across {len(days)} days", flush=True)

    done = with_odds = rows_written = 0

    async def one(meta):
        nonlocal done, with_odds, rows_written
        eid = meta["event_id"]
        async with sem:
            js = await _get(client, f"{CORE}/{sp}/leagues/{lg}/events/{eid}/competitions/{eid}/odds")
        rows = rows_from_odds(block, sport, meta, (js or {}).get("items"))
        done += 1
        if rows:
            with_odds += 1
            for r in rows:
                writer.writerow(r)
            rows_written += len(rows)
        if done % 300 == 0:
            print(f"  [{block}] {done}/{len(metas)}, {with_odds} with odds", flush=True)

    for i in range(0, len(metas), 300):
        await asyncio.gather(*(one(m) for m in metas[i:i + 300]))

    print(f"  [{block}] DONE {done} events, {with_odds} with odds, {rows_written} rows", flush=True)
    counters.append({"block": block, "events": done, "with_odds": with_odds, "rows": rows_written})


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--outdir", default="./espn_core_odds")
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--blocks", nargs="*", default=None)
    args = ap.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    out_path = outdir / "espn_core_odds_all.csv"
    blocks = [b for b in BLOCKS if not args.blocks or b[0] in args.blocks]
    counters = []

    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        limits = httpx.Limits(max_connections=args.concurrency + 2, max_keepalive_connections=args.concurrency)
        async with httpx.AsyncClient(limits=limits, follow_redirects=True) as client:
            for block, sport, site_path, sp, lg, first, last in blocks:
                print(f"[{block}] {first} -> {last}", flush=True)
                await run_block(client, block, sport, site_path, sp, lg, first, last, args.concurrency, writer, counters)

    print(f"\nwrote {sum(c['rows'] for c in counters)} odds rows for "
          f"{sum(c['with_odds'] for c in counters)} games -> {out_path}", flush=True)
    with open(outdir / "block_summary.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["block", "events", "with_odds", "rows"])
        w.writeheader()
        w.writerows(counters)


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
