'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
export function Section({ id, title, sub, children, className }: { id: string; title: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={`sec-${id}`} data-sec={id} className={cx('mt-8 scroll-mt-[110px] first:mt-0', className)}>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-title text-ink">{title}</h2>
        {sub ? <span className="text-label text-ink-muted">{sub}</span> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function SectionNav({ items, top = 0, label = 'Sections', className }: { items: Array<{ id: string; label: string }>; top?: number; label?: string; className?: string }) {
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
    <nav aria-label={label} style={{ top }} className={cx('sticky z-20 -mx-4 border-b border-line bg-paper/90 px-4 backdrop-blur md:-mx-6 md:px-6', className)}>
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
