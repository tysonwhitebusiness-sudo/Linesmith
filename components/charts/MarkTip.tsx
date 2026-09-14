'use client';

import type { ReactNode } from 'react';
import { Tooltip } from '@/components/ui/Tooltip';

/**
 * A chart mark with a real tooltip — R3 3c: "hover tooltip on every mark".
 *
 * Replaces SVG `<title>`, which only a mouse ever sees (no touch, no keyboard)
 * and which renders in the browser's own unstyled box after a delay. The group
 * is focusable, so a keyboard can step through the marks and read each one.
 */
export function MarkTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <Tooltip content={tip}>
      <g className="outline-none focus-visible:opacity-80">{children}</g>
    </Tooltip>
  );
}
