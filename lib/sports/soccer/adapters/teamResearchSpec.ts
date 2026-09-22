/**
 * Soccer's team page spec — R7.4, EPL and MLS. W-D-L throughout; roster
 * columns are G2's (`team-sports.js`) over the ESPN box-score keys in
 * `player_game_history`.
 *
 * `goalsConceded` is a TEAM fact written on every player's row (see
 * `SOCCER_EPL_SEASON_SPEC`), so it is only read for goalkeepers, whose rows are
 * their own matches in goal.
 */

import type { TeamResearchSpec, TeamRosterEntry } from '@/lib/sports/shared/teamResearchShapes';

const k = (e: TeamRosterEntry, key: string) => e.stats[key] ?? 0;
const isKeeper = (e: TeamRosterEntry) => e.position === 'G';

export function soccerTeamSpec(sport: 'soccer_epl' | 'soccer_mls'): TeamResearchSpec {
  return {
    seasonSport: sport,
    heroRanks: { scored: 'gfpm', allowed: 'gapm' },
    record: 'WDL',
    unit: { plural: 'Goals', short: 'G' },
    diffLabel: 'Goal difference',
    closeMargin: 1,
    roster: {
      caption: 'Cards, fouls and offsides are counts, not rankings: none is better or worse on its own.',
      groups: [
        {
          key: 'out',
          label: 'Outfield',
          include: (e) => !isKeeper(e),
          sortKey: 'g',
          columns: [
            { key: 'st', label: 'Starts', decimals: 0, value: (e) => k(e, 'isStarter') },
            { key: 'g', label: 'Goals', decimals: 0, value: (e) => k(e, 'totalGoals') },
            { key: 'a', label: 'Assists', decimals: 0, value: (e) => k(e, 'goalAssists') },
            { key: 'sh', label: 'Shots', decimals: 0, value: (e) => k(e, 'totalShots') },
            { key: 'sot', label: 'On target', decimals: 0, value: (e) => k(e, 'shotsOnTarget') },
            { key: 'conv', label: 'Goals/shot', decimals: 1, format: 'percent', value: (e) => (k(e, 'totalShots') ? (100 * k(e, 'totalGoals')) / k(e, 'totalShots') : null) },
            { key: 'fc', label: 'Fouls', decimals: 0, value: (e) => k(e, 'foulsCommitted') },
            { key: 'fs', label: 'Fouled', decimals: 0, value: (e) => k(e, 'foulsSuffered') },
            { key: 'yc', label: 'YC', decimals: 0, value: (e) => k(e, 'yellowCards') },
            { key: 'rc', label: 'RC', decimals: 0, value: (e) => k(e, 'redCards') },
          ],
        },
        {
          key: 'gk',
          label: 'Goalkeepers',
          include: isKeeper,
          sortKey: 'st',
          columns: [
            { key: 'st', label: 'Starts', decimals: 0, value: (e) => k(e, 'isStarter') },
            { key: 'sv', label: 'Saves', decimals: 0, value: (e) => k(e, 'saves') },
            { key: 'ga', label: 'Conceded', decimals: 0, value: (e) => k(e, 'goalsConceded') },
            {
              key: 'svp',
              label: 'Save %',
              decimals: 1,
              format: 'percent',
              value: (e) => (k(e, 'saves') + k(e, 'goalsConceded') ? (100 * k(e, 'saves')) / (k(e, 'saves') + k(e, 'goalsConceded')) : null),
            },
          ],
        },
      ],
    },
    statCaptions: {
      Attack: 'Goals and points are the standings’ own; shots are summed from box scores. Possession, passing and xG are not held at club level.',
      Defense: 'Allowed figures are what opponents’ players produced against this club.',
    },
  };
}
