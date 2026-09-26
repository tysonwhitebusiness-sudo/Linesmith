'use client';

import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { cx } from './cx';
import { EmptyState, ErrorState, SkeletonLines, type EmptyStateProps } from './States';
import { Tooltip } from './Tooltip';

/**
 * Card — R3 3b, the F2 anatomy. Replaces nine card-header styles (F2 measured
 * uppercase 10.5px bold with and without a tinted bar, sentence-case 12px,
 * uppercase 11px, 16px, 18px…).
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ Card title          [scope]        [ⓘ] [⤢]    │  header, 44px
 *   ├───────────────────────────────────────────────┤
 *   │ body                                          │  16px (12 dense)
 *   ├───────────────────────────────────────────────┤
 *   │ caption: sample size · source · as of         │
 *   └───────────────────────────────────────────────┘
 *
 * One header style, sentence case. The scope control sits in the header on
 * every stat card. Loading, empty and error are BUILT IN, so a card cannot
 * forget one: pass `state` and the body is replaced (or, for an error with
 * cached data, kept under the message).
 */
export type CardState =
  | { kind: 'ready' }
  | { kind: 'loading'; lines?: number; skeleton?: ReactNode }
  | ({ kind: 'empty' } & EmptyStateProps)
  | { kind: 'error'; message: string; onRetry?: () => void; keepBody?: boolean };

export interface CardProps {
  title: ReactNode;
  /** What the card is scoped to — a label ("2025 season") or a control (a SelectBox). */
  scope?: ReactNode;
  /** Explains the stat. Opens a styled tooltip from the ⓘ button. */
  info?: ReactNode;
  /** Opens the drill-down for this card. Shows the ⤢ button. */
  onExpand?: () => void;
  caption?: ReactNode;
  dense?: boolean;
  state?: CardState;
  /** The page-level hero card: 16px radius, 24px padding. */
  hero?: boolean;
  /**
   * U2: a count badge after the title — "Game log [148]". A number, not a
   * string: it is how many rows are behind this card, and it reads as one.
   */
  count?: number;
  /**
   * U2: the body has NO padding, so a table's header band runs edge to edge
   * and its sticky first column pins against the card's own border.
   */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  id?: string;
  children?: ReactNode;
}

const TITLE_TEXT = (title: ReactNode) => (typeof title === 'string' ? title : 'this card');

export function Card({ title, scope, info, onExpand, caption, dense, state = { kind: 'ready' }, hero, count, flush, className, bodyClassName, id, children }: CardProps) {
  let body: ReactNode = children;
  if (state.kind === 'loading') body = state.skeleton ?? <SkeletonLines lines={state.lines} />;
  else if (state.kind === 'empty') body = <EmptyState title={state.title} reason={state.reason} action={state.action} className="py-4" />;
  else if (state.kind === 'error') body = <ErrorState message={state.message} onRetry={state.onRetry} stale={state.keepBody ? children : undefined} />;

  return (
    <section
      id={id}
      aria-busy={state.kind === 'loading' || undefined}
      className={cx('min-w-0 border border-line-soft bg-card shadow-card', hero ? 'rounded-card-hero' : 'rounded-card', className)}
    >
      <header className="flex min-h-[44px] flex-wrap items-center gap-x-2 gap-y-1 border-b border-line-soft py-1.5 pl-4 pr-2">
        <h3 className="flex min-w-[9em] flex-1 items-center gap-1.5 text-card-title uppercase tracking-[0.03em] text-ink">
          {title}
          {count != null ? (
            <span className="rounded-[6px] px-1.5 py-px text-overline font-semibold text-ink-secondary ring-1 ring-line ring-inset tabular-nums">
              {count}
            </span>
          ) : null}
        </h3>
        {scope ? <div className="min-w-0 text-right text-label text-ink-muted">{scope}</div> : null}
        {info ? (
          // U1: this ONE stays a raw `<button>`. `Tooltip` opens by cloning its
          // child and attaching `onPointerEnter` / `onPointerMove` /
          // `onPointerLeave` to it; React Aria's `Button` does not forward
          // arbitrary pointer handlers, so an `IconButton` here would stop
          // opening on hover — silently, since focus and tap would still work.
          // Teaching `Tooltip` to wrap rather than clone belongs to U4.
          <Tooltip content={<div className="max-w-[240px]">{info}</div>}>
            <button type="button" aria-label={`About ${TITLE_TEXT(title)}`} className="grid h-[30px] w-[30px] place-items-center rounded-ctl text-ink-muted transition-colors duration-instant hover:bg-card-sunk hover:text-ink">
              <InfoGlyph />
            </button>
          </Tooltip>
        ) : null}
        {onExpand ? (
          // The card-header icon button stays 30px, not the kit's 32 (U spec §2c).
          <IconButton size="sm" className="h-[30px] w-[30px]" onPress={onExpand} aria-label={`Expand ${TITLE_TEXT(title)}`} icon={<ExpandGlyph />} />
        ) : null}
      </header>
      <div className={cx(flush ? 'overflow-hidden' : hero ? 'p-6' : dense ? 'p-3' : 'p-4', bodyClassName)}>{body}</div>
      {caption && state.kind !== 'loading' ? <footer className="px-4 pb-3 text-label text-ink-muted">{caption}</footer> : null}
    </section>
  );
}

function InfoGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.75" strokeLinecap="round" />
      <circle cx="8" cy="5" r="0.4" fill="currentColor" />
    </svg>
  );
}

function ExpandGlyph() {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
