/**
 * Soccer research sections, EPL and MLS (R6.1a) — G2's outfield and goalkeeper
 * columns (`docs/design/phase-g2/src/sports/soccer-tennis-golf.js`) over ESPN's
 * box-score keys. Expected goals and per-90 rates need minutes, which only
 * Understat carries; those arrive with the soccer sections in R6.3, so nothing
 * here pretends a per-appearance rate is a per-90 one.
 */

import { keeperLine, soccerLine } from '@/lib/sports/shared/formLine';
import type { PlayerBio, PlayerGame } from '@/lib/sports/shared/playerResearchShapes';
import { col, count, logCol, one, perGame, ratio, stat, total, type ResearchSpec } from '@/lib/sports/shared/playerResearch';

const href = (league: 'epl' | 'mls') => (g: PlayerGame) => `/soccer/${league}/game/${encodeURIComponent(g.eventId)}`;

function outfield(league: 'epl' | 'mls'): ResearchSpec {
  return {
    kind: 'outfield player',
    formLine: soccerLine,
    gameHref: href(league),
    tiles: [
      col('app', 'Apps', total('appearances')),
      col('st', 'Starts', total('isStarter')),
      col('g', 'Goals', total('totalGoals')),
      col('a', 'Assists', total('goalAssists')),
      col('sh', 'Shots', total('totalShots')),
      col('sot', 'On target', total('shotsOnTarget')),
      col('sotp', 'On target %', ratio(total('shotsOnTarget'), total('totalShots'), 100), 1, { format: 'percent' }),
      col('conv', 'Conversion %', ratio(total('totalGoals'), total('totalShots'), 100), 1, { format: 'percent', info: 'Goals per shot' }),
    ],
    seasonColumns: [
      col('app', 'Apps', total('appearances')),
      col('st', 'Starts', total('isStarter')),
      col('sub', 'Sub apps', total('subIns')),
      col('g', 'G', total('totalGoals')),
      col('a', 'A', total('goalAssists')),
      col('sh', 'Shots', total('totalShots')),
      col('sot', 'SOT', total('shotsOnTarget')),
      col('sotp', 'SOT%', ratio(total('shotsOnTarget'), total('totalShots'), 100), 1),
      col('conv', 'Conv%', ratio(total('totalGoals'), total('totalShots'), 100), 1),
      col('fc', 'Fouls', total('foulsCommitted')),
      col('fs', 'Fouled', total('foulsSuffered')),
      col('off', 'Offside', total('offsides')),
      col('yc', 'YC', total('yellowCards')),
      col('rc', 'RC', total('redCards')),
    ],
    splitColumns: [
      col('g', 'G/app', perGame('totalGoals'), 2),
      col('sh', 'Shots/app', perGame('totalShots'), 1),
      col('sot', 'SOT/app', perGame('shotsOnTarget'), 1),
      col('a', 'A/app', perGame('goalAssists'), 2),
    ],
    trends: [
      { key: 'sh', label: 'Shots', decimals: 0, of: one('totalShots') },
      { key: 'sot', label: 'Shots on target', decimals: 0, of: one('shotsOnTarget') },
      { key: 'g', label: 'Goals', decimals: 0, of: one('totalGoals') },
      { key: 'a', label: 'Assists', decimals: 0, of: one('goalAssists') },
      { key: 'fc', label: 'Fouls committed', decimals: 0, of: one('foulsCommitted') },
    ],
    logColumns: [
      logCol('st', 'Start', (g) => (stat(g, 'isStarter') == null ? null : stat(g, 'isStarter') ? 'Yes' : 'Sub')),
      logCol('g', 'G', one('totalGoals')),
      logCol('a', 'A', one('goalAssists')),
      logCol('sh', 'Sh', one('totalShots')),
      logCol('sot', 'SOT', one('shotsOnTarget')),
      logCol('fc', 'FC', one('foulsCommitted')),
      logCol('off', 'Off', one('offsides')),
      logCol('yc', 'YC', one('yellowCards')),
    ],
  };
}

function keeper(league: 'epl' | 'mls'): ResearchSpec {
  const saves = total('saves');
  const conceded = total('goalsConceded');
  const savePct = (gs: readonly PlayerGame[]) => {
    const s = saves(gs);
    const c = conceded(gs);
    return s == null || c == null || s + c === 0 ? null : (100 * s) / (s + c);
  };
  const cleanSheet = (g: PlayerGame) => (stat(g, 'appearances') ?? 0) > 0 && stat(g, 'goalsConceded') === 0;
  return {
    kind: 'goalkeeper',
    formLine: keeperLine,
    gameHref: href(league),
    tiles: [
      col('app', 'Apps', total('appearances')),
      col('sv', 'Saves', saves),
      col('ga', 'Goals conceded', conceded, 0, { leader: 'low' }),
      col('svp', 'Save %', savePct, 1, { format: 'percent', info: 'Saves / (saves + goals conceded)' }),
      col('cs', 'Clean sheets', count(cleanSheet)),
      col('svpg', 'Saves / app', perGame('saves'), 1),
      col('gapg', 'GA / app', perGame('goalsConceded'), 2, { leader: 'low' }),
    ],
    seasonColumns: [
      col('app', 'Apps', total('appearances')),
      col('sv', 'Saves', saves),
      col('ga', 'GA', conceded),
      col('svp', 'Save %', savePct, 1),
      col('cs', 'Clean sheets', count(cleanSheet)),
      col('svpg', 'Saves/app', perGame('saves'), 1),
      col('yc', 'YC', total('yellowCards')),
    ],
    splitColumns: [
      col('sv', 'Saves/app', perGame('saves'), 1),
      col('ga', 'GA/app', perGame('goalsConceded'), 2),
      col('svp', 'Save %', savePct, 1),
    ],
    trends: [
      { key: 'sv', label: 'Saves', decimals: 0, of: one('saves') },
      { key: 'ga', label: 'Goals conceded', decimals: 0, of: one('goalsConceded') },
    ],
    logColumns: [
      logCol('sv', 'Saves', one('saves')),
      logCol('ga', 'GA', one('goalsConceded')),
      logCol('yc', 'YC', one('yellowCards')),
    ],
  };
}

export function soccerResearchSpec(league: 'epl' | 'mls', bio: PlayerBio | null, history: readonly PlayerGame[]): ResearchSpec {
  const pos = bio?.positionAbbr?.toUpperCase();
  if (pos === 'G' || pos === 'GK') return keeper(league);
  if (pos) return outfield(league);
  const saveGames = count((g) => (stat(g, 'saves') ?? 0) > 0)(history) ?? 0;
  return saveGames > history.length / 2 ? keeper(league) : outfield(league);
}
