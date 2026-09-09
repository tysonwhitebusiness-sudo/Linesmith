"""SharpAPI's prop board is cursor-paginated and we read page one. Phase 4.7.

Measured 2026-09-09: the request asks `limit=500`, the server caps the page at
200 and returns `has_more: true` with a `next_cursor` the old code discarded.
NFL's whole ingested board was therefore the first 200 rows — one game, one
book, 2 of that game's 19 markets — while FanDuel posted the full slate.

Nothing errored, which is why it survived: 200 real rows is a plausible
response. These tests pin the walk AND its rate discipline, because the fix
turns one request per cycle into up to `max_pages`, and the operator's
constraint is spend.
"""
import asyncio, sys, time

sys.path.insert(0, "src")
import rate_limit
import providers
from providers import fetch_sharpapi
from game_context import Game


class FakeResponse:
    def __init__(self, payload, status=200):
        self._p, self.status_code = payload, status
    def json(self):
        return self._p


class FakeClient:
    """Serves a fixed number of cursor-linked pages and counts requests."""
    def __init__(self, pages, status=200):
        self.pages, self.status = pages, status
        self.urls = []
    async def get(self, url, headers=None, timeout=None):
        self.urls.append(url)
        idx = 0
        if "cursor=" in url:
            idx = int(url.split("cursor=")[1].split("&")[0])
        last = idx >= self.pages - 1
        return FakeResponse({
            "data": [{"player_name": f"p{idx}", "stat_category": "player_receptions",
                      "home_team": "H", "away_team": "A", "event_id": f"e{idx}",
                      "sportsbook": "fanduel", "selection_type": "over",
                      "line": 3.5, "odds_american": -110, "odds_decimal": 1.91}],
            "pagination": {"has_more": not last, "next_cursor": None if last else str(idx + 1)},
        }, self.status)


def _games():
    return [Game(sport="nfl", game_id="g1", away_team_name="A", home_team_name="H",
                 away_abbr="A", home_abbr="H", game_date="2026-09-13T17:00Z",
                 roster=[])]


def run(coro):
    return asyncio.run(coro)


def setup():
    rate_limit._windows.clear()


def test_walks_every_page():
    setup()
    c = FakeClient(pages=5)
    out = run(fetch_sharpapi(c, "k", _games(), sport="football", league="nfl",
                             max_pages=12, rate_per_min=600))
    assert out.requests == 5, f"expected 5 requests, got {out.requests}"
    assert len(c.urls) == 5
    assert "cursor=" not in c.urls[0], "first page must not send a cursor"
    assert all("cursor=" in u for u in c.urls[1:]), c.urls
    print(f"PASS  follows the cursor to the end ({out.requests} pages)")


def test_single_page_board_makes_one_request():
    """The MLB-shaped case: no has_more, so behaviour is exactly as before."""
    setup()
    c = FakeClient(pages=1)
    out = run(fetch_sharpapi(c, "k", _games(), max_pages=12, rate_per_min=600))
    assert out.requests == 1, out.requests
    assert out.warnings == [], out.warnings
    print("PASS  an unpaginated board still costs exactly one request")


def test_max_pages_caps_the_walk_AND_reports_it():
    setup()
    c = FakeClient(pages=99)
    out = run(fetch_sharpapi(c, "k", _games(), max_pages=4, rate_per_min=600))
    assert out.requests == 4, f"cap not enforced: {out.requests} requests"
    assert any("page cap" in w for w in out.warnings), out.warnings
    print(f"PASS  caps at max_pages and warns ({out.requests} requests, warned)")


def test_never_exceeds_the_rate_limit():
    """THE OPERATOR'S CONSTRAINT. 12 req/min must hold across the whole walk."""
    setup()
    c = FakeClient(pages=99)
    started = time.monotonic()
    out = run(fetch_sharpapi(c, "k", _games(), max_pages=12, rate_per_min=12))
    elapsed = time.monotonic() - started
    assert out.requests <= 12, f"{out.requests} requests in {elapsed:.1f}s exceeds 12/min"
    # The gate is check-and-consume, so 12 requests exactly fills one window and
    # a 13th would have had to wait for it to roll.
    assert not rate_limit.within_rate("sharpapi", 12, 60.0), \
        "window should be spent after a full walk"
    print(f"PASS  {out.requests} requests inside a 12/min window, none over")


