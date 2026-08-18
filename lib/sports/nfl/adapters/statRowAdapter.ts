import type { OpposingStarterStat } from '@/components/PlayerDetail';

const NFL_TEAM_COUNT = 32;

/** Raw nflverse-derived stat line, shared shape across Game/Player/Team detail. */
export interface NflvStatLine {
  key: string;
  label: string;
  value: number;
  rank: number;
  decimals: number;
  group?: string;
}

/**
 * Converts an NFL stat line into the shared `OpposingStarterStat[]` shape
 * `StatRankRow`/`TwoSidedStatRankRow`/`BatterPitcherMatchupCard` consume.
 *
 * Canonical replacement for the three near-identical local `toStat`/`toStatRow`
 * functions and local `NflvTeamStatLine`/`NflvStatLine` type declarations that used
 * to live separately in `NflGameDetail.tsx`, `NflPlayerDetail.tsx`, and
 * `NflTeamDetail.tsx` — all three hardcoded `poolSize: 32` inline via their own
 * local `NFL_TEAM_COUNT` const; `poolSize` is now a parameter defaulted to 32 so
 * existing call sites need no argument change.
 */
export function toStatRow(l: NflvStatLine, poolSize = NFL_TEAM_COUNT): OpposingStarterStat {
  return { key: l.key, label: l.label, value: l.value, decimals: l.decimals, rank: l.rank, poolSize };
}
