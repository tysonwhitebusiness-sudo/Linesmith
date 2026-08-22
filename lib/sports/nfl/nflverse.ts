/**
 * nflverse-data as the real data source for NFL schedule/history/team-stats
 * — replaces the ESPN-scraping equivalents in espn.ts per this session's
 * live audit. Free, static CSV files on GitHub Releases (no key, no rate
 * limit), refreshed by nflverse's own automation. Verified live this
 * session, not from docs:
 *
 *  - `games.csv` (release `schedules`) — full season schedule with results,
 *    already carries ESPN's own game id in its `espn` column, so this joins
 *    onto the existing ESPN-id-based pipeline (teamSportEspn.ts,
 *    multiSportGameContext.ts) with zero new identity work.
 *  - `stats_player_week_{season}.csv` (release `stats_player`) — the
 *    CURRENT per-player-per-week pipeline (confirmed fresh: full 2025
 *    season, `stats_team` sibling release updated 3 days before this
 *    session). The older combined `player_stats.csv` (release
 *    `player_stats`) stopped updating after 2024 — deliberately NOT used.
 *  - `stats_team_reg_{season}.csv` (release `stats_team`) — real team
 *    totals (EPA, CPOE, defensive stats included) for computing rank.
 *  - `players.csv` (release `players`) — 25k-player ID crosswalk; its
 *    `espn_id` column is exactly this app's existing subjectId source
 *    (`espn:nfl:{athleteId}`), `gsis_id` is nflverse's own canonical id
 *    used across every other file here.
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';

const RELEASE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';

/** RFC4180-aware — nflverse's headshot_url column contains literal commas ("f_auto,q_auto"), so a naive split(',') silently misaligns every column after it. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cur); cur = '';
    } else if (c === '\n') {
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else if (c !== '\r') {
      cur += c;
    }
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
  if (rows.length === 0) return [];

  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * nflverse and ESPN disagree on a handful of team codes — confirmed by
 * pulling every team code out of a real `games.csv` this session: nflverse
 * uses `LA` for the Rams and `WAS` for Washington, where every ESPN-sourced
 * value elsewhere in this app (`teamSportEspn.ts`, `getStandings()`,
 * `nflTeamLogoUrl`) uses `LAR`/`WSH`. Left unnormalized, this is silent and
 * severe, not cosmetic: every nflverse lookup keyed by team code
 * (`getTeamRecentResults`, `getNflverseTeamStatsWithRank`,
 * `getTeamDefenseAllowedWithRank`) is indexed under nflverse's code, while
 * every caller looks it up with ESPN's — so the Rams' and Washington's own
 * team stats, recent results, and opponent-defense rows all come back empty
 * (not just a missing logo icon) whenever nflverse's code doesn't match
 * ESPN's. `OAK`/`SD`/`STL` are relocated-team historical codes, included
 * for the same reason even though they don't affect the current season.
 * Applied once, right where nflverse rows are parsed, so nothing downstream
 * needs to know this mismatch exists.
 */
const NFLVERSE_TO_ESPN_ABBR: Record<string, string> = {
  LA: 'LAR',
  WAS: 'WSH',
  OAK: 'LV',
  SD: 'LAC',
  STL: 'LAR',
};

function espnAbbr(nflverseAbbr: string): string {
  return NFLVERSE_TO_ESPN_ABBR[nflverseAbbr] ?? nflverseAbbr;
}

