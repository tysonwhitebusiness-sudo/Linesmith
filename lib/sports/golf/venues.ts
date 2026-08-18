/**
 * Course-level coordinates for recurring PGA Tour venues.
 *
 * ESPN's course object gives a city/state, never coordinates (see
 * `EspnCourse.address` in espn.ts), so weather has always resolved to a
 * city-level geocode — honest, but a course is often several miles from its
 * city's center, which matters for wind at a specific 18 holes. This table
 * gives exact coordinates for venues that come back year after year; a
 * course not in it falls back to the existing city-level geocode rather than
 * failing, so coverage only ever improves as entries get added.
 *
 * Keyed by a normalized course name — matched against `EspnCourse.name` with
 * the same loose, punctuation/case-insensitive comparison `venueCoords` does
 * below, since ESPN's own naming is inconsistent between events (e.g. "TPC
 * Southwind" vs "TPC Southwind Golf Course").
 *
 * Not exhaustive. Add entries as new venues come up rather than trying to
 * pre-populate every course the tour could ever visit.
 */

import { geocode, type Coordinates } from '../../weather/openMeteo';

export interface VenueCoords {
  latitude: number;
  longitude: number;
}

const VENUES: Record<string, VenueCoords> = {
  'tpc southwind': { latitude: 35.0656, longitude: -89.7936 },
  'augusta national golf club': { latitude: 33.503, longitude: -82.02 },
  'tpc sawgrass': { latitude: 30.1975, longitude: -81.3959 },
  'pebble beach golf links': { latitude: 36.5681, longitude: -121.9483 },
  'bethpage black': { latitude: 40.7378, longitude: -73.4632 },
  'oakmont country club': { latitude: 40.5223, longitude: -79.8309 },
  'pinehurst no. 2': { latitude: 35.1954, longitude: -79.4695 },
  'muirfield village golf club': { latitude: 40.0784, longitude: -83.1652 },
  'east lake golf club': { latitude: 33.7385, longitude: -84.3097 },
  'quail hollow club': { latitude: 35.1499, longitude: -80.8781 },
  'tpc scottsdale': { latitude: 33.6467, longitude: -111.9192 },
  'torrey pines golf course': { latitude: 32.8944, longitude: -117.2531 },
  'riviera country club': { latitude: 34.0409, longitude: -118.5065 },
  'harbour town golf links': { latitude: 32.1465, longitude: -80.8187 },
  'colonial country club': { latitude: 32.7357, longitude: -97.3719 },
  'the players stadium course': { latitude: 30.1975, longitude: -81.3959 },
  'valhalla golf club': { latitude: 38.2298, longitude: -85.4249 },
  'southern hills country club': { latitude: 36.0736, longitude: -95.9411 },
  'winged foot golf club': { latitude: 40.9557, longitude: -73.7679 },
  'shinnecock hills golf club': { latitude: 40.891, longitude: -72.4501 },
  'the old course at st andrews': { latitude: 56.3433, longitude: -2.8028 },
  'royal liverpool golf club': { latitude: 53.3789, longitude: -3.1858 },
  'tpc river highlands': { latitude: 41.6081, longitude: -72.6262 },
  'detroit golf club': { latitude: 42.4237, longitude: -83.1385 },
  'the concession golf club': { latitude: 27.4467, longitude: -82.4531 },
};

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Exact coordinates for a known venue, or `null` when the course isn't in
 * the table yet — callers fall back to the existing city-level geocode on
 * `null` rather than treating it as an error.
 */
export function venueCoords(courseName: string | undefined): VenueCoords | null {
  if (!courseName) return null;
  const normalized = normalize(courseName);
  if (VENUES[normalized]) return VENUES[normalized];

  // Loose fallback: a known venue name contained in (or containing) the
  // ESPN course name — catches "TPC Southwind" vs "TPC Southwind Golf Course"
  // without needing every naming variant enumerated above.
  for (const [key, coords] of Object.entries(VENUES)) {
    if (normalized.includes(key) || key.includes(normalized)) return coords;
  }
  return null;
}

/**
 * Course coordinates for weather, preferring the exact venue table over
 * ESPN's city-level address. Every caller that needs golf weather (the
 * event-level summary in adapter.ts, a per-golfer tee-time read in Player
 * Detail) goes through this instead of picking a resolution strategy itself.
 */
export async function resolveCourseCoords(
  courseName: string | undefined,
  address: { city?: string; state?: string; country?: string } | undefined,
): Promise<Coordinates | null> {
  const exact = venueCoords(courseName);
  if (exact) {
    return {
      latitude: exact.latitude,
      longitude: exact.longitude,
      resolvedName: courseName ?? 'Course',
      approximate: false,
    };
  }
  if (!address?.city) return null;
  return geocode({ city: address.city, state: address.state, country: address.country });
}
