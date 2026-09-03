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
# KEY POOLS. Phase 1f.
# ---------------------------------------------------------------------------
#
# A key is a BUDGET BUCKET, not a coverage grant. Every ParlayAPI key returns the
# identical 405-sport catalogue and every Propline key the same 54, so naming one
# PARLAYAPI_NFL_KEY never made it an NFL key -- it stranded quota. NFL's key
# could exhaust on a heavy Sunday while CFB's sat untouched, and NFL went dark
# anyway because nothing could borrow the idle budget.
#
# Ordered: the runner reserves against each in turn and uses the first with
# headroom, so total capacity is the SUM and it is fungible across sports.
# Adding capacity is registering another free key, not rewiring a sport.
#
# Proven safe by this project's own data: on 2026-08-30 `propline` and
# `propline_2` each spent 1,000 requests on the same day from the same worker,
# so per-key quota accumulates independently and is not IP-capped.
#
# An unset key is SKIPPED, not an error -- PARLAYAPI_NBA_KEY has never been
# provisioned, and a pool with a hole in it should still work.
KEY_POOLS: dict[str, tuple[tuple[str, str | None], ...]] = {
    "parlayapi": (
        ("parlayapi_k1", config.PARLAYAPI_KEY),
        ("parlayapi_k2", config.PARLAYAPI_MLB_KEY),
        ("parlayapi_k3", config.PARLAYAPI_NFL_KEY),
        ("parlayapi_k4", config.PARLAYAPI_CFB_KEY),
        ("parlayapi_k5", config.PARLAYAPI_SOCCER_KEY),
        ("parlayapi_k6", config.PARLAYAPI_NBA_KEY),
    ),
    "propline": (
        ("propline_k1", config.PROPLINE_KEY),
        ("propline_k2", config.PROPLINE_2_KEY),
    ),
    "sportsgameodds": (
        ("sgo_k1", config.SPORTSGAMEODDS_KEY),
        ("sgo_k2", config.SPORTSGAMEODDS_MULTISPORT_KEY),
    ),
}

# The old sport-labelled provider_ids keep their spend history; the pooled ids
# start clean. That is deliberate -- provider_usage rows are a real record of
# what each vendor account spent, and rewriting them to a new naming scheme
# would falsify it.


# ---------------------------------------------------------------------------
# ACTIVATION. What we actually call today.
# ---------------------------------------------------------------------------

