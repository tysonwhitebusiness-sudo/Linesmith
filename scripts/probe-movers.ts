/**
 * Runs S2's four reads against the real database, before any UI is built on
 * them. Same habit as `probe-odds-history.ts`: measure, then build.
 *
 * Run: npx tsx scripts/probe-movers.ts
 */

import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

import { readGameLineMovers, readPropMovers, readPriceOutliers, readLineDisagreements } from '../lib/slate/marketMoves';
import { readSnapshotCache } from '../lib/db/client';

async function gameIds(key: string): Promise<string[]> {
  const cached = await readSnapshotCache(key);
  if (!cached) return [];
  const snap = JSON.parse(cached.payload);
  return ((snap?.context?.other?.games ?? []) as Array<{ gamePk?: unknown }>).map((g) => String(g.gamePk)).filter(Boolean);
}

async function main() {
  const ids = await gameIds('mlb:snapshot');
  console.log(`mlb slate: ${ids.length} games`);

  const t0 = Date.now();
  const gameMovers = await readGameLineMovers(ids, 36, 10);
  console.log(`\n=== game-line movers (${Date.now() - t0}ms, ${gameMovers.length} rows) ===`);
  for (const m of gameMovers.slice(0, 5)) {
    console.log(`${m.gameId} ${m.market}/${m.side} ${m.bookmaker}: ${m.firstOdds} -> ${m.lastOdds} (${m.movePts.toFixed(1)} pts, n=${m.observations})`);
  }

  const t1 = Date.now();
  const propMovers = await readPropMovers(ids, 36, 10);
  console.log(`\n=== prop movers (${Date.now() - t1}ms, ${propMovers.length} rows) ===`);
  for (const m of propMovers.slice(0, 5)) {
    console.log(`${m.subjectName ?? m.subjectId} ${m.market} ${m.line} ${m.side} ${m.bookmaker}: ${m.firstOdds} -> ${m.lastOdds} (${m.movePts.toFixed(1)} pts, n=${m.observations})`);
  }

  const t2 = Date.now();
  const outliers = await readPriceOutliers(ids, 10);
  console.log(`\n=== price outliers (${Date.now() - t2}ms, ${outliers.length} rows) ===`);
  for (const o of outliers.slice(0, 5)) {
    console.log(`${o.subjectName ?? o.subjectId} ${o.market} ${o.line} ${o.side}: ${o.bookmaker} ${o.odds} vs median ${o.medianOdds} (${o.gapPts.toFixed(1)} pts, ${o.books} books)`);
  }

  const t3 = Date.now();
  const splits = await readLineDisagreements(ids, 10);
  console.log(`\n=== line disagreements (${Date.now() - t3}ms, ${splits.length} rows) ===`);
  for (const d of splits.slice(0, 5)) {
    console.log(`${d.subjectName ?? d.subjectId} ${d.market}: ${d.mainLine} (${d.mainBooks}) vs ${d.otherLine} (${d.otherBooks}) at ${d.otherBookmakers.slice(0, 4).join(', ')}`);
  }

  process.exit(0);
}

void main();
