/**
 * NHL's team page spec — R7.3. W-L-OTL; roster columns are G2's
 * (`team-sports.js`) over the api-web box-score keys in `player_game_history`.
 * A goalie row carries `isGoalie`, which is how the two tables split.
 */

import type { TeamResearchSpec, TeamRosterEntry } from '@/lib/sports/shared/teamResearchShapes';

const k = (e: TeamRosterEntry, key: string) => e.stats[key] ?? 0;
const isGoalie = (e: TeamRosterEntry) => e.position === 'G' || k(e, 'isGoalie') > 0;

export const NHL_TEAM_SPEC: TeamResearchSpec = {
  seasonSport: 'nhl',
  heroRanks: { scored: 'gfpg', allowed: 'gapg' },
  record: 'WLOTL',
  unit: { plural: 'Goals', short: 'G' },
  diffLabel: 'Goal differential',
  closeMargin: 1,
  roster: {
    caption: 'Goals against average is over the minutes a goalie played.',
    groups: [
      {
        key: 'sk',
        label: 'Skaters',
        include: (e) => !isGoalie(e),
        sortKey: 'pts',
        columns: [
          { key: 'g', label: 'G', decimals: 0, value: (e) => k(e, 'goals') },
          { key: 'a', label: 'A', decimals: 0, value: (e) => k(e, 'assists') },
          { key: 'pts', label: 'P', decimals: 0, value: (e) => k(e, 'points') },
          { key: 'pm', label: '+/-', decimals: 0, value: (e) => k(e, 'plusMinus') },
          { key: 'sog', label: 'SOG', decimals: 0, value: (e) => k(e, 'sog') },
          { key: 'shp', label: 'S%', decimals: 1, value: (e) => (k(e, 'sog') ? (100 * k(e, 'goals')) / k(e, 'sog') : null) },
          { key: 'ppg', label: 'PPG', decimals: 0, value: (e) => k(e, 'powerPlayGoals') },
          { key: 'hits', label: 'Hits', decimals: 0, value: (e) => k(e, 'hits') },
          { key: 'blk', label: 'Blk', decimals: 0, value: (e) => k(e, 'blockedShots') },
          { key: 'toi', label: 'TOI/G', decimals: 1, value: (e) => (e.games ? k(e, 'toiMinutes') / e.games : null) },
        ],
      },
      {
        key: 'g',
        label: 'Goalies',
        include: isGoalie,
        sortKey: 'sa',
        columns: [
          { key: 'sa', label: 'SA', decimals: 0, value: (e) => k(e, 'shotsAgainst') },
          { key: 'sv', label: 'SV', decimals: 0, value: (e) => k(e, 'saves') },
          { key: 'svp', label: 'SV%', decimals: 1, value: (e) => (k(e, 'shotsAgainst') ? (100 * k(e, 'saves')) / k(e, 'shotsAgainst') : null) },
          { key: 'gaa', label: 'GAA', decimals: 2, value: (e) => (k(e, 'toiMinutes') ? (60 * k(e, 'goalsAgainst')) / k(e, 'toiMinutes') : null) },
          { key: 'ppga', label: 'PP GA', decimals: 0, value: (e) => k(e, 'powerPlayGoalsAgainst') },
        ],
      },
    ],
  },
  statCaptions: {
    Offense: 'Hits, blocked shots and penalty minutes are not ranked: none has a better direction.',
    Defense: 'Goals for and against are the standings’ own; the rest are summed from box scores.',
  },
};
