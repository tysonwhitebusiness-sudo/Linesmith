'use client';

import { useEffect, useState } from 'react';

/** The page's own sticky header, so the section nav pins directly beneath it on every host. */
export function useStickyHeaderHeight(enabled: boolean): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const header = document.querySelector<HTMLElement>('header.sticky');
    if (!header) return;
    const measure = () => setHeight(header.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, [enabled]);
  return height;
}
