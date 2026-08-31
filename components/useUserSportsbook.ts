'use client';

import { useEffect, useState } from 'react';

/**
 * The reader's own sportsbook, for cards that highlight "my book".
 *
 * `usePropOdds` already fetches this, but it fetches it alongside a whole
 * game's prop rows and is keyed by game id — so a page that wants only the
 * book name (Team Detail's line-movement card) would be pulling a prop payload
 * to read one string. This is the same route on its own.
 *
 * DEFAULTS TO EMPTY, NOT TO A BOOK. `LineMovementCard` highlights the series
 * whose name matches; an unmatched name highlights nothing, which is the right
 * answer while the preference is still loading or when none is set. Seeding it
 * with a real book would highlight a book the reader may not use.
 */
export function useUserSportsbook(): string {
  const [book, setBook] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/props/user-sportsbook', { signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { userSportsbook?: string; sportsbook?: string };
        const name = json.userSportsbook ?? json.sportsbook;
        if (typeof name === 'string' && name) setBook(name);
      } catch {
        // AbortError on unmount, or the preference route being unavailable —
        // an unhighlighted chart is a fine outcome either way.
      }
    })();
    return () => controller.abort();
  }, []);

  return book;
}
