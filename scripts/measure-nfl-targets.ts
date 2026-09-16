/**
 * R6.2 Step 0 — what `nfl_target_events` actually holds, against what G2's
 * "Usage & depth" and "Where he throws" draw (a dot per target: season, air
 * yards, side, depth band, YAC, completion, TD, INT — and the same rows for a
 * passer).
 *   npx tsx scripts/measure-nfl-targets.ts
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
  const cols = await pgAll<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'nfl_target_events' ORDER BY ordinal_position`,
  );
  console.log('columns:', cols.map((c) => `${c.column_name}:${c.data_type}`).join(' '));

  const has = (name: string) => cols.some((c) => c.column_name === name);
  const bySeason = await pgAll<Record<string, unknown>>(
    `SELECT season, count(*)::int AS rows,
            count(*) FILTER (WHERE air_yards IS NOT NULL)::int AS with_air,
            count(*) FILTER (WHERE pass_location IS NOT NULL AND pass_length IS NOT NULL)::int AS located,
            count(DISTINCT receiver_id)::int AS receivers
            ${has('passer_id') ? ", count(DISTINCT passer_id)::int AS passers" : ''}
            ${has('yards_after_catch') ? ", count(*) FILTER (WHERE yards_after_catch IS NOT NULL)::int AS with_yac" : ''}
            ${has('touchdown') ? ", count(*) FILTER (WHERE touchdown)::int AS tds" : ''}
            ${has('interception') ? ", count(*) FILTER (WHERE interception)::int AS ints" : ''}
       FROM nfl_target_events GROUP BY season ORDER BY season`,
  );
  for (const r of bySeason) console.log('season', JSON.stringify(r));

  // The two G2 subjects: Lamb (receiver) and Prescott (passer), by gsis id.
  const ids = await pgAll<{ espn_id: string; gsis_id: string; full_name: string }>(
    `SELECT espn_id, gsis_id, full_name FROM nfl_player_ids WHERE espn_id IN ('4241389','2577417','3918298')`,
  ).catch(() => []);
  console.log('crosswalk sample:', JSON.stringify(ids));
  process.exit(0);
}
void main();
