/**
 * NHL research sections (R6.1a) — G2's skater and goalie columns
 * (`docs/design/phase-g2/src/sports/hoops-hockey.js`) over the NHL api-web keys
 * `player_game_history` stores. Faceoff percentage is stored as a 0-1 share and
 * averaged over games with a faceoff taken, as G2 did.
 */

import type { PlayerBio, PlayerGame } from '@/lib/sports/shared/playerResearchShapes';
import { col, count, games, logCol, one, perGame, ratio, stat, total, type Agg, type ResearchSpec } from '@/lib/sports/shared/playerResearch';

const gameHref = (g: PlayerGame) => `/nhl/game/${encodeURIComponent(g.eventId)}`;

const avgToi: Agg = (gs) => {
  const vals = gs.map((g) => stat(g, 'toiMinutes')).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const faceoffPct: Agg = (gs) => {
  const vals = gs.map((g) => stat(g, 'faceoffWinningPctg')).filter((v): v is number => v != null && v > 0);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return avg <= 1 ? avg * 100 : avg;
};

export const NHL_SKATER_SPEC: ResearchSpec = {
  kind: 'skater',
  restSplits: true,
  gameHref,
  tiles: [
    col('gp', 'GP', games()),
    col('g', 'G', total('goals')),
    col('a', 'A', total('assists')),
    col('pts', 'PTS', total('points')),
    col('sog', 'SOG', total('sog')),
    col('sh', 'SH %', ratio(total('goals'), total('sog'), 100), 1, { format: 'percent' }),
    col('toi', 'TOI / GP', avgToi, 1),
    col('ppg', 'PPG', total('powerPlayGoals'), 0, { info: 'Power-play goals' }),
    col('pm', '+/-', total('plusMinus')),
    col('hits', 'Hits', total('hits')),
    col('blk', 'Blocks', total('blockedShots')),
    col('fo', 'FO %', faceoffPct, 1, { format: 'percent', info: 'Average of games with a faceoff taken' }),
  ],
  seasonColumns: [
    col('g', 'G', total('goals')),
    col('a', 'A', total('assists')),
    col('p', 'P', total('points')),
    col('sog', 'SOG', total('sog')),
    col('sh', 'SH%', ratio(total('goals'), total('sog'), 100), 1),
    col('toi', 'TOI/GP', avgToi, 1),
    col('ppg', 'PPG', total('powerPlayGoals')),
    col('pm', '+/-', total('plusMinus')),
    col('pim', 'PIM', total('pim')),
    col('hit', 'Hits', total('hits')),
    col('blk', 'Blk', total('blockedShots')),
    col('tk', 'TK', total('takeaways')),
    col('gv', 'GV', total('giveaways')),
  ],
  splitColumns: [
    col('p', 'P/GP', perGame('points'), 2),
    col('g', 'G/GP', perGame('goals'), 2),
    col('sog', 'SOG/GP', perGame('sog'), 1),
    col('toi', 'TOI', avgToi, 1),
    col('pm', '+/-', perGame('plusMinus'), 2),
  ],
  trends: [
    { key: 'sog', label: 'Shots on goal', decimals: 0, of: one('sog') },
    { key: 'p', label: 'Points', decimals: 0, of: one('points') },
    { key: 'g', label: 'Goals', decimals: 0, of: one('goals') },
    { key: 'toi', label: 'Time on ice', decimals: 1, of: one('toiMinutes') },
    { key: 'hit', label: 'Hits', decimals: 0, of: one('hits') },
    { key: 'blk', label: 'Blocked shots', decimals: 0, of: one('blockedShots') },
  ],
  logColumns: [
    logCol('g', 'G', one('goals')),
    logCol('a', 'A', one('assists')),
    logCol('sog', 'SOG', one('sog')),
    logCol('toi', 'TOI', one('toiMinutes'), 1),
    logCol('ppg', 'PPG', one('powerPlayGoals')),
    logCol('pm', '+/-', one('plusMinus')),
    logCol('hit', 'Hits', one('hits')),
    logCol('blk', 'Blk', one('blockedShots')),
  ],
};

const svPct: Agg = ratio(total('saves'), total('shotsAgainst'));
const gaa: Agg = ratio(total('goalsAgainst'), total('toiMinutes'), 60);
const shutout = (g: PlayerGame) => stat(g, 'goalsAgainst') === 0 && (stat(g, 'toiMinutes') ?? 0) >= 55;

export const NHL_GOALIE_SPEC: ResearchSpec = {
  kind: 'goalie',
  restSplits: true,
  gameHref,
  tiles: [
    col('gp', 'GP', games()),
    col('svp', 'SV %', svPct, 3, { format: 'rate3' }),
    col('gaa', 'GAA', gaa, 2),
    col('sv', 'Saves', total('saves')),
    col('sa', 'Shots against', total('shotsAgainst')),
    col('ga', 'GA', total('goalsAgainst')),
    col('so', 'Shutouts', count(shutout), 0, { info: 'No goals against in 55+ minutes' }),
    col('qs', 'Quality starts', count((g) => { const sa = stat(g, 'shotsAgainst'); return !!sa && (stat(g, 'saves') ?? 0) / sa >= 0.913; }), 0, { info: 'Save % of .913 or better' }),
    col('sa60', 'SA / 60', ratio(total('shotsAgainst'), total('toiMinutes'), 60), 1),
  ],
  seasonColumns: [
    col('sa', 'SA', total('shotsAgainst')),
    col('sv', 'SV', total('saves')),
    col('ga', 'GA', total('goalsAgainst')),
    col('svp', 'SV%', svPct, 3, { format: 'rate3' }),
    col('gaa', 'GAA', gaa, 2),
    col('so', 'SO', count(shutout)),
    col('evga', 'EV GA', total('evenStrengthGoalsAgainst')),
    col('ppga', 'PP GA', total('powerPlayGoalsAgainst')),
  ],
  splitColumns: [
    col('sa', 'SA/GP', perGame('shotsAgainst'), 1),
    col('svp', 'SV%', svPct, 3, { format: 'rate3' }),
    col('ga', 'GA/GP', perGame('goalsAgainst'), 2),
  ],
  trends: [
    { key: 'svp', label: 'Save %', decimals: 1, of: (g) => { const sa = stat(g, 'shotsAgainst'); return sa ? (100 * (stat(g, 'saves') ?? 0)) / sa : null; } },
    { key: 'sv', label: 'Saves', decimals: 0, of: one('saves') },
    { key: 'sa', label: 'Shots against', decimals: 0, of: one('shotsAgainst') },
    { key: 'ga', label: 'Goals against', decimals: 0, of: one('goalsAgainst') },
  ],
  logColumns: [
    logCol('sa', 'SA', one('shotsAgainst')),
    logCol('sv', 'SV', one('saves')),
    logCol('ga', 'GA', one('goalsAgainst')),
    logCol('svp', 'SV%', (g) => { const sa = stat(g, 'shotsAgainst'); return sa ? (stat(g, 'saves') ?? 0) / sa : null; }, 3, { format: 'rate3' }),
    logCol('toi', 'TOI', one('toiMinutes'), 0),
    logCol('pp', 'PP GA', one('powerPlayGoalsAgainst')),
  ],
};

export function nhlResearchSpec(bio: PlayerBio | null, history: readonly PlayerGame[]): ResearchSpec {
  if (bio?.positionAbbr === 'G') return NHL_GOALIE_SPEC;
  if (bio?.positionAbbr) return NHL_SKATER_SPEC;
  const goalieGames = count((g) => g.stats.isGoalie != null || g.stats.saves != null)(history) ?? 0;
  return goalieGames > history.length / 2 ? NHL_GOALIE_SPEC : NHL_SKATER_SPEC;
}
