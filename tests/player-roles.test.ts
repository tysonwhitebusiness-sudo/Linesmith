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
  // `binarySplit` USED to be the null one, with the comment "this app stores no
  // platoon split". This test said: "If 6.6-6.9 landed, good — update this
  // test." 6.6 landed, and `mlb_pitch_events` carries `p_throws` and `stand` on
  // all 2,140,525 rows. Updated 2026-08-30 — MLB now fills all six.
  //
  // Kept as an assertion rather than deleted: the point was never that MLB has
  // exactly one null, it was that a role must be REAL or absent, never a
  // placeholder. `toPlatoonBinarySplit` returns null unless both hands have a
  // real sample, which is what makes filling it honest.
  assert.match(MLB_ADAPTER, /binarySplit: toPlatoonBinarySplit\(/, 'MLB stopped building its platoon split');
  assert.doesNotMatch(
    MLB_ADAPTER,
    /binarySplit: null/,
    'MLB is back to a null binarySplit — if the platoon source went away, say so in the comment rather than reverting silently.',
  );
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

// ---------------------------------------------------------------------------
// Which sports actually FILL each role — 6.13's real completion state.
// ---------------------------------------------------------------------------

test('a role that is built is returned from the adapter, not from a nested literal', () => {
  // NFL's `careerH2H` was built in ef93a7a and returned from the wrong object:
  // the variable landed inside the per-row gamelog literal, where nothing reads
  // it, so `data.careerH2H` was undefined and the block never rendered.
  //
  // `tsc` passes that. A gamelog row is a structural type, and an extra
  // property on an object literal returned through a mapped callback is not
  // excess-property checked. Nothing else would have caught it either — the
  // page simply showed one card fewer than the task claimed.
  const ROLES = ['opponentUnit', 'usageMix', 'spatialGrid', 'binarySplit', 'conditions', 'careerH2H'];
  const offences: string[] = [];
  let checked = 0;

  for (const sport of ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'tennis', 'golf']) {
    const path = `lib/sports/${sport}/adapters/playerDetailAdapter.ts`;
    let src: string;
    try {
      // CRLF on this machine: an unnormalised `$` lands before the \r.
      src = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      continue; // not every sport has every adapter
    }
    for (const role of ROLES) {
      // Built = the adapter computes a value under that name at function scope.
      const built = new RegExp(`^  const ${role}[ =:]`, 'm').test(src);
      if (!built) continue;
      // Returned = it appears at the adapter's own return indentation.
      const returned = new RegExp(`^    ${role},$`, 'm').test(src);
      checked += 1;
      if (!returned) {
        offences.push(`${sport}: builds \`${role}\` but never returns it at top level`);
      }
    }
  }

  assert.ok(checked > 0, 'no built roles found in any adapter -- this test is checking nothing');
  assert.deepEqual(offences, [], `\n\n${offences.join('\n')}\n`);
});
