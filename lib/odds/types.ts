/**
 * Shared odds types used by both the-odds-api and OddsHarvester sources.
 *
 * Extracted from oddsApi.ts so the merge layer and API route can reference them
 * without importing the entire the-odds-api integration.
 */

// ---------------------------------------------------------------------------
// Per-bookmaker detail
// ---------------------------------------------------------------------------

export interface BookmakerOdds {
  bookmaker: string;
  homeOdds?: number; // decimal
  awayOdds?: number;
  overPrice?: number;
  underPrice?: number;
  point?: number;
  spreadHome?: number;
  spreadHomePrice?: number;
  spreadAway?: number;
  spreadAwayPrice?: number;
}

// ---------------------------------------------------------------------------
// Single game line (the unified output)
// ---------------------------------------------------------------------------

export interface UnifiedGameLine {
  eventId: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  /** Best available moneyline (for quick display). */
  moneyline?: { home?: number; away?: number; book?: string };
  /** Best available spread. */
  spread?: { homePoint?: number; homePrice?: number; awayPoint?: number; awayPrice?: number; book?: string };
  /** Best available total. */
  total?: { point?: number; overPrice?: number; underPrice?: number; book?: string };
  /** Per-bookmaker breakdown (from OddsHarvester). */
  bookmakers: BookmakerOdds[];
  /** Live in-play data (from OddsHarvester live mode). */
  livePeriod?: string;
  liveScore?: { home: string; away: string };
  /** How many distinct books contributed data. */
  bookCount: number;
  /**
   * Which source(s) contributed to this line. `odds-api`/`oddsharvester`/
   * `both` are MLB's existing values (see merge.ts); `sharpapi`/`rundown`/
   * `sportsgameodds`/`multiple` are NFL's (see nflGameLines.ts) — kept in the
   * same union rather than a second type so `UnifiedGameLine` stays one
   * shape across sports.
   */
  source: 'odds-api' | 'oddsharvester' | 'both' | 'sharpapi' | 'rundown' | 'sportsgameodds' | 'multiple';
}

// ---------------------------------------------------------------------------
// Top-level result envelope
// ---------------------------------------------------------------------------

export interface UnifiedLinesResult {
  enabled: boolean;
  lines: UnifiedGameLine[];
  fetchedAt: string | null;
  fromCache: boolean;
  sources: {
    oddsApi: { enabled: boolean; fetchedAt: string | null; requestsRemaining: number | null };
    oddsHarvester: { enabled: boolean; fetchedAt: string | null; matches: number };
  };
  nextRefreshAt: string | null;
  warnings: string[];
}
