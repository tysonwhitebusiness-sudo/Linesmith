/**
 * Weather for a tournament's venue — thin wrapper around the same
 * sport-agnostic `lib/weather/openMeteo.ts` MLB and golf already use, fed by
 * `surfaces.ts`'s venue-coordinates table (falls back to a live city-level
 * geocode of ESPN's own `venue.displayName` for anything not in that table).
 * Its own route/cache rather than folded into the draw fetch — weather
 * genuinely refreshes on a different cadence (20min, matching Open-Meteo's
 * own forecast TTL) than a draw's own completed/live-dependent TTL.
 */

import { getWeather } from '../../weather/openMeteo';
import { tournamentVenueCoords } from './surfaces';
import { readSnapshotCache, writeSnapshotCache } from '../../db/client';
import type { WeatherContext } from '../../core/types';

const TTL_MS = 20 * 60 * 1000;

export async function getTournamentWeather(venueCity: string): Promise<{ weather: WeatherContext | null; fetchedAt: string; fromCache: boolean; warnings: string[] }> {
  const cacheKey = `tennis:weather:${venueCity.toLowerCase()}`;
  const cached = await readSnapshotCache(cacheKey);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (cached && ageMs < TTL_MS) {
    return { weather: JSON.parse(cached.payload), fetchedAt: cached.fetchedAt, fromCache: true, warnings: [] };
  }

  const coords = await tournamentVenueCoords(venueCity);
  if (!coords) {
    return { weather: null, fetchedAt: new Date().toISOString(), fromCache: false, warnings: [`Could not resolve coordinates for "${venueCity}".`] };
  }
  const weather = await getWeather(coords);
  if (!weather) {
    if (cached) {
      return { weather: JSON.parse(cached.payload), fetchedAt: cached.fetchedAt, fromCache: true, warnings: ['Weather request failed — showing the last successful fetch.'] };
    }
    return { weather: null, fetchedAt: new Date().toISOString(), fromCache: false, warnings: ['Weather request failed and there is no cached copy yet.'] };
  }

  await writeSnapshotCache(cacheKey, JSON.stringify(weather));
  return { weather, fetchedAt: new Date().toISOString(), fromCache: false, warnings: [] };
}
