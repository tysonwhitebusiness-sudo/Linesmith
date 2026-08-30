/**
 * Weather for an ESPN-sourced venue — Phase 6.10's first third, generalising
 * what was MLB-only.
 *
 * SERVER-SIDE ONLY. It performs network calls; a snapshot builder calls it, an
 * adapter never does. The pure "turn a reading into a card" half lives in
 * `conditionsRole.ts`, which is what the client-reachable adapters import.
 *
 * ================= THE RULE THAT KEEPS THIS HONEST =========================
 *
 * **Weather is reported only when `venue.indoor === false`.** Not `!indoor`.
 *
 * Measured across live ESPN scoreboards rather than assumed:
 *
 * | league | events | carries `indoor` | `indoor: true` |
 * |--------|--------|------------------|----------------|
 * | NFL    | 16     | 16               | 5 (Ford Field, Lucas Oil, Reliant, Allegiant, U.S. Bank) |
 * | CFB    | 25     | 25               | 0              |
 * | NBA    | 1      | 1                | 1              |
 * | MLS    | 13     | **0**            | —              |
 * | EPL    | 4      | **0**            | —              |
 *
 * Soccer omits the field entirely, and **MLS genuinely has enclosed venues**,
 * so `!indoor` would report wind and rain for a game played under a roof. An
 * unknown roof yields no weather at all. That is the same call MLB made from
 * the other direction: its feed gives no roof state either, so it keeps an
 * explicit `DOME_VENUE_NAMES` set and excludes those venues unconditionally
 * rather than guessing.
 *
 * Soccer therefore gets nothing here yet. Giving it weather needs a checked
 * per-venue roof list, not an inference — see the handoff.
 * ===========================================================================
 *
 * ESPN reports no coordinates for any of these sports, only a city, so every
 * reading is geocoded and comes back with `approximateLocation: true`. The UI
 * already says so ("Reading is an area forecast, not an on-site one").
 */

import type { WeatherContext } from '@/lib/core/types';
import type { EspnVenue } from '@/lib/sports/multiSport/teamSportEspn';
import { geocode, getWeather } from '@/lib/weather/openMeteo';

/**
 * `null` for an indoor venue, an unknown roof, a venue with no city, or a
 * weather service that did not answer — the four cases are deliberately
 * indistinguishable to the caller, because the honest render for all of them is
 * the same: no conditions card.
 */
export async function resolveVenueWeather(venue: EspnVenue | undefined, whenISO: string): Promise<WeatherContext | null> {
  // `=== false`, never `!venue.indoor`. See this file's header.
  if (!venue || venue.indoor !== false) return null;
  if (!venue.city) return null;

  const coords = await geocode({ city: venue.city, state: venue.state, country: venue.country });
  if (!coords) return null;

  const at = Number.isFinite(Date.parse(whenISO)) ? new Date(whenISO) : new Date();
  return getWeather({ ...coords, resolvedName: venue.fullName ?? coords.resolvedName }, at);
}
