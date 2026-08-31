import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nothing a `'use client'` component reaches may take a VALUE import from a
 * module that touches the database.
 *
 * WHY THIS TEST EXISTS. Phase 6 introduced this bug twice in six commits and
 * it broke every page in the app — `Module not found: Can't resolve 'dns'`,
 * because Next bundled `pg` for the browser:
 *
 *   ./lib/db/pgClient.ts -> seasonAggregates.ts -> nhl/teamDetailAdapter.ts
 *     -> components/GameDetail.tsx                                    (6.2b)
 *   ./lib/db/client.ts -> nfl/nflTeamGrades.ts -> nfl/gameDetailAdapter.ts
 *     -> components/GameDetail.tsx                                     (6.1)
 *
 * **`tsc --noEmit` passes it. All 103 other tests pass it.** It is a bundling
 * boundary, not a type error, and the tests import the modules directly under
 * Node where `pg` resolves fine. Only a real build or a running dev server
 * catches it — and for the whole of Phase 6 another session's dev server held
 * `.next/`, so none could start. It survived six commits that way.
 *
 * A TYPE IMPORT IS FINE and is the intended escape hatch: `import type` is
 * erased by the compiler and reaches no runtime module. That distinction is
 * the entire subject of this test, so it checks the import FORM, not just the
 * path.
 *
 * This is a static approximation of what the bundler does. It is not a
 * substitute for running `npm run build` — which is now the rule before
 * claiming any UI work is done.
 */

/** Modules that pull in `pg` (or anything else Node-only) transitively. */
const DB_MODULES = [
  '@/lib/db/pgClient',
  // 6.10: the venue-factor READ half. Its type and its formatter live in
  // `venueFactorShapes.ts`, which is what a client component may import.
  '@/lib/sports/shared/venueFactor',
  '@/lib/db/client',
  '@/lib/sports/shared/seasonAggregates',
  '@/lib/sports/mlb/pitchProfile',
  // 6.7: `components/useNhlShotProfile.ts` takes its type from the SHAPES file;
  // this one value-imports `pgAll`.
  '@/lib/sports/nhl/shotProfile',
  '@/lib/sports/nba/shotProfile',
  '@/lib/sports/nfl/targetMap',
  // 6.13: `components/useGolfShotProfile.ts` and golf's adapter take their type
  // from the SHAPES file; this one value-imports `pgAll`.
  '@/lib/sports/golf/shotProfile',
  // 6.16: `components/useLineHistory.ts` takes its result type from here. That
  // is an `import type` and erased — a VALUE import would bundle `pg`.
  '@/lib/odds/props/lineHistory',
  '@/lib/sports/nfl/nflTeamGrades',
  // 6.14: `components/useTeamRatingHistory.ts` and the six team adapters take
  // their types from `teamRatingShapes.ts`; this one value-imports `pgAll`.
  '@/lib/sports/shared/teamRatingHistory',
];

/**
 * What a `'use client'` component actually reaches.
 *
 * NOT all of `lib/sports/`. `lib/sports/{sport}/adapter.ts` (singular),
 * `espn.ts`, `nhle.ts`, `cfbd.ts` and friends are SERVER-side data builders
 * called from route handlers, and they touch the database on purpose — 27 of
 * them do. The client boundary is narrower and specific:
 *
 *   - `components/**` — every shared component and hook.
 *   - `lib/sports/{sport}/adapters/**` (PLURAL) — the pure sport-adapter
 *     transforms `CLAUDE.md`'s sport-adapter convention defines, imported
 *     directly by PlayerDetail/TeamDetail/GameDetail.
 *   - `lib/sports/shared/**` — cross-sport helpers, which the adapters import.
 *
 * Both real bugs crossed exactly this line: a shared helper and a sport
 * adapter. Widening the scope to all of `lib/sports` produces 27 false
 * positives and a test nobody can act on.
 */
function isClientReachable(file: string): boolean {
  return (
    file.startsWith('components/') ||
    /^lib\/sports\/[^/]+\/adapters\//.test(file) ||
    file.startsWith('lib/sports/shared/')
  );
}

