/**
 * DJ-GOLF, measured before anything is built on it.
 *
 * Measured 2026-09-22: the join key is `event_id` (an ESPN event id) and
 * `golf_tournaments` ALREADY has `course_name` and `holes_json` — it simply
 * holds 4 rows, written for the events the live job happened to touch. So the
 * backfill is a fetch-and-upsert over the events the results table already
 * names, not a new table.
 *
 * Run: npx tsx scripts/probe-dj-golf.ts
 */

import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

import { pgAll } from '../lib/db/pgClient';

const QUERIES: Array<[string, string]> = [
  [
    'events in results, and how many already name a course',
    `SELECT count(DISTINCT r.event_id) events,
            count(DISTINCT r.event_id) FILTER (WHERE t.course_name IS NOT NULL) with_course
     FROM golf_tournament_results r LEFT JOIN golf_tournaments t USING (event_id)`,
  ],
  [
    'event id shape and spread',
    `SELECT r.event_id, count(*) players, min(r.finished_at)::date::text finished
     FROM golf_tournament_results r GROUP BY 1 ORDER BY finished DESC NULLS LAST LIMIT 10`,
  ],
  [
    'how far back do the events go',
    `SELECT min(finished_at)::date::text oldest, max(finished_at)::date::text newest,
            count(*) FILTER (WHERE finished_at IS NULL) undated
     FROM golf_tournament_results`,
  ],
  [
    'other golf tables that might already name a course',
    `SELECT 'golf_hole_scores' t, count(DISTINCT event_id) events FROM golf_hole_scores
     UNION ALL SELECT 'golf_round_scores', count(DISTINCT event_id) FROM golf_round_scores
     UNION ALL SELECT 'golf_tournament_predictions', count(DISTINCT event_id) FROM golf_tournament_predictions`,
  ],
];

async function main() {
  for (const [label, sql] of QUERIES) {
    console.log(`\n### ${label}`);
    try {
      const rows = await pgAll<Record<string, unknown>>(sql);
      if (!rows.length) console.log('  (no rows)');
      for (const r of rows.slice(0, 40)) console.log('  ' + JSON.stringify(r));
      if (rows.length > 40) console.log(`  … ${rows.length - 40} more`);
    } catch (e) {
      console.log('  ERROR ' + (e as Error).message);
    }
  }
  process.exit(0);
}

main();