def test_429_backs_off_and_stops():
    setup()
    c = FakeClient(pages=99, status=429)
    out = run(fetch_sharpapi(c, "k", _games(), max_pages=12, rate_per_min=600))
    assert out.rate_limited is True
    assert out.requests == 1, f"must stop on 429, made {out.requests}"
    assert any("429" in w for w in out.warnings), out.warnings
    print("PASS  a 429 stops the walk and marks rate_limited")


def test_has_more_without_cursor_does_not_loop():
    setup()
    class Contradictory(FakeClient):
        async def get(self, url, headers=None, timeout=None):
            self.urls.append(url)
            return FakeResponse({"data": [], "pagination": {"has_more": True,
                                                            "next_cursor": None}})
    c = Contradictory(pages=1)
    out = run(fetch_sharpapi(c, "k", _games(), max_pages=12, rate_per_min=600))
    assert out.requests == 1, f"looped {out.requests} times on a bad cursor"
    assert any("no next_cursor" in w for w in out.warnings), out.warnings
    print("PASS  has_more with no cursor stops instead of re-reading page one")


for fn in [test_walks_every_page, test_single_page_board_makes_one_request,
           test_max_pages_caps_the_walk_AND_reports_it,
           test_never_exceeds_the_rate_limit, test_429_backs_off_and_stops,
           test_has_more_without_cursor_does_not_loop]:
    fn()
print("\nall sharpapi pagination checks passed")


# --- the per-sport page budget --------------------------------------------
import provider_matrix as pm


def test_mlb_gets_a_small_budget_because_it_ticks_every_2_5_minutes():
    """A flat cap overspends the FASTEST job, not the biggest slate.

    refreshTier1 runs 24x/hour; the 20-minute sports run 3x/hour. At 12 pages
    each the worker would want ~540 req/hour against a 720/hour ceiling, in
    bursts — measured to a real 429 during development.
    """
    mlb, nfl = pm._sharpapi_pages("mlb"), pm._sharpapi_pages("nfl")
    assert mlb < nfl, f"mlb {mlb} should be under nfl {nfl}"
    # The budget the comments claim, checked rather than asserted in prose.
    hourly = mlb * 24 + nfl * 3 + pm._sharpapi_pages("cfb") * 3 + \
        sum(pm._sharpapi_pages(s) * 3 for s in
            ("nba", "nhl", "soccer_epl", "soccer_mls", "tennis_atp", "tennis_wta"))
    ceiling = 12 * 60
    assert hourly < ceiling * 0.5, f"{hourly} req/hour is over half the {ceiling} ceiling"
    print(f"PASS  per-sport budget = {hourly} req/hour vs {ceiling} ceiling "
          f"({hourly/ceiling:.0%})")


def test_unlisted_sport_falls_back_not_crashes():
    assert pm._sharpapi_pages("kabaddi") == pm.SHARPAPI_DEFAULT_SPORT_PAGES
    print("PASS  an unlisted sport takes the conservative default")


def test_game_lines_path_takes_no_paging_kwargs():
    """`fetch_sharpapi_game_lines` has a different signature; passing paging
    kwargs to it would be a TypeError at runtime, in production, on a path no
    unit test covers."""
    assert pm._sharpapi_paging("nfl", lines=True, yf=None) == {}
    assert set(pm._sharpapi_paging("nfl", lines=False, yf=None)) == \
        {"yield_fn", "max_pages", "rate_per_min"}
    print("PASS  only the prop fetcher receives paging kwargs")


for fn in [test_mlb_gets_a_small_budget_because_it_ticks_every_2_5_minutes,
           test_unlisted_sport_falls_back_not_crashes,
           test_game_lines_path_takes_no_paging_kwargs]:
    fn()
print("all page-budget checks passed")
