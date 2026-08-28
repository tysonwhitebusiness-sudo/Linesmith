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
  /** Soccer's real third moneyline outcome — baseball/football/basketball/hockey never
   * set this. Added alongside game_odds_book_lines's multi-source read path, which
   * writes a real 'draw' side for soccer's moneyline (the-odds-api, ESPN). */
  drawOdds?: number;
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
  /** Best available moneyline (for quick display). `draw` is soccer-only. */
  moneyline?: { home?: number; away?: number; draw?: number; book?: string };
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
   * When the newest underlying price was actually fetched — NOT when this
   * object was built (Phase 1.2, audit finding P3 C4).
   *
   * `mergeGameOddsBookLineRows` reads `fetched_at` off every row to pick the
   * latest per book+market+side, then used to discard it, leaving callers with
   * no per-row timestamp at all. `/api/odds/lines` filled that gap by stamping
   * `new Date().toISOString()` unconditionally — so during the 17.5-hour outage
   * the audit observed, day-old prices were served with a timestamp asserting
   * they had just been fetched.
   *
   * Optional because not every producer of a UnifiedGameLine has a real
   * timestamp to offer; absent is honest, `now()` is not.
   */
  lastFetchedAt?: string;
  /**
   * Which source(s) contributed to this line. `odds-api`/`oddsharvester`/
   * `both` are MLB's existing values (see merge.ts); `sharpapi`/`rundown`/
   * `sportsgameodds`/`multiple` are NFL's (see nflGameLines.ts) — kept in the
   * same union rather than a second type so `UnifiedGameLine` stays one
   * shape across sports. `the-odds-api`/`espn`/`propline`/`game-odds-book-
   * lines` are the real `source` column values game_odds_book_lines's
   * multi-source read path (readGameOddsBookLines, lib/db/client.ts) can
   * report — `game-odds-book-lines` specifically means "more than one real
   * source contributed, no single tag is accurate" (a genuinely different
   * case from NFL's pre-existing `multiple`, which meant "more than one of
   * a fixed set of NFL-only providers" — kept distinct rather than reusing
   * `multiple` so a reader can't conflate the two provenances).
   */
  source:
    | 'odds-api'
    | 'oddsharvester'
    | 'both'
    | 'sharpapi'
    | 'rundown'
    | 'sportsgameodds'
    | 'multiple'
    | 'the-odds-api'
    | 'espn'
    | 'propline'
    | 'game-odds-book-lines';
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
