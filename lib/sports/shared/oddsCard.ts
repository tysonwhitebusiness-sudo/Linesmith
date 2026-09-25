/**
 * The game page's odds card (odds build P8, O3): one builder every sport's
 * `lines` section calls, so the section's first row is the odds section and no
 * sport repeats the shape. `ResearchCardView` mounts it as `GameOddsSection`.
 */
import type { ResearchCard } from './playerResearchShapes';

export function gameOddsCard(p: { sport: string; gameId: string; home: { abbr: string }; away: { abbr: string } }, final: boolean): ResearchCard {
  return {
    kind: 'odds', key: 'odds', scope: final ? 'game-final' : 'game', sport: p.sport, gameId: p.gameId,
    teams: { home: { abbr: p.home.abbr }, away: { abbr: p.away.abbr } },
  };
}
