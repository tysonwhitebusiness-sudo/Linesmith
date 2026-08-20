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

SHARPAPI_KEY = env("SHARPAPI_KEY")
SHARPAPI_ENABLED = env_bool("SHARPAPI_ENABLED") and bool(SHARPAPI_KEY)

ODDSAPIIO_KEY = env("ODDSAPIIO_KEY")
ODDSAPIIO_BOOKS = env("ODDSAPIIO_BOOKS", "Fanatics,BetMGM")
ODDSAPIIO_ENABLED = env_bool("ODDSAPIIO_ENABLED") and bool(ODDSAPIIO_KEY)

SPORTSGAMEODDS_KEY = env("SPORTSGAMEODDS_KEY")
SPORTSGAMEODDS_ENABLED = env_bool("SPORTSGAMEODDS_ENABLED") and bool(SPORTSGAMEODDS_KEY)
SPORTSGAMEODDS_RATE_PER_MIN = int(env("SPORTSGAMEODDS_RATE_PER_MIN", "10"))

PARLAYAPI_KEY = env("PARLAYAPI_KEY")
PARLAYAPI_ENABLED = env_bool("PARLAYAPI_ENABLED") and bool(PARLAYAPI_KEY)
PARLAYAPI_MLB_KEY = env("PARLAYAPI_MLB_KEY")
PARLAYAPI_MLB_ENABLED = env_bool("PARLAYAPI_MLB_ENABLED") and bool(PARLAYAPI_MLB_KEY)

PROPLINE_KEY = env("PROPLINE_KEY")
PROPLINE_ENABLED = env_bool("PROPLINE_ENABLED") and bool(PROPLINE_KEY)
PROPLINE_2_KEY = env("PROPLINE_2_KEY")
PROPLINE_2_ENABLED = env_bool("PROPLINE_2_ENABLED") and bool(PROPLINE_2_KEY)
