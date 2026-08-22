/**
 * sportsdataverse/sportsdataverse-data — NBA's real per-game player history
 * source, per docs/multi-sport-expansion-audit-2026-08-22.md §2. Real,
 * live, current GitHub Releases CSV (confirmed 2026-08-22: a 17.7MB
 * `player_box_{season}.csv` covering every player's every game that
 * season, last-updated within days). Unlike Understat/ASA/CFBD, this is
 * ONE league-wide file per season — no per-team fetching or name-scoping
 * needed, real name resolution is a single flat index over the whole file.
 *
 * `season` here is the year the season *ends* in (NBA convention: the
 * 2025-26 season is "2026") — matches the file's own `season` column,
 * confirmed live.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { normalizeName, scoreNameMatch } from '@/lib/odds/screenshotImport';

const BASE = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download';

/** NBA's regular season runs Oct-Apr, playoffs into June — a season that STARTS in year Y is labeled Y+1 in this convention. Before the new season's opening tip (roughly October), the most recently completed season's file is still the real most-current data available. */
export function currentNbaSeason(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed, 9 = October
  return String(month >= 9 ? year + 1 : year);
}

const COLUMNS = [
  'game_id',
  'game_date',
  'athlete_id',
  'athlete_display_name',
  'team_abbreviation',
  'opponent_team_abbreviation',
  'home_away',
  'did_not_play',
  'points',
  'rebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'three_point_field_goals_made',
] as const;
type NbaColumn = (typeof COLUMNS)[number];

interface NbaBoxRow {
  gameId: string;
  date: string;
  athleteId: string;
  athleteName: string;
  teamAbbr: string;
  opponentAbbr: string;
  isHome: boolean;
  didNotPlay: boolean;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  threesMade: number;
}

/** Minimal defensive CSV row splitter — handles a double-quoted field (only real risk here: a display name containing a comma, which ESPN's convention doesn't use, but this doesn't assume that). Not a general CSV parser; sufficient for this one well-formed, machine-generated file. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

async function fetchSeasonBoxScores(season: string): Promise<NbaBoxRow[]> {
  const cacheKey = `nba:sdv:boxscores:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return JSON.parse(cached.payload) as NbaBoxRow[];
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/espn_nba_player_boxscores/player_box_${season}.csv`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  } catch {
    return cached ? (JSON.parse(cached.payload) as NbaBoxRow[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as NbaBoxRow[]) : [];

  const text = await res.text();
  const lines = text.split('\n');
  const header = splitCsvLine(lines[0]);
  const idx = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<NbaColumn, number>;
  if (Object.values(idx).some((i) => i < 0)) return cached ? (JSON.parse(cached.payload) as NbaBoxRow[]) : [];

  const rows: NbaBoxRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    const num = (key: NbaColumn) => Number(f[idx[key]] || 0) || 0;
    rows.push({
      gameId: f[idx.game_id],
      date: f[idx.game_date],
      athleteId: f[idx.athlete_id],
      athleteName: f[idx.athlete_display_name],
      teamAbbr: f[idx.team_abbreviation],
      opponentAbbr: f[idx.opponent_team_abbreviation],
      isHome: f[idx.home_away] === 'home',
      didNotPlay: f[idx.did_not_play]?.toLowerCase() === 'true',
      points: num('points'),
      rebounds: num('rebounds'),
      assists: num('assists'),
      steals: num('steals'),
      blocks: num('blocks'),
      turnovers: num('turnovers'),
      threesMade: num('three_point_field_goals_made'),
    });
  }

  await writeSnapshotCache(cacheKey, JSON.stringify(rows));
  return rows;
}

export interface NbaSeasonContext {
  nameIndex: Map<string, string>; // normalizedName -> athleteId
  rowsByAthleteId: Map<string, NbaBoxRow[]>;
}

/** Loaded once per snapshot rebuild (see nba/adapter.ts's attachRealHistory), not once per subject — mirrors every other sport's season-context refactor this session (ASA, CFBD). */
export async function loadNbaSeasonContext(season: string): Promise<NbaSeasonContext> {
  const rows = await fetchSeasonBoxScores(season);
  const nameIndex = new Map<string, string>();
  const rowsByAthleteId = new Map<string, NbaBoxRow[]>();
  for (const row of rows) {
    if (!nameIndex.has(normalizeName(row.athleteName))) nameIndex.set(normalizeName(row.athleteName), row.athleteId);
    const bucket = rowsByAthleteId.get(row.athleteId) ?? [];
    bucket.push(row);
    rowsByAthleteId.set(row.athleteId, bucket);
  }
  for (const bucket of rowsByAthleteId.values()) bucket.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return { nameIndex, rowsByAthleteId };
}

/** Same 0.85 confidence bar as every other cross-source name join in this codebase. Pure, in-memory. */
export function matchNbaPlayer(context: NbaSeasonContext, espnName: string): string | null {
  const exact = context.nameIndex.get(normalizeName(espnName));
  if (exact) return exact;
  let best: string | null = null;
  let bestScore = 0;
  for (const [normalized, athleteId] of context.nameIndex) {
    const score = scoreNameMatch(espnName, normalized);
    if (score > bestScore) {
      bestScore = score;
      best = athleteId;
    }
  }
  return bestScore >= 0.85 ? best : null;
}

export interface NbaMatchStat {
  gameId: string;
  date: string;
  opponent: string;
  isHome: boolean;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  threesMade: number;
}

/** Real per-game history for one resolved athlete id — pure, no I/O. Excludes DNP rows (a real "didn't play" game, not a real 0-stat game — including it would understate rates the way a bye week would). */
export function nbaPlayerMatches(context: NbaSeasonContext, athleteId: string): NbaMatchStat[] {
  const rows = context.rowsByAthleteId.get(athleteId) ?? [];
  return rows
    .filter((r) => !r.didNotPlay)
    .map((r) => ({
      gameId: r.gameId,
      date: r.date,
      opponent: r.opponentAbbr,
      isHome: r.isHome,
      points: r.points,
      rebounds: r.rebounds,
      assists: r.assists,
      steals: r.steals,
      blocks: r.blocks,
      turnovers: r.turnovers,
      threesMade: r.threesMade,
    }));
}
