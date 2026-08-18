/**
 * Baseball Savant / Statcast client — pitcher-quality metrics (whiff%,
 * barrel%, exit velocity, hard-hit%) that MLB StatsAPI doesn't carry.
 *
 * The `statcast_search/csv` endpoint is the same public, keyless endpoint
 * Savant's own "Download CSV" button hits — confirmed live: no auth headers,
 * no request signing. It also caps a single query at roughly 25,000 rows
 * (confirmed live: a full 2026-season-to-date pull for pitchers truncated at
 * exactly 25,000, ~17MB, well short of a real season's pitch count), so this
 * never asks for more than a season in one shot. A single day is ~3,000
 * pitch rows — this fetches in ~6-day chunks (safely under the cap) and
 * folds each chunk into a running per-pitcher aggregate rather than
 * re-requesting the season from scratch, which both respects the cap and
 * keeps the daily refresh cheap (see `getSeasonStatcastPitcherRates`).
 */

import { readSnapshotCache, writeSnapshotCache } from '../../db/client';
import { easternDate, shiftDate } from './statsapi';

const SAVANT_BASE = 'https://baseballsavant.mlb.com/statcast_search/csv';

/**
 * Simplified barrel definition — the real MLB formula widens the qualifying
 * launch-angle range as exit velocity climbs past 98 mph (up to a much wider
 * window near 116 mph). This fixed 26°-30° band at 98+ mph captures the core
 * of it without porting the full lookup table — a v1 approximation, not the
 * official stat, same spirit as this codebase's other hand-set formulas.
 */
function isBarrel(exitVelo: number, launchAngle: number): boolean {
  return exitVelo >= 98 && launchAngle >= 26 && launchAngle <= 30;
}

const HARD_HIT_EXIT_VELO = 95;

/** A swing that could have produced a whiff — excludes takes (ball/called strike) and dead-ball events (HBP, automatic ball). */
const SWING_DESCRIPTIONS = new Set([
  'hit_into_play',
  'foul',
  'foul_tip',
  'foul_bunt',
  'swinging_strike',
  'swinging_strike_blocked',
  'missed_bunt',
]);
const WHIFF_DESCRIPTIONS = new Set(['swinging_strike', 'swinging_strike_blocked', 'missed_bunt']);

/** Quote-aware CSV line split — Savant's `des` column (the play-by-play sentence) routinely contains commas, so a bare `split(',')` misaligns every later column on rows where it does. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Identical bookkeeping whichever side of the pitch it's keyed by — `byPitcher` counts what a pitcher allowed, `byBatter` counts what a hitter produced off the same rows. */
interface PitcherStatcastAgg {
  personId: number;
  fullName: string;
  pitches: number;
  swings: number;
  whiffs: number;
  battedBalls: number;
  sumExitVelo: number;
  barrels: number;
  hardHitBalls: number;
}

function emptyAgg(personId: number, fullName: string): PitcherStatcastAgg {
  return { personId, fullName, pitches: 0, swings: 0, whiffs: 0, battedBalls: 0, sumExitVelo: 0, barrels: 0, hardHitBalls: 0 };
}

/**
 * One request, one date range (inclusive both ends) — folded into `intoPitcher`
 * (keyed by the `pitcher` column, pitcher-perspective) and `intoBatter` (keyed
 * by the `batter` column, batter-perspective) in place. Same rows, two keys:
 * every pitch already carries both the pitcher and batter MLBAM id, so this is
 * one query and one parse pass, not two. The query's `player_type: 'pitcher'`
 * only affects which side `player_name` names — the `batter`/`pitcher` id
 * columns themselves are always present regardless — so a batter aggregate
 * row's name isn't reliably available from this query and is left blank;
 * nothing downstream reads it (batter rows are joined back to a name the
 * caller already has, same as team rollups only ever need the id).
 */
