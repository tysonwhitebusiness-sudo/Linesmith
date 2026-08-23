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

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { normalizeName, scoreNameMatch } from '@/lib/odds/screenshotImport';

const BASE = 'https://stats.tennismylife.org/data';

export type TennisTour = 'atp' | 'wta';

/** ATP/WTA seasons are calendar years — no cross-year-boundary complication like Understat's Aug-May soccer season. */
export function currentTennisSeason(now: Date = new Date()): number {
  return now.getUTCFullYear();
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

interface RawTennisRow {
  tourney_name: string;
  surface: string;
  tourney_date: string;
  winner_id: string;
  winner_name: string;
  loser_id: string;
  loser_name: string;
  score: string;
  w_ace: string;
  l_ace: string;
}

/** Plain comma-split is safe: confirmed live, this archive's fields (tournament/player names included) never contain commas or quoting. */
function parseTennisCsv(text: string): RawTennisRow[] {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const col = (name: string) => header.indexOf(name);
  const idx = {
    tourney_name: col('tourney_name'),
    surface: col('surface'),
    tourney_date: col('tourney_date'),
    winner_id: col('winner_id'),
    winner_name: col('winner_name'),
    loser_id: col('loser_id'),
    loser_name: col('loser_name'),
    score: col('score'),
    w_ace: col('w_ace'),
    l_ace: col('l_ace'),
  };
  const rows: RawTennisRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const winnerName = cells[idx.winner_name];
    const loserName = cells[idx.loser_name];
    if (!winnerName || !loserName) continue;
    rows.push({
      tourney_name: cells[idx.tourney_name] ?? '',
      surface: cells[idx.surface] ?? '',
      tourney_date: cells[idx.tourney_date] ?? '',
      winner_id: cells[idx.winner_id] ?? '',
      winner_name: winnerName,
      loser_id: cells[idx.loser_id] ?? '',
      loser_name: loserName,
      score: cells[idx.score] ?? '',
      w_ace: cells[idx.w_ace] ?? '',
      l_ace: cells[idx.l_ace] ?? '',
    });
  }
  return rows;
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
  date: string;
  tournamentName: string;
  surface: string;
  opponent: string;
  isWinner: boolean;
  aces: number;
  gamesWon: number;
  gamesLost: number;
  /** Did this player win at least one set — real market ("to-win-a-set"), derived from the actual per-set arithmetic, not assumed true for the match winner (a retirement can leave the winner having taken zero completed sets). */
  wonAtLeastOneSet: boolean;
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
  const cacheKey = `tennis:tml:${tour}:${season}`;
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
  const byName = new Map<string, TennisSeasonEntry>();

  function ingest(rows: RawTennisRow[]) {
    for (const row of rows) {
      const sets = parseSetGames(row.score);
      if (sets.length === 0) continue; // walkover / unparseable — no real per-match stat to attach
      const date = toIsoDate(row.tourney_date);
      const matchId = `${row.tourney_name}-${row.tourney_date}-${row.winner_id}-${row.loser_id}`;

      const winnerGames = sets.reduce((sum, [a]) => sum + a, 0);
      const loserGames = sets.reduce((sum, [, b]) => sum + b, 0);
      const winnerSetsWon = sets.filter(([a, b]) => a > b).length;
      const loserSetsWon = sets.filter(([a, b]) => b > a).length;

      const winnerEntry: TennisMatch = {
        matchId,
        date,
        tournamentName: row.tourney_name,
        surface: row.surface,
        opponent: row.loser_name,
        isWinner: true,
        aces: Number(row.w_ace) || 0,
        gamesWon: winnerGames,
        gamesLost: loserGames,
        wonAtLeastOneSet: winnerSetsWon >= 1,
      };
      const loserEntry: TennisMatch = {
        matchId,
        date,
        tournamentName: row.tourney_name,
        surface: row.surface,
        opponent: row.winner_name,
        isWinner: false,
        aces: Number(row.l_ace) || 0,
        gamesWon: loserGames,
        gamesLost: winnerGames,
        wonAtLeastOneSet: loserSetsWon >= 1,
      };

      for (const [name, entry] of [[row.winner_name, winnerEntry] as const, [row.loser_name, loserEntry] as const]) {
        const key = normalizeName(name);
        if (!key) continue;
        const bucket = byName.get(key) ?? { realName: name, matches: [] };
        bucket.matches.push(entry);
        byName.set(key, bucket);
      }
    }
  }

  ingest(prior);
  ingest(current);
  for (const entry of byName.values()) {
    entry.matches.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
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
