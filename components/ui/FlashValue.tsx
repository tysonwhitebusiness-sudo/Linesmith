'use client';

import { cx } from './cx';

/**
 * A live number (odds build P8, O1 — every price in the odds section). O1
 * renders it; P9 adds the roll to the new value, the green (up) / red (down)
 * flash and the fading ▲/▼ trail — which is why a price is this component
 * rather than a bare string: the animation lands in one place.
 */
export function FlashValue({ value, format, direction, className, best }: {
  value: number | null | undefined;
  format: (v: number) => string;
  direction?: 'up' | 'down' | null;
  changedAt?: string;
  /** The best price on its side: the `good` fill (O-A). */
  best?: boolean;
  className?: string;
}) {
  return (
    <span className={cx('tabular-nums', best && 'rounded-xs bg-good px-1 text-good-on', className)}
      data-direction={direction ?? undefined}>
      {value == null ? '—' : format(value)}
    </span>
  );
}
