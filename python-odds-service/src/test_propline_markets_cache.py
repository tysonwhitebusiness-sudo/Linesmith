"""Propline's /markets cache — the 50% cost cut in Phase 1a.

WHAT THIS PROTECTS. fetch_propline costs 1 + 2N requests for N games: one
/events call, then /markets AND /odds per game. Against a 1,000/day cap and
refreshTier1's 2.5-minute cadence, a 15-game MLB slate demanded 17,856
requests/day, so the cap died in ~80 minutes and Propline contributed nothing
for the remaining 23 hours. Caching the near-static market LIST turns 1+2N into
1+N.

The regression this guards against is silent in exactly the way this codebase
keeps getting bitten by: if the cache stops being consulted, nothing errors and
no row is missing -- spend just quietly doubles and the cap dies at lunchtime
again. So the assertion is on the REQUEST COUNT, not on the rows.

Run with:  python test_propline_markets_cache.py
"""
import asyncio
import sys

import providers
from game_context import Game
from providers import fetch_propline

_failures = 0


def check(label: str, actual, expected) -> None:
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}: got {actual!r}, expected {expected!r}")


class _Resp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload


class _StubClient:
    """Counts requests by kind so the test can assert on spend, not output."""

    def __init__(self, events, markets, odds):
        self.events, self.markets, self.odds = events, markets, odds
        self.counts = {"events": 0, "markets": 0, "odds": 0}

    async def get(self, url, timeout=None):
        if "/markets" in url:
            self.counts["markets"] += 1
            return _Resp(self.markets)
        if "/odds" in url:
            self.counts["odds"] += 1
            return _Resp(self.odds)
        self.counts["events"] += 1
        return _Resp(self.events)


def _fixture():
    games = [
        Game("mlb", "g1", "Toronto Blue Jays", "New York Yankees", "TOR", "NYY", "2026-09-02"),
        Game("mlb", "g2", "Boston Red Sox", "Baltimore Orioles", "BOS", "BAL", "2026-09-02"),
    ]
    events = [
        {"id": "e1", "home_team": "New York Yankees", "away_team": "Toronto Blue Jays"},
        {"id": "e2", "home_team": "Baltimore Orioles", "away_team": "Boston Red Sox"},
    ]
    markets = [{"key": "batter_hits"}, {"key": "batter_home_runs"}]
    odds = {"bookmakers": []}  # rows are not what this test is about
    return games, events, markets, odds


def test_second_cycle_skips_the_markets_call():
    print("\nmarkets cache — repeat cycle")
    providers._propline_markets_cache.clear()
    games, events, markets, odds = _fixture()

    c1 = _StubClient(events, markets, odds)
    out1 = asyncio.run(fetch_propline(c1, "k", games, "mlb"))
    # Cold: 1 events + 2 markets + 2 odds = 5
    check("cold cycle issues 1+2N requests", out1.requests, 5)
    check("cold cycle fetched /markets per game", c1.counts["markets"], 2)

    c2 = _StubClient(events, markets, odds)
    out2 = asyncio.run(fetch_propline(c2, "k", games, "mlb"))
    # Warm: 1 events + 0 markets + 2 odds = 3
    check("warm cycle issues 1+N requests", out2.requests, 3)
    check("warm cycle makes ZERO /markets calls", c2.counts["markets"], 0)
    check("warm cycle still fetches odds for every game", c2.counts["odds"], 2)

    saved = (out1.requests - out2.requests) / out1.requests
    check("repeat-cycle saving is 40% on a 2-game slate", round(saved, 2), 0.4)


