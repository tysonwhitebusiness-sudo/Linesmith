'use client';

import { heatFill } from '@/lib/ui/heat';
import { percentileOf } from './PercentileRing';
import { ordinal, type OpposingStarterStat } from './PlayerDetail';

/**
 * The shared "advanced stats" row style — label + rank bar + value + ordinal
 * — used everywhere a single stat's value and league rank need to read the
 * same way: Team Detail's Advanced Stats/Season Team Stats, Player Detail's
 * Hitter Stats card, and the matchup card's solo (non-shared) stat rows.
 */
export function StatRankRow({ stat }: { stat: OpposingStarterStat }) {
  const pct = percentileOf(stat) ?? 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-[9px] uppercase tracking-wide text-ink-faint">{stat.label}</span>
      <div className="h-[5px] flex-1 rounded-full bg-line-hair">
        <div className="h-[5px] rounded-full" style={{ width: `${pct}%`, backgroundColor: heatFill(pct / 100) }} />
      </div>
      <span className="w-10 shrink-0 text-right text-[10.5px] font-semibold tabular-nums">{stat.value.toFixed(stat.decimals)}</span>
      <span className="w-16 shrink-0 truncate text-right text-[9px] text-ink-faint" title={`${stat.rank} of ${stat.poolSize}`}>
        {ordinal(stat.rank)} of {stat.poolSize}
      </span>
    </div>
  );
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
          <div className="ml-auto h-full rounded-full" style={{ width: `${sp}%`, backgroundColor: heatFill(sp / 100) }} />
        </div>
        <div className="h-[5px] overflow-hidden rounded-full bg-line-hair">
          <div className="h-full rounded-full" style={{ width: `${op}%`, backgroundColor: heatFill(op / 100) }} />
        </div>
        <span className="text-[10.5px] font-semibold tabular-nums">
          {opponent ? opponent.value.toFixed(opponent.decimals) : '—'}
        </span>
      </div>
      <div className="text-center text-[9px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}
