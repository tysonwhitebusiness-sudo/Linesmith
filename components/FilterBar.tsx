'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon, MoreIcon } from './icons';
import { SegmentedToggle } from './SegmentedToggle';

/**
 * Filters as one uniform row of buttons — Redesign Brief: "every button is
 * the same size and shape, no mixed control types." `icon` takes a rendered
 * element (e.g. `<PeopleIcon size={15} />`) rather than a name lookup, so any
 * icon from components/icons.tsx drops straight in without growing a
 * name-union here every time a new filter is added.
 */

export function FilterBar({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-clip"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}
      >
        {children}
      </div>
      {trailing}
    </div>
  );
}

const FILTER_BASE = 'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border px-4 py-2.5 text-[13px] font-semibold transition-colors';
const FILTER_INACTIVE = 'border-line bg-card text-ink-muted hover:border-masters/30';
const FILTER_ACTIVE = 'border-masters bg-accent-soft text-masters';

export function FilterButton({
  icon,
  label,
  value,
  active,
  onClick,
  pressed,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  active?: boolean;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`${FILTER_BASE} ${active ? FILTER_ACTIVE : FILTER_INACTIVE}`}
    >
      {icon}
      <span>{label}</span>
      {value ? <span className="font-semibold">{value}</span> : null}
    </button>
  );
}

/**
 * A native select dressed as a chip. Native is the right call on a phone —
 * the OS picker handles long option lists better than anything custom.
 */
