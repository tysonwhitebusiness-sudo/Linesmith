/**
 * Whether a game is final — the shared "disable Tier 2 actions" check for
 * both "More books" and "Check sharp price" (update-09 § 3).
 */

import { readSnapshotCache } from '@/lib/db/client';

const SNAPSHOT_CACHE_KEY = 'mlb:snapshot';

export function isGameFinal(gameId: string): boolean {
  const cached = readSnapshotCache(SNAPSHOT_CACHE_KEY);
  if (!cached) return false;
  try {
    const snapshot = JSON.parse(cached.payload) as {
      context?: { other?: { games?: Array<{ gamePk: number | string; state?: string }> } };
    };
    const games = snapshot.context?.other?.games ?? [];
    const game = games.find((g) => String(g.gamePk) === gameId);
    return game ? /final/i.test(game.state ?? '') : false;
  } catch {
    return false;
  }
}
