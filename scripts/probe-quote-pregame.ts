/** Movers step 0c: per-book quality on PRE-GAME quotes only. Run: npx tsx scripts/probe-quote-pregame.ts */
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const IMPLIED = (col: string) => `(CASE WHEN ${col} > 0 THEN 100.0 / (${col} + 100) ELSE (-${col})::numeric / (-${col} + 100) END)`;
async function main() {
  const { pgAll } = await import('../lib/db/pgClient');
  const rows = await pgAll<Record<string, unknown>>(
    `WITH starts AS (SELECT game_id::text AS gid, commence_time FROM game_picks WHERE commence_time > now() - interval '4 days'),
     h AS (SELECT provider_id, bookmaker, game_id, subject_id, market_key, line, side, observed_at, ${IMPLIED('american_odds')} AS p
           FROM prop_odds_history t JOIN starts s ON s.gid = t.game_id
           WHERE observed_at > now() - interval '36 hours' AND observed_at < s.commence_time
             AND american_odds BETWEEN -2000 AND 2000 AND american_odds NOT BETWEEN -99 AND 99),
     c AS (SELECT *, lag(p) OVER w AS prev_p, lead(p) OVER w AS next_p FROM h
           WINDOW w AS (PARTITION BY provider_id, bookmaker, game_id, subject_id, market_key, line, side ORDER BY observed_at))
     SELECT provider_id, bookmaker, count(*) AS changes, round(avg(abs(p - prev_p)) * 100, 2) AS avg_pts,
            round(100.0 * avg(CASE WHEN abs(p - prev_p) > 0.10 THEN 1 ELSE 0 END), 1) AS big_pct,
            round(100.0 * avg(CASE WHEN next_p IS NOT NULL AND abs(next_p - prev_p) < 0.005 THEN 1 ELSE 0 END), 1) AS revert_pct
     FROM c WHERE prev_p IS NOT NULL AND abs(p - prev_p) > 0.0001
     GROUP BY 1, 2 HAVING count(*) >= 100 ORDER BY big_pct DESC, revert_pct DESC`,
    [],
  );
  console.log('provider      book            changes  avgPts  big%>10  revert%');
  for (const r of rows) console.log(String(r.provider_id).padEnd(13), String(r.bookmaker).padEnd(15), String(r.changes).padStart(7), String(r.avg_pts).padStart(7), String(r.big_pct).padStart(8), String(r.revert_pct).padStart(8));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
