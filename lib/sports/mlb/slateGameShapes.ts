/**
 * The game the MLB snapshot attaches to its slate (`context.other.games`), and
 * the stat keys it ranks teams on (`context.other.statKeys`).
 *
 * These lived in `components/GameDetail.tsx` as `GameDetailGame` until R11a
 * deleted that page: the MLB adapter shaped each slate game for it. The page
 * is gone; the shape is still the snapshot's, read by the MLB game, team and
 * teams routes and by the player page's season-stat rows, so it moved here
 * under the name of what it is.
 */

import type { SlateGame } from '@/lib/odds/matching';

export interface TeamGameContext {
  teamId: number;
  record: { wins: number; losses: number } | null;
  divisionRank: string | null;
  homeRecord: { wins: number; losses: number } | null;
  awayRecord: { wins: number; losses: number } | null;
  lastTen: { wins: number; losses: number } | null;
  forStats: Record<string, number | null>;
  /** Undivided season totals, alongside `forStats`'s per-game rate — same numbers, before the `perGame` division. */
  forStatsSeason: Record<string, number | null>;
  againstStats: Record<string, number | null>;
  forRanks: Record<string, string | null>;
  againstRanks: Record<string, string | null>;
}

export interface MlbSlateGame extends SlateGame {
  away?: TeamGameContext;
  home?: TeamGameContext;
  weatherNarrative?: string | null;
  /** MLB person IDs for the two probable starters — the ids behind their headshots. */
  awayStarterId?: number | null;
  homeStarterId?: number | null;
}

export interface StatKeyDef {
  key: string;
  label: string;
  /** Places for the SEASON TOTAL. For MLB, `3` also marks a rate stat. */
  decimals: number;
  /** Places for the PER-GAME rate, where that differs (F-B5). Falls back to `decimals`. */
  perGameDecimals?: number;
}
