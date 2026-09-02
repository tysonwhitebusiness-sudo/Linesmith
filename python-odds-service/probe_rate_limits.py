"""Rate-limit and quota characterisation for every provider key.

Answers the two questions the worker's shape depends on: **how hard can we hit
each provider, and how often?** The values in config.py are defaults someone
chose, not measurements -- `SPORTSGAMEODDS_RATE_PER_MIN = 10`,
`ODDSAPIIO_RATE_PER_HOUR = 100`, `PARLAYAPI_MONTHLY_LIMIT = 1000` are all
`env(..., "<default>")` fallbacks. This asks the vendors.

BUDGET DISCIPLINE. Several of these keys are on hard caps the real jobs depend
on, so this is built to be cheap and to say exactly what it spent:

  * Phase 1 harvests rate/quota HEADERS, which most vendors return on every
    response. One call per key, against the catalogue endpoint where one exists.
  * Phase 2 makes ONE call per provider against the endpoint the jobs actually
    use, purely to read that endpoint's quota headers -- catalogue limits are
    sometimes separate from odds limits.
  * Phase 3 bursts to find a per-minute ceiling, and runs ONLY against providers
    where a burst is genuinely cheap: SharpAPI (free tier, no daily/monthly cap
    at all) and ParlayAPI (measured 0 of 1,000 spent this month across five
    keys). It stops at the first 429 and reports how many got through.

Providers deliberately NOT burst: Propline (already at 1,006/1,000 today),
Odds-API.io (510/500 daily), SportsGameOdds (monthly object budget), The Odds
API (monthly credits). For those, headers and the 429 body are the evidence.

Read-only. Run from python-odds-service/:  python probe_rate_limits.py
"""

import asyncio
import sys
import time

import httpx

sys.path.insert(0, "src")
import config  # noqa: E402

TIMEOUT = 30
HDR_HINTS = ("ratelimit", "rate-limit", "x-requests", "quota", "remaining",
             "limit", "reset", "retry-after", "used", "credits")

# (label, key, catalogue_url, live_url, uses_header_auth, header_name)
TARGETS = [
    ("SharpAPI", config.SHARPAPI_KEY,
     "https://api.sharpapi.io/api/v1/leagues",
     "https://api.sharpapi.io/api/v1/odds?sport=baseball&league=mlb&is_player_prop=false&limit=10",
     True, "X-API-Key"),
    ("ParlayAPI (PARLAYAPI_KEY)", config.PARLAYAPI_KEY,
     "https://parlay-api.com/v1/sports",
     "https://parlay-api.com/v1/sports/baseball_mlb/props",
     True, "X-API-Key"),
    ("ParlayAPI (NFL key)", config.PARLAYAPI_NFL_KEY,
     "https://parlay-api.com/v1/sports", None, True, "X-API-Key"),
    ("ParlayAPI (CFB key)", config.PARLAYAPI_CFB_KEY,
     "https://parlay-api.com/v1/sports", None, True, "X-API-Key"),
    ("ParlayAPI (MLB key)", config.PARLAYAPI_MLB_KEY,
     "https://parlay-api.com/v1/sports", None, True, "X-API-Key"),
    ("ParlayAPI (SOCCER key)", config.PARLAYAPI_SOCCER_KEY,
     "https://parlay-api.com/v1/sports", None, True, "X-API-Key"),
    ("SportsGameOdds (primary)", config.SPORTSGAMEODDS_KEY,
     "https://api.sportsgameodds.com/v2/leagues", None, True, "X-Api-Key"),
    ("SportsGameOdds (multisport)", config.SPORTSGAMEODDS_MULTISPORT_KEY,
     "https://api.sportsgameodds.com/v2/leagues", None, True, "X-Api-Key"),
    ("Propline (PROPLINE_KEY)", config.PROPLINE_KEY,
     "https://api.prop-line.com/v1/sports", None, False, "apiKey"),
    ("Propline (PROPLINE_2_KEY)", config.PROPLINE_2_KEY,
     "https://api.prop-line.com/v1/sports", None, False, "apiKey"),
    ("The Odds API", config.ODDS_API_KEY,
     "https://api.the-odds-api.com/v4/sports", None, False, "apiKey"),
    ("Odds-API.io", config.ODDSAPIIO_KEY,
     "https://api.odds-api.io/v3/sports", None, False, "apiKey"),
]

