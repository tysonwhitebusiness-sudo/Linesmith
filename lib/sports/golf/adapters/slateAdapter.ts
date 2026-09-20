/**
 * Golf's Slate adapter (S1).
 *
 * GOLF HAS NO GAMES SECTION, and that is a real difference in the data rather
 * than a gap: a tournament is one field of 130-odd players, not a grid of
 * two-sided cards, and its equivalent surface is the leaderboard the schedule
 * page already draws. `games` is left unset, the section hides, and the nav
 * drops it — which is exactly what the shared shape is for.
 *
 * S1 therefore gives golf the chrome, the nav and the Props board. The
 * leaderboard and winner prices are the Games-section equivalent and stay on
 * `GolfScheduleView` until a phase moves them; nothing about golf regressed.
 * Movers is hidden for golf too (§4.8): winner prices are cached, not stored as
 * history, so there is no first observation to measure a move from.
 */

import type { SlateData } from '../../shared/slateShapes';

export function toSlateData(input: { date: string; warnings?: string[] }): SlateData {
  return {
    sport: 'golf',
    date: input.date,
    fetchedAt: new Date().toISOString(),
    games: null,
    warnings: input.warnings ?? [],
  };
}
