'use client';

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

/**
 * DataTable — R3 3b. Sortable, sticky header and first column, numeric columns
 * right-aligned with tabular figures, string columns left as they are. Scrolls
 * inside its own container, so a wide table never widens the page (R3 3d).
 *
 * Sorting is by `sortValue` when given (a date string, a rank), else by the
 * raw `row[key]`. Missing values sort last in both directions.
 *
 * R9c — EMPHASIS, SO A TABLE IS NOT A WALL OF GREY. Two opt-in cell signals,
 * both computed by the caller because only it knows what a column means:
 *
 *   `bar`    0..1 behind the number, drawn from the cell's own edge. It says
 *            HOW MUCH, never how good: a share of the column's largest value,
 *            or of the row's two sides. Neutral ink, so it cannot be read as a
 *            verdict on a stat where less is better (fumbles, interceptions).
 *   `strong` this cell leads its column. Only a caller that has declared which
 *            direction is better sets it, and the number stays legible on its
 *            own — weight is the signal, not colour.
 *
 * The first column carries the row's identity, so it is always the heavier one.
 */
export interface Column<Row> {
  key: string;
  label: ReactNode;
  numeric?: boolean;
  /** Default true. */
  sortable?: boolean;
  render?: (row: Row) => ReactNode;
  sortValue?: (row: Row) => number | string | null | undefined;
  /** Accessible header text when `label` is not a string. */
  title?: string;
  /** 0..1 magnitude behind the value (R9c). Null draws none. */
  bar?: (row: Row) => number | null;
  /** This cell leads its column (R9c). */
  strong?: (row: Row) => boolean;
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  initialSort?: { key: string; desc: boolean };
  onRowClick?: (row: Row) => void;
  dense?: boolean;
  /** Required: names the table for assistive tech. */
  caption: string;
  /**
   * A class for one row — the live card tints a line that has cleared (R6.3).
   * Row state must never be colour alone: the caller marks the cell too.
   */
  rowClassName?: (row: Row) => string | undefined;
  className?: string;
  maxHeight?: number;
}

export function DataTable<Row>({ columns, rows, rowKey, initialSort, onRowClick, dense, caption, className, maxHeight, rowClassName }: DataTableProps<Row>) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const val = (r: Row) => (col.sortValue ? col.sortValue(r) : ((r as Record<string, unknown>)[col.key] as number | string | null | undefined));
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null || va === '') return 1;
      if (vb == null || vb === '') return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) => setSort((s) => (s && s.key === key ? { key, desc: !s.desc } : { key, desc: true }));
  const onHeaderKey = (e: KeyboardEvent<HTMLTableCellElement>, key: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(key);
    }
  };

  const cell = dense ? 'px-2.5 py-[7px]' : 'px-2.5 py-[9px]';

  return (
    <div className={cx('overflow-auto', className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c, i) => {
              const sortable = c.sortable !== false;
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.desc ? 'descending' : 'ascending') : undefined}
                  tabIndex={sortable ? 0 : undefined}
                  title={c.title}
                  onClick={sortable ? () => toggle(c.key) : undefined}
                  onKeyDown={sortable ? (e) => onHeaderKey(e, c.key) : undefined}
                  className={cx(
                    'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-card text-label font-semibold text-ink-muted',
                    cell,
                    c.numeric ? 'text-right' : 'text-left',
                    i === 0 && 'left-0 z-20',
                    sortable && 'cursor-pointer select-none hover:text-ink',
                  )}
                >
                  {c.label}
                  {sortable ? (
                    <span aria-hidden className={cx('ml-1', active ? 'opacity-100' : 'opacity-0')}>
                      {active && !sort!.desc ? '▲' : '▼'}
                    </span>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, ri) => (
            <tr
              key={rowKey(row, ri)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
              className={cx('group transition-colors duration-instant hover:bg-card-sunk', onRowClick && 'cursor-pointer', rowClassName?.(row))}
            >
              {columns.map((c, i) => {
                const v = c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as ReactNode);
                const share = c.bar?.(row) ?? null;
                const leads = c.strong?.(row) ?? false;
                return (
                  <td
                    key={c.key}
                    className={cx(
                      'relative whitespace-nowrap border-b border-line-soft text-ink',
                      cell,
                      c.numeric && 'text-right tabular-nums',
                      // U0: the label column's own weight comes FIRST and the
                      // leader mark after it, because `cx` now merges — the
                      // last conflicting class wins outright instead of racing
                      // `font-medium` and `font-semibold` in the cascade (where
                      // 600 happened to be emitted second, and won).
                      i === 0 && 'sticky left-0 bg-card font-medium group-hover:bg-card-sunk',
                      leads && 'font-semibold',
                    )}
                  >
                    {share != null && share > 0 ? (
                      <span
                        aria-hidden
                        className={cx('pointer-events-none absolute inset-y-[3px] rounded-[2px] bg-ink/[0.08]', c.numeric ? 'right-1' : 'left-1')}
                        style={{ width: `${Math.max(2, Math.min(100, share * 100)) * 0.92}%` }}
                      />
                    ) : null}
                    <span className="relative">{v ?? '—'}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
