'use client';
import { RankRow } from './ui';
import { percentileOf } from './PercentileRing';
import { type OpposingStarterStat } from './PlayerDetail';

/**
 * The shared "advanced stats" row style — label + rank bar + value + ordinal
 * — used everywhere a single stat's value and league rank need to read the
 * same way: Team Detail's Advanced Stats/Season Team Stats, Player Detail's
 * Hitter Stats card, and the matchup card's solo (non-shared) stat rows.
 */
export function StatRankRow({ stat }: { stat: OpposingStarterStat }) {
  // R3: rendered by the design-system RankRow (percentile dot strip, a real
  // tooltip). `percentileOf` is rank-based, so 100 is already the BEST in the
  // stat's direction; a `neutral` stat (R2) keeps its position and loses the
  // verdict color. This replaced a hand-rolled bar whose neutral fill pointed
  // at a CSS variable that does not exist (`--color-ink-faint`).
  const pct = percentileOf(stat) ?? 0;
  return (
    <RankRow
      label={stat.label}
      valueText={stat.value.toFixed(stat.decimals)}
      percentile={pct}
      direction={stat.neutral ? 'neutral' : 'higher'}
      rank={{ rank: stat.rank, of: stat.poolSize }}
    />
  );
}
