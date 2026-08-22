"""Direct port of lib/weather/openMeteo.ts — not a reimplementation.
Open-Meteo integration (no API key, free for non-commercial use).

Scoped to what MLB's gameModel pipeline needs: get_weather (temperature —
and wind/rain, carried along for free — at a venue at game time) and
weather_runs_factor, the pure function from adapter.ts:244-247 that
converts a temperature reading into a park-neutral run-environment
multiplier. geocode() is deliberately NOT ported: MLB venue coordinates
come directly from the schedule feed's own venue.location.defaultCoordinates
(see statsapi.py's MlbGame.venue passthrough), so nothing in this pipeline
ever needs to resolve a place name to coordinates the way golf's course
lookup does.
"""
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_FORECAST_TTL_S = 20 * 60

# key ("lat,lon" to 2 decimals) -> (value, expires_at monotonic). time.monotonic()
# instead of wall-clock Date.now() — same disclosed adaptation as statsapi.py.
_forecast_cache: dict[str, tuple["HourlyForecast | None", float]] = {}


async def _get_json(client: httpx.AsyncClient, url: str, params: dict, timeout_s: float = 8.0):
    try:
        res = await client.get(url, params=params, timeout=httpx.Timeout(timeout_s))
    except httpx.HTTPError:
        return None
    if res.status_code != 200:
        return None
    try:
        return res.json()
    except ValueError:
        return None


@dataclass
class HourlyForecast:
    time: list[float]
    wind_mph: list[float]
    wind_dir: list[float]
    rain_pct: list[float]
    temp_f: list[float]


async def _fetch_hourly(client: httpx.AsyncClient, latitude: float, longitude: float) -> HourlyForecast | None:
    key = f"{latitude:.2f},{longitude:.2f}"
    hit = _forecast_cache.get(key)
    if hit is not None:
        value, expires_at = hit
        if expires_at >= time.monotonic():
            return value
        del _forecast_cache[key]

    params = {
        "latitude": str(latitude),
        "longitude": str(longitude),
        "hourly": "wind_speed_10m,wind_direction_10m,precipitation_probability,temperature_2m",
        "wind_speed_unit": "mph",
        "temperature_unit": "fahrenheit",
        "timeformat": "unixtime",
        "forecast_days": "2",
    }
    json_data = await _get_json(client, _FORECAST_URL, params)
    hourly = (json_data or {}).get("hourly")

    value = None
    if hourly and hourly.get("time"):
        value = HourlyForecast(
            time=hourly.get("time") or [],
            wind_mph=hourly.get("wind_speed_10m") or [],
            wind_dir=hourly.get("wind_direction_10m") or [],
            rain_pct=hourly.get("precipitation_probability") or [],
            temp_f=hourly.get("temperature_2m") or [],
        )
    _forecast_cache[key] = (value, time.monotonic() + _FORECAST_TTL_S)
    return value


_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def degrees_to_compass(deg: float) -> str:
    if not math.isfinite(deg):
        return "—"
    # TS double-wraps `((deg % 360) + 360) % 360` because JS's `%` can return
    # negative for a negative dividend; Python's `%` already returns a
    # non-negative result for a positive divisor, so the single `%360` here
    # is the same value, not a simplification that changes behavior.
    return _COMPASS[round((deg % 360) / 22.5) % 16]


@dataclass
class ForecastHour:
    time: str
    wind_mph: int
    wind_dir: str
    rain_pct: int
    temp_f: int | None


@dataclass
class WeatherContext:
    wind_mph: int
    wind_dir: str
    rain_pct: int
    temp_f: int | None
    source: str
    approximate_location: bool
    forecast: list[ForecastHour] = field(default_factory=list)


