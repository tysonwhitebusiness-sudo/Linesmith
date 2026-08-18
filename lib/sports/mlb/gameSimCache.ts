/**
 * Live per-game simulation cache — the Phase 7 follow-up flagged when the
 * sim engine went live: simWinProb/simOverProb were neutral-imputed at every
 * live call site because running simulateGameForContext needs today's real
 * lineups, which is separate work from the historical backfill. This module
 * is that work.
 *
 * Scheduling deliberately piggybacks on getMlbSnapshot's own ~5-minute
 * rebuild cadence (see app/api/mlb/route.ts's CACHE_TTL_MS) rather than a
 * new clock-based schedule. ensureGameSims is safe to call on every rebuild:
 * it skips any game whose cached row already reflects the REAL posted
 * lineup (nothing left to improve), and only (re)simulates games still on
 * the projected-lineup fallback or with no cache yet. That means
 * gamePickLock.ts's 6am initial capture and 3-hour-before final capture each
 * just read whatever's freshest in the cache at that moment — same as every
 * other live feature (Elo, bullpen ERA) already flowing into those captures,
 * no new scheduling code needed. See docs/mlb-sim-engine-plan.md's own
 * "Scheduling" section, which called this shot before Phase 7 was built.
 */

import { readGameSimCache, writeGameSimCache, type GameSimCacheRow } from '../../db/client';
import { simulateGameForContext, type SimGameContext } from './simGame';

/**
 * Live sim count — the plan's finalized target for game-level markets
 * (moneyline/total): SE on a ~50% probability is already ~1.1% at N=2,000,
 * so 10,000 (simGame.ts's old default, used only for the Phase 8 perf
 * ceiling check) bought no real precision. 4,000 is the top of the
 * recommended 2,000-4,000 range, kept for a little extra headroom since
 * Phase 8 measured plenty of throughput to spare.
 */
export const LIVE_SIM_N = 4000;

export interface GameSimInput {
  gamePk: number;
  season: number;
  status: 'pre' | 'live' | 'done' | 'unknown';
  homeLineup: number[];
  awayLineup: number[];
  homeLineupProjected: boolean;
  awayLineupProjected: boolean;
  homeStarterId?: number;
  awayStarterId?: number;
  homeTeamId: number;
  awayTeamId: number;
  venueId?: number;
}

/** Cheap synchronous read for the live prediction path — never runs a simulation itself. Null (not a thrown error) whenever nothing's cached yet, so callers fall back to their existing neutral impute. */
export function loadGameSim(gamePk: number | string): GameSimCacheRow | null {
  return readGameSimCache('mlb', String(gamePk));
}

/**
 * Ensures every pre-game matchup with a resolvable lineup and starter on
 * both sides has a live simulation cached, upgrading a projected-lineup
 * result to a posted-lineup one as real lineups firm up over the day. Games
 * already live/done, or missing a full lineup/starter on either side (most
 * teams before their own recent-lineup history exists, or before MLB posts
 * probable starters), are left alone — the caller's neutral impute covers
 * those, same as before this cache existed.
 *
 * Runs sequentially, not in parallel: the simulation itself is CPU-bound
 * synchronous work, so Promise.all across games wouldn't actually overlap
 * the expensive part on Node's single thread — it would just make N
 * concurrent MLB API fetches for no speed benefit.
 */
export async function ensureGameSims(inputs: GameSimInput[]): Promise<void> {
  for (const g of inputs) {
    if (g.status !== 'pre') continue;
    if (g.homeLineup.length < 9 || g.awayLineup.length < 9 || !g.homeStarterId || !g.awayStarterId) continue;

    const lineupSource: 'posted' | 'projected' = g.homeLineupProjected || g.awayLineupProjected ? 'projected' : 'posted';
    const existing = loadGameSim(g.gamePk);
    // Nothing left to improve once we have a posted-lineup row. And a
    // projected row is never worth replacing with ANOTHER projected row —
    // the projected lineup/starter don't change between rebuilds, so
    // re-simulating would just burn ~4,000 sims for fresh Monte Carlo noise
    // on identical inputs. Only re-simulate on a genuine upgrade: no cache
    // yet, or existing is projected and we can now do posted.
    if (existing && (existing.lineupSource === 'posted' || lineupSource === 'projected')) continue;

    try {
      const context: SimGameContext = {
        season: g.season,
        homeLineupIds: g.homeLineup.slice(0, 9),
        awayLineupIds: g.awayLineup.slice(0, 9),
        homeStarterId: g.homeStarterId,
        awayStarterId: g.awayStarterId,
        homeTeamId: g.homeTeamId,
        awayTeamId: g.awayTeamId,
        venueId: g.venueId ?? null,
      };
      const result = await simulateGameForContext(context, LIVE_SIM_N);
      writeGameSimCache({
        sport: 'mlb',
        gameId: String(g.gamePk),
        homeWinProb: result.homeWinProb,
        expectedTotal: result.expectedTotal,
        n: LIVE_SIM_N,
        lineupSource,
        computedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[gameSimCache] simulation failed for game ${g.gamePk}`, error);
    }
  }
}
