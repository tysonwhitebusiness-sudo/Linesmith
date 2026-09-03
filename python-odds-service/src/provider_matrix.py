"""The capability matrix — which providers serve which sports, declared once.

WHAT THIS REPLACES. Five hand-written spec builders in jobs.py (`_tier1_specs`,
`_soccer_epl_specs`, `_soccer_mls_specs`, `_tennis_specs`, and the pair inlined
in `_job_multisport`), each independently constructing ProviderSpecs. That is the
same shape CLAUDE.md already warns about for cap-checking: four hand-written job
bodies each had to remember the rate-limit check and two of them didn't. Six
providers across eight sports would make it 48 hand-written constructions.

Here, **adding a sport is a column and adding a provider is a row.**

THE VENDOR TOKEN MAPS BELOW ARE FACTS, VERIFIED LIVE 2026-09-02 against each
vendor's own catalogue endpoint (`probe_all_providers.py`), not copied from
docs/api-capability-audit-2026-08-20.md — whose matrix was wrong in four places.
They deliberately contain MORE sports than `MATRIX` currently activates: the
tokens are what the vendor supports, `MATRIX` is what we actually call. Phase 1d
widens coverage by editing `MATRIX`, which is then a data change rather than new
plumbing.

ONE NAMING TRAP, recorded because it is how the old matrix went wrong: vendors
spell the same league differently. Propline calls the NFL `football_nfl` while
ParlayAPI calls it `americanfootball_nfl`. Comparing those by equality reads
exactly like missing coverage — which is what made a probe of this project's own
keys first report Propline as not covering NFL at all.
"""
from typing import Callable

import config
import providers
from providers import (
    ProviderSpec,
    fetch_oddsapiio,
    fetch_parlayapi,
    fetch_propline,
    fetch_sharpapi,
    fetch_sharpapi_game_lines,
    fetch_sportsgameodds,
)

# ---------------------------------------------------------------------------
# Vendor token maps. Capability, not activation.
# ---------------------------------------------------------------------------

# SharpAPI takes (sport, league). Its catalogue lists 1,199 leagues and covers
# every sport this project runs. Free tier: 12 req/min, 5 concurrent, no daily
# or monthly cap at all — the only uncapped provider here.
SHARPAPI_TOKENS: dict[str, tuple[str, str]] = {
    "mlb": ("baseball", "mlb"),
    "nfl": ("football", "nfl"),
    "cfb": ("football", "ncaaf"),
    "nba": ("basketball", "nba"),
    "nhl": ("hockey", "nhl"),
    "soccer_epl": ("soccer", "england_-_premier_league"),
    "soccer_mls": ("soccer", "usa_-_major_league_soccer"),
    "tennis_atp": ("tennis", "atp"),
    "tennis_wta": ("tennis", "wta"),
}

# The other three maps live in providers.py, beside the fetch functions that use
# them, and are imported rather than restated -- one source of truth. An earlier
# draft of this file duplicated them, which is how a token map drifts.
SGO_LEAGUE_IDS = providers._SGO_LEAGUE_IDS
PROPLINE_SPORT_KEYS = providers._PROPLINE_SPORT_KEYS
PARLAYAPI_SPORT_KEYS = providers._PARLAYAPI_SPORT_KEYS


# ---------------------------------------------------------------------------
# ACTIVATION. What we actually call today.
# ---------------------------------------------------------------------------

# sport -> providers, IN RUN ORDER. Order matters: jobs run these sequentially,
# so it is behaviour, not presentation.
MATRIX: dict[str, tuple[str, ...]] = {
    "mlb": ("sharpapi", "sharpapi_lines", "oddsapiio", "propline"),
    # MLB HAS NO ParlayAPI ROW ON PURPOSE, and it is a real gap, not an
    # oversight: ParlayAPI serves MLB and PARLAYAPI_MLB_KEY has been set all
    # along, so MLB is missing a provider it could have. Gate 10.1 fails on it
    # deliberately.
    #
    # It was briefly wired here as `parlayapi_mlb` and reverted, because that
    # fixed one gate check by making another worse — adding a FIFTH
    # sport-labelled key to the exact set Phase 1f exists to delete, so 1f would
    # have had to rewrite it. A key is a budget bucket, not a coverage grant.
    # 1f closes this once, correctly, as part of pooling.
    #
    # The budget arithmetic 1f will need, worked out here so it is not
    # re-derived: ParlayAPI is 1,000/MONTH, about 33 requests a day, at one
    # request per sport per cycle. Tier 1 ticks every 2.5 minutes, so an ungated
    # spec there wants 576/day — 17x over, and a blown MONTHLY cap costs the rest
    # of the month rather than the rest of the day. Tier 1's ParlayAPI needs a
    # floor of roughly 45 minutes, or the proximity allocation. The other sports
    # do not: their jobs tick at 20 minutes AND route through
    # gameday.should_fetch_paid_providers, which measurably holds them inside
    # budget — parlayapi_nfl spent 23 requests in all of August.
    "soccer_epl": ("sharpapi", "sharpapi_lines", "propline_2", "parlayapi_soccer"),
    "soccer_mls": ("sharpapi", "sharpapi_lines", "propline_2", "parlayapi_soccer",
                   "sportsgameodds_multisport"),
    "tennis_atp": ("sharpapi", "sharpapi_lines"),
    "tennis_wta": ("sharpapi", "sharpapi_lines"),
    "nfl": ("sharpapi", "sharpapi_lines", "parlayapi_nfl", "sportsgameodds_multisport"),
    "cfb": ("sharpapi", "sharpapi_lines", "parlayapi_cfb", "sportsgameodds_multisport"),
    "nba": ("sharpapi", "sharpapi_lines", "parlayapi_nba", "sportsgameodds_multisport"),
    "nhl": ("sharpapi", "sharpapi_lines", "sportsgameodds_multisport"),
}

