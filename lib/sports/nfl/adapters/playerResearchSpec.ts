/**
 * Football research sections, NFL and CFB (R6.1a). Quarterback and receiver
 * columns are G2's (`docs/design/phase-g2/src/sports/football.js`); running
 * back and defender are the same shape over the keys ESPN's box score stores
 * for them. CFB box scores carry no sacks, passer rating or QBR, so those
 * columns are NFL-only — the same split G2 made.
 *
 * `cfb/adapters/playerDetailAdapter.ts` imports this rather than keeping a
 * second copy: the sport differs in which columns exist, not in what they mean.
 */

import type { PlayerBio, PlayerGame } from '@/lib/sports/shared/playerResearchShapes';
import { col, count, games, genericResearchSpec, logCol, one, perGame, ratio, stat, sumOf, total, type Agg, type ResearchSpec } from '@/lib/sports/shared/playerResearch';

type Football = 'nfl' | 'cfb';

const avgOf = (key: string): Agg => (gs) => {
  const vals = gs.map((g) => stat(g, key)).filter((v): v is number => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
};
const maxOf = (key: string): Agg => (gs) => {
  const vals = gs.map((g) => stat(g, key)).filter((v): v is number => v != null);
  return vals.length ? Math.max(...vals) : null;
};

const href = (sport: Football) => (g: PlayerGame) => `/${sport}/game/${encodeURIComponent(g.eventId)}`;

function quarterback(sport: Football): ResearchSpec {
  const nfl = sport === 'nfl';
  const att = total('passing.passingAttempts');
  const cmp = total('passing.completions');
  const yds = total('passing.passingYards');
  return {
    kind: 'quarterback',
    gameHref: href(sport),
    tiles: [
      col('g', 'G', games()),
      col('cmp', 'Cmp', cmp),
      col('att', 'Att', att),
      col('cp', 'Cmp %', ratio(cmp, att, 100), 1, { format: 'percent' }),
      col('y', 'Pass yds', yds),
      col('td', 'Pass TD', total('passing.passingTouchdowns')),
      col('int', 'INT', total('passing.interceptions')),
      col('ya', 'Y / A', ratio(yds, att), 1),
      ...(nfl ? [col('rt', 'QB rating', avgOf('passing.QBRating'), 1, { info: 'Average of game ratings' }), col('sk', 'Sacks', total('passing.sacks'))] : []),
      col('ry', 'Rush yds', total('rushing.rushingYards')),
      col('rtd', 'Rush TD', total('rushing.rushingTouchdowns')),
    ],
    seasonColumns: [
      col('c', 'Cmp', cmp),
      col('a', 'Att', att),
      col('cp', 'Cmp %', ratio(cmp, att, 100), 1),
      col('y', 'Yds', yds),
      col('td', 'TD', total('passing.passingTouchdowns')),
      col('int', 'INT', total('passing.interceptions')),
      col('ya', 'Y/A', ratio(yds, att), 1),
      ...(nfl ? [col('sk', 'Sacks', total('passing.sacks')), col('rt', 'Rating', avgOf('passing.QBRating'), 1), col('qbr', 'QBR', avgOf('passing.adjQBR'), 1)] : []),
      col('ry', 'Rush yds', total('rushing.rushingYards')),
      col('rtd', 'Rush TD', total('rushing.rushingTouchdowns')),
    ],
    splitColumns: [
      col('ypg', 'Pass yds/G', perGame('passing.passingYards'), 1),
      col('cp', 'Cmp %', ratio(cmp, att, 100), 1),
      col('td', 'TD/G', perGame('passing.passingTouchdowns'), 2),
      col('int', 'INT/G', perGame('passing.interceptions'), 2),
      col('ry', 'Rush yds/G', perGame('rushing.rushingYards'), 1),
    ],
    trends: [
      { key: 'y', label: 'Passing yards', decimals: 0, of: one('passing.passingYards') },
      { key: 'td', label: 'Passing TDs', decimals: 0, of: one('passing.passingTouchdowns') },
      { key: 'att', label: 'Attempts', decimals: 0, of: one('passing.passingAttempts') },
      { key: 'cp', label: 'Completion %', decimals: 1, of: (g) => { const a = stat(g, 'passing.passingAttempts'); return a ? (100 * (stat(g, 'passing.completions') ?? 0)) / a : null; } },
      { key: 'ry', label: 'Rushing yards', decimals: 0, of: one('rushing.rushingYards') },
      ...(nfl ? [{ key: 'rt', label: 'QB rating', decimals: 1, of: one('passing.QBRating') }] : []),
    ],
    logColumns: [
      logCol('c', 'Cmp', one('passing.completions')),
      logCol('a', 'Att', one('passing.passingAttempts')),
      logCol('y', 'Yds', one('passing.passingYards')),
      logCol('td', 'TD', one('passing.passingTouchdowns')),
      logCol('int', 'INT', one('passing.interceptions')),
      ...(nfl ? [logCol('sk', 'Sk', one('passing.sacks')), logCol('rt', 'Rate', one('passing.QBRating'), 1)] : []),
      logCol('ry', 'Rush', one('rushing.rushingYards')),
    ],
  };
}

function receiver(sport: Football): ResearchSpec {
  const tg = total('receiving.receivingTargets');
  const rec = total('receiving.receptions');
  const yds = total('receiving.receivingYards');
  return {
    kind: 'receiver',
    gameHref: href(sport),
    tiles: [
      col('g', 'G', games()),
      col('tg', 'Targets', tg),
      col('rec', 'Rec', rec),
      col('yds', 'Yds', yds),
      col('td', 'TD', total('receiving.receivingTouchdowns')),
      col('ypr', 'Yds / rec', ratio(yds, rec), 1),
      col('cp', 'Catch %', ratio(rec, tg, 100), 1, { format: 'percent' }),
      col('ypt', 'Yds / target', ratio(yds, tg), 1),
      col('tpg', 'Targets / G', perGame('receiving.receivingTargets'), 1),
      col('ypg', 'Yds / G', perGame('receiving.receivingYards'), 1),
    ],
    seasonColumns: [
      col('tg', 'Tgt', tg),
      col('rec', 'Rec', rec),
      col('yds', 'Yds', yds),
      col('td', 'TD', total('receiving.receivingTouchdowns')),
      col('ypr', 'Y/R', ratio(yds, rec), 1),
      col('cp', 'Catch %', ratio(rec, tg, 100), 1),
      col('ypt', 'Y/Tgt', ratio(yds, tg), 1),
      col('tpg', 'Tgt/G', perGame('receiving.receivingTargets'), 1),
      col('ypg', 'Yds/G', perGame('receiving.receivingYards'), 1),
      col('long', 'Long', maxOf('receiving.longReception')),
      col('fum', 'Fum lost', total('fumbles.fumblesLost')),
    ],
    splitColumns: [
      col('tpg', 'Tgt/G', perGame('receiving.receivingTargets'), 1),
      col('rpg', 'Rec/G', perGame('receiving.receptions'), 1),
      col('ypg', 'Yds/G', perGame('receiving.receivingYards'), 1),
      col('tdg', 'TD/G', perGame('receiving.receivingTouchdowns'), 2),
      col('cp', 'Catch %', ratio(rec, tg, 100), 1),
    ],
    trends: [
      { key: 'yds', label: 'Receiving yards', decimals: 0, of: one('receiving.receivingYards') },
      { key: 'tg', label: 'Targets', decimals: 0, of: one('receiving.receivingTargets') },
      { key: 'rec', label: 'Receptions', decimals: 0, of: one('receiving.receptions') },
      { key: 'long', label: 'Longest reception', decimals: 0, of: one('receiving.longReception') },
      { key: 'ypr', label: 'Yards per reception', decimals: 1, of: (g) => { const r = stat(g, 'receiving.receptions'); return r ? (stat(g, 'receiving.receivingYards') ?? 0) / r : null; } },
    ],
    logColumns: [
      logCol('tg', 'Tgt', one('receiving.receivingTargets')),
      logCol('rec', 'Rec', one('receiving.receptions')),
      logCol('yds', 'Yds', one('receiving.receivingYards')),
      logCol('td', 'TD', one('receiving.receivingTouchdowns')),
      logCol('long', 'Long', one('receiving.longReception')),
      logCol('ry', 'Rush yds', one('rushing.rushingYards')),
    ],
  };
}

function rusher(sport: Football): ResearchSpec {
  const att = total('rushing.rushingAttempts');
  const ryds = total('rushing.rushingYards');
  const scrimmage: Agg = (gs) => sumOf(gs, (g) => (g.stats['rushing.rushingYards'] == null && g.stats['receiving.receivingYards'] == null ? null : (stat(g, 'rushing.rushingYards') ?? 0) + (stat(g, 'receiving.receivingYards') ?? 0)));
  return {
    kind: 'running back',
    gameHref: href(sport),
    tiles: [
      col('g', 'G', games()),
      col('att', 'Carries', att),
      col('ry', 'Rush yds', ryds),
      col('rtd', 'Rush TD', total('rushing.rushingTouchdowns')),
      col('ypc', 'Yds / carry', ratio(ryds, att), 1),
      col('rec', 'Rec', total('receiving.receptions')),
      col('recy', 'Rec yds', total('receiving.receivingYards')),
      col('sypg', 'Scrimmage yds / G', (gs) => { const s = scrimmage(gs); return s == null || gs.length === 0 ? null : s / gs.length; }, 1),
    ],
    seasonColumns: [
      col('att', 'Car', att),
      col('ry', 'Yds', ryds),
      col('ypc', 'Y/C', ratio(ryds, att), 1),
      col('rtd', 'TD', total('rushing.rushingTouchdowns')),
      col('long', 'Long', maxOf('rushing.longRushing')),
      col('rec', 'Rec', total('receiving.receptions')),
      col('recy', 'Rec yds', total('receiving.receivingYards')),
      col('rectd', 'Rec TD', total('receiving.receivingTouchdowns')),
      col('fum', 'Fum lost', total('fumbles.fumblesLost')),
    ],
    splitColumns: [
      col('cpg', 'Car/G', perGame('rushing.rushingAttempts'), 1),
      col('rypg', 'Rush yds/G', perGame('rushing.rushingYards'), 1),
      col('ypc', 'Y/C', ratio(ryds, att), 1),
      col('recpg', 'Rec/G', perGame('receiving.receptions'), 1),
    ],
    trends: [
      { key: 'ry', label: 'Rushing yards', decimals: 0, of: one('rushing.rushingYards') },
      { key: 'att', label: 'Carries', decimals: 0, of: one('rushing.rushingAttempts') },
      { key: 'rec', label: 'Receptions', decimals: 0, of: one('receiving.receptions') },
      { key: 'recy', label: 'Receiving yards', decimals: 0, of: one('receiving.receivingYards') },
    ],
    logColumns: [
      logCol('att', 'Car', one('rushing.rushingAttempts')),
      logCol('ry', 'Yds', one('rushing.rushingYards')),
      logCol('rtd', 'TD', one('rushing.rushingTouchdowns')),
      logCol('rec', 'Rec', one('receiving.receptions')),
      logCol('recy', 'Rec yds', one('receiving.receivingYards')),
    ],
  };
}

function defender(sport: Football): ResearchSpec {
  return {
    kind: 'defender',
    gameHref: href(sport),
    tiles: [
      col('g', 'G', games()),
      col('tkl', 'Tackles', total('defensive.totalTackles')),
      col('solo', 'Solo', total('defensive.soloTackles')),
      col('sacks', 'Sacks', total('defensive.sacks'), 1),
      col('tfl', 'TFL', total('defensive.tacklesForLoss')),
      col('pd', 'Passes defended', total('defensive.passesDefended')),
      col('qbh', 'QB hits', total('defensive.QBHits')),
    ],
    seasonColumns: [
      col('tkl', 'Tkl', total('defensive.totalTackles')),
      col('solo', 'Solo', total('defensive.soloTackles')),
      col('sacks', 'Sacks', total('defensive.sacks'), 1),
      col('tfl', 'TFL', total('defensive.tacklesForLoss')),
      col('pd', 'PD', total('defensive.passesDefended')),
      col('qbh', 'QB hits', total('defensive.QBHits')),
      col('td', 'TD', total('defensive.defensiveTouchdowns')),
    ],
    splitColumns: [
      col('tkl', 'Tkl/G', perGame('defensive.totalTackles'), 1),
      col('sacks', 'Sacks/G', perGame('defensive.sacks'), 2),
      col('pd', 'PD/G', perGame('defensive.passesDefended'), 2),
    ],
    trends: [
      { key: 'tkl', label: 'Tackles', decimals: 0, of: one('defensive.totalTackles') },
      { key: 'sacks', label: 'Sacks', decimals: 1, of: one('defensive.sacks') },
    ],
    logColumns: [
      logCol('tkl', 'Tkl', one('defensive.totalTackles')),
      logCol('solo', 'Solo', one('defensive.soloTackles')),
      logCol('sacks', 'Sacks', one('defensive.sacks'), 1),
      logCol('tfl', 'TFL', one('defensive.tacklesForLoss')),
      logCol('pd', 'PD', one('defensive.passesDefended')),
    ],
  };
}

const QB = new Set(['QB']);
const RECEIVER = new Set(['WR', 'TE']);
const RUSHER = new Set(['RB', 'FB', 'HB']);

/** By the listed position; without a bio, by which box-score category most of his games carry. */
export function footballResearchSpec(sport: Football, bio: PlayerBio | null, history: readonly PlayerGame[]): ResearchSpec {
  const pos = bio?.positionAbbr?.toUpperCase() ?? '';
  if (QB.has(pos)) return quarterback(sport);
  if (RECEIVER.has(pos)) return receiver(sport);
  if (RUSHER.has(pos)) return rusher(sport);
  const n = (prefix: string, key: string) => count((g) => g.stats[`${prefix}.${key}`] != null)(history) ?? 0;
  const counts: Array<[number, () => ResearchSpec]> = [
    [n('passing', 'passingAttempts'), () => quarterback(sport)],
    [n('receiving', 'receptions'), () => receiver(sport)],
    [n('rushing', 'rushingAttempts'), () => rusher(sport)],
    [n('defensive', 'totalTackles'), () => defender(sport)],
  ];
  counts.sort((a, b) => b[0] - a[0]);
  if (counts[0][0] === 0) return genericResearchSpec(bio?.position?.toLowerCase() ?? 'player', history, href(sport));
  return counts[0][1]();
}
