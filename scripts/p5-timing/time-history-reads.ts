/**
 * P5 amendment A1: time the three real prop-history reads against the old
 * text table and the compact one, on the same data, before the readers switch.
 *
 *   npx tsx --env-file=.env.local scripts/p5-timing/time-history-reads.ts
 *
 * Old = the readers as of 2035a81 (kept beside this script as
 * `oldMarketMoves.ts` and `oldLineHistory.ts`, which read the old table and stop working once it is dropped, and
 * the pre-game SQL inline below); new = the shipped readers. 7 runs each after
 * one warm-up; the medians go in docs/design/odds-build/results/P5-read-timings.md.
 * Gate (A1): new median <= old median x 1.2, or within 20 ms of it.
 *
 * Inputs are picked from live data: the busiest prop key of the last 48 h (the
 * chart), the 12 games with the most prop rows in the last 36 h given a start 6 h
 * ahead (Movers — the same synthetic start for both, so both do identical work),
 * and the busiest game of the retained window with a start at its median
 * observation (the game page's pre-game read).
 */
import { pgAll } from '../../lib/db/pgClient';
import { readLineHistory } from '../../lib/odds/props/lineHistory';
import { readLineHistory as readLineHistoryOld } from './oldLineHistory';
import { readConsensusMovers } from '../../lib/slate/marketMoves';
import { readConsensusMovers as readConsensusMoversOld } from './oldMarketMoves';
import { propLatestAtOrBefore } from '../../lib/db/priceHistory';

const RUNS = 7;

async function time(fn: () => Promise<unknown>): Promise<{ median: number; runs: number[]; size: number }> {
  const warm = await fn();
  const runs: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    runs.push(performance.now() - t0);
  }
  const sorted = [...runs].sort((a, b) => a - b);
  const size = Array.isArray(warm) ? warm.length : (warm as { series?: unknown[] })?.series?.length ?? 0;
  return { median: sorted[Math.floor(RUNS / 2)], runs: runs.map((r) => Math.round(r)), size };
}

async function oldPreGame(gameId: string, startAt: string) {
  return pgAll(
    `SELECT DISTINCT ON (h.provider_id, h.subject_id, h.market_key, h.line, h.side, h.bookmaker)
       h.id, h.provider_id, h.game_id, h.subject_id,
       COALESCE((SELECT p.subject_name FROM prop_odds p WHERE p.game_id = h.game_id AND p.subject_id = h.subject_id LIMIT 1), h.subject_id) AS subject_name,
       h.market_key, h.line, h.side, h.bookmaker, h.american_odds, h.decimal_odds, h.observed_at, h.is_delayed, h.delay_seconds
     FROM prop_odds_history h
     WHERE h.game_id = ? AND h.observed_at <= ?
     ORDER BY h.provider_id, h.subject_id, h.market_key, h.line, h.side, h.bookmaker, h.observed_at DESC`,
    [gameId, startAt],
  );
}

async function main() {
  const [key] = await pgAll<{ game_id: string; subject_id: string; market_key: string; side: string; n: string }>(
    `SELECT game_id, subject_id, market_key, side, count(*) n FROM prop_odds_history
      WHERE observed_at > now() - interval '48 hours' GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC LIMIT 1`,
  );
  const games = await pgAll<{ game_id: string; n: string }>(
    `SELECT game_id, count(*) n FROM prop_odds_history WHERE observed_at > now() - interval '36 hours'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
  );
  const [pre] = await pgAll<{ game_id: string; mid: Date; n: string }>(
    `SELECT game_id, count(*) n, to_timestamp(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM observed_at))) mid
       FROM prop_odds_history GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
  );
  const start = new Date(Date.now() + 6 * 3600_000).toISOString();
  const movers = games.map((g) => ({ id: g.game_id, startsAt: start }));
  const chartQ = { gameId: key.game_id, subjectId: key.subject_id, marketKey: key.market_key, side: key.side, hours: 48 };
  const preAt = new Date(pre.mid).toISOString();

  console.log(`chart key: ${JSON.stringify(key)}`);
  console.log(`movers games: ${games.length} (${games.reduce((s, g) => s + Number(g.n), 0)} rows in 36h)`);
  console.log(`pre-game: ${pre.game_id} (${pre.n} rows) at ${preAt}\n`);

  let pass = true;
  const report = async (name: string, oldFn: () => Promise<unknown>, newFn: () => Promise<unknown>) => {
    const o = await time(oldFn);
    console.log(`${name}\n  old median ${o.median.toFixed(0)} ms ${JSON.stringify(o.runs)} (${o.size} rows)`);
    const n = await time(newFn);
    const ok = n.median <= o.median * 1.2 || n.median - o.median <= 20;
    pass &&= ok;
    console.log(`  new median ${n.median.toFixed(0)} ms ${JSON.stringify(n.runs)} (${n.size} rows)  ${ok ? 'PASS' : 'FAIL'}`);
  };
  await report('price chart (readLineHistory, 48h)', () => readLineHistoryOld(chartQ), () => readLineHistory(chartQ));
  await report('game page pre-game props', () => oldPreGame(pre.game_id, preAt), () => propLatestAtOrBefore(pre.game_id, preAt));
  await report('Movers (readConsensusMovers props, 7d)', () => readConsensusMoversOld('props', movers), () => readConsensusMovers('props', movers));
  console.log(pass ? '\nGATE PASSED' : '\nGATE FAILED');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
