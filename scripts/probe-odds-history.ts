/**
 * Measure what the odds-history tables actually hold, before building on them.
 *
 * "Audit a phase's premises before building it" is the habit this repo keeps
 * paying for — three of M0-M3's task premises were wrong, and four of Phase
 * 6's. S2 (Movers) rests entirely on there being a FIRST observation per book
 * to measure a move from, so that was measured rather than assumed.
 *
 * Measured 2026-09-20 22:54 UTC:
 *   game_odds_history  65,121 rows over 3 days, 106 games, 26 books;
 *                      total 23,593 / moneyline 22,897 / spread 18,631.
 *                      3,769 book+market+side combinations across 52 games
 *                      have 2+ observations in 36h — i.e. a real move.
 *   prop_odds_history  1,798,049 rows over 3 days, 23 books.
 *                      120,495 prop lines have 2+ observations in 36h.
 *   NOTE: `game_odds_history` has NO `sport` column. It is keyed by
 *   `event_id`, so a per-sport read joins through the snapshot's game ids.
 *
 * Run: npx tsx scripts/probe-odds-history.ts
 */

import { readFileSync } from 'node:fs';

// tsx does not load `.env.local` the way `next dev` does; parsed by hand
// rather than adding a dependency for one throwaway probe.
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

import { pgAll } from '../lib/db/pgClient';

const QUERIES: Array<[string, string]> = [
  [
    'game_odds_history columns',
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='game_odds_history' ORDER BY ordinal_position`,
  ],
  [
    'game_odds_history, last 3 days',
    `SELECT count(*) n, count(DISTINCT event_id) games, count(DISTINCT bookmaker) books,
            min(observed_at) first_seen, max(observed_at) last_seen
     FROM game_odds_history WHERE observed_at > now() - interval '3 days'`,
  ],
  [
    'game_odds_history markets, last 3 days',
    `SELECT market, count(*) n FROM game_odds_history WHERE observed_at > now() - interval '3 days' GROUP BY market ORDER BY n DESC LIMIT 10`,
  ],
  [
    'game lines with 2+ observations of the same book+market+side in 36h',
    `SELECT count(*) AS movable, count(DISTINCT event_id) AS games FROM (
       SELECT event_id, bookmaker, market, side FROM game_odds_history
       WHERE observed_at > now() - interval '36 hours'
       GROUP BY event_id, bookmaker, market, side HAVING count(*) > 1
     ) t`,
  ],
  [
    'prop_odds_history columns',
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='prop_odds_history' ORDER BY ordinal_position`,
  ],
  [
    'prop_odds_history, last 3 days',
    `SELECT count(*) n, count(DISTINCT bookmaker) books, min(observed_at) first_seen, max(observed_at) last_seen
     FROM prop_odds_history WHERE observed_at > now() - interval '3 days'`,
  ],
  [
    'prop lines with 2+ observations in 36h',
    `SELECT count(*) AS movable FROM (
       SELECT subject_id, market_key, line, side, bookmaker FROM prop_odds_history
       WHERE observed_at > now() - interval '36 hours'
       GROUP BY subject_id, market_key, line, side, bookmaker HAVING count(*) > 1
     ) t`,
  ],
];

async function main() {
  for (const [label, sql] of QUERIES) {
    try {
      const rows = await pgAll<Record<string, unknown>>(sql, []);
      console.log(`\n=== ${label} === (${rows.length} rows)`);
      for (const r of rows.slice(0, 16)) console.log(JSON.stringify(r));
    } catch (e) {
      console.log(`\n=== ${label} === FAILED: ${(e as Error).message}`);
    }
  }
  process.exit(0);
}

void main();
