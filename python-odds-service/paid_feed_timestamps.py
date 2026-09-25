"""P7 §3b (T0.4) — what each paid odds feed says about WHEN a book's price was set.

    python paid_feed_timestamps.py [--sports nfl,mlb] [--providers sharpapi,oddsapiio,...]

Read-only toward our tables: it runs each provider through the normal
`job_runner.run_provider_specs` path — the per-provider throttle floor, the cap
reservation against the key pool, the spend record — with the price WRITERS
stubbed out, and an httpx response hook keeps the raw JSON. Budget is spent
exactly as a normal cycle would spend it (and skipped where the throttle says
the worker just fetched). Then every field whose name looks like a time is
listed with the level it sits at (response / event / market / book / price),
whether it varies per book, and its age against the fetch time.

The-odds-api needs no fetch: its raw payloads are already kept in `odds_cache`
(`--odds-cache`).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))
os.environ.setdefault("DB_POOL_MAX_SIZE", "1")

TIME_KEY = re.compile(r"(updat|last|time|stamp|date|_at$|At$|changed|modified|seen)", re.I)
LEVEL_HINTS = [("price", re.compile(r"^(outcomes?|prices?|selections?|odds|lines?)$", re.I)),
               ("book", re.compile(r"^(bookmakers?|books?|sportsbooks?|byBookmaker)$", re.I)),
               ("market", re.compile(r"^(markets?|props?|bets?)$", re.I)),
               ("event", re.compile(r"^(events?|games?|data|results)$", re.I))]


def parse_time(v):
    if isinstance(v, (int, float)) and v > 1e9:
        return datetime.fromtimestamp(v / 1000 if v > 1e12 else v, timezone.utc)
    if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", v):
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def walk(node, path, level, out, book=None):
    """Collect (path, level, book, value) for every time-like field."""
    if isinstance(node, dict):
        b = node.get("key") or node.get("bookmaker") or node.get("sportsbook") or node.get("book") or book
        if not isinstance(b, str):
            b = book
        for k, v in node.items():
            if isinstance(v, (dict, list)):
                lvl = next((name for name, rx in LEVEL_HINTS if rx.match(k)), level)
                walk(v, f"{path}.{k}", lvl, out, b)
            elif TIME_KEY.search(k) and parse_time(v) is not None:
                out.append((f"{path}.{k}", level, b, parse_time(v)))
    elif isinstance(node, list):
        for x in node[:500]:
            walk(x, path + "[]", level, out, book)


def analyse(provider: str, captured: list[tuple[datetime, str, object]]) -> list[dict]:
    fields = defaultdict(list)
    for fetched, _url, body in captured:
        found = []
        walk(body, "$", "response", found)
        for path, level, book, t in found:
            fields[(re.sub(r"\[\]", "[]", path), level)].append((book, (fetched - t).total_seconds()))
    rows = []
    for (path, level), vals in sorted(fields.items()):
        ages = [a for _, a in vals]
        books = {b for b, _ in vals if b}
        rows.append({"feed": provider, "field": path, "level": level, "n": len(vals),
                     "per_book": len(books) > 1, "books": len(books),
                     "median_age_s": round(statistics.median(ages), 1),
                     "min_age_s": round(min(ages), 1), "future": sum(1 for a in ages if a < -5),
                     "equals_fetch": sum(1 for a in ages if abs(a) <= 2)})
    return rows


async def fetch_all(sports: list[str], providers: list[str]) -> dict:
    import httpx

    import db
    import job_runner
    from game_context import load_mlb_games, load_sport_games
    from provider_matrix import specs_for

    async def no_write(*a, **k):
        return None
    db.write_prop_odds = no_write
    db.write_game_lines = no_write
    db.write_game_odds_book_lines = no_write
    db.replace_unresolved_for_provider = no_write
    job_runner.db = db

    captured: dict[str, list] = defaultdict(list)

    async def hook(response):
        await response.aread()
        host = response.request.url.host
        try:
            body = response.json()
        except ValueError:
            return
        captured[host].append((datetime.now(timezone.utc), str(response.request.url).split("?")[0], body))

    out = {}
    async with httpx.AsyncClient(event_hooks={"response": [hook]}) as client:
        for sport in sports:
            games = await (load_mlb_games() if sport == "mlb" else load_sport_games(sport))
            specs = [s for s in specs_for(sport) if s.provider_id.split("_")[0] in providers or s.provider_id in providers]
            for spec in specs:
                captured.clear()
                summary = await job_runner.run_provider_specs(client, games, [spec])
                out[(sport, spec.provider_id)] = {"summary": {k: summary.get(k) for k in ("rows", "warnings")
                                                              if k in summary},
                                                  "captured": {h: list(v) for h, v in captured.items()}}
                print(f"{sport} {spec.provider_id}: {sum(len(v) for v in captured.values())} responses; "
                      f"{summary.get('warnings')}", flush=True)
    return out


async def odds_cache_rows() -> list[dict]:
    import db
    pool = await db.get_pool()
    rows = await pool.fetch("SELECT cache_key, payload, fetched_at FROM odds_cache")
    captured = [(r["fetched_at"], r["cache_key"], json.loads(r["payload"])) for r in rows]
    return analyse("the-odds-api (odds_cache)", captured)


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sports", default="nfl,mlb")
    ap.add_argument("--providers", default="sharpapi,oddsapiio,propline,parlayapi,sportsgameodds")
    ap.add_argument("--odds-cache", action="store_true", help="only analyse the kept the-odds-api payloads")
    ap.add_argument("--json", help="write the table here")
    a = ap.parse_args()
    table = await odds_cache_rows()
    if not a.odds_cache:
        got = await fetch_all(a.sports.split(","), a.providers.split(","))
        for (sport, pid), v in got.items():
            caps = [c for lst in v["captured"].values() for c in lst]
            if caps:
                table += [dict(r, sport=sport) for r in analyse(pid, caps)]
            else:
                table.append({"feed": pid, "sport": sport, "field": "(no response: " +
                              "; ".join(v["summary"].get("warnings") or ["throttled or disabled"])[:120] + ")"})
    for r in table:
        print(json.dumps(r, default=str))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(table, fh, indent=1, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
