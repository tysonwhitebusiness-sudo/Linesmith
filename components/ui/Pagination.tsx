'use client';

import { Button } from './Button';
import { SelectBox } from './Controls';
import { cx } from './cx';

/**
 * U2 — paging (U spec §3d). Four modes, because a table's pager should match
 * what the table is FOR:
 *
 *   minimal   "1–10 of 148 games" left; Rows [10] and Prev/Next right.
 *             The default in a card: a game log, plays, a roster.
 *   numbered  1 2 3 … 14 15, 40px page buttons. For a table that IS the view —
 *             inside a SlideoutMenu or a drill-down.
 *   more      "Show 20 more". Short lists: injuries, line movement.
 *   all       "Show all 162 games", then the card scrolls. Today's behaviour,
 *             kept as an option rather than made the rule.
 *
 * A table under one page shows its caption instead of a footer, so this
 * renders nothing when there is nothing to page.
 */

export type PagingMode = 'minimal' | 'numbered' | 'more' | 'all';

export interface PagingOptions {
  mode?: PagingMode;
  /** Rows per page. `minimal` and `numbered` default to 10, `more` to 20. */
  pageSize?: number;
  /** Offered in the `Rows` select. Omit to hide the control. */
  pageSizes?: number[];
  /** Plural noun for the counts: "games", "plays", "rows" (default). */
  noun?: string;
}

const PAGE_WINDOW = 2;

/** 1 2 3 … 14 15 — always the ends, always a window around the current page. */
function pageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  const from = Math.max(2, current - PAGE_WINDOW);
  const to = Math.min(total - 1, current + PAGE_WINDOW);
  if (from > 2) out.push('…');
  for (let p = from; p <= to; p++) out.push(p);
  if (to < total - 1) out.push('…');
  out.push(total);
  return out;
}

export interface PaginationProps extends PagingOptions {
  total: number;
  page: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
  /** `more` and `all` grow the visible count rather than turning pages. */
  shown?: number;
  onShowMore?: () => void;
  onShowAll?: () => void;
  className?: string;
}

export function Pagination({
  mode = 'minimal',
  total,
  page,
  onPage,
  pageSize = 10,
  pageSizes,
  onPageSize,
  noun = 'rows',
  shown,
  onShowMore,
  onShowAll,
  className,
}: PaginationProps) {
  if (mode === 'more') {
    const left = total - (shown ?? 0);
    if (left <= 0) return null;
    return (
      <div className={cx('flex justify-center px-3 py-2', className)}>
        <Button variant="secondary" size="sm" onPress={onShowMore}>
          Show {Math.min(pageSize, left)} more
        </Button>
      </div>
    );
  }

  if (mode === 'all') {
    if ((shown ?? 0) >= total) return null;
    return (
      <div className={cx('flex justify-center px-3 py-2', className)}>
        <Button variant="link" size="sm" onPress={onShowAll}>
          Show all {total} {noun}
        </Button>
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  if (mode === 'numbered') {
    return (
      <nav aria-label="Pages" className={cx('flex items-center justify-center gap-1 px-3 py-2', className)}>
        <Button variant="tertiary" size="sm" isDisabled={page === 1} onPress={() => onPage(page - 1)} aria-label="Previous page">
          ‹
        </Button>
        {pageNumbers(page, pages).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} aria-hidden className="w-6 text-center text-label text-ink-muted">
              …
            </span>
          ) : (
            <Button
              key={p}
              size="sm"
              variant={p === page ? 'primary' : 'tertiary'}
              onPress={() => onPage(p)}
              aria-label={`Page ${p}`}
              aria-current={p === page ? 'page' : undefined}
              className="h-10 w-10 px-0"
            >
              {p}
            </Button>
          ),
        )}
        <Button variant="tertiary" size="sm" isDisabled={page === pages} onPress={() => onPage(page + 1)} aria-label="Next page">
          ›
        </Button>
      </nav>
    );
  }

  return (
    <div className={cx('flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-2', className)}>
      <p className="text-label text-ink-muted tabular-nums">
        {first}–{last} of {total} {noun}
      </p>
      <div className="flex items-center gap-2">
        {pageSizes && onPageSize ? (
          <SelectBox
            label="Rows"
            value={String(pageSize)}
            onChange={(v) => onPageSize(Number(v))}
            options={pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
          />
        ) : null}
        <Button variant="secondary" size="sm" isDisabled={page === 1} onPress={() => onPage(page - 1)}>
          ‹ Prev
        </Button>
        <Button variant="secondary" size="sm" isDisabled={page === pages} onPress={() => onPage(page + 1)}>
          Next ›
        </Button>
      </div>
    </div>
  );
}
