'use client';

import { Button, IconButton, Popover } from './ui';
import { useSignedIn } from './slate/SlateYourLines';
import { useTrackedAlerts } from './useTrackedAlerts';
import type { TrackedAlert } from '@/lib/odds/alerts';
import { fmtAgo, secondsSince } from '@/lib/odds/section/format';

const TYPE_WORD: Record<TrackedAlert['type'], string> = {
  moved: 'Line moved', better_price: 'Better price', pulled: 'Pulled', steam: 'Steam',
};

/** The alerts as a list: unread in ink, read muted (P12 §1). Shared by the bell and the Slate's Your lines. */
export function AlertList({ alerts, isSeen }: { alerts: TrackedAlert[]; isSeen: (id: string) => boolean }) {
  const now = Date.now();
  return (
    <ul className="divide-y divide-line-soft">
      {alerts.map(a => {
        const seen = isSeen(a.id);
        return (
          <li key={a.id} className="flex items-start gap-2 py-2" data-alert={a.type} data-seen={seen ? 'true' : undefined}>
            <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${seen ? 'bg-line' : a.type === 'pulled' ? 'bg-bad' : 'bg-good'}`} />
            <span className="min-w-0 flex-1">
              <span className={`block text-body-sm ${seen ? 'text-ink-muted' : 'font-semibold text-ink'}`}>{a.text}</span>
              <span className="block text-label text-ink-muted">{TYPE_WORD[a.type]} · {fmtAgo(secondsSince(a.at, now))} ago</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The header bell: unread alerts on the reader's tracked lines. Signed out, nothing renders. */
export function AlertsBell() {
  const signedIn = useSignedIn();
  const { alerts, unread, isSeen, markSeen } = useTrackedAlerts(signedIn);
  if (!signedIn) return null;
  const bell = (
    <svg viewBox="0 0 20 20" width={16} height={16} aria-hidden fill="none" stroke="currentColor" strokeWidth={1.6}>
      <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3.5-1.5 5-1.5 5h12s-1.5-1.5-1.5-5A4.5 4.5 0 0 0 10 3Z" strokeLinejoin="round" />
      <path d="M8.5 15.5a1.6 1.6 0 0 0 3 0" strokeLinecap="round" />
    </svg>
  );
  return (
    <Popover label="Alerts on your lines" placement="bottom end" trigger={
      <span className="relative inline-flex">
        <IconButton icon={bell} size="sm" aria-label={unread ? `Alerts on your lines: ${unread} unread` : 'Alerts on your lines'} />
        {unread ? <span className="pointer-events-none absolute -right-1 -top-1 min-w-4 rounded-full bg-bad px-1 text-center text-overline font-semibold text-white tabular-nums" data-alerts-unread>{unread}</span> : null}
      </span>
    }>
      <div className="flex items-center justify-between gap-3">
        <b className="text-body-sm text-ink">Your lines</b>
        {unread ? <Button size="sm" variant="tertiary" onPress={() => markSeen(alerts.map(a => a.id))}>Mark all read</Button> : null}
      </div>
      {alerts.length
        ? <div className="mt-1 max-h-80 overflow-y-auto"><AlertList alerts={alerts} isSeen={isSeen} /></div>
        : <p className="mt-2 text-body-sm text-ink-muted">No alerts. A tracked line alerts you when it moves, a book beats yours by 5¢, your book pulls it, or steam hits it.</p>}
    </Popover>
  );
}
