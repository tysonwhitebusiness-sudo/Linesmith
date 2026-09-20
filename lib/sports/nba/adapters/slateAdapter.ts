/**
 * NBA's Slate adapter (S1).
 *
 * Nothing sport-specific beyond the crest and the route: the snapshot carries
 * no probable-starter equivalent, and the NBA's season does not begin until
 * October — so today this renders its real off-season state, which is an empty
 * Games section, not a bug.
 */

import type { SlateGame } from '@/lib/odds/matching';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { buildSlateGames, eloModelRow, type EloPick, type SlateSpec } from '../../shared/buildSlate';
import type { SlateData } from '../../shared/slateShapes';
import { espnLogo, splitMatchup } from '../../shared/slateLogos';

export function nbaSlateSpec(lines: UnifiedGameLine[], picks: Map<string, EloPick>): SlateSpec {
  const byId = new Map(lines.map((l) => [String(l.eventId), l]));
  return {
    noun: 'games',
    logoUrl: (g, side) => {
      const [away, home] = splitMatchup(g.matchup);
      return espnLogo('nba', side === 'home' ? home : away);
    },
    context: (g) => (g.venue ? [g.venue] : []),
    href: (g) => (g.gamePk != null ? `/nba/game/${g.gamePk}` : null),
    model: (g) => eloModelRow(g, picks, byId.get(String(g.gamePk ?? '')), splitMatchup(g.matchup)),
  };
}

export function toSlateData(input: {
  date: string;
  games: SlateGame[];
  lines: UnifiedGameLine[];
  picks?: Map<string, EloPick>;
  propCounts?: Map<string, number>;
  warnings?: string[];
}): SlateData {
  return {
    sport: 'nba',
    date: input.date,
    fetchedAt: new Date().toISOString(),
    games: buildSlateGames({
      games: input.games,
      lines: input.lines,
      date: input.date,
      propCounts: input.propCounts,
      spec: nbaSlateSpec(input.lines, input.picks ?? new Map()),
    }),
    warnings: input.warnings ?? [],
  };
}
