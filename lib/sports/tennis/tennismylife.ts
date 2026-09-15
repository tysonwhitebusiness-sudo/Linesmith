/**
 * stats.tennismylife.org — tennis's real per-match history source (see
 * docs/multi-sport-expansion-audit-2026-08-22.md §4). A live, no-auth,
 * per-year CSV archive in Jeff Sackmann's tennis_atp/tennis_wta convention
 * (`GET /data/{year}.csv` for ATP, `/data/{year}_wta.csv` for WTA — the
 * site's own `/api/data-files` listing confirms this naming live). Unlike
 * Understat/ASA (soccer's equivalent sources), there is no separate
 * per-player endpoint: each year's CSV already IS the full set of real
 * per-match rows, so this file skips the two-phase "index, then per-player
 * fetch" shape and instead builds one Map straight from the parsed CSV —
 * `normalizedName -> that player's own matches, chronological`.
 *
 * Player identity in this data is TennisMyLife's own short alphanumeric
 * codes (`winner_id`/`loser_id`, e.g. "B0BI"), not ESPN athlete ids — same
 * "no id crosswalk, match by name" situation Understat/ASA are in for
 * soccer, so this reuses the same `normalizeName`/`scoreNameMatch` fuzzy
 * matcher at the same 0.85 confidence bar.
 */

import { seasonForDate } from '@/lib/sports/shared/season';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { normalizeName, scoreNameMatch } from '@/lib/odds/screenshotImport';

const BASE = 'https://stats.tennismylife.org/data';

export type TennisTour = 'atp' | 'wta';

/** ATP/WTA seasons are calendar years — no cross-year-boundary complication like Understat's Aug-May soccer season. */
export function currentTennisSeason(now: Date = new Date()): number {
  // R2: delegates to the one season convention (`lib/sports/shared/season.ts`) rather than re-deriving it. Same value; the boundary is now read on the Eastern date rather than UTC, which is the same rule R1d applied to ESPN's date ranges.
  return seasonForDate('tennis_atp', now);
}

async function fetchCsvText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Service-game counts for one side of a match, Sackmann's column names without the `w_`/`l_` prefix. */
const SERVE_COLUMNS = ['ace', 'df', 'svpt', '1stIn', '1stWon', '2ndWon', 'SvGms', 'bpSaved', 'bpFaced'] as const;
type ServeColumn = (typeof SERVE_COLUMNS)[number];

/** Every column kept, as the raw string (empty when the archive left it blank). */
const KEPT_COLUMNS = [
  'tourney_name', 'surface', 'tourney_date', 'tourney_level', 'indoor', 'round', 'match_num', 'best_of', 'minutes', 'score',
  'winner_id', 'winner_name', 'winner_rank', 'winner_rank_points', 'winner_seed',
  'loser_id', 'loser_name', 'loser_rank', 'loser_rank_points', 'loser_seed',
  ...SERVE_COLUMNS.map((c) => `w_${c}` as const),
  ...SERVE_COLUMNS.map((c) => `l_${c}` as const),
] as const;

export type RawTennisRow = Record<(typeof KEPT_COLUMNS)[number], string>;

/** Plain comma-split is safe: confirmed live, this archive's fields (tournament/player names included) never contain commas or quoting. */
export function parseTennisCsv(text: string): RawTennisRow[] {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].trim().split(',');
  const idx = KEPT_COLUMNS.map((name) => [name, header.indexOf(name)] as const);
  const rows: RawTennisRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].trim().split(',');
    const row = {} as RawTennisRow;
    for (const [name, at] of idx) row[name] = at >= 0 ? (cells[at] ?? '') : '';
    if (!row.winner_name || !row.loser_name) continue;
    rows.push(row);
  }
  return rows;
}

/**
 * `tourney_date` is the tournament's START (G2 data finding): every match in an
 * event carries the same date, so date alone cannot order a player's run
 * through a draw. Rounds are ordered here; round-robin and unknown rounds sit
 * before the knockout, and `match_num` breaks ties within a round.
 */
const ROUND_ORDER: Record<string, number> = { Q1: 0, Q2: 1, Q3: 2, Q4: 3, RR: 4, R128: 5, R64: 6, R32: 7, R16: 8, QF: 9, SF: 10, BR: 11, F: 12 };

export function roundOrder(round: string | undefined, matchNum: string | undefined): number {
  const r = ROUND_ORDER[(round ?? '').trim().toUpperCase()] ?? 4;
  const n = Number(matchNum);
  return r * 10_000 + (Number.isFinite(n) ? Math.min(Math.max(n, 0), 9_999) : 0);
}

