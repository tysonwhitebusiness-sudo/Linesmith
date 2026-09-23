/**
 * DJ-TEN, measured before anything is built on it.
 *
 * Correction 6 of the run doc says "nothing held today carries surface or
 * serve stats". Half of that is now out of date: `import_tennis.py` loaded
 * tennis-data.co.uk's `Surface`/`Court` into `game_result` on 2026-09-02
 * (migration 20260902120000), AFTER the correction was written. This measures
 * what that actually covers per tour, because it decides whether DJ-TEN has
 * to ingest surface at all or only the serve numbers.
 *
 * Run: npx tsx scripts/probe-dj-ten.ts
 */

import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

import { pgAll } from '../lib/db/pgClient';

const Q: Array<[string, string]> = [
  [
    'game_result tennis: surface coverage per tour and season',
    `SELECT sport, count(*) rows,
            count(*) FILTER (WHERE surface IS NOT NULL) with_surface,
            count(*) FILTER (WHERE court IS NOT NULL) with_court,
            min(game_date)::date::text oldest, max(game_date)::date::text newest
     FROM game_result WHERE sport LIKE 'tennis%' GROUP BY 1 ORDER BY 1`,
  ],
  [
    'which surfaces, and how many of each',
    `SELECT sport, surface, count(*) FROM game_result
     WHERE sport LIKE 'tennis%' AND surface IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 3 DESC`,
  ],
  [
    'recent seasons only — what a Surface record card would actually read',
    `SELECT sport, extract(year FROM game_date)::int season, count(*) rows,
            count(*) FILTER (WHERE surface IS NOT NULL) with_surface
     FROM game_result WHERE sport LIKE 'tennis%' AND game_date >= '2024-01-01'
     GROUP BY 1, 2 ORDER BY 1, 2`,
  ],
  [
    'can a game_result tennis row be tied to an athlete id at all',
    `SELECT * FROM game_result WHERE sport LIKE 'tennis%' AND surface IS NOT NULL
     ORDER BY game_date DESC LIMIT 2`,
  ],
  [
    'do player_game_history event ids meet game_result game ids',
    `SELECT count(*) matched FROM player_game_history h
     JOIN game_result g ON g.game_id = h.event_id AND g.sport = h.sport
     WHERE h.sport LIKE 'tennis%'`,
  ],
];

async function main() {
  for (const [label, sql] of Q) {
    console.log(`\n### ${label}`);
    try {
      const rows = await pgAll<Record<string, unknown>>(sql);
      if (!rows.length) console.log('  (no rows)');
      for (const r of rows.slice(0, 20)) console.log('  ' + JSON.stringify(r).slice(0, 600));
    } catch (e) {
      console.log('  ERROR ' + (e as Error).message);
    }
  }
  process.exit(0);
}
main();
