/**
 * The football team page spec — R7.2, NFL's and CFB's (CFB uses NFL's, as its
 * player page does). Roster columns are G2's `footballRoster` over the ESPN
 * box-score keys in `player_game_history`.
 *
 * CFB's box scores carry no targets, QB hits or sacks taken (measured on Ohio
 * State 2025, every key listed), so those columns are NFL-only rather than a
 * column of zeros.
 */

import type { ResearchColumn } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamResearchSpec, TeamRosterEntry } from '@/lib/sports/shared/teamResearchShapes';

const k = (e: TeamRosterEntry, key: string) => e.stats[key] ?? 0;
const ratio = (a: number, b: number) => (b ? a / b : null);
type Col = ResearchColumn & { value: (e: TeamRosterEntry) => number | null };

export function footballTeamSpec(league: 'nfl' | 'cfb'): TeamResearchSpec {
  const nfl = league === 'nfl';
  const passing: Col[] = [
    { key: 'cmp', label: 'Cmp', decimals: 0, value: (e) => k(e, 'passing.completions') },
    { key: 'att', label: 'Att', decimals: 0, value: (e) => k(e, 'passing.passingAttempts') },
    { key: 'pct', label: 'Cmp%', decimals: 1, value: (e) => ratio(100 * k(e, 'passing.completions'), k(e, 'passing.passingAttempts')) },
    { key: 'yds', label: 'Yds', decimals: 0, value: (e) => k(e, 'passing.passingYards') },
    { key: 'ya', label: 'Y/A', decimals: 1, value: (e) => ratio(k(e, 'passing.passingYards'), k(e, 'passing.passingAttempts')) },
    { key: 'td', label: 'TD', decimals: 0, value: (e) => k(e, 'passing.passingTouchdowns') },
    { key: 'int', label: 'INT', decimals: 0, value: (e) => k(e, 'passing.interceptions') },
    ...(nfl ? [{ key: 'sk', label: 'Sacked', decimals: 0, value: (e: TeamRosterEntry) => k(e, 'passing.sacks') }] : []),
  ];
  const rushing: Col[] = [
    { key: 'att', label: 'Att', decimals: 0, value: (e) => k(e, 'rushing.rushingAttempts') },
    { key: 'yds', label: 'Yds', decimals: 0, value: (e) => k(e, 'rushing.rushingYards') },
    { key: 'ya', label: 'Y/A', decimals: 1, value: (e) => ratio(k(e, 'rushing.rushingYards'), k(e, 'rushing.rushingAttempts')) },
    { key: 'td', label: 'TD', decimals: 0, value: (e) => k(e, 'rushing.rushingTouchdowns') },
    { key: 'ypg', label: 'Yds/G', decimals: 1, value: (e) => ratio(k(e, 'rushing.rushingYards'), e.games) },
  ];
  const receiving: Col[] = [
    ...(nfl ? [{ key: 'tgt', label: 'Tgt', decimals: 0, value: (e: TeamRosterEntry) => k(e, 'receiving.receivingTargets') }] : []),
    { key: 'rec', label: 'Rec', decimals: 0, value: (e) => k(e, 'receiving.receptions') },
    { key: 'yds', label: 'Yds', decimals: 0, value: (e) => k(e, 'receiving.receivingYards') },
    { key: 'ypr', label: 'Y/R', decimals: 1, value: (e) => ratio(k(e, 'receiving.receivingYards'), k(e, 'receiving.receptions')) },
    { key: 'td', label: 'TD', decimals: 0, value: (e) => k(e, 'receiving.receivingTouchdowns') },
    { key: 'ypg', label: 'Yds/G', decimals: 1, value: (e) => ratio(k(e, 'receiving.receivingYards'), e.games) },
  ];
  const defense: Col[] = [
    { key: 'tkl', label: 'Tkl', decimals: 0, value: (e) => k(e, 'defensive.totalTackles') },
    { key: 'solo', label: 'Solo', decimals: 0, value: (e) => k(e, 'defensive.soloTackles') },
    { key: 'tfl', label: 'TFL', decimals: 0, value: (e) => k(e, 'defensive.tacklesForLoss') },
    { key: 'sk', label: 'Sacks', decimals: 1, value: (e) => k(e, 'defensive.sacks') },
    ...(nfl ? [{ key: 'qbh', label: 'QB hits', decimals: 0, value: (e: TeamRosterEntry) => k(e, 'defensive.QBHits') }] : []),
    { key: 'pd', label: 'PD', decimals: 0, value: (e) => k(e, 'defensive.passesDefended') },
    { key: 'int', label: 'INT', decimals: 0, value: (e) => k(e, 'interceptions.interceptions') },
  ];
  return {
    seasonSport: league,
    heroRanks: { scored: 'ppg', allowed: 'papg' },
    record: 'WL',
    unit: { plural: 'Points', short: 'Pts' },
    diffLabel: 'Point differential',
    closeMargin: 8,
    roster: {
      caption: 'Rate stats (QBR, passer rating) are left out: a per-game rate cannot be summed into a season.',
      groups: [
        { key: 'pass', label: 'Passing', include: (e) => k(e, 'passing.passingAttempts') > 0, sortKey: 'yds', columns: passing },
        { key: 'rush', label: 'Rushing', include: (e) => k(e, 'rushing.rushingAttempts') > 0, sortKey: 'yds', columns: rushing },
        { key: 'rec', label: 'Receiving', include: (e) => k(e, 'receiving.receptions') > 0 || k(e, 'receiving.receivingTargets') > 0, sortKey: 'yds', columns: receiving },
        { key: 'def', label: 'Defense', include: (e) => k(e, 'defensive.totalTackles') > 0, sortKey: 'tkl', columns: defense },
      ],
    },
    statCaptions: {
      Offense: 'Passing yards are summed from the passers, before yards lost to sacks.',
      Defense: 'Allowed figures are what opponents’ players produced against this team.',
    },
  };
}
