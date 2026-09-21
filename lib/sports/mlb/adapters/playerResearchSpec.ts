/**
 * MLB's research sections: which columns a hitter's and a pitcher's page shows
 * (R6.1a). The columns are G2's (`docs/design/phase-g2/src/sports/mlb.js`)
 * over the same `player_game_history` keys (`bat_*`, `pit_*`).
 *
 * Innings are OUTS here (`inningsPitchedToOuts`), summed as integers and
 * printed as whole.thirds by the `ip` format — the R2 rule. Rates that need real
 * innings (ERA, WHIP, K/9) divide outs by three.
 */

import { hitterLine, pitcherLine } from '@/lib/sports/shared/formLine';
import { inningsPitchedToOuts } from '@/lib/sports/mlb/innings';
import type { PlayerBio, PlayerGame } from '@/lib/sports/shared/playerResearchShapes';
import { col, count, games, logCol, one, perGame, ratio, stat, sumOf, total, type Agg, type ResearchSpec } from '@/lib/sports/shared/playerResearch';

const outsOf = (g: PlayerGame): number | null => inningsPitchedToOuts(g.stats.pit_inningsPitched);
const outs: Agg = (gs) => sumOf(gs, outsOf);
const innings: Agg = (gs) => {
  const o = outs(gs);
  return o == null ? null : o / 3;
};

const AB = total('bat_atBats');
const H = total('bat_hits');
const PA = total('bat_plateAppearances');
const onBase: Agg = (gs) => sumOf(gs, (g) => (stat(g, 'bat_hits') ?? 0) + (stat(g, 'bat_baseOnBalls') ?? 0) + (stat(g, 'bat_hitByPitch') ?? 0));
/**
 * The history stores plate appearances but not sacrifice flies, bunts or
 * catcher's interference, so OBP divides by PA rather than AB + BB + HBP + SF.
 * Where a hitter has sacrifices it reads a few points below the official
 * number. G2 used the same formula. Routed in the plan as R6-F4.
 */
const OBP_NOTE = 'On-base over plate appearances: sacrifice flies are not stored per game, so this can read a few points below the official OBP.';
const AVG = ratio(H, AB);
const OBP = ratio(onBase, PA);
const SLG = ratio(total('bat_totalBases'), AB);
const OPS: Agg = (gs) => {
  const o = OBP(gs);
  const s = SLG(gs);
  return o == null || s == null ? null : o + s;
};

/**
 * Each game-log row links to its game (R8.1, R6-F6): `/mlb/game/[gameId]` reads
 * any game by pk since R8.1, not only today's slate (design finding B5). Every
 * MLB `player_game_history.event_id` is a StatsAPI game pk (measured 2026-09-17:
 * 139,121 of 139,121 rows since 2025).
 */
const gameHref = (g: PlayerGame): string | null => (/^\d+$/.test(g.eventId) ? `/mlb/game/${g.eventId}` : null);

export const MLB_HITTER_SPEC: ResearchSpec = {
  kind: 'hitter',
  formLine: hitterLine,
  played: (g) => g.stats.bat_plateAppearances != null,
  restSplits: true,
  gameHref,
  tiles: [
    col('g', 'G', games()),
    col('avg', 'AVG', AVG, 3, { format: 'rate3' }),
    col('obp', 'OBP', OBP, 3, { format: 'rate3', info: OBP_NOTE }),
    col('slg', 'SLG', SLG, 3, { format: 'rate3' }),
    col('ops', 'OPS', OPS, 3, { format: 'rate3', info: OBP_NOTE }),
    col('hr', 'HR', total('bat_homeRuns')),
    col('rbi', 'RBI', total('bat_rbi')),
    col('r', 'R', total('bat_runs')),
    col('sb', 'SB', total('bat_stolenBases')),
    col('kpct', 'K%', ratio(total('bat_strikeOuts'), PA, 100), 1, { format: 'percent', info: 'Strikeouts per plate appearance', leader: 'low' }),
    col('bbpct', 'BB%', ratio(total('bat_baseOnBalls'), PA, 100), 1, { format: 'percent', info: 'Walks per plate appearance' }),
  ],
  seasonColumns: [
    col('pa', 'PA', PA),
    col('ab', 'AB', AB),
    col('h', 'H', H),
    col('d', '2B', total('bat_doubles')),
    col('t', '3B', total('bat_triples')),
    col('hr', 'HR', total('bat_homeRuns')),
    col('r', 'R', total('bat_runs')),
    col('rbi', 'RBI', total('bat_rbi')),
    col('bb', 'BB', total('bat_baseOnBalls')),
    col('k', 'K', total('bat_strikeOuts')),
    col('sb', 'SB', total('bat_stolenBases')),
    col('avg', 'AVG', AVG, 3, { format: 'rate3' }),
    col('obp', 'OBP', OBP, 3, { format: 'rate3' }),
    col('slg', 'SLG', SLG, 3, { format: 'rate3' }),
    col('ops', 'OPS', OPS, 3, { format: 'rate3' }),
  ],
  splitColumns: [
    col('avg', 'AVG', AVG, 3, { format: 'rate3' }),
    col('obp', 'OBP', OBP, 3, { format: 'rate3' }),
    col('slg', 'SLG', SLG, 3, { format: 'rate3' }),
    col('hrg', 'HR/G', perGame('bat_homeRuns'), 2),
    col('kg', 'K/G', perGame('bat_strikeOuts'), 2),
    col('tbg', 'TB/G', perGame('bat_totalBases'), 2),
  ],
  trends: [
    { key: 'h', label: 'Hits', decimals: 0, of: one('bat_hits') },
    { key: 'tb', label: 'Total bases', decimals: 0, of: one('bat_totalBases') },
    { key: 'hr', label: 'Home runs', decimals: 0, of: one('bat_homeRuns') },
    { key: 'k', label: 'Strikeouts', decimals: 0, of: one('bat_strikeOuts') },
    { key: 'bb', label: 'Walks', decimals: 0, of: one('bat_baseOnBalls') },
    { key: 'hrr', label: 'H+R+RBI', decimals: 0, of: (g) => (g.stats.bat_hits == null ? null : (stat(g, 'bat_hits') ?? 0) + (stat(g, 'bat_runs') ?? 0) + (stat(g, 'bat_rbi') ?? 0)) },
  ],
  logColumns: [
    logCol('ab', 'AB', one('bat_atBats')),
    logCol('h', 'H', one('bat_hits')),
    logCol('d', '2B', one('bat_doubles')),
    logCol('hr', 'HR', one('bat_homeRuns')),
    logCol('r', 'R', one('bat_runs')),
    logCol('rbi', 'RBI', one('bat_rbi')),
    logCol('bb', 'BB', one('bat_baseOnBalls')),
    logCol('k', 'K', one('bat_strikeOuts')),
    logCol('sb', 'SB', one('bat_stolenBases')),
    logCol('tb', 'TB', one('bat_totalBases')),
  ],
};