def test_saving_approaches_half_on_a_real_slate():
    print("\nmarkets cache — 15-game slate, the real MLB case")
    providers._propline_markets_cache.clear()
    # REAL team names, not "Home 0".."Home 14": normalize_team_name strips
    # digits, so synthetic numbered names all collapse to one team, every game
    # matches the same event, and the cache looks 15x more effective than it is.
    # The first draft of this test did exactly that and reported cold=17.
    pairs = [
        ("Toronto Blue Jays", "New York Yankees"), ("Boston Red Sox", "Baltimore Orioles"),
        ("Tampa Bay Rays", "Detroit Tigers"), ("Cleveland Guardians", "Chicago White Sox"),
        ("Minnesota Twins", "Kansas City Royals"), ("Houston Astros", "Texas Rangers"),
        ("Seattle Mariners", "Los Angeles Angels"), ("Athletics", "San Francisco Giants"),
        ("Atlanta Braves", "Philadelphia Phillies"), ("New York Mets", "Miami Marlins"),
        ("Washington Nationals", "Pittsburgh Pirates"), ("Chicago Cubs", "Milwaukee Brewers"),
        ("St. Louis Cardinals", "Cincinnati Reds"), ("Los Angeles Dodgers", "San Diego Padres"),
        ("Colorado Rockies", "Arizona Diamondbacks"),
    ]
    games = [
        Game("mlb", f"g{i}", away, home, f"A{i}", f"H{i}", "2026-09-02")
        for i, (away, home) in enumerate(pairs)
    ]
    events = [{"id": f"e{i}", "home_team": home, "away_team": away}
              for i, (away, home) in enumerate(pairs)]
    markets = [{"key": "batter_hits"}]

    c1 = _StubClient(events, markets, {"bookmakers": []})
    cold = asyncio.run(fetch_propline(c1, "k", games, "mlb")).requests
    c2 = _StubClient(events, markets, {"bookmakers": []})
    warm = asyncio.run(fetch_propline(c2, "k", games, "mlb")).requests

    check("cold = 1 + 2*15", cold, 31)
    check("warm = 1 + 15", warm, 16)
    # 576 cycles/day is refreshTier1's real cadence. This is the number that
    # decides whether the 1,000/day cap survives the morning.
    check("daily demand at 2.5min cadence drops 17,856 -> 9,216",
          (cold * 576, warm * 576), (17856, 9216))


def test_empty_market_list_is_not_cached():
    """An unpriced event must be re-asked, not suppressed for the whole TTL.

    These are precisely the games that matter as they approach start: a game
    with no markets yet at 9am will have them by first pitch, and caching the
    empty answer would hide it until the entry expired.
    """
    print("\nmarkets cache — empty list is not cached")
    providers._propline_markets_cache.clear()
    games, events, _, odds = _fixture()

    c1 = _StubClient(events, [], odds)
    asyncio.run(fetch_propline(c1, "k", games, "mlb"))
    check("cold cycle asked for markets", c1.counts["markets"], 2)

    c2 = _StubClient(events, [], odds)
    asyncio.run(fetch_propline(c2, "k", games, "mlb"))
    check("empty result is re-asked, not cached", c2.counts["markets"], 2)
    check("and no odds call is wasted on an unpriced event", c2.counts["odds"], 0)


def test_cache_is_keyed_per_sport_and_event():
    print("\nmarkets cache — key isolation")
    providers._propline_markets_cache.clear()
    providers._propline_markets_store("baseball_mlb", "e1", ["a"])
    check("hit for the stored key", providers._propline_markets_cached("baseball_mlb", "e1"), ["a"])
    check("miss for a different event", providers._propline_markets_cached("baseball_mlb", "e2"), None)
    check("miss for a different sport", providers._propline_markets_cached("soccer_epl", "e1"), None)


def test_ttl_expiry_refetches():
    print("\nmarkets cache — TTL expiry")
    providers._propline_markets_cache.clear()
    providers._propline_markets_store("baseball_mlb", "e1", ["a"])
    # Rewrite the stored expiry into the past rather than sleeping 3 hours.
    keys, _ = providers._propline_markets_cache[("baseball_mlb", "e1")]
    providers._propline_markets_cache[("baseball_mlb", "e1")] = (keys, 0.0)
    check("expired entry reads as a miss", providers._propline_markets_cached("baseball_mlb", "e1"), None)
    check("expired entry is evicted", ("baseball_mlb", "e1") in providers._propline_markets_cache, False)


if __name__ == "__main__":
    test_second_cycle_skips_the_markets_call()
    test_saving_approaches_half_on_a_real_slate()
    test_empty_market_list_is_not_cached()
    test_cache_is_keyed_per_sport_and_event()
    test_ttl_expiry_refetches()
    print(f"\n{'FAILED: ' + str(_failures) if _failures else 'all passed'}")
    sys.exit(1 if _failures else 0)
