'use client';

import type { PropScore } from '@/lib/odds/props/propScore';
import type { MarketTrust } from '@/lib/odds/props/marketTrust';
import { MARKET_TRUST_LABEL } from '@/lib/odds/props/marketTrust';
import { heatFill } from '@/lib/ui/heat';

/**
 * Prop Score v1's shared badge — score number + letter grade + Market Trust
 * chip, one implementation used by ScanTable, ScanCard, and PlayerDetail so
 * the rating reads identically wherever it appears (same instinct as
 * OddsChip). Score and trust are shown side by side, never combined into one
 * number — see propScore.ts's file comment for why folding trust into the
 * score multiplicatively was tried and reverted.
 *
 * Circular, continuously-graded background (heatFill — same red→amber→green
 * ramp every other percentage in this app reads off, see lib/ui/heat.ts) in
 * place of the old three-bucket border/text lookup: a 100 sits in a solid
 * green circle, a 50 in the amber middle, a low score in red — the color
 * tracks the exact score, not five discrete steps, matching how the
 * gradient-rate cells elsewhere in Scan already work. `heatFill`'s stops are
 * all dark/saturated by design ("for bars, badges and backgrounds"), so a
 * fixed white foreground stays legible across the whole ramp — no separate
 * per-point contrast calculation needed.
 */

const TRUST_STYLE: Record<MarketTrust, string> = {
  proven: 'text-good',
  weak: 'text-ink-faint',
  building: 'text-ink-faint',
  excluded: 'text-warn',
};

function scoreTitle(score: PropScore): string {
  const { M, E, P, X } = score.components;
  const parts = [
    `Model ${M >= 0 ? '+' : ''}${M.toFixed(2)}`,
    `Book edge ${score.hasLiveEdge ? `${E! >= 0 ? '+' : ''}${E!.toFixed(2)}` : 'no live price'}`,
    `Performance ${P.toFixed(2)}${score.performanceLabel ? ` (${score.performanceLabel})` : ''}`,
    `Matchup ${X > 0 ? 'favorable' : 'neutral'}`,
  ];
  return parts.join(' · ');
}

export function PropScoreBadge({
  score,
  trust,
  size = 'sm',
  className = '',
}: {
  score: PropScore | null;
  trust: MarketTrust | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  if (trust === 'excluded') {
    return (
      <span className={`text-[10px] text-warn ${className}`} title="This market's live model has shown consistent negative skill — no score shown.">
        Excluded
      </span>
    );
  }

  if (!score) {
    return <span className={`text-[11px] text-ink-faint ${className}`}>—</span>;
  }

  const circleClass = size === 'md' ? 'h-12 w-12' : 'h-9 w-9';
  const gradeTextClass = size === 'md' ? 'text-[13px]' : 'text-[11px]';
  const pctTextClass = size === 'md' ? 'text-[9px]' : 'text-[8px]';
  const fill = heatFill(Math.min(1, Math.max(0, score.score / 100)));

  return (
    <span className={`inline-flex flex-col items-center gap-0.5 ${className}`}>
      <span
        className={`inline-flex flex-col items-center justify-center rounded-full leading-none text-white shadow-sm ${circleClass}`}
        style={{ backgroundColor: fill }}
        title={scoreTitle(score)}
      >
        <span className={`font-bold tabular-nums ${gradeTextClass}`}>{score.grade}</span>
        <span className={`tabular-nums opacity-90 ${pctTextClass}`}>{score.score}%</span>
      </span>
      {trust ? (
        <span className={`text-[9px] ${TRUST_STYLE[trust]}`} title="Market Trust — how much live-graded evidence backs this market's own model, separate from this pick's own score.">
          {MARKET_TRUST_LABEL[trust]}
        </span>
      ) : null}
    </span>
  );
}
