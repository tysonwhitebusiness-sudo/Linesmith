'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * One page-load gate, shared by every full-page `BrandedLoader`.
 *
 * PlayerDetail, GameDetail and TeamDetail each grew their own hand-written
 * readiness expression, and they drifted the way three copies of anything
 * drift — see the measurements in the audit. This is the one place the
 * open/close decision is made; a caller supplies only "is anything I care
 * about still pending".
 *
 * ============================ FOUR REAL TRAPS ============================
 *
 * 1. THE FIRST-FRAME FLASH. Every data hook in this codebase is
 *    `useState(false)` for `loading`, flipping to `true` inside its own
 *    `useEffect`. `useEffect` runs AFTER paint, so on the very first render
 *    every hook truthfully reports "not loading" — it hasn't started yet.
 *    A naive `!a.loading && !b.loading` is therefore `true` on frame one,
 *    opens the gate, and slams it shut a frame later when the fetches
 *    actually begin. `armed` below refuses to open until at least one effect
 *    tick has been observed, which is exactly when a hook that intends to
 *    fetch has said so.
 *
 * 2. ONCE OPEN, STAY OPEN. A background refresh (the live-game poll re-runs
 *    every 15s) flips `pending` back to `true` long after the page is on
 *    screen. Re-showing a full-page loader over a page the reader is already
 *    using is worse than any pop-in. The gate latches: it opens once per
 *    `resetKey` and only re-closes when that key changes (a different player,
 *    a different game), which is a genuinely new page.
 *
 * 3. A STUCK SOURCE MUST NOT HANG THE PAGE FOREVER. Gating on more sources
 *    means more ways to never resolve. `timeoutMs` opens the gate regardless
 *    and is a real escape hatch, not a nicety — the alternative is an
 *    infinite spinner, which is the one loading state worse than pop-in.
 *
 * 4. DON'T STROBE. A warm cache can resolve everything in ~40ms, which
 *    renders the loader as a flicker. `minVisibleMs` holds it for a floor
 *    once shown. The floor is only paid when the loader was actually
 *    displayed, so it never delays an already-warm page.
 * ========================================================================
 */
export interface ReadyGateOptions {
  /**
   * Changing this closes the gate and starts a fresh load — the subject id,
   * usually. Same value across a re-render means the same page.
   */
  resetKey: string;
  /** Opens the gate regardless once this long has passed. Trap 3. */
  timeoutMs?: number;
  /** Minimum time the loader stays up once it has been shown. Trap 4. */
  minVisibleMs?: number;
}

export function useReadyGate(pending: boolean, { resetKey, timeoutMs = 12_000, minVisibleMs = 350 }: ReadyGateOptions): boolean {
  const [ready, setReady] = useState(false);
  // Trap 1: set on the first post-paint effect tick, so a hook that is about
  // to fetch has had its chance to say `loading = true` before we believe a
  // `false`.
  const armed = useRef(false);
  const shownAt = useRef<number | null>(null);
  const key = useRef(resetKey);

  // Reset on a genuinely new subject. Done during render rather than in an
  // effect so the loader is up on the very first frame of the new page — an
  // effect would let one frame of the PREVIOUS player's fully-rendered page
  // show under the new id.
  if (key.current !== resetKey) {
    key.current = resetKey;
    armed.current = false;
    shownAt.current = null;
    if (ready) setReady(false);
  }

  useEffect(() => {
    if (shownAt.current === null) shownAt.current = Date.now();
    // One tick of grace before a `false` from a not-yet-started hook counts.
    const arm = requestAnimationFrame(() => {
      armed.current = true;
    });
    return () => cancelAnimationFrame(arm);
  }, [resetKey]);

  useEffect(() => {
    if (ready) return; // Trap 2: latched.
    if (pending || !armed.current) return;

    const elapsed = Date.now() - (shownAt.current ?? Date.now());
    const wait = Math.max(0, minVisibleMs - elapsed);
    const t = setTimeout(() => setReady(true), wait);
    return () => clearTimeout(t);
  }, [pending, ready, minVisibleMs, resetKey]);

  // Trap 3: the escape hatch, armed once per page.
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setReady(true), timeoutMs);
    return () => clearTimeout(t);
  }, [ready, timeoutMs, resetKey]);

  return ready;
}

export default useReadyGate;
