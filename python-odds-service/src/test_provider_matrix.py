"""The capability matrix produces exactly the specs the hand-written builders did.

WHY THIS EXISTS. Phase 1c replaced five hand-written spec builders with one
declared matrix. A refactor of the thing that decides WHICH PROVIDER GETS CALLED
FOR WHICH SPORT can go wrong in a way nothing else catches: a dropped provider is
not an error, it is just a sport quietly getting less data — which is precisely
how NFL and CFB went dark for twelve days without a single failing check.

So this freezes the answer. EXPECTED below was captured from the old builders
before they were deleted, and any drift is a deliberate decision that has to
change this file too.

REDACTION. Propline authenticates with `?apiKey=` in the URL, so the URL
comparison strips query strings. An earlier ad-hoc version of this test printed
full URLs and put two live keys into a terminal transcript.

Run with:  python test_provider_matrix.py
"""
import asyncio
import sys

import provider_matrix as pm
from game_context import Game

_failures = 0


def check(label, actual, expected):
    global _failures
    if actual == expected:
        print(f"  PASS  {label}")
    else:
        _failures += 1
        print(f"  FAIL  {label}:\n          got      {actual!r}\n          expected {expected!r}")


# (provider_id, cap_kind, cap_limit, spend_unit, min_interval) per sport, in run
# order. Captured from the pre-refactor builders on 2026-09-03.
#
# `enabled` and `soft_cap` are deliberately NOT frozen here: both depend on which
# keys are present in the environment, so they differ between a local run and the
# Render worker. Freezing them would make this test assert about a machine rather
# than about the matrix.
EXPECTED = {
    "mlb": [
        ("sharpapi", "none", None, "requests", None),
        ("sharpapi_lines", "none", None, "requests", None),
        ("oddsapiio", "daily", 500, "requests", None),
        ("propline", "daily", 1000, "requests", 1500),
    ],
    "soccer_epl": [
        ("propline_2", "daily", 1000, "requests", None),
        ("parlayapi_soccer", "monthly", 1000, "requests", None),
    ],
    "soccer_mls": [
        ("propline_2", "daily", 1000, "requests", None),
        ("parlayapi_soccer", "monthly", 1000, "requests", None),
        ("sportsgameodds_multisport", "monthly", 2000, "objects", None),
    ],
    "tennis_atp": [
        ("sharpapi", "none", None, "requests", None),
        ("sharpapi_lines", "none", None, "requests", None),
    ],
    "tennis_wta": [
        ("sharpapi", "none", None, "requests", None),
        ("sharpapi_lines", "none", None, "requests", None),
    ],
    "nfl": [
        ("parlayapi_nfl", "monthly", 1000, "requests", None),
        ("sportsgameodds_multisport", "monthly", 2000, "objects", None),
    ],
    "cfb": [
        ("parlayapi_cfb", "monthly", 1000, "requests", None),
        ("sportsgameodds_multisport", "monthly", 2000, "objects", None),
    ],
    "nba": [
        ("parlayapi_nba", "monthly", 1000, "requests", None),
        ("sportsgameodds_multisport", "monthly", 2000, "objects", None),
    ],
}

# The URL each provider's fetch actually hits, query string stripped.
EXPECTED_URLS = {
    ("mlb", 0): "https://api.sharpapi.io/api/v1/odds",
    ("mlb", 3): "https://api.prop-line.com/v1/sports/baseball_mlb/events",
    ("tennis_atp", 0): "https://api.sharpapi.io/api/v1/odds",
    ("soccer_epl", 0): "https://api.prop-line.com/v1/sports/soccer_epl/events",
    ("soccer_mls", 0): "https://api.prop-line.com/v1/sports/soccer_mls/events",
    ("nfl", 0): "https://parlay-api.com/v1/sports/americanfootball_nfl/props",
    ("cfb", 0): "https://parlay-api.com/v1/sports/americanfootball_ncaaf/props",
    ("nba", 0): "https://parlay-api.com/v1/sports/basketball_nba/props",
}


class _R:
    status_code = 200

    def json(self):
        return []


class _C:
    def __init__(self):
        self.urls = []

    async def get(self, url, timeout=None, headers=None, params=None):
        self.urls.append(url.split("?")[0])  # REDACTED — propline puts its key in the query
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
    print("\nmatrix — spec lists match the pre-refactor builders")
    for sport, expected in EXPECTED.items():
        got = [(s.provider_id, s.cap_kind, s.cap_limit, s.spend_unit, s.min_interval_seconds)
               for s in pm.specs_for(sport)]
        check(sport, got, expected)


