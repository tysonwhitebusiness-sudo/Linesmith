import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYER_ROLE_KEYS, toRoleStat } from '../lib/sports/shared/playerRoles';

/**
 * Phase 6.3 — the six universal roles.
 *
 * The plan called this a rename of four `PlayerDetailData` fields. **None of
 * those four fields existed** — `pitchMix`, `zoneProfile`, `platoon` and
 * `opposingStarter` are names from the design mockups, not the codebase. So
 * this is six new fields, and these tests guard the two things that would
 * silently undo the point of them:
 *
 * 1. **A role acquiring a sport-specific name or a sport check.** The entire
 *    argument is that a strike zone is MLB's instance of `spatialGrid`, not a
 *    concept the shared component should know. A `sport === 'mlb'` in the
 *    render path collapses that back into the state Phase 6 exists to fix, and
 *    the Phase 6 gate greps for exactly this.
 * 2. **A role being filled with a placeholder to look complete.** ONE of
 *    MLB's six is `null` today: `binarySplit`, which for MLB means vs LHP/RHP,
 *    and this app stores no platoon split. That is correct. A fabricated mix or
 *    an invented park multiplier would render as real numbers and nothing
 *    downstream could tell.
 */

const ROLES_SRC = readFileSync('lib/sports/shared/playerRoles.ts', 'utf8');
const MLB_ADAPTER = readFileSync('lib/sports/mlb/adapters/playerDetailAdapter.ts', 'utf8');

test('the six roles are exactly the six agreed with the operator', () => {
  assert.deepEqual([...PLAYER_ROLE_KEYS], [
    'opponentUnit',
    'usageMix',
    'spatialGrid',
    'binarySplit',
    'conditions',
    'careerH2H',
  ]);
});

test('PlayerDetailData declares all six, each independently nullable', () => {
  for (const key of PLAYER_ROLE_KEYS) {
    assert.match(
      MLB_ADAPTER,
      new RegExp(`\\n\\s+${key}\\?:[^;]*\\| null;`),
      `PlayerDetailData does not declare \`${key}\` as an optional nullable role. ` +
        `A sport that cannot fill a role must be able to omit it.`,
    );
  }
});

test('MLB returns every role key, filling only the ones it has data for', () => {
  // Returning the key explicitly — even as null — is the difference between
  // "this sport has no strike zone data" and "someone forgot the field".
  for (const key of PLAYER_ROLE_KEYS) {
    assert.match(
      MLB_ADAPTER,
      new RegExp(`\\n\\s+${key}[,:]`),
      `MLB's adapter never returns \`${key}\`.`,
    );
  }
  // The four it genuinely has today. `usageMix` and `spatialGrid` joined them
  // when 6.6's `mlb_pitch_events` landed a real source; they are built by the
  // pure functions in `adapters/pitchRoles.ts` and tested for real behaviour in
  // `tests/pitch-roles.test.ts`, not asserted by shape here.
  assert.match(MLB_ADAPTER, /const opponentUnit: OpponentUnitRole \| null =/, 'MLB stopped building opponentUnit');
  assert.match(MLB_ADAPTER, /const conditions: ConditionsRole \| null =/, 'MLB stopped building conditions');
  assert.match(MLB_ADAPTER, /const usageMix = toUsageMixRole\(/, 'MLB stopped building usageMix');
  assert.match(MLB_ADAPTER, /const spatialGrid = toSpatialGridRole\(/, 'MLB stopped building spatialGrid');
  // `careerH2H` joined them in 6.13 — built from the SAME opponent predicate
  // `windows.h2h` already uses, and earning its place by adding the
  // per-meeting history a single rate cannot express. Behaviour is tested in
  // `tests/career-h2h.test.ts`, not asserted by shape here.
  assert.match(MLB_ADAPTER, /toCareerH2H\(\{/, 'MLB stopped building careerH2H');
  // The one that still has no source must stay null rather than gain a
  // placeholder: `binarySplit` for MLB is vs LHP/RHP, and this app stores no
  // platoon split. (Home/away, which four other sports use for that role,
  // MLB already exposes as a venue filter chip.)
  for (const key of ['binarySplit']) {
    assert.match(
      MLB_ADAPTER,
      new RegExp(`${key}: null`),
      `MLB's \`${key}\` is no longer null. If 6.6-6.9 landed, good — update this test. ` +
        `If it was filled with a placeholder, that renders as real numbers and nothing downstream can tell.`,
    );
  }
});

test('no role type names a sport', () => {
  // A role called `pitchMix` is a role only MLB can fill. The whole point is
  // that the type is named after the JOB, not after one sport's instance of it.
  const declarations = ROLES_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const word of ['pitch', 'zone', 'platoon', 'park', 'serve', 'route']) {
    assert.doesNotMatch(
      declarations,
      new RegExp(`(interface|type|const)\\s+\\w*${word}`, 'i'),
      `a role type is named after "${word}" — that is one sport's instance, not the role.`,
    );
  }
});

test('spatialGrid requires the three fields the zoneGrid bug was made of', () => {
  // format, unit and caption were all hardcoded to MLB in the board's
  // zoneGrid, which is how NFL's 14.8 rendered as "4.800". They carry no
  // defaults here and are non-optional on the role.
  for (const field of ['format: Formatter;', 'unit: string;', 'caption: string;']) {
    assert.ok(
      ROLES_SRC.includes(field),
      `SpatialGridRole no longer requires \`${field}\` — that is the exact shape of the "4.800" bug.`,
    );
  }
});

test('careerH2H requires its sample size', () => {
  // Most head-to-head records are tiny. A line without its n is unreadable at
  // best and misleading at worst.
  assert.match(ROLES_SRC, /\n\s+sampleSize: number;/, 'CareerH2HRole made sampleSize optional');
});

test('toRoleStat carries rank through and leaves flags off when unset', () => {
  const ranked = toRoleStat({ key: 'k', label: 'K', value: 3.2, decimals: 1, rank: 4, poolSize: 30 });
  assert.equal(ranked.rank, 4);
  assert.equal(ranked.poolSize, 30);
  assert.equal('lowerIsBetter' in ranked, false, 'an unset flag must be absent, not false — absent means "not applicable"');
  const flagged = toRoleStat({ key: 'k', label: 'K', value: 3.2, decimals: 1, rank: 4, poolSize: 30 }, { lowerIsBetter: true, sub: 'n=12' });
  assert.equal(flagged.lowerIsBetter, true);
  assert.equal(flagged.sub, 'n=12');
});
