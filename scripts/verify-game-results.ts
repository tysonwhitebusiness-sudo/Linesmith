/**
 * R2 verification — runs the real `readGameResults` against real Postgres and
 * prints the plan's own fixture. Not a test: it needs the database.
 *   npx tsx scripts/verify-game-results.ts
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

async function main() {
  const { readGameResults, recordFromResults } = await import('../lib/history/gameResults');

  const rows = await readGameResults({ sport: 'nfl', teamId: '13', from: '2023-01-01' });
  console.log('Raiders since 2023 — de-duplicated games:', rows.length, '(audit measured 52 rows-as-games from 69 raw)');
  const byYear: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    byYear[r.gameDate.slice(0, 4)] = (byYear[r.gameDate.slice(0, 4)] ?? 0) + 1;
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  }
  console.log('by year:', byYear);
  console.log('kept by source:', bySource);
  console.log('record:', recordFromResults(rows, '13'));
  process.exit(0);
}

void main();
