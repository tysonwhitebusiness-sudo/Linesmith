/**
 * PGA Tour's own season strokes-gained stats — free, official, and the only
 * real analytical depth available for golf in this app (verified live
 * 2026-08-16; see project memory). No public API, no auth required: PGA
 * Tour's stats pages are Next.js pages that embed their full data payload as
 * JSON in a `__NEXT_DATA__` script tag (react-query's dehydrated cache) —
 * this parses that same payload rather than the rendered HTML table, which
 * is what makes it robust to layout changes. `robots.txt` doesn't block the
 * `/stats` paths.
 *
 * Not a sanctioned/documented API — no contract, no changelog. If PGA Tour
 * changes their frontend framework this extraction breaks; there's no
 * fallback here beyond returning an empty result and letting the caller
 * degrade honestly, same as every other external feed in this app.
 *
 * PGA Tour's own player ids are a third id namespace, different from both
 * ESPN's and SharpAPI's name-only rows — resolved to the app's canonical
 * ESPN athlete id via golfPlayerMatching.ts, same as golfLines.ts.
 */

import { readSnapshotCache, writeSnapshotCache } from '../../db/client';
import { buildGolfRosterIndex, resolveGolfer } from './golfPlayerMatching';
import type { SubjectSummary } from '../../core/types';

/** SG:Total's own stat-detail page carries Total/Tee-to-Green/Putting together in one row — see the file header. Off-the-Tee/Approach/Around-the-Green each live on their own statId page and aren't fetched here; same extraction pattern would add them later. */
const SG_TOTAL_STAT_ID = '02675';

interface PgaTourStatRow {
  playerId: string;
  playerName: string;
  rank: number;
  stats: Array<{ statName: string; statValue: string }>;
}

export interface GolferStrokesGained {
  /** ESPN athlete id — null when this golfer couldn't be matched to today's field. */
  espnId: string | null;
  pgaTourPlayerId: string;
  playerName: string;
  rank: number;
  /** SG:Total per round, this season. */
  avgPerRound: number | null;
  /** SG:Total, full season. */
  totalSeason: number | null;
  /** SG:Tee-to-Green, full season. */
  teeToGreenSeason: number | null;
  /** SG:Putting, full season. */
  puttingSeason: number | null;
  measuredRounds: number | null;
  /** Total players ranked on this stat page — `rank` is only "#12" in a meaningful sense next to how many were ranked at all. Only `avgPerRound`/`rank` come from this page's own sort column; Total/Tee-to-Green/Putting are season totals with no individual rank of their own. */
  poolSize: number;
}

export interface StrokesGainedResult {
  golfers: GolferStrokesGained[];
  year: number;
  fetchedAt: string;
  fromCache: boolean;
  warnings: string[];
}

function statValue(row: PgaTourStatRow, label: string): number | null {
  const entry = row.stats.find((s) => s.statName === label);
  if (!entry) return null;
  const n = Number(entry.statValue);
  return Number.isFinite(n) ? n : null;
}

