'use client';

/*
 * Adapted from Untitled UI React (`components/base/input`, `select`, `checkbox`,
 * `radio-buttons`, `toggle`), github.com/untitleduico/react
 * @ c981a73bcd6b6c68d2a54070f20f020191212828, MIT. Rewritten to our tokens,
 * our type ramp, our sizes and our `cx`.
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import {
  Checkbox as AriaCheckbox,
  ComboBox as AriaComboBox,
  Input as AriaInput,
  Label as AriaLabel,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Header as AriaHeader,
  Popover,
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  Select as AriaSelect,
  SelectValue,
  Switch as AriaSwitch,
  Button as AriaButton,
  FileTrigger,
} from 'react-aria-components';
import { cx } from './cx';

/**
 * U3 — the field family. A page never styles an input again (U spec §0, §4).
 *
 * THE ONE TYPE RULE (§2b): below 768px every field's text is the `field`
 * token, 16px, because iOS zooms the page when an input under 16px takes
 * focus. From 768px up it is `body`. `FIELD_TEXT` is that rule, once.
 *
 * Select and ComboBox are React Aria's: the trigger is a BUTTON and the list is
 * a popover, so a select no longer zooms on focus at all, looks the same in
 * every browser, and gets typeahead and arrow keys from the library rather
 * than from us.
 */

export type FieldSize = 'sm' | 'md' | 'lg';

/** 16px below 768 (no iOS focus zoom), `body` above. */
export const FIELD_TEXT = 'text-field md:text-body';

const HEIGHT: Record<FieldSize, string> = { sm: 'h-8', md: 'h-9', lg: 'h-11' };

/** The ring every field shares: `line`, `ink-faint` on hover, a 2px `ink` inset on focus, `bad` when invalid. */
const RING =
  'rounded-ctl bg-card text-ink ring-1 ring-inset ring-line outline-hidden transition-shadow duration-instant placeholder:text-ink-muted hover:ring-ink-faint focus:ring-2 focus:ring-ink disabled:cursor-not-allowed disabled:opacity-50';
const INVALID = 'ring-bad hover:ring-bad focus:ring-bad';

/* ---------------------------------------------------------------- Field */

export interface FieldProps {
  label?: ReactNode;
  /** Below the control, `label` `ink-muted`. Replaced by `error` when there is one. */
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

/** Label above, control, then the hint or the error. */
export function Field({ label, hint, error, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="text-body-sm font-semibold text-ink-secondary">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p role="alert" className="flex items-center gap-1 text-label text-bad-ink">
          <svg aria-hidden viewBox="0 0 16 16" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 4.5v4M8 11v.5" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      ) : hint ? (
        <p className="text-label text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Input */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: FieldSize;
  invalid?: boolean;
  /** 16px icon inside the left edge. */
  leading?: ReactNode;
  /** Anything inside the right edge — a unit, a clear button. */
  trailing?: ReactNode;
  /** Classes for the wrapper (width, flex) rather than the input itself. */
  className?: string;
}

/** A search field's leading icon, so every search box draws the same glass. */
export const SearchIcon = (
  <svg aria-hidden viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.6">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" strokeLinecap="round" />
  </svg>
);

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = 'md', invalid, leading, trailing, className, ...rest },
  ref,
) {
  return (
    <span className={cx('relative inline-flex w-full items-center', className)}>
      {leading ? <span className="pointer-events-none absolute left-2.5 flex text-ink-muted">{leading}</span> : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        {...rest}
        className={cx('w-full min-w-0', HEIGHT[size], FIELD_TEXT, RING, invalid && INVALID, leading ? 'pl-8' : 'pl-3', trailing ? 'pr-9' : 'pr-3')}
      />
      {trailing ? <span className="absolute right-2 flex items-center text-ink-muted">{trailing}</span> : null}
    </span>
  );
});

/* ---------------------------------------------------------------- Textarea */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className, ...rest }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} {...rest} className={cx('min-h-20 w-full px-3 py-2', FIELD_TEXT, RING, invalid && INVALID, className)} />;
});

