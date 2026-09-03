"""The capability matrix declares which providers serve which sports.

WHY THIS EXISTS. Phase 1c replaced five hand-written spec builders with one
declared matrix; Phase 1d then widened it. A change to the thing that decides
WHICH PROVIDER GETS CALLED FOR WHICH SPORT fails in a way nothing else catches:
a dropped provider is not an error, it is just a sport quietly getting less
data — which is exactly how NFL and CFB went dark for twelve days without a
single failing check.

So this freezes the answer. EXPECTED was captured from the old builders before
they were deleted, then updated deliberately for 1d's widening. Any drift is a
decision that has to change this file too.

REDACTION. Propline authenticates with `?apiKey=` in the URL, so the URL
comparison strips query strings. An earlier ad-hoc version of this check printed
full URLs and put two live keys into a terminal transcript.

Run with:  python test_provider_matrix.py
"""
import asyncio
import sys

import provider_matrix as pm
from game_context import Game

_failures = 0

SHARP = ("sharpapi", "none", None, "requests", None)
SHARP_L = ("sharpapi_lines", "none", None, "requests", None)
SGO_MULTI = ("sportsgameodds_multisport", "monthly", 2000, "objects", None)


def check(label, actual, expected):
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}:\n          got      {actual!r}\n          expected {expected!r}")


# (provider_id, cap_kind, cap_limit, spend_unit, min_interval) per sport, in run
# order. `enabled` and `soft_cap` are deliberately NOT frozen: both depend on
# which keys the environment has, so they differ between a local run and the
# Render worker, and freezing them would make this assert about a machine.
EXPECTED = {
    "mlb": [SHARP, SHARP_L, ("oddsapiio", "daily", 500, "requests", None),
            ("propline", "daily", 1000, "requests", 1500)],
    "soccer_epl": [SHARP, SHARP_L, ("propline_2", "daily", 1000, "requests", None),
                   ("parlayapi_soccer", "monthly", 1000, "requests", None)],
    "soccer_mls": [SHARP, SHARP_L, ("propline_2", "daily", 1000, "requests", None),
                   ("parlayapi_soccer", "monthly", 1000, "requests", None), SGO_MULTI],
    "tennis_atp": [SHARP, SHARP_L],
    "tennis_wta": [SHARP, SHARP_L],
    "nfl": [SHARP, SHARP_L, ("parlayapi_nfl", "monthly", 1000, "requests", None), SGO_MULTI],
    "cfb": [SHARP, SHARP_L, ("parlayapi_cfb", "monthly", 1000, "requests", None), SGO_MULTI],
    "nba": [SHARP, SHARP_L, ("parlayapi_nba", "monthly", 1000, "requests", None), SGO_MULTI],
    "nhl": [SHARP, SHARP_L, SGO_MULTI],
}

# The URL each provider's fetch actually hits, query string stripped.
EXPECTED_URLS = {
    ("mlb", 0): "https://api.sharpapi.io/api/v1/odds",
    ("mlb", 3): "https://api.prop-line.com/v1/sports/baseball_mlb/events",
    ("tennis_atp", 0): "https://api.sharpapi.io/api/v1/odds",
    ("soccer_epl", 2): "https://api.prop-line.com/v1/sports/soccer_epl/events",
    ("soccer_mls", 2): "https://api.prop-line.com/v1/sports/soccer_mls/events",
    ("nfl", 2): "https://parlay-api.com/v1/sports/americanfootball_nfl/props",
    ("cfb", 2): "https://parlay-api.com/v1/sports/americanfootball_ncaaf/props",
    ("nba", 2): "https://parlay-api.com/v1/sports/basketball_nba/props",
}


class _R:
    status_code = 200

    def json(self):
        return []


class _C:
    def __init__(self):
        self.urls = []

    async def get(self, url, timeout=None, headers=None, params=None):
        self.urls.append(url.split("?")[0])  # REDACTED — propline's key is in the query
        return _R()


_GAMES = [Game("x", "g1", "Toronto Blue Jays", "New York Yankees", "TOR", "NYY", "2026-09-02")]


def _first_url(spec):
    c = _C()
    try:
        asyncio.run(spec.fetch(c, _GAMES, None))
    except Exception:
        pass
    return c.urls[0] if c.urls else None


def test_every_sport_produces_the_frozen_spec_list():
    print("\nmatrix - frozen spec list per sport")
    for sport, expected in EXPECTED.items():
        got = [(s.provider_id, s.cap_kind, s.cap_limit, s.spend_unit, s.min_interval_seconds)
               for s in pm.specs_for(sport)]
        check(sport, got, expected)


def test_mlb_sgo_stays_on_its_own_job():
    """MLB's SportsGameOdds account runs on a separate 90-minute job, so it must
    NOT appear in MATRIX['mlb'] — folding it into Tier 1's 2.5-minute cycle would
    be a real behaviour change, not a refactor."""
    print("\nmatrix - MLB's SGO account is separate")
    check("not in the mlb row",
          [s.provider_id for s in pm.specs_for("mlb")].count("sportsgameodds"), 0)
    sgo = pm.specs_for("mlb", providers=pm.MLB_SGO_ONLY)
    check("reachable via MLB_SGO_ONLY", [s.provider_id for s in sgo], ["sportsgameodds"])
    check("monthly, object-counted", (sgo[0].cap_kind, sgo[0].spend_unit), ("monthly", "objects"))