async function fetchStatDetailRows(statId: string, year: number): Promise<PgaTourStatRow[] | null> {
  const res = await fetch(`https://www.pgatour.com/stats/detail/${statId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Linesmith/1.0)' },
    cache: 'no-store',
  });
  if (!res.ok) return null;

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;

  let payload: any;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const queries = payload?.props?.pageProps?.dehydratedState?.queries ?? [];
  const query = queries.find(
    (q: any) => q.queryKey?.[0] === 'statDetails' && q.queryKey?.[1]?.year === year && q.queryKey?.[1]?.eventQuery == null,
  );
  const rows = query?.state?.data?.rows;
  return Array.isArray(rows) ? rows : null;
}

const CACHE_KEY_PREFIX = 'golf:pgatour-sg:';
// Season-aggregate data that moves slowly — refetching more than daily buys
// nothing and just hammers a site with no formal API contract.
const TTL_MS = 24 * 60 * 60 * 1000;

async function loadSeasonRows(year: number): Promise<{ rows: PgaTourStatRow[]; fetchedAt: string; fromCache: boolean; warnings: string[] }> {
  const cacheKey = `${CACHE_KEY_PREFIX}${year}`;
  const cached = readSnapshotCache(cacheKey);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

  if (cached && ageMs < TTL_MS) {
    return { rows: JSON.parse(cached.payload), fetchedAt: cached.fetchedAt, fromCache: true, warnings: [] };
  }

  const rows = await fetchStatDetailRows(SG_TOTAL_STAT_ID, year);
  if (!rows) {
    if (cached) {
      return {
        rows: JSON.parse(cached.payload),
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        warnings: ['pgatour.com stats request failed — showing the last successful fetch.'],
      };
    }
    return { rows: [], fetchedAt: new Date().toISOString(), fromCache: false, warnings: ['pgatour.com stats request failed and there is no cached copy yet.'] };
  }

  writeSnapshotCache(cacheKey, JSON.stringify(rows));
  return { rows, fetchedAt: new Date().toISOString(), fromCache: false, warnings: [] };
}

/** Season strokes-gained for the whole tour, matched against today's ESPN field. */
export async function getSeasonStrokesGained(subjects: SubjectSummary[], year = new Date().getFullYear()): Promise<StrokesGainedResult> {
  const { rows, fetchedAt, fromCache, warnings } = await loadSeasonRows(year);
  const rosterIndex = buildGolfRosterIndex(subjects);

  const golfers: GolferStrokesGained[] = rows.map((row) => {
    const matched = resolveGolfer(row.playerName, rosterIndex);
    return {
      espnId: matched?.espnId ?? null,
      pgaTourPlayerId: row.playerId,
      playerName: row.playerName,
      rank: row.rank,
      avgPerRound: statValue(row, 'Avg'),
      totalSeason: statValue(row, 'Total SG:T'),
      teeToGreenSeason: statValue(row, 'Total SG:T2G'),
      puttingSeason: statValue(row, 'Total SG:P'),
      measuredRounds: statValue(row, 'Measured Rounds'),
      poolSize: rows.length,
    };
  });

  return { golfers, year, fetchedAt, fromCache, warnings };
}

/** One golfer's strokes-gained row, by ESPN id — for the player-detail page. */
export async function getGolferStrokesGained(
  espnId: string,
  subjects: SubjectSummary[],
  year = new Date().getFullYear(),
): Promise<GolferStrokesGained | null> {
  const result = await getSeasonStrokesGained(subjects, year);
  return result.golfers.find((g) => g.espnId === espnId) ?? null;
}

// ---------------------------------------------------------------------------
// Advanced stats — the rest of PGA Tour's real stat catalog.
//
// pgatour.com's own stat-detail pages embed a full navigation catalog of
// every stat category and its statId in the same __NEXT_DATA__ payload
// fetchStatDetailRows already parses (confirmed live 2026-08-16 by reading
// `data.statCategories` off a fetched page — ~300 real stat IDs across 8
// categories: Strokes Gained, Off the Tee, Approach, Around the Green,
// Putting, Scoring, Streaks, Money/Rankings). This is a curated ~19-stat
// subset of that catalog, not the whole thing — the ones an ESPN broadcast
// graphic or a bettor would actually reach for.
// ---------------------------------------------------------------------------

export type AdvancedStatCategory = 'strokesGained' | 'driving' | 'approach' | 'shortGame' | 'putting' | 'scoring' | 'rankings';

interface AdvancedStatDef {
  key: string;
  label: string;
  statId: string;
  decimals: number;
  category: AdvancedStatCategory;
}

const ADVANCED_STAT_DEFS: AdvancedStatDef[] = [
  { key: 'sgOffTee', label: 'SG: Off-the-Tee', statId: '02567', decimals: 2, category: 'strokesGained' },
  { key: 'sgApproach', label: 'SG: Approach the Green', statId: '02568', decimals: 2, category: 'strokesGained' },
  { key: 'sgAroundGreen', label: 'SG: Around-the-Green', statId: '02569', decimals: 2, category: 'strokesGained' },
  { key: 'sgPuttingDedicated', label: 'SG: Putting', statId: '02564', decimals: 2, category: 'strokesGained' },

  { key: 'drivingDistance', label: 'Driving Distance', statId: '101', decimals: 1, category: 'driving' },
  { key: 'drivingAccuracy', label: 'Driving Accuracy %', statId: '102', decimals: 1, category: 'driving' },

  { key: 'gir', label: 'Greens in Regulation %', statId: '103', decimals: 1, category: 'approach' },
  { key: 'proximity', label: 'Proximity to Hole', statId: '331', decimals: 1, category: 'approach' },

  { key: 'scrambling', label: 'Scrambling', statId: '130', decimals: 1, category: 'shortGame' },
  { key: 'sandSave', label: 'Sand Save %', statId: '111', decimals: 1, category: 'shortGame' },

  { key: 'puttingAvg', label: 'Putting Average', statId: '104', decimals: 3, category: 'putting' },
  { key: 'puttsPerRound', label: 'Putts Per Round', statId: '119', decimals: 2, category: 'putting' },
  { key: 'onePutt', label: 'One-Putt %', statId: '413', decimals: 1, category: 'putting' },

  { key: 'scoringAvg', label: 'Scoring Average', statId: '120', decimals: 2, category: 'scoring' },
  { key: 'birdieAvg', label: 'Birdie Average', statId: '156', decimals: 2, category: 'scoring' },
  { key: 'bogeyAvoidance', label: 'Bogey Avoidance', statId: '02414', decimals: 1, category: 'scoring' },
  { key: 'par3Scoring', label: 'Par 3 Scoring Avg', statId: '142', decimals: 2, category: 'scoring' },
  { key: 'par4Scoring', label: 'Par 4 Scoring Avg', statId: '143', decimals: 2, category: 'scoring' },
  { key: 'par5Scoring', label: 'Par 5 Scoring Avg', statId: '144', decimals: 2, category: 'scoring' },

  { key: 'worldRanking', label: 'World Golf Ranking', statId: '186', decimals: 2, category: 'rankings' },
  { key: 'allAroundRanking', label: 'All-Around Ranking', statId: '127', decimals: 2, category: 'rankings' },
];

export interface AdvancedStat {
  key: string;
  label: string;
  category: AdvancedStatCategory;
  value: number | null;
  decimals: number;
  rank: number | null;
  poolSize: number;
  /** Whoever is rank 1's raw value on this stat page — the "best" end of the field's range. Null only if the page had no ranked rows at all. */
  bestValue: number | null;
  /** The worst-ranked row's raw value — the other end of the range. */
  worstValue: number | null;
  /** Mean of every ranked row's raw value on the page — the tour average, not this golfer's own number. */
  avgValue: number | null;
}

const STAT_CACHE_PREFIX = 'golf:pgatour-stat:';

/**
 * Same cache/fallback shape as `loadSeasonRows`, generalized to any statId —
 * every advanced stat is its own pgatour.com page with its own cache entry.
 *
 * Every stat page except the strokes-gained ones also carries a synthetic
 * `StatDetailTourAvg` summary row mixed into the same `rows` array — no
 * `playerName`, just a `displayName: "Tour Average"` and a value. Confirmed
 * live across all 15 non-SG stat IDs added here; filtered out at the source
 * so nothing downstream has to know it exists (it was crashing
 * `resolveGolfer` on `undefined.normalize()` before this filter existed).
 */
async function loadStatRows(statId: string, year: number): Promise<{ rows: PgaTourStatRow[]; warning?: string }> {
  const cacheKey = `${STAT_CACHE_PREFIX}${statId}:${year}`;
  const cached = readSnapshotCache(cacheKey);
  const ageMs = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

  // Filtered on every read, not just on write: a cache entry written before
  // this filter existed (or by any future code path that forgets it) would
  // otherwise keep serving the unfiltered Tour Average row indefinitely,
  // right up to the same crash this filter exists to prevent.
  if (cached && ageMs < TTL_MS) {
    const rows = (JSON.parse(cached.payload) as PgaTourStatRow[]).filter((r) => typeof r.playerName === 'string');
    return { rows };
  }

  const rawRows = await fetchStatDetailRows(statId, year);
  if (!rawRows) {
    if (cached) {
      const rows = (JSON.parse(cached.payload) as PgaTourStatRow[]).filter((r) => typeof r.playerName === 'string');
      return { rows, warning: `pgatour.com stat ${statId} request failed — showing the last successful fetch.` };
    }
    return { rows: [], warning: `pgatour.com stat ${statId} request failed and there is no cached copy yet.` };
  }

  const rows = rawRows.filter((r) => typeof r.playerName === 'string');
  writeSnapshotCache(cacheKey, JSON.stringify(rows));
  return { rows };
}

/**
 * The column a stat page is ranked/sorted by is always its `stats[0]` entry
 * — confirmed live across every stat added here, even though the column's
 * own label varies wildly ("Avg" for counting stats, "Avg Points" for
 * rankings, "%" for percentage stats, and "% Makes Bogey" — a completely
 * custom label — for Bogey Avoidance). Position, not name, is the one
 * reliable signal.
 *
 * Most values are plain numbers (with commas or a trailing "%" to strip),
 * but Proximity to Hole's own "Avg" column formats distance as feet-inches
 * ("32' 10\""), confirmed live — converted to decimal feet rather than
 * dropping the stat or mangling it through a blanket digit-strip.
 */
function primaryStatValue(row: PgaTourStatRow): number | null {
  const raw = row.stats[0]?.statValue;
  if (raw == null) return null;
  const str = String(raw).trim();

  const feetInches = /^(\d+)'\s*(\d+)"?$/.exec(str);
  if (feetInches) return Number(feetInches[1]) + Number(feetInches[2]) / 12;

  const n = Number(str.replace(/,/g, '').replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

/** `resolveGolfer` only goes name→espnId, so finding one golfer on a stat page means resolving every row until one matches — same O(rows) approach `getSeasonStrokesGained` already takes fetching the whole tour, just applied per stat page. */
function findGolferRow(rows: PgaTourStatRow[], espnId: string, rosterIndex: ReturnType<typeof buildGolfRosterIndex>): PgaTourStatRow | null {
  for (const row of rows) {
    if (resolveGolfer(row.playerName, rosterIndex)?.espnId === espnId) return row;
  }
  return null;
}

/**
 * One golfer's full advanced-stats board — 19 separate pgatour.com page
 * fetches, each independently cached 24h so only the first request per
 * stat/season pays the real cost. Fetched in parallel, not sequentially.
 *
 * A "Last 5 / Last 15 events" recent-form comparison was planned alongside
 * this (Power/Accuracy/Short Game/Putting/Scoring ratings) but every one of
 * those 10 candidate stat IDs 404s at this same URL pattern — confirmed live,
 * not a guess — so that page structure doesn't exist the way the rest of
 * these do. Dropped rather than shipping fetches that always fail.
 */
export async function getGolferAdvancedStats(
  espnId: string,
  subjects: SubjectSummary[],
  year = new Date().getFullYear(),
): Promise<{ stats: AdvancedStat[]; warnings: string[] }> {
  const rosterIndex = buildGolfRosterIndex(subjects);
  const warnings: string[] = [];

  const stats = await Promise.all(
    ADVANCED_STAT_DEFS.map(async (def) => {
      const { rows, warning } = await loadStatRows(def.statId, year);
      if (warning) warnings.push(warning);
      const row = findGolferRow(rows, espnId, rosterIndex);

      // Field range for the plot: whoever pgatour.com ranked #1 and last on
      // this page, plus the mean of every ranked row — computed from the
      // same `rows` this golfer's own value came from, not a second fetch.
      const values = rows.map(primaryStatValue).filter((v): v is number => v != null);
      const bestRow = rows.find((r) => r.rank === 1) ?? null;
      const worstRow = rows.reduce<PgaTourStatRow | null>((worst, r) => (!worst || r.rank > worst.rank ? r : worst), null);

      const stat: AdvancedStat = {
        key: def.key,
        label: def.label,
        category: def.category,
        value: row ? primaryStatValue(row) : null,
        decimals: def.decimals,
        rank: row?.rank ?? null,
        poolSize: rows.length,
        bestValue: bestRow ? primaryStatValue(bestRow) : null,
        worstValue: worstRow ? primaryStatValue(worstRow) : null,
        avgValue: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
      };
      return stat;
    }),
  );

  return { stats, warnings };
}
