/**
 * Shared cooldown tracker for OddsPapi's two fixture-scoped actions
 * ("Check sharp price" and "Line history") — both spend from the same
 * 250/month pool against the same fixture, so they share one cooldown key
 * rather than each getting an independent window that could double the
 * effective spend rate on one game.
 *
 * In-process only (not persisted) — a dev-server restart resetting a
 * 15-minute cooldown early is a minor inconvenience, not a budget risk, and
 * a dedicated table wasn't worth it for a value this short-lived.
 */

const fixtureActionAt = new Map<string, number>();

export function lastFixtureAction(gameId: string): number | null {
  return fixtureActionAt.get(gameId) ?? null;
}

export function markFixtureAction(gameId: string): void {
  fixtureActionAt.set(gameId, Date.now());
}
