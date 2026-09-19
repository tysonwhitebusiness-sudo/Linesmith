/**
 * The team page's History section — R12b. Pure: turns the `view=history`
 * payload (`teamHistoryShapes.ts`) into a shared `ResearchSection`, drawn by the
 * same card renderer as every other section, so the page learns no sport.
 *
 * WHAT IT SHOWS (operator's answers, 2026-09-19): every COMPLETED season held,
 * the last 10 by default and the rest one switch away; all-time totals in the
 * note; win % by season as a line. The current season is left out: the page's
 * own sections already cover it from the league schedule (R7-C1), and
 * `game_result` lags on it (the Eagles' 2026 read one game of two).
 *
 * THE LIMITS ARE SAID ON THE PAGE, not hidden: NHL records are wins and losses
 * only, because `game_result` does not mark overtime — an overtime or shootout
 * loss is a loss (the Thrashers' 2007-08 reads 34-48, officially 34-40-8).
 */

import { seasonDateRange, seasonLabel } from '@/lib/sports/shared/season';
import type { ResearchCard, ResearchColumn, ResearchSection, ResearchTableRow } from '@/lib/sports/shared/playerResearchShapes';
import type { SeasonRecord, TeamHistory, WinLoss } from './teamHistoryShapes';

/** How each sport reads a record. Soccer counts draws and ranks on points; the others on win %. */
interface Style {
  /** "runs", "points", "goals". */
  unit: string;
  draws: boolean;
  /** Soccer's table is points (3 a win, 1 a draw), not a win percentage. */
  table: 'pct' | 'points';
  note?: string;
}

export const HISTORY_STYLE: Record<string, Style> = {
  mlb: { unit: 'runs', draws: false, table: 'pct' },
  nfl: { unit: 'points', draws: true, table: 'pct' },
  cfb: { unit: 'points', draws: false, table: 'pct' },
  nba: { unit: 'points', draws: false, table: 'pct' },
  nhl: { unit: 'goals', draws: false, table: 'pct', note: 'Wins and losses only: an overtime or shootout loss counts as a loss, because the results held do not mark overtime.' },
  soccer_epl: { unit: 'goals', draws: true, table: 'points' },
  soccer_mls: { unit: 'goals', draws: true, table: 'points' },
};

export const HISTORY_SPORTS = new Set(Object.keys(HISTORY_STYLE));

const DEFAULT_SEASONS = 10;

const games = (r: WinLoss) => r.w + r.l + r.d;
const pct = (r: WinLoss) => (games(r) ? (r.w + r.d / 2) / games(r) : null);
const points = (r: WinLoss) => 3 * r.w + r.d;

export function formatRecord(r: WinLoss, draws: boolean): string {
  // Soccer reads W-D-L; the NFL's rare tie goes last (W-L-T), and only when there is one.
  if (draws && r.d) return `${r.w}-${r.l}-${r.d}`;
  return `${r.w}-${r.l}`;
}

function soccerRecord(r: WinLoss): string {
  return `${r.w}-${r.d}-${r.l}`;
}

/** A season is complete once its own date range has ended. */
function completed(sport: string, season: number, now: Date): boolean {
  try {
    return seasonDateRange(sport, season).to < now.toISOString().slice(0, 10);
  } catch {
    return true;
  }
}

function row(sport: string, style: Style, s: SeasonRecord): ResearchTableRow {
  const g = games(s.regular);
  const rec = style.table === 'points' ? soccerRecord(s.regular) : formatRecord(s.regular, style.draws);
  const values: ResearchTableRow['values'] = {
    rec,
    home: style.table === 'points' ? soccerRecord(s.home) : formatRecord(s.home, style.draws),
    away: style.table === 'points' ? soccerRecord(s.away) : formatRecord(s.away, style.draws),
    pf: g ? s.pointsFor / g : null,
    pa: g ? s.pointsAgainst / g : null,
    diff: g ? (s.pointsFor - s.pointsAgainst) / g : null,
    post: s.post ? formatRecord(s.post, false) : '—',
  };
  if (style.table === 'points') values.pts = points(s.regular);
  else values.pct = pct(s.regular) == null ? null : Number(pct(s.regular)!.toFixed(3));
  const p = pct(s.regular);
  return {
    key: String(s.season),
    label: seasonLabel(sport, s.season),
    values,
    tones: p == null ? undefined : { rec: p > 0.5 ? 'good' : p < 0.5 ? 'bad' : undefined } as ResearchTableRow['tones'],
  };
}

