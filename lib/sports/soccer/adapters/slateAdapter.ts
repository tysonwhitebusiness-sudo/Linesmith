/**
 * Soccer's Slate adapter — EPL and MLS (S1).
 *
 * The one real difference from every other sport is the THIRD OUTCOME. A draw
 * is not a port artifact and no amount of refactoring collapses it into a
 * two-way moneyline, so `hasDraw` is set and the lines block draws four columns
 * instead of three.
 *
 * The draw PRICE, though, is only in the archive: the live per-book feed
 * carries no draw side (SL-2, measured 2026-09-19). Where it is missing the
 * column simply does not draw — it does not print a dash that reads as "no
 * draw offered".
 *
 * MLS also carries a real caveat: this app's game logs only start 2026-08-15,
 * so a team's form covers 4 or 5 of about 25 games. The route passes that in as
 * a warning rather than the card implying a full season.
 */

import type { SlateGame } from '@/lib/odds/matching';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { buildSlateGames, eloModelRow, type EloPick, type SlateSpec } from '../../shared/buildSlate';
import type { SlateData } from '../../shared/slateShapes';
import { espnLogo, splitMatchup } from '../../shared/slateLogos';

export type SoccerLeague = 'epl' | 'mls';

const ESPN_LEAGUE: Record<SoccerLeague, string> = { epl: 'eng.1', mls: 'usa.1' };

export function soccerSlateSpec(league: SoccerLeague, lines: UnifiedGameLine[], picks: Map<string, EloPick>): SlateSpec {
  const byId = new Map(lines.map((l) => [String(l.eventId), l]));
  return {
    noun: 'matches',
    hasDraw: true,
    // See `SlateSpec.hideLines`. Soccer's rows in `game_odds_book_lines` mix
    // the main market with goal lines and Asian handicaps, and the per-book
    // merge does not record which is which.
    hideLines: true,
    logoUrl: (g, side) => {
      const [away, home] = splitMatchup(g.matchup);
      return espnLogo(ESPN_LEAGUE[league], side === 'home' ? home : away);
    },
    context: (g) => (g.venue ? [g.venue] : []),
    href: (g) => (g.gamePk != null ? `/soccer/${league}/game/${g.gamePk}` : null),
    model: (g) => eloModelRow(g, picks, byId.get(String(g.gamePk ?? '')), splitMatchup(g.matchup)),
  };
}

export function toSlateData(input: {
  league: SoccerLeague;
  date: string;
  games: SlateGame[];
  lines: UnifiedGameLine[];
  picks?: Map<string, EloPick>;
  propCounts?: Map<string, number>;
  warnings?: string[];
}): SlateData {
  const warnings = [
    ...(input.warnings ?? []),
    'Match prices are not shown here yet: the book-line table mixes the main market with goal lines and handicaps, and we would rather show nothing than a number we cannot stand behind.',
  ];
  if (input.league === 'mls') {
    warnings.push('MLS game logs in this app start 2026-08-15, so team form covers only the last few weeks of the season.');
  }
  return {
    sport: `soccer_${input.league}`,
    date: input.date,
    fetchedAt: new Date().toISOString(),
    games: buildSlateGames({
      games: input.games,
      lines: input.lines,
      date: input.date,
      propCounts: input.propCounts,
      spec: soccerSlateSpec(input.league, input.lines, input.picks ?? new Map()),
    }),
    warnings,
  };
}
