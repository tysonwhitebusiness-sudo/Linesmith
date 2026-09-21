/**
 * Movers gameplan, step 0b: how much of the "big move" noise is simply LIVE
 * in-game pricing? Joins game-line and prop history to each game's start time
 * and splits changes into pre-game vs after first pitch.
 * Read-only. Run: npx tsx scripts/probe-quote-live.ts
 */
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const IMPLIED = (col: string) => `(CASE WHEN ${col} > 0 THEN 100.0 / (${col} + 100) ELSE (-${col})::numeric / (-${col} + 100) END)`;

async function main() {
  const { pgAll } = await import('../lib/db/pgClient');
  const sample = await pgAll<Record<string, unknown>>(`SELECT event_id, count(*) AS n FROM game_odds_history WHERE observed_at > now() - interval '36 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 3`, []);
  console.log('game_odds_history event ids:', sample.map((r) => r.event_id).join(', '));
  const picks = await pgAll<Record<string, unknown>>(`SELECT game_id, commence_time FROM game_picks WHERE sport = 'mlb' AND commence_time > now() - interval '3 days' LIMIT 3`, []);
  console.log('game_picks ids:', picks.map((r) => r.game_id).join(', '));
  const propGames = await pgAll<Record<string, unknown>>(`SELECT game_id, count(*) AS n FROM prop_odds_history WHERE observed_at > now() - interval '36 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 3`, []);
  console.log('prop_odds_history game ids:', propGames.map((r) => r.game_id).join(', '));

  // Split by start time where the ids line up with game_picks (MLB gamePk).
  for (const [table, idCol, series] of [
    ['prop_odds_history', 'game_id', 'provider_id, bookmaker, game_id, subject_id, market_key, line, side'],
    ['game_odds_history', 'event_id', 'bookmaker, event_id, market, side'],
  ] as const) {
    const rows = await pgAll<Record<string, unknown>>(
      `WITH starts AS (SELECT game_id::text AS gid, commence_time FROM game_picks WHERE commence_time > now() - interval '4 days'),
       h AS (SELECT ${series}, observed_at, ${IMPLIED('american_odds')} AS p, s.commence_time
             FROM ${table} t JOIN starts s ON s.gid = t.${idCol}::text
             WHERE observed_at > now() - interval '36 hours' AND american_odds BETWEEN -2000 AND 2000 AND american_odds NOT BETWEEN -99 AND 99),
       c AS (SELECT *, lag(p) OVER (PARTITION BY ${series} ORDER BY observed_at) AS prev_p FROM h)
       SELECT (observed_at >= commence_time) AS live, count(*) AS changes,
              round(avg(abs(p - prev_p)) * 100, 2) AS avg_pts,
              round(100.0 * avg(CASE WHEN abs(p - prev_p) > 0.10 THEN 1 ELSE 0 END), 1) AS big_pct
       FROM c WHERE prev_p IS NOT NULL AND abs(p - prev_p) > 0.0001 GROUP BY 1`,
      [],
    );
    console.log(`\n=== ${table}: pre-game vs live (joined on game_picks) ===`);
    for (const r of rows) console.log(r.live ? 'LIVE    ' : 'PRE-GAME', 'changes', r.changes, 'avgPts', r.avg_pts, 'big>10%', r.big_pct);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
