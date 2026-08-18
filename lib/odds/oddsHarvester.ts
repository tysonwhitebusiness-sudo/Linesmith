/**
 * Read OddsHarvester JSON output from the filesystem.
 *
 * OddsHarvester is a Python CLI that writes JSON to disk when run via cron or
 * Docker. This module reads those files and normalises them into a typed form
 * the merge layer can consume.
 *
 * Nothing here calls Python or starts a subprocess — the scraping and the
 * reading are deliberately decoupled by the filesystem.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BookmakerOdds } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');

// ---------------------------------------------------------------------------
// Raw OddsHarvester JSON shapes
// ---------------------------------------------------------------------------

interface HarvesterMarket {
  market_name: string;
  period: string;
  bookmakers: Array<{
    name: string;
    home_odds?: number;
    away_odds?: number;
    over_odds?: number;
    under_odds?: number;
    point?: number;
    home_spread?: number;
    home_spread_price?: number;
    away_spread?: number;
    away_spread_price?: number;
  }>;
}

interface HarvesterRecord {
  match_url: string;
  match_date: string;
  home_team: string;
  away_team: string;
  final_score?: { home: string; away: string };
  season?: string;
  live_period?: string;
  live_score_home?: string;
  live_score_away?: string;
  markets?: HarvesterMarket[];
}

// ---------------------------------------------------------------------------
// Normalised output
// ---------------------------------------------------------------------------

export interface HarvesterMatch {
  matchUrl: string;
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  livePeriod?: string;
  liveScore?: { home: string; away: string };
  bookmakers: BookmakerOdds[];
}

export interface HarvesterOutput {
  matches: HarvesterMatch[];
  fetchedAt: string | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normaliseBookmakerOdds(raw: HarvesterMarket): BookmakerOdds[] {
  return (raw.bookmakers ?? []).map((b) => ({
    bookmaker: b.name,
    homeOdds: b.home_odds,
    awayOdds: b.away_odds,
    overPrice: b.over_odds,
    underPrice: b.under_odds,
    point: b.point,
    spreadHome: b.home_spread,
    spreadHomePrice: b.home_spread_price,
    spreadAway: b.away_spread,
    spreadAwayPrice: b.away_spread_price,
  }));
}

/** Later markets fill gaps; they never blank out a price already read. */
function mergeBookmaker(base: BookmakerOdds, next: BookmakerOdds): BookmakerOdds {
  return {
    bookmaker: base.bookmaker,
    homeOdds: base.homeOdds ?? next.homeOdds,
    awayOdds: base.awayOdds ?? next.awayOdds,
    overPrice: base.overPrice ?? next.overPrice,
    underPrice: base.underPrice ?? next.underPrice,
    point: base.point ?? next.point,
    spreadHome: base.spreadHome ?? next.spreadHome,
    spreadHomePrice: base.spreadHomePrice ?? next.spreadHomePrice,
    spreadAway: base.spreadAway ?? next.spreadAway,
    spreadAwayPrice: base.spreadAwayPrice ?? next.spreadAwayPrice,
  };
}

function normaliseMatch(raw: HarvesterRecord): HarvesterMatch {
  // One book quotes several markets — moneyline in one block, totals in
  // another — so entries have to be merged field by field. Replacing wholesale
  // means whichever market OddsHarvester emitted last wins and the rest of that
  // book's prices vanish.
  const bookmakerMap = new Map<string, BookmakerOdds>();
  for (const market of raw.markets ?? []) {
    for (const b of normaliseBookmakerOdds(market)) {
      const existing = bookmakerMap.get(b.bookmaker);
      bookmakerMap.set(b.bookmaker, existing ? mergeBookmaker(existing, b) : b);
    }
  }

  return {
    matchUrl: raw.match_url,
    matchDate: raw.match_date,
    homeTeam: raw.home_team,
    awayTeam: raw.away_team,
    livePeriod: raw.live_period,
    liveScore:
      raw.live_score_home != null || raw.live_score_away != null
        ? { home: raw.live_score_home ?? '—', away: raw.live_score_away ?? '—' }
        : undefined,
    bookmakers: [...bookmakerMap.values()],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the most recent OddsHarvester output for a sport.
 *
 * @param sport  OddsHarvester sport key, e.g. "baseball", "basketball".
 * @param mode   "live" or "upcoming" — matches the cron output filename.
 */
export function readHarvesterOutput(sport: string, mode: 'live' | 'upcoming'): HarvesterOutput {
  const filePath = path.join(DATA_DIR, `${sport}_${mode}.json`);

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { matches: [], fetchedAt: null };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { matches: [], fetchedAt: null, error: `Invalid JSON in ${filePath}` };
  }

  // OddsHarvester can output a single record array or a larger structure.
  const records: HarvesterRecord[] = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.results)
      ? (data as any).results
      : [];

  let mtime: Date | null = null;
  try {
    mtime = fs.statSync(filePath).mtime;
  } catch {
    // ignore
  }

  return {
    matches: records.map(normaliseMatch),
    fetchedAt: mtime?.toISOString() ?? null,
  };
}

/**
 * Check whether OddsHarvester output exists and is reasonably fresh.
 *
 * @returns true if a file exists and was modified within `maxAgeMinutes`.
 */
export function harvesterOutputFresh(sport: string, mode: 'live' | 'upcoming', maxAgeMinutes = 10): boolean {
  const filePath = path.join(DATA_DIR, `${sport}_${mode}.json`);
  try {
    const stat = fs.statSync(filePath);
    const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
    return ageMinutes < maxAgeMinutes;
  } catch {
    return false;
  }
}
