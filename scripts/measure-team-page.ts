/**
 * R7 Step 0 — what a team page can actually read, per sport: the id space each
 * team table uses (the page's route id must join all of them), how many real
 * results each G2 team has per season, and what the R5 rollups and shot tables
 * hold.
 *   npx tsx scripts/measure-team-page.ts
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

async function main() {
  const { pgAll } = await import('@/lib/db/pgClient');
  const log = (...a: unknown[]) => console.log(...a);
  const cols = async (t: string) =>
    (await pgAll<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position`, [t])).map((c) => c.column_name).join(', ');
  for (const t of ['game_result', 'player_game_history', 'team_game_production', 'player_season_production', 'nba_shot_events', 'nhl_shot_events', 'nfl_target_events'])
    log(`\n=== ${t}\n    ${await cols(t)}`);

  log('\n--- game_result team id samples per sport (source, id, raw name)');
  for (const s of ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer_epl', 'soccer_mls']) {
    const r = await pgAll<Record<string, string>>(
      `SELECT source, home_team_id, home_team_raw, count(*)::text n FROM game_result WHERE sport = ? AND game_date >= '2025-01-01' GROUP BY 1,2,3 ORDER BY count(*) DESC LIMIT 4`, [s]);
    log(s, r.map((x) => `${x.source}:${x.home_team_id}=${x.home_team_raw}(${x.n})`).join(' | '));
  }
  log('\n--- player_game_history team id samples per sport');
  for (const s of ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer_epl', 'soccer_mls']) {
    const r = await pgAll<Record<string, string>>(
      `SELECT team_id::text team, season::text season, count(*)::text n FROM player_game_history WHERE sport = ? AND season = (SELECT max(season) FROM player_game_history WHERE sport = ?) GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 3`, [s, s]);
    log(s, r.map((x) => `${x.team}@${x.season}(${x.n})`).join(' | '));
  }
  log('\n--- team_game_production: sport, season, teams, games, max date');
  for (const r of await pgAll<Record<string, string>>(
    `SELECT sport, season::text season, count(DISTINCT team_id)::text teams, count(DISTINCT game_date)::text dates, max(game_date)::text last, min(team_id) sample FROM team_game_production GROUP BY 1,2 ORDER BY 1,2`))
    log(`   ${r.sport} ${r.season}: ${r.teams} teams, ${r.dates} dates, last ${r.last}, id e.g. ${r.sample}`);
  log('\n--- player_season_production: sport, season, rows');
  for (const r of await pgAll<Record<string, string>>(`SELECT sport, season::text season, count(*)::text n FROM player_season_production GROUP BY 1,2 ORDER BY 1,2`))
    log(`   ${r.sport} ${r.season}: ${r.n}`);
  log('\n--- shot tables: season, team id sample, teams');
  for (const t of ['nba_shot_events', 'nhl_shot_events']) {
    const c = await cols(t);
    const teamCol = c.includes('team_id') ? 'team_id' : null;
    if (!teamCol) { log(`   ${t}: NO team_id column`); continue; }
    for (const r of await pgAll<Record<string, string>>(`SELECT season::text season, count(DISTINCT ${teamCol})::text teams, min(${teamCol}::text) sample, count(*)::text n FROM ${t} GROUP BY 1 ORDER BY 1`))
      log(`   ${t} ${r.season}: ${r.teams} teams, e.g. ${r.sample}, ${r.n} rows`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