async function ingestDateRange(
  startDate: string,
  endDate: string,
  intoPitcher: Map<number, PitcherStatcastAgg>,
  intoBatter: Map<number, PitcherStatcastAgg>,
): Promise<void> {
  const params = new URLSearchParams({
    all: 'true',
    hfGT: 'R|PO|S|=',
    player_type: 'pitcher',
    type: 'details',
    group_by: 'name',
    sort_col: 'pitches',
    player_event_sort: 'h_launch_speed',
    sort_order: 'desc',
    min_pitches: '0',
    min_results: '0',
    min_abs: '0',
    game_date_gt: startDate,
    game_date_lt: endDate,
  });
  const url = `${SAVANT_BASE}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let text: string;
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Savant HTTP ${res.status}`);
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const lines = text.replace(/^﻿/, '').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return;
  const header = parseCsvLine(lines[0]);
  const idx = (name: string) => header.indexOf(name);
  const pitcherIdx = idx('pitcher');
  const batterIdx = idx('batter');
  const nameIdx = idx('player_name');
  const typeIdx = idx('type');
  const descIdx = idx('description');
  const lsIdx = idx('launch_speed');
  const laIdx = idx('launch_angle');
  if (pitcherIdx < 0 || typeIdx < 0 || descIdx < 0) return; // header shape changed / empty result — skip rather than mis-parse

  const fold = (map: Map<number, PitcherStatcastAgg>, personId: number, name: string, description: string, isBattedBall: boolean, exitVelo: number, launchAngle: number) => {
    let agg = map.get(personId);
    if (!agg) {
      agg = emptyAgg(personId, name);
      map.set(personId, agg);
    }

    agg.pitches += 1;
    if (SWING_DESCRIPTIONS.has(description)) {
      agg.swings += 1;
      if (WHIFF_DESCRIPTIONS.has(description)) agg.whiffs += 1;
    }

    if (isBattedBall && Number.isFinite(exitVelo)) {
      agg.battedBalls += 1;
      agg.sumExitVelo += exitVelo;
      if (exitVelo >= HARD_HIT_EXIT_VELO) agg.hardHitBalls += 1;
      if (Number.isFinite(launchAngle) && isBarrel(exitVelo, launchAngle)) agg.barrels += 1;
    }
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const pitcherId = Number(cols[pitcherIdx]);
    const description = cols[descIdx];
    const isBattedBall = cols[typeIdx] === 'X';
    const exitVelo = Number(cols[lsIdx]);
    const launchAngle = Number(cols[laIdx]);

    if (Number.isFinite(pitcherId)) {
      fold(intoPitcher, pitcherId, cols[nameIdx] ?? '', description, isBattedBall, exitVelo, launchAngle);
    }

    if (batterIdx >= 0) {
      const batterId = Number(cols[batterIdx]);
      if (Number.isFinite(batterId)) {
        fold(intoBatter, batterId, '', description, isBattedBall, exitVelo, launchAngle);
      }
    }
  }
}

interface StatcastAggregateStore {
  season: number;
  /** Last calendar date (US Eastern) whose pitches are already folded into `byPitcher`/`byBatter` — the next refresh only needs everything after this. Both maps are derived from the identical date-range pull, so one cursor covers both. */
  lastIngestedDate: string | null;
  byPitcher: Record<string, PitcherStatcastAgg>;
  byBatter: Record<string, PitcherStatcastAgg>;
}

/** `v2` (not just `mlb:statcast-pitcher-agg`) because a pre-existing v1 cache has no `byBatter` at all — reusing its key would leave `byBatter` permanently empty for every date already covered by `lastIngestedDate`, since the incremental cursor would never re-walk those days. Bumping the key forces one full backfill that populates both maps consistently from the season floor. */
function cacheKey(season: number): string {
  return `mlb:statcast-agg:${season}:v2`;
}

function loadStore(season: number): StatcastAggregateStore {
  const cached = readSnapshotCache(cacheKey(season));
  if (!cached) return { season, lastIngestedDate: null, byPitcher: {}, byBatter: {} };
  try {
    const parsed = JSON.parse(cached.payload) as StatcastAggregateStore;
    if (parsed.season === season && parsed.byPitcher) return { ...parsed, byBatter: parsed.byBatter ?? {} };
  } catch {
    // fall through to a fresh store
  }
  return { season, lastIngestedDate: null, byPitcher: {}, byBatter: {} };
}

function saveStore(store: StatcastAggregateStore): void {
  writeSnapshotCache(cacheKey(store.season), JSON.stringify(store));
}

const CHUNK_DAYS = 6; // ~3,000 rows/day * 6 ≈ 18,000, safely under Savant's ~25,000-row cap per request
/** A season-long backfill is dozens of chunks — sequential awaits measured in the 10+ minute range against Savant's real response times. A handful concurrently is still a polite request rate, not a hammering one. */
const CONCURRENT_CHUNK_FETCHES = 5;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Brings the season's Statcast aggregate up to date through yesterday (US
 * Eastern) — today's games aren't finished, so they're deliberately excluded
 * rather than ingested half-complete. A fresh season starts from March 1 (a
 * safe pre-Opening-Day floor; the handful of empty spring-training days cost
 * nothing to include). Chunks the date range so no single request risks the
 * Savant row cap silently truncating results, and fetches chunks with bounded
 * concurrency rather than one at a time — a full-season first run is dozens
 * of chunks, and doing them sequentially is the difference between this
 * taking under a minute and taking the better part of ten.
 *
 * De-duped per season via `inFlight`: `getSeasonStatcastBatterRates` and
 * `getSeasonStatcastPitcherRates` read the same underlying store, and a
 * caller that wants both (see teamStatcast.ts) would otherwise kick off two
 * independent full backfills in parallel on a cold cache — doubling the
 * Savant request volume for no reason, since both end up computing the same
 * result. A concurrent second call just awaits the first call's promise
 * instead.
 */
