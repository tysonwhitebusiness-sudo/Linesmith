/**
 * Shared cache-key convention for the untrimmed candidate history that
 * /api/mlb writes on every rebuild (before trimming — see historyTrim.ts)
 * and /api/mlb/player-gamelog reads on demand. Kept in one place so the two
 * routes can't drift apart on the key format.
 */
export function fullRawCacheKey(date: string): string {
  return `mlb:full-raw:${date}`;
}