/* ---------------------------------------------------------------- Checkbox */

export function Checkbox({
  isSelected,
  isIndeterminate,
  onChange,
  children,
  hint,
  isDisabled,
  className,
}: {
  isSelected: boolean;
  isIndeterminate?: boolean;
  onChange: (selected: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
  isDisabled?: boolean;
  className?: string;
}) {
  return (
    <AriaCheckbox
      isSelected={isSelected}
      isIndeterminate={isIndeterminate}
      onChange={onChange}
      isDisabled={isDisabled}
      className={cx('group flex cursor-pointer items-start gap-2 data-disabled:cursor-not-allowed data-disabled:opacity-50', className)}
    >
      {({ isSelected: on, isIndeterminate: mixed }) => (
        <>
          <span
            className={cx(
              'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] ring-1 ring-inset transition-colors duration-instant group-data-focus-visible:ring-2 group-data-focus-visible:ring-ink',
              on || mixed ? 'bg-masters ring-masters text-white' : 'bg-card ring-line',
            )}
          >
            {mixed ? (
              <svg aria-hidden viewBox="0 0 12 12" width={10} height={10}>
                <path d="M2.5 6h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : on ? (
              <svg aria-hidden viewBox="0 0 12 12" width={10} height={10} fill="none">
                <path d="M2.5 6.2 5 8.5l4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </span>
          <span className="flex flex-col">
            <span className="text-body-sm font-medium text-ink">{children}</span>
            {hint ? <span className="text-label text-ink-muted">{hint}</span> : null}
          </span>
        </>
      )}
    </AriaCheckbox>
  );
}

/* ---------------------------------------------------------------- Radio */

export function RadioGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  orientation = 'vertical',
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; hint?: ReactNode; disabled?: boolean }>;
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}) {
  return (
    <AriaRadioGroup
      aria-label={label}
      value={value}
      onChange={(v) => onChange(v as T)}
      orientation={orientation}
      className={cx('flex gap-2', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap gap-4', className)}
    >
      {options.map((o) => (
        <AriaRadio key={o.value} value={o.value} isDisabled={o.disabled} className="group flex cursor-pointer items-start gap-2 data-disabled:cursor-not-allowed data-disabled:opacity-50">
          {({ isSelected }) => (
            <>
              <span
                className={cx(
                  'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ring-1 ring-inset transition-colors duration-instant group-data-focus-visible:ring-2 group-data-focus-visible:ring-ink',
                  isSelected ? 'bg-masters ring-masters' : 'bg-card ring-line',
                )}
              >
                {isSelected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
              </span>
              <span className="flex flex-col">
                <span className="text-body-sm font-medium text-ink">{o.label}</span>
                {o.hint ? <span className="text-label text-ink-muted">{o.hint}</span> : null}
              </span>
            </>
          )}
        </AriaRadio>
      ))}
    </AriaRadioGroup>
  );
}

/* ---------------------------------------------------------------- Toggle */

/** React Aria's `Switch`: a 36×20 track, `masters` when on, a 16px white thumb. */
export function Toggle({
  isSelected,
  onChange,
  children,
  isDisabled,
  className,
}: {
  isSelected: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
  isDisabled?: boolean;
  className?: string;
}) {
  return (
    <AriaSwitch
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
      className={cx('group flex cursor-pointer items-center gap-2 data-disabled:cursor-not-allowed data-disabled:opacity-50', className)}
    >
      <span
        className={cx(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-quick group-data-focus-visible:ring-2 group-data-focus-visible:ring-ink group-data-focus-visible:ring-offset-2',
          isSelected ? 'bg-masters' : 'bg-card-sunk ring-1 ring-inset ring-line-soft',
        )}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-card transition-transform duration-quick', isSelected ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
      <span className="text-body-sm font-medium text-ink">{children}</span>
    </AriaSwitch>
  );
}

/* ---------------------------------------------------------------- Select */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** `ink-muted` sub-text under the label. */
  sub?: string;
  /** 24px leading image — an `Avatar` or a logo. */
  image?: ReactNode;
  disabled?: boolean;
}

const POPOVER = 'min-w-(--trigger-width) overflow-auto rounded-[8px] bg-card p-1 shadow-pop ring-1 ring-line-soft outline-hidden';

function OptionRow<T extends string>({ o }: { o: SelectOption<T> }) {
  return (
    <ListBoxItem
      id={o.value}
      textValue={o.label}
      isDisabled={o.disabled}
      className="group flex min-h-9 cursor-pointer items-center gap-2 rounded-ctl px-2 py-1.5 text-body text-ink outline-hidden data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focused:bg-card-sunk data-selected:bg-card-sunk"
    >
      {({ isSelected }) => (
        <>
          {o.image ? <span className="flex shrink-0">{o.image}</span> : null}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{o.label}</span>
            {o.sub ? <span className="truncate text-label text-ink-muted">{o.sub}</span> : null}
          </span>
          {isSelected ? (
            <svg aria-hidden viewBox="0 0 16 16" width={14} height={14} fill="none" className="shrink-0 text-ink">
              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : null}
        </>
      )}
    </ListBoxItem>
  );
}

const CHEVRON = (
  <svg aria-hidden viewBox="0 0 10 6" width={10} height={6} className="shrink-0 text-ink-muted">
    <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export interface SelectProps<T extends string> {
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Visible labels are optional; the accessible name is not. */
  label: string;
  /** Show `label` above the trigger. */
  showLabel?: boolean;
  size?: FieldSize;
  isDisabled?: boolean;
  className?: string;
  /** Classes for the trigger — a denser chrome select passes its own height/text. */
  triggerClassName?: string;
}

export function Select<T extends string>({ options, value, onChange, label, showLabel, size = 'md', isDisabled, className, triggerClassName }: SelectProps<T>) {
  return (
    <AriaSelect
      aria-label={showLabel ? undefined : label}
      selectedKey={value}
      onSelectionChange={(k) => {
        if (k != null) onChange(String(k) as T);
      }}
      isDisabled={isDisabled}
      className={cx('inline-flex max-w-full flex-col gap-1.5', className)}
    >
      {showLabel ? <AriaLabel className="text-body-sm font-semibold text-ink-secondary">{label}</AriaLabel> : null}
      <AriaButton
        className={cx(
          'flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 px-2.5 text-left font-medium',
          HEIGHT[size],
          size === 'sm' ? 'text-body-sm' : 'text-body',
          RING,
          'data-focus-visible:ring-2 data-focus-visible:ring-ink data-pressed:bg-card-sunk',
          triggerClassName,
        )}
      >
        <SelectValue className="min-w-0 truncate" />
        {CHEVRON}
      </AriaButton>
      <Popover className={cx(POPOVER, 'max-h-80')} offset={4}>
        <ListBox className="outline-hidden">
          {options.map((o) => (
            <OptionRow key={o.value} o={o} />
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

/* ---------------------------------------------------------------- ComboBox */

export interface ComboBoxProps<T extends string> {
  options: SelectOption<T>[];
  /** Called with the picked option's value. */
  onPick: (value: T) => void;
  label: string;
  placeholder?: string;
  /** Controlled text, when the caller also filters on it. */
  inputValue?: string;
  onInputChange?: (text: string) => void;
  size?: FieldSize;
  className?: string;
}

/** Filters as you type; Enter or a click picks. */
export function ComboBox<T extends string>({ options, onPick, label, placeholder, inputValue, onInputChange, size = 'md', className }: ComboBoxProps<T>) {
  return (
    <AriaComboBox
      aria-label={label}
      inputValue={inputValue}
      onInputChange={onInputChange}
      selectedKey={null}
      onSelectionChange={(k) => {
        if (k != null) onPick(String(k) as T);
      }}
      menuTrigger="focus"
      allowsEmptyCollection
      className={cx('relative w-full', className)}
    >
      <span className="relative flex items-center">
        <span className="pointer-events-none absolute left-2.5 flex text-ink-muted">{SearchIcon}</span>
        <AriaInput placeholder={placeholder} className={cx('w-full min-w-0 pl-8 pr-3', HEIGHT[size], FIELD_TEXT, RING)} />
      </span>
      <Popover className={cx(POPOVER, 'max-h-72')} offset={4}>
        <ListBox className="outline-hidden" renderEmptyState={() => <p className="px-2 py-3 text-body-sm text-ink-muted">No matches.</p>}>
          {options.map((o) => (
            <OptionRow key={o.value} o={o} />
          ))}
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}

/* ---------------------------------------------------------------- PickList */

export interface PickItem {
  key: string;
  label: string;
  sub?: ReactNode;
  image?: ReactNode;
  /** A chip or count at the right edge. */
  badge?: ReactNode;
  /** C3: the right-edge block — the headline value + unit + the "N mkts" chip. */
  trailing?: ReactNode;
  /** C3: the team primary, drawn as a 3px bar on the selected row's left edge. */
  accent?: string;
  /** A small tag after the label (a position). */
  tag?: ReactNode;
  group?: string;
}

/**
 * An always-open single-selection list — the master side of a master/detail
 * page (players, teams, a schedule). React Aria's `ListBox`: arrow keys move,
 * typeahead jumps, and it announces as a listbox with a selected option, which
 * the five hand-built `role="option"` buttons it replaced only claimed to.
 */
export function PickList({
  label,
  items,
  value,
  onChange,
  empty,
  className,
}: {
  label: string;
  items: PickItem[];
  value: string | null;
  onChange: (key: string) => void;
  empty?: ReactNode;
  className?: string;
}) {
  const groups = [...new Set(items.map((i) => i.group ?? ''))];
  const row = (i: PickItem) => (
    <ListBoxItem
      key={i.key}
      id={i.key}
      textValue={i.label}
      className="group relative flex cursor-pointer items-center gap-2 rounded-ctl px-2 py-1.5 text-left outline-hidden transition-colors duration-instant data-focus-visible:ring-2 data-focus-visible:ring-ink data-hovered:bg-card-sunk data-selected:bg-accent-soft"
    >
      {i.accent ? (
        <span aria-hidden className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full opacity-0 transition-opacity duration-instant group-data-selected:opacity-100" style={{ background: i.accent }} />
      ) : null}
      {i.image ? <span className="flex shrink-0">{i.image}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-body-sm font-semibold text-ink group-data-selected:text-masters">{i.label}</span>
          {i.tag ? <span className="shrink-0">{i.tag}</span> : null}
        </span>
        {i.sub ? <span className="block truncate text-label text-ink-muted">{i.sub}</span> : null}
      </span>
      {i.trailing != null ? (
        <span className="flex shrink-0 flex-col items-end">{i.trailing}</span>
      ) : i.badge != null ? (
        <span className="shrink-0 text-label tabular-nums text-ink-secondary">{i.badge}</span>
      ) : null}
    </ListBoxItem>
  );
  return (
    <ListBox
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={value ? [value] : []}
      onSelectionChange={(keys) => {
        const k = [...(keys as Set<string | number>)][0];
        if (k != null) onChange(String(k));
      }}
      renderEmptyState={() => <p className="p-4 text-center text-body-sm text-ink-muted">{empty ?? 'Nothing to list.'}</p>}
      className={cx('outline-hidden', className)}
    >
      {groups.length > 1 || groups[0]
        ? groups.map((g) => (
            <ListBoxSection key={g || '_'} id={g || '_'}>
              {g ? <AriaHeader className="sticky top-0 z-1 bg-card px-1 pb-1 pt-2 text-overline uppercase text-ink-muted">{g}</AriaHeader> : null}
              {items.filter((i) => (i.group ?? '') === g).map(row)}
            </ListBoxSection>
          ))
        : items.map(row)}
    </ListBox>
  );
}

/* ---------------------------------------------------------------- File */

/**
 * A file picker opened by any kit Button — React Aria's `FileTrigger`, so a
 * page never hides its own `<input type="file">` behind a styled label again.
 */
export { FileTrigger };