def test_mlb_sgo_stays_on_its_own_job():
    """MLB's SportsGameOdds account runs on a separate 90-minute job, so it must
    NOT appear in MATRIX['mlb'] — folding it into Tier 1's 2.5-minute cycle would
    be a real behaviour change, not a refactor."""
    print("\nmatrix — MLB's SGO account is separate")
    check("not in the mlb row", [s.provider_id for s in pm.specs_for("mlb")].count("sportsgameodds"), 0)
    sgo = pm.specs_for("mlb", providers=pm.MLB_SGO_ONLY)
    check("reachable via MLB_SGO_ONLY", [s.provider_id for s in sgo], ["sportsgameodds"])
    check("monthly, object-counted", (sgo[0].cap_kind, sgo[0].spend_unit), ("monthly", "objects"))


def test_fetch_closures_hit_the_right_urls():
    """Spec metadata matching is not enough — the closure has to call the same
    vendor endpoint. Tennis is the one that would silently break: it is the only
    sport passing explicit sport/league tokens to SharpAPI."""
    print("\nmatrix — fetch closures hit the expected endpoints")
    for (sport, idx), expected in EXPECTED_URLS.items():
        check(f"{sport}[{idx}]", _first_url(pm.specs_for(sport)[idx]), expected)


def test_sgo_has_no_epl_and_tennis_has_no_sgo():
    """A real coverage difference, not an oversight: SportsGameOdds' catalogue is
    exactly eight leagues and contains MLS but not EPL, and no tennis at all.
    Verified live 2026-09-02."""
    print("\nmatrix — SportsGameOdds' real coverage gap")
    check("EPL has no SGO", "sportsgameodds_multisport" in pm.MATRIX["soccer_epl"], False)
    check("MLS does have SGO", "sportsgameodds_multisport" in pm.MATRIX["soccer_mls"], True)
    check("tennis has no SGO", any("sportsgameodds" in p for p in pm.MATRIX["tennis_atp"]), False)
    check("SGO token map excludes EPL", "soccer_epl" in pm.SGO_LEAGUE_IDS, False)


def test_token_maps_cover_every_sport_the_matrix_activates():
    """A matrix row naming a provider that has no vendor token for that sport
    would fetch against a wrong or empty URL and return zero rows — silently."""
    print("\nmatrix — every activated cell has a vendor token")
    for sport, provs in pm.MATRIX.items():
        for p in provs:
            if p.startswith("sharpapi"):
                check(f"{sport}/{p} token", sport in pm.SHARPAPI_TOKENS, True)
            elif p.startswith("parlayapi"):
                check(f"{sport}/{p} token", sport in pm.PARLAYAPI_SPORT_KEYS, True)
            elif p.startswith("sportsgameodds"):
                check(f"{sport}/{p} token", sport in pm.SGO_LEAGUE_IDS, True)


def test_nhl_is_declared_capable_but_not_activated():
    """NHL has no odds job at all — not broken, never built. The token maps say
    five providers serve it; the matrix says nobody calls it. Phase 1d closes
    this, and when it does, this test should be updated rather than deleted."""
    print("\nmatrix — NHL, capable but unwired")
    check("no matrix row", "nhl" in pm.MATRIX, False)
    check("SharpAPI can serve it", pm.SHARPAPI_TOKENS.get("nhl"), ("hockey", "nhl"))
    check("SGO can serve it", pm.SGO_LEAGUE_IDS.get("nhl"), "NHL")
    check("Propline can serve it", pm.PROPLINE_SPORT_KEYS.get("nhl"), "hockey_nhl")


if __name__ == "__main__":
    test_every_sport_produces_the_frozen_spec_list()
    test_mlb_sgo_stays_on_its_own_job()
    test_fetch_closures_hit_the_right_urls()
    test_sgo_has_no_epl_and_tennis_has_no_sgo()
    test_token_maps_cover_every_sport_the_matrix_activates()
    test_nhl_is_declared_capable_but_not_activated()
    print(f"\n{'FAILED: ' + str(_failures) if _failures else 'all passed'}")
    sys.exit(1 if _failures else 0)
