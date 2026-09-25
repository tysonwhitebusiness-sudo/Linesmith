'use client';

import { BookLogo } from '../BookLogo';
import { DataTable, type Column } from '../ui';
import { ladder, type LadderRow } from '@/lib/odds/section/ladder';
import { fmtAmerican, fmtLine, fmtPct } from '@/lib/odds/section/format';
import type { MarketSpec, OddsMarket } from '@/lib/odds/section/types';

/**
 * All lines (O-G of the approved mockup, `ladderCard`): lines × books, side A
 * on top and side B below in each cell, the best at each line filled, and
 * Pinnacle's fair % where it prices the line. The selected line is marked.
 */
export function Ladder({ market, spec, span, line, sideLabels }: {
  market: OddsMarket;
  spec: MarketSpec;
  span: number;
  line: number | null;
  sideLabels: [string, string];
}) {
  const { books, rows } = ladder(market, spec, span);
  const columns: Column<LadderRow>[] = [
    { key: 'line', label: 'Line', sortable: false, render: r => <b>{fmtLine(r.line, spec.signed)}</b> },
    { key: 'fair', label: 'Pinnacle fair', numeric: true, sortable: false, render: r => (r.pinnacleFairA != null ? fmtPct(r.pinnacleFairA) : <span className="text-ink-faint">—</span>) },
    ...books.map(k => ({
      key: k, align: 'center' as const, sortable: false,
      label: <span className="inline-flex flex-col items-center"><BookLogo bookId={k} size={14} /></span>,
      info: <BookLogo bookId={k} size={12} withLabel />,
      render: (r: LadderRow) => {
        const c = r.cells[k];
        if (!c?.a && !c?.b) return <span className="text-ink-faint">·</span>;
        return (
          <span className="inline-flex flex-col leading-tight tabular-nums">
            <span className={c.a && r.bestA === c.a ? 'rounded-xs bg-good px-1 font-semibold text-good-on' : 'font-semibold'}>{c.a ? fmtAmerican(c.a.price) : '·'}</span>
            <span className={c.b && r.bestB === c.b ? 'rounded-xs bg-good px-1 text-good-on' : 'text-ink-muted'}>{c.b ? fmtAmerican(c.b.price) : '·'}</span>
          </span>
        );
      },
    })),
  ];
  return (
    <div>
      <DataTable<LadderRow>
        caption="Every line by book"
        density="compact"
        rows={rows}
        rowKey={r => String(r.line)}
        columns={columns}
        highlight={r => r.line === line}
      />
      <div className="px-3 py-2 text-label text-ink-muted">
        Each cell: {sideLabels[0].split(' ')[0].toLowerCase()} on top, {sideLabels[1].split(' ')[0].toLowerCase()} below · filled = best at that line · {books.length} books · {rows.length} lines
      </div>
    </div>
  );
}
