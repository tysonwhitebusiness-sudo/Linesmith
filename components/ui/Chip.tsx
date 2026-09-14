import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { cx } from './cx';

/**
 * Chip — R3 3b: tone × size × shape. The one chip, pill or badge.
 *
 * Replaces `FilterChip`, `GradeChip`, `OddsChip` and `ConfidenceChip` as the
 * visual base (those keep their data logic and render through this).
 * `components/Chip.tsx` re-exports it, so its existing callers moved with it.
 *
 * Tones carry meaning and are used for it only:
 *  - `good` / `bad` only for a stat with a declared direction;
 *  - `live` only on a live element (it pulses);
 *  - `cmpA` / `cmpB` only for compare slots;
 *  - `strong` is the selected state of a pressable chip.
 *
 * Pass `onClick` and it becomes a real button with `aria-pressed` from
 * `selected`: the G2 window chips (Last 5 / Last 10 / Season).
 */
export type ChipTone = 'neutral' | 'good' | 'bad' | 'warn' | 'live' | 'cmpA' | 'cmpB' | 'strong' | 'masters';
/** `sm` the G2 chip (11px); `md` a compact body-size chip; `lg` the G2 window chip (Last 5 / Last 10 / Season). */
export type ChipSize = 'sm' | 'md' | 'lg';
export type ChipShape = 'pill' | 'box';

const TONE: Record<ChipTone, string> = {
  neutral: 'border-line-soft bg-card-sunk text-ink-secondary',
  good: 'border-good/25 bg-good/10 text-good',
  bad: 'border-bad/25 bg-bad/10 text-bad',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  live: 'border-good/25 bg-good/10 text-good',
  cmpA: 'border-cmp-a/30 bg-cmp-a/10 text-cmp-a',
  cmpB: 'border-cmp-b/30 bg-cmp-b/10 text-cmp-b',
  strong: 'border-masters bg-masters text-white',
  masters: 'border-masters bg-masters text-white',
};

const SIZE: Record<ChipShape, Record<ChipSize, string>> = {
  pill: { sm: 'rounded-full px-2 py-[3px] text-overline', md: 'rounded-full px-2.5 py-1 text-body-sm', lg: 'rounded-full px-3.5 py-2 text-body-sm' },
  box: { sm: 'rounded-md px-1.5 py-0.5 text-label', md: 'rounded-md px-2 py-1 text-body-sm', lg: 'rounded-ctl px-3 py-2 text-body-sm' },
};

export interface ChipProps {
  children: ReactNode;
  tone?: ChipTone;
  size?: ChipSize;
  shape?: ChipShape;
  /** Makes the chip a pressable button. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  selected?: boolean;
  /** A computed fill (a heat-ramp color) overrides the tone's colors. */
  style?: CSSProperties;
  className?: string;
  /** Kept for existing callers. New code: wrap the chip in `Tooltip`. */
  title?: string;
}

export function Chip({ children, tone = 'neutral', size = 'sm', shape = 'pill', onClick, selected, style, className, title }: ChipProps) {
  const effectiveTone: ChipTone = onClick && selected ? 'strong' : tone;
  const classes = cx(
    'inline-flex items-center gap-1.5 whitespace-nowrap border font-semibold tabular-nums',
    SIZE[shape][size],
    style ? 'border-transparent' : TONE[effectiveTone],
    className,
  );
  const dot = tone === 'live' ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-good animate-lb-pulse" /> : null;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        title={title}
        style={style}
        className={cx(classes, 'transition-colors duration-instant ease-standard', !selected && 'hover:border-ink-faint hover:text-ink')}
      >
        {dot}
        {children}
      </button>
    );
  }
  return (
    <span title={title} style={style} className={classes}>
      {dot}
      {children}
    </span>
  );
}

/** A dashed-outline status: "No line posted", "Not held", "Offseason". R3 3b `StatusPill`. */
export function StatusPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-line bg-card-sunk px-2 py-[3px] text-overline text-ink-muted', className)}>
      {children}
    </span>
  );
}

export default Chip;
