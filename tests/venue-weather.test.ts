import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toConditionsRole } from '../lib/sports/shared/conditionsRole';
import type { WeatherContext } from '../lib/core/types';

/**
 * Phase 6.10 — weather generalised past MLB, and the rule that keeps it honest.
 *
 * THE RULE: weather is reported only when `venue.indoor === false`. Never
 * `!venue.indoor`. Measured across live ESPN scoreboards rather than assumed:
 *
 *   NFL  16 events | 16 carry `indoor` | 5 true (Ford Field, Lucas Oil,
 *                                        Reliant, Allegiant, U.S. Bank)
 *   CFB  25 events | 25 carry `indoor` | 0 true
 *   NBA   1 event  |  1 carries it     | 1 true
 *   MLS  13 events |  0 carry it       | —
 *   EPL   4 events |  0 carry it       | —
 *
 * Soccer omits the field entirely and MLS genuinely has enclosed venues, so
 * `!indoor` would print wind and rain for a game played under a roof. That is
 * why soccer gets no weather here, and why the absence is a recorded gap rather
 * than an inference.
 *
 * `resolveVenueWeather` itself geocodes and calls open-meteo, so it is not
 * exercised here — the reachable half is the pure role builder, plus a source
 * check on the comparison that carries the whole rule.
 */

import { readFileSync } from 'node:fs';
const CODE = readFileSync('lib/sports/shared/venueWeather.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

function weather(over: Partial<WeatherContext> = {}): WeatherContext {
  return { windMph: 12, windDir: 'NW', rainPct: 5, tempF: 68, source: 'open-meteo', ...over };
}

test('an unknown roof is treated exactly like an indoor one', () => {
  // The comparison IS the rule. `!venue.indoor` passes `undefined`, which is
  // every soccer venue, including MLS venues that really are enclosed.
  assert.match(CODE, /venue\.indoor !== false/, 'the indoor gate must require an explicit false');
  assert.ok(
    !/!venue\.indoor/.test(CODE),
    'a truthiness check here reports weather for every venue whose roof was never stated',
  );
});

test('conditions renders the real facts, and says the reading is an area forecast', () => {
  const role = toConditionsRole({ weather: weather({ approximateLocation: true, rainPct: 40 }) });
  assert.ok(role);
  const byKey = Object.fromEntries(role.facts.map((f) => [f.key, f.value]));
  assert.equal(byKey.temp, '68°F');
  assert.equal(byKey.wind, '12 mph NW');
  assert.equal(byKey.rain, '40%');
  // ESPN publishes no venue coordinates for these sports, so every reading is
  // geocoded from a city. The caveat travels with the number, not in a legend.
  assert.equal(byKey.precision, 'Area, not on-site');
});

test('a dry day shows no rain row at all', () => {
  const role = toConditionsRole({ weather: weather({ rainPct: 5 }) })!;
  assert.ok(!role.facts.some((f) => f.key === 'rain'), '"Rain 5%" is noise, and a row that never changes stops being read');
});

test('sport-specific facts lead, weather follows', () => {
  const role = toConditionsRole({
    weather: weather(),
    extraFacts: [{ key: 'firstPitch', label: 'First pitch', value: '7:05 PM' }],
  })!;
  assert.equal(role.facts[0].key, 'firstPitch', 'the time is what a reader looks for first');
  assert.equal(role.facts[1].key, 'temp');
});

test('no weather and no extra facts renders no card', () => {
  assert.equal(toConditionsRole({ weather: null }), null);
  assert.equal(toConditionsRole({}), null);
  // ...but a sport with a real fact and no weather still gets its card. This is
  // the indoor NFL case: kickoff is known, conditions are not.
  const indoor = toConditionsRole({
    weather: null,
    extraFacts: [{ key: 'kickoff', label: 'Kickoff', value: '1:00 PM' }],
  });
  assert.ok(indoor, 'an indoor game still has a kickoff time worth showing');
  assert.equal(indoor.facts.length, 1);
});

test('impact is never fabricated', () => {
  // `ConditionFact.impact` is for a real measured multiplier. MLB's park
  // factors are per venue, not per game, so attaching one to a matchup would be
  // the fabrication that field's own doc comment forbids.
  const role = toConditionsRole({ weather: weather() })!;
  for (const f of role.facts) {
    assert.equal(f.impact, undefined, `"${f.key}" invented an impact multiplier`);
  }
});
