/**
 * R12a Step 0 — does R2's merge rule give a true record over a DEEP window?
 *
 * For each sport-season, reads the whole sport through `readGameResults` (the
 * rule the pages use) and counts games per team. A regular season has a known
 * length, so a team far above it is being double-counted and far below it is
 * missing games. Postseason and exhibitions push a few teams above the length
 * legitimately; the spread says which it is.
 *   npx tsx scripts/measure-deep-history.ts [sport ...]
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

/** Regular-season games per team; a function where the length changed. */
const LENGTH: Record<string, (season: number) => number> = {
  mlb: (s) => (s === 2020 ? 60 : 162),
  nba: (s) => (s === 2019 ? 72 : s === 2020 ? 72 : s === 2011 ? 66 : 82),
  nhl: (s) => (s === 2012 ? 48 : s === 2019 ? 70 : s === 2020 ? 56 : 82),
  nfl: (s) => (s >= 2021 ? 17 : 16),
  cfb: () => 12,
  soccer_epl: () => 38,
  soccer_mls: () => 34,
};

async function main() {
  const { readGameResults } = await import('@/lib/history/gameResults');
  const { seasonDateRange } = await import('@/lib/sports/shared/season');
  const { pgAll } = await import('@/lib/db/pgClient');
  const sports = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(LENGTH);
  for (const sport of sports) {
    const [span] = await pgAll<{ lo: string; hi: string }>(
      `SELECT min(extract(year from game_date))::text AS lo, max(extract(year from game_date))::text AS hi FROM game_result WHERE sport = ?`,
      [sport],
    );
    console.log(`\n=== ${sport}  (median / min / max games per team, vs season length)`);
    for (let season = Number(span.lo); season <= Number(span.hi); season++) {
      const { from, to } = seasonDateRange(sport, season);
      const rows = await readGameResults({ sport, from, to });
      const per = new Map<string, number>();
      for (const r of rows) {
        for (const id of [r.homeTeamId, r.awayTeamId]) if (id) per.set(id, (per.get(id) ?? 0) + 1);
      }
      if (!per.size) continue;
      const counts = [...per.values()].sort((a, b) => a - b);
      const med = counts[Math.floor(counts.length / 2)];
      const len = LENGTH[sport](season);
      const over = counts.filter((c) => c > len + 25).length;
      console.log(
        `  ${season}  teams ${String(per.size).padStart(3)}  games ${String(rows.length).padStart(5)}  median ${String(med).padStart(3)}  min ${String(counts[0]).padStart(3)}  max ${String(counts[counts.length - 1]).padStart(3)}  (length ${len})${over ? `  ${over} teams >25 over` : ''}`,
      );
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