# PHASE 1d WIDENING, 2026-09-03. SharpAPI added to all eight sports and NHL given
# its first row. Two things decided the shape:
#
#   SharpAPI is free and UNCAPPED (12 req/min, no daily or monthly limit) and
#   costs ONE request per sport per market. It is the obvious floor under
#   everything, and it was wired to two sports of eight.
#
#   PROPLINE WAS DELIBERATELY *NOT* WIDENED, despite carrying 19 of 19 prop
#   books, because its cost is 1 + N requests per cycle -- one per game. A
#   178-game CFB slate would be ~179 requests against a 1,000/DAY cap, so it
#   would exhaust in five cycles. Its shape suits small slates (MLB 15, EPL 10),
#   not large ones. Widening it needs the key pooling of Phase 1f, not a matrix
#   edit, and pretending otherwise would just move the outage rather than fix it.
#
# ParlayAPI is absent from the NHL row for a plain reason: there is no
# PARLAYAPI_NHL_KEY. Its catalogue covers NHL, so this is a provisioning gap,
# not a capability one.

# MLB's own SportsGameOdds account is NOT in MATRIX["mlb"] because it runs on a
# separate 90-minute job rather than inside Tier 1's 2.5-minute cycle. Folding
# it in would now be expressible with min_interval_seconds, but that is a real
# behaviour change and belongs in Phase 1f, not in a refactor.
MLB_SGO_ONLY: tuple[str, ...] = ("sportsgameodds",)

# NHL appears in every token map above and in NO MATRIX row, because it has no
# odds job at all — not broken, never built. Phase 1d adds it.


# ---------------------------------------------------------------------------
# Builders. One per provider; the matrix picks which run.
# ---------------------------------------------------------------------------

def _sharpapi(sport: str, yield_fn, lines: bool) -> ProviderSpec:
    tokens = SHARPAPI_TOKENS.get(sport)
    fetcher = fetch_sharpapi_game_lines if lines else fetch_sharpapi
    return ProviderSpec(
        provider_id="sharpapi_lines" if lines else "sharpapi",
        enabled=config.SHARPAPI_ENABLED and tokens is not None,
        # MLB keeps calling with the function's own defaults rather than
        # explicit tokens, so this refactor cannot change its request URL.
        fetch=(
            (lambda client, games, yf: fetcher(client, config.SHARPAPI_KEY, games))
            if sport == "mlb" else
            (lambda client, games, yf, t=tokens: fetcher(
                client, config.SHARPAPI_KEY, games, sport=t[0], league=t[1]))
        ),
        cap_kind="none",  # 12 req/min vendor limit only; job cadence stays far under it
    )


def _oddsapiio(sport: str, yield_fn) -> ProviderSpec:
    return ProviderSpec(
        provider_id="oddsapiio",
        enabled=config.ODDSAPIIO_ENABLED,
        fetch=lambda client, games, yf: fetch_oddsapiio(
            client, config.ODDSAPIIO_KEY, games, config.ODDSAPIIO_RATE_PER_HOUR),
        cap_kind="daily",
        cap_limit=config.ODDSAPIIO_DAILY_LIMIT,
    )


def _propline(sport: str, yield_fn, second_account: bool) -> ProviderSpec:
    """Two real vendor accounts, not one key used twice — `propline` (MLB) and
    `propline_2` (soccer). They had a shared spend counter until task 5.2, which
    is why `propline` appeared to pin at exactly 1000/1001 every day."""
    pid = "propline_2" if second_account else "propline"
    key = config.PROPLINE_2_KEY if second_account else config.PROPLINE_KEY
    return ProviderSpec(
        provider_id=pid,
        enabled=config.PROPLINE_2_ENABLED if second_account else config.PROPLINE_ENABLED,
        fetch=lambda client, games, yf: fetch_propline(client, key, games, sport, provider_id=pid),
        cap_kind="daily",
        cap_limit=config.PROPLINE_2_DAILY_LIMIT if second_account else config.PROPLINE_DAILY_LIMIT,
        # Only the MLB account carries a cadence floor today. propline_2 is at a
        # fraction of its budget, and EPL and MLS SHARE its provider_id — one
        # throttle key would make one soccer job block the other. That needs
        # per-key pooling (Phase 1f), not a floor.
        min_interval_seconds=(None if second_account else 25 * 60),
    )


