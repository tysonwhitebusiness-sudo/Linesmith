'use client';

import type { ReactNode } from 'react';
import { SlideoutMenu } from './Overlays';

/**
 * DrillDownPanel — R3 3b. A side sheet for "see the detail" without leaving
 * the page (F2: detail today means navigating away).
 *
 * Since U4 it is the kit `SlideoutMenu` underneath (React Aria's modal): the
 * focus trap, Escape, the scrim, scroll lock and focus return that this file
 * hand-rolled — with its own `createPortal` and `role="dialog"` — come from
 * the library now. The props are unchanged, so no caller moved.
 */
export interface DrillDownPanelProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  /** Default 560, the G2 kit's. Always capped at the viewport. */
  width?: number;
}

export function DrillDownPanel({ open, onClose, title, subtitle, children, width = 560 }: DrillDownPanelProps) {
  return (
    <SlideoutMenu isOpen={open} onClose={onClose} title={title} subtitle={subtitle} width={width}>
      {children}
    </SlideoutMenu>
  );
}
