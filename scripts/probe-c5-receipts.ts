/**
 * C5-UI, measured before anything is built on it.
 *
 * PY-A (deployed 2026-09-21 21:31 UTC) generalised grading: `hit_rule`, a
 * `__leader__` row per "longest" ranking, `outcome.detail` (the stat line) and
 * `factors._read`. The questions before building the receipts card are: which
 * slates have actually been graded BY THAT CODE, what `outcome` really holds
 * per ranking, and whether a did-not-play is distinguishable from a miss.
 *
 * Run: npx tsx scripts/probe-c5-receipts.ts
 */

import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

import { pgAll } from '../lib/db/pgClient';

const QUERIES: Array<[string, string]> = [
  [
    'graded slates by ranking (last 14 days)',
    `SELECT sport, ranking_id, slate_date::text, count(*) rows,
            count(*) FILTER (WHERE outcome IS NOT NULL) graded,
            count(*) FILTER (WHERE outcome ? 'detail') with_detail,
            count(*) FILTER (WHERE subject_id = '__leader__') leader_rows,
            count(*) FILTER (WHERE factors ? '_read') with_read
     FROM slate_rankings
     WHERE slate_date >= (current_date - 14)
     GROUP BY 1, 2, 3 ORDER BY slate_date DESC, sport, ranking_id`,
  ],
  [
    'one graded row in full, per ranking that has any',
    `SELECT DISTINCT ON (ranking_id) ranking_id, slate_date::text, rank, subject_id, subject_name,
            team, opponent, outcome::text
     FROM slate_rankings
     WHERE outcome IS NOT NULL AND subject_id <> '__leader__' AND slate_date >= (current_date - 14)
     ORDER BY ranking_id, slate_date DESC, rank`,
  ],
  [
    'the leader rows',
    `SELECT ranking_id, slate_date::text, outcome::text FROM slate_rankings
     WHERE subject_id = '__leader__' ORDER BY slate_date DESC LIMIT 10`,
  ],
  [
    'outcome keys in use',
    `SELECT ranking_id, jsonb_object_keys(outcome) k, count(*)
     FROM slate_rankings WHERE outcome IS NOT NULL AND slate_date >= (current_date - 14)
     GROUP BY 1, 2 ORDER BY 1, 2`,
  ],
  [
    'did-not-play vs miss, per graded slate',
    `SELECT ranking_id, slate_date::text,
            count(*) FILTER (WHERE (outcome->>'played')::bool IS FALSE) dnp,
            count(*) FILTER (WHERE (outcome->>'hit')::bool) hits,
            count(*) FILTER (WHERE (outcome->>'played')::bool AND NOT (outcome->>'hit')::bool) misses
     FROM slate_rankings
     WHERE outcome IS NOT NULL AND subject_id <> '__leader__' AND rank <= 5 AND slate_date >= (current_date - 14)
     GROUP BY 1, 2 ORDER BY 2 DESC, 1`,
  ],
];

async function main() {
  for (const [label, sql] of QUERIES) {
    console.log(`\n### ${label}`);
    try {
      const rows = await pgAll<Record<string, unknown>>(sql);
      if (!rows.length) console.log('  (no rows)');
      for (const r of rows.slice(0, 50)) console.log('  ' + JSON.stringify(r));
      if (rows.length > 50) console.log(`  … ${rows.length - 50} more`);
    } catch (e) {
      console.log('  ERROR ' + (e as Error).message);
    }
  }
  process.exit(0);
}

main();
