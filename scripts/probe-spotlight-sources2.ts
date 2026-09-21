/** Spotlights step 0b: golf course history depth, tennis stat keys, NBA/NHL team pace fields. Run: npx tsx scripts/probe-spotlight-sources2.ts */
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
async function main() {
  const { pgAll } = await import('../lib/db/pgClient');
  const g = await pgAll<Record<string, unknown>>(`SELECT count(DISTINCT r.event_id) AS events, count(DISTINCT t.course_name) AS courses, min(t.start_date)::text AS first, max(t.start_date)::text AS last FROM golf_tournament_results r LEFT JOIN golf_tournaments t ON t.event_id = r.event_id`, []).catch(async () => pgAll<Record<string, unknown>>(`SELECT count(DISTINCT event_id) AS events FROM golf_tournament_results`, []));
  console.log('golf results:', JSON.stringify(g[0]));
  const gt = await pgAll<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name='golf_tournaments'`, []);
  console.log('golf_tournaments cols:', gt.map((x) => x.column_name).join(','));
  const gr = await pgAll<Record<string, unknown>>(`SELECT count(DISTINCT event_id) AS events FROM golf_round_scores`, []);
  console.log('golf round-score events:', gr[0].events);
  for (const sport of ['tennis_atp', 'nba', 'nhl', 'soccer_epl', 'nfl', 'mlb']) {
    const r = await pgAll<Record<string, unknown>>(`SELECT stats FROM player_game_history WHERE sport = ? ORDER BY game_date DESC LIMIT 1`, [sport]);
    const s = r[0]?.stats;
    const keys = s ? Object.keys(typeof s === 'string' ? JSON.parse(s) : s) : [];
    console.log(`player_game_history ${sport} stat keys (${keys.length}):`, keys.slice(0, 40).join(','));
  }
  for (const sport of ['nba', 'nhl', 'soccer_epl', 'cfb']) {
    const r = await pgAll<Record<string, unknown>>(`SELECT pos_group, stats FROM team_game_production WHERE sport = ? ORDER BY game_date DESC LIMIT 1`, [sport]);
    const s = r[0]?.stats;
    const keys = s ? Object.keys(typeof s === 'string' ? JSON.parse(s) : s) : [];
    console.log(`team_game_production ${sport} [${r[0]?.pos_group}] keys (${keys.length}):`, keys.slice(0, 30).join(','));
  }
  const inj = await pgAll<Record<string, unknown>>(`SELECT sport, max(captured_on)::text AS latest, count(DISTINCT captured_on) AS days FROM injury_report GROUP BY 1`, []);
  console.log('injury_report:', inj.map((r) => `${r.sport}@${r.latest} (${r.days}d)`).join('  '));
  const pe = await pgAll<Record<string, unknown>>(`SELECT min(game_date)::text AS a, max(game_date)::text AS b, count(DISTINCT game_pk) AS games FROM mlb_pitch_events`, []);
  console.log('mlb_pitch_events:', JSON.stringify(pe[0]));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
