/**
 * Movers gameplan, step 0: is the noise a few BOOKS (or providers), and can a
 * rule separate it from real movement? Measures, per bookmaker × provider over
 * the last 36h of MLB prop and game-line history:
 *   - changes: how often its price changes per series
 *   - revert rate: a change that is undone by the very next change (A→B→A)
 *   - big-move share: changes over 10 implied points
 *   - off-median share: its latest quote ≥4 pts from the cross-book median
 *     (same prop, line and side, ≥5 books quoting)
 * Read-only. Run: npx tsx scripts/probe-quote-quality.ts
 */
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const IMPLIED = (col: string) => `(CASE WHEN ${col} > 0 THEN 100.0 / (${col} + 100) ELSE (-${col})::numeric / (-${col} + 100) END)`;

async function main() {
  const { pgAll } = await import('../lib/db/pgClient');

  const props = await pgAll<Record<string, unknown>>(
    `WITH h AS (
       SELECT provider_id, bookmaker, game_id, subject_id, market_key, line, side, american_odds, observed_at,
              ${IMPLIED('american_odds')} AS p
       FROM prop_odds_history
       WHERE observed_at > now() - interval '36 hours' AND american_odds BETWEEN -2000 AND 2000 AND american_odds NOT BETWEEN -99 AND 99
     ), s AS (
       SELECT *, lag(p) OVER w AS prev_p, lead(p) OVER w AS next_p
       FROM h WINDOW w AS (PARTITION BY provider_id, bookmaker, game_id, subject_id, market_key, line, side ORDER BY observed_at)
     ), c AS (
       SELECT provider_id, bookmaker, p, prev_p, next_p FROM s WHERE prev_p IS NOT NULL AND abs(p - prev_p) > 0.0001
     )
     SELECT provider_id, bookmaker,
            count(*) AS changes,
            round(avg(abs(p - prev_p)) * 100, 2) AS avg_move_pts,
            round(100.0 * avg(CASE WHEN abs(p - prev_p) > 0.10 THEN 1 ELSE 0 END), 1) AS big_pct,
            round(100.0 * avg(CASE WHEN next_p IS NOT NULL AND abs(next_p - prev_p) < 0.005 THEN 1 ELSE 0 END), 1) AS revert_pct
     FROM c GROUP BY 1, 2 HAVING count(*) >= 200 ORDER BY revert_pct DESC`,
    [],
  );
  console.log('=== PROPS, last 36h: per book × provider (≥200 changes) ===');
  console.log('provider      book            changes  avgPts  big%>10  revert%');
  for (const r of props) console.log(String(r.provider_id).padEnd(13), String(r.bookmaker).padEnd(15), String(r.changes).padStart(7), String(r.avg_move_pts).padStart(7), String(r.big_pct).padStart(8), String(r.revert_pct).padStart(8));

  const dev = await pgAll<Record<string, unknown>>(
    `WITH last AS (
       SELECT DISTINCT ON (game_id, subject_id, market_key, line, side, bookmaker)
              game_id, subject_id, market_key, line, side, bookmaker, ${IMPLIED('american_odds')} AS p
       FROM prop_odds_history
       WHERE observed_at > now() - interval '12 hours' AND american_odds BETWEEN -2000 AND 2000 AND american_odds NOT BETWEEN -99 AND 99
       ORDER BY game_id, subject_id, market_key, line, side, bookmaker, observed_at DESC
     ), med AS (
       SELECT game_id, subject_id, market_key, line, side, (percentile_cont(0.5) WITHIN GROUP (ORDER BY p))::numeric AS m, count(*) AS books
       FROM last GROUP BY 1, 2, 3, 4, 5 HAVING count(*) >= 5
     )
     SELECT l.bookmaker, count(*) AS quotes,
            round(avg(abs(l.p - med.m)) * 100, 2) AS avg_dev_pts,
            round(100.0 * avg(CASE WHEN abs(l.p - med.m) >= 0.04 THEN 1 ELSE 0 END), 1) AS off4_pct
     FROM last l JOIN med USING (game_id, subject_id, market_key, line, side)
     GROUP BY 1 HAVING count(*) >= 200 ORDER BY off4_pct DESC`,
    [],
  );
  console.log('\n=== PROPS, latest quote vs cross-book median (≥5 books), last 12h ===');
  console.log('book            quotes  avgDev  off≥4pts%');
  for (const r of dev) console.log(String(r.bookmaker).padEnd(15), String(r.quotes).padStart(6), String(r.avg_dev_pts).padStart(7), String(r.off4_pct).padStart(9));

  const games = await pgAll<Record<string, unknown>>(
    `WITH h AS (
       SELECT bookmaker, event_id, market, side, point, observed_at, ${IMPLIED('american_odds')} AS p
       FROM game_odds_history
       WHERE observed_at > now() - interval '36 hours' AND american_odds BETWEEN -5000 AND 5000 AND american_odds NOT BETWEEN -99 AND 99
     ), s AS (
       SELECT *, lag(p) OVER w AS prev_p, lead(p) OVER w AS next_p, lag(point) OVER w AS prev_point
       FROM h WINDOW w AS (PARTITION BY bookmaker, event_id, market, side ORDER BY observed_at)
     )
     SELECT bookmaker, count(*) AS changes,
            round(avg(abs(p - prev_p)) * 100, 2) AS avg_move_pts,
            round(100.0 * avg(CASE WHEN point IS DISTINCT FROM prev_point THEN 1 ELSE 0 END), 1) AS point_changed_pct,
            round(100.0 * avg(CASE WHEN abs(p - prev_p) > 0.10 AND point IS NOT DISTINCT FROM prev_point THEN 1 ELSE 0 END), 1) AS big_same_point_pct,
            round(100.0 * avg(CASE WHEN next_p IS NOT NULL AND abs(next_p - prev_p) < 0.005 THEN 1 ELSE 0 END), 1) AS revert_pct
     FROM s WHERE prev_p IS NOT NULL AND abs(p - prev_p) > 0.0001
     GROUP BY 1 HAVING count(*) >= 50 ORDER BY big_same_point_pct DESC`,
    [],
  );
  console.log('\n=== GAME LINES, last 36h: per book (≥50 changes) ===');
  console.log('book            changes  avgPts  pointChg%  big>10 same point%  revert%');
  for (const r of games) console.log(String(r.bookmaker).padEnd(15), String(r.changes).padStart(7), String(r.avg_move_pts).padStart(7), String(r.point_changed_pct).padStart(10), String(r.big_same_point_pct).padStart(19), String(r.revert_pct).padStart(8));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
