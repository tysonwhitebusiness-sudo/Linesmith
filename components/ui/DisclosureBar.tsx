'use client';

import { Button as AriaButton } from 'react-aria-components';
import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * C2 `DisclosureBar` — a full-width row that opens and closes the region it
 * names, with a summary that fades while it is open and "Show ▾" / "Hide ▴"
 * at the right. The player hero's "season & form" bar (C2.2), and the team
 * hero's (C2b), which is the same bar.
 *
 * One button: the whole row is the target, `aria-expanded` and
 * `aria-controls` are on it, and the summary is hidden from nothing — it is
 * the button's own text, so a screen reader hears what the region holds.
 * `nudge` dips the chevron while a `Collapse` peek plays.
 */
export function DisclosureBar({
  label,
  summary,
  open,
  onToggle,
  controls,
  nudge = false,
}: {
  /** The overline: "2025-26 season & form". */
  label: ReactNode;
  /** What is inside, while it is closed. Faded out while open. */
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** The id of the region it opens. */
  controls: string;
  nudge?: boolean;
}) {
  return (
    <AriaButton
      aria-expanded={open}
      aria-controls={controls}
      onPress={onToggle}
      className="flex w-full cursor-pointer flex-wrap items-center gap-4 border-t border-line-soft px-6 py-[11px] text-left text-body-sm text-ink-secondary outline-hidden hover:bg-card-sunk data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-ink"
    >
      <span className="text-overline uppercase text-ink-muted">{label}</span>
      {summary ? (
        <span className={cx('flex flex-wrap items-center gap-4 transition-opacity duration-200', open && 'opacity-0 max-sm:hidden')}>{summary}</span>
      ) : null}
      <span className="ml-auto flex items-center gap-1.5 font-semibold text-ink">
        {open ? 'Hide' : 'Show'}
        <span aria-hidden className={cx('inline-block transition-transform duration-300 motion-reduce:transition-none', open && 'rotate-180', nudge && !open && 'motion-safe:animate-[lb-nudge_1.5s_ease]')}>
          ▾
        </span>
      </span>
    </AriaButton>
  );
}
