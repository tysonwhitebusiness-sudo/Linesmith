'use client';

import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip — R3 3b. Replaces native `title` attributes, which never show on
 * touch or to a keyboard (F2: 97 in source, 1,135 rendered across 12 pages).
 *
 * Reachable three ways: pointer hover, keyboard focus, and TAP (a tap toggles
 * it, a tap elsewhere or Escape closes it). The trigger gets
 * `aria-describedby` while open, so a screen reader reads the content too.
 *
 * The trigger must be a single element that can take focus. A non-focusable
 * element (a span) is given `tabIndex={0}`, matching the G2 kit.
 */
export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  /** Extra width cap in px. Default 280, the G2 kit's. */
  maxWidth?: number;
}

interface Pos {
  left: number;
  top: number;
}

export function Tooltip({ content, children, maxWidth = 280 }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const pointerType = useRef<string>('mouse');

  const place = useCallback(() => {
    const tip = tipRef.current;
    const a = anchor.current;
    if (!tip || !a) return;
    const r = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, a.x - r.width / 2));
    const above = a.y - r.height - 10;
    setPos({ left, top: above < 8 ? a.y + 18 : above });
  }, []);

  useEffect(() => {
    if (open) place();
  }, [open, content, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  if (!isValidElement(children)) return children;
  // No content, no tooltip: U6 moved conditional native `title`s here, and a
  // `title={x ? '…' : undefined}` must not turn into a focusable empty tip.
  if (content == null || content === '' || content === false) return children;
  const child = children as ReactElement<Record<string, unknown>>;
  const props = child.props as Record<string, unknown>;

  const fromElement = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    anchor.current = { x: r.left + r.width / 2, y: r.top };
  };

  const trigger = cloneElement(child, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
      const ref = (child as unknown as { ref?: unknown }).ref;
      if (typeof ref === 'function') ref(el);
      else if (ref && typeof ref === 'object') (ref as { current: unknown }).current = el;
    },
    tabIndex: props.tabIndex ?? (typeof child.type === 'string' && /^(a|button|input|select|textarea)$/.test(child.type) ? undefined : 0),
    'aria-describedby': open ? id : props['aria-describedby'],
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      pointerType.current = e.pointerType;
      if (e.pointerType !== 'mouse') return;
      anchor.current = { x: e.clientX, y: e.clientY };
      setOpen(true);
      (props.onPointerEnter as ((ev: unknown) => void) | undefined)?.(e);
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse') return;
      anchor.current = { x: e.clientX, y: e.clientY };
      place();
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') setOpen(false);
      (props.onPointerLeave as ((ev: unknown) => void) | undefined)?.(e);
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      fromElement(e.currentTarget);
      setOpen(true);
      (props.onFocus as ((ev: unknown) => void) | undefined)?.(e);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      setOpen(false);
      (props.onBlur as ((ev: unknown) => void) | undefined)?.(e);
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      // Touch and pen: a tap toggles. A mouse click leaves hover in charge.
      if (pointerType.current !== 'mouse') {
        fromElement(e.currentTarget);
        setOpen((v) => !v);
      }
      (props.onClick as ((ev: unknown) => void) | undefined)?.(e);
    },
  });

  return (
    <>
      {trigger}
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxWidth }}
              className="pointer-events-none fixed z-[100] rounded-ctl bg-masters px-2.5 py-2 text-label font-normal text-white shadow-pop transition-opacity duration-quick ease-standard"
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** A tooltip row: a bold value, a muted label, and an optional series key. */
export function TipRow({ value, label, color }: { value: ReactNode; label: ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {color ? <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} /> : null}
      <span className="text-body font-bold tabular-nums">{value}</span>
      <span className="text-white/70">{label}</span>
    </div>
  );
}
