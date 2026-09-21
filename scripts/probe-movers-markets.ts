/** MV1 prep: which markets/sides does game_odds_history carry, and prop sides? Run: npx tsx scripts/probe-movers-markets.ts */
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
async function main() {
  const { pgAll } = await import('../lib/db/pgClient');
  const g = await pgAll<Record<string, unknown>>(`SELECT market, side, count(*) AS n, count(point) AS with_point FROM game_odds_history WHERE observed_at > now() - interval '3 days' GROUP BY 1, 2 ORDER BY 3 DESC`, []);
  console.log('game_odds_history:', g.map((r) => `${r.market}/${r.side}:${r.n}(pt ${r.with_point})`).join('  '));
  const p = await pgAll<Record<string, unknown>>(`SELECT side, count(*) AS n FROM prop_odds_history WHERE observed_at > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC`, []);
  console.log('prop sides:', p.map((r) => `${r.side}:${r.n}`).join('  '));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
