/**
 * R12a verify — the deep-history read refereed against a published record:
 * the Eagles, every season since 1999 (regular season and playoffs), and
 * PHI v DAL all-time, against nflverse's games.csv. Passed 2026-09-19:
 * 28 seasons, 0 mismatched; PHI v DAL 29-26-0 both ways.
 *   npx tsx scripts/verify-deep-history.ts
 */
import fs from 'node:fs';
import path from 'node:path';
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('='); const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
async function main() {
  const { readGameResults } = await import('@/lib/history/gameResults');
  const { buildTeamHistory, buildHeadToHead } = await import('@/lib/history/teamHistoryShapes');
  const csv = await (await fetch('https://github.com/nflverse/nfldata/raw/master/data/games.csv')).text();
  const [head, ...lines] = csv.trim().split('\n');
  const cols = head.split(',');
  const at = (n: string) => cols.indexOf(n);
  const ref = new Map<number, { w: number; l: number; d: number }>();
  const refPost = new Map<number, { w: number; l: number }>();
  let dalRef = { w: 0, l: 0, d: 0 };
  for (const ln of lines) {
    const c = ln.split(',');
    const hs = c[at('home_score')], as = c[at('away_score')];
    if (hs === '' || hs === 'NA') continue;
    const home = c[at('home_team')], away = c[at('away_team')];
    if (home !== 'PHI' && away !== 'PHI') continue;
    const season = Number(c[at('season')]);
    const us = Number(home === 'PHI' ? hs : as), them = Number(home === 'PHI' ? as : hs);
    const opp = home === 'PHI' ? away : home;
    if (opp === 'DAL') { us > them ? dalRef.w++ : us < them ? dalRef.l++ : dalRef.d++; }
    if (c[at('game_type')] === 'REG') {
      const r = ref.get(season) ?? { w: 0, l: 0, d: 0 };
      us > them ? r.w++ : us < them ? r.l++ : r.d++;
      ref.set(season, r);
    } else {
      const r = refPost.get(season) ?? { w: 0, l: 0 };
      us > them ? r.w++ : r.l++;
      refPost.set(season, r);
    }
  }
  const rows = await readGameResults({ sport: 'nfl', teamId: '21', from: '1990-01-01' });
  const h = buildTeamHistory('nfl', '21', rows);
  let bad = 0;
  for (const s of [...h.seasons].reverse()) {
    const r = ref.get(s.season);
    const p = refPost.get(s.season);
    const ok = r && r.w === s.regular.w && r.l === s.regular.l && r.d === s.regular.d && (p?.w ?? 0) === (s.post?.w ?? 0) && (p?.l ?? 0) === (s.post?.l ?? 0);
    if (!ok) { bad++; console.log(`  ${s.season} ours ${s.regular.w}-${s.regular.l}-${s.regular.d} post ${s.post?.w ?? 0}-${s.post?.l ?? 0} | nflverse ${r?.w}-${r?.l}-${r?.d} post ${p?.w ?? 0}-${p?.l ?? 0}`); }
  }
  console.log(`PHI seasons ${h.seasons.length}, mismatched ${bad}; all-time regular ours ${JSON.stringify(h.allTime.regular)}`);
  const hh = buildHeadToHead('nfl', '21', '6', rows);
  console.log(`PHI v DAL ours ${hh.record.w}-${hh.record.l}-${hh.record.d} (${hh.meetings.length} meetings since ${hh.firstSeason}) | nflverse ${dalRef.w}-${dalRef.l}-${dalRef.d}`);
  process.exit(0);
}
main();