const inFlight = new Map<number, Promise<StatcastAggregateStore>>();

function ensureFresh(season: number): Promise<StatcastAggregateStore> {
  const existing = inFlight.get(season);
  if (existing) return existing;
  const promise = ensureFreshUncached(season).finally(() => inFlight.delete(season));
  inFlight.set(season, promise);
  return promise;
}

async function ensureFreshUncached(season: number): Promise<StatcastAggregateStore> {
  const store = loadStore(season);
  const throughDate = shiftDate(easternDate(), -1);
  const seasonFloor = `${season}-03-01`;
  const cursor = store.lastIngestedDate ? shiftDate(store.lastIngestedDate, 1) : seasonFloor;
  if (cursor > throughDate) return store; // already fresh through yesterday

  const byPitcher = new Map<number, PitcherStatcastAgg>(
    Object.entries(store.byPitcher).map(([id, agg]) => [Number(id), agg]),
  );
  const byBatter = new Map<number, PitcherStatcastAgg>(
    Object.entries(store.byBatter).map(([id, agg]) => [Number(id), agg]),
  );

  const chunks: Array<{ start: string; end: string }> = [];
  let chunkStart = cursor;
  while (chunkStart <= throughDate) {
    const chunkEnd = shiftDate(chunkStart, CHUNK_DAYS - 1) > throughDate ? throughDate : shiftDate(chunkStart, CHUNK_DAYS - 1);
    chunks.push({ start: chunkStart, end: chunkEnd });
    chunkStart = shiftDate(chunkEnd, 1);
  }

  // Savant's own gt/lt params are exclusive, so each request widens by one day on each side to make the fetched range inclusive of [start, end]. Chunks are independent (each mutates a disjoint date slice), and concurrent mutation of the shared maps is safe here — JS never interleaves mid-callback, so each chunk's synchronous parse-and-fold loop always completes atomically once its own fetch resolves.
  await mapLimit(chunks, CONCURRENT_CHUNK_FETCHES, ({ start, end }) =>
    ingestDateRange(shiftDate(start, -1), shiftDate(end, 1), byPitcher, byBatter),
  );

  const updated: StatcastAggregateStore = {
    season,
    lastIngestedDate: throughDate,
    byPitcher: Object.fromEntries([...byPitcher.entries()].map(([id, agg]) => [String(id), agg])),
    byBatter: Object.fromEntries([...byBatter.entries()].map(([id, agg]) => [String(id), agg])),
  };
  saveStore(updated);
  return updated;
}

/** Shared rate shape — same four Statcast quality metrics whichever side of the pitch they're read from. `StatcastPitcherRates`/`StatcastBatterRates` are the same type under two names so call sites read as what they're actually holding. */
interface StatcastRates {
  whiffPct?: number;
  barrelPct?: number;
  exitVelo?: number;
  hardHitPct?: number;
  /** Pitches sampled — small samples are exactly why the composite scorer down-weights this bucket per-pitcher, same idea as the props model's `dampenForSample`. */
  pitchSampleSize: number;
}

export type StatcastPitcherRates = StatcastRates;
export type StatcastBatterRates = StatcastRates;

const MIN_SWINGS_FOR_WHIFF_RATE = 20;
const MIN_BATTED_BALLS_FOR_QUALITY_RATE = 15;

function ratesFromAggs(aggs: Record<string, PitcherStatcastAgg>): Map<number, StatcastRates> {
  const out = new Map<number, StatcastRates>();
  for (const agg of Object.values(aggs)) {
    out.set(agg.personId, {
      whiffPct: agg.swings >= MIN_SWINGS_FOR_WHIFF_RATE ? (agg.whiffs / agg.swings) * 100 : undefined,
      barrelPct: agg.battedBalls >= MIN_BATTED_BALLS_FOR_QUALITY_RATE ? (agg.barrels / agg.battedBalls) * 100 : undefined,
      exitVelo: agg.battedBalls >= MIN_BATTED_BALLS_FOR_QUALITY_RATE ? agg.sumExitVelo / agg.battedBalls : undefined,
      hardHitPct: agg.battedBalls >= MIN_BATTED_BALLS_FOR_QUALITY_RATE ? (agg.hardHitBalls / agg.battedBalls) * 100 : undefined,
      pitchSampleSize: agg.pitches,
    });
  }
  return out;
}

