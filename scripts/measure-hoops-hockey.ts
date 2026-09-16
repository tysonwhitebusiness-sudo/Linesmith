/**
 * R6.5 Step 0 — what NBA and NHL actually hold for a player page, before a
 * card is designed on a column that may not exist (tennis's eight keys and
 * NFL's never-written `interception` were both found this way).
 *
 * Four questions:
 *   1. `player_game_history` — rows, seasons, and every stat key with how
 *      often it is filled, per sport.
 *   2. `nba_shot_events` / `nhl_shot_events` — seasons held (the plan says
 *      2024-25 only "until R5"), columns, and how much is actually placed.
 *   3. Per-player coverage for the G2 subjects, so a real page can be rendered.
 *   4. Whether shot rows can be joined to the id space the player page uses.
 *
 *   npx tsx scripts/measure-hoops-hockey.ts
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

  // ---- 1. the page's own history ----
  for (const sport of ['nba', 'nhl']) {
    const [row] = await pgAll<{ games: string; players: string; first: string; last: string; seasons: string }>(
      `SELECT count(*) AS games, count(DISTINCT athlete_id) AS players,
              min(game_date)::text AS first, max(game_date)::text AS last,
              string_agg(DISTINCT season::text, ',' ORDER BY season::text) AS seasons
         FROM player_game_history WHERE sport = ?`,
      [sport],
    );
    log(`\n=== ${sport.toUpperCase()} player_game_history: ${row?.games} rows, ${row?.players} players, ${row?.first} → ${row?.last}`);
    log(`    seasons: ${row?.seasons}`);
    const keys = await pgAll<{ key: string; n: string; filled: string }>(
      `SELECT k AS key, count(*) AS n, count(*) FILTER (WHERE stats->>k IS NOT NULL AND stats->>k <> 'null') AS filled
         FROM player_game_history, LATERAL jsonb_object_keys(stats) k
        WHERE sport = ?
        GROUP BY k ORDER BY count(*) DESC`,
      [sport],
    );
    log(`    ${keys.length} stat keys: ${keys.map((k) => `${k.key}(${k.filled})`).join(' ')}`);
    // A key that is always the same value is a key that says nothing (R6-F3's shape).
    const flat = await pgAll<{ key: string; vals: string }>(
      `SELECT k AS key, count(DISTINCT stats->>k)::text AS vals
         FROM player_game_history, LATERAL jsonb_object_keys(stats) k
        WHERE sport = ? GROUP BY k HAVING count(DISTINCT stats->>k) <= 1`,
      [sport],
    );
    if (flat.length) log(`    !! single-valued keys (say nothing): ${flat.map((f) => f.key).join(' ')}`);
  }

  // ---- 2. the shot tables ----
  for (const [table, seasonCol] of [
    ['nba_shot_events', 'season'],
    ['nhl_shot_events', 'season'],
  ] as const) {
    const cols = await pgAll<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position`,
      [table],
    );
    if (!cols.length) {
      log(`\n=== ${table}: DOES NOT EXIST`);
      continue;
    }
    log(`\n=== ${table} columns: ${cols.map((c) => c.column_name).join(', ')}`);
    const bySeason = await pgAll<{ season: string; rows: string; players: string; placed: string; games: string }>(
      `SELECT ${seasonCol}::text AS season, count(*) AS rows,
              count(DISTINCT shooter_id) AS players,
              count(*) FILTER (WHERE x_coord IS NOT NULL AND y_coord IS NOT NULL) AS placed,
              count(DISTINCT game_id) AS games
         FROM ${table} GROUP BY 1 ORDER BY 1`,
    );
    for (const s of bySeason) {
      log(`    ${s.season}: ${s.rows} rows, ${s.games} games, ${s.players} shooters, ${s.placed} placed`);
    }
  }

  // ---- 3. the vocabularies a chart would draw ----
  const nbaTypes = await pgAll<{ k: string; n: string }>(
    `SELECT coalesce(shot_zone, '(null)') AS k, count(*) AS n FROM nba_shot_events GROUP BY 1 ORDER BY count(*) DESC LIMIT 20`,
  ).catch(() => []);
  if (nbaTypes.length) log(`\nNBA shot_zone: ${nbaTypes.map((t) => `${t.k}=${t.n}`).join(' ')}`);
  const nhlTypes = await pgAll<{ k: string; n: string }>(
    `SELECT coalesce(shot_type, '(null)') AS k, count(*) AS n FROM nhl_shot_events GROUP BY 1 ORDER BY count(*) DESC LIMIT 20`,
  ).catch(() => []);
  if (nhlTypes.length) log(`NHL shot_type: ${nhlTypes.map((t) => `${t.k}=${t.n}`).join(' ')}`);
  const nhlEvents = await pgAll<{ k: string; n: string }>(
    `SELECT event_type AS k, count(*) AS n FROM nhl_shot_events GROUP BY 1 ORDER BY count(*) DESC LIMIT 20`,
  ).catch(() => []);
  if (nhlEvents.length) log(`NHL event_type: ${nhlEvents.map((t) => `${t.k}=${t.n}`).join(' ')}`);

  // ---- 4. can a page's own athlete id find these rows? ----
  // The G2 subjects, by name through the history, then by that id in the shots.
  for (const [sport, table, names] of [
    ['nba', 'nba_shot_events', ['Luka', 'Jokic', 'Gilgeous', 'Wembanyama']],
    ['nhl', 'nhl_shot_events', ['MacKinnon', 'Matthews', 'Hellebuyck', 'Vasilevskiy']],
  ] as const) {
    log(`\n--- ${sport.toUpperCase()} subjects`);
    for (const name of names) {
      // The history stores no name; `athlete_crosswalk` is where a name lives.
      const rows = await pgAll<{ athlete_id: string; nm: string; games: string; last: string }>(
        `SELECT h.athlete_id::text, max(c.athlete_name) AS nm, count(*) AS games, max(h.game_date)::text AS last
           FROM player_game_history h
           JOIN athlete_crosswalk c ON c.sport = h.sport AND c.athlete_id = h.athlete_id
          WHERE h.sport = ? AND c.athlete_name ILIKE ?
          GROUP BY h.athlete_id ORDER BY count(*) DESC LIMIT 2`,
        [sport, `%${name}%`],
      );
      for (const r of rows) {
        const [s] = await pgAll<{ shots: string; placed: string; seasons: string }>(
          `SELECT count(*) AS shots, count(*) FILTER (WHERE x_coord IS NOT NULL) AS placed,
                  string_agg(DISTINCT season::text, ',' ORDER BY season::text) AS seasons
             FROM ${table} WHERE shooter_id = ?`,
          [Number(r.athlete_id)],
        );
        log(`    ${r.nm} id=${r.athlete_id}: ${r.games} history games (last ${r.last}) · shots ${s?.shots ?? 0} (placed ${s?.placed ?? 0}, seasons ${s?.seasons ?? '-'})`);
      }
    }
  }

  // ---- 4b. where a name for these ids actually comes from ----
  for (const sport of ['nba', 'nhl']) {
    const [c] = await pgAll<{ n: string; named: string }>(
      `SELECT count(*) AS n, count(*) FILTER (WHERE athlete_name IS NOT NULL) AS named FROM athlete_crosswalk WHERE sport = ?`,
      [sport],
    );
    log(`athlete_crosswalk ${sport}: ${c?.n} rows, ${c?.named} named`);
  }
  const sports = await pgAll<{ sport: string; n: string }>(`SELECT sport, count(*) AS n FROM athlete_crosswalk GROUP BY 1 ORDER BY 1`);
  log(`athlete_crosswalk sports: ${sports.map((x) => `${x.sport}=${x.n}`).join(' ')}`);

  // ---- 4c. the coordinate space each chart would draw on ----
  const [nbaBox] = await pgAll<Record<string, string>>(
    `SELECT min(x_coord)::text AS xmin, max(x_coord)::text AS xmax, min(y_coord)::text AS ymin, max(y_coord)::text AS ymax,
            count(*) FILTER (WHERE made) ::text AS made, count(*)::text AS n,
            count(DISTINCT point_value)::text AS pvs
       FROM nba_shot_events WHERE season = 2026`,
  );
  log(`
NBA 2026 coords x ${nbaBox?.xmin}..${nbaBox?.xmax}, y ${nbaBox?.ymin}..${nbaBox?.ymax}; made ${nbaBox?.made}/${nbaBox?.n}; point values ${nbaBox?.pvs}`);
  const nbaShotTypes = await pgAll<{ k: string; n: string; made: string }>(
    `SELECT coalesce(shot_type, '(null)') AS k, count(*) AS n, count(*) FILTER (WHERE made) AS made
       FROM nba_shot_events WHERE season = 2026 GROUP BY 1 ORDER BY count(*) DESC LIMIT 12`,
  );
  log(`NBA shot_type: ${nbaShotTypes.map((t) => `${t.k}=${t.n}/${t.made}`).join(' | ')}`);
  const nbaPv = await pgAll<{ pv: string; n: string; made: string }>(
    `SELECT point_value::text AS pv, count(*) AS n, count(*) FILTER (WHERE made) AS made FROM nba_shot_events WHERE season = 2026 GROUP BY 1 ORDER BY 1`,
  );
  log(`NBA point_value: ${nbaPv.map((t) => `${t.pv}pt n=${t.n} made=${t.made}`).join(' | ')}`);

  // Does y separate the two baskets (a full-court space) or is it already half-court?
  const nbaY = await pgAll<{ half: string; n: string }>(
    `SELECT CASE WHEN y_coord < 0 THEN 'y<0' WHEN y_coord > 50 THEN 'y>50' ELSE 'mid' END AS half, count(*) AS n
       FROM nba_shot_events WHERE season = 2026 GROUP BY 1 ORDER BY 1`,
  );
  log(`NBA y split: ${nbaY.map((t) => `${t.half}=${t.n}`).join(' ')}`);

  const [nhlBox] = await pgAll<Record<string, string>>(
    `SELECT min(x_coord)::text AS xmin, max(x_coord)::text AS xmax, min(y_coord)::text AS ymin, max(y_coord)::text AS ymax,
            count(*)::text AS n,
            count(*) FILTER (WHERE goalie_id IS NOT NULL)::text AS withGoalie
       FROM nhl_shot_events WHERE season = '20252026'`,
  );
  log(`NHL 2025-26 coords x ${nhlBox?.xmin}..${nhlBox?.xmax}, y ${nhlBox?.ymin}..${nhlBox?.ymax}; ${nhlBox?.withgoalie ?? nhlBox?.withGoalie} of ${nhlBox?.n} carry a goalie`);
  const nhlZone = await pgAll<{ z: string; n: string }>(
    `SELECT coalesce(zone_code, '(null)') AS z, count(*) AS n FROM nhl_shot_events WHERE season = '20252026' GROUP BY 1 ORDER BY count(*) DESC`,
  );
  log(`NHL zone_code: ${nhlZone.map((t) => `${t.z}=${t.n}`).join(' ')}`);
  // A goalie's card keys on goalie_id, since a goalie takes no shots.
  const goalies = await pgAll<{ id: string; nm: string; faced: string; goals: string }>(
    `SELECT s.goalie_id::text AS id, max(c.athlete_name) AS nm, count(*) AS faced, count(*) FILTER (WHERE s.event_type = 'goal') AS goals
       FROM nhl_shot_events s LEFT JOIN athlete_crosswalk c ON c.sport = 'nhl' AND c.athlete_id = s.goalie_id::text
      WHERE s.season = '20252026' AND s.goalie_id IS NOT NULL
      GROUP BY s.goalie_id ORDER BY count(*) DESC LIMIT 5`,
  );
  log(`NHL busiest goalies 2025-26: ${goalies.map((g) => `${g.nm ?? g.id}=${g.faced} faced/${g.goals} in`).join(' | ')}`);

  // ---- 4d. NBA subjects, by shot volume, since no NBA name is stored ----
  const nbaTop = await pgAll<{ id: string; n: string; made: string; seasons: string }>(
    `SELECT shooter_id::text AS id, count(*) AS n, count(*) FILTER (WHERE made) AS made,
            string_agg(DISTINCT season::text, ',' ORDER BY season::text) AS seasons
       FROM nba_shot_events GROUP BY shooter_id ORDER BY count(*) DESC LIMIT 6`,
  );
  log(`NBA busiest shooters: ${nbaTop.map((t) => `${t.id}=${t.n}(${t.made} made, ${t.seasons})`).join(' | ')}`);

  // ---- 4e. NBA geometry: where is the hoop, and does the arc prove it? ----
  // A 3-pointer is 23.75 ft from the centre of the rim (22 in the corners). If
  // the assumed hoop is right, 3pt attempts cluster at/above that and 2pt ones
  // below it; if it is wrong, the two overlap.
  for (const hoop of [[25, 5.25], [25, 4], [25, 0]]) {
    const [d] = await pgAll<Record<string, string>>(
      `SELECT round(avg(sqrt(power(x_coord - $1, 2) + power(y_coord - $2, 2))) FILTER (WHERE point_value = 3)::numeric, 1)::text AS three,
              round(avg(sqrt(power(x_coord - $1, 2) + power(y_coord - $2, 2))) FILTER (WHERE point_value = 2)::numeric, 1)::text AS two,
              round(min(sqrt(power(x_coord - $1, 2) + power(y_coord - $2, 2))) FILTER (WHERE point_value = 3)::numeric, 1)::text AS minThree,
              count(*) FILTER (WHERE point_value = 3 AND sqrt(power(x_coord - $1, 2) + power(y_coord - $2, 2)) < 21)::text AS badThree
         FROM nba_shot_events WHERE season = 2026`,
      hoop,
    );
    log(`NBA hoop(${hoop}): mean 3pt dist ${d?.three}, mean 2pt ${d?.two}, closest 3pt ${d?.minthree ?? d?.minThree}, 3pt under 21ft ${d?.badthree ?? d?.badThree}`);
  }
  // Made rate by distance band, the sanity check that a chart will read right.
  const bands = await pgAll<{ band: string; n: string; made: string }>(
    `SELECT width_bucket(sqrt(power(x_coord - 25, 2) + power(y_coord - 5.25, 2)), 0, 30, 6)::text AS band,
            count(*) AS n, count(*) FILTER (WHERE made) AS made
       FROM nba_shot_events WHERE season = 2026 GROUP BY 1 ORDER BY 1`,
  );
  log(`NBA by 5ft band (made%): ${bands.map((b) => `${b.band}:${Math.round((100 * Number(b.made)) / Number(b.n))}%`).join(' ')}`);

  // ---- 5. how many shooters in the table match a history id at all ----
  for (const [sport, table] of [
    ['nba', 'nba_shot_events'],
    ['nhl', 'nhl_shot_events'],
  ] as const) {
    const [j] = await pgAll<{ shooters: string; matched: string }>(
      `SELECT count(*) AS shooters,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM player_game_history h WHERE h.sport = ? AND h.athlete_id = s.shooter_id::text)) AS matched
         FROM (SELECT DISTINCT shooter_id FROM ${table}) s`,
      [sport],
    );
    log(`\n${sport.toUpperCase()} shooters joinable to history ids: ${j?.matched} of ${j?.shooters}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
