"""Capability audit: what can each API key actually cover, and props or games?

Answers a question the codebase has never answered from evidence -- the sport
maps in providers.py record what someone WIRED, not what each vendor SUPPORTS,
and docs/api-capability-audit-2026-08-20.md's matrix was measured wrong in at
least four places (see docs/odds-sources-2026-09-02.md §5).

DELIBERATELY CHEAP. Prefers each vendor's catalogue endpoint (sports/leagues
lists), which is normally free and unmetered, over per-sport odds calls, which
are not. Several of these keys are on hard daily or monthly budgets that the
real jobs depend on -- propline alone had already spent 1,006 requests against a
1,000/day limit on the day this was written -- so burning quota to answer a
documentation question would be a bad trade. Where no catalogue exists the probe
makes ONE minimal odds call and says so.

Read-only throughout. Run from python-odds-service/:
    python probe_all_providers.py
"""

import asyncio
import json
import sys

import httpx

sys.path.insert(0, "src")
import config  # noqa: E402

TIMEOUT = 30
# The eight sports this project actually runs.
OURS = ["mlb", "nfl", "cfb", "nba", "nhl", "soccer_epl", "soccer_mls", "tennis"]


def show(name: str, key: str | None, status, note: str = ""):
    state = "no key" if not key else status
    print(f"\n{'=' * 72}\n{name}\n  key: {'set' if key else 'MISSING'}   {state}")
    if note:
        print(f"  {note}")


async def get(client, url, headers=None, params=None):
    try:
        r = await client.get(url, headers=headers or {}, params=params, timeout=TIMEOUT)
        return r.status_code, (r.json() if "json" in r.headers.get("content-type", "") else r.text)
    except Exception as e:
        return None, f"{type(e).__name__}: {e}"


def match_ours(names: list[str]) -> dict:
    """Map a vendor's own league/sport strings onto our eight sports."""
    joined = {n.lower() for n in names if n}
    hit = {}
    probes = {
        "mlb": ["mlb", "baseball_mlb"],
        "nfl": ["nfl", "americanfootball_nfl"],
        "cfb": ["ncaaf", "americanfootball_ncaaf", "college-football"],
        "nba": ["nba", "basketball_nba"],
        "nhl": ["nhl", "icehockey_nhl", "hockey_nhl"],
        "soccer_epl": ["england_-_premier_league", "soccer_epl", "epl", "premier_league"],
        "soccer_mls": ["usa_-_major_league_soccer", "soccer_mls", "soccer_usa_mls", "mls"],
        "tennis": ["atp", "wta", "tennis_atp", "tennis_wta"],
    }
    for ours, cands in probes.items():
        hit[ours] = any(c in joined for c in cands)
    return hit


def render(hits: dict, props: str, games: str):
    line = "  coverage: " + "  ".join(
        f"{s}={'YES' if hits.get(s) else '-- '}" for s in OURS
    )
    print(line)
    print(f"  produces: props={props}   game lines={games}")


