'use client';

import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * A ticking clock for the live layer (odds build P9 §3; the spec put it in
 * components/odds, but both kit pieces that tick — LiveDot and FlashValue —
 * live here, and the kit does not import from a page folder): LiveDot ages, a
 * value's "▲ 12s" trail. ONE interval per cadence for the whole page, shared
 * by every subscriber, and none while the tab is hidden — a hidden tab does
 * no ticking at all, and the clock jumps to the real time on return.
 * `null` = a still clock (the render time), for a closed game or a test.
 */
interface Clock { now: number; subs: Set<() => void>; timer: ReturnType<typeof setInterval> | null; ms: number }

const clocks = new Map<number, Clock>();
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

function start(c: Clock) {
  if (c.timer || hidden() || !c.subs.size) return;
  c.timer = setInterval(() => { c.now = Date.now(); c.subs.forEach(f => f()); }, c.ms);
}
function stop(c: Clock) {
  if (c.timer) clearInterval(c.timer);
  c.timer = null;
}

let listening = false;
function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    for (const c of clocks.values()) {
      if (hidden()) { stop(c); continue; }
      c.now = Date.now();
      c.subs.forEach(f => f());
      start(c);
    }
  });
}

export function useNow(intervalMs: number | null): number {
  const still = useRef<number>(0);
  if (!still.current) still.current = Date.now();
  const subscribe = useCallback((cb: () => void) => {
    if (!intervalMs) return () => {};
    listen();
    const c = clocks.get(intervalMs) ?? clocks.set(intervalMs, { now: Date.now(), subs: new Set(), timer: null, ms: intervalMs }).get(intervalMs)!;
    c.subs.add(cb);
    start(c);
    return () => { c.subs.delete(cb); if (!c.subs.size) stop(c); };
  }, [intervalMs]);
  const get = () => (intervalMs ? clocks.get(intervalMs)?.now ?? still.current : still.current);
  return useSyncExternalStore(subscribe, get, () => still.current);
}
