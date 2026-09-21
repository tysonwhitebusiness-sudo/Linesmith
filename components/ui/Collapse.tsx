'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * C0.3 `Collapse` — a body that opens and closes by max-height, with an
 * optional one-time PEEK (C2.4): 700ms after mount it opens 96px, holds, and
 * closes, so a closed hero shows there is something under it. The peek runs
 * once per viewer (`localStorage[peek]`), never with reduced motion, and if
 * storage throws it simply plays every time, which is harmless.
 *
 * The body is hidden, not unmounted, so charts inside keep their state. The
 * open/closed state itself is the caller's and is NOT remembered (R10.6).
 */
export function Collapse({
  open,
  id,
  peek,
  onPeek,
  className,
  children,
}: {
  open: boolean;
  id: string;
  /** localStorage key that records the peek has been seen. Omit for no peek. */
  peek?: string;
  /** Told when the peek starts and stops, so the trigger's chevron can nudge. */
  onPeek?: (peeking: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const [peeking, setPeeking] = useState(false);

  useEffect(() => {
    if (!peek || open) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(peek) === '1';
    } catch {
      seen = false;
    }
    if (seen || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const start = window.setTimeout(() => {
      setPeeking(true);
      onPeek?.(true);
      try {
        window.localStorage.setItem(peek, '1');
      } catch {
        /* storage blocked: the peek plays again next time, harmlessly */
      }
    }, 700);
    const stop = window.setTimeout(() => {
      setPeeking(false);
      onPeek?.(false);
    }, 700 + 1500);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
    };
    // Runs once on mount by design: a peek is a first impression, not a reaction to toggling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      id={id}
      inert={!open && !peeking}
      className={cx('overflow-hidden transition-[max-height] duration-[450ms] ease-[cubic-bezier(.3,.7,.2,1)] motion-reduce:transition-none', className)}
      style={{ maxHeight: open ? 900 : 0, animation: peeking && !open ? 'lb-peek 1.5s ease-in-out' : undefined }}
    >
      {children}
    </div>
  );
}
