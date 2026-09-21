'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { heatFill, heatInk } from '@/lib/ui/heat';
import { StreakStrip } from '@/components/charts/StreakStrip';
import { Chip } from './Chip';
import { Pagination, type PagingOptions } from './Pagination';
import { Tooltip } from './Tooltip';
import { cx } from './cx';

/**
 * DataTable — the Hybrid (U spec §3): our engine and our density, with Untitled
 * UI's chrome. It stays a plain `<table>` on purpose. React Aria's Table renders
 * `role="grid"`, which makes every cell an arrow-key stop and switches screen
 * readers into application mode: right for a selectable list, wrong for stats
 * you read.
 *
 *   ┌ Card ───────────────────────────────────────────────────────────┐
 *   │ Game log [148]        2026 regular season  [2026|2025]        ⤢ │ header
 *   ├─────────────────────────────────────────────────────────────────┤
 *   │ Date ↓ │ Opp   │ Result │ AB ⇅ │ H ⇅ │ … │ TB ? ⇅               │ band 34
 *   ├────────┼───────┼────────┼──────┼─────┼───┼─────────────────────┤
 *   │ Sep 17 │ @ BOS │ [W] 6–3│  4   │  2  │ … │ ▇▇▇▇ 5              │ rows 36
 *   ├─────────────────────────────────────────────────────────────────┤
 *   │ 1–10 of 148 games              Rows [10]  ‹ Prev  Next ›        │ footer
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * WHAT A CELL MAY SAY is per-column and opt-in, because only the caller knows
 * what a column means:
 *
 *   `bar`     how much, NEVER how good — a share of the column max or of the
 *             row. Neutral ink, so it cannot read as a verdict on a stat where
 *             less is better (fumbles, interceptions).
 *   `strong`  this cell leads its column. Weight, not colour, and only where a
 *             direction has been declared. No mark on a tie.
 *   `heat`    a tint from `lib/ui/heat.ts`, per-column opt-in and only with a
 *             declared direction. For splits, ranked blocks, standings, hole
 *             difficulty. NEVER on a game log — a game log is a record, not a
 *             ranking, and tinting it invents a verdict on every row.
 *   `tone`    a good/bad chip then the rest in `ink-secondary` — "W 6–3".
 *             Result and outcome columns only.
 *   `streak`  ten-pixel squares: filled `good` = over or hit, outlined `bad` =
 *             under, outlined on `card-sunk` = no line that day. Last 5 / 10.
 *   `wrap`    the one column allowed to wrap (plays, injuries).
 *   `info`    a help button that opens our Tooltip. It REPLACES `Column.title`,
 *             a native tooltip that never showed on touch.
 *
 * ROW KINDS are props on the table: `groupBy` (a group row before each block),
 * `totals` (ruled closing rows, excluded from sorting, bars, leaders and heat),
 * `highlight` (the subject's own row, marked by fill AND an inset bar — never
 * colour alone) and `expand` (a row that opens in place).
 *
 * There is no selection. The one exception the spec allows is choosing rows to
 * compare, and no caller asks for it yet.
 */

export type Density = 'default' | 'compact';

export interface HeatSpec<Row> {
  /** Which way is better. A column with no direction never gets a tint. */
  direction: 'higher' | 'lower';
  /** The number to scale, when it is not the sort value. */
  value?: (row: Row) => number | null | undefined;
  /** The pool the value is ranked within. Defaults to this column's own rows. */
  pool?: (rows: Row[]) => number[];
}

