'use client';

import { cx } from './cx';
import { useNow } from './useNow';

/** A change's trail fades over two minutes, then goes (Revision 4). */
export const TRAIL_S = 120;
const FLASH_S = 1.6;

export interface ValueChange {
  dir: 'up' | 'down';
  /** When THIS page saw the change (ms), not when the source made it: the trail's age is "since it moved here". */
  seenAt: number;
}

const age = (s: number) => (s < 60 ? `${Math.floor(s)}s` : `${Math.floor(s / 60)}m`);

/**
 * A live number (odds build P8 O1; animated in P9). On a change it rolls to
 * the new value and flashes the Electric Turf FILL — `good` up, `bad` down —
 * fading over 1.6 s, then leaves "▲ 12s" / "▼ 12s" in the matching INK,
 * fading from 1 to 0.15 over two minutes and then removed. The span is keyed
 * by the change, so a re-render never replays an old flash. `quiet` (the
 * flash cap: a card with more than 12 changes in one refresh) keeps the trail
 * and skips the roll and flash; the ROW carries the tint instead. `recent`
 * marks a value that changed since the page opened (the header's outline).
 */
export function FlashValue({ value, format, change, quiet, recent, now, className, best }: {
  value: number | null | undefined;
  format: (v: number) => string;
  change?: ValueChange | null;
  quiet?: boolean;
  recent?: boolean;
  /** Freeze the clock (tests, /kit). */
  now?: number;
  /** The best price on its side: the `good` fill (O-A). */
  best?: boolean;
  className?: string;
}) {
  const tick = useNow(change && now == null ? 1000 : null);
  const t = now ?? tick;
  const a = change ? Math.max(0, (t - change.seenAt) / 1000) : Infinity;
  const flashing = !!change && !quiet && a < FLASH_S;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span key={change?.seenAt ?? 0}
        className={cx('tabular-nums', best && 'rounded-xs bg-good px-1 text-good-on',
          flashing && (change!.dir === 'up' ? 'lb-flash-up' : 'lb-flash-down'), className)}
        data-direction={change && a < TRAIL_S ? change.dir : undefined}
        data-recent={recent ? '' : undefined}>
        {value == null ? '—' : format(value)}
      </span>
      {change && a < TRAIL_S ? (
        <span data-trail className={cx('text-label tabular-nums', change.dir === 'up' ? 'text-good-ink' : 'text-bad-ink')}
          style={{ opacity: Math.max(0.15, 1 - a / TRAIL_S) }}>
          {change.dir === 'up' ? '▲' : '▼'} {age(a)}
        </span>
      ) : null}
    </span>
  );
}
