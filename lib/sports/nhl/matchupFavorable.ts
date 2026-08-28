/**
 * NHL's X-signal (Phase E of docs/x-signal-remaining-sports-gameplan-
 * 2026-08-27.md) — same position-group-only granularity as NBA, matching
 * Python's own NHL X-signal precedent.
 *
 * Real correction to the original gameplan doc, same class as NBA's own
 * (see nba/matchupFavorable.ts): lib/sports/nhl/adapter.ts's real
 * candidate path never puts `position` in subjectMeta either, only on the
 * separate SubjectSummary — callers here take an already-resolved
 * position string.
 *
 * Goalies (position 'G') stay null on purpose: their own markets
 * (saves/goals-against) measure the goalie's own defense, not offensive
 * output against an opponent's defense — the X-signal question ("is this
 * opponent bad at defending forwards/defensemen") doesn't apply.
 */

import { favorableFromRank } from '@/lib/odds/props/matchupFavorable';
import { isForwardCode } from './positionGroup';
import type { NhlTeamDefenseAllowed } from './teamDefenseAllowed';

export function nhlMatchupFavorableFor(position: string | null | undefined, opponentAbbr: string | undefined, teams: NhlTeamDefenseAllowed[]): boolean | null {
  if (!position || position === 'G' || !opponentAbbr) return null;
  const defense = teams.find((t) => t.abbr === opponentAbbr);
  if (!defense) return null;
  const rankKey = isForwardCode(position) ? 'forwardRank' : 'defenseRank';
  return favorableFromRank(defense[rankKey], defense.poolSize);
}
