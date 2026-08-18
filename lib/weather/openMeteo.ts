/**
 * Open-Meteo integration (no API key, free for non-commercial use).
 *
 * Two entry points: geocode a place name, and read the hourly forecast for a
 * coordinate. Both are cached in-process because a slate re-fetches every few
 * minutes and the weather does not move that fast.
 */

import type { WeatherContext } from '../core/types';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;
const FORECAST_TTL_MS = 20 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const geocodeCache = new Map<string, CacheEntry<Coordinates | null>>();
const forecastCache = new Map<string, CacheEntry<HourlyForecast | null>>();

export interface Coordinates {
  latitude: number;
  longitude: number;
  resolvedName: string;
  /** True when we matched a city/region rather than an exact address. */
  approximate: boolean;
}

interface HourlyForecast {
  time: string[];
  windMph: number[];
  windDir: number[];
  rainPct: number[];
  tempF: number[];
}

function cached<T>(store: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

async function getJson(url: string, timeoutMs = 8000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a place to coordinates. ESPN gives golf courses a city/state but no
 * lat/long, so the best we can honestly do is a city-level match — the result
 * is flagged `approximate` and the UI says so.
 */
export async function geocode(params: {
  city?: string;
  state?: string;
  country?: string;
}): Promise<Coordinates | null> {
  const city = params.city?.trim();
  if (!city) return null;

  const key = `${city}|${params.state ?? ''}|${params.country ?? ''}`.toLowerCase();
  const hit = cached(geocodeCache, key);
  if (hit !== undefined) return hit;

  const url = new URL(GEOCODE_URL);
  url.searchParams.set('name', city);
  url.searchParams.set('count', '10');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const json = await getJson(url.toString());
  const results: any[] = json?.results ?? [];

  let best = results[0] ?? null;
  if (params.state && results.length > 1) {
    const stateMatch = results.find(
      (r) =>
        typeof r.admin1 === 'string' &&
        r.admin1.toLowerCase().includes(params.state!.toLowerCase()),
    );
    if (stateMatch) best = stateMatch;
  }

  const value: Coordinates | null = best
    ? {
        latitude: best.latitude,
        longitude: best.longitude,
        resolvedName: [best.name, best.admin1, best.country_code].filter(Boolean).join(', '),
        approximate: true,
      }
    : null;

  geocodeCache.set(key, { value, expiresAt: Date.now() + GEOCODE_TTL_MS });
  return value;
}

async function fetchHourly(latitude: number, longitude: number): Promise<HourlyForecast | null> {
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
  const hit = cached(forecastCache, key);
  if (hit !== undefined) return hit;

  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set(
    'hourly',
    'wind_speed_10m,wind_direction_10m,precipitation_probability,temperature_2m',
  );
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('timeformat', 'unixtime');
  url.searchParams.set('forecast_days', '2');

  const json = await getJson(url.toString());
  const hourly = json?.hourly;

  const value: HourlyForecast | null = hourly?.time
    ? {
        time: hourly.time,
        windMph: hourly.wind_speed_10m ?? [],
        windDir: hourly.wind_direction_10m ?? [],
        rainPct: hourly.precipitation_probability ?? [],
        tempF: hourly.temperature_2m ?? [],
      }
    : null;

  forecastCache.set(key, { value, expiresAt: Date.now() + FORECAST_TTL_MS });
  return value;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function degreesToCompass(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

/**
 * Weather for a coordinate at a moment in time (defaults to now). Returns
 * `null` rather than a fabricated reading when the service is unavailable.
 */
export async function getWeather(
  coords: Coordinates,
  at: Date = new Date(),
): Promise<WeatherContext | null> {
  const hourly = await fetchHourly(coords.latitude, coords.longitude);
  if (!hourly || hourly.time.length === 0) return null;

  // `timeformat=unixtime` gives seconds; find the closest hour to `at`.
  const target = Math.floor(at.getTime() / 1000);
  let bestIndex = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hourly.time.length; i += 1) {
    const gap = Math.abs(Number(hourly.time[i]) - target);
    if (gap < bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }

  const windMph = hourly.windMph[bestIndex];
  if (!Number.isFinite(windMph)) return null;

  // The next 5 hours (current reading included) — already fetched for the
  // single `windMph`/etc. reading above, this just keeps the rest of it
  // instead of throwing it away. Capped to what's actually in the response
  // rather than assuming 5 hours remain (e.g. near the end of the 2-day window).
  const forecast: WeatherContext['forecast'] = [];
  for (let i = bestIndex; i < Math.min(bestIndex + 5, hourly.time.length); i += 1) {
    const w = hourly.windMph[i];
    if (!Number.isFinite(w)) continue;
    forecast.push({
      time: new Date(Number(hourly.time[i]) * 1000).toISOString(),
      windMph: Math.round(w),
      windDir: degreesToCompass(hourly.windDir[i]),
      rainPct: Math.round(hourly.rainPct[i] ?? 0),
      tempF: Number.isFinite(hourly.tempF[i]) ? Math.round(hourly.tempF[i]) : undefined,
    });
  }

  return {
    windMph: Math.round(windMph),
    windDir: degreesToCompass(hourly.windDir[bestIndex]),
    rainPct: Math.round(hourly.rainPct[bestIndex] ?? 0),
    tempF: Number.isFinite(hourly.tempF[bestIndex]) ? Math.round(hourly.tempF[bestIndex]) : undefined,
    source: 'Open-Meteo',
    approximateLocation: coords.approximate,
    forecast,
  };
}