async def main():
    async with httpx.AsyncClient() as c:
        # ---------------- SharpAPI ----------------
        k = config.SHARPAPI_KEY
        st, body = await get(c, "https://api.sharpapi.io/api/v1/leagues", {"X-API-Key": k})
        show("SharpAPI  (SHARPAPI_KEY)", k, f"HTTP {st} — catalogue endpoint")
        if st == 200:
            rows = body.get("data") if isinstance(body, dict) else body
            names = [str(x.get("id")) for x in rows if isinstance(x, dict)]
            print(f"  catalogue: {len(names)} leagues")
            render(match_ours(names), "yes (is_player_prop=true)", "yes (is_player_prop=false)")
            print("  caveats: free tier = 2 books (DK/FD), 60s delay, 200 rows/page")

        # SharpAPI NHL — does the catalogue entry return real rows, or is it
        # listed-but-empty? NHL is out of season, so 200-with-0-rows is the
        # expected 'supported but no slate' answer, NOT 'unsupported'.
        await asyncio.sleep(6)
        st, body = await get(
            c, "https://api.sharpapi.io/api/v1/odds",
            {"X-API-Key": k},
            {"sport": "hockey", "league": "nhl", "is_player_prop": "false", "limit": 50},
        )
        n = len(body.get("data") or []) if isinstance(body, dict) else 0
        print(f"  NHL live check: HTTP {st}, {n} rows "
              f"({'in season' if n else 'listed in catalogue; no slate today'})")

        # ---------------- The Odds API ----------------
        k = config.ODDS_API_KEY
        if k:
            st, body = await get(c, "https://api.the-odds-api.com/v4/sports",
                                 params={"apiKey": k})
            show("The Odds API  (ODDS_API_KEY)", k, f"HTTP {st} — catalogue (free, unmetered)")
            if st == 200 and isinstance(body, list):
                names = [str(x.get("key")) for x in body]
                active = [str(x.get("key")) for x in body if x.get("active")]
                print(f"  catalogue: {len(names)} sports ({len(active)} active now)")
                render(match_ours(names), "depends on markets param", "yes (h2h/spreads/totals)")
        else:
            show("The Odds API  (ODDS_API_KEY)", k, "skipped")

        # ---------------- SportsGameOdds ----------------
        for label, k in (("SPORTSGAMEODDS_KEY", config.SPORTSGAMEODDS_KEY),
                         ("SPORTSGAMEODDS_MULTISPORT_KEY", config.SPORTSGAMEODDS_MULTISPORT_KEY)):
            if not k:
                show(f"SportsGameOdds  ({label})", k, "skipped")
                continue
            st, body = await get(c, "https://api.sportsgameodds.com/v2/leagues",
                                 {"X-Api-Key": k})
            show(f"SportsGameOdds  ({label})", k, f"HTTP {st} — catalogue endpoint")
            if st == 200:
                rows = body.get("data") if isinstance(body, dict) else body
                names = []
                if isinstance(rows, list):
                    for x in rows:
                        if isinstance(x, dict):
                            names += [str(x.get(f)) for f in ("leagueID", "id", "name") if x.get(f)]
                print(f"  catalogue: {len(rows) if isinstance(rows, list) else '?'} leagues")
                render(match_ours(names), "yes", "yes (_sgo_game_line_rows)")
            else:
                print(f"  body: {str(body)[:200]}")

        # ---------------- ParlayAPI ----------------
        for label, k in (("PARLAYAPI_KEY", config.PARLAYAPI_KEY),
                         ("PARLAYAPI_MLB_KEY", config.PARLAYAPI_MLB_KEY),
                         ("PARLAYAPI_NFL_KEY", config.PARLAYAPI_NFL_KEY),
                         ("PARLAYAPI_CFB_KEY", config.PARLAYAPI_CFB_KEY),
                         ("PARLAYAPI_SOCCER_KEY", config.PARLAYAPI_SOCCER_KEY),
                         ("PARLAYAPI_NBA_KEY", config.PARLAYAPI_NBA_KEY)):
            if not k:
                show(f"ParlayAPI  ({label})", k, "skipped — no key")
                continue
            st, body = await get(c, "https://parlay-api.com/v1/sports", {"X-API-Key": k})
            show(f"ParlayAPI  ({label})", k, f"HTTP {st} — catalogue endpoint")
            if st == 200:
                rows = body.get("data") if isinstance(body, dict) else body
                names = []
                if isinstance(rows, list):
                    for x in rows:
                        names.append(str(x.get("key") or x.get("id") or x) if isinstance(x, dict) else str(x))
                print(f"  catalogue: {len(names)} sports")
                render(match_ours(names), "yes", "NO — endpoint is /props only")
            else:
                print(f"  body: {str(body)[:200]}")

        # ---------------- Propline ----------------
        for label, k in (("PROPLINE_KEY", config.PROPLINE_KEY),
                         ("PROPLINE_2_KEY", config.PROPLINE_2_KEY)):
            if not k:
                show(f"Propline  ({label})", k, "skipped")
                continue
            st, body = await get(c, "https://api.prop-line.com/v1/sports", params={"apiKey": k})
            show(f"Propline  ({label})", k, f"HTTP {st} — catalogue endpoint")
            if st == 200:
                rows = body.get("data") if isinstance(body, dict) else body
                names = []
                if isinstance(rows, list):
                    for x in rows:
                        names.append(str(x.get("key") or x.get("id") or x) if isinstance(x, dict) else str(x))
                print(f"  catalogue: {len(names)} sports")
                render(match_ours(names), "yes (/markets)", "yes (_propline_game_line_rows)")
            else:
                print(f"  body: {str(body)[:250]}")

        # ---------------- Odds-API.io ----------------
        k = config.ODDSAPIIO_KEY
        if k:
            st, body = await get(c, "https://api.odds-api.io/v3/sports", params={"apiKey": k})
            show("Odds-API.io  (ODDSAPIIO_KEY)", k, f"HTTP {st} — catalogue endpoint")
            if st == 200:
                rows = body.get("data") if isinstance(body, dict) else body
                names = []
                if isinstance(rows, list):
                    for x in rows:
                        names.append(str(x.get("key") or x.get("id") or x) if isinstance(x, dict) else str(x))
                print(f"  catalogue: {len(names)} sports")
                render(match_ours(names), "yes (Fanatics-only observed)", "unknown — not wired")
            else:
                print(f"  body: {str(body)[:250]}")
        else:
            show("Odds-API.io  (ODDSAPIIO_KEY)", k, "skipped")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
