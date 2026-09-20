/**
 * U1's ratchet: where the raw `<button>` elements are.
 *
 * Counts `<button` occurrences per file under `app/` and `components/`, minus
 * the ones the U track never owns — `components/ui/` itself (the kit IS the
 * buttons), `components/charts/` (a chart mark is a `<button>` for a reason)
 * and the `OUT_OF_SCOPE` files from the U spec §0b.
 *
 * Usage: node scripts/raw-buttons.js [--all]
 */
const fs = require('fs');
const path = require('path');

const OUT_OF_SCOPE = [
  'components/ScanTable.tsx',
  'components/ScanCard.tsx',
  'components/FilterBar.tsx',
  'components/FilterSidebar.tsx',
  'components/PlayerFilterDrawer.tsx',
  'components/DateGameStrip.tsx',
  'components/GameLinesView.tsx',
  'components/GameLine.tsx',
  'components/TodaysPicksModal.tsx',
  'components/useFilters.ts',
  'components/AppShell.tsx',
];

const all = process.argv.includes('--all');
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name).split(path.sep).join('/');
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) files.push(p);
  }
};
walk('app');
walk('components');

let total = 0;
const rows = [];
for (const f of files) {
  if (!all) {
    if (f.startsWith('components/ui/') || f.startsWith('components/charts/')) continue;
    if (OUT_OF_SCOPE.includes(f)) continue;
  }
  const n = (fs.readFileSync(f, 'utf8').match(/<button[\s>]/g) || []).length;
  if (n === 0) continue;
  total += n;
  rows.push([n, f]);
}
rows.sort((a, b) => b[0] - a[0]);
for (const [n, f] of rows) console.log(String(n).padStart(4), f);
console.log(`\n${total} raw <button> in ${rows.length} files${all ? ' (whole app)' : ' (in scope)'}`);
