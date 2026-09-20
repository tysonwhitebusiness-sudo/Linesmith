'use client';

import { useState } from 'react';
import { cx, DataTable, SegmentedToggle, type Column } from './ui';
import { SplitDumbbell } from './charts';

/**
 * Two sides, one row per stat, in whichever view reads best — R10.6.
 *
 * WHY A SWITCH. The operator found the dumbbells hard to read: six stats on six
 * different scales stacked in one frame give the eye nothing to anchor on. No
 * single view is right for every reader, so the card offers three over the SAME
 * rows, and opens on the plainest:
 *
 *   Table  both numbers and the gap, the leading side in bold where the stat
 *          declares which way is better;
 *   Bars   two bars per stat on that stat's own scale, so the longer one is
 *          obvious without reading a number;
 *   Lines  the dumbbell, for a reader who wants the gap as a shape.
 *
 * WHICH SIDE LEADS IS ONLY CLAIMED WHERE IT IS KNOWN. A team stat carries its
 * direction; a player's split column does not (a hitter's strikeouts are
 * better LOW), so for those the table shows the signed gap and bolds nothing
 * rather than crowning the wrong player.
 *
 * The chosen view is component state: every page load opens on the table.
 */

export interface CompareViewRow {
  key: string;
  label: string;
  a: number | null;
  b: number | null;
  format: (v: number) => string;
  /** `true`/`false` when the stat knows which way is better; unset when it does not. */
  lowerIsBetter?: boolean;
  aSample?: number | null;
  bSample?: number | null;
}

type View = 'table' | 'bars' | 'lines';

export function CompareView({ rows, aLabel, bLabel, label }: { rows: CompareViewRow[]; aLabel: string; bLabel: string; label: string }) {
  const [view, setView] = useState<View>('table');
  return (
    <div className="space-y-3">
      <SegmentedToggle
        label={`${label} view`}
        size="sm"
        value={view}
        onChange={(v) => setView(v as View)}
        options={[
          { value: 'table', label: 'Table' },
          { value: 'bars', label: 'Bars' },
          { value: 'lines', label: 'Lines' },
        ]}
      />
      {view === 'table' ? <CompareTable rows={rows} aLabel={aLabel} bLabel={bLabel} label={label} /> : null}
      {view === 'bars' ? <CompareBars rows={rows} aLabel={aLabel} bLabel={bLabel} /> : null}
      {view === 'lines' ? (
        <SplitDumbbell
          rows={rows.map((r) => ({ key: r.key, label: r.label, a: r.a, b: r.b, format: r.format, lowerIsBetter: r.lowerIsBetter, aSample: r.aSample, bSample: r.bSample }))}
          aLabel={aLabel}
          bLabel={bLabel}
          label={label}
        />
      ) : null}
    </div>
  );
}

/** Which side leads, or `null` where the stat does not say which way is better. */
function leader(r: CompareViewRow): 'a' | 'b' | null {
  if (r.lowerIsBetter === undefined || r.a == null || r.b == null || r.a === r.b) return null;
  const aBetter = r.lowerIsBetter ? r.a < r.b : r.a > r.b;
  return aBetter ? 'a' : 'b';
}

function CompareTable({ rows, aLabel, bLabel, label }: { rows: CompareViewRow[]; aLabel: string; bLabel: string; label: string }) {
  const columns: Column<CompareViewRow>[] = [
    { key: 'stat', label: 'Stat', sortable: false, render: (r) => r.label },
    {
      key: 'a',
      label: aLabel,
      numeric: true,
      sortable: false,
      strong: (r) => leader(r) === 'a',
      render: (r) => (r.a == null ? '—' : r.format(r.a)),
    },
    {
      key: 'b',
      label: bLabel,
      numeric: true,
      sortable: false,
      strong: (r) => leader(r) === 'b',
      render: (r) => (r.b == null ? '—' : r.format(r.b)),
    },
    {
      key: 'gap',
      label: 'Gap',
      numeric: true,
      sortable: false,
      render: (r) => {
        if (r.a == null || r.b == null) return '—';
        const d = r.a - r.b;
        const lead = leader(r);
        const text = `${d > 0 ? '+' : d < 0 ? '−' : ''}${r.format(Math.abs(d))}`;
        return <span className={cx(lead === 'a' ? 'text-good' : lead === 'b' ? 'text-bad' : 'text-ink-secondary')}>{text}</span>;
      },
    },
  ];
  return <DataTable caption={label} columns={columns} rows={rows} rowKey={(r) => r.key} />;
}

function CompareBars({ rows, aLabel, bLabel }: { rows: CompareViewRow[]; aLabel: string; bLabel: string }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-label text-ink-secondary">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-ink" aria-hidden />
          {aLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-ink/35" aria-hidden />
          {bLabel}
        </span>
      </div>
      {rows.map((r) => {
        // Each stat on its OWN scale: a .300 average and 30 home runs cannot share
        // an axis, and a shared one would flatten every rate to nothing.
        const top = Math.max(Math.abs(r.a ?? 0), Math.abs(r.b ?? 0));
        const w = (v: number | null) => (v == null || top <= 0 ? 0 : Math.max(2, (100 * Math.abs(v)) / top));
        const lead = leader(r);
        return (
          <div key={r.key} className="grid grid-cols-[minmax(90px,140px)_1fr] items-center gap-3">
            <span className="truncate text-body-sm text-ink-secondary">{r.label}</span>
            <div className="space-y-1">
              {(['a', 'b'] as const).map((side) => {
                const v = side === 'a' ? r.a : r.b;
                return (
                  <div key={side} className="flex items-center gap-2">
                    <div className="h-3 flex-1 rounded-[2px] bg-card-sunk">
                      <div className={cx('h-3 rounded-[2px]', side === 'a' ? 'bg-ink' : 'bg-ink/35')} style={{ width: `${w(v)}%` }} />
                    </div>
                    <span className={cx('w-16 shrink-0 text-right text-body-sm tabular-nums', lead === side ? 'font-semibold text-ink' : 'text-ink-secondary')}>
                      {v == null ? '—' : r.format(v)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
