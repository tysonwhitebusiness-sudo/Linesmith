import type { GameDetailGame, StatKeyDef } from '@/components/GameDetail';
import type { OpposingStarterStat } from '@/components/PlayerDetail';

/** `forRanks` are pre-formatted ordinal strings ("28th") — pulls the raw int back out. */
function parseRank(s: string | null | undefined): number | null {
  const m = /^(\d+)/.exec(s ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Converts a team's season `forStats`/`forRanks` into the shared `OpposingStarterStat[]`
 * shape `StatRankRow`/`TwoSidedStatRankRow`/`BatterPitcherMatchupCard` consume.
 *
 * Canonical replacement for the byte-identical duplicate functions that used to live
 * separately in `TeamDetail.tsx` and `PlayerDetail.tsx` (both hardcoded `poolSize: 30`
 * inline) — same logic, `poolSize` is now a parameter instead of a third copy of the
 * hardcode, defaulted to 30 so existing call sites need no argument change.
 */
export function teamSeasonStatRows(
  team: GameDetailGame['home'],
  statKeys: StatKeyDef[],
  poolSize = 30,
): OpposingStarterStat[] {
  if (!team) return [];
  return statKeys
    .map((k): OpposingStarterStat | null => {
      const value = team.forStats[k.key];
      const rank = parseRank(team.forRanks[k.key]);
      if (value == null || rank == null) return null;
      return { key: k.key, label: k.label, value, decimals: k.decimals, rank, poolSize };
    })
    .filter((s): s is OpposingStarterStat => s != null);
}
