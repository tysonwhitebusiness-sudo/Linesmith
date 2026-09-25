'use client';

import { liveState } from '@/lib/odds/section/freshness';
import { fmtAgo } from '@/lib/odds/section/format';
import { cx } from './cx';
import { useNow } from './useNow';

/**
 * A card header's liveness (odds build P8 O1, animated in P9 — the approved
 * mockup's `liveTag`). Green with a pulse while the newest reading is inside
 * twice the source's poll interval, amber inside six times, grey beyond; plus
 * "updated X ago". It ticks each second from the shared visible-only clock,
 * so a card whose refreshes are held back goes amber by itself. `pingAt`
 * (when the card's data last changed) draws one expanding ring — re-keyed, so
 * each new change pings once. No existing piece said "how fresh is this
 * reading, against how often its source polls": Chip's `dot` is identity.
 * Pass `now` to freeze it (a test, a closed game, /kit).
 */
export function LiveDot({ checkedAt, cadenceS, now, pingAt, className }: {
  checkedAt: string | null | undefined;
  cadenceS: number;
  now?: number;
  pingAt?: number | null;
  className?: string;
}) {
  const tick = useNow(now == null && checkedAt ? 1000 : null);
  if (!checkedAt) return null;
  const age = Math.max(0, ((now ?? tick) - Date.parse(checkedAt)) / 1000);
  const st = liveState(age, cadenceS);
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-label font-normal', st === 'slow' ? 'text-warn-ink' : 'text-ink-muted', className)}
      data-live={st}>
      <span aria-hidden className="relative inline-flex h-2 w-2">
        {st === 'live' ? <span className="lb-live-pulse absolute inset-0 rounded-full bg-good" /> : null}
        {pingAt ? <span key={pingAt} data-ping className="lb-live-ping absolute inset-0 rounded-full border border-good opacity-0" /> : null}
        <span className={cx('relative inline-flex h-2 w-2 rounded-full', st === 'live' ? 'bg-good' : st === 'slow' ? 'bg-warn' : 'bg-ink-faint')} />
      </span>
      <span>{st === 'off' ? `no update in ${fmtAgo(age)}` : `updated ${fmtAgo(age)} ago`}</span>
    </span>
  );
}
