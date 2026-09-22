'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';

/**
 * Section + SectionNav — R3 3b. Long pages (16–23 cards) get named sections
 * and a sticky nav that tracks where you are.
 *
 * The nav follows scroll with an IntersectionObserver, scrolls to a section on
 * click, and writes the section to the URL hash with `replaceState` (R3 3d:
 * state lives in the URL) without adding history entries or re-rendering the
 * route. On a phone it is a horizontal scroller, never a wrapped block.
 */
/**
 * A page section, collapsible as a whole — R10.6. A research page runs to twenty
 * cards; a reader who does not want the pitch mix should not have to scroll past
 * it. So each section's header carries a Hide/Show control that folds away the
 * WHOLE section (not a card inside it).
 *
 * DELIBERATELY NOT REMEMBERED: the state is component state, so every page load
 * opens with everything showing, which is what the operator asked for. A stored
 * preference would mean a reader could lose a section and not know why it was
 * gone.
 *
 * The body is HIDDEN, not unmounted, so a card keeps its own toggles and nothing
 * refetches when it is shown again. Charts measure with a ResizeObserver, so one
 * that was hidden re-measures to its real width on the way back.
 */
/**
 * C1b (2026-09-21, operator): the one section header. A transparent bar with
 * a 3px charcoal line on the left and a hairline divider beneath; green never
 * marks structure. It still bleeds to the page gutter each `<main>` declares
 * as `--lb-gutter`, so it never overflows a page with a narrower gutter (the
 * right-edge bug, SL-25). Research sections render it through `Section`; the
 * Slate's sections use it directly. `tests/ui-primitives` bans a page's own
 * `<h2 className="text-title`.
 */
export function SectionBand({
  title,
  count,
  sub,
  right,
  className,
}: {
  title: ReactNode;
  count?: number | null;
  sub?: ReactNode;
  /** Controls at the band's right; on a phone they drop to their own row. */
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'relative mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line-soft py-2 pl-4 sm:flex-nowrap sm:pl-5',
        className,
      )}
      style={{ marginInline: 'calc(var(--lb-gutter, 0px) * -1)' }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] rounded-full bg-char" />
      <h2 className="text-title text-ink sm:text-heading">{title}</h2>
      {count != null ? <span className="rounded-full bg-card-sunk px-2 py-0.5 text-label tabular-nums text-ink-secondary">{count}</span> : null}
      {sub ? <span className="text-body-sm text-ink-muted">{sub}</span> : null}
      {right ? <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">{right}</div> : null}
    </div>
  );
}

export function Section({ id, title, sub, children, className }: { id: string; title: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = `sec-body-${id}`;
  return (
    <section id={`sec-${id}`} data-sec={id} className={cx('mt-8 scroll-mt-[110px] first:mt-0', className)}>
      <SectionBand
        title={title}
        sub={sub}
        className={collapsed ? 'mb-0' : undefined}
        right={
          <Button variant="tertiary" size="sm" onPress={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-controls={bodyId}>
            <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" className={cx('transition-transform', collapsed ? '-rotate-90' : '')}>
              <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {collapsed ? 'Show' : 'Hide'}
            <span className="sr-only"> {typeof title === 'string' ? title : 'section'}</span>
          </Button>
        }
      />
      <div id={bodyId} className="space-y-3" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}

export function SectionNav({
  items,
  top = 0,
  label = 'Sections',
  bleed,
  className,
}: {
  items: Array<{ id: string; label: string }>;
  top?: number;
  label?: string;
  /**
   * Stretch the bar's background into a 16px (24px from md) page gutter, as the
   * G2 pages do. OFF by default: on a page with a different gutter the negative
   * margin overflows the screen (found at 400px on the NFL game page, 12px gutter).
   */
  bleed?: boolean;
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const clickedAt = useRef(0);

  useEffect(() => {
    const els = items.map((it) => document.getElementById(`sec-${it.id}`)).filter((e): e is HTMLElement => Boolean(e));
    if (els.length === 0) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.sec!;
          if (e.isIntersecting) visible.set(id, e.boundingClientRect.top);
          else visible.delete(id);
        }
        // A click-scroll passes through every section; ignore the observer until it settles.
        if (Date.now() - clickedAt.current < 800 || visible.size === 0) return;
        const first = items.find((it) => visible.has(it.id));
        if (first) setActive(first.id);
      },
      { rootMargin: `-${top + 60}px 0px -55% 0px` },
    );
    els.forEach((e) => io.observe(e));
    const hash = window.location.hash.replace('#sec-', '');
    if (hash && items.some((it) => it.id === hash)) setActive(hash);
    return () => io.disconnect();
  }, [items, top]);

  // Keep the active item visible inside the phone scroller.
  useEffect(() => {
    const btn = barRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const go = (id: string) => {
    clickedAt.current = Date.now();
    setActive(id);
    document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    window.history.replaceState(window.history.state, '', `#sec-${id}`);
  };

  return (
    <nav aria-label={label} style={{ top }} className={cx('sticky z-20 border-b border-char3 bg-paper/90 backdrop-blur', bleed && '-mx-4 px-4 md:-mx-6 md:px-6', className)}>
      <div ref={barRef} className="flex gap-4 overflow-x-auto lb-scroll-x">
        {items.map((it) => {
          const on = it.id === active;
          return (
            <a
              key={it.id}
              href={`#sec-${it.id}`}
              aria-current={on ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(it.id);
              }}
              className={cx(
                '-mb-px shrink-0 whitespace-nowrap border-b-2 pb-[11px] pt-3 text-body font-semibold transition-colors duration-quick ease-standard',
                on ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {it.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
