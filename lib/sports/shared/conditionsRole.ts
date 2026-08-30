/**
 * `conditions` (role 5) from a weather reading — the pure half of Phase 6.10's
 * weather generalisation.
 *
 * Client-safe: no fetching, no database. `venueWeather.ts` is the server-side
 * half that produces the `WeatherContext` this consumes.
 *
 * ONE BUILDER, NOT ONE PER SPORT. MLB had this inline in its adapter and NFL
 * and CFB were about to grow a copy each. The facts are identical — a
 * temperature is a temperature — and the parts that genuinely differ per sport
 * (a first-pitch time, a kickoff, a surface) arrive as `extraFacts` rather than
 * as a fork in here.
 *
 * `impact` is deliberately never set. `ConditionFact.impact` exists for a real
 * measured multiplier, and MLB's `park_factors` are computed per venue rather
 * than per game, so attaching one to a specific matchup would be exactly the
 * fabrication that field's own doc comment forbids.
 */

import type { WeatherContext } from '@/lib/core/types';
import type { ConditionFact, ConditionsRole } from '@/lib/sports/shared/playerRoles';

export interface ConditionsInput {
  weather?: WeatherContext | null;
  /**
   * Sport-specific facts, rendered BEFORE the weather ones — a first pitch or
   * a kickoff time is what a reader looks for first, and the weather is
   * context around it.
   */
  extraFacts?: ConditionFact[];
  title?: string;
}

export function toConditionsRole(input: ConditionsInput): ConditionsRole | null {
  const { weather, extraFacts = [], title = 'Conditions' } = input;
  const facts: ConditionFact[] = [...extraFacts];

  if (weather?.tempF != null) {
    facts.push({ key: 'temp', label: 'Temperature', value: `${weather.tempF}°F` });
  }
  if (weather?.windMph != null) {
    facts.push({
      key: 'wind',
      label: 'Wind',
      value: `${weather.windMph} mph${weather.windDir ? ` ${weather.windDir}` : ''}`,
    });
  }
  // Only when there is a real chance. "Rain 0%" is noise on a clear day, and a
  // row that is almost always the same trains a reader to stop looking at it.
  if (weather?.rainPct != null && weather.rainPct >= 10) {
    facts.push({ key: 'rain', label: 'Rain', value: `${weather.rainPct}%` });
  }
  // The caveat travels WITH the reading, not in a legend somewhere else: every
  // one of these sports is geocoded from a city because ESPN publishes no
  // venue coordinates, so the number is an area forecast and says so.
  if (weather?.approximateLocation) {
    facts.push({ key: 'precision', label: 'Forecast', value: 'Area, not on-site' });
  }

  if (facts.length === 0) return null;
  return { title, facts, emptyMessage: 'No venue conditions available.' };
}
