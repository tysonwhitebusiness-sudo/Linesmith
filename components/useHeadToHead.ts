'use client';

import { useEffect, useState } from 'react';
import type { HeadToHead } from '@/lib/history/teamHistoryShapes';

/**
 * Every meeting of two franchises in the results archive (R12c) —
 * `/api/history/results?sport=…&teamId=…&vs=…`, a day-cached summary from `teamId`'s
 * side. Any missing argument idles the hook, so a page calls it
 * unconditionally (rules of hooks). A failure leaves `data` null: the page
 * keeps the head to head it already had rather than showing an error for the
 * extra history.
 */
export function useHeadToHead(sport?: string, teamId?: string | null, vsId?: string | null): { data: HeadToHead | null; loading: boolean } {
  const [state, setState] = useState<{ data: HeadToHead | null; loading: boolean }>({ data: null, loading: false });

  useEffect(() => {
    if (!sport || !teamId || !vsId || teamId === vsId) {
      setState({ data: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ data: null, loading: true });
    void (async () => {
      try {
        const res = await fetch(`/api/history/results?sport=${encodeURIComponent(sport)}&teamId=${encodeURIComponent(teamId)}&vs=${encodeURIComponent(vsId)}`, { signal: controller.signal });
        setState({ data: res.ok ? ((await res.json()) as HeadToHead) : null, loading: false });
      } catch {
        if (!controller.signal.aborted) setState({ data: null, loading: false });
      }
    })();
    return () => controller.abort();
  }, [sport, teamId, vsId]);

  return state;
}
