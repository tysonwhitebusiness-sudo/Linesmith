/**
 * S3's premise, measured before anything is built on it.
 *
 * Spotlights read `slate_rankings`, written by M3's `slateRankingsJob`. The
 * question is not "does the table exist" but "does it hold, today, for every
 * sport, the factors the spec says each spotlight has columns for".
 *
 * Run: npx tsx scripts/probe-rankings.ts
 */

import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

import { pgAll } from '../lib/db/pgClient';

const QUERIES: Array<[string, string]> = [
  ['columns', `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='slate_rankings' ORDER BY ordinal_position`],
  [
    'rows by sport and ranking, last 3 days',
    `SELECT sport, ranking_id, slate_date, count(*) n, count(*) FILTER (WHERE outcome IS NOT NULL) graded, min(frozen_at) frozen
     FROM slate_rankings WHERE slate_date >= (current_date - 3)
     GROUP BY 1, 2, 3 ORDER BY slate_date DESC, sport, ranking_id`,
  ],
  [
    'one row in full',
    `SELECT sport, ranking_id, slate_date, subject_id, rank, score, factors, frozen_at, outcome
     FROM slate_rankings ORDER BY slate_date DESC, sport, ranking_id, rank LIMIT 3`,
  ],
  [
    'which factor keys exist, per ranking',
    `SELECT sport, ranking_id, jsonb_object_keys(factors) AS factor, count(*) n
     FROM slate_rankings WHERE slate_date >= (current_date - 3) AND factors IS NOT NULL
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  ],
];

async function main() {
  for (const [label, sql] of QUERIES) {
    try {
      const rows = await pgAll<Record<string, unknown>>(sql, []);
      console.log(`\n=== ${label} === (${rows.length} rows)`);
      for (const r of rows.slice(0, 40)) console.log(JSON.stringify(r).slice(0, 400));
    } catch (e) {
      console.log(`\n=== ${label} === FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}

void main();
