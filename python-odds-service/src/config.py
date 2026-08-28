"""Reads DATABASE_URL and provider keys.

Real OS environment variables (`os.environ`) always win — this is how Render
(and any other real host) supplies secrets, set via its dashboard, never
committed anywhere. `.env.local` is read only as a LOCAL DEV fallback for
whatever isn't already in the environment, same file the Next.js app uses —
convenient for running this on a laptop, irrelevant in production since that
file is gitignored and never deployed. Same manual-regex-parse convention
scripts/migrate-to-postgres.js already established, no new dependency.
"""
import os
import re
from pathlib import Path

_ENV_PATH = Path(__file__).resolve().parent.parent.parent / ".env.local"


def _load_dotenv_fallback() -> dict[str, str]:
    if not _ENV_PATH.exists():
        return {}  # expected in production — this file is never deployed
    text = _ENV_PATH.read_text(encoding="utf-8")
    env: dict[str, str] = {}
    for match in re.finditer(r"^([A-Z0-9_]+)=(.*)$", text, re.MULTILINE):
        key, value = match.group(1), match.group(2).strip()
        if value and value[0] == value[-1] == '"':
            value = value[1:-1]
        env[key] = value
    return env


_DOTENV_FALLBACK = _load_dotenv_fallback()


def env(key: str, default: str | None = None) -> str | None:
    return os.environ.get(key) or _DOTENV_FALLBACK.get(key, default)


def env_bool(key: str, default: bool = True) -> bool:
    val = os.environ.get(key) or _DOTENV_FALLBACK.get(key)
    if val is None:
        return default
    return val.strip().lower() != "false"


DATABASE_URL = env("DATABASE_URL")

# "session" (default, used by the worker) or "transaction" (health_check.py
# only, see render.yaml's cron job env var) — see db.py's get_pool() for why
# this exists: Supavisor's session-mode pooler (port 5432) holds a dedicated
# physical backend connection per client for the client's whole lifetime,
# and its 15-connection cap is shared across every consumer (this worker,
# the TS app, any local script) plus Supabase's own permanent platform
# overhead. The transaction-mode pooler (same host, port 6543) multiplexes
# many logical clients over far fewer physical backends, releasing the
# backend back to the pool between transactions — much more headroom for a
# process like health_check.py that only ever runs a handful of short,
# independent reads and doesn't need session-level state to persist across
# them. Not used for the worker itself: write_prop_odds/write_game_odds_book_lines
# etc. run multi-statement transactions and rely on session-level
# server_settings sticking for the connection's lifetime, which transaction
# mode doesn't guarantee.
DB_POOLER_MODE = (env("DB_POOLER_MODE", "session") or "session").strip().lower()

SHARPAPI_KEY = env("SHARPAPI_KEY")
SHARPAPI_ENABLED = env_bool("SHARPAPI_ENABLED") and bool(SHARPAPI_KEY)

# CFB's X-signal (Phase 3 of docs/daily-picks-full-model-build-2026-08-27.
# md) — the same account/key lib/sports/cfb/cfbd.ts already uses on the TS
# side (user-confirmed 2026-08-27: reuse, not a separate key), already
# present in .env.local for local dev via the fallback above.
CFBD_API_KEY = env("CFBD_API_KEY")

ODDSAPIIO_KEY = env("ODDSAPIIO_KEY")
ODDSAPIIO_BOOKS = env("ODDSAPIIO_BOOKS", "Fanatics,BetMGM")
ODDSAPIIO_ENABLED = env_bool("ODDSAPIIO_ENABLED") and bool(ODDSAPIIO_KEY)
# Vendor-confirmed live (2026-08-19): a 429 response's own x-ratelimit-limit
# header reads exactly 100, matching this configured default — the config
# value was never wrong, it just was never read anywhere in this harness.
ODDSAPIIO_RATE_PER_HOUR = int(env("ODDSAPIIO_RATE_PER_HOUR", "100"))
# Separate from ODDSAPIIO_RATE_PER_HOUR — that's vendor rate-limit compliance
# (rolling window, enforced inside fetch_oddsapiio itself via rate_limit.py).
# This is a persisted, calendar-day BUDGET cap, same env var TS's
# oddsApiIoConfig().dailyLimit already reads (config.ts:44) — ported here
# because tier1Refresh.ts pre-checks it before every fetch and the Python
# port never did, a real gap closed by job_runner.py's ProviderSpec model.
ODDSAPIIO_DAILY_LIMIT = int(env("ODDSAPIIO_DAILY_LIMIT", "500"))

SPORTSGAMEODDS_KEY = env("SPORTSGAMEODDS_KEY")
SPORTSGAMEODDS_ENABLED = env_bool("SPORTSGAMEODDS_ENABLED") and bool(SPORTSGAMEODDS_KEY)
SPORTSGAMEODDS_RATE_PER_MIN = int(env("SPORTSGAMEODDS_RATE_PER_MIN", "10"))
# TS's sportsGameOddsRefresh.ts/multiSportRefresh.ts both gate on the SOFT
# cap (not the informational hard monthlyLimit) before every fetch — same
# env var as config.ts:55 (SPORTSGAMEODDS_SOFT_CAP). Never pre-checked in
# the Python port before job_runner.py.
SPORTSGAMEODDS_MONTHLY_SOFT_CAP = int(env("SPORTSGAMEODDS_SOFT_CAP", "2000"))
# Second account (2026-08-20, see docs/api-capability-audit-2026-08-20.md) —
# dedicated to the NFL/CFB job so it draws a real, separate object budget
# instead of competing with MLB's job on the same shared account. Rate limit
# and soft cap default to the same real numbers as the primary account
# (same vendor plan tier), tracked under its own provider_id
# ("sportsgameodds_multisport") so its spend is never conflated with MLB's.
SPORTSGAMEODDS_MULTISPORT_KEY = env("SPORTSGAMEODDS_MULTISPORT_KEY")
SPORTSGAMEODDS_MULTISPORT_ENABLED = env_bool("SPORTSGAMEODDS_MULTISPORT_ENABLED") and bool(SPORTSGAMEODDS_MULTISPORT_KEY)

