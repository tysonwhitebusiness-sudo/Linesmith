'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * Controls — R3 3b: SegmentedToggle, Tabs, SelectBox.
 *
 * F2 measured 12 files hand-rolling toggle groups with 4 different "active"
 * styles, and `role="tab"` used once while 27 buttons carried `aria-pressed`.
 * The difference these three encode:
 *
 *  - SegmentedToggle switches how ONE thing is scoped (season / last 5 / H2H).
 *    Buttons with `aria-pressed`, in a `group`.
 *  - Tabs switch WHICH content is shown (markets, sections). Real
 *    `role="tab"` with arrow-key movement.
 *  - SelectBox is for a longer list than a toggle can hold.
 */

export interface Option<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export function SegmentedToggle<T extends string | number>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for assistive tech: "Record scope". */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx('inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] bg-card-sunk p-[3px] lb-scroll-x', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'shrink-0 whitespace-nowrap rounded-[7px] font-medium transition-[background-color,color,box-shadow] duration-quick ease-standard disabled:cursor-not-allowed disabled:text-ink-disabled',
              size === 'sm' ? 'px-2.5 py-1 text-label' : 'px-3 py-[7px] text-body-sm',
              on ? 'bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-ink-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: {
  items: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** When set, each tab points at a panel with id `${idPrefix}-panel-${value}`. */
  idPrefix?: string;
  className?: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(e.key) || enabled.length === 0) return;
    e.preventDefault();
    const i = enabled.findIndex((it) => it.value === value);
    const next =
      e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled[enabled.length - 1] : enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx('flex gap-4 overflow-x-auto border-b border-line lb-scroll-x', className)}>
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => {
              if (el) refs.current.set(it.value, el);
              else refs.current.delete(it.value);
            }}
            role="tab"
            type="button"
            id={idPrefix ? `${idPrefix}-tab-${it.value}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${it.value}` : undefined}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={it.disabled}
            onClick={() => onChange(it.value)}
            className={cx(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 pb-[11px] pt-3 text-body font-semibold transition-colors duration-quick ease-standard disabled:text-ink-disabled',
              on ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function SelectBox<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Visible labels are optional; the accessible name is not. */
  label: string;
  className?: string;
}) {
  return (
    <span className={cx('relative inline-flex max-w-full', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="max-w-full cursor-pointer appearance-none truncate rounded-ctl border border-line bg-card py-[7px] pl-2.5 pr-7 text-body-sm font-medium text-ink transition-colors duration-instant hover:border-ink-faint"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {typeof o.label === 'string' ? o.label : String(o.value)}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 10 6" width={10} height={6} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted">
        <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
