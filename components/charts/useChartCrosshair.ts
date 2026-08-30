'use client';

import { useCallback, useMemo, useState } from 'react';

/**
 * A hover index shared across every chart in one panel — Phase 6.4.
 *
 * WHY SHARED. The point of putting a price tape, a distribution and a
 * contribution chart on one page is that they describe the same moment. If
 * each owns its own hover state, the reader has to hold "19:30" in their head
 * while moving between them. One index, published by whichever chart the
 * pointer is over and read by all of them, is what makes a panel a panel
 * rather than three pictures.
 *
 * INDEX, NOT PIXELS. Charts in a panel share a domain (the same fourteen
 * timestamps) but not a width — a sparkline in a table row and a full tape are
 * different sizes. Publishing the index lets each chart map it through its own
 * scale; publishing a pixel would couple them to a shared geometry they do not
 * have.
 *
 * NULL MEANS "NOTHING HOVERED", and every consumer must render that state —
 * it is the resting state of the page, not an edge case.
 */
export interface ChartCrosshair {
  /** Currently hovered index, or `null` when the pointer is outside every chart. */
  index: number | null;
  /** Publish a hover. Called by whichever chart the pointer is over. */
  setIndex: (index: number | null) => void;
  /** Convenience for a chart's own `onPointerLeave`. */
  clear: () => void;
}

export function useChartCrosshair(): ChartCrosshair {
  const [index, setIndexState] = useState<number | null>(null);
  const setIndex = useCallback((next: number | null) => {
    // Guard the common case where a pointer move within one bucket fires many
    // events: re-rendering every chart in a panel per pointermove is the whole
    // cost here, and the value has not changed.
    setIndexState((prev) => (prev === next ? prev : next));
  }, []);
  const clear = useCallback(() => setIndexState(null), []);
  return useMemo(() => ({ index, setIndex, clear }), [index, setIndex, clear]);
}

/**
 * A crosshair that is never set — for a chart rendered outside a panel.
 *
 * Exists so a primitive can take `crosshair` as a required prop and never
 * branch on its absence. Stable identity, so it does not defeat memoisation.
 */
export const NO_CROSSHAIR: ChartCrosshair = {
  index: null,
  setIndex: () => {},
  clear: () => {},
};