PARLAYAPI_KEY = env("PARLAYAPI_KEY")
PARLAYAPI_ENABLED = env_bool("PARLAYAPI_ENABLED") and bool(PARLAYAPI_KEY)
# ParlayAPI (NFL/CFB) gates on its HARD monthly limit (multiSportRefresh.ts's
# `budget.exhausted`), unlike SportsGameOdds's soft-cap gate — a real,
# deliberate difference between the two, preserved here rather than
# collapsed into one shared constant.
PARLAYAPI_MONTHLY_LIMIT = int(env("PARLAYAPI_MONTHLY_LIMIT", "1000"))
PARLAYAPI_MLB_KEY = env("PARLAYAPI_MLB_KEY")
PARLAYAPI_MLB_ENABLED = env_bool("PARLAYAPI_MLB_ENABLED") and bool(PARLAYAPI_MLB_KEY)

# Per-sport keys (2026-08-20, see docs/api-capability-audit-2026-08-20.md) —
# real, separate free accounts replacing the shared PARLAYAPI_KEY's role for
# these 3 sports (that key stays defined above only as a fallback/legacy
# path, no longer the live source once these are wired into jobs.py).
PARLAYAPI_NFL_KEY = env("PARLAYAPI_NFL_KEY")
PARLAYAPI_NFL_ENABLED = env_bool("PARLAYAPI_NFL_ENABLED") and bool(PARLAYAPI_NFL_KEY)
PARLAYAPI_NFL_MONTHLY_LIMIT = int(env("PARLAYAPI_NFL_MONTHLY_LIMIT", "1000"))

PARLAYAPI_CFB_KEY = env("PARLAYAPI_CFB_KEY")
PARLAYAPI_CFB_ENABLED = env_bool("PARLAYAPI_CFB_ENABLED") and bool(PARLAYAPI_CFB_KEY)
PARLAYAPI_CFB_MONTHLY_LIMIT = int(env("PARLAYAPI_CFB_MONTHLY_LIMIT", "1000"))

PARLAYAPI_SOCCER_KEY = env("PARLAYAPI_SOCCER_KEY")
PARLAYAPI_SOCCER_ENABLED = env_bool("PARLAYAPI_SOCCER_ENABLED") and bool(PARLAYAPI_SOCCER_KEY)
PARLAYAPI_SOCCER_MONTHLY_LIMIT = int(env("PARLAYAPI_SOCCER_MONTHLY_LIMIT", "1000"))

# NBA (2026-08-22) — no real ParlayAPI NBA account exists yet (ParlayAPI's
# real per-sport-key pattern above means NBA needs its own dedicated key,
# same as NFL/CFB/soccer did — not something this session can create
# itself; account creation is out of scope for an agent). Declared the same
# way every other sport's key is, so it activates with zero code changes
# the moment a real PARLAYAPI_NBA_KEY is set on Render — until then this
# naturally stays disabled (env() returns None, so ENABLED evaluates
# False), and NBA's real backend coverage is SportsGameOdds-only (see
# job_nba in jobs.py).
PARLAYAPI_NBA_KEY = env("PARLAYAPI_NBA_KEY")
PARLAYAPI_NBA_ENABLED = env_bool("PARLAYAPI_NBA_ENABLED") and bool(PARLAYAPI_NBA_KEY)
PARLAYAPI_NBA_MONTHLY_LIMIT = int(env("PARLAYAPI_NBA_MONTHLY_LIMIT", "1000"))

# The-odds-api.com — MLB whole-slate game lines (moneyline/spread/total),
# the one real, live market-blend input the pick-lock cycle uses for MLB
# (OddsHarvester, the other source lib/odds/merge.ts blends in, is confirmed
# dead — see docs/mlb-prediction-engine-python-port-gameplan-2026-08-21.md's
# Phase F audit). Same env var names lib/odds/oddsApi.ts already reads —
# shared credit budget, one real vendor account regardless of which app calls it.
ODDS_API_KEY = env("ODDS_API_KEY")
ODDS_API_ENABLED = bool(ODDS_API_KEY)
ODDS_API_TTL_MINUTES = int(env("ODDS_API_TTL_MINUTES", "360"))
ODDS_API_MARKETS = env("ODDS_API_MARKETS", "h2h,spreads,totals")
# Stop auto-refreshing when this few credits remain, so the month can't run
# dry — matches oddsApi.ts's DEFAULT_RESERVE exactly.
ODDS_API_RESERVE = int(env("ODDS_API_RESERVE", "25"))

PROPLINE_KEY = env("PROPLINE_KEY")
PROPLINE_ENABLED = env_bool("PROPLINE_ENABLED") and bool(PROPLINE_KEY)
PROPLINE_DAILY_LIMIT = int(env("PROPLINE_DAILY_LIMIT", "1000"))
PROPLINE_2_KEY = env("PROPLINE_2_KEY")
PROPLINE_2_ENABLED = env_bool("PROPLINE_2_ENABLED") and bool(PROPLINE_2_KEY)

# Which book's own price live_edge.py's resolve_candidate_edge prefers
# before falling back to the best available price across books — same
# default as lib/odds/props/config.ts's userSportsbook().
USER_SPORTSBOOK = env("USER_SPORTSBOOK", "Fanatics")
