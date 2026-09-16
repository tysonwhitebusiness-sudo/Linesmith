/**
 * R6.3 / R2-F9 — does `soccer:snapshot:epl` actually write its cache?
 *
 * The row is ~22 MB raw against a 2-minute `statement_timeout`, and R2 found it
 * rebuilding on every request and discarding the result. R6's check is whether
 * it writes on every rebuild over a day, so this prints the row's size and age
 * alongside the other sports' snapshots for comparison.
 *   npx tsx scripts/measure-soccer-snapshot.ts
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
  const { pgAll } = await import('@/lib/db/pgClient');
  const rows = await pgAll<{ cache_key: string; mb: string; age_minutes: string }>(
    `SELECT cache_key,
            round(pg_column_size(payload) / 1048576.0, 2) AS mb,
            round(extract(epoch FROM (now() - fetched_at)) / 60) AS age_minutes
       FROM snapshot_cache
      WHERE cache_key LIKE '%snapshot:%' OR cache_key LIKE 'soccer:understat:%'
      ORDER BY cache_key`,
  );
  for (const r of rows) console.log(`${r.cache_key.padEnd(34)} ${String(r.mb).padStart(7)} MB   ${String(r.age_minutes).padStart(6)} min old`);
  process.exit(0);
}
void main();
