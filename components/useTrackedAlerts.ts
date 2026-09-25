'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { seenKey, type TrackedAlert } from '@/lib/odds/alerts';

/**
 * The signed-in reader's alerts on their tracked lines (odds build P12 §1),
 * shared by the header bell and the Slate's Your lines: one store, one poll
 * (60 s, visible tab only), fetched only while signed in.
 *
 * "Seen" is per viewer in localStorage (`linesmith:alerts:seen:<id>`) — a
 * convenience, wrapped in try/catch, so a private window simply shows every
 * alert as unread.
 */
const POLL_MS = 60_000;
let alerts: TrackedAlert[] = [];
let seenTick = 0;
let subscribers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(f => f());

async function poll() {
  timer = null;
  if (document.visibilityState === 'visible') {
    try {
      const r = await fetch('/api/tracked-lines/alerts', { cache: 'no-store' });
      if (r.ok) { alerts = ((await r.json()).alerts ?? []) as TrackedAlert[]; emit(); }
    } catch { /* the next poll retries */ }
  }
  if (subscribers > 0) timer = setTimeout(poll, POLL_MS);
}

function isSeen(id: string): boolean {
  try { return window.localStorage.getItem(seenKey(id)) != null; } catch { return false; }
}

export function markAlertsSeen(ids: string[]) {
  try { for (const id of ids) window.localStorage.setItem(seenKey(id), '1'); } catch { /* storage blocked: stays unread */ }
  seenTick++;
  emit();
}

/** `signedIn` false or unknown: nothing is fetched and nothing shows. */
export function useTrackedAlerts(signedIn: boolean | null) {
  const snap = useSyncExternalStore(
    useCallback((cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, []),
    () => `${alerts.length}:${seenTick}:${alerts[0]?.id ?? ''}`,
    () => '0:0:',
  );
  useEffect(() => {
    if (!signedIn) return;
    subscribers++;
    if (subscribers === 1 && !timer) void poll();
    return () => {
      subscribers--;
      if (subscribers === 0 && timer) { clearTimeout(timer); timer = null; }
    };
  }, [signedIn]);
  void snap; // the store's version: a change re-renders every reader
  const list = signedIn ? alerts : [];
  const unseen = list.filter(a => !isSeen(a.id));
  return { alerts: list, unread: unseen.length, isSeen, markSeen: markAlertsSeen };
}
