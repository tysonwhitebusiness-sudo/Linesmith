/**
 * R6.4 Step 0 — what tennis actually holds for a player page: the stat keys in
 * `player_game_history`, whether surface and tournament level are among them,
 * how far the TennisMyLife archive reaches (R4-F1), and how many opponents
 * resolve to a name (R6.4's own routed item).
 *   npx tsx scripts/measure-tennis.ts [athleteId …]
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

  for (const sport of ['tennis_atp', 'tennis_wta']) {
    const [row] = await pgAll<{ games: string; players: string; first: string; last: string }>(
      `SELECT count(*) AS games, count(DISTINCT athlete_id) AS players, min(game_date)::text AS first, max(game_date)::text AS last
         FROM player_game_history WHERE sport = ?`,
      [sport],
    );
    console.log(`${sport}: ${row?.games} rows, ${row?.players} players, ${row?.first} → ${row?.last}`);
  }

  // Every stat key tennis stores, with how often it is filled.
  const keys = await pgAll<{ key: string; n: string; filled: string }>(
    `SELECT k AS key, count(*) AS n, count(*) FILTER (WHERE stats->>k IS NOT NULL AND stats->>k <> 'null') AS filled
       FROM player_game_history, LATERAL jsonb_object_keys(stats) k
      WHERE sport IN ('tennis_atp','tennis_wta')
      GROUP BY k ORDER BY count(*) DESC`,
  );
  console.log('stat keys:', keys.map((k) => `${k.key}(${k.filled})`).join(' '));

  // What TennisMyLife holds, which `player_game_history` does not: surface,
  // level, round, rank and the serve columns. Also how current the archive is
  // (R4-F1 measured a ~2-week lag on 2026-09-14).
  const { loadTennisSeasonContext } = await import('@/lib/sports/tennis/tennismylife');
  for (const tour of ['atp', 'wta'] as const) {
    const ctx = await loadTennisSeasonContext(tour, 2026);
    const all = [...ctx.byName.values()].flatMap((e) => e.matches);
    const last = all.reduce((m, x) => (x.date > m ? x.date : m), '');
    const withServe = all.filter((m) => m.serve && m.serve.aces != null).length;
    const surfaces = [...new Set(all.map((m) => m.surface))].filter(Boolean);
    const levels = [...new Set(all.map((m) => m.level))].filter(Boolean);
    console.log(`${tour}: ${ctx.byName.size} players, ${all.length} matches, latest tournament ${last}, serve rows ${withServe}`);
    console.log(`   surfaces: ${surfaces.join(', ')} | levels: ${levels.join(', ')}`);
    const keys = [...ctx.byName.keys()].filter((k) => k.includes('alcaraz') || k.includes('sinner') || k.includes('zverev'));
    for (const k of keys) {
      const e = ctx.byName.get(k)!;
      const bySeason = new Map<string, number>();
      for (const m of e.matches) bySeason.set(m.date.slice(0, 4), (bySeason.get(m.date.slice(0, 4)) ?? 0) + 1);
      const m = e.matches[e.matches.length - 1];
      console.log(`   ${e.realName} [${k}]: ${e.matches.length} matches ${[...bySeason].map(([y, n]) => `${y}:${n}`).join(' ')} | last ${m.date.slice(0, 10)} ${m.tournamentName}`);
    }
    // The tournaments the archive ends with, to see where it stops.
    const lastEvents = [...new Set(all.map((m) => `${m.date.slice(0, 10)} ${m.tournamentName}`))].sort().slice(-6);
    console.log(`   last events: ${lastEvents.join(' | ')}`);
  }

  // Opponent names: how many rows carry one the crosswalk can name (R6.4).
  const [opp] = await pgAll<{ rows: string; with_id: string; named: string }>(
    `SELECT count(*) AS rows,
            count(*) FILTER (WHERE opponent_id IS NOT NULL) AS with_id,
            count(*) FILTER (WHERE opponent_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM athlete_crosswalk c WHERE c.athlete_id = h.opponent_id AND c.athlete_name IS NOT NULL)) AS named
       FROM player_game_history h WHERE sport IN ('tennis_atp','tennis_wta')`,
  );
  console.log(`opponents: ${opp?.rows} rows, ${opp?.with_id} with an id, ${opp?.named} the crosswalk can name`);

  process.exit(0);
}
void main();
