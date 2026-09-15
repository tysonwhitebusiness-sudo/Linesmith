'use client';

import { heatFill } from '@/lib/ui/heat';
import { RankRow } from './ui';
import { percentileOf } from './PercentileRing';
import { ordinal, type OpposingStarterStat } from './PlayerDetail';

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

/**
 * The two-sided bar's colour, or a flat neutral grey for a stat with no
 * good/bad direction (R2). The bar's LENGTH still shows where the value sits;
 * only the verdict is withheld.
 */
function barColor(stat: OpposingStarterStat, pct: number): string {
  return stat.neutral ? 'oklch(var(--ink-faint))' : heatFill(pct / 100);
}

/**
 * Two-sided variant of the same row grammar — subject's bar grows leftward
 * from center, opponent's grows rightward, for a stat both sides genuinely
 * share (e.g. Quality of Contact's 4 keys). Center label is neutral; which
 * side means "produces" vs. "allows" is established once, in the card's own
 * header, not repeated per row.
 */
export function TwoSidedStatRankRow({
  label,
  subject,
  opponent,
}: {
  label: string;
  subject?: OpposingStarterStat;
  opponent?: OpposingStarterStat;
}) {
  const sp = subject ? (percentileOf(subject) ?? 0) : 0;
  const op = opponent ? (percentileOf(opponent) ?? 0) : 0;
  return (
    <div className="py-1">
      <div className="grid grid-cols-[44px_1fr_1fr_44px] items-center gap-1.5">
        <span className="text-right text-[10.5px] font-semibold tabular-nums">
          {subject ? subject.value.toFixed(subject.decimals) : '—'}
        </span>
        <div className="h-[5px] overflow-hidden rounded-full bg-line-hair">
          <div className="ml-auto h-full rounded-full" style={{ width: `${sp}%`, backgroundColor: subject ? barColor(subject, sp) : heatFill(sp / 100) }} />
        </div>
        <div className="h-[5px] overflow-hidden rounded-full bg-line-hair">
          <div className="h-full rounded-full" style={{ width: `${op}%`, backgroundColor: opponent ? barColor(opponent, op) : heatFill(op / 100) }} />
        </div>
        <span className="text-[10.5px] font-semibold tabular-nums">
          {opponent ? opponent.value.toFixed(opponent.decimals) : '—'}
        </span>
      </div>
      <div className="text-center text-[9px] uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  );
}
