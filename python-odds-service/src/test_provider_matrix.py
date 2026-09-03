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
    "mlb": [SHARP, SHARP_L, ("oddsapiio", "daily", 500, "requests", 2700), ("propline", "daily", 1000, "requests", 1500), ("parlayapi", "monthly", 1000, "requests", 2700)],
    "soccer_epl": [SHARP, SHARP_L, ("propline", "daily", 1000, "requests", 1500), ("parlayapi", "monthly", 1000, "requests", 2700)],
    "soccer_mls": [SHARP, SHARP_L, ("propline", "daily", 1000, "requests", 1500), ("parlayapi", "monthly", 1000, "requests", 2700), ("sportsgameodds", "monthly", 2000, "objects", None)],
    "tennis_atp": [SHARP, SHARP_L],
    "tennis_wta": [SHARP, SHARP_L],
    "nfl": [SHARP, SHARP_L, ("propline", "daily", 1000, "requests", 1500), ("parlayapi", "monthly", 1000, "requests", 2700), ("sportsgameodds", "monthly", 2000, "objects", None)],
    "cfb": [SHARP, SHARP_L, ("parlayapi", "monthly", 1000, "requests", 2700), ("sportsgameodds", "monthly", 2000, "objects", None)],
    "nba": [SHARP, SHARP_L, ("propline", "daily", 1000, "requests", 1500), ("parlayapi", "monthly", 1000, "requests", 2700), ("sportsgameodds", "monthly", 2000, "objects", None)],
    "nhl": [SHARP, SHARP_L, ("propline", "daily", 1000, "requests", 1500), ("parlayapi", "monthly", 1000, "requests", 2700), ("sportsgameodds", "monthly", 2000, "objects", None)],
}


# The URL each provider's fetch actually hits, query string stripped.
EXPECTED_URLS = {
    ("mlb", 0): "https://api.sharpapi.io/api/v1/odds",
    ("mlb", 3): "https://api.prop-line.com/v1/sports/baseball_mlb/events",
    ("tennis_atp", 0): "https://api.sharpapi.io/api/v1/odds",
    ("soccer_epl", 2): "https://api.prop-line.com/v1/sports/soccer_epl/events",
    ("soccer_mls", 2): "https://api.prop-line.com/v1/sports/soccer_mls/events",
    ("nfl", 2): "https://api.prop-line.com/v1/sports/football_nfl/events",
    ("nfl", 3): "https://parlay-api.com/v1/sports/americanfootball_nfl/props",
    ("cfb", 2): "https://parlay-api.com/v1/sports/americanfootball_ncaaf/props",
    ("nba", 3): "https://parlay-api.com/v1/sports/basketball_nba/props",
    ("nhl", 2): "https://api.prop-line.com/v1/sports/hockey_nhl/events",
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
    """A pooled spec has no `.fetch` — the runner picks a key and calls
    `fetch_keyed`. Probe whichever the spec actually uses."""
    c = _C()
    try:
        if spec.pool:
            asyncio.run(spec.fetch_keyed(c, _GAMES, None, "probe-key"))
        else:
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
    check("EPL has no SGO", "sportsgameodds" in pm.MATRIX["soccer_epl"], False)
    check("MLS does have SGO", "sportsgameodds" in pm.MATRIX["soccer_mls"], True)
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
    # NHL now HAS ParlayAPI. Phase 1f both pooled the keys and added the missing
    # icehockey_nhl token — without that token the pooled row would have fetched
    # against a None sport key and returned zero rows, silently.
    check("ParlayAPI now serves NHL",
          any(p == "parlayapi" for p in pm.MATRIX["nhl"]), True)


def test_propline_widened_everywhere_except_cfb():
    """Phase 1f pooled Propline's two accounts, so it widened from 2 sports to 6.

    CFB is the one exclusion, and it is arithmetic rather than taste: Propline
    costs 1 + N requests per cycle, so a 178-game CFB slate is ~179 requests.
    Even pooled at 2,000/day that is eleven cycles, against SharpAPI's ONE
    request for the same slate.
    """
    print("\nmatrix - Propline widened, CFB excepted")
    for sport in ("mlb", "nfl", "nba", "nhl", "soccer_epl", "soccer_mls"):
        check(f"{sport} has propline", "propline" in pm.MATRIX[sport], True)
    check("cfb does NOT", "propline" in pm.MATRIX["cfb"], False)


def test_keys_are_pooled_not_sport_labelled():
    """The core of Phase 1f. A key is a BUDGET BUCKET, not a coverage grant —
    every ParlayAPI key returns the same 405-sport catalogue, so the per-sport
    names stranded quota rather than granting access."""
    print("\nmatrix - keys are pooled")
    labelled = [p for provs in pm.MATRIX.values() for p in provs
                if p.startswith(("parlayapi_", "propline_", "sportsgameodds_"))]
    check("no sport-labelled provider ids remain", sorted(set(labelled)), [])
    for family in ("parlayapi", "propline", "sportsgameodds"):
        check(f"{family} pool declared", family in pm.KEY_POOLS, True)
    spec = next(s for s in pm.specs_for("nfl") if s.provider_id == "parlayapi")
    check("a pooled spec carries its pool", len(spec.pool) >= 2, True)
    check("and a keyed fetch", spec.fetch_keyed is not None, True)
    # An unprovisioned key stays in the pool as an empty slot rather than being
    # dropped, so the runner skips it instead of the pool silently shrinking.
    check("unprovisioned keys are kept as empty slots",
          any(not k for _, k in pm.KEY_POOLS["parlayapi"]), True)



if __name__ == "__main__":
    test_every_sport_produces_the_frozen_spec_list()
    test_mlb_sgo_stays_on_its_own_job()
    test_fetch_closures_hit_the_right_urls()
    test_sgo_coverage_gap_is_real()
    test_token_maps_cover_every_activated_cell()
    test_sharpapi_is_the_floor_under_every_sport()
    test_nhl_is_now_wired()
    test_propline_widened_everywhere_except_cfb()
    test_keys_are_pooled_not_sport_labelled()
    print(f"\n{'FAILED: ' + str(_failures) if _failures else 'all passed'}")
    sys.exit(1 if _failures else 0)