/** Season-to-date Statcast rate stats per pitcher, refreshing the underlying aggregate first if it's stale. Cheap on a cache hit — no network call, just JSON parsing of the stored aggregate. For the diagnostics-triggered refresh path only — see `getCachedStatcastPitcherRates` for the version safe to call from a live request. */
export async function getSeasonStatcastPitcherRates(season: number): Promise<Map<number, StatcastPitcherRates>> {
  const store = await ensureFresh(season);
  return ratesFromAggs(store.byPitcher);
}

/**
 * Same rates, but never triggers a live Savant fetch — reads only whatever's
 * already cached, even if it's a day or more stale. `ensureFresh` can take
 * up to a couple of minutes on a cold cache (a multi-day chunked backfill),
 * which is fine for a manually-triggered diagnostics refresh but not
 * acceptable inside a snapshot build every scan request goes through. If
 * nothing has ever been cached for this season yet, returns an empty map —
 * callers should treat that as "no Statcast data available yet", not an
 * error, and fall back to whatever stats don't depend on it.
 */
export function getCachedStatcastPitcherRates(season: number): Map<number, StatcastPitcherRates> {
  return ratesFromAggs(loadStore(season).byPitcher);
}

/** Batter-side equivalent — same store, same cursor, just the `byBatter` half of it. See `getSeasonStatcastPitcherRates`. */
export async function getSeasonStatcastBatterRates(season: number): Promise<Map<number, StatcastBatterRates>> {
  const store = await ensureFresh(season);
  return ratesFromAggs(store.byBatter);
}

/** Cache-only batter rates, safe for a live request. See `getCachedStatcastPitcherRates`. */
export function getCachedStatcastBatterRates(season: number): Map<number, StatcastBatterRates> {
  return ratesFromAggs(loadStore(season).byBatter);
}

// ---------------------------------------------------------------------------
// League-wide batter ranking on Statcast quality metrics alone — batters
// don't have an ERA/FIP-style traditional line in this pipeline, so unlike
// pitcherRankings.ts's role-classified, composite-scored pools, this ranks
// directly off the cached rates above with no separate StatsAPI fetch or
// disk cache of its own: it's already an in-memory read, cheap enough to
// recompute on demand.
// ---------------------------------------------------------------------------

export type BatterStatcastKey = 'barrelPct' | 'exitVelo' | 'hardHitPct' | 'whiffPct';

export const BATTER_STATCAST_RANK_KEYS: ReadonlyArray<{ key: BatterStatcastKey; label: string; decimals: number }> = [
  { key: 'barrelPct', label: 'barrel%', decimals: 1 },
  { key: 'exitVelo', label: 'avg exit velocity', decimals: 1 },
  { key: 'hardHitPct', label: 'hard-hit%', decimals: 1 },
  { key: 'whiffPct', label: 'whiff%', decimals: 1 },
];

/**
 * For a batter, high barrel%/exit velo/hard-hit% is good — they're squaring
 * the ball up — and low whiff% is good — they're making contact. The
 * opposite sense from `PITCHER_RANK_LOWER_IS_BETTER` (statsapi.ts), which
 * reads the same four metrics as what a pitcher *allowed*.
 */
export const BATTER_STATCAST_LOWER_IS_BETTER = new Set<BatterStatcastKey>(['whiffPct']);

/** Rank every batter with a qualifying rate this season against each other, 1 = best. Same ordinal mechanic as `rankPitchers` (statsapi.ts) — a dedicated copy rather than a shared generic, since the key sets and pitcher/batter direction tables are genuinely different shapes. */
export function rankBatterStatcast(rates: Map<number, StatcastBatterRates>): Map<number, Partial<Record<BatterStatcastKey, number>>> {
  const ranks = new Map<number, Partial<Record<BatterStatcastKey, number>>>([...rates.keys()].map((id) => [id, {}]));

  for (const { key } of BATTER_STATCAST_RANK_KEYS) {
    const lowerIsBetter = BATTER_STATCAST_LOWER_IS_BETTER.has(key);
    const withValue = [...rates.entries()]
      .filter(([, r]) => r[key] != null)
      .sort((a, b) => {
        const av = a[1][key] as number;
        const bv = b[1][key] as number;
        return lowerIsBetter ? av - bv : bv - av;
      });

    withValue.forEach(([id], index) => {
      const bucket = ranks.get(id);
      if (bucket) bucket[key] = index + 1;
    });
  }

  return ranks;
}
