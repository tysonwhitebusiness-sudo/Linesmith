/**
 * Draw-round ordering — split out of `schedule.ts` (which imports
 * `lib/db/client.ts`'s Postgres driver) so that client components needing
 * only this pure function don't pull `pg` into the browser bundle. Confirmed
 * live this was a real build break, not a theoretical one: `TennisScheduleView.tsx`
 * importing `roundOrder` straight from `schedule.ts` failed to compile with
 * "Module not found: Can't resolve 'fs'/'net'/'tls'/'dns'" from `pg`'s own
 * dependency chain. Golf's schedule view never hits this because it only
 * ever does `import type` from its own schedule.ts — this file is what lets
 * tennis's view import a real function instead without the same problem.
 */

/** The real, confirmed-live label set ESPN uses for `round.displayName` — `round.id` does not sort correctly across different draw sizes, so ordering is keyed off these known strings instead. An unrecognized label sorts last (visible, not hidden) rather than crashing. */
const ROUND_ORDER: Record<string, number> = {
  'Qualifying 1st Round': 0,
  'Qualifying 2nd Round': 1,
  'Qualifying 3rd Round': 2,
  'Qualifying Final': 3,
  'Round 1': 10,
  'Round 2': 11,
  'Round 3': 12,
  'Round 4': 13,
  Quarterfinal: 14,
  Semifinal: 15,
  Final: 16,
};

export function roundOrder(displayName: string): number {
  return ROUND_ORDER[displayName] ?? 99;
}
