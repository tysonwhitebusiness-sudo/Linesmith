/**
 * MLB's team page spec — R7.1. The record shape, units and roster columns the
 * shared `buildTeamResearch` reads. Columns are G2's (`team-sports.js`) over
 * the `bat_*` / `pit_*` game-log keys, with innings carried as OUTS (R2).
 */

import type { TeamResearchSpec, TeamRosterEntry } from '@/lib/sports/shared/teamResearchShapes';

const k = (e: TeamRosterEntry, key: string) => e.stats[key] ?? 0;
const ratio = (a: number, b: number) => (b ? a / b : null);

export const MLB_TEAM_SPEC: TeamResearchSpec = {
  seasonSport: 'mlb',
  record: 'WL',
  unit: { plural: 'Runs', short: 'R' },
  diffLabel: 'Run differential',
  closeMargin: 1,
  roster: {
    caption:
      'OBP here is on-base over plate appearances: sacrifice flies are not stored per game, so it can read a few points below the official figure. Innings are rebuilt from outs.',
    groups: [
      {
        key: 'bat',
        label: 'Hitters',
        include: (e) => k(e, 'bat_plateAppearances') > 0,
        sortKey: 'pa',
        columns: [
          { key: 'pa', label: 'PA', decimals: 0, value: (e) => k(e, 'bat_plateAppearances') },
          { key: 'h', label: 'H', decimals: 0, value: (e) => k(e, 'bat_hits') },
          { key: 'hr', label: 'HR', decimals: 0, value: (e) => k(e, 'bat_homeRuns') },
          { key: 'rbi', label: 'RBI', decimals: 0, value: (e) => k(e, 'bat_rbi') },
          { key: 'r', label: 'R', decimals: 0, value: (e) => k(e, 'bat_runs') },
          { key: 'sb', label: 'SB', decimals: 0, value: (e) => k(e, 'bat_stolenBases') },
          { key: 'bb', label: 'BB', decimals: 0, value: (e) => k(e, 'bat_baseOnBalls') },
          { key: 'so', label: 'K', decimals: 0, value: (e) => k(e, 'bat_strikeOuts') },
          { key: 'avg', label: 'AVG', decimals: 3, format: 'rate3', value: (e) => ratio(k(e, 'bat_hits'), k(e, 'bat_atBats')) },
          {
            key: 'obp',
            label: 'OBP',
            decimals: 3,
            format: 'rate3',
            info: 'On-base over plate appearances; sacrifice flies are not stored.',
            value: (e) => ratio(k(e, 'bat_hits') + k(e, 'bat_baseOnBalls') + k(e, 'bat_hitByPitch'), k(e, 'bat_plateAppearances')),
          },
          { key: 'slg', label: 'SLG', decimals: 3, format: 'rate3', value: (e) => ratio(k(e, 'bat_totalBases'), k(e, 'bat_atBats')) },
        ],
      },
      {
        key: 'pit',
        label: 'Pitchers',
        include: (e) => k(e, 'pit_outs') > 0,
        sortKey: 'ip',
        columns: [
          { key: 'gs', label: 'GS', decimals: 0, value: (e) => k(e, 'pit_gamesStarted') },
          { key: 'ip', label: 'IP', decimals: 0, format: 'ip', value: (e) => k(e, 'pit_outs') },
          { key: 'era', label: 'ERA', decimals: 2, value: (e) => ratio(27 * k(e, 'pit_earnedRuns'), k(e, 'pit_outs')) },
          { key: 'whip', label: 'WHIP', decimals: 2, value: (e) => ratio(3 * (k(e, 'pit_hits') + k(e, 'pit_baseOnBalls')), k(e, 'pit_outs')) },
          { key: 'so', label: 'K', decimals: 0, value: (e) => k(e, 'pit_strikeOuts') },
          { key: 'bb', label: 'BB', decimals: 0, value: (e) => k(e, 'pit_baseOnBalls') },
          { key: 'hr', label: 'HR', decimals: 0, value: (e) => k(e, 'pit_homeRuns') },
          { key: 'k9', label: 'K/9', decimals: 1, value: (e) => ratio(27 * k(e, 'pit_strikeOuts'), k(e, 'pit_outs')) },
        ],
      },
    ],
  },
};
