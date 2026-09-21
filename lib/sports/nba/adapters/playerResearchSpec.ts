/**
 * NBA research sections (R6.1a) — G2's guard/big columns
 * (`docs/design/phase-g2/src/sports/hoops-hockey.js`), one spec for every
 * position: the box score is the same for a guard and a center, and which
 * numbers matter is the reader's call, not a position filter's.
 */

import { nbaLine } from '@/lib/sports/shared/formLine';
import type { PlayerGame } from '@/lib/sports/shared/playerResearchShapes';
import { col, games, logCol, one, perGame, ratio, stat, sumOf, total, type Agg, type ResearchSpec } from '@/lib/sports/shared/playerResearch';

const minutesPerGame: Agg = (gs) => {
  const m = total('minutes')(gs);
  return m == null || gs.length === 0 ? null : m / gs.length;
};
const pct = (made: string, att: string): Agg => ratio(total(made), total(att), 100);
/** True shooting: points per shooting possession, FGA + 0.44 FTA. */
const trueShooting: Agg = (gs) => {
  const p = total('points')(gs);
  const shots = sumOf(gs, (g) => (g.stats.fieldGoalsAttempted == null ? null : (stat(g, 'fieldGoalsAttempted') ?? 0) + 0.44 * (stat(g, 'freeThrowsAttempted') ?? 0)));
  return p == null || !shots ? null : (100 * p) / (2 * shots);
};
const per36 = (key: string): Agg => ratio(total(key), total('minutes'), 36);
const madeOf = (made: string, att: string) => (g: PlayerGame) => (g.stats[att] == null ? null : `${stat(g, made) ?? 0}-${stat(g, att) ?? 0}`);

export const NBA_SPEC: ResearchSpec = {
  kind: 'player',
  formLine: nbaLine,
  restSplits: true,
  gameHref: (g) => `/nba/game/${encodeURIComponent(g.eventId)}`,
  tiles: [
    col('g', 'G', games()),
    col('min', 'MIN', minutesPerGame, 1),
    col('pts', 'PTS', perGame('points'), 1),
    col('reb', 'REB', perGame('rebounds'), 1),
    col('ast', 'AST', perGame('assists'), 1),
    col('tpm', '3PM', perGame('threePointFieldGoalsMade'), 1),
    col('fg', 'FG %', pct('fieldGoalsMade', 'fieldGoalsAttempted'), 1, { format: 'percent' }),
    col('tp', '3P %', pct('threePointFieldGoalsMade', 'threePointFieldGoalsAttempted'), 1, { format: 'percent' }),
    col('ft', 'FT %', pct('freeThrowsMade', 'freeThrowsAttempted'), 1, { format: 'percent' }),
    col('ts', 'TS %', trueShooting, 1, { format: 'percent', info: 'True shooting: points per shooting possession (FGA + 0.44 FTA)' }),
    col('stl', 'STL', perGame('steals'), 1),
    col('blk', 'BLK', perGame('blocks'), 1),
    col('tov', 'TOV', perGame('turnovers'), 1, { leader: 'low' }),
    col('pm', '+/-', perGame('plusMinus'), 1),
  ],
  seasonColumns: [
    col('min', 'MIN', minutesPerGame, 1),
    col('pts', 'PTS', perGame('points'), 1),
    col('reb', 'REB', perGame('rebounds'), 1),
    col('ast', 'AST', perGame('assists'), 1),
    col('stl', 'STL', perGame('steals'), 1),
    col('blk', 'BLK', perGame('blocks'), 1),
    col('tov', 'TOV', perGame('turnovers'), 1),
    col('fg', 'FG%', pct('fieldGoalsMade', 'fieldGoalsAttempted'), 1),
    col('tp', '3P%', pct('threePointFieldGoalsMade', 'threePointFieldGoalsAttempted'), 1),
    col('ft', 'FT%', pct('freeThrowsMade', 'freeThrowsAttempted'), 1),
    col('ts', 'TS%', trueShooting, 1),
    col('p36', 'PTS/36', per36('points'), 1),
    col('pm', '+/-', perGame('plusMinus'), 1),
  ],
  splitColumns: [
    col('min', 'MIN', minutesPerGame, 1),
    col('pts', 'PTS', perGame('points'), 1),
    col('reb', 'REB', perGame('rebounds'), 1),
    col('ast', 'AST', perGame('assists'), 1),
    col('ts', 'TS%', trueShooting, 1),
    col('pm', '+/-', perGame('plusMinus'), 1),
  ],
  trends: [
    { key: 'pts', label: 'Points', decimals: 0, of: one('points') },
    { key: 'reb', label: 'Rebounds', decimals: 0, of: one('rebounds') },
    { key: 'ast', label: 'Assists', decimals: 0, of: one('assists') },
    { key: 'min', label: 'Minutes', decimals: 1, of: one('minutes') },
    { key: 'tpm', label: '3-pointers made', decimals: 0, of: one('threePointFieldGoalsMade') },
    { key: 'pra', label: 'Pts+Reb+Ast', decimals: 0, of: (g) => (g.stats.points == null ? null : (stat(g, 'points') ?? 0) + (stat(g, 'rebounds') ?? 0) + (stat(g, 'assists') ?? 0)) },
    { key: 'pm', label: 'Plus-minus', decimals: 0, of: one('plusMinus') },
  ],
  logColumns: [
    logCol('min', 'MIN', one('minutes')),
    logCol('pts', 'PTS', one('points')),
    logCol('reb', 'REB', one('rebounds')),
    logCol('ast', 'AST', one('assists')),
    logCol('fg', 'FG', madeOf('fieldGoalsMade', 'fieldGoalsAttempted')),
    logCol('tp', '3PT', madeOf('threePointFieldGoalsMade', 'threePointFieldGoalsAttempted')),
    logCol('stl', 'STL', one('steals')),
    logCol('blk', 'BLK', one('blocks')),
    logCol('tov', 'TOV', one('turnovers')),
    logCol('pm', '+/-', one('plusMinus')),
  ],
};