spent = {}


async def call(client, url, key, header_auth, param_name):
    h = {param_name: key} if header_auth else {}
    p = None if header_auth else {param_name: key}
    try:
        r = await client.get(url, headers=h, params=p, timeout=TIMEOUT)
    except Exception as e:
        return None, {}, f"{type(e).__name__}: {e}"
    hdrs = {k: v for k, v in r.headers.items()
            if any(t in k.lower() for t in HDR_HINTS)}
    body = ""
    if r.status_code >= 400:
        body = (r.text or "")[:300].replace("\n", " ")
    return r.status_code, hdrs, body


async def main():
    async with httpx.AsyncClient() as c:
        print("\n" + "=" * 74)
        print("PHASE 1+2 — quota headers, one call per key")
        print("=" * 74)
        for label, key, cat_url, live_url, hauth, pname in TARGETS:
            if not key:
                print(f"\n{label}\n  KEY MISSING — skipped")
                continue
            st, hdrs, body = await call(c, cat_url, key, hauth, pname)
            spent[label] = spent.get(label, 0) + 1
            print(f"\n{label}\n  catalogue  HTTP {st}")
            if hdrs:
                for k, v in sorted(hdrs.items()):
                    print(f"      {k}: {v}")
            else:
                print("      (no rate/quota headers returned)")
            if body:
                print(f"      body: {body}")

            if live_url:
                await asyncio.sleep(5)
                st2, h2, b2 = await call(c, live_url, key, hauth, pname)
                spent[label] += 1
                print(f"  live odds  HTTP {st2}")
                if h2:
                    for k, v in sorted(h2.items()):
                        print(f"      {k}: {v}")
                else:
                    print("      (no rate/quota headers returned)")
                if b2:
                    print(f"      body: {b2}")
            await asyncio.sleep(2)

        # ---------- Phase 3: per-minute ceiling, only where cheap ----------
        print("\n" + "=" * 74)
        print("PHASE 3 — per-minute burst (SharpAPI + one ParlayAPI key only)")
        print("=" * 74)

        for label, key, url, cap, hauth, pname in [
            ("SharpAPI", config.SHARPAPI_KEY,
             "https://api.sharpapi.io/api/v1/leagues", 20, True, "X-API-Key"),
            ("ParlayAPI (PARLAYAPI_KEY)", config.PARLAYAPI_KEY,
             "https://parlay-api.com/v1/sports", 20, True, "X-API-Key"),
        ]:
            if not key:
                continue
            print(f"\n{label} — firing up to {cap} back-to-back, stopping at first 429")
            await asyncio.sleep(62)  # clear any window opened above
            ok = 0
            t0 = time.monotonic()
            for i in range(cap):
                st, hdrs, body = await call(c, url, key, hauth, pname)
                spent[label] = spent.get(label, 0) + 1
                if st == 429:
                    el = time.monotonic() - t0
                    print(f"  429 after {ok} successful in {el:.1f}s")
                    for k, v in sorted(hdrs.items()):
                        print(f"      {k}: {v}")
                    if body:
                        print(f"      body: {body}")
                    break
                if st != 200:
                    print(f"  stopped: HTTP {st} after {ok} ok")
                    break
                ok += 1
            else:
                el = time.monotonic() - t0
                print(f"  {ok}/{cap} succeeded in {el:.1f}s with NO 429 "
                      f"— ceiling is above {cap}/min")

        print("\n" + "=" * 74)
        print("COST OF THIS RUN")
        print("=" * 74)
        for k, v in sorted(spent.items()):
            print(f"  {k:<32} {v} requests")


if __name__ == "__main__":
    if sys.platform.startswith("win"):
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
