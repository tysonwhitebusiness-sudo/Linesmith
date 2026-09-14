'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

/**
 * DrillDownPanel — R3 3b. A side sheet for "see the detail" without leaving
 * the page (F2: detail today means navigating away).
 *
 * A modal dialog: focus moves to the close button on open and back to the
 * opener on close; Escape and the scrim close it; Tab stays inside. Slides in
 * on the `smooth` token; reduced motion reduces that to a fade (globals.css).
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
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div
        aria-hidden
        onClick={onClose}
        className={cx('fixed inset-0 z-[80] bg-[rgba(12,14,18,0.32)] transition-opacity duration-smooth ease-standard', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={typeof title === 'string' ? title : undefined}
        style={{ width: `min(${width}px, 100vw)` }}
        className={cx(
          'fixed inset-y-0 right-0 z-[90] flex flex-col bg-card shadow-pop transition-transform duration-smooth ease-emphasized',
          open ? 'translate-x-0' : 'pointer-events-none translate-x-[104%]',
        )}
      >
        <div className="flex min-h-[60px] items-center gap-2 border-b border-line py-3 pl-6 pr-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-title text-ink">{title}</div>
            {subtitle ? <div className="truncate text-label text-ink-muted">{subtitle}</div> : null}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-ctl text-ink-muted hover:bg-card-sunk hover:text-ink">
            <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto p-6">{open ? children : null}</div>
      </aside>
    </>,
    document.body,
  );
}
