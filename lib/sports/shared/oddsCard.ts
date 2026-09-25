/**
 * The game page's odds card (odds build P8, O3): one builder every sport's
 * `lines` section calls, so the section's first row is the odds section and no
 * sport repeats the shape. `ResearchCardView` mounts it as `GameOddsSection`,
 * or, for a finished game with its score, `GameFinalOddsSection`.
 */
import type { ResearchCard } from './playerResearchShapes';

export function gameOddsCard(p: { sport: string; gameId: string; start?: string; home: { abbr: string; score?: number | null }; away: { abbr: string; score?: number | null } },
                             final: boolean): ResearchCard {
  const score = final && p.home.score != null && p.away.score != null ? { home: p.home.score, away: p.away.score } : null;
  return {
    kind: 'odds', key: 'odds', scope: final ? 'game-final' : 'game', sport: p.sport, gameId: p.gameId,
    teams: { home: { abbr: p.home.abbr }, away: { abbr: p.away.abbr } },
    ...(p.start ? { start: p.start } : {}),
    ...(score ? { score } : {}),
  };
}
