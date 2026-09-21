/**
 * MV1 check: run `readConsensusMovers` against the real slates before the card
 * is built on it. Prints timings, row counts and the top rows per window.
 * Read-only. Run: npx tsx scripts/probe-consensus-movers.ts
 */
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

async function main() {
  const { readSnapshotCache } = await import('../lib/db/client');
  const { readConsensusMovers } = await import('../lib/slate/marketMoves');
  for (const key of ['mlb:snapshot', 'nfl:snapshot', 'soccer:snapshot:mls']) {
    const cached = await readSnapshotCache(key);
    const games = cached
      ? ((JSON.parse(cached.payload)?.context?.other?.games ?? []) as Array<{ gamePk?: unknown; firstPitch?: string; matchup?: string }>)
          .filter((g) => g.gamePk != null && g.firstPitch)
          .map((g) => ({ id: String(g.gamePk), startsAt: g.firstPitch!, matchup: g.matchup ?? null }))
      : [];
    console.log(`\n##### ${key}: ${games.length} games, ${games.filter((g) => Date.parse(g.startsAt) > Date.now()).length} upcoming`);
    for (const kind of ['props', 'lines'] as const) {
      const t0 = Date.now();
      const rows = await readConsensusMovers(kind, games);
      console.log(`== ${kind}: ${rows.length} rows in ${Date.now() - t0}ms; steam ${rows.filter((r) => r.steam).length}, split ${rows.filter((r) => r.split).length}`);
      for (const w of ['first', 'h3', 'h1'] as const) {
        const top = [...rows].sort((a, b) => Math.abs(b.moves[w]) - Math.abs(a.moves[w])).slice(0, 5);
        console.log(`   window ${w}:`);
        for (const r of top)
          console.log(
            `     ${String(r.subjectName ?? r.matchup ?? r.gameId).padEnd(24)} ${r.market.padEnd(20)} ${String(r.lineFirst)}→${String(r.line)} ${r.side.padEnd(5)} ${r.priceFirst}→${r.priceNow} move ${r.moves[w].toFixed(1)} books ${r.booksMoved}/${r.booksQuoting} +${r.otherLinesMoved} lines ${r.steam ? 'STEAM' : ''}${r.split ? 'SPLIT' : ''} trend ${r.trend.length}`,
          );
      }
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