def test_fetch_closures_hit_the_right_urls():
    """Spec metadata matching is not enough — the closure has to call the same
    vendor endpoint. Tennis is the one that would silently break: it is the only
    sport passing explicit sport/league tokens to SharpAPI."""
    print("\nmatrix - fetch closures hit the expected endpoints")
    for (sport, idx), expected in EXPECTED_URLS.items():
        check(f"{sport}[{idx}]", _first_url(pm.specs_for(sport)[idx]), expected)


def test_sgo_coverage_gap_is_real():
    """SportsGameOdds' catalogue is exactly eight leagues: it has MLS but no EPL,
    and no tennis at all. Verified live 2026-09-02 — a real coverage difference,
    not an oversight to normalise away."""
    print("\nmatrix - SportsGameOdds' real coverage gap")
    check("EPL has no SGO", "sportsgameodds_multisport" in pm.MATRIX["soccer_epl"], False)
    check("MLS does have SGO", "sportsgameodds_multisport" in pm.MATRIX["soccer_mls"], True)
    check("tennis has no SGO", any("sportsgameodds" in p for p in pm.MATRIX["tennis_atp"]), False)
    check("SGO token map excludes EPL", "soccer_epl" in pm.SGO_LEAGUE_IDS, False)


def test_token_maps_cover_every_activated_cell():
    """A matrix row naming a provider with no vendor token for that sport would
    fetch a wrong or empty URL and return zero rows — silently."""
    print("\nmatrix - every activated cell has a vendor token")
    for sport, provs in pm.MATRIX.items():
        for p in provs:
            if p.startswith("sharpapi"):
                check(f"{sport}/{p}", sport in pm.SHARPAPI_TOKENS, True)
            elif p.startswith("parlayapi"):
                check(f"{sport}/{p}", sport in pm.PARLAYAPI_SPORT_KEYS, True)
            elif p.startswith("sportsgameodds"):
                check(f"{sport}/{p}", sport in pm.SGO_LEAGUE_IDS, True)
            elif p.startswith("propline"):
                check(f"{sport}/{p}", sport in pm.PROPLINE_SPORT_KEYS, True)


def test_sharpapi_is_the_floor_under_every_sport():
    """Phase 1d's biggest win: the only uncapped provider, previously wired to
    two sports of eight. If a sport loses this row it loses its free floor."""
    print("\nmatrix - SharpAPI covers every sport")
    for sport in pm.MATRIX:
        check(f"{sport} props", "sharpapi" in pm.MATRIX[sport], True)
        check(f"{sport} lines", "sharpapi_lines" in pm.MATRIX[sport], True)


def test_nhl_is_now_wired():
    """NHL had no odds job at all until Phase 1d — not broken, never built, in a
    codebase already holding 24,336 priced NHL games. A matrix row nothing calls
    is as useless as no row, so this asserts the job too."""
    print("\nmatrix - NHL is wired")
    check("has a matrix row", "nhl" in pm.MATRIX, True)
    check("SharpAPI serves it", pm.SHARPAPI_TOKENS.get("nhl"), ("hockey", "nhl"))
    check("SGO serves it", pm.SGO_LEAGUE_IDS.get("nhl"), "NHL")
    import jobs
    check("refreshNhlJob registered",
          "refreshNhlJob" in [n for n, _, _ in jobs.JOB_REGISTRY], True)
    # No PARLAYAPI_NHL_KEY exists — a provisioning gap, not a capability one.
    check("ParlayAPI absent from NHL",
          any(p.startswith("parlayapi") for p in pm.MATRIX["nhl"]), False)


def test_propline_stays_off_large_slates():
    """Propline carries 19 of 19 prop books but costs 1 + N requests per cycle.
    A 178-game CFB slate is ~179 requests against a 1,000/DAY cap — it would
    exhaust in five cycles. It stays on small slates until Phase 1f's key
    pooling."""
    print("\nmatrix - Propline stays off large slates")
    for sport in ("cfb", "nfl", "nba", "nhl"):
        check(f"{sport} has no propline",
              any(p.startswith("propline") for p in pm.MATRIX[sport]), False)
    check("mlb keeps propline", "propline" in pm.MATRIX["mlb"], True)
    check("soccer keeps propline_2", "propline_2" in pm.MATRIX["soccer_epl"], True)


if __name__ == "__main__":
    test_every_sport_produces_the_frozen_spec_list()
    test_mlb_sgo_stays_on_its_own_job()
    test_fetch_closures_hit_the_right_urls()
    test_sgo_coverage_gap_is_real()
    test_token_maps_cover_every_activated_cell()
    test_sharpapi_is_the_floor_under_every_sport()
    test_nhl_is_now_wired()
    test_propline_stays_off_large_slates()
    print(f"\n{'FAILED: ' + str(_failures) if _failures else 'all passed'}")
    sys.exit(1 if _failures else 0)
