import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { OUT_OF_SCOPE, code } from './ui-scope';

/**
 * U2's guard — tables render through `DataTable`.
 *
 * This is a RATCHET, not a zero (U spec §6): the count each file is allowed
 * is recorded here with the reason, and a later phase lowers it. A new
 * hand-rolled `<table>` fails immediately, because the counts are exact.
 *
 * Two of the survivors are not laziness, they are things `DataTable` genuinely
 * cannot express yet, and both are written into the U spec's ledger:
 *   - a GROUPED header row (`colSpan` over two columns, "Sánchez throws" /
 *     "Semien sees") — the pitch table needs one;
 *   - a per-cell GRADIENT WASH rather than a flat tint — golf's scorecard
 *     colours a hole by its score relative to par, and `heat`'s flat fill
 *     would flatten the thing the card is for.
 * Neither is in the §3 spec, so neither was invented here on the way past.
 */

const ALLOWED: Record<string, { count: number; why: string }> = {
  // U6 sweeps diagnostics last, exactly as the U spec sequences it.
  'app/diagnostics/page.tsx': { count: 11, why: 'U6 sweeps diagnostics last' },
  // The leaderboard and three hole grids. The kit page proves `compact` + `heat`
  // + a par row works for the grids; moving the real ones is U6's page sweep.
  'components/GolfScheduleView.tsx': { count: 4, why: 'leaderboard + 3 hole grids — U6' },
  // Needs a grouped header row; see the note above.
  'components/PlayerRoleSections.tsx': { count: 1, why: 'grouped header (colSpan) — DataTable has none' },
  // Needs a per-cell gradient wash; see the note above.
  'components/PlayerDetail.tsx': { count: 1, why: 'golf scorecard gradient wash — DataTable heat is a flat tint' },
};

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tsx')) out.push(p);
    }
  };
  walk('app');
  walk('components');
  return out.filter(
    (f) =>
      // `DataTable` IS the table; `StatTable` is a chart primitive that keeps
      // its own engine by decision (U spec §3, "the one exception").
      f !== 'components/ui/DataTable.tsx' &&
      f !== 'components/charts/StatTable.tsx' &&
      !OUT_OF_SCOPE.includes(f),
  );
}

test('no hand-rolled <table> in scope, except the named survivors', () => {
  const found: Record<string, number> = {};
  for (const f of sources()) {
    const n = (code(readFileSync(f, 'utf8')).match(/<table[\s>]/g) || []).length;
    if (n > 0) found[f] = n;
  }

  const unexpected = Object.entries(found).filter(([f]) => !(f in ALLOWED));
  assert.deepEqual(
    unexpected,
    [],
    `hand-rolled <table> — render it through components/ui/DataTable:\n${unexpected.map(([f, n]) => `  ${f} (${n})`).join('\n')}`,
  );

  for (const [f, { count, why }] of Object.entries(ALLOWED)) {
    assert.equal(found[f] ?? 0, count, `${f}: expected ${count} hand-rolled <table> (${why}), found ${found[f] ?? 0}`);
  }
});

test('the table is a plain <table>, never React Aria s grid', () => {
  // React Aria's Table renders `role="grid"`: every cell becomes an arrow-key
  // stop and screen readers switch into application mode. That suits a
  // selectable list, not read-only stats. Locked decision, U spec §1a.
  const src = readFileSync('components/ui/DataTable.tsx', 'utf8');
  assert.doesNotMatch(src, /from 'react-aria-components'/, 'DataTable must keep our own engine');
  assert.match(src, /<table/, 'DataTable is a plain <table>');
});

test('heat needs a declared direction, and a null value takes no tint', () => {
  // The bug this pins: `Number(null)` is 0, which is finite, so a row that
  // opts out of heat by returning null would join the pool at zero and then be
  // tinted as the extreme. Found on the kit page's hole grid, where the par
  // row came out uniformly green.
  const src = readFileSync('components/ui/DataTable.tsx', 'utf8');
  assert.match(src, /direction: 'higher' \| 'lower'/, 'HeatSpec must require a direction');
  assert.match(src, /rawValue == null \? NaN : Number\(rawValue\)/, 'a null heat value must take no tint');
  assert.match(src, /v != null && Number\.isFinite\(Number\(v\)\)/, 'a null heat value must stay out of the pool');
});

test('totals are excluded from sorting, bars, leaders and heat', () => {
  const src = readFileSync('components/ui/DataTable.tsx', 'utf8');
  // Each of the four reads `isTotals` before computing anything.
  for (const pattern of [/const share = isTotals \? null/, /const leads = !isTotals/, /const tone = isTotals \? null/, /if \(!isTotals && c\.heat\)/]) {
    assert.match(src, pattern);
  }
});

test('a game log may not be tinted: heat is opt-in per column', () => {
  // `heat` has no default. A table gets a tint only where a caller asked for
  // one AND said which way is better.
  const src = readFileSync('components/ui/DataTable.tsx', 'utf8');
  assert.doesNotMatch(src, /heat\s*=\s*\{/, 'heat must have no default value');
  // The reference game log on the kit page is the check by eye.
  const kit = readFileSync('app/kit/KitTables.tsx', 'utf8');
  const logBlock = kit.slice(kit.indexOf('const LOG_COLUMNS'), kit.indexOf('interface SeasonRow'));
  assert.doesNotMatch(logBlock, /heat:/, 'the reference game log must carry no heat');
});

test('Card can carry a count and a flush body', () => {
  const src = readFileSync('components/ui/Card.tsx', 'utf8');
  assert.match(src, /count\?: number;/);
  assert.match(src, /flush\?: boolean;/);
  assert.match(src, /flush \? 'overflow-hidden'/, 'a flush body must drop its padding');
});

test('Pagination offers the four modes the spec names', () => {
  const src = readFileSync('components/ui/Pagination.tsx', 'utf8');
  assert.match(src, /export type PagingMode = 'minimal' \| 'numbered' \| 'more' \| 'all';/);
  // A table under one page shows its caption instead of a footer.
  const table = readFileSync('components/ui/DataTable.tsx', 'utf8');
  assert.match(table, /paging && !onePage/, 'a single-page table must not render a pager');
});
