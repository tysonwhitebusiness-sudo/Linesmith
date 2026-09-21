'use client';

import { useEffect, useState } from 'react';
import { Card, Chip, DataTable, type Column } from '@/components/ui';
import type { ModelPickRow, ModelPicksData } from '@/lib/slate/modelPicks';

/**
 * The Model section (S5) — today's locked game picks, for a sport whose slate
 * adapter declares `modelPicks`. It replaced `TodaysPicksModal`.
 *
 * WHAT IS NOT HERE, ON PURPOSE: a probability, a confidence grade, a stake, a
 * record. The picks have not cleared their own gate (queue Q0), and M1's rule
 * lets an ungated model show its pick and nothing that reads as a measured
 * chance. The row shape (`ModelPickRow`) has no field for any of them, so
 * nothing here could render one by accident.
 */

const price = (p: number | null) => (p == null ? '' : p > 0 ? ` ${'+' + p}` : ` ${p}`);

function time(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
}

const COLUMNS: Column<ModelPickRow>[] = [
  {
    key: 'game',
    label: 'Game',
    sortable: false,
    render: (r) => (
      <span className="flex flex-col leading-tight">
        <span className="text-ink">{r.matchup}</span>
        <span className="text-label text-ink-muted">{time(r.startsAt)}</span>
      </span>
    ),
  },
  {
    key: 'ml',
    label: 'Moneyline',
    info: 'The team the pick is on, and the price when it was taken.',
    sortable: false,
    render: (r) => (r.moneyline ? `${r.moneyline.team}${price(r.moneyline.price)}` : '—'),
  },
  {
    key: 'total',
    label: 'Total',
    info: 'Over or under, the line, and the price when it was taken.',
    sortable: false,
    render: (r) => (r.total ? `${r.total.side === 'over' ? 'Over' : 'Under'} ${r.total.line}${price(r.total.price)}` : '—'),
  },
  {
    key: 'state',
    label: 'State',
    sortable: false,
    render: (r) => (
      <Chip tone={r.locked ? 'strong' : 'neutral'} size="sm">
        {r.locked ? 'Locked' : 'Can still move'}
      </Chip>
    ),
  },
];

export function SlateModel({ data, note, loading }: { data: ModelPicksData | null; note: string; loading: boolean }) {
  const rows = data?.rows ?? [];
  if (!loading && rows.length === 0) return null;
  return (
    <section id="slate-model" className="mb-6 scroll-mt-[150px]">
      <h2 className="mb-2 text-title text-ink">Model</h2>
      <Card
        title="Today's picks"
        count={rows.length || undefined}
        scope="Lock before first pitch"
        flush
        state={loading && rows.length === 0 ? { kind: 'loading', lines: 4 } : { kind: 'ready' }}
        caption={note}
      >
        {rows.length > 0 ? <DataTable caption="Today's model picks" columns={COLUMNS} rows={rows} rowKey={(r) => r.gameId} /> : null}
      </Card>
    </section>
  );
}

/** Fetches only when the slate declares a model section (`enabled`). */
export function useSlateModel(sport: string, enabled: boolean, date: string | null, refreshKey?: string | null) {
  const [data, setData] = useState<ModelPicksData | null>(null);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ sport });
        if (date) params.set('date', date);
        const res = await fetch(`/api/slate/model?${params}`, { cache: 'no-store' });
        if (!cancelled) setData(res.ok ? ((await res.json()) as ModelPicksData) : null);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, enabled, date, refreshKey]);
  return { data, loading };
}