export function teamHistorySection(input: {
  sport: string;
  teamAbbr: string;
  history: TeamHistory | null;
  loading: boolean;
  error: string | null;
  now?: Date;
}): ResearchSection | null {
  const style = HISTORY_STYLE[input.sport];
  if (!style) return null;
  const base = { id: 'history', navLabel: 'History', title: 'History', sub: 'every completed season held · not tied to the season switch' };
  if (input.loading && !input.history) return { ...base, rows: [], state: { kind: 'loading' } };
  if (input.error) return { ...base, rows: [], state: { kind: 'error', message: input.error } };
  const now = input.now ?? new Date();
  const seasons = (input.history?.seasons ?? []).filter((s) => completed(input.sport, s.season, now) && games(s.regular) > 0);
  if (!seasons.length) return { ...base, rows: [], state: { kind: 'empty', title: 'No completed seasons held', reason: `The results held for ${input.teamAbbr} do not cover a completed season yet.` } };

  const unit = style.unit;
  const columns: ResearchColumn[] = [
    { key: 'rec', label: style.table === 'points' ? 'W-D-L' : 'W-L', decimals: 0, text: true },
    style.table === 'points' ? { key: 'pts', label: 'Pts', decimals: 0, bar: true } : { key: 'pct', label: 'Win %', decimals: 3, format: 'rate3', bar: true },
    { key: 'home', label: 'Home', decimals: 0, text: true },
    { key: 'away', label: 'Away', decimals: 0, text: true },
    { key: 'pf', label: `${cap(unit)}/G`, decimals: 1, info: `${cap(unit)} scored per regular-season game.` },
    { key: 'pa', label: 'Allowed/G', decimals: 1, info: `${cap(unit)} allowed per regular-season game.` },
    { key: 'diff', label: 'Diff/G', decimals: 1 },
    // Only where a season had playoff games: the EPL has none, and a column of dashes says nothing.
    ...(seasons.some((x) => x.post) ? [{ key: 'post', label: 'Postseason', decimals: 0, text: true } as ResearchColumn] : []),
  ];
  const rows = seasons.map((s) => row(input.sport, style, s));
  const recent = rows.slice(0, DEFAULT_SEASONS);

  // Totals over the completed seasons shown, not the payload's (which includes the current one).
  const sum = (pick: (s: SeasonRecord) => WinLoss | null) =>
    seasons.reduce((t, s) => {
      const r = pick(s);
      return r ? { w: t.w + r.w, l: t.l + r.l, d: t.d + r.d } : t;
    }, { w: 0, l: 0, d: 0 } as WinLoss);
  const all = sum((s) => s.regular);
  const last10 = recent.length === rows.length ? null : sum((s) => (seasons.indexOf(s) < DEFAULT_SEASONS ? s.regular : null));
  const post = sum((s) => s.post);
  const first = seasons[seasons.length - 1].season;
  const fmt = (r: WinLoss) => (style.table === 'points' ? `${soccerRecord(r)} (${points(r)} pts)` : `${formatRecord(r, style.draws)} (${(pct(r) ?? 0).toFixed(3).replace(/^0/, '')})`);
  const note = [
    `${input.teamAbbr} ${fmt(all)} over ${seasons.length} completed season${seasons.length === 1 ? '' : 's'} since ${seasonLabel(input.sport, first)}`,
    last10 ? `; ${fmt(last10)} over the last ${DEFAULT_SEASONS}` : '',
    games(post) ? `; postseason ${formatRecord(post, false)}` : '',
    '.',
    style.note ? ` ${style.note}` : '',
  ].join('');

  const table: ResearchCard = {
    kind: 'table',
    key: 'history-seasons',
    title: 'Season by season',
    scope: `regular season · newest first`,
    labelHeader: 'Season',
    columns,
    rows: recent,
    fixedOrder: true,
    ...(rows.length > recent.length
      ? { views: [{ key: 'recent', label: `Last ${DEFAULT_SEASONS}`, labelHeader: 'Season', columns, rows: recent }, { key: 'all', label: `All ${rows.length}`, labelHeader: 'Season', columns, rows }] }
      : {}),
    caption: seasons.some((x) => x.post) ? 'Home and away are regular-season records. Postseason games (playoffs, bowls) are counted apart, as leagues count them.' : 'Home and away are league records.',
  };

  const chronological = [...seasons].reverse();
  const values = chronological.map((s) => (style.table === 'points' ? points(s.regular) / Math.max(1, games(s.regular)) : (pct(s.regular) ?? 0) * 100));
  const series: ResearchCard = {
    kind: 'series',
    key: 'history-trend',
    title: style.table === 'points' ? 'Points per game by season' : 'Win % by season',
    scope: `${seasonLabel(input.sport, first)} to ${seasonLabel(input.sport, chronological[chronological.length - 1].season)}`,
    values,
    xLabels: chronological.map((s) => seasonLabel(input.sport, s.season)),
    reference: style.table === 'points' ? undefined : { value: 50, label: '.500' },
    zeroBased: style.table === 'points',
    ...(style.table === 'points' ? {} : { min: 0, max: 100 }),
    decimals: style.table === 'points' ? 2 : 1,
    unit: style.table === 'points' ? ' pts/g' : '%',
    tips: chronological.map((s) => [seasonLabel(input.sport, s.season), style.table === 'points' ? soccerRecord(s.regular) : formatRecord(s.regular, style.draws), s.post ? `Postseason ${formatRecord(s.post, false)}` : 'No postseason']),
  };

  return { ...base, rows: [[series], [table]], state: { kind: 'ready' }, note };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