export interface Column<Row> {
  key: string;
  label: ReactNode;
  numeric?: boolean;
  /** Default true. */
  sortable?: boolean;
  render?: (row: Row) => ReactNode;
  sortValue?: (row: Row) => number | string | null | undefined;
  /**
   * @deprecated U2: a native `title` never opens on touch. Use `info`.
   * Still read as the header's accessible name when `label` is not a string.
   */
  title?: string;
  /** Opens a real Tooltip from a help icon in the header. */
  info?: ReactNode;
  /** 0..1 magnitude behind the value. Null draws none. */
  bar?: (row: Row) => number | null;
  /** This cell leads its column. */
  strong?: (row: Row) => boolean;
  /** Per-column tint. Requires a direction; see the header note. */
  heat?: HeatSpec<Row>;
  /** A result column: a tone chip, then the rest in `ink-secondary`. */
  tone?: (row: Row) => 'good' | 'bad' | null;
  /**
   * A CATEGORICAL colour on the value itself — golf's under par / over par.
   * Not a result (`tone` draws a W/L chip) and not a rank (`heat` tints by
   * where the value sits in its pool): the value is good or bad by
   * definition, whatever the rest of the column holds. (U6.)
   */
  ink?: (row: Row) => 'good' | 'bad' | null;
  /**
   * Last 5 / Last 10 squares, drawn by the chart grammar's own `StreakStrip`
   * so there is one implementation of "a run of binary outcomes" in the app.
   * `null` inside `outcomes` is a real third state: the game happened but has
   * no answer to this question.
   */
  streak?: (row: Row) => { outcomes: Array<boolean | null>; titles?: string[] } | null;
  /** This column's text wraps, at a 170px minimum. */
  wrap?: boolean;
  /** A logo before the header label — compare-by-row tables. */
  headerImage?: ReactNode;
  /** Overrides the column's alignment. */
  align?: 'left' | 'right' | 'center';
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  initialSort?: { key: string; desc: boolean };
  onRowClick?: (row: Row) => void;
  /** 36px rows, or 28px for a matrix (a line score, a hole-by-hole grid). */
  density?: Density;
  /** @deprecated U2: `dense` is `density="compact"`. */
  dense?: boolean;
  /** Required: names the table for assistive tech. */
  caption: string;
  /** Shown under the table when it fits on one page (instead of a pager). */
  captionVisible?: ReactNode;
  /** A group row before each block. "Overall" gets no group row. */
  groupBy?: (row: Row) => string;
  /** Ruled closing rows. Not sorted, and excluded from bars, leaders and heat. */
  totals?: Row[];
  /** The subject's own row: a fill AND a 3px inset bar on the label cell. */
  highlight?: (row: Row) => boolean;
  /** Opens the row in place. Return null for a row with nothing behind it. */
  expand?: (row: Row) => ReactNode | null;
  paging?: PagingOptions;
  /**
   * A class for one row — the live card tints a line that has cleared (R6.3).
   * Row state must never be colour alone: the caller marks the cell too.
   */
  rowClassName?: (row: Row) => string | undefined;
  className?: string;
  maxHeight?: number;
  /**
   * A header row ABOVE the columns, for a table that compares two sides
   * ("His arsenal" over two columns, "Faced" over two). Spans must add up to
   * the column count. The group row scrolls away; the column row stays
   * sticky. (U6, finding U-7.)
   */
  columnGroups?: Array<{ label: ReactNode; span: number }>;
}

/* -------------------------------------------------------------------------- */

const SORT_ICON = (
  <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 1.5v9M3.2 4.3 6 1.5l2.8 2.8M3.2 7.7 6 10.5l2.8-2.8" />
  </svg>
);

const ARROW = (desc: boolean) => (
  <svg viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {desc ? <path d="M6 2v8M3 7l3 3 3-3" /> : <path d="M6 10V2M3 5l3-3 3 3" />}
  </svg>
);

