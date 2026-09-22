'use client';

import { type ReactNode } from 'react';
import { ChevronDownIcon, MoreIcon } from './icons';
import { Button, IconButton, Input, Checkbox, SegmentedToggle, Popover, Select, SearchIcon, RadioGroup } from './ui';

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

/** The book picker — the kit `Select`, so it no longer zooms on a phone. */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      label={label}
      size="sm"
      value={value}
      onChange={onChange}
      className="shrink-0"
      options={options.map((o) => ({ value: o.value, label: o.label }))}
    />
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
    <Input
      type="search"
      size="sm"
      leading={SearchIcon}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="max-w-[280px] flex-1"
    />
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
      <Input
        type="number"
        size="sm"
        inputMode="numeric"
        value={min ?? ''}
        onChange={(e) => onChange(parse(e.target.value), max)}
        placeholder="-300"
        aria-label="Minimum odds"
        className="w-16"
      />
      <span className="text-ink-muted">to</span>
      <Input
        type="number"
        size="sm"
        inputMode="numeric"
        value={max ?? ''}
        onChange={(e) => onChange(min, parse(e.target.value))}
        placeholder="+300"
        aria-label="Maximum odds"
        className="w-16"
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
  const trigger = iconOnly ? (
    <IconButton aria-label={label} icon={icon} variant={active ? 'secondary' : 'tertiary'} />
  ) : (
    <Button
      variant={active ? 'secondary' : 'tertiary'}
      size="sm"
      icon={icon}
      iconTrailing={<ChevronDownIcon size={13} className="text-ink-muted" />}
      className={fullWidth ? 'w-full justify-between' : 'shrink-0 whitespace-nowrap'}
    >
      <span className="text-ink-muted">{label}</span>
      {badge != null && badge !== '' && badge !== 0 ? <span className="font-semibold">{badge}</span> : null}
    </Button>
  );
  return (
    <Popover trigger={trigger} label={label} placement={align === 'right' ? 'bottom end' : 'bottom start'}>
      {children}
    </Popover>
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
    return <p className="py-2 text-center text-label text-ink-muted">Nothing to filter</p>;
  }

  return (
    <div className="max-h-[240px] overflow-y-auto p-1">
      {(onSelectAll || onClear) ? (
        <div className="mb-1 flex gap-2 border-b border-line pb-1.5">
          {onSelectAll ? <Button variant="tertiary" size="sm" onPress={onSelectAll}>All</Button> : null}
          {onClear ? <Button variant="tertiary" size="sm" onPress={onClear}>Clear</Button> : null}
        </div>
      ) : null}
      {options.map((opt) => (
        <Checkbox
          key={opt.value}
          isSelected={selected.has(opt.value)}
          onChange={() => onToggle(opt.value)}
          className="rounded-lg px-2 py-1.5 hover:bg-accent-soft/30"
        >
          <span className="flex items-center gap-1.5">
            {opt.icon}
            <span className="truncate">{opt.label}</span>
          </span>
        </Checkbox>
      ))}
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
    <Checkbox isSelected={checked} onChange={onChange} className="rounded-lg px-2 py-1.5 hover:bg-accent-soft/30">
      <span className="flex items-center gap-1.5">
        {icon}
        <span>{label}</span>
      </span>
    </Checkbox>
  );
}

/** The Hit-rate filter's three-way choice — Any / ≥50% / ≥65% — on the kit. */
export function HitRatePicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <RadioGroup
      label="Hit rate"
      value={value === null ? 'any' : String(value)}
      onChange={(v) => onChange(v === 'any' ? null : Number(v))}
      options={[
        { value: '65', label: '≥ 65%' },
        { value: '50', label: '≥ 50%' },
        { value: 'any', label: 'Any' },
      ]}
    />
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
    <SegmentedToggle
      label="Scan scope"
      size="sm"
      value={scope}
      onChange={onChange}
      options={[
        { value: 'players', label: labels?.players ?? 'Players' },
        { value: 'games', label: labels?.games ?? 'Games' },
      ]}
    />
  );
}

/**
 * Golf-only: which market the props board is showing.
 *
 * It was a 3-way switch whose third option ("Match Winner") swapped the whole
 * board for the winner prices. S1 made those a SECTION of their own above the
 * board, always visible, so the switch is back to the two things it is
 * actually choosing between — and you no longer lose the props to look at the
 * prices.
 */
export function GolfScanModeToggle({
  mode,
  onChange,
}: {
  mode: 'holes' | 'rounds';
  onChange: (mode: 'holes' | 'rounds') => void;
}) {
  return (
    <SegmentedToggle
      label="Golf market"
      size="sm"
      value={mode}
      onChange={onChange}
      options={[
        { value: 'holes', label: 'Hole Props' },
        { value: 'rounds', label: 'Round Score' },
      ]}
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
    <SegmentedToggle
      label="View"
      size="sm"
      value={dense ? 'rows' : 'cards'}
      onChange={(v) => onChange(v === 'rows')}
      options={[
        { value: 'cards', label: 'Cards', icon: <GridGlyph /> },
        { value: 'rows', label: 'Rows', icon: <ListGlyph /> },
      ]}
    />
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

/** The "..." overflow trigger — icon-only, right-aligned popover, for controls that don't fit the uniform filter row (Players multi-select, Clear all). */
export function OverflowMenu({ children, active }: { children: ReactNode; active?: boolean }) {
  return (
    <Popover
      label="More options"
      placement="bottom end"
      trigger={<IconButton aria-label="More options" icon={<MoreIcon size={16} />} variant={active ? 'secondary' : 'tertiary'} />}
    >
      <div className="min-w-[220px] space-y-1">{children}</div>
    </Popover>
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
  return <IconButton aria-label={label} icon={icon} onPress={onClick} variant={active ? 'secondary' : 'tertiary'} />;
}

export default FilterBar;
