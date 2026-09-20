/**
 * NHL's Slate adapter (S1).
 *
 * SL-4 IS THE ONE THING TO KNOW HERE: `game_odds_history` — and the book-line
 * table beside it — hold NHL API ids, while the snapshot's games are keyed by
 * ESPN's. Nothing matches by id across the two, so this adapter bridges them by
 * the matchup and the start time before the shared builder ever sees a line.
 * Without the bridge every NHL card would draw an empty lines block and look
 * like a data outage rather than a key mismatch.
 */

import type { SlateGame } from '@/lib/odds/matching';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { buildSlateGames, eloModelRow, type EloPick, type SlateSpec } from '../../shared/buildSlate';
import type { SlateData } from '../../shared/slateShapes';
import { espnLogo, splitMatchup } from '../../shared/slateLogos';

/** Two names, lower-cased and stripped, so "NY Rangers" and "New York Rangers" meet. */
function key(a: string | undefined, b: string | undefined): string {
  const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '').slice(-8);
  return `${norm(a)}|${norm(b)}`;
}

/**
 * Re-key the lines onto the snapshot's own game ids.
 *
 * Matched on the two team names plus the calendar day: a pair of teams plays
 * at most once a day, and the two sources' ids will never agree.
 */
export function bridgeNhlLines(games: SlateGame[], lines: UnifiedGameLine[]): UnifiedGameLine[] {
  const byPair = new Map<string, SlateGame>();
  for (const g of games) {
    const day = (g.firstPitch ?? '').slice(0, 10);
    byPair.set(`${key(g.awayTeamName, g.homeTeamName)}@${day}`, g);
  }
  return lines.map((l) => {
    const day = (l.commenceTime ?? '').slice(0, 10);
    const hit = byPair.get(`${key(l.awayTeam, l.homeTeam)}@${day}`);
    return hit?.gamePk != null ? { ...l, eventId: String(hit.gamePk) } : l;
  });
}

export function nhlSlateSpec(lines: UnifiedGameLine[], picks: Map<string, EloPick>): SlateSpec {
  const byId = new Map(lines.map((l) => [String(l.eventId), l]));
  return {
    noun: 'games',
    logoUrl: (g, side) => {
      const [away, home] = splitMatchup(g.matchup);
      return espnLogo('nhl', side === 'home' ? home : away);
    },
    context: (g) => (g.venue ? [g.venue] : []),
    href: (g) => (g.gamePk != null ? `/nhl/game/${g.gamePk}` : null),
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
  const bridged = bridgeNhlLines(input.games, input.lines);
  return {
    sport: 'nhl',
    date: input.date,
    fetchedAt: new Date().toISOString(),
    games: buildSlateGames({
      games: input.games,
      lines: bridged,
      date: input.date,
      propCounts: input.propCounts,
      spec: nhlSlateSpec(bridged, input.picks ?? new Map()),
    }),
    warnings: input.warnings ?? [],
  };
}
