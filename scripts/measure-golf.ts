/**
 * R6.6 Step 0 — what golf actually holds for a player page: the four golf
 * tables' columns, date span and id space, whether they join to each other and
 * to the page's ESPN athlete id, and how current each one is.
 *   npx tsx scripts/measure-golf.ts
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
  for (const t of ['golf_tournaments', 'golf_round_scores', 'golf_hole_scores', 'golf_shot_events']) {
    const cols = await pgAll<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position`, [t]);
    const [n] = await pgAll<{ n: string }>(`SELECT count(*)::text AS n FROM ${t}`);
    log(`\n=== ${t}: ${n?.n} rows\n    ${cols.map((c) => c.column_name).join(', ')}`);
  }

  const events = await pgAll<Record<string, string>>(
    `SELECT t.event_id::text AS event_id, t.name, t.season::text AS season, t.start_date::text AS start_date, t.field_size::text AS field,
            (SELECT count(DISTINCT espn_id) FROM golf_round_scores r WHERE r.event_id = t.event_id)::text AS golfers,
            (SELECT count(*) FROM golf_round_scores r WHERE r.event_id = t.event_id)::text AS rounds,
            (SELECT count(*) FROM golf_hole_scores h WHERE h.event_id = t.event_id)::text AS holes
       FROM golf_tournaments t ORDER BY t.start_date`,
  );
  log('\ntournaments:');
  for (const e of events) log(`    ${e.start_date} ${e.name} (season ${e.season}, event ${e.event_id}) field ${e.field} · ${e.golfers} golfers, ${e.rounds} rounds, ${e.holes} holes`);
  const orphan = await pgAll<{ event_id: string; n: string }>(
    `SELECT event_id::text AS event_id, count(*)::text AS n FROM golf_round_scores WHERE event_id NOT IN (SELECT event_id FROM golf_tournaments) GROUP BY 1`,
  );
  log(`round rows with no tournament: ${orphan.map((o) => `${o.event_id}=${o.n}`).join(' ') || 'none'}`);
  const depth = await pgAll<{ rounds: string; golfers: string }>(
    `SELECT rounds::text AS rounds, count(*)::text AS golfers FROM (SELECT espn_id, count(*) AS rounds FROM golf_round_scores GROUP BY espn_id) x GROUP BY rounds ORDER BY rounds`,
  );
  log(`rounds per golfer: ${depth.map((d) => `${d.rounds}r=${d.golfers}`).join(' ')}`);
  const cats = await pgAll<{ k: string; n: string }>(`SELECT coalesce(category,'(null)') AS k, count(*)::text AS n FROM golf_hole_scores GROUP BY 1 ORDER BY count(*) DESC`);
  log(`hole categories: ${cats.map((c) => `${c.k}=${c.n}`).join(' ')}`);
  const [w] = await pgAll<Record<string, string>>(
    `SELECT count(*)::text AS n, count(wind_mph)::text AS wind, count(temp_f)::text AS temp, count(tee_wave)::text AS wave FROM golf_round_scores`,
  );
  log(`round weather filled: ${JSON.stringify(w)}`);
  const ss = await pgAll<Record<string, string>>(
    `SELECT season::text AS season, count(*)::text AS n, count(DISTINCT tournament_id)::text AS events, count(DISTINCT player_id)::text AS players FROM golf_shot_events GROUP BY season ORDER BY season`,
  );
  log('\nshot seed by season:');
  for (const x of ss) log(`    ${x.season}: ${x.n} shots, ${x.events} events, ${x.players} players`);
  const top = await pgAll<{ espn_id: string; rounds: string; events: string }>(
    `SELECT espn_id::text AS espn_id, count(*)::text AS rounds, count(DISTINCT event_id)::text AS events FROM golf_round_scores GROUP BY espn_id ORDER BY count(*) DESC LIMIT 5`,
  );
  log(`\nmost rounds held: ${top.map((s) => `${s.espn_id}=${s.rounds}r/${s.events}ev`).join(' ')}`);
  for (const name of ['Scottie Scheffler', 'Rory McIlroy', 'Xander Schauffele', 'Ludvig Aberg']) {
    const [r] = await pgAll<Record<string, string>>(
      `SELECT count(*)::text AS shots, count(DISTINCT tournament_id)::text AS events, min(season)::text AS first, max(season)::text AS last FROM golf_shot_events WHERE lower(player_name) = lower(?)`,
      [name],
    );
    log(`    ${name}: ${r?.shots} shots, ${r?.events} events, seasons ${r?.first}-${r?.last}`);
  }
  const [sch] = await pgAll<Record<string, string>>(`SELECT count(*)::text AS rounds, count(DISTINCT event_id)::text AS events FROM golf_round_scores WHERE espn_id::text = '9478'`);
  log(`Scheffler (ESPN 9478): ${sch?.rounds} rounds over ${sch?.events} events`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
