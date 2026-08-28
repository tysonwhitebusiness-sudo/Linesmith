/**
 * Which pick_history `dimension` value(s) count as a sport's "rare
 * market" — Phase 5/6 of docs/daily-picks-full-model-build-2026-08-27.md.
 * Shared by app/api/picks/props/route.ts (excludes these from the
 * regular top-10 list) and app/api/picks/rare-markets/route.ts (the only
 * dimensions it includes), so the two routes can never silently drift
 * out of sync with each other or with predict/generic_rare_markets.py's
 * own real dimension names (NFL_RARE_DIMENSION/CFB_RARE_DIMENSION/
 * NHL_RARE/SOCCER_RARE/NBA_RARE_DIMENSION).
 */
import type { Sport } from '@/lib/core/types';

export const RARE_MARKET_DIMENSIONS: Record<Sport, string[]> = {
  mlb: ['home-runs'],
  nfl: ['anytime-td'],
  cfb: ['anytime-td'],
  nba: ['triple-double'],
  nhl: ['goals'],
  soccer: ['anytime-goalscorer'],
  golf: [],
  tennis: [],
};

/** Display label for a sport's rare-market tab — Phase 8's per-sport tab naming. */
export const RARE_MARKET_TAB_LABEL: Record<Sport, string> = {
  mlb: 'Home Runs',
  nfl: 'Anytime TD',
  cfb: 'Anytime TD',
  nba: 'Triple-Doubles',
  nhl: 'Goals',
  soccer: 'Anytime Goalscorer',
  golf: '',
  tennis: '',
};
