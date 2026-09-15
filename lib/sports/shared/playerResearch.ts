/**
 * The shared research sections of the player page — R6.1a.
 *
 * One builder for every sport. A sport contributes a `ResearchSpec` (which
 * columns, tiles, trend stats and log columns make sense for that player) from
 * its own `lib/sports/{sport}/adapters/` file; everything else — scoping the
 * hero to the right season, grouping seasons, rolling the splits, ordering the
 * log — happens here, once. The G2 kit (`docs/design/phase-g2/src/kit2.js`:
 * `seasonTable`, `trendCard`, `standardSplits`, `gameLog`) is the behavioural
 * spec; the numbers are checked against the G2 datasets, which were built from
 * the same `player_game_history` rows.
 *
 * Two deliberate differences from G2, both R2 rules:
 *   - the hero opens on the season `seasonScope()` picks (per-sport minimum
 *     games) rather than G2's flat "fewer than 8 games";
 *   - MLB innings are summed as outs and printed as whole.thirds ("187.1"),
 *     where G2 printed outs / 3 to one decimal ("187.3").
 *
 * Pure and client-safe.
 */

import type {
  HistorySport,
  PlayerGame,
  PlayerHistory,
  PlayerResearchData,
  RawStat,
  ResearchColumn,
  ResearchLogRow,
  ResearchSplitRow,
} from './playerResearchShapes';
import { formatResearchValue } from './playerResearchShapes';
import { seasonForDate, seasonLabel, seasonScope } from './season';

export type Agg = (games: readonly PlayerGame[]) => number | null;

export interface SpecColumn extends ResearchColumn {
  of: Agg;
}

export interface SpecLogColumn extends ResearchColumn {
  of: (game: PlayerGame) => number | string | null;
}

export interface SpecTrend {
  key: string;
  label: string;
  decimals: number;
  of: (game: PlayerGame) => number | null;
}

export interface ResearchSpec {
  kind: string;
  /** Which history rows are this kind's games (an MLB pitcher's rows carry `pit_` keys). Default: every row. */
  played?: (game: PlayerGame) => boolean;
  tiles: SpecColumn[];
  seasonColumns: SpecColumn[];
  splitColumns: SpecColumn[];
  trends: SpecTrend[];
  logColumns: SpecLogColumn[];
  /** Back-to-back and rest splits, for sports that play on consecutive days. */
  restSplits?: boolean;
  /** Home/away rows. Off where the stored home flag is only a listing slot (tennis). Default on. */
  venueSplits?: boolean;
  /** In wins / in losses rows. Default on. */
  resultSplits?: boolean;
  /** Where a game log row links. `null` when the sport has no game page for that id. */
  gameHref?: (game: PlayerGame) => string | null;
}

// ---------------------------------------------------------------------------
// Stat helpers every spec uses
// ---------------------------------------------------------------------------

/** A stat as a number: booleans count 1/0, "34:12" minutes become 34.2, anything else non-numeric is null. */
export function stat(game: PlayerGame, key: string): number | null {
  return toNumber(game.stats[key]);
}

export function toNumber(v: RawStat | undefined): number | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = v.trim();
  const clock = s.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : null;
}

/** Sum of a per-game value over games that recorded it. `null` when none did. */
export function sumOf(games: readonly PlayerGame[], value: (g: PlayerGame) => number | null): number | null {
  let total = 0;
  let seen = false;
  for (const g of games) {
    const v = value(g);
    if (v == null) continue;
    total += v;
    seen = true;
  }
  return seen ? total : null;
}

export const total = (key: string): Agg => (gs) => sumOf(gs, (g) => stat(g, key));

/** Per game played, over every game in scope (a game without the stat counts as a zero-less row, not a zero). */
export const perGame = (key: string): Agg => (gs) => {
  const s = total(key)(gs);
  return s == null || gs.length === 0 ? null : s / gs.length;
};

export const ratio = (num: Agg, den: Agg, scale = 1): Agg => (gs) => {
  const n = num(gs);
  const d = den(gs);
  return n == null || d == null || d === 0 ? null : (n / d) * scale;
};

export const games = (): Agg => (gs) => gs.length;

export const count = (pred: (g: PlayerGame) => boolean): Agg => (gs) => gs.filter(pred).length;

export const col = (key: string, label: string, of: Agg, decimals = 0, extra: Partial<ResearchColumn> = {}): SpecColumn => ({ key, label, of, decimals, ...extra });

export const logCol = (key: string, label: string, of: (g: PlayerGame) => number | string | null, decimals = 0, extra: Partial<ResearchColumn> = {}): SpecLogColumn => ({ key, label, of, decimals, ...extra });

export const one = (key: string) => (g: PlayerGame) => stat(g, key);

