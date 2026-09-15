/**
 * Tennis research sections, ATP and WTA (R6.1a), over what
 * `player_game_history` stores per match: sets and games won and lost, the
 * result, tiebreaks, and whether it was a major. Serve and return (TennisMyLife)
 * and surface arrive with the tennis sections in R6.4.
 *
 * No venue split: a tennis match has no home side, and the stored `is_home`
 * is only which slot ESPN listed the player in.
 *
 * No majors: `is_major` is 0 on every tennis row (the backfill looks for "grand
 * slam" in names like "Australian Open"; measured 2026-08-30, see
 * `seasonAggregateSpecs.ts`). Tournament level comes from TennisMyLife in R6.4.
 */

import type { PlayerGame } from '@/lib/sports/shared/playerResearchShapes';
import { col, count, games, logCol, one, perGame, ratio, stat, total, type Agg, type ResearchSpec } from '@/lib/sports/shared/playerResearch';

const won = (g: PlayerGame) => g.result === 'W';
const wins: Agg = count(won);
const losses: Agg = count((g) => g.result === 'L');

export function tennisResearchSpec(tour: 'atp' | 'wta'): ResearchSpec {
  return {
    kind: 'player',
    venueSplits: false,
    // Every stat is conditional on the result in tennis, so an "in wins" row only restates the win.
    resultSplits: false,
    gameHref: (g) => `/tennis/${tour}/game/${encodeURIComponent(g.eventId)}`,
    tiles: [
      col('wl', 'Matches', games()),
      col('w', 'Won', wins),
      col('wp', 'Win %', ratio(wins, games(), 100), 0, { format: 'percent' }),
      col('sets', 'Sets won %', ratio(total('sets_won'), (gs) => (total('sets_won')(gs) ?? 0) + (total('sets_lost')(gs) ?? 0), 100), 1, { format: 'percent' }),
      col('gms', 'Games won %', ratio(total('games_won'), (gs) => (total('games_won')(gs) ?? 0) + (total('games_lost')(gs) ?? 0), 100), 1, { format: 'percent' }),
      col('tb', 'TB / match', perGame('tiebreaks_played'), 2, { info: 'Tiebreaks played per match' }),
    ],
    seasonColumns: [
      col('w', 'W', wins),
      col('l', 'L', losses),
      col('wp', 'Win%', ratio(wins, games(), 100), 0),
      col('sw', 'Sets W', total('sets_won')),
      col('sl', 'Sets L', total('sets_lost')),
      col('gw', 'Games W', total('games_won')),
      col('gl', 'Games L', total('games_lost')),
      col('gwp', 'Games won %', ratio(total('games_won'), (gs) => (total('games_won')(gs) ?? 0) + (total('games_lost')(gs) ?? 0), 100), 1),
      col('tb', 'Tiebreaks', total('tiebreaks_played')),
    ],
    splitColumns: [
      col('wp', 'Win %', ratio(wins, games(), 100), 0),
      col('gpm', 'Games won / match', perGame('games_won'), 1),
      col('glm', 'Games lost / match', perGame('games_lost'), 1),
      col('tb', 'Tiebreaks / match', perGame('tiebreaks_played'), 2),
    ],
    trends: [
      { key: 'gw', label: 'Games won', decimals: 0, of: one('games_won') },
      { key: 'gl', label: 'Games lost', decimals: 0, of: one('games_lost') },
      { key: 'sw', label: 'Sets won', decimals: 0, of: one('sets_won') },
      { key: 'tb', label: 'Tiebreaks played', decimals: 0, of: one('tiebreaks_played') },
    ],
    logColumns: [
      logCol('sets', 'Sets', (g) => (g.stats.sets_won == null ? null : `${stat(g, 'sets_won') ?? 0}-${stat(g, 'sets_lost') ?? 0}`)),
      logCol('games', 'Games', (g) => (g.stats.games_won == null ? null : `${stat(g, 'games_won') ?? 0}-${stat(g, 'games_lost') ?? 0}`)),
      logCol('tb', 'Tiebreaks', one('tiebreaks_played')),
    ],
  };
}
