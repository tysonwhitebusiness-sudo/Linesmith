/** Spotlights gameplan step 0: do the per-sport sources exist, and how fresh are they? Run: npx tsx scripts/probe-spotlight-sources.ts */
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const TABLES = ['mlb_statcast_player_season', 'team_target_profile', 'team_game_production', 'injury_report', 'player_season_production', 'team_shot_profile', 'nhl_shot_events', 'player_game_history', 'park_factors', 'team_hr_rate_allowed', 'golf_round_scores', 'golf_hole_scores', 'golf_tournament_results', 'tennis_matches', 'tml_matches', 'soccer_shot_events', 'mlb_pitch_events', 'statcast_pitches'];
async function main() {
  const { pgAll } = await import('../lib/db/pgClient');
  const exist = await pgAll<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`, []);
  const names = new Set(exist.map((r) => r.table_name));
  console.log('all tables:', [...names].sort().join(' '));
  for (const t of TABLES) {
    if (!names.has(t)) { console.log(t.padEnd(30), 'MISSING'); continue; }
    const cols = await pgAll<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = ?`, [t]);
    const c = cols.map((x) => x.column_name);
    const ts = ['updated_at', 'computed_at', 'fetched_at', 'game_date', 'observed_at', 'created_at', 'season'].find((x) => c.includes(x));
    const sportCol = c.includes('sport') ? 'sport' : null;
    const q = `SELECT ${sportCol ? 'sport,' : ''} count(*) AS n${ts ? `, max(${ts})::text AS latest` : ''} FROM ${t}${sportCol ? ' GROUP BY sport ORDER BY sport' : ''}`;
    const rows = await pgAll<Record<string, unknown>>(q, []);
    console.log(t.padEnd(30), rows.map((r) => `${r.sport ?? ''}:${r.n}${r.latest ? '@' + String(r.latest).slice(0, 10) : ''}`).join('  '), '| cols:', c.slice(0, 14).join(','));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
