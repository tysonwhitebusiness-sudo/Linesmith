/**
 * R7 Step 0 — each G2 team's record per season from the one results read
 * (`readGameResults`), with the season scope the hero would open on, so the
 * numbers can be refereed against the leagues rather than against G2.
 *   npx tsx scripts/measure-team-records.ts
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const TEAMS: Array<[string, string, string]> = [
  ['mlb', '118', 'Royals'], ['nfl', '13', 'Raiders'], ['cfb', '194', 'Ohio State'], ['nba', '13', 'Lakers'],
  ['nhl', '10', 'Maple Leafs'], ['soccer_epl', '382', 'Man City'], ['soccer_mls', '18418', 'MLS sample'],
];

async function main() {
  const { readGameResults } = await import('@/lib/history/gameResults');
  const { seasonDateRange, seasonForDate, seasonScope, seasonLabel } = await import('@/lib/sports/shared/season');
  const { pgAll } = await import('@/lib/db/pgClient');
  const cols = await pgAll<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'game_result' ORDER BY ordinal_position`);
  console.log('game_result columns:', cols.map((c) => c.column_name).join(', '));
  for (const [sport, id, name] of TEAMS) {
    const cur = seasonForDate(sport, new Date());
    console.log(`\n${sport} ${name} (${id}) — current season ${seasonLabel(sport, cur)}`);
    for (const season of [cur - 2, cur - 1, cur]) {
      const { from, to } = seasonDateRange(sport, season);
      const rows = await readGameResults({ sport, teamId: id, from, to } as never);
      let w = 0, l = 0, d = 0, pf = 0, pa = 0, home = 0, sources = new Map<string, number>();
      for (const r of rows) {
        const isHome = r.homeTeamId === id;
        const us = isHome ? r.homeScore : r.awayScore, them = isHome ? r.awayScore : r.homeScore;
        if (us > them) w++; else if (us < them) l++; else d++;
        pf += us; pa += them; if (isHome) home++;
        sources.set(r.source, (sources.get(r.source) ?? 0) + 1);
      }
      const first = rows[0]?.gameDate, last = rows[rows.length - 1]?.gameDate;
      console.log(`   ${seasonLabel(sport, season)}: ${rows.length} games ${w}-${l}-${d} PF ${pf} PA ${pa} home ${home} · ${first}..${last} · ${[...sources].map(([s, n]) => `${s} ${n}`).join(', ')}`);
      if (season === cur) console.log('   scope:', JSON.stringify(seasonScope(sport, rows.length)));
    }
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