/** "kicking.fieldGoalsMade" -> "Field goals made". */
export function humanizeStatKey(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/^(bat_|pit_)/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A spec from whatever numeric stats a player's games actually carry — for a
 * position no sport spec covers (a kicker, a long snapper). Stats present in at
 * least a quarter of games, most common first. Honest rather than curated: it
 * shows what is stored, labelled from the key.
 */
export function genericResearchSpec(kind: string, history: readonly PlayerGame[], gameHref?: (g: PlayerGame) => string | null): ResearchSpec {
  const seen = new Map<string, number>();
  for (const g of history) for (const [k, v] of Object.entries(g.stats)) if (toNumber(v) != null && typeof v !== 'boolean') seen.set(k, (seen.get(k) ?? 0) + 1);
  const keys = [...seen.entries()]
    .filter(([, n]) => n >= history.length / 4)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k)
    .slice(0, 10);
  return {
    kind,
    ...(gameHref ? { gameHref } : {}),
    tiles: [col('g', 'G', games()), ...keys.slice(0, 8).map((k) => col(k, humanizeStatKey(k), total(k)))],
    seasonColumns: keys.map((k) => col(k, humanizeStatKey(k), total(k))),
    splitColumns: keys.slice(0, 5).map((k) => col(k, `${humanizeStatKey(k)}/G`, perGame(k), 1)),
    trends: keys.slice(0, 5).map((k) => ({ key: k, label: humanizeStatKey(k), decimals: 0, of: one(k) })),
    logColumns: keys.slice(0, 8).map((k) => logCol(k, humanizeStatKey(k), one(k))),
  };
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

function values(columns: readonly SpecColumn[], gs: readonly PlayerGame[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const c of columns) out[c.key] = gs.length ? c.of(gs) : null;
  return out;
}

function recordOf(gs: readonly PlayerGame[]): string | null {
  const w = gs.filter((g) => g.result === 'W').length;
  const l = gs.filter((g) => g.result === 'L').length;
  const d = gs.filter((g) => g.result === 'D').length;
  if (w + l + d === 0) return null;
  return d ? `${w}-${l}-${d}` : `${w}-${l}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function opponentLabel(g: PlayerGame): string {
  return g.opponent.abbr ?? g.opponent.name ?? '—';
}

function splitRows(spec: ResearchSpec, scoped: readonly PlayerGame[], scopeLabel: string, restBefore: Map<string, number | null>): ResearchSplitRow[] {
  const rows: ResearchSplitRow[] = [];
  const add = (group: string, key: string, label: string, gs: readonly PlayerGame[]) => {
    if (gs.length === 0) return;
    rows.push({ key: `${group}:${key}`, group, label, games: gs.length, values: values(spec.splitColumns, gs) });
  };
  add('Overall', 'all', scopeLabel, scoped);
  if (spec.venueSplits !== false) {
    add('Venue', 'home', 'Home', scoped.filter((g) => g.isHome === true));
    add('Venue', 'away', 'Away', scoped.filter((g) => g.isHome === false));
  }
  if (spec.resultSplits !== false) {
    add('Result', 'w', 'In wins', scoped.filter((g) => g.result === 'W'));
    add('Result', 'l', 'In losses', scoped.filter((g) => g.result === 'L'));
    add('Result', 'd', 'In draws', scoped.filter((g) => g.result === 'D'));
  }
  if (spec.restSplits) {
    const b2b = scoped.filter((g) => restBefore.get(g.eventId) === 1);
    const rested = scoped.filter((g) => (restBefore.get(g.eventId) ?? 0) >= 2);
    // A row only means something beside its counterpart.
    if (b2b.length && rested.length) {
      add('Rest', 'b2b', 'No rest (back-to-back)', b2b);
      add('Rest', 'rest', '2+ days rest', rested);
    }
  }
  // Months only within one season: across every season held they are thirty rows that say little.
  if (new Set(scoped.map((g) => g.season)).size === 1) {
    const months = [...new Set(scoped.map((g) => g.date.slice(0, 7)))].sort();
    const spansYears = new Set(months.map((m) => m.slice(0, 4))).size > 1;
    for (const mo of months) {
      const name = MONTHS[Number(mo.slice(5, 7)) - 1];
      add('Month', mo, spansYears ? `${name} ${mo.slice(0, 4)}` : name, scoped.filter((g) => g.date.startsWith(mo)));
    }
  }
  const byOpp = new Map<string, PlayerGame[]>();
  for (const g of scoped) {
    // An opponent without a name makes a row nobody can read.
    if (!g.opponentId || opponentLabel(g) === '—') continue;
    const list = byOpp.get(g.opponentId) ?? [];
    list.push(g);
    byOpp.set(g.opponentId, list);
  }
  [...byOpp.entries()]
    .sort((a, b) => b[1].length - a[1].length || opponentLabel(a[1][0]).localeCompare(opponentLabel(b[1][0])))
    .forEach(([id, gs]) => add('Opponent', id, `vs ${opponentLabel(gs[0])}`, gs));
  return rows;
}

export function buildPlayerResearch(input: { sport: HistorySport; history: PlayerHistory; spec: ResearchSpec; now?: Date }): PlayerResearchData | null {
  const { sport, history, spec } = input;
  const now = input.now ?? new Date();
  const all = history.games.filter(spec.played ?? (() => true));
  if (all.length === 0) return null;

  const seasons = [...new Set(all.map((g) => g.season))].sort((a, b) => b - a);
  const current = seasonForDate(sport, now);
  const currentGames = all.filter((g) => g.season === current);
  const scope = seasonScope(sport, currentGames.length, now);
  let scopeSeason = scope.season;
  let scopeReason: string | null = currentGames.length > 0 ? scope.reason : null;
  if (!all.some((g) => g.season === scopeSeason)) {
    // Nothing in the season the rule picked (an injured year, a player new to
    // the league): open on the newest season held and say so.
    scopeSeason = seasons[0];
    scopeReason = scopeSeason !== current ? `No games held for ${seasonLabel(sport, scope.season)}; this shows ${seasonLabel(sport, scopeSeason)}, the latest held.` : null;
  }
  const scoped = all.filter((g) => g.season === scopeSeason);
  const scopeLabel =
    scopeSeason !== current && currentGames.length > 0
      ? `${seasonLabel(sport, scopeSeason)} season (${seasonLabel(sport, current)}: ${currentGames.length} ${currentGames.length === 1 ? 'game' : 'games'})`
      : `${seasonLabel(sport, scopeSeason)} season`;

  const restBefore = new Map<string, number | null>();
  all.forEach((g, i) => restBefore.set(g.eventId, i === 0 ? null : daysBetween(all[i - 1].date, g.date)));

  const seasonRows = seasons.map((s) => {
    const gs = all.filter((g) => g.season === s);
    return { season: s, label: seasonLabel(sport, s), games: gs.length, values: values(spec.seasonColumns, gs) };
  });
  if (seasons.length > 1) seasonRows.push({ season: 0, label: 'All held', games: all.length, values: values(spec.seasonColumns, all) });

  const rowsBySeason: Record<number, ResearchSplitRow[]> = {};
  for (const s of seasons) rowsBySeason[s] = splitRows(spec, all.filter((g) => g.season === s), `${seasonLabel(sport, s)} · all`, restBefore);
  if (seasons.length > 1) rowsBySeason[0] = splitRows(spec, all, 'All held', restBefore);

  const logRows: ResearchLogRow[] = [...all].reverse().map((g) => {
    const vals: Record<string, number | string | null> = {};
    for (const c of spec.logColumns) vals[c.key] = c.of(g);
    return {
      eventId: g.eventId,
      date: g.date,
      season: g.season,
      opponentLabel: opponentLabel(g),
      opponentLogoUrl: g.opponent.logoUrl,
      isHome: g.isHome,
      result: g.result,
      score: g.teamScore != null && g.opponentScore != null ? `${g.teamScore}-${g.opponentScore}` : null,
      values: vals,
      href: spec.gameHref ? spec.gameHref(g) : null,
    };
  });

  return {
    kind: spec.kind,
    hero: {
      scopeLabel,
      scopeReason,
      record: recordOf(scoped),
      tiles: spec.tiles.map((c) => ({ label: c.label, value: formatResearchValue(scoped.length ? c.of(scoped) : null, c), ...(c.info ? { info: c.info } : {}) })),
    },
    seasons: { columns: spec.seasonColumns.map(strip), rows: seasonRows, caption: null },
    trends: {
      rollingWindow: 5,
      stats: spec.trends.map((t) => ({
        key: t.key,
        label: t.label,
        decimals: t.decimals,
        points: all.map((g) => ({ eventId: g.eventId, date: g.date, season: g.season, value: t.of(g), label: `${g.isHome === false ? '@' : 'vs'} ${opponentLabel(g)}` })),
      })),
    },
    splits: { columns: spec.splitColumns.map(strip), seasons: seasons.length > 1 ? [...seasons, 0] : seasons, defaultSeason: scopeSeason, rowsBySeason },
    gameLog: { columns: spec.logColumns.map(strip), rows: logRows },
    seasonLabels: seasons.map((s) => ({ season: s, label: seasonLabel(sport, s) })),
  };
}

function strip<T extends ResearchColumn>(c: T): ResearchColumn {
  const out: ResearchColumn = { key: c.key, label: c.label, decimals: c.decimals };
  if (c.info) out.info = c.info;
  if (c.format) out.format = c.format;
  return out;
}