async def get_weather(client: httpx.AsyncClient, latitude: float, longitude: float, approximate: bool, at: datetime | None = None) -> WeatherContext | None:
    """Weather for a coordinate at a moment in time (defaults to now).
    Returns None rather than a fabricated reading when the service is
    unavailable."""
    at = at if at is not None else datetime.now(timezone.utc)
    hourly = await _fetch_hourly(client, latitude, longitude)
    if not hourly or len(hourly.time) == 0:
        return None

    # timeformat=unixtime gives seconds; find the closest hour to `at`.
    target = at.timestamp()
    best_index = 0
    best_gap = float("inf")
    for i in range(len(hourly.time)):
        gap = abs(float(hourly.time[i]) - target)
        if gap < best_gap:
            best_gap = gap
            best_index = i

    wind_mph = hourly.wind_mph[best_index] if best_index < len(hourly.wind_mph) else None
    if wind_mph is None or not math.isfinite(wind_mph):
        return None

    # The next 5 hours (current reading included) — already fetched for the
    # single wind_mph/etc. reading above, this just keeps the rest of it
    # instead of throwing it away. Capped to what's actually in the
    # response rather than assuming 5 hours remain.
    forecast: list[ForecastHour] = []
    for i in range(best_index, min(best_index + 5, len(hourly.time))):
        w = hourly.wind_mph[i] if i < len(hourly.wind_mph) else None
        if w is None or not math.isfinite(w):
            continue
        temp = hourly.temp_f[i] if i < len(hourly.temp_f) else None
        rain = hourly.rain_pct[i] if i < len(hourly.rain_pct) else None
        forecast.append(
            ForecastHour(
                time=datetime.fromtimestamp(float(hourly.time[i]), tz=timezone.utc).isoformat(),
                wind_mph=round(w),
                wind_dir=degrees_to_compass(hourly.wind_dir[i] if i < len(hourly.wind_dir) else float("nan")),
                rain_pct=round(rain if rain is not None else 0),
                temp_f=round(temp) if temp is not None and math.isfinite(temp) else None,
            )
        )

    rain_best = hourly.rain_pct[best_index] if best_index < len(hourly.rain_pct) else None
    temp_best = hourly.temp_f[best_index] if best_index < len(hourly.temp_f) else None
    return WeatherContext(
        wind_mph=round(wind_mph),
        wind_dir=degrees_to_compass(hourly.wind_dir[best_index] if best_index < len(hourly.wind_dir) else float("nan")),
        rain_pct=round(rain_best if rain_best is not None else 0),
        temp_f=round(temp_best) if temp_best is not None and math.isfinite(temp_best) else None,
        source="Open-Meteo",
        approximate_location=approximate,
        forecast=forecast,
    )


# ---------------------------------------------------------------------------
# weatherRunsFactor (adapter.ts:209-247)
# ---------------------------------------------------------------------------

# MLB venues with a fixed or retractable roof — weather shouldn't move the
# model for these, since conditions are climate controlled rather than the
# day's actual outdoor forecast. A retractable roof's open/closed state
# isn't available from the feed this app already uses, so these are
# excluded unconditionally rather than guessed. Names match exactly what
# the schedule feed reports.
DOME_VENUE_NAMES = {
    "Tropicana Field",
    "Rogers Centre",
    "Daikin Park",
    "Chase Field",
    "American Family Field",
    "T-Mobile Park",
    "Globe Life Field",
    "loanDepot park",
}

NEUTRAL_TEMP_F = 70
# Runs multiplier per degree away from a neutral 70°F — small, well-
# established, direction-independent (warmer air carries fly balls further
# either way).
TEMP_FACTOR_PER_DEGREE = 0.005
MAX_WEATHER_FACTOR_DEVIATION = 0.08


def weather_runs_factor(venue_name: str | None, temp_f: float | None) -> float:
    """Deliberately temperature-only, not wind direction: a wind effect
    needs each park's own orientation to know whether a given wind
    direction helps or hurts, and getting even one of 30 parks' orientations
    wrong would silently corrupt that game's prediction. Temperature's
    effect doesn't depend on orientation at all, so it's the one piece of
    weather physics safe to ship without that reference data."""
    if not venue_name or venue_name in DOME_VENUE_NAMES or temp_f is None or not math.isfinite(temp_f):
        return 1.0
    delta = (temp_f - NEUTRAL_TEMP_F) * TEMP_FACTOR_PER_DEGREE
    return 1 + min(MAX_WEATHER_FACTOR_DEVIATION, max(-MAX_WEATHER_FACTOR_DEVIATION, delta))