/**
 * The db modules themselves are allowed to import db modules.
 *
 * Both entries are cross-sport SERVER halves that live under `lib/sports/shared/`
 * because their subject genuinely spans sports — one `team_elo_history` table,
 * one aggregation — so there is no `lib/sports/{sport}/` to put them in. Being
 * listed here exempts the file from the scan; being listed in `DB_MODULES`
 * above is what stops anything client-reachable importing IT. A new entry needs
 * both, or it is exempted without being guarded.
 */
const SELF = [
  'lib/sports/shared/seasonAggregates.ts',
  'lib/sports/shared/teamRatingHistory.ts',
  // 6.10: one `venue_factors` table across six sports, so there is no
  // `lib/sports/{sport}/` to put it in — the same reason the two above live here.
  'lib/sports/shared/venueFactor.ts',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

/**
 * Import statements that bring a RUNTIME binding in — i.e. not `import type`
 * and not a purely-inline-type specifier list.
 */
function valueImportsOf(source: string): Array<{ from: string; clause: string }> {
  const out: Array<{ from: string; clause: string }> = [];
  const re = /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) != null) {
    const [, typeKeyword, clause, from] = m;
    if (typeKeyword) continue; // `import type { X } from ...` — erased.
    // `import { type A, type B } from ...` — every specifier inline-typed, also erased.
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      const specifiers = named[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (specifiers.length > 0 && specifiers.every((s) => s.startsWith('type '))) continue;
    }
    out.push({ from, clause: clause.trim() });
  }
  return out;
}

test('no client-reachable module value-imports a database module', () => {
  const offences: string[] = [];

  for (const root of ['components', 'lib/sports']) {
    for (const file of walk(root)) {
      if (!isClientReachable(file) || SELF.includes(file)) continue;
      const source = readFileSync(file, 'utf8');
      for (const imp of valueImportsOf(source)) {
        if (!DB_MODULES.includes(imp.from)) continue;
        offences.push(`${file}\n      imports { ${imp.clause} } from '${imp.from}'`);
      }
    }
  }

  assert.deepEqual(
    offences,
    [],
    `\n\nA client-reachable module takes a VALUE import from a database module.\n` +
      `Next will bundle \`pg\` for the browser and every page importing it will\n` +
      `fail with "Module not found: Can't resolve 'dns'". tsc will NOT catch this.\n\n` +
      `  ${offences.join('\n  ')}\n\n` +
      `Fix: split the pure part into its own module (see\n` +
      `lib/sports/shared/seasonAggregateShapes.ts and lib/sports/nfl/nflUnitGrades.ts),\n` +
      `or make the import \`import type\` if only types are needed.\n`,
  );
});

test('the import parser tells a type import from a value import', () => {
  // The whole test above rests on this distinction, so it is checked directly
  // rather than trusted.
  const value = valueImportsOf(`import { foo } from '@/lib/db/client';`);
  assert.equal(value.length, 1, 'a plain named import must count as a value import');

  assert.deepEqual(valueImportsOf(`import type { Foo } from '@/lib/db/client';`), [], 'import type is erased');
  assert.deepEqual(
    valueImportsOf(`import { type Foo, type Bar } from '@/lib/db/client';`),
    [],
    'an all-inline-type specifier list is erased',
  );
  // Mixed is NOT erased — `foo` is a real runtime binding.
  assert.equal(
    valueImportsOf(`import { type Foo, bar } from '@/lib/db/client';`).length,
    1,
    'a mixed type/value import list still pulls the module in at runtime',
  );
});

test('the two modules split out for this reason stay pure', () => {
  for (const file of ['lib/sports/shared/seasonAggregateShapes.ts', 'lib/sports/nfl/nflUnitGrades.ts']) {
    const source = readFileSync(file, 'utf8');
    for (const imp of valueImportsOf(source)) {
      assert.ok(
        !DB_MODULES.includes(imp.from),
        `${file} exists precisely to be database-free and now value-imports '${imp.from}'.`,
      );
    }
  }
});
