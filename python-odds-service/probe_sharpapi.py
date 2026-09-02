"""Live capability probe for SharpAPI: does it actually serve CFB and tennis?

Answers the open action item in docs/api-capability-audit-2026-08-20.md §4.5,
"Real live test of SharpAPI for CFB/Tennis before assuming it belongs in those
sports' chains" -- which was written 2026-08-20 and never closed. The matrix
there marks NFL as verified and CFB/Tennis as untested, yet tennis was wired
into JOB_REGISTRY anyway and NFL was not.

READ-ONLY. Issues GETs against the same endpoint the real providers already
call, nothing else. SharpAPI's documented free-tier limit is 12 req/min, so
this sleeps between calls and keeps the total well under one minute's budget.

Run from python-odds-service/:  python probe_sharpapi.py
"""

import asyncio
import sys

import httpx

sys.path.insert(0, "src")
import config  # noqa: E402

BASE = "https://api.sharpapi.io/api/v1/odds"

# (label, sport, league). MLB and NFL are the audit's two VERIFIED entries and
# act as positive controls: if they come back empty too, the probe is broken or
# the slate is empty, not the coverage.
TARGETS = [
    ("MLB  (control, verified)", "baseball", "mlb"),
    ("NFL  (control, verified)", "football", "nfl"),
    ("NFL  alt token", "american-football", "nfl"),
    ("CFB  guess 1", "football", "ncaaf"),
    ("CFB  guess 2", "football", "college-football"),
    ("CFB  guess 3", "american-football", "ncaaf"),
    ("CFB  guess 4", "football", "cfb"),
    ("Tennis ATP (wired today)", "tennis", "atp"),
    ("Tennis WTA (wired today)", "tennis", "wta"),
]


async def probe(client: httpx.AsyncClient, label: str, sport: str, league: str, player_prop: bool):
    kind = "props" if player_prop else "game lines"
    url = f"{BASE}?sport={sport}&league={league}&is_player_prop={str(player_prop).lower()}&limit=500"
    try:
        r = await client.get(url, headers={"X-API-Key": config.SHARPAPI_KEY}, timeout=30)
    except httpx.HTTPError as e:
        print(f"  {label:<26} {kind:<11} REQUEST FAILED: {type(e).__name__}")
        return
    if r.status_code != 200:
        body = (r.text or "")[:160].replace("\n", " ")
        print(f"  {label:<26} {kind:<11} HTTP {r.status_code}  {body}")
        return

    body = r.json()
    rows = body.get("data") or []
    meta = body.get("meta") or {}
    if not rows:
        print(f"  {label:<26} {kind:<11} HTTP 200 but ZERO rows")
        return

    books = sorted({x.get("sportsbook") for x in rows if x.get("sportsbook")})
    cats = sorted({x.get("stat_category") for x in rows if x.get("stat_category")})
    events = {x.get("event_id") for x in rows if x.get("event_id")}
    named = sum(1 for x in rows if x.get("player_name"))
    delay = (meta.get("tier") or {}).get("data_delay_seconds")

    print(f"  {label:<26} {kind:<11} {len(rows):>4} rows | {len(events):>3} events | "
          f"{len(books)} books | delay {delay}s")
    print(f"      books: {', '.join(books[:8])}")
    if cats:
        print(f"      markets ({len(cats)}): {', '.join(cats[:9])}")
    if player_prop:
        print(f"      rows carrying a player_name: {named}/{len(rows)}")
    s = rows[0]
    print(f"      sample: {s.get('away_team')} @ {s.get('home_team')} | "
          f"{s.get('player_name') or '(team)'} | {s.get('stat_category')} "
          f"{s.get('selection_type')} {s.get('line')} @ {s.get('odds_american')}")


async def main():
    if not config.SHARPAPI_KEY:
        print("SHARPAPI_KEY is not set in this environment — cannot probe.")
        return
    print(f"\nSharpAPI live capability probe — {len(TARGETS)} targets, "
          f"props + game lines each\n")
    async with httpx.AsyncClient() as client:
        for label, sport, league in TARGETS:
            for player_prop in (True, False):
                await probe(client, label, sport, league, player_prop)
                await asyncio.sleep(5)  # 12 req/min documented limit
            print()


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
