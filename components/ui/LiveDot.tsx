'use client';

import { liveState } from '@/lib/odds/section/freshness';
import { fmtAgo } from '@/lib/odds/section/format';
import { cx } from './cx';

/**
 * A card header's liveness (odds build P8, O1 — the odds section's cards: the
 * approved mockup's `liveTag`). Green while the newest reading is inside twice
 * the source's poll interval, amber inside six times, grey beyond; plus
 * "updated X ago". The pulse is off under `prefers-reduced-motion`
 * (`motion-safe:`). P9 makes it tick and ping; here it renders the state at
 * `now`. No existing piece said "how fresh is this reading, against how often
 * its source polls" — Chip's `dot` is identity, not age.
 */
export function LiveDot({ checkedAt, cadenceS, now, className }: {
  checkedAt: string | null | undefined;
  cadenceS: number;
  now?: number;
  className?: string;
}) {
  if (!checkedAt) return null;
  const age = Math.max(0, ((now ?? Date.now()) - Date.parse(checkedAt)) / 1000);
  const st = liveState(age, cadenceS);
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-label font-normal', st === 'slow' ? 'text-warn-ink' : 'text-ink-muted', className)}
      data-live={st}>
      <span aria-hidden className="relative inline-flex h-2 w-2">
        {st === 'live' ? <span className="absolute inset-0 rounded-full bg-good opacity-60 motion-safe:animate-ping" /> : null}
        <span className={cx('relative inline-flex h-2 w-2 rounded-full', st === 'live' ? 'bg-good' : st === 'slow' ? 'bg-warn' : 'bg-ink-faint')} />
      </span>
      <span>{st === 'off' ? `no update in ${fmtAgo(age)}` : `updated ${fmtAgo(age)} ago`}</span>
    </span>
  );
}
