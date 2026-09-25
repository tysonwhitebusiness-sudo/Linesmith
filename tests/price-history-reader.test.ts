import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * P5 amendment A1: ONE shared reader. `lib/db/priceHistory.ts` is the only
 * TypeScript file that queries the compact price history or its dictionaries,
 * and nothing queries the old text table, which the conversion drops.
 */

const ROOT = join(__dirname, '..');
const SCAN = ['app', 'lib', 'components'];
const COMPACT = /\b(FROM|JOIN|INTO|UPDATE)\s+(prop_price_history|game_lines_history|odds_(games|subjects|markets|books|sources|sides|periods))\b/i;
const OLD = /\b(FROM|JOIN|INTO|UPDATE)\s+prop_odds_history\b/i;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name) && !name.startsWith('_')) out.push(p);
  }
  return out;
}

test('only lib/db/priceHistory.ts queries the compact history', () => {
  const offenders = SCAN.flatMap((d) => files(join(ROOT, d)))
    .filter((p) => relative(ROOT, p).split(/[\\/]/).join('/') !== 'lib/db/priceHistory.ts')
    .filter((p) => COMPACT.test(readFileSync(p, 'utf8')));
  assert.deepEqual(offenders.map((p) => relative(ROOT, p)), []);
});

test('nothing in the app queries prop_odds_history any more', () => {
  const offenders = SCAN.flatMap((d) => files(join(ROOT, d))).filter((p) => OLD.test(readFileSync(p, 'utf8')));
  assert.deepEqual(offenders.map((p) => relative(ROOT, p)), []);
});
