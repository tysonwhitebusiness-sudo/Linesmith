/**
 * Tennis's Slate adapter — ATP and WTA (S1).
 *
 * A tennis card is a MATCH, not a game: two players rather than two teams, no
 * venue chip worth the room, and no spread or total in the shared sense. The
 * shared builder handles all of that without knowing it is tennis — the
 * "teams" are the two players and the markets that have no quotes simply do
 * not draw.
 *
 * ATP has no matches until 2026-09-23, so today its Games section is
 * legitimately empty. That is the real state of the tour, not a failed read.
 */

import type { SlateGame } from '@/lib/odds/matching';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { buildSlateGames, type SlateSpec } from '../../shared/buildSlate';
import type { SlateData } from '../../shared/slateShapes';

export type TennisTour = 'atp' | 'wta';

export function tennisSlateSpec(tour: TennisTour): SlateSpec {
  return {
    noun: 'matches',
    // Same as soccer: the book-line rows mix markets, and a match price we
    // cannot attribute to a market is not a match price. See
    // `SlateSpec.hideLines`.
    hideLines: true,
    // A player has no crest, and the flag the schedule shows is a nationality,
    // not an identity for this row — the shared Avatar's silhouette is the
    // honest fallback.
    href: (g) => (g.gamePk != null ? `/tennis/${tour}/game/${g.gamePk}` : null),
  };
}

export function toSlateData(input: {
  tour: TennisTour;
  date: string;
  games: SlateGame[];
  lines: UnifiedGameLine[];
  propCounts?: Map<string, number>;
  warnings?: string[];
}): SlateData {
  return {
    sport: `tennis_${input.tour}`,
    date: input.date,
    fetchedAt: new Date().toISOString(),
    games: buildSlateGames({
      games: input.games,
      lines: input.lines,
      date: input.date,
      propCounts: input.propCounts,
      spec: tennisSlateSpec(input.tour),
    }),
    warnings: [
      ...(input.warnings ?? []),
      'Match prices are not shown here yet: the book-line table mixes the main market with set and game handicaps.',
    ],
  };
}
