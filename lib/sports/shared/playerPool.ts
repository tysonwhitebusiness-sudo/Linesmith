/**
 * C2.1 — where a hero tile's rank comes from: the player's position group,
 * one season, from `player_season_production` (the rollup the compare
 * control's peer list already reads, `compareServer.readPeers`).
 *
 * THE TILE RANKS ITSELF, WITH ITS OWN MATH. A tile is a `SpecColumn` whose
 * `of()` aggregates a list of games. The pool holds each player's season
 * TOTALS, not his games, so each pool player is turned into `games` equal
 * games that sum to those totals, and the tile's `of()` runs on that. For any
 * aggregation built from sums (a total, a per-game rate, a ratio of totals)
 * this is exact. For one that is not (a count of games with a TD, a season
 * high) it is wrong — so every tile is checked before it is ranked:
 *
 *   1. every stat key the tile reads is one the pool holds (a Proxy records
 *      the reads) — the rollup keeps a subset: no RBI, no MLB innings;
 *   2. the tile gives the same answer on two different splits of the same
 *      totals (even, and all in the first game) — true of sums, false of
 *      counts and maxima;
 *   3. it reads at least one stat — a games-played tile has no rank.
 *
 * A tile that fails any of them gets no rank and no bar. A wrong rank is
 * worse than none. Pure and client-safe.
 */

import type { PlayerGame, RawStat, ResearchColumn } from './playerResearchShapes';

export interface PoolPlayer {
  athleteId: string;
  games: number;
  /** Season totals, keyed as `player_game_history.stats` is. */
  stats: Record<string, number>;
}

export interface PlayerPool {
  /** The rollup's group: 'RB', 'G', 'FWD', 'hitter', 'all'… */
  group: string;
  /** How a rank line names the pool: "RB", "guards", "hitters". */
  label: string;
  /** Pool players per season, as `player_game_history.season` labels them. */
  seasons: Record<number, PoolPlayer[]>;
}

export interface TileRank {
  rank: number;
  of: number;
  pool: string;
  /** 0-100, 100 = the best in the pool. */
  percentile: number;
}

type Agg = (games: readonly PlayerGame[]) => number | null;

/** Below this share of a full season's games (the pool's 95th percentile), a player is not ranked or ranked against. */
const FLOOR_SHARE = 0.3;
const MIN_GAMES = 3;

function synthetic(stats: Record<string, number>, games: number, split: 'even' | 'first', reads?: Set<string>): PlayerGame[] {
  const n = Math.max(1, games);
  return Array.from({ length: n }, (_, i) => {
    const per: Record<string, RawStat> = {};
    for (const [k, v] of Object.entries(stats)) per[k] = split === 'even' ? v / n : i === 0 ? v : 0;
    const tracked = reads
      ? new Proxy(per, {
          get(t, key) {
            if (typeof key === 'string') reads.add(key);
            return t[key as string];
          },
        })
      : per;
    return {
      eventId: `pool-${i}`,
      date: '2000-01-01',
      season: 0,
      teamId: null,
      opponentId: null,
      isHome: null,
      result: null,
      teamScore: null,
      opponentScore: null,
      opponent: { name: null, abbr: null, logoUrl: null },
      stats: tracked,
    } as unknown as PlayerGame;
  });
}

const close = (a: number | null, b: number | null) =>
  a == null || b == null ? a === b : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Whether a tile's rank can be computed from season totals at all (see the file comment). */
export function rankable(of: Agg, sample: PoolPlayer, poolKeys: ReadonlySet<string>): boolean {
  const reads = new Set<string>();
  const even = of(synthetic(sample.stats, sample.games, 'even', reads));
  if (reads.size === 0) return false;
  for (const k of reads) if (!poolKeys.has(k)) return false;
  const first = of(synthetic(sample.stats, sample.games, 'first'));
  return close(even, first);
}

/** Whether a tile is a rate: the same for twice the games and twice the stats. */
export function volumeFree(of: Agg, sample: PoolPlayer): boolean {
  const doubled = Object.fromEntries(Object.entries(sample.stats).map(([k, v]) => [k, v * 2]));
  return close(of(synthetic(sample.stats, sample.games, 'even')), of(synthetic(doubled, sample.games * 2, 'even')));
}

/** A player's value for a tile, from his season totals. */
export function poolValue(of: Agg, p: PoolPlayer): number | null {
  const v = of(synthetic(p.stats, p.games, 'even'));
  return v != null && Number.isFinite(v) ? v : null;
}

/**
 * Each tile's rank for one player, or undefined where it cannot be ranked
 * honestly. `tiles` are the spec's columns, in order.
 */
export function rankTiles(
  tiles: ReadonlyArray<Pick<ResearchColumn, 'leader'> & { of: Agg }>,
  pool: PlayerPool | null | undefined,
  season: number,
  athleteId: string | null | undefined,
): Array<TileRank | undefined> {
  const players = pool?.seasons[season] ?? [];
  const me = athleteId ? players.find((p) => p.athleteId === String(athleteId)) : undefined;
  if (!pool || !me) return tiles.map(() => undefined);
  // The floor is a share of a TYPICAL full season, not of the single busiest
  // row: MLB's pitcher pool holds position players who pitched once, with 142
  // games each, and 30% of that shut every starter out (found rendering C2).
  const byGames = players.map((p) => p.games).sort((a, b) => a - b);
  const typical = byGames.length ? byGames[Math.floor(0.95 * (byGames.length - 1))] : 0;
  const floor = Math.max(MIN_GAMES, typical * FLOOR_SHARE);
  if (me.games < floor) return tiles.map(() => undefined);
  const ranked = players.filter((p) => p.games >= floor);
  const keys = new Set(ranked.flatMap((p) => Object.keys(p.stats)));

  return tiles.map((t) => {
    if (!rankable(t.of, me, keys)) return undefined;
    // "Fewest" is only a skill when it is a rate. A total walks or home runs
    // allowed is lowest for whoever pitched least, so a starter ranked 273rd
    // in walks (found rendering C2). Such a tile must not change when a
    // player's games and stats both double; a total doubles.
    if (t.leader === 'low' && !volumeFree(t.of, me)) return undefined;
    const mine = poolValue(t.of, me);
    if (mine == null) return undefined;
    const values = ranked.map((p) => poolValue(t.of, p)).filter((v): v is number => v != null);
    if (values.length < 2) return undefined;
    const lowWins = t.leader === 'low';
    const better = values.filter((v) => (lowWins ? v < mine : v > mine)).length;
    const rank = better + 1;
    const of = values.length;
    return { rank, of, pool: pool.label, percentile: Math.round((100 * (of - rank)) / (of - 1)) };
  });
}
