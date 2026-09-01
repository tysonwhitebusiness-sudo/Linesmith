'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The app's route-level error boundary.
 *
 * There was no `error.tsx` anywhere in 44 routes before this, which is why an
 * unhandled render threw straight through to Next's own overlay in dev and a
 * blank document in production, and why a failed fetch inside a page surfaced
 * as whatever raw string the API happened to return — `teamId must be a
 * positive integer of at most 9 digits.` was reaching real screens.
 *
 * TWO RULES THIS FOLLOWS, both violated by the copy it replaces:
 *
 * 1. THE READER IS NEVER SHOWN THE PARAMETER NAME. A person cannot act on
 *    `teamId`. They can act on "we couldn't load this team". The underlying
 *    message stays available behind a disclosure for whoever is debugging,
 *    because throwing it away entirely just moves the problem to the console.
 *
 * 2. AN ERROR STATE ALWAYS OFFERS THE NEXT MOVE. `reset()` re-runs the failed
 *    segment, which genuinely fixes the common case here (a cold cache that
 *    timed out on first hit), so "Try again" is a real action and not
 *    decoration. Going back is the honest second option.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    // Keep the real thing greppable in the console; the UI stays human.
    console.error('[route error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16">
      <div className="lb-card w-full max-w-md p-6 text-center">
        <h1 className="text-title font-semibold text-ink">This page didn&apos;t load</h1>
        <p className="mx-auto mt-2 max-w-[38ch] text-body text-ink-secondary">
          Something went wrong fetching the data for this view. It&apos;s usually temporary — a
          cold cache on the first request will often work on a second try.
        </p>

        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="lb-btn-primary rounded-full bg-masters px-4 py-2 text-emphasis font-medium text-white"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-full border border-line px-4 py-2 text-emphasis font-medium text-ink-secondary transition-colors hover:bg-accent-soft"
          >
            Go back
          </button>
        </div>

        <details className="mt-5 text-left">
          <summary className="cursor-pointer text-meta text-ink-muted">Technical details</summary>
          <p className="mt-2 break-words rounded border border-line bg-surface-subtle p-2 font-mono text-meta text-ink-secondary">
            {error.message || 'No message provided.'}
            {error.digest ? ` (${error.digest})` : ''}
          </p>
        </details>
      </div>
    </div>
  );
}