_PARLAYAPI: dict[str, tuple[str, str | None, bool, int, int]] = {
    "nfl": ("parlayapi_nfl", config.PARLAYAPI_NFL_KEY, config.PARLAYAPI_NFL_ENABLED,
            config.PARLAYAPI_NFL_MONTHLY_LIMIT, config.PARLAYAPI_NFL_SOFT_CAP),
    "cfb": ("parlayapi_cfb", config.PARLAYAPI_CFB_KEY, config.PARLAYAPI_CFB_ENABLED,
            config.PARLAYAPI_CFB_MONTHLY_LIMIT, config.PARLAYAPI_CFB_SOFT_CAP),
    "nba": ("parlayapi_nba", config.PARLAYAPI_NBA_KEY, config.PARLAYAPI_NBA_ENABLED,
            config.PARLAYAPI_NBA_MONTHLY_LIMIT, config.PARLAYAPI_NBA_SOFT_CAP),
    # MLS reuses EPL's identity — same real account, so same provider_id and one
    # shared monthly budget.
    "soccer_epl": ("parlayapi_soccer", config.PARLAYAPI_SOCCER_KEY, config.PARLAYAPI_SOCCER_ENABLED,
                   config.PARLAYAPI_SOCCER_MONTHLY_LIMIT, config.PARLAYAPI_SOCCER_SOFT_CAP),
    "soccer_mls": ("parlayapi_soccer", config.PARLAYAPI_SOCCER_KEY, config.PARLAYAPI_SOCCER_ENABLED,
                   config.PARLAYAPI_SOCCER_MONTHLY_LIMIT, config.PARLAYAPI_SOCCER_SOFT_CAP),
    "mlb": ("parlayapi_mlb", config.PARLAYAPI_MLB_KEY, config.PARLAYAPI_MLB_ENABLED,
            config.PARLAYAPI_MONTHLY_LIMIT, config.PARLAYAPI_MLB_SOFT_CAP),
}


def _parlayapi(sport: str, yield_fn) -> ProviderSpec:
    pid, key, enabled, limit, soft = _PARLAYAPI[sport]
    return ProviderSpec(
        provider_id=pid,
        enabled=enabled,
        fetch=lambda client, games, yf: fetch_parlayapi(client, key, games, sport),
        cap_kind="monthly",
        cap_limit=limit,  # hard limit; soft_cap stops earlier where set
        soft_cap=soft or None,
    )


def _sgo(sport: str, yield_fn, multisport: bool) -> ProviderSpec:
    """Two separate real accounts. The multisport one is dedicated to NFL/CFB/NBA
    so its quota never competes with MLB's — and its key being undeclared on
    Render is what removed game lines from those three sports entirely."""
    return ProviderSpec(
        provider_id="sportsgameodds_multisport" if multisport else "sportsgameodds",
        enabled=(config.SPORTSGAMEODDS_MULTISPORT_ENABLED if multisport
                 else config.SPORTSGAMEODDS_ENABLED),
        fetch=lambda client, games, yf: fetch_sportsgameodds(
            client,
            config.SPORTSGAMEODDS_MULTISPORT_KEY if multisport else config.SPORTSGAMEODDS_KEY,
            games, config.SPORTSGAMEODDS_RATE_PER_MIN, yield_fn=yf),
        cap_kind="monthly",
        cap_limit=config.SPORTSGAMEODDS_MONTHLY_SOFT_CAP,  # soft cap, not the vendor hard limit
        spend_unit="objects",
    )


_BUILDERS: dict[str, Callable[[str, object], ProviderSpec]] = {
    "sharpapi": lambda sport, yf: _sharpapi(sport, yf, lines=False),
    "sharpapi_lines": lambda sport, yf: _sharpapi(sport, yf, lines=True),
    "oddsapiio": _oddsapiio,
    "propline": lambda sport, yf: _propline(sport, yf, second_account=False),
    "propline_2": lambda sport, yf: _propline(sport, yf, second_account=True),
    "parlayapi_nfl": _parlayapi,
    "parlayapi_cfb": _parlayapi,
    "parlayapi_nba": _parlayapi,
    "parlayapi_mlb": _parlayapi,
    "parlayapi_soccer": _parlayapi,
    "sportsgameodds": lambda sport, yf: _sgo(sport, yf, multisport=False),
    "sportsgameodds_multisport": lambda sport, yf: _sgo(sport, yf, multisport=True),
}


def specs_for(sport: str, yield_fn=None, providers: tuple[str, ...] | None = None) -> list[ProviderSpec]:
    """Every ProviderSpec for one sport, in declared run order.

    `providers` overrides the matrix row — used only by MLB's separate
    SportsGameOdds job, which runs on its own cadence.
    """
    names = providers if providers is not None else MATRIX.get(sport, ())
    return [_BUILDERS[n](sport, yield_fn) for n in names]
