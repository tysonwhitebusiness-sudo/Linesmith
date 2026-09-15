/**
 * R6.1d measurement — how MLB's prop markets resolve under R2's main-line rule,
 * against the fixed board lines the snapshot adapter uses; and which providers
 * file a pitcher's strikeouts or walks under the batter markets (R6-F8).
 *   npx tsx scripts/measure-mlb-main-line.ts
 * One database connection, sequential reads.
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
  const { readPropOddsForGame } = await import('@/lib/db/client');
  const { pickMainLine } = await import('@/lib/odds/props/mainLine');
  const { STAT_MARKET_BY_DIMENSION } = await import('@/lib/sports/mlb/adapter');

  const board = new Map<string, number>(Object.values(STAT_MARKET_BY_DIMENSION).map((d) => [d.dimension, d.line]));
  board.set('hits', 0.5);

  // MLB game pks are six-digit integers; the other sports' ids are not.
  const games = await pgAll<{ game_id: string }>(
    `SELECT DISTINCT game_id FROM prop_odds WHERE fetched_at > now() - interval '10 hours' AND game_id ~ '^[0-9]{6}$'`,
  );
  const tally = new Map<string, { main: number; sameAsBoard: number; alt: number; none: number; yesNo: number; lines: Map<number, number> }>();
  const crossFiled = new Map<string, Set<string>>();
  for (const { game_id } of games) {
    const rows = await readPropOddsForGame(game_id);
    const pitchers = new Set(rows.filter((r) => r.marketKey.startsWith('pitcher-')).map((r) => r.subjectId));
    for (const r of rows) {
      if (pitchers.has(r.subjectId) && ['batter-strikeouts', 'walks', 'hits'].includes(r.marketKey)) {
        const k = `${r.marketKey} ${r.providerId}`;
        crossFiled.set(k, (crossFiled.get(k) ?? new Set()).add(r.subjectId));
      }
    }
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!board.has(r.marketKey)) continue;
      const k = `${r.subjectId}|${r.marketKey}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const [k, g] of groups) {
      const market = k.split('|')[1];
      const t = tally.get(market) ?? { main: 0, sameAsBoard: 0, alt: 0, none: 0, yesNo: 0, lines: new Map() };
      const res = pickMainLine(g, null, { now: Date.now() });
      if (res.kind === 'main') {
        t.main++;
        if (res.line === board.get(market)) t.sameAsBoard++;
        t.lines.set(res.line, (t.lines.get(res.line) ?? 0) + 1);
      } else if (res.kind === 'alternates-only') t.alt++;
      else if (res.kind === 'yes-no') t.yesNo++;
      else t.none++;
      tally.set(market, t);
    }
  }
  console.log(`games ${games.length}`);
  for (const [m, t] of [...tally].sort()) {
    const lines = [...t.lines].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l}:${n}`).join(' ');
    console.log(`${m.padEnd(24)} board ${String(board.get(m)).padEnd(5)} main ${t.main} (=board ${t.sameAsBoard})  alt-only ${t.alt}  yes/no ${t.yesNo}  none ${t.none}  | ${lines}`);
  }
  console.log('pitchers with rows under a batter market (market provider: subjects)');
  for (const [k, v] of [...crossFiled].sort()) console.log(`  ${k}: ${v.size}`);
  process.exit(0);
}
void main();