/** `tourney_date` is `YYYYMMDD`. */
function toIsoDate(yyyymmdd: string): string {
  if (!/^\d{8}$/.test(yyyymmdd)) return new Date(0).toISOString();
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00Z`;
}

/**
 * Splits a real score string ("6-4 6-4", "4-6 7-6(5) 6-3", "3-6 6-0 3-1
 * RET") into per-set [winnerGames, loserGames] pairs — every token is
 * winner's-games-first regardless of who actually won that individual set,
 * matching Sackmann's own convention. Non-set tokens (RET/W/O/DEF, walkover
 * rows with no digits at all) are skipped rather than guessed at.
 */
function parseSetGames(score: string): Array<[number, number]> {
  const sets: Array<[number, number]> = [];
  for (const token of score.trim().split(/\s+/)) {
    const m = /^(\d+)-(\d+)/.exec(token);
    if (!m) continue;
    sets.push([Number(m[1]), Number(m[2])]);
  }
  return sets;
}

export interface TennisMatch {
  matchId: string;
  /** The TOURNAMENT's start date, shared by every match in the event — not the day this match was played. */
  date: string;
  /** Order within the event: round, then match number. See `ROUND_ORDER`. */
  order: number;
  tournamentName: string;
  surface: string;
  opponent: string;
  isWinner: boolean;
  aces: number;
  gamesWon: number;
  gamesLost: number;
  /** Did this player win at least one set — real market ("to-win-a-set"), derived from the actual per-set arithmetic, not assumed true for the match winner (a retirement can leave the winner having taken zero completed sets). */
  wonAtLeastOneSet: boolean;
  /** R4: the rest of the row. Null wherever the archive left the cell blank (walkovers, retirements, some lower-level events). */
  round: string | null;
  /** Sackmann's level code: G slam, M Masters, A/250/500 tour, F finals, D Davis Cup, C challenger. */
  level: string | null;
  indoor: boolean | null;
  bestOf: number | null;
  minutes: number | null;
  rank: number | null;
  rankPoints: number | null;
  seed: number | null;
  opponentRank: number | null;
  /** This player's service games. */
  serve: ServeStats | null;
  /** The opponent's service games — this player's return. */
  opponentServe: ServeStats | null;
}

export interface ServeStats {
  aces: number | null;
  doubleFaults: number | null;
  servePoints: number | null;
  firstIn: number | null;
  firstWon: number | null;
  secondWon: number | null;
  serviceGames: number | null;
  breakPointsSaved: number | null;
  breakPointsFaced: number | null;
}

const count = (v: string | undefined): number | null => {
  if (v == null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function serveStats(row: RawTennisRow, side: 'w' | 'l'): ServeStats | null {
  const get = (c: ServeColumn) => count(row[`${side}_${c}`]);
  const s: ServeStats = {
    aces: get('ace'),
    doubleFaults: get('df'),
    servePoints: get('svpt'),
    firstIn: get('1stIn'),
    firstWon: get('1stWon'),
    secondWon: get('2ndWon'),
    serviceGames: get('SvGms'),
    breakPointsSaved: get('bpSaved'),
    breakPointsFaced: get('bpFaced'),
  };
  return s.servePoints == null ? null : s;
}

/** Return points won: the opponent's serve points they did not win. */
export function returnPointsWon(m: Pick<TennisMatch, 'opponentServe'>): { won: number; of: number } | null {
  const o = m.opponentServe;
  if (!o || o.servePoints == null || o.firstWon == null || o.secondWon == null) return null;
  return { won: o.servePoints - o.firstWon - o.secondWon, of: o.servePoints };
}

/** Break points converted: the opponent's break points faced and not saved. */
export function breakPointsConverted(m: Pick<TennisMatch, 'opponentServe'>): { won: number; of: number } | null {
  const o = m.opponentServe;
  if (!o || o.breakPointsFaced == null || o.breakPointsSaved == null) return null;
  return { won: o.breakPointsFaced - o.breakPointsSaved, of: o.breakPointsFaced };
}

interface TennisSeasonEntry {
  realName: string;
  matches: TennisMatch[];
}

export interface TennisSeasonContext {
  /** normalizedName -> that player's real name + chronological match list, across the two seasons fetched (current + prior, for sample-size depth early in a season). */
  byName: Map<string, TennisSeasonEntry>;
}

async function fetchSeasonRows(tour: TennisTour, season: number): Promise<RawTennisRow[]> {
  // v2 (R4): rows now carry serve, rank and minutes columns; rows cached under the old key lack them.
  const cacheKey = `tennis:tml:v2:${tour}:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as RawTennisRow[];
  }
  const url = tour === 'wta' ? `${BASE}/${season}_wta.csv` : `${BASE}/${season}.csv`;
  const text = await fetchCsvText(url);
  if (!text) return cached ? (JSON.parse(cached.payload) as RawTennisRow[]) : [];
  const rows = parseTennisCsv(text);
  await writeSnapshotCache(cacheKey, JSON.stringify(rows));
  return rows;
}

