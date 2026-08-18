import type { CSSProperties, ReactNode } from 'react';

/**
 * The one chip/pill/badge primitive. Consolidates eight near-duplicate
 * recipes (`.lb-chip`, RecordChip, HitRateBadge, ConfidenceChip,
 * PropScoreBadge, ScanTable's reason pills, FilterBar's FILTER_BASE,
 * TeamBadge/ResultBadge) into one implementation — see the design spec.
 *
 * `shape` preserves the one distinction that actually carried meaning:
 * prices are boxed (`box`, matching OddsChip), everything else is a pill.
 * Each shape keeps its own size recipe rather than forcing both into one
 * set of paddings, since a pill and a box never looked identical anyway.
 */

export type ChipShape = 'pill' | 'box';
export type ChipTone = 'neutral' | 'good' | 'warn' | 'bad' | 'masters';
export type ChipSize = 'sm' | 'md';

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: 'bg-ink/5 text-ink-muted',
  good: 'bg-good/10 text-good',
  warn: 'bg-warn/10 text-warn',
  bad: 'bg-bad/10 text-bad',
  masters: 'bg-masters text-white',
};

const RECIPES: Record<ChipShape, Record<ChipSize, string>> = {
  pill: { sm: 'rounded-full px-2 py-0.5 text-dense', md: 'rounded-full px-2.5 py-1 text-body' },
  box: { sm: 'rounded-md px-1.5 py-0.5 text-meta', md: 'rounded-md px-2 py-1 text-body' },
};

export interface ChipProps {
  children: ReactNode;
  shape?: ChipShape;
  /** Ignored when `style` supplies its own color/background (e.g. a computed heat-ramp fill). */
  tone?: ChipTone;
  size?: ChipSize;
  className?: string;
  title?: string;
  style?: CSSProperties;
}

export function Chip({ children, shape = 'pill', tone = 'neutral', size = 'sm', className = '', title, style }: ChipProps) {
  const toneClass = style ? '' : TONE_CLASSES[tone];
  return (
    <span
      title={title}
      style={style}
      className={`inline-flex items-center gap-1 font-medium tabular-nums ${RECIPES[shape][size]} ${toneClass} ${className}`}
    >
      {children}
    </span>
  );
}

export default Chip;
