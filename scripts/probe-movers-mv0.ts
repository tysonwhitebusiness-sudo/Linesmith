/**
 * MV0 — the Movers re-measure (docs/design/movers-and-spotlights-gameplan.md).
 *
 * For every sport's current slate (the snapshot's games and start times):
 *   1. prop and game-line changes split into pre-game vs live;
 *   2. for game lines, how many distinct TOTAL points a single event carries
 *      pre-game (Q6: soccer/tennis mix alternative markets into one row set);
 *   3. the top 10 pre-game consensus movers, to eyeball for a public reason.
 * Read-only. Run: npx tsx scripts/probe-movers-mv0.ts
 */
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const IMPLIED = (col: string) => `(CASE WHEN ${col} > 0 THEN 100.0 / (${col} + 100) ELSE (-${col})::numeric / ((-${col}) + 100) END)`;
const KEYS: Array<[string, string]> = [
  ['mlb', 'mlb:snapshot'],
  ['nfl', 'nfl:snapshot'],
  ['cfb', 'cfb:snapshot'],
  ['epl', 'soccer:snapshot:epl'],
  ['mls', 'soccer:snapshot:mls'],
  ['atp', 'tennis:snapshot:atp'],
  ['wta', 'tennis:snapshot:wta'],
];

async function main() {
  const { pgAll } = await import('../lib/db/pgClient');
  const { readSnapshotCache } = await import('../lib/db/client');
  for (const [label, key] of KEYS) {
    const cached = await readSnapshotCache(key);
    const games = cached ? ((JSON.parse(cached.payload)?.context?.other?.games ?? []) as Array<{ gamePk?: unknown; firstPitch?: string }>) : [];
    const pairs = games.filter((g) => g.gamePk != null && g.firstPitch).map((g) => [String(g.gamePk), g.firstPitch!] as const);
    if (pairs.length === 0) {
      console.log(`\n### ${label}: no games with start times in the snapshot`);
      continue;
    }
    const ids = pairs.map((p) => p[0]);
    const starts = pairs.map((p) => p[1]);
    const values = `SELECT unnest(?::text[]) AS gid, unnest(?::timestamptz[]) AS starts_at`;

    const split = async (table: string, idCol: string, series: string, bound: number) =>
      pgAll<Record<string, unknown>>(
        `WITH s AS (${values}),
         h AS (SELECT ${series}, observed_at, ${IMPLIED('american_odds')} AS p, s.starts_at
               FROM ${table} t JOIN s ON s.gid = t.${idCol}::text
               WHERE observed_at > now() - interval '7 days' AND abs(american_odds) BETWEEN 100 AND ${bound}),
         c AS (SELECT *, lag(p) OVER (PARTITION BY ${series} ORDER BY observed_at) AS prev_p FROM h)
         SELECT (observed_at >= starts_at) AS live, count(*) AS changes,
                round(avg(abs(p - prev_p)) * 100, 2) AS avg_pts,
                round(100.0 * avg(CASE WHEN abs(p - prev_p) > 0.10 THEN 1 ELSE 0 END), 1) AS big_pct
         FROM c WHERE prev_p IS NOT NULL AND abs(p - prev_p) > 0.0001 GROUP BY 1 ORDER BY 1`,
        [ids, starts],
      );

    console.log(`\n### ${label}: ${pairs.length} games in the snapshot`);
    for (const r of await split('prop_odds_history', 'game_id', 'bookmaker, game_id, subject_id, market_key, line, side', 2000))
      console.log(`  props ${r.live ? 'LIVE    ' : 'PRE-GAME'} changes ${r.changes} avgPts ${r.avg_pts} big>10% ${r.big_pct}`);
    for (const r of await split('game_odds_history', 'event_id', 'bookmaker, event_id, market, side, point', 5000))
      console.log(`  lines ${r.live ? 'LIVE    ' : 'PRE-GAME'} changes ${r.changes} avgPts ${r.avg_pts} big>10% ${r.big_pct}`);

    const points = await pgAll<Record<string, unknown>>(
      `WITH s AS (${values})
       SELECT t.event_id, count(DISTINCT t.point) AS points, count(DISTINCT t.bookmaker) AS books
       FROM game_odds_history t JOIN s ON s.gid = t.event_id::text
       WHERE t.market = 'total' AND t.observed_at < s.starts_at AND t.observed_at > now() - interval '7 days'
       GROUP BY 1 ORDER BY 2 DESC LIMIT 3`,
      [ids, starts],
    );
    console.log(`  distinct pre-game TOTAL points per event (top 3):`, points.map((r) => `${r.points} pts/${r.books} books`).join(', ') || 'none');

    // Consensus movers: per prop line and side, median implied at each book's
    // FIRST pre-game quote vs at its LAST pre-game quote, ≥3 books both ends,
    // exchanges and pick'em excluded (D-M1).
    const movers = await pgAll<Record<string, unknown>>(
      `WITH s AS (${values}),
       h AS (SELECT t.game_id, t.subject_id, t.market_key, t.line, t.side, t.bookmaker, t.american_odds, t.observed_at
             FROM prop_odds_history t JOIN s ON s.gid = t.game_id
             WHERE t.observed_at < s.starts_at AND t.observed_at > now() - interval '7 days'
               AND abs(t.american_odds) BETWEEN 100 AND 2000
               AND lower(t.bookmaker) <> ALL(ARRAY['prizepicks','underdog','sleeper','dabble','parlayplay','betr','chalkboard','pick6','prophetx','novig','kalshi','polymarket','smarkets','matchbook'])),
       b AS (SELECT game_id, subject_id, market_key, line, side, bookmaker,
                    ${IMPLIED('(array_agg(american_odds ORDER BY observed_at))[1]')} AS p0,
                    ${IMPLIED('(array_agg(american_odds ORDER BY observed_at DESC))[1]')} AS p1
             FROM h GROUP BY 1, 2, 3, 4, 5, 6),
       k AS (SELECT game_id, subject_id, market_key, line, side, count(*) AS books,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY p0) AS m0,
                    percentile_cont(0.5) WITHIN GROUP (ORDER BY p1) AS m1,
                    sum(CASE WHEN abs(p1 - p0) > 0.005 THEN 1 ELSE 0 END) AS moved
             FROM b GROUP BY 1, 2, 3, 4, 5 HAVING count(*) >= 3)
       SELECT k.*, round(((m1 - m0) * 100)::numeric, 1) AS move_pts,
              (SELECT p.subject_name FROM prop_odds p WHERE p.subject_id = k.subject_id AND p.subject_name IS NOT NULL LIMIT 1) AS name
       FROM k ORDER BY abs(m1 - m0) DESC LIMIT 10`,
      [ids, starts],
    );
    console.log('  top pre-game CONSENSUS prop movers:');
    for (const r of movers) console.log(`    ${String(r.name ?? r.subject_id).padEnd(22)} ${String(r.market_key).padEnd(22)} ${String(r.line).padStart(5)} ${String(r.side).padEnd(5)} move ${String(r.move_pts).padStart(6)} pts  books ${r.books} moved ${r.moved}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
