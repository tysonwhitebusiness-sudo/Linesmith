'use client';

import { BookLogo } from '../BookLogo';
import { Card, DataTable, Tooltip } from '../ui';
import { bookLabel } from '@/lib/odds/books/registry';
import { COVERAGE_GROUPS, coverage, type CoverageRow } from '@/lib/odds/section/coverage';
import type { OddsMarket } from '@/lib/odds/section/types';

const GROUP_LABEL: Record<string, string> = { sharp: 'Sharp', exchange: 'Exchanges', us: 'US books', offshore: 'Offshore', pickem: "Pick'em" };

/**
 * Coverage (O-K of the approved mockup, `coverageCard`): every market any
 * source prices for this subject, by book group. A cell's count is how many
 * books of that group price the market; hover names them.
 */
export function Coverage({ markets, marketLabel }: { markets: OddsMarket[]; marketLabel: (key: string) => string }) {
  const rows = coverage(markets.map(m => ({ ...m, label: marketLabel(m.key) }))).sort((a, b) => b.books - a.books);
  const heat = (n: number) => (n === 0 ? 'bg-line-hair text-ink-faint' : n < 3 ? 'bg-good/15 text-good-ink' : n < 7 ? 'bg-good/45 text-good-ink' : 'bg-good text-good-on');
  return (
    <Card title="Coverage" scope="every market any source prices" dense flush
      state={rows.length ? { kind: 'ready' } : { kind: 'empty', title: 'No markets priced', reason: 'No source prices a market for this subject yet.' }}>
      <DataTable<CoverageRow>
        caption="Markets by book group"
        density="compact"
        rows={rows}
        rowKey={r => r.key}
        columns={[
          { key: 'label', label: 'Market', sortable: false, render: r => <b>{r.label}</b> },
          { key: 'books', label: 'Books', numeric: true, sortValue: r => r.books, render: r => r.books },
          { key: 'lines', label: 'Lines', numeric: true, sortValue: r => r.lines, render: r => r.lines },
          ...COVERAGE_GROUPS.map(g => ({
            key: g, label: GROUP_LABEL[g], align: 'center' as const, sortable: false,
            render: (r: CoverageRow) => {
              const n = r.byGroup[g].length;
              const sq = <span className={`inline-flex min-w-6 justify-center rounded-xs px-1 text-label tabular-nums ${heat(n)}`}>{n}</span>;
              return n ? (
                <Tooltip content={<span className="flex flex-wrap gap-2">{r.byGroup[g].map(k => <BookLogo key={k} bookId={k} size={12} withLabel />)}</span>}>{sq}</Tooltip>
              ) : sq;
            },
          })),
        ]}
      />
    </Card>
  );
}

export const coverageBookName = bookLabel;