export function FilterSelect({
  icon,
  label,
  value,
  options,
  onChange,
  fullWidth = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  /** Stretch to fill its container — for the sidebar's stacked rows, matching FilterDropdown's fullWidth. */
  fullWidth?: boolean;
}) {
  const current = options.find((o) => o.value === value);
  const active = options.length > 0 && value !== options[0].value;

  return (
    <span className={`relative ${FILTER_BASE} ${fullWidth ? 'w-full justify-between' : ''} ${active ? FILTER_ACTIVE : FILTER_INACTIVE}`}>
      {icon}
      <span className="text-ink-faint">{label}</span>
      <span className="max-w-[120px] truncate font-semibold">{current?.label ?? value}</span>
      <ChevronDownIcon className="text-ink-faint" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Compact pill version — used inside dropdowns/sidebar where FilterSearchBox's full width doesn't fit. */
export function FilterSearchInput({
  value,
  onChange,
  placeholder = 'Search players…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const active = value.trim() !== '';
  return (
    <span className={`${FILTER_BASE} ${active ? FILTER_ACTIVE : FILTER_INACTIVE}`}>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-28 bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
      />
    </span>
  );
}

/** Full-width bordered search box for the controls row — Redesign Brief's "Search players" field. */
export function FilterSearchBox({
  value,
  onChange,
  placeholder = 'Search players',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <span className="flex max-w-[280px] flex-1 items-center gap-2 rounded-xl border border-line bg-card px-3.5 py-2.5">
      <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-ink-faint">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full bg-transparent text-[13px] outline-none placeholder:text-ink-faint"
      />
    </span>
  );
}

/** Min/max American-odds range — e.g. narrow a whole tab to -300..+300 without leaving it for the Good Bets tab's fixed ceiling. Meant to live inside a FilterDropdown ("Odds") rather than stand alone, so it reads uniform with the rest of the row. */
export function FilterOddsRangeInputs({
  min,
  max,
  onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const parse = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };
  return (
    <div className="flex items-center gap-2 p-1">
      <input
        type="number"
        inputMode="numeric"
        value={min ?? ''}
        onChange={(e) => onChange(parse(e.target.value), max)}
        placeholder="-300"
        aria-label="Minimum odds"
        className="w-16 rounded-lg border border-line bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-ink-faint focus:border-masters"
      />
      <span className="text-ink-faint">to</span>
      <input
        type="number"
        inputMode="numeric"
        value={max ?? ''}
        onChange={(e) => onChange(min, parse(e.target.value))}
        placeholder="+300"
        aria-label="Maximum odds"
        className="w-16 rounded-lg border border-line bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-ink-faint focus:border-masters"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter dropdown / picker components
// ---------------------------------------------------------------------------

export interface FilterDropdownProps {
  icon: ReactNode;
  label: string;
  /** Count or value badge to show when active. */
  badge?: string | number;
  active?: boolean;
  children: ReactNode;
  /** Right-align the popover instead of left — for triggers near the right edge (e.g. the "..." overflow menu). */
  align?: 'left' | 'right';
  /** Render the trigger as an icon-only button (e.g. "...") instead of the uniform labelled filter button. */
  iconOnly?: boolean;
  /** Stretch the trigger to fill its container instead of the row's shrink-to-content sizing — for the sidebar's stacked rows, which reuse this exact same popover rather than a separate implementation. */
  fullWidth?: boolean;
}

/**
 * A filter button that opens a small overlay popover.
 *
 * Tapping outside or pressing Escape closes it. The overlay reuses card
 * elevation so it reads as a disclosure, not a separate dialog.
 */
interface PopoverCoords {
  top: number;
  left?: number;
  right?: number;
  width?: number;
}

export function FilterDropdown({
  icon,
  label,
  badge,
  active,
  children,
  align = 'left',
  iconOnly = false,
  fullWidth = false,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<PopoverCoords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // The trigger row (FilterBar) horizontally scrolls with overflow-y clipped,
  // so an absolutely-positioned popover nested inside it renders invisible in
  // that layout — it's clipped by its own scroll ancestor before it ever
  // reaches the button's actual screen position. Portaling to <body> and
  // positioning from getBoundingClientRect sidesteps that ancestor entirely,
  // so the popover shows up regardless of which container the trigger sits in.
  const updateCoords = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (fullWidth) {
      setCoords({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    } else if (align === 'right') {
      setCoords({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    } else {
      setCoords({ top: rect.bottom + 6, left: rect.left });
    }
  }, [align, fullWidth]);

  useEffect(() => {
    if (!open) return;
    updateCoords();
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const reposition = () => updateCoords();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', reposition);
    // capture:true so this also catches scroll on the FilterBar's own
    // scrolling row, not just the window.
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, updateCoords]);

  return (
    <div className={fullWidth ? 'w-full' : 'shrink-0'}>
      {iconOnly ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={label}
          title={label}
          className={`flex h-[42px] w-[42px] items-center justify-center rounded-xl border transition-colors ${active ? FILTER_ACTIVE : FILTER_INACTIVE}`}
        >
          {icon}
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className={`${FILTER_BASE} ${fullWidth ? 'w-full justify-between' : ''} ${active ? FILTER_ACTIVE : FILTER_INACTIVE}`}
        >
          {icon}
          <span>{label}</span>
          {badge != null && badge !== '' && badge !== 0 ? <span className="font-semibold">{badge}</span> : null}
          <ChevronDownIcon className={`text-ink-faint ${fullWidth ? 'ml-auto' : ''}`} />
        </button>
      )}

      {open && coords
        ? createPortal(
            <div
              ref={popoverRef}
              style={{ position: 'fixed', top: coords.top, left: coords.left, right: coords.right, width: coords.width }}
              className={`z-30 ${coords.width ? '' : 'min-w-[200px]'} rounded-xl border border-line bg-card p-2 shadow-pop`}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export interface CheckboxListProps {
  options: Array<{ value: string; label: ReactNode; icon?: ReactNode }>;
  selected: Set<string>;
  onToggle: (value: string) => void;
  onSelectAll?: () => void;
  onClear?: () => void;
}

/** Multi-select checkbox list for use inside a FilterDropdown. */
export function CheckboxList({
  options,
  selected,
  onToggle,
  onSelectAll,
  onClear,
}: CheckboxListProps) {
  if (options.length === 0) {
    return <p className="py-2 text-center text-[11px] text-ink-faint">Nothing to filter</p>;
  }

  return (
    <div className="max-h-[240px] overflow-y-auto">
      {(onSelectAll || onClear) ? (
        <div className="mb-1 flex gap-2 border-b border-line pb-1.5">
          {onSelectAll ? (
            <button
              type="button"
              onClick={onSelectAll}
              className="text-[11px] font-semibold text-masters"
            >
              All
            </button>
          ) : null}
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] text-ink-muted"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
      {options.map((opt) => {
        const checked = selected.has(opt.value);
        return (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-accent-soft/30"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(opt.value)}
              className="h-3.5 w-3.5 accent-masters"
            />
            {opt.icon}
            <span className="truncate">{opt.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** A single named boolean as a checkbox row — for small fixed sets (e.g. Hot/Cold/Consistent) that don't fit CheckboxList's Set<string>-of-interchangeable-values shape. */
export function BooleanCheckboxRow({
  label,
  checked,
  onChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  icon?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-accent-soft/30">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5 accent-masters" />
      {icon}
      <span>{label}</span>
    </label>
  );
}

/** Player props vs. a simple game-lines view — deliberately not another Scan filter, since it swaps the whole content area rather than narrowing the player table. `labels` lets golf relabel the same two-state switch ("Field" / "Match Winner") without a second component — the underlying scope values stay 'players'/'games' either way. */
export function ScanScopeToggle({
  scope,
  onChange,
  labels,
}: {
  scope: 'players' | 'games';
  onChange: (scope: 'players' | 'games') => void;
  labels?: { players: string; games: string };
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-xl bg-ink/[0.05] p-1">
      {(
        [
          { key: 'players' as const, label: labels?.players ?? 'Players' },
          { key: 'games' as const, label: labels?.games ?? 'Games' },
        ]
      ).map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={scope === option.key}
          className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
            scope === option.key ? 'bg-card text-ink shadow-card' : 'text-ink-muted'
          }`}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/**
 * Golf-only: a single 3-way switch replacing what used to be two separate
 * pill toggles (Hole Props/Round Score, and a golf-relabeled
 * `ScanScopeToggle` for Field/Match Winner) — collapsed into one control
 * since "Field" was never a distinct destination, just the absence of
 * "Match Winner". Built on the same glider `SegmentedToggle` MLB's Game/Team
 * Detail tabs use, rather than the plain color-swap pill the old two toggles
 * used.
 */
export function GolfScanModeToggle({
  mode,
  onChange,
}: {
  mode: 'holes' | 'rounds' | 'match-winner';
  onChange: (mode: 'holes' | 'rounds' | 'match-winner') => void;
}) {
  return (
    <SegmentedToggle
      options={[
        { key: 'holes' as const, label: 'Hole Props' },
        { key: 'rounds' as const, label: 'Round Score' },
        { key: 'match-winner' as const, label: 'Match Winner' },
      ]}
      value={mode}
      onChange={onChange}
      className="rounded-xl border border-line p-1"
      buttonClassName="whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px]"
      gliderClassName="rounded-lg"
    />
  );
}

/** Two-state layout switch: cards for reading, rows for scanning — icon buttons per the Redesign Brief instead of the old text-pill toggle. */
export function DensityToggle({
  dense,
  onChange,
}: {
  dense: boolean;
  onChange: (dense: boolean) => void;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {[
        { key: false, label: 'Card view', icon: <GridGlyph /> },
        { key: true, label: 'Row view', icon: <ListGlyph /> },
      ].map((option) => (
        <button
          key={String(option.key)}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={dense === option.key}
          aria-label={option.label}
          title={option.label}
          className={`flex h-[42px] w-[42px] items-center justify-center rounded-xl border transition-colors ${
            dense === option.key ? FILTER_ACTIVE : FILTER_INACTIVE
          }`}
        >
          {option.icon}
        </button>
      ))}
    </span>
  );
}

function GridGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </svg>
  );
}

function ListGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="8" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="18" x2="20" y2="18" />
      <line x1="4" y1="6" x2="4.01" y2="6" />
      <line x1="4" y1="12" x2="4.01" y2="12" />
      <line x1="4" y1="18" x2="4.01" y2="18" />
    </svg>
  );
}

/** The "..." overflow trigger — icon-only FilterDropdown, right-aligned popover, for controls that don't fit the uniform 6-filter row (Players multi-select, Sportsbook, Good Bet, Clear all). */
export function OverflowMenu({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <FilterDropdown icon={<MoreIcon size={17} />} label="More options" active={active} align="right" iconOnly>
      <div className="min-w-[220px] space-y-1">{children}</div>
    </FilterDropdown>
  );
}

/** Icon-only button matching the uniform control size — for the sidebar toggle. */
export function IconToggleButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border transition-colors ${active ? FILTER_ACTIVE : FILTER_INACTIVE}`}
    >
      {icon}
    </button>
  );
}

export default FilterBar;
