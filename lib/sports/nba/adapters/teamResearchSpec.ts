/**
 * NBA's team page spec — R7.3. Roster columns are G2's (`team-sports.js`), per
 * game over the box-score keys in `player_game_history`, with plus-minus as
 * the season total.
 */

import type { TeamResearchSpec, TeamRosterEntry } from '@/lib/sports/shared/teamResearchShapes';

const k = (e: TeamRosterEntry, key: string) => e.stats[key] ?? 0;
const per = (e: TeamRosterEntry, key: string) => (e.games ? k(e, key) / e.games : null);
const pct = (e: TeamRosterEntry, made: string, att: string) => (k(e, att) ? (100 * k(e, made)) / k(e, att) : null);

export const NBA_TEAM_SPEC: TeamResearchSpec = {
  seasonSport: 'nba',
  record: 'WL',
  unit: { plural: 'Points', short: 'Pts' },
  diffLabel: 'Point differential',
  closeMargin: 5,
  roster: {
    caption: 'Per game; +/- is the season total.',
    groups: [
      {
        key: 'all',
        label: 'Players',
        include: (e) => e.games > 0,
        sortKey: 'pts',
        columns: [
          { key: 'min', label: 'MIN', decimals: 1, value: (e) => per(e, 'minutes') },
          { key: 'pts', label: 'PTS', decimals: 1, value: (e) => per(e, 'points') },
          { key: 'reb', label: 'REB', decimals: 1, value: (e) => per(e, 'rebounds') },
          { key: 'ast', label: 'AST', decimals: 1, value: (e) => per(e, 'assists') },
          { key: 'tpm', label: '3PM', decimals: 1, value: (e) => per(e, 'threePointFieldGoalsMade') },
          { key: 'fg', label: 'FG%', decimals: 1, value: (e) => pct(e, 'fieldGoalsMade', 'fieldGoalsAttempted') },
          { key: 'tp', label: '3P%', decimals: 1, value: (e) => pct(e, 'threePointFieldGoalsMade', 'threePointFieldGoalsAttempted') },
          { key: 'ft', label: 'FT%', decimals: 1, value: (e) => pct(e, 'freeThrowsMade', 'freeThrowsAttempted') },
          { key: 'stl', label: 'STL', decimals: 1, value: (e) => per(e, 'steals') },
          { key: 'blk', label: 'BLK', decimals: 1, value: (e) => per(e, 'blocks') },
          { key: 'tov', label: 'TOV', decimals: 1, value: (e) => per(e, 'turnovers') },
          { key: 'pm', label: '+/-', decimals: 0, value: (e) => k(e, 'plusMinus') },
        ],
      },
    ],
  },
  statCaptions: { Defense: 'Allowed figures are what opponents’ players produced against this team.' },
};
