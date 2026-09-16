/**
 * What NHL's own `gameState` strings mean — the client-safe half of `nhle.ts`.
 *
 * SPLIT OUT FOR THE REASON `shotProfileShapes.ts` WAS (R6.5). `nhle.ts` value-
 * imports `writeSnapshotCache`, so anything a `'use client'` component reaches
 * must not import from it, or Next bundles `pg` for the browser and every page
 * dies with `Module not found: Can't resolve 'dns'`. That is exactly what
 * happened when the player page's live gate first imported `isNhlGameLive`
 * from `nhle.ts`: `tsc` passed, all 504 tests passed, and the dev server
 * returned 500 on every route. Phase 6 shipped this same bug twice.
 *
 * `nhle.ts` re-exports both functions, so its own callers are unchanged.
 */

/** 'OFF' and 'FINAL' are the league's two spellings of a finished game. */
export function isNhlGameCompleted(gameState: string): boolean {
  return gameState === 'OFF' || gameState === 'FINAL';
}

/** 'CRIT' is a close game inside the last minutes — live, and the feed says so separately. */
export function isNhlGameLive(gameState: string): boolean {
  return gameState === 'LIVE' || gameState === 'CRIT';
}
