/**
 * NBA's X-signal (Phase D of docs/x-signal-remaining-sports-gameplan-
 * 2026-08-27.md) — position-group granularity only (no per-stat split),
 * matching the same granularity Python's generic_matchup_defense.py
 * already uses for NBA. Every dimension for a given player gets the same
 * matchupFavorable value (points, rebounds, assists all read "is this
 * opponent bad at guarding a player at this general position").
 *
 * Real correction to the original gameplan doc: it assumed a candidate's
 * own position lives at `subjectMeta.position`, copying NFL's shape — but
 * lib/sports/nba/adapter.ts's real (non-synthetic) candidate path never
 * puts `position` in subjectMeta, only on the separate SubjectSummary
 * (`snapshot.subjects`, matched by subjectId). Callers here take an
 * already-resolved position string, not a candidate, so they don't need
 * to know which shape it came from.
 */

import { favorableFromRank } from '@/lib/odds/props/matchupFavorable';
import { nbaPositionGroup } from './positionGroup';
import type { NbaTeamDefenseAllowed } from './teamDefenseAllowed';

const RANK_KEY_BY_POSITION_GROUP: Record<string, keyof Pick<NbaTeamDefenseAllowed, 'guardRank' | 'forwardRank' | 'centerRank'>> = {
  Guards: 'guardRank',
  Forwards: 'forwardRank',
  Centers: 'centerRank',
};

export function nbaMatchupFavorableFor(position: string | null | undefined, opponentAbbr: string | undefined, teams: NbaTeamDefenseAllowed[]): boolean | null {
  const group = nbaPositionGroup(position);
  if (!group || !opponentAbbr) return null;
  const defense = teams.find((t) => t.abbr === opponentAbbr);
  if (!defense) return null;
  return favorableFromRank(defense[RANK_KEY_BY_POSITION_GROUP[group]], defense.poolSize);
}
