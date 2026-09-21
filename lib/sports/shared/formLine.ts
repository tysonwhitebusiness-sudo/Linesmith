/**
 * C2.1 — one game's stat line for the hero's form rows ("14 car · 38 yds").
 *
 * One function per kind of player, each named by the spec that uses it. The
 * keys are `player_game_history`'s, the same ones the Specials receipts print
 * from in Python (`slate_rankings.detail_line`); `tests/player-research-hero`
 * holds the two to the same keys. A game that recorded none of a line's stats
 * gets no line rather than a row of zeros. Pure.
 */

import type { PlayerGame } from './playerResearchShapes';
import { stat } from './playerResearch';

type Line = (g: PlayerGame) => string | null;

/** Whole numbers for a line: a game with none of `keys` recorded is null. */
function nums(g: PlayerGame, keys: readonly string[]): number[] | null {
  const vals = keys.map((k) => stat(g, k));
  if (vals.every((v) => v == null)) return null;
  return vals.map((v) => Math.round(v ?? 0));
}

const plus = (n: number, label: string) => (n > 0 ? ` · ${n} ${label}` : '');

export const FORM_LINE_KEYS = {
  rusher: ['rushing.rushingAttempts', 'rushing.rushingYards', 'rushing.rushingTouchdowns'],
  receiver: ['receiving.receptions', 'receiving.receivingYards', 'receiving.receivingTouchdowns'],
  quarterback: ['passing.completions', 'passing.passingAttempts', 'passing.passingYards', 'passing.passingTouchdowns'],
  hitter: ['bat_hits', 'bat_atBats', 'bat_homeRuns', 'bat_rbi'],
  pitcher: ['pit_inningsPitched', 'pit_strikeOuts', 'pit_earnedRuns'],
  skater: ['goals', 'assists', 'sog'],
  nba: ['points', 'rebounds', 'assists'],
  soccer: ['totalGoals', 'goalAssists', 'totalShots'],
  keeper: ['saves', 'goalsConceded'],
  tennis: ['sets_won', 'sets_lost'],
} as const;

export const rusherLine: Line = (g) => {
  const v = nums(g, FORM_LINE_KEYS.rusher);
  return v ? `${v[0]} car · ${v[1]} yds${plus(v[2], 'TD')}` : null;
};

export const receiverLine: Line = (g) => {
  const v = nums(g, FORM_LINE_KEYS.receiver);
  return v ? `${v[0]} rec · ${v[1]} yds${plus(v[2], 'TD')}` : null;
};

export const quarterbackLine: Line = (g) => {
  const v = nums(g, FORM_LINE_KEYS.quarterback);
  return v ? `${v[0]}/${v[1]} · ${v[2]} yds · ${v[3]} TD` : null;
};

export const hitterLine: Line = (g) => {
  const v = nums(g, FORM_LINE_KEYS.hitter);
  return v ? `${v[0]}-${v[1]}${v[2] > 0 ? ` · ${v[2] === 1 ? 'HR' : `${v[2]} HR`}` : ''}${plus(v[3], 'RBI')}` : null;
};

export const pitcherLine: Line = (g) => {
  const ip = stat(g, 'pit_inningsPitched');
  const v = nums(g, FORM_LINE_KEYS.pitcher);
  // Innings print as stored: thirds written as tenths ("6.1").
  return v ? `${ip != null ? ip.toFixed(1) : '0.0'} IP · ${v[1]} K · ${v[2]} ER` : null;
};

export const skaterLine: Line = (g) => {
  const v = nums(g, FORM_LINE_KEYS.skater);
  return v ? `${v[0]}-${v[1]} · ${v[2]} SOG` : null;
};

export const nbaLine: Line = (g) => {
  const v = nums(g, FORM_LINE_KEYS.nba);
  return v ? `${v[0]} PTS · ${v[1]} REB · ${v[2]} AST` : null;
};

export const soccerLine: Line = (g) => {
  const v = nums(g, FORM_LINE_KEYS.soccer);
  return v ? `${v[0]} G · ${v[1]} A · ${v[2]} shots` : null;
};

export const keeperLine: Line = (g) => {
  const v = nums(g, FORM_LINE_KEYS.keeper);
  return v ? `${v[0]} saves · ${v[1]} conceded` : null;
};

export const tennisLine: Line = (g) => {
  const v = nums(g, FORM_LINE_KEYS.tennis);
  return v ? `${v[0]}-${v[1]} sets` : null;
};