async function fetchNflverseCsv(release: string, file: string, cacheKey: string, ttlMs: number): Promise<Record<string, string>[]> {
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < ttlMs) {
    return JSON.parse(cached.payload) as Record<string, string>[];
  }
  // No timeout here meant a slow/hung GitHub Releases connection could block
  // this call forever — and since `buildNflSnapshot` calls this from inside
  // `awaitRebuild`'s in-flight dedup guard, one hung fetch stalls every
  // concurrent /api/nfl request on the same never-resolving promise, not
  // just the one that triggered it.
  let res: Response;
  try {
    res = await fetch(`${RELEASE_BASE}/${release}/${file}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return cached ? (JSON.parse(cached.payload) as Record<string, string>[]) : [];
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as Record<string, string>[]) : [];
  const rows = parseCsv(await res.text());
  await writeSnapshotCache(cacheKey, JSON.stringify(rows));
  return rows;
}

// ---------------------------------------------------------------------------
// Schedule (replaces espn.ts's getTeamSchedule)
// ---------------------------------------------------------------------------

export interface NflverseGame {
  gameId: string; // nflverse's own id, e.g. 2026_01_NE_SEA
  espnGameId: string;
  season: string;
  week: string;
  seasonType: string;
  gameday: string;
  awayTeam: string;
  homeTeam: string;
  awayScore: number | null;
  homeScore: number | null;
  completed: boolean;
}

const SCHEDULE_TTL_MS = 6 * 60 * 60_000;

export async function getNflverseSchedule(): Promise<NflverseGame[]> {
  const rows = await fetchNflverseCsv('schedules', 'games.csv', 'nflverse-games', SCHEDULE_TTL_MS);
  return rows.map((r) => ({
    gameId: r.game_id,
    espnGameId: r.espn,
    season: r.season,
    week: r.week,
    seasonType: r.game_type,
    gameday: r.gameday,
    awayTeam: espnAbbr(r.away_team),
    homeTeam: espnAbbr(r.home_team),
    awayScore: r.away_score ? Number(r.away_score) : null,
    homeScore: r.home_score ? Number(r.home_score) : null,
    completed: r.away_score !== '' && r.home_score !== '',
  }));
}

/** This team's completed games, most recent first — the real replacement for espn.ts's schedule-with-results. */
export async function getTeamRecentResults(teamAbbr: string, limit = 15): Promise<NflverseGame[]> {
  const games = await getNflverseSchedule();
  return games
    .filter((g) => g.completed && (g.awayTeam === teamAbbr || g.homeTeam === teamAbbr))
    .sort((a, b) => (a.gameday < b.gameday ? 1 : -1))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Player ID crosswalk (replaces guessing — real espn_id -> gsis_id mapping)
// ---------------------------------------------------------------------------

const CROSSWALK_TTL_MS = 24 * 60 * 60_000;

let crosswalkCache: Map<string, string> | null = null; // espn_id -> gsis_id, in-process for the life of this build

export async function getEspnToGsisMap(): Promise<Map<string, string>> {
  if (crosswalkCache) return crosswalkCache;
  const rows = await fetchNflverseCsv('players', 'players.csv', 'nflverse-players', CROSSWALK_TTL_MS);
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.espn_id && r.gsis_id) map.set(r.espn_id, r.gsis_id);
  }
  crosswalkCache = map;
  return map;
}

// ---------------------------------------------------------------------------
// Per-player weekly stats (replaces espn.ts's per-athlete gamelog scrape)
// ---------------------------------------------------------------------------

/** Canonical market key -> nflverse stats_player column name (its own vocabulary, not ESPN's). */
export const NFLVERSE_STAT_COLUMN_BY_MARKET: Record<string, string> = {
  'passing-yards': 'passing_yards',
  'passing-tds': 'passing_tds',
  'rushing-yards': 'rushing_yards',
  'rushing-tds': 'rushing_tds',
  'receiving-yards': 'receiving_yards',
  receptions: 'receptions',
  'receiving-tds': 'receiving_tds',
  'interceptions-thrown': 'passing_interceptions',
};

const WEEKLY_STATS_TTL_MS = 24 * 60 * 60_000;

/** Most recent season with real weekly data — verified live this session (2025 has full-season data; 2026 has none yet, no games played). Bump forward once 2026 games start posting to this pipeline. */
export const MOST_RECENT_STATS_SEASON = '2025';

export async function getPlayerWeeklyStats(season: string = MOST_RECENT_STATS_SEASON): Promise<Record<string, string>[]> {
  return fetchNflverseCsv('stats_player', `stats_player_week_${season}.csv`, `nflverse-stats-player-week-${season}`, WEEKLY_STATS_TTL_MS);
}

// Indexed by player_id, built once per process (the adapter calls
// getPlayerMarketHistory once per roster player per market — without this,
// a full slate re-filters the same 19k-row table hundreds of times per
// snapshot build).
let weeklyStatsByPlayerCache: { season: string; byPlayer: Map<string, Record<string, string>[]> } | null = null;

async function getWeeklyStatsByPlayer(season: string): Promise<Map<string, Record<string, string>[]>> {
  if (weeklyStatsByPlayerCache?.season === season) return weeklyStatsByPlayerCache.byPlayer;
  const rows = await getPlayerWeeklyStats(season);
  const byPlayer = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const bucket = byPlayer.get(r.player_id) ?? [];
    bucket.push(r);
    byPlayer.set(r.player_id, bucket);
  }
  weeklyStatsByPlayerCache = { season, byPlayer };
  return byPlayer;
}

/** This player's real weekly history for one market, oldest-first — the direct replacement for espn.ts's getAthleteGameLog + NFL_STAT_NAME_BY_MARKET. */
export async function getPlayerMarketHistory(gsisId: string, marketKey: string, season: string = MOST_RECENT_STATS_SEASON): Promise<Array<{ week: string; value: number; opponentAbbr: string }>> {
  const column = NFLVERSE_STAT_COLUMN_BY_MARKET[marketKey];
  if (!column) return [];
  const byPlayer = await getWeeklyStatsByPlayer(season);
  const rows = byPlayer.get(gsisId) ?? [];
  return rows
    .filter((r) => r[column] !== '')
    .sort((a, b) => Number(a.week) - Number(b.week))
    .map((r) => ({ week: r.week, value: Number(r[column]), opponentAbbr: espnAbbr(r.opponent_team) }));
}

/**
 * A player's real weekly box score, position-relevant columns only — the
 * gamelog's real per-game columns (completions/attempts/yards/TDs/INTs for
 * a QB week, carries/yards/TDs/receptions for an RB week, etc.), not just
 * the single tracked market's value `getPlayerMarketHistory` extracts.
 * Same underlying rows as `getPlayerMarketHistory`, read more broadly.
 */
export interface PlayerWeeklyBoxScore {
  week: string;
  opponentAbbr: string;
  completions: number;
  attempts: number;
  passingYards: number;
  passingTds: number;
  interceptions: number;
  carries: number;
  rushingYards: number;
  rushingTds: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
}

export async function getPlayerWeeklyBoxScores(gsisId: string, season: string = MOST_RECENT_STATS_SEASON): Promise<PlayerWeeklyBoxScore[]> {
  const byPlayer = await getWeeklyStatsByPlayer(season);
  const rows = byPlayer.get(gsisId) ?? [];
  const num = (r: Record<string, string>, k: string) => (r[k] ? Number(r[k]) : 0);
  return rows
    .sort((a, b) => Number(a.week) - Number(b.week))
    .map((r) => ({
      week: r.week,
      opponentAbbr: espnAbbr(r.opponent_team),
      completions: num(r, 'completions'),
      attempts: num(r, 'attempts'),
      passingYards: num(r, 'passing_yards'),
      passingTds: num(r, 'passing_tds'),
      interceptions: num(r, 'passing_interceptions'),
      carries: num(r, 'carries'),
      rushingYards: num(r, 'rushing_yards'),
      rushingTds: num(r, 'rushing_tds'),
      targets: num(r, 'targets'),
      receptions: num(r, 'receptions'),
      receivingYards: num(r, 'receiving_yards'),
      receivingTds: num(r, 'receiving_tds'),
    }));
}

// ---------------------------------------------------------------------------
// Per-player season totals — the roster list's real stat line. Separate
// file from the weekly one (stats_player_reg_{season}.csv, real 2,021-row
// 2025 data, verified live) — season-aggregate, not summed client-side from
// weekly rows, since nflverse already computes it correctly (bye weeks,
// games-played counts, etc.) and re-deriving it would risk getting that
// wrong for no benefit.
// ---------------------------------------------------------------------------

export interface PlayerSeasonStats {
  position: string;
  /** ESPN-normalized abbreviation (see `espnAbbr`) — nflverse's own `recent_team` column disagrees with ESPN's for a couple of teams, same LA/WAS mismatch already fixed elsewhere in this file. */
  team: string;
  games: number;
  passingYards: number;
  passingTds: number;
  passingInterceptions: number;
  passingAttempts: number;
  passingEpa: number;
  rushingYards: number;
  rushingTds: number;
  rushingAttempts: number;
  rushingEpa: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
  // Defense — real per-player box-score stats, previously unused anywhere
  // in this app. Verified live this session with real rows (Calais
  // Campbell, Cameron Jordan) before wiring in.
  defTacklesSolo: number;
  defTacklesAssist: number;
  defTacklesForLoss: number;
  defSacks: number;
  defQbHits: number;
  defInterceptions: number;
  defPassDefended: number;
  // Special teams — same file, also previously unused.
  fgMade: number;
  fgAtt: number;
  fgPct: number;
  puntNetYards: number;
  puntAttempts: number;
  kickoffReturnYards: number;
  kickoffReturns: number;
  puntReturnYards: number;
  puntReturns: number;
}

const PLAYER_SEASON_TTL_MS = 24 * 60 * 60_000;

let playerSeasonCache: { season: string; byPlayer: Map<string, PlayerSeasonStats> } | null = null;

export async function getPlayerSeasonStatsByGsis(season: string = MOST_RECENT_STATS_SEASON): Promise<Map<string, PlayerSeasonStats>> {
  if (playerSeasonCache?.season === season) return playerSeasonCache.byPlayer;
  const rows = await fetchNflverseCsv('stats_player', `stats_player_reg_${season}.csv`, `nflverse-stats-player-reg-${season}`, PLAYER_SEASON_TTL_MS);
  const byPlayer = new Map<string, PlayerSeasonStats>();
  for (const r of rows) {
    byPlayer.set(r.player_id, {
      position: r.position,
      team: espnAbbr(r.recent_team),
      games: Number(r.games) || 0,
      passingYards: Number(r.passing_yards) || 0,
      passingTds: Number(r.passing_tds) || 0,
      passingInterceptions: Number(r.passing_interceptions) || 0,
      passingAttempts: Number(r.attempts) || 0,
      passingEpa: Number(r.passing_epa) || 0,
      rushingYards: Number(r.rushing_yards) || 0,
      rushingTds: Number(r.rushing_tds) || 0,
      rushingAttempts: Number(r.carries) || 0,
      rushingEpa: Number(r.rushing_epa) || 0,
      targets: Number(r.targets) || 0,
      receptions: Number(r.receptions) || 0,
      receivingYards: Number(r.receiving_yards) || 0,
      receivingTds: Number(r.receiving_tds) || 0,
      defTacklesSolo: Number(r.def_tackles_solo) || 0,
      defTacklesAssist: Number(r.def_tackles_with_assist) || 0,
      defTacklesForLoss: Number(r.def_tackles_for_loss) || 0,
      defSacks: Number(r.def_sacks) || 0,
      defQbHits: Number(r.def_qb_hits) || 0,
      defInterceptions: Number(r.def_interceptions) || 0,
      defPassDefended: Number(r.def_pass_defended) || 0,
      fgMade: Number(r.fg_made) || 0,
      fgAtt: Number(r.fg_att) || 0,
      fgPct: Number(r.fg_pct) || 0,
      puntNetYards: Number(r.pt_net_yards) || 0,
      puntAttempts: Number(r.pt_att) || 0,
      kickoffReturnYards: Number(r.kickoff_return_yards) || 0,
      kickoffReturns: Number(r.kickoff_returns) || 0,
      puntReturnYards: Number(r.punt_return_yards) || 0,
      puntReturns: Number(r.punt_returns) || 0,
    });
  }
  playerSeasonCache = { season, byPlayer };
  return byPlayer;
}

/**
 * Real league-wide rank per season stat, among players at the *same real
 * position* (QB vs QB, RB vs RB, etc.) — comparing a QB's rushing yards
 * against a WR's would be a meaningless pool. Ranked on the same season
 * totals the Season Stats card already shows (not a per-game rate), so the
 * displayed number and the displayed rank are always describing the same
 * quantity. This is the real per-player equivalent of
 * `getNflverseTeamStatsWithRank`'s team-level ranks — same data source,
 * same season, just grouped by player instead of by team.
 */
export interface PlayerSeasonRank {
  rank: number;
  poolSize: number;
}

const RANKED_STAT_KEYS = ['passingYards', 'passingTds', 'rushingYards', 'rushingTds', 'receptions', 'receivingYards', 'receivingTds'] as const;

let playerSeasonRankCache: { season: string; byGsis: Map<string, Partial<Record<(typeof RANKED_STAT_KEYS)[number], PlayerSeasonRank>>> } | null = null;

export async function getPlayerSeasonRanksByGsis(season: string = MOST_RECENT_STATS_SEASON): Promise<Map<string, Partial<Record<(typeof RANKED_STAT_KEYS)[number], PlayerSeasonRank>>>> {
  if (playerSeasonRankCache?.season === season) return playerSeasonRankCache.byGsis;
  const byGsis = await getPlayerSeasonStatsByGsis(season);

  const byPosition = new Map<string, Array<[string, PlayerSeasonStats]>>();
  for (const entry of byGsis) {
    const [, stats] = entry;
    if (stats.games === 0) continue;
    const bucket = byPosition.get(stats.position) ?? [];
    bucket.push(entry);
    byPosition.set(stats.position, bucket);
  }

  const result = new Map<string, Partial<Record<(typeof RANKED_STAT_KEYS)[number], PlayerSeasonRank>>>();
  for (const players of byPosition.values()) {
    for (const key of RANKED_STAT_KEYS) {
      // Zero-value players (e.g. a WR's passingYards) don't compete for this
      // stat's rank at all — a "1st of 4" among only the QBs who actually
      // threw is honest; a "1st of 63" including every non-thrower isn't.
      const withValue = players.filter(([, s]) => s[key] > 0);
      const sorted = [...withValue].sort((a, b) => b[1][key] - a[1][key]);
      sorted.forEach(([gsisId], i) => {
        const existing = result.get(gsisId) ?? {};
        existing[key] = { rank: i + 1, poolSize: sorted.length };
        result.set(gsisId, existing);
      });
    }
  }

  playerSeasonRankCache = { season, byGsis: result };
  return result;
}

// ---------------------------------------------------------------------------
// Team stats + rank (replaces espn.ts's 32-call scrape)
// ---------------------------------------------------------------------------

export interface NflverseTeamStatLine {
  key: string;
  label: string;
  value: number;
  rank: number; // 1 = best
  decimals: number;
  group?: string;
}

/**
 * Grouped the same way the "vs. Defense" matchup card's three sections are
 * (Passing / Rushing / Receiving-adjacent), plus a Scoring group computed
 * from the schedule since points aren't a `stats_team` column. `group` is
 * read directly by the matchup card — one table drives both the Team Stats
 * section and the matchup card's grouped rows, per the plan.
 */
const STAT_DEFS = [
  { key: 'points-per-game', label: 'Points/Gm', column: null, group: 'Scoring', decimals: 1, higherIsBetter: true },
  { key: 'pass-yards', label: 'Pass Yds/Gm', column: 'passing_yards', group: 'Passing', decimals: 1, higherIsBetter: true },
  { key: 'pass-tds', label: 'Pass TD/Gm', column: 'passing_tds', group: 'Passing', decimals: 2, higherIsBetter: true },
  { key: 'pass-epa', label: 'Passing EPA/Play', column: 'passing_epa', group: 'Passing', decimals: 2, higherIsBetter: true },
  { key: 'pass-cpoe', label: 'CPOE', column: 'passing_cpoe', group: 'Passing', decimals: 1, higherIsBetter: true },
  { key: 'sacks-taken', label: 'Sacks Taken/Gm', column: 'sacks_suffered', group: 'Passing', decimals: 1, higherIsBetter: false },
  { key: 'rush-yards', label: 'Rush Yds/Gm', column: 'rushing_yards', group: 'Rushing', decimals: 1, higherIsBetter: true },
  { key: 'rush-tds', label: 'Rush TD/Gm', column: 'rushing_tds', group: 'Rushing', decimals: 2, higherIsBetter: true },
  { key: 'rush-epa', label: 'Rushing EPA/Play', column: 'rushing_epa', group: 'Rushing', decimals: 2, higherIsBetter: true, perPlay: 'carries' },
  { key: 'receptions', label: 'Receptions/Gm', column: 'receptions', group: 'Receiving', decimals: 1, higherIsBetter: true },
  { key: 'turnovers', label: 'Turnovers/Gm', column: null, group: 'Scoring', decimals: 1, higherIsBetter: false },
  { key: 'def-sacks', label: 'Sacks/Gm', column: 'def_sacks', group: 'Defense', decimals: 1, higherIsBetter: true },
  { key: 'def-interceptions', label: 'INTs/Gm', column: 'def_interceptions', group: 'Defense', decimals: 2, higherIsBetter: true },
  { key: 'def-qb-hits', label: 'QB Hits/Gm', column: 'def_qb_hits', group: 'Defense', decimals: 1, higherIsBetter: true },
  { key: 'penalties', label: 'Penalties/Gm', column: 'penalties', group: 'Scoring', decimals: 1, higherIsBetter: false },
] as const;

export type NflStatGroup = (typeof STAT_DEFS)[number]['group'];

const TEAM_STATS_TTL_MS = 24 * 60 * 60_000;

/** Real points for/against per team, computed from the schedule (games.csv has no per-team-stats row for scoring — it's the source of truth for scores instead). */
export async function getPointsPerGame(season: string): Promise<Map<string, { pf: number; pa: number; games: number }>> {
  const schedule = await getNflverseSchedule();
  const byTeam = new Map<string, { pf: number; pa: number; games: number }>();
  for (const g of schedule) {
    if (g.season !== season || !g.completed) continue;
    for (const [team, pf, pa] of [
      [g.homeTeam, g.homeScore, g.awayScore],
      [g.awayTeam, g.awayScore, g.homeScore],
    ] as const) {
      if (pf == null || pa == null) continue;
      const entry = byTeam.get(team) ?? { pf: 0, pa: 0, games: 0 };
      entry.pf += pf;
      entry.pa += pa;
      entry.games += 1;
      byTeam.set(team, entry);
    }
  }
  return byTeam;
}

export async function getNflverseTeamStatsWithRank(season: string = MOST_RECENT_STATS_SEASON): Promise<Record<string, NflverseTeamStatLine[]>> {
  const [rows, pointsByTeam] = await Promise.all([
    fetchNflverseCsv('stats_team', `stats_team_reg_${season}.csv`, `nflverse-stats-team-reg-${season}`, TEAM_STATS_TTL_MS),
    getPointsPerGame(season),
  ]);
  const byTeam = new Map<string, Record<string, string>>();
  for (const r of rows) byTeam.set(espnAbbr(r.team), r);

  const result: Record<string, NflverseTeamStatLine[]> = {};
  for (const [team, row] of byTeam) {
    const games = Number(row.games) || 1;
    const attempts = Number(row.attempts) || 1;
    const carries = Number(row.carries) || 1;
    const points = pointsByTeam.get(team);
    const turnovers = ((Number(row.passing_interceptions) || 0) + (Number(row.fumbles_lost_total) || 0)) / games;
    const values: Partial<Record<string, number>> = {
      'points-per-game': points ? points.pf / points.games : undefined,
      'pass-yards': (Number(row.passing_yards) || 0) / games,
      'pass-tds': (Number(row.passing_tds) || 0) / games,
      'pass-epa': (Number(row.passing_epa) || 0) / attempts,
      'pass-cpoe': Number(row.passing_cpoe) || undefined,
      'sacks-taken': (Number(row.sacks_suffered) || 0) / games,
      'rush-yards': (Number(row.rushing_yards) || 0) / games,
      'rush-tds': (Number(row.rushing_tds) || 0) / games,
      'rush-epa': (Number(row.rushing_epa) || 0) / carries,
      receptions: (Number(row.receptions) || 0) / games,
      turnovers,
      'def-sacks': (Number(row.def_sacks) || 0) / games,
      'def-interceptions': (Number(row.def_interceptions) || 0) / games,
      'def-qb-hits': (Number(row.def_qb_hits) || 0) / games,
      penalties: (Number(row.penalties) || 0) / games,
    };
    result[team] = STAT_DEFS.filter((d) => values[d.key] != null && !Number.isNaN(values[d.key])).map((d) => ({
      key: d.key,
      label: d.label,
      value: values[d.key]!,
      decimals: d.decimals,
      group: d.group,
      rank: 0, // filled below
    }));
  }

  // Rank each stat across all teams that have it.
  for (const def of STAT_DEFS) {
    const entries = [...byTeam.keys()]
      .map((team) => ({ team, line: result[team]?.find((l) => l.key === def.key) }))
      .filter((e): e is { team: string; line: NflverseTeamStatLine } => e.line != null);
    const sorted = [...entries].sort((a, b) => (def.higherIsBetter ? b.line.value - a.line.value : a.line.value - b.line.value));
    sorted.forEach((e, i) => { e.line.rank = i + 1; });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Defense allowed — the "vs. Defense" matchup card's real data. Not a column
// on any team-level file: computed by aggregating stats_team_week BY
// opponent_team instead of by team — "what every opponent did against team
// X" is exactly "what X's defense allowed".
// ---------------------------------------------------------------------------

const DEFENSE_STAT_DEFS = [
  { key: 'pass-yards-allowed', label: 'Pass Yds Allowed/Gm', column: 'passing_yards', group: 'Passing', decimals: 1 },
  { key: 'pass-tds-allowed', label: 'Pass TD Allowed/Gm', column: 'passing_tds', group: 'Passing', decimals: 2 },
  { key: 'rush-yards-allowed', label: 'Rush Yds Allowed/Gm', column: 'rushing_yards', group: 'Rushing', decimals: 1 },
  { key: 'rush-tds-allowed', label: 'Rush TD Allowed/Gm', column: 'rushing_tds', group: 'Rushing', decimals: 2 },
  { key: 'receptions-allowed', label: 'Receptions Allowed/Gm', column: 'receptions', group: 'Receiving', decimals: 1 },
] as const;

const TEAM_WEEK_STATS_TTL_MS = 24 * 60 * 60_000;

export async function getTeamDefenseAllowedWithRank(season: string = MOST_RECENT_STATS_SEASON): Promise<Record<string, NflverseTeamStatLine[]>> {
  const rows = await fetchNflverseCsv('stats_team', `stats_team_week_${season}.csv`, `nflverse-stats-team-week-${season}`, TEAM_WEEK_STATS_TTL_MS);

  const byDefense = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const team = espnAbbr(r.opponent_team);
    const bucket = byDefense.get(team) ?? [];
    bucket.push(r);
    byDefense.set(team, bucket);
  }

  const result: Record<string, NflverseTeamStatLine[]> = {};
  for (const [team, games] of byDefense) {
    result[team] = DEFENSE_STAT_DEFS.map((def) => ({
      key: def.key,
      label: def.label,
      value: games.reduce((sum, g) => sum + (Number(g[def.column]) || 0), 0) / games.length,
      decimals: def.decimals,
      group: def.group,
      rank: 0,
    }));
  }

  // Lower allowed = better defense, so rank ascending.
  for (const def of DEFENSE_STAT_DEFS) {
    const entries = [...byDefense.keys()]
      .map((team) => ({ team, line: result[team]?.find((l) => l.key === def.key) }))
      .filter((e): e is { team: string; line: NflverseTeamStatLine } => e.line != null);
    const sorted = [...entries].sort((a, b) => a.line.value - b.line.value);
    sorted.forEach((e, i) => { e.line.rank = i + 1; });
  }

  return result;
}