# sport -> providers, IN RUN ORDER. Order matters: jobs run these sequentially,
# so it is behaviour, not presentation.
MATRIX: dict[str, tuple[str, ...]] = {
    "mlb": ("sharpapi", "sharpapi_lines", "oddsapiio", "propline", "parlayapi"),
    # MLB gained ParlayAPI here. Gate 10 found it missing — ParlayAPI serves MLB
    # and a key was set all along — and it was briefly wired as `parlayapi_mlb`
    # and reverted, because fixing one gate check by adding a FIFTH sport-labelled
    # key made another worse. Pooling closes it properly: one `parlayapi` row,
    # drawing on every key.
    #
    # CFB IS THE ONE SPORT WITHOUT PROPLINE, and it is arithmetic rather than
    # taste: Propline costs 1 + N requests per cycle, so a 178-game CFB slate is
    # ~179 requests. Even pooled at 2,000/day that is eleven cycles, against
    # SharpAPI's one request for the same slate. Its shape suits small slates.
    "soccer_epl": ("sharpapi", "sharpapi_lines", "propline", "parlayapi"),
    "soccer_mls": ("sharpapi", "sharpapi_lines", "propline", "parlayapi", "sportsgameodds"),
    "tennis_atp": ("sharpapi", "sharpapi_lines"),
    "tennis_wta": ("sharpapi", "sharpapi_lines"),
    "nfl": ("sharpapi", "sharpapi_lines", "propline", "parlayapi", "sportsgameodds"),
    "cfb": ("sharpapi", "sharpapi_lines", "parlayapi", "sportsgameodds"),
    "nba": ("sharpapi", "sharpapi_lines", "propline", "parlayapi", "sportsgameodds"),
    "nhl": ("sharpapi", "sharpapi_lines", "propline", "parlayapi", "sportsgameodds"),
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


def _propline(sport: str, yield_fn) -> ProviderSpec:
    """Pooled across both real Propline accounts.

    They were `propline` (MLB) and `propline_2` (soccer) — two vendor accounts
    with separate 1,000/day budgets, each locked to one sport by naming. Pooled,
    a quiet soccer day funds a heavy MLB one.

    Keeps the 25-minute floor from Phase 1a: with the /markets cache Propline
    costs 1 + N requests per cycle, and even two pooled keys do not make a
    2.5-minute cadence affordable.
    """
    return ProviderSpec(
        provider_id="propline",
        enabled=config.PROPLINE_ENABLED or config.PROPLINE_2_ENABLED,
        fetch=None,
        pool=KEY_POOLS["propline"],
        fetch_keyed=lambda client, games, yf, key: fetch_propline(
            client, key, games, sport, provider_id="propline"),
        cap_kind="daily",
        cap_limit=config.PROPLINE_DAILY_LIMIT,
        min_interval_seconds=25 * 60,
    )


def _parlayapi(sport: str, yield_fn) -> ProviderSpec:
    """Pooled across every ParlayAPI key.

    All of them return the identical 405-sport catalogue, so the per-sport names
    were budget buckets wearing sport labels. 1,000/MONTH each; five provisioned
    is 5,000 fungible across eight sports instead of 1,000 stranded per sport.

    45-minute floor. ParlayAPI is ~33 requests/day per key at one request per
    sport per cycle, and MLB's Tier 1 ticks every 2.5 minutes — 576/day ungated,
    17x over. A blown MONTHLY cap costs the rest of the month, so the floor is
    applied everywhere rather than only where a proximity gate is missing.
    """
    return ProviderSpec(
        provider_id="parlayapi",
        enabled=any(k for _, k in KEY_POOLS["parlayapi"]),
        fetch=None,
        pool=KEY_POOLS["parlayapi"],
        fetch_keyed=lambda client, games, yf, key: fetch_parlayapi(client, key, games, sport),
        cap_kind="monthly",
        cap_limit=config.PARLAYAPI_MONTHLY_LIMIT,
        soft_cap=config.PARLAYAPI_SOFT_CAP or None,
        min_interval_seconds=45 * 60,
    )


def _sgo(sport: str, yield_fn) -> ProviderSpec:
    """Pooled across both SportsGameOdds accounts.

    They were split so NFL/CFB's usage could not compete with MLB's — a real
    concern under per-sport keys, and one pooling solves directly: whichever
    account has headroom serves whichever sport needs it.
    """
    return ProviderSpec(
        provider_id="sportsgameodds",
        enabled=any(k for _, k in KEY_POOLS["sportsgameodds"]),
        fetch=None,
        pool=KEY_POOLS["sportsgameodds"],
        fetch_keyed=lambda client, games, yf, key: fetch_sportsgameodds(
            client, key, games, config.SPORTSGAMEODDS_RATE_PER_MIN, yield_fn=yf),
        cap_kind="monthly",
        cap_limit=config.SPORTSGAMEODDS_MONTHLY_SOFT_CAP,
        spend_unit="objects",
    )


_BUILDERS: dict[str, Callable[[str, object], ProviderSpec]] = {
    "sharpapi": lambda sport, yf: _sharpapi(sport, yf, lines=False),
    "sharpapi_lines": lambda sport, yf: _sharpapi(sport, yf, lines=True),
    "oddsapiio": _oddsapiio,
    "propline": _propline,
    "parlayapi": _parlayapi,
    "sportsgameodds": _sgo,
}


def specs_for(sport: str, yield_fn=None, providers: tuple[str, ...] | None = None) -> list[ProviderSpec]:
    """Every ProviderSpec for one sport, in declared run order.

    `providers` overrides the matrix row — used only by MLB's separate
    SportsGameOdds job, which runs on its own cadence.
    """
    names = providers if providers is not None else MATRIX.get(sport, ())
    return [_BUILDERS[n](sport, yield_fn) for n in names]
