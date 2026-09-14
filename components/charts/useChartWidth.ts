'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A chart's REAL pixel width — R3 3c.
 *
 * Every chart here used to draw at a fixed intrinsic width and let `viewBox`
 * scale the whole SVG to its container. That scales the TEXT too: a 10px tick
 * on a 640-unit chart rendered at 6px inside a 400px phone card, and a chart
 * wider than its intrinsic width stopped growing. Measuring the host and drawing
 * at that width keeps a 10px tick at 10px and lets marks use the space there is.
 *
 * `fallback` is used for the first render (and server rendering), before the
 * host has been measured. Changes under 2px are ignored so a sub-pixel layout
 * jitter cannot re-render a chart in a loop.
 */
export function useChartWidth<T extends HTMLElement = HTMLDivElement>(fallback: number): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    const measure = (w: number) => {
      const next = Math.max(0, Math.floor(w));
      if (next > 0) setWidth((prev) => (Math.abs(prev - next) < 2 ? prev : next));
    };
    measure(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    observer.current = new ResizeObserver((entries) => measure(entries[0].contentRect.width));
    observer.current.observe(node);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);
  return [ref, width];
}
