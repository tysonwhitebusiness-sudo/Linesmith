/**
 * Football's Slate adapter — NFL and CFB (S1).
 *
 * One file for both, the same way `footballGameResearch.ts` serves both game
 * pages: the two differ in the ESPN league path and the route prefix, not in
 * what a card says. CFB's poll rank would be a real difference, but the
 * snapshot does not carry one, so neither sport sets it and the card draws no
 * rank rather than an empty slot.
 *
 * THE MODEL ROW IS THE GENERIC ELO, which is a `baseline`. Under M1's display
 * rule that means the pick and no probability, and under D9 it is drawn only
 * where the pick goes AGAINST the market favourite — the Elo picks the
 * favourite on 95-100% of games, so ringing all of them would be a green mark
 * on the favourite almost always.
 */

import type { SlateGame } from '@/lib/odds/matching';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { buildSlateGames, eloModelRow, type EloPick, type SlateSpec } from '../../shared/buildSlate';
import type { SlateData } from '../../shared/slateShapes';
import { espnLogo, splitMatchup } from '../../shared/slateLogos';

export function footballSlateSpec(
  sport: 'nfl' | 'cfb',
  lines: UnifiedGameLine[],
  picks: Map<string, EloPick>,
): SlateSpec {
  const league = sport === 'nfl' ? 'nfl' : 'college-football';
  const byId = new Map(lines.map((l) => [String(l.eventId), l]));
  return {
    noun: 'games',
    logoUrl: (g, side) => {
      const [away, home] = splitMatchup(g.matchup);
      return espnLogo(league, side === 'home' ? home : away);
    },
    context: (g) => (g.venue ? [g.venue] : []),
    href: (g) => (g.gamePk != null ? `/${sport}/game/${g.gamePk}` : null),
    model: (g) => eloModelRow(g, picks, byId.get(String(g.gamePk ?? '')), splitMatchup(g.matchup)),
  };
}

export function toSlateData(input: {
  sport: 'nfl' | 'cfb';
  date: string;
  games: SlateGame[];
  lines: UnifiedGameLine[];
  picks?: Map<string, EloPick>;
  propCounts?: Map<string, number>;
  warnings?: string[];
}): SlateData {
  return {
    sport: input.sport,
    date: input.date,
    fetchedAt: new Date().toISOString(),
    games: buildSlateGames({
      games: input.games,
      lines: input.lines,
      date: input.date,
      propCounts: input.propCounts,
      spec: footballSlateSpec(input.sport, input.lines, input.picks ?? new Map()),
    }),
    warnings: input.warnings ?? [],
  };
}