const perNine = (key: string): Agg => ratio(total(key), innings, 9);

export const MLB_PITCHER_SPEC: ResearchSpec = {
  kind: 'pitcher',
  formLine: pitcherLine,
  played: (g) => g.stats.pit_inningsPitched != null,
  restSplits: false,
  gameHref,
  tiles: [
    col('gs', 'GS', total('pit_gamesStarted')),
    col('ip', 'IP', outs, 0, { format: 'ip' }),
    col('era', 'ERA', perNine('pit_earnedRuns'), 2, { leader: 'low' }),
    col('whip', 'WHIP', ratio((gs) => sumOf(gs, (g) => (stat(g, 'pit_hits') ?? 0) + (stat(g, 'pit_baseOnBalls') ?? 0)), innings), 2, { leader: 'low' }),
    col('k', 'K', total('pit_strikeOuts')),
    col('bb', 'BB', total('pit_baseOnBalls'), 0, { leader: 'low' }),
    col('k9', 'K/9', perNine('pit_strikeOuts'), 1),
    col('hr', 'HR', total('pit_homeRuns'), 0, { leader: 'low' }),
    col('ipgs', 'IP/start', ratio(innings, total('pit_gamesStarted')), 1, { info: 'Innings per start, as a decimal' }),
  ],
  seasonColumns: [
    col('gs', 'GS', total('pit_gamesStarted')),
    col('ip', 'IP', outs, 0, { format: 'ip' }),
    col('er', 'ER', total('pit_earnedRuns')),
    col('era', 'ERA', perNine('pit_earnedRuns'), 2),
    col('h', 'H', total('pit_hits')),
    col('bb', 'BB', total('pit_baseOnBalls')),
    col('k', 'K', total('pit_strikeOuts')),
    col('hr', 'HR', total('pit_homeRuns')),
    col('whip', 'WHIP', ratio((gs) => sumOf(gs, (g) => (stat(g, 'pit_hits') ?? 0) + (stat(g, 'pit_baseOnBalls') ?? 0)), innings), 2),
    col('k9', 'K/9', perNine('pit_strikeOuts'), 1),
    col('bb9', 'BB/9', perNine('pit_baseOnBalls'), 1),
  ],
  splitColumns: [
    col('ipg', 'IP/G', (gs) => {
      const i = innings(gs);
      return i == null || gs.length === 0 ? null : i / gs.length;
    }, 1),
    col('era', 'ERA', perNine('pit_earnedRuns'), 2),
    col('kg', 'K/G', perGame('pit_strikeOuts'), 1),
    col('bbg', 'BB/G', perGame('pit_baseOnBalls'), 1),
    col('hg', 'H/G', perGame('pit_hits'), 1),
  ],
  trends: [
    { key: 'k', label: 'Strikeouts', decimals: 0, of: one('pit_strikeOuts') },
    { key: 'outs', label: 'Outs recorded', decimals: 0, of: outsOf },
    { key: 'er', label: 'Earned runs', decimals: 0, of: one('pit_earnedRuns') },
    { key: 'h', label: 'Hits allowed', decimals: 0, of: one('pit_hits') },
    { key: 'bb', label: 'Walks', decimals: 0, of: one('pit_baseOnBalls') },
  ],
  logColumns: [
    logCol('ip', 'IP', outsOf, 0, { format: 'ip' }),
    logCol('h', 'H', one('pit_hits')),
    logCol('er', 'ER', one('pit_earnedRuns')),
    logCol('bb', 'BB', one('pit_baseOnBalls')),
    logCol('k', 'K', one('pit_strikeOuts')),
    logCol('hr', 'HR', one('pit_homeRuns')),
  ],
};

/**
 * A pitcher's page when the league lists him as one, else whichever side of
 * the ball most of his games were. A two-way player (Ohtani, "TWP") opens on
 * the side with more games.
 */
export function mlbResearchSpec(bio: PlayerBio | null, history: readonly PlayerGame[]): ResearchSpec {
  if (bio?.positionAbbr === 'P' || bio?.positionAbbr === 'SP' || bio?.positionAbbr === 'RP') return MLB_PITCHER_SPEC;
  const pitched = count((g) => g.stats.pit_inningsPitched != null)(history) ?? 0;
  const batted = count((g) => g.stats.bat_plateAppearances != null)(history) ?? 0;
  return pitched > batted ? MLB_PITCHER_SPEC : MLB_HITTER_SPEC;
}