/** Loaded once per rebuild (soccer's own understat.ts/americanSocceranalysis.ts learned this the hard way — see adapter.ts's own comment), not once per subject. */
export async function loadTennisSeasonContext(tour: TennisTour, season: number): Promise<TennisSeasonContext> {
  const [current, prior] = await Promise.all([fetchSeasonRows(tour, season), fetchSeasonRows(tour, season - 1)]);
  return buildTennisSeasonContext([...prior, ...current]);
}

/** Pure: parsed rows to each player's chronological matches. */
export function buildTennisSeasonContext(rows: readonly RawTennisRow[]): TennisSeasonContext {
  const byName = new Map<string, TennisSeasonEntry>();
  for (const row of rows) {
    const sets = parseSetGames(row.score);
    if (sets.length === 0) continue; // walkover / unparseable — no real per-match stat to attach
    const date = toIsoDate(row.tourney_date);
    const order = roundOrder(row.round, row.match_num);
    const matchId = `${row.tourney_name}-${row.tourney_date}-${row.winner_id}-${row.loser_id}`;

    const winnerGames = sets.reduce((sum, [a]) => sum + a, 0);
    const loserGames = sets.reduce((sum, [, b]) => sum + b, 0);
    const winnerSetsWon = sets.filter(([a, b]) => a > b).length;
    const loserSetsWon = sets.filter(([a, b]) => b > a).length;
    const indoor = row.indoor === 'I' ? true : row.indoor === 'O' ? false : null;
    const shared = {
      matchId,
      date,
      order,
      tournamentName: row.tourney_name,
      surface: row.surface,
      round: row.round || null,
      level: row.tourney_level || null,
      indoor,
      bestOf: count(row.best_of),
      minutes: count(row.minutes),
    };
    const wServe = serveStats(row, 'w');
    const lServe = serveStats(row, 'l');

    const winnerEntry: TennisMatch = {
      ...shared,
      opponent: row.loser_name,
      isWinner: true,
      aces: Number(row.w_ace) || 0,
      gamesWon: winnerGames,
      gamesLost: loserGames,
      wonAtLeastOneSet: winnerSetsWon >= 1,
      rank: count(row.winner_rank),
      rankPoints: count(row.winner_rank_points),
      seed: count(row.winner_seed),
      opponentRank: count(row.loser_rank),
      serve: wServe,
      opponentServe: lServe,
    };
    const loserEntry: TennisMatch = {
      ...shared,
      opponent: row.winner_name,
      isWinner: false,
      aces: Number(row.l_ace) || 0,
      gamesWon: loserGames,
      gamesLost: winnerGames,
      wonAtLeastOneSet: loserSetsWon >= 1,
      rank: count(row.loser_rank),
      rankPoints: count(row.loser_rank_points),
      seed: count(row.loser_seed),
      opponentRank: count(row.winner_rank),
      serve: lServe,
      opponentServe: wServe,
    };

    for (const [name, entry] of [[row.winner_name, winnerEntry] as const, [row.loser_name, loserEntry] as const]) {
      const key = normalizeName(name);
      if (!key) continue;
      const bucket = byName.get(key) ?? { realName: name, matches: [] };
      bucket.matches.push(entry);
      byName.set(key, bucket);
    }
  }
  for (const entry of byName.values()) {
    entry.matches.sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.order - b.order);
  }
  return { byName };
}

/**
 * Best real match for an ESPN roster name against an already-loaded season
 * context, or null below the same 0.85 confidence bar every other sport's
 * fuzzy name-matching uses. Pure — no I/O.
 */
export function matchTennisIndex(context: TennisSeasonContext, espnName: string): TennisMatch[] | null {
  let best: TennisSeasonEntry | null = null;
  let bestScore = 0;
  for (const entry of context.byName.values()) {
    const score = scoreNameMatch(espnName, entry.realName);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore >= 0.85 && best ? best.matches : null;
}