const HELP_ICON = (
  <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M6.3 6.1a1.8 1.8 0 1 1 1.9 2.1v1" strokeLinecap="round" />
    <circle cx="8.2" cy="11.4" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

/** 0..1 within the pool, or null when the pool cannot rank it. */
function positionIn(pool: number[], v: number): number | null {
  if (pool.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const n of pool) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return null;
  return (v - min) / (max - min);
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  initialSort,
  onRowClick,
  density,
  dense,
  caption,
  captionVisible,
  groupBy,
  totals,
  highlight,
  expand,
  paging,
  className,
  maxHeight,
  rowClassName,
  columnGroups,
}: DataTableProps<Row>) {
  const compact = density === 'compact' || (density === undefined && dense === true);
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(initialSort ?? null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(paging?.pageSize ?? (paging?.mode === 'more' ? 20 : 10));
  const [shown, setShown] = useState(paging?.pageSize ?? (paging?.mode === 'more' ? 20 : 10));
  const [open, setOpen] = useState<string | null>(null);
  const [scrolledX, setScrolledX] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const uid = useId();

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const val = (r: Row) => (col.sortValue ? col.sortValue(r) : ((r as Record<string, unknown>)[col.key] as number | string | null | undefined));
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      // Blanks always sink — in both directions, so a column of mostly-empty
      // cells never buries the values you sorted to see.
      if (va == null || va === '') return 1;
      if (vb == null || vb === '') return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, columns, sort]);

  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const out: Array<{ group: string; rows: Row[] }> = [];
    for (const r of sorted) {
      const g = groupBy(r);
      const last = out[out.length - 1];
      if (last && last.group === g) last.rows.push(r);
      else out.push({ group: g, rows: [r] });
    }
    return out;
  }, [sorted, groupBy]);

  // Paging never applies to a grouped table: turning a page through a group
  // would cut a block in half and leave its heading behind.
  const pagingMode = paging?.mode ?? 'minimal';
  const paged = useMemo(() => {
    if (!paging || grouped) return sorted;
    if (pagingMode === 'more' || pagingMode === 'all') return sorted.slice(0, shown);
    return sorted.slice((page - 1) * pageSize, page * pageSize);
  }, [sorted, paging, grouped, pagingMode, page, pageSize, shown]);

  // Heat pools are read off ALL the rows, not the visible page — otherwise the
  // same value changes colour when you turn a page.
  const heatPools = useMemo(() => {
    const out = new Map<string, number[]>();
    for (const c of columns) {
      if (!c.heat) continue;
      const read = c.heat.value ?? ((r: Row) => (c.sortValue ? Number(c.sortValue(r)) : Number((r as Record<string, unknown>)[c.key])));
      // `Number(null)` is 0, which is finite — so a row that opts OUT of heat by
      // returning null would join the pool at zero and then be tinted as the
      // extreme. Found on the kit's hole grid, where the par row came out
      // uniformly green. Null means "not in this pool", not "zero".
      const pool = c.heat.pool
        ? c.heat.pool(rows)
        : rows
            .map((r) => read(r))
            .filter((v): v is number => v != null && Number.isFinite(Number(v)))
            .map(Number);
      out.set(c.key, pool);
    }
    return out;
  }, [columns, rows]);

  const leaders = useMemo(() => {
    const out = new Map<string, unknown>();
    for (const c of columns) {
      if (!c.strong) continue;
      const hits = rows.filter((r) => c.strong!(r));
      // No mark on a tie: a column with two "best" cells has no single leader.
      if (hits.length === 1) out.set(c.key, hits[0]);
    }
    return out;
  }, [columns, rows]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => setScrolledX(el.scrollLeft > 0);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const toggle = (c: Column<Row>) => {
    setSort((s) => {
      // A numeric column sorts high-first on the FIRST click: nobody opens a
      // stat column to see the smallest number.
      if (!s || s.key !== c.key) return { key: c.key, desc: c.numeric !== false };
      return { key: c.key, desc: !s.desc };
    });
    setPage(1);
  };

  const rowH = compact ? 'h-7' : 'h-9';
  const cellPad = compact ? 'px-1.5' : 'px-3';
  const firstPad = compact ? 'px-2' : 'px-3.5';
  const bandH = compact ? 'h-7' : 'h-[34px]';
  const textSize = compact ? 'text-label' : 'text-body-sm';
  const align = (c: Column<Row>) => c.align ?? (c.numeric ? 'right' : 'left');

  const body = (rowsToDraw: Row[], isTotals = false) =>
    rowsToDraw.map((row, ri) => {
      const key = rowKey(row, ri);
      const isOpen = open === key;
      const panel = !isTotals && expand ? expand(row) : null;
      const marked = !isTotals && highlight?.(row) === true;
      return [
        <tr
          key={key}
          tabIndex={onRowClick && !isTotals ? 0 : undefined}
          onClick={onRowClick && !isTotals ? () => onRowClick(row) : undefined}
          onKeyDown={onRowClick && !isTotals ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
          className={cx(
            'group transition-colors duration-instant',
            rowH,
            isTotals ? 'border-t border-line bg-card-sunk font-semibold' : 'hover:bg-card-sunk',
            marked && 'bg-card-sunk',
            onRowClick && !isTotals && 'cursor-pointer',
            !isTotals && rowClassName?.(row),
          )}
        >
          {columns.map((c, i) => {
            const v = c.render ? c.render(row) : ((row as Record<string, unknown>)[c.key] as ReactNode);
            const share = isTotals ? null : (c.bar?.(row) ?? null);
            const leads = !isTotals && leaders.get(c.key) === row;
            const tone = isTotals ? null : (c.tone?.(row) ?? null);
            const ink = c.ink?.(row) ?? null;
            const run = isTotals ? null : (c.streak?.(row) ?? null);

            let style: CSSProperties | undefined;
            if (!isTotals && c.heat) {
              const read = c.heat.value ?? ((r: Row) => (c.sortValue ? Number(c.sortValue(r)) : Number((r as Record<string, unknown>)[c.key])));
              const rawValue = read(row);
              const raw = rawValue == null ? NaN : Number(rawValue);
              const pool = heatPools.get(c.key) ?? [];
              const pos = Number.isFinite(raw) ? positionIn(pool, raw) : null;
              if (pos != null) {
                const t = c.heat.direction === 'lower' ? 1 - pos : pos;
                // Alpha 0.34·|2t−1| keeps the MIDPOINT clear: a middling value
                // should not be tinted at all, or the whole table looks judged.
                const strength = Math.abs(2 * t - 1);
                style = { backgroundColor: heatFill(t, 0.34 * strength) };
                if (strength > 0.45) style.color = heatInk(t);
              }
            }

            return (
              <td
                key={c.key}
                style={style}
                className={cx(
                  'relative border-b border-line-soft',
                  textSize,
                  i === 0 ? firstPad : cellPad,
                  c.wrap ? 'min-w-[170px] whitespace-normal py-2' : 'whitespace-nowrap',
                  align(c) === 'right' ? 'text-right tabular-nums' : align(c) === 'center' ? 'text-center' : 'text-left',
                  // Numbers read as the content; text columns step back.
                  c.numeric ? 'text-ink' : 'text-ink-secondary',
                  i === 0 && 'sticky left-0 z-10 bg-card font-medium text-ink group-hover:bg-card-sunk',
                  i === 0 && (marked || isTotals) && 'bg-card-sunk',
                  i === 0 && scrolledX && 'shadow-[1px_0_0_0_oklch(var(--line))]',
                  leads && 'font-semibold text-ink',
                )}
              >
                {i === 0 && marked ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-ink" /> : null}
                {share != null && share > 0 ? (
                  <span
                    aria-hidden
                    className={cx('pointer-events-none absolute inset-y-[5px] rounded-[2px] bg-ink/[0.08]', align(c) === 'right' ? 'right-1' : 'left-1')}
                    style={{ width: `${Math.max(2, Math.min(100, share * 100)) * 0.92}%` }}
                  />
                ) : null}
                <span className={cx('relative inline-flex items-center gap-1.5', align(c) === 'right' && 'justify-end')}>
                  {i === 0 && panel ? (
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={`${uid}-panel-${ri}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(isOpen ? null : key);
                      }}
                      className="-ml-1 grid h-5 w-5 shrink-0 place-items-center rounded-[4px] text-ink-muted hover:bg-card-sunk hover:text-ink"
                    >
                      <svg viewBox="0 0 12 12" width={11} height={11} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cx('transition-transform duration-instant', isOpen && 'rotate-90')}>
                        <path d="M4.5 2.5 8 6l-3.5 3.5" />
                      </svg>
                    </button>
                  ) : null}
                  {tone ? (
                    <Chip tone={tone} shape="box" size="sm">
                      {tone === 'good' ? 'W' : 'L'}
                    </Chip>
                  ) : null}
                  {run ? (
                    run.outcomes.length ? (
                      <StreakStrip
                        outcomes={run.outcomes}
                        titles={run.titles}
                        cellWidth={compact ? 8 : 10}
                        height={compact ? 12 : 14}
                        gap={3}
                        label={`${typeof c.label === 'string' ? c.label : c.key}`}
                      />
                    ) : (
                      '—'
                    )
                  ) : ink ? (
                    <span className={cx('font-semibold', ink === 'good' ? 'text-good' : 'text-bad')}>{v ?? '—'}</span>
                  ) : (
                    (v ?? '—')
                  )}
                </span>
              </td>
            );
          })}
        </tr>,
        panel && isOpen ? (
          <tr key={`${key}-panel`}>
            <td id={`${uid}-panel-${ri}`} colSpan={columns.length} className="border-b border-line-soft bg-card-sunk p-3">
              {panel}
            </td>
          </tr>
        ) : null,
      ];
    });

  const total = rows.length;
  const onePage =
    !paging ||
    (pagingMode === 'minimal' || pagingMode === 'numbered' ? total <= pageSize : total <= shown);

  return (
    <div className={cx('relative', className)}>
      <div ref={scroller} className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-collapse">
          <caption className="sr-only">{caption}</caption>
          <thead>
            {columnGroups ? (
              <tr>
                {columnGroups.map((g, i) => (
                  <th
                    key={i}
                    scope="colgroup"
                    colSpan={g.span}
                    className={cx('border-b border-line-soft bg-card-sunk pt-1.5 text-overline uppercase text-ink-muted', i === 0 ? firstPad : cellPad, i === 0 ? 'text-left' : 'text-right')}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
            ) : null}
            <tr className={bandH}>
              {columns.map((c, i) => {
                const sortable = c.sortable !== false;
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.desc ? 'descending' : 'ascending') : undefined}
                    className={cx(
                      'sticky top-0 z-20 whitespace-nowrap border-b border-line bg-card-sunk text-label font-semibold text-ink-muted',
                      bandH,
                      i === 0 ? firstPad : cellPad,
                      align(c) === 'right' ? 'text-right' : align(c) === 'center' ? 'text-center' : 'text-left',
                      i === 0 && 'left-0 z-30',
                      i === 0 && scrolledX && 'shadow-[1px_0_0_0_oklch(var(--line))]',
                    )}
                  >
                    <span className={cx('inline-flex items-center gap-1', align(c) === 'right' && 'flex-row-reverse')}>
                      {c.headerImage}
                      {/* The sort control is a button INSIDE the th, not a
                          focusable th: a th is not an interactive element and
                          screen readers announce it as a column header, not as
                          something you can press. */}
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => toggle(c)}
                          className="inline-flex items-center gap-1 rounded-[4px] hover:text-ink"
                          aria-label={typeof c.label === 'string' ? `Sort by ${c.label}` : c.title ? `Sort by ${c.title}` : 'Sort'}
                        >
                          {c.label}
                          {/* `fg-quaternary` is the bridge's DECORATIVE ink
                              (U spec 2a): `ink-faint` is never allowed for
                              text, and an idle sort glyph is not text. */}
                          <span className={cx(active ? 'text-ink' : 'fg-quaternary')}>{active ? ARROW(sort!.desc) : SORT_ICON}</span>
                        </button>
                      ) : (
                        <Tooltip content={c.title}><span>{c.label}</span></Tooltip>
                      )}
                      {c.info ? (
                        <Tooltip content={<div className="max-w-[240px]">{c.info}</div>}>
                          <button
                            type="button"
                            aria-label={`About ${typeof c.label === 'string' ? c.label : (c.title ?? 'this column')}`}
                            className="inline-grid place-items-center fg-quaternary hover:text-ink-muted"
                          >
                            {HELP_ICON}
                          </button>
                        </Tooltip>
                      ) : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grouped
              ? grouped.flatMap(({ group, rows: block }) => [
                  // "Overall" is the default scope, not a group: labelling it
                  // adds a heading that says nothing.
                  group && group !== 'Overall' ? (
                    <tr key={`g-${group}`}>
                      <td colSpan={columns.length} className={cx('h-[30px] pt-3 text-overline uppercase text-ink-muted', firstPad)}>
                        {group}
                      </td>
                    </tr>
                  ) : null,
                  ...body(block),
                ])
              : body(paged)}
            {totals?.length ? body(totals, true) : null}
          </tbody>
        </table>
      </div>

      {paging && !onePage ? (
        <Pagination
          {...paging}
          mode={pagingMode}
          total={total}
          page={page}
          onPage={setPage}
          pageSize={pageSize}
          onPageSize={paging.pageSizes ? (n) => { setPageSize(n); setPage(1); } : undefined}
          shown={shown}
          onShowMore={() => setShown((n) => n + (paging.pageSize ?? 20))}
          onShowAll={() => setShown(total)}
          className="border-t border-line-soft"
        />
      ) : captionVisible ? (
        <p className="px-3 py-2 text-label text-ink-muted">{captionVisible}</p>
      ) : null}
    </div>
  );
}
