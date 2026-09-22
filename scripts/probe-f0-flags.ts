/**
 * F0-UI, measured before anything is built on it.
 *
 * PY-B wrote 32 spotlight rankings (`kind='spotlight'`) into `slate_rankings`
 * and nothing renders them. Before writing `/api/slate/flags` the questions
 * are: what rows actually exist, what do their ids look like (subject/team/
 * game), and can a research page find its own rows with the ids IT holds?
 *
 * Run: npx tsx scripts/probe-f0-flags.ts
 */

import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

import { pgAll } from '../lib/db/pgClient';

const QUERIES: Array<[string, string]> = [
  [
    'mlb-hr-parks: what is the subject?',
    `SELECT subject_id, subject_name, team, team_id, opponent, opponent_id, game_id, rank, factors::text
     FROM slate_rankings WHERE ranking_id = 'mlb-hr-parks' AND slate_date >= (current_date - 2)
     ORDER BY rank LIMIT 4`,
  ],
  [
    'every spotlight ranking ever written (all dates)',
    `SELECT sport, ranking_id, count(*) n, min(slate_date)::text first, max(slate_date)::text last
     FROM slate_rankings WHERE kind = 'spotlight' GROUP BY 1, 2 ORDER BY 1, 2`,
  ],
  [
    'specials today, for comparison',
    `SELECT sport, ranking_id, slate_date::text, count(*) n
     FROM slate_rankings WHERE kind = 'special' AND slate_date >= (current_date - 1)
     GROUP BY 1, 2, 3 ORDER BY 1, 2`,
  ],
  [
    'factor keys used per spotlight ranking',
    `SELECT ranking_id, jsonb_object_keys(factors) AS k, count(*)
     FROM slate_rankings WHERE kind='spotlight' AND slate_date >= (current_date - 5)
     GROUP BY 1, 2 ORDER BY 1, 2`,
  ],
  [
    'how many games today per sport (are the other sports simply idle?)',
    `SELECT sport, count(DISTINCT game_id) games FROM game_odds_book_lines
     WHERE commence_time >= current_date AND commence_time < current_date + 2
     GROUP BY 1 ORDER BY 1`,
  ],
];

async function main() {
  for (const [label, sql] of QUERIES) {
    console.log(`\n### ${label}`);
    try {
      const rows = await pgAll<Record<string, unknown>>(sql);
      if (!rows.length) console.log('  (no rows)');
      for (const r of rows.slice(0, 60)) console.log('  ' + JSON.stringify(r));
      if (rows.length > 60) console.log(`  … ${rows.length - 60} more`);
    } catch (e) {
      console.log('  ERROR ' + (e as Error).message);
    }
  }
  process.exit(0);
}

main();
