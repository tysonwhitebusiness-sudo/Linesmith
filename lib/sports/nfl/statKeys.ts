/**
 * Feeds NFL Game Detail's ported Rankings section (GameDetail.tsx's
 * RankingsHeatGrid/RankingsScale/RankingsTiers, all keyed on
 * `Record<string, string | null>` pre-formatted ordinals) — nflverse's own
 * `NflverseTeamStatLine[]` (nflverse.ts) carries a raw `rank: number`
 * instead, so this module bridges the two shapes rather than changing
 * either existing one.
 */

import type { NflverseTeamStatLine } from './nflverse';

export interface StatKeyDef {
  key: string;
  label: string;
  decimals: number;
}

/** A curated headline subset of nflverse.ts's full STAT_DEFS — same spirit as MLB's own StatKeyDef list for Rankings (not literally every stat in teamStats, just the ones worth a side-by-side rank comparison). */
export const NFL_STAT_KEYS: StatKeyDef[] = [
  { key: 'points-per-game', label: 'Points/Gm', decimals: 1 },
  { key: 'pass-yards', label: 'Pass Yds/Gm', decimals: 1 },
  { key: 'pass-tds', label: 'Pass TD/Gm', decimals: 2 },
  { key: 'rush-yards', label: 'Rush Yds/Gm', decimals: 1 },
  { key: 'rush-tds', label: 'Rush TD/Gm', decimals: 2 },
  { key: 'def-sacks', label: 'Sacks/Gm', decimals: 1 },
  { key: 'def-interceptions', label: 'INTs/Gm', decimals: 2 },
  { key: 'turnovers', label: 'Turnovers/Gm', decimals: 1 },
];

function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

/**
 * Which headline stat has a real allowed counterpart in nflverse's
 * `DEFENSE_STAT_DEFS`, and under which key.
 *
 * Four of the eight do. The other four have none, and two of those
 * (`def-sacks`, `def-interceptions`) are already defensive stats, so an
 * "allowed" version of them would not mean anything. They stay `null`, which
 * the grid renders as "—" (F-B1: they used to be filled with the OPPOSING
 * team's produced rank).
 */
const ALLOWED_KEY_BY_STAT: Record<string, string | undefined> = {
  'pass-yards': 'pass-yards-allowed',
  'pass-tds': 'pass-tds-allowed',
  'rush-yards': 'rush-yards-allowed',
  'rush-tds': 'rush-tds-allowed',
};

/** The "against" half: this team's OWN allowed ranks, from `getTeamDefenseAllowedWithRank`. */
export function toAgainstRanks(teamDefenseAllowed: NflverseTeamStatLine[]): Record<string, string | null> {
  const byKey = new Map(teamDefenseAllowed.map((s) => [s.key, s]));
  const out: Record<string, string | null> = {};
  for (const def of NFL_STAT_KEYS) {
    const allowedKey = ALLOWED_KEY_BY_STAT[def.key];
    const line = allowedKey ? byKey.get(allowedKey) : undefined;
    out[def.key] = line ? ordinal(line.rank) : null;
  }
  return out;
}

/** Ordinal-formats each headline stat's rank for one team's own production — the "for" half of RankingsHeatGrid's for/against pair. */
export function toForRanks(teamStats: NflverseTeamStatLine[]): Record<string, string | null> {
  const byKey = new Map(teamStats.map((s) => [s.key, s]));
  const out: Record<string, string | null> = {};
  for (const def of NFL_STAT_KEYS) {
    const line = byKey.get(def.key);
    out[def.key] = line ? ordinal(line.rank) : null;
  }
  return out;
}
