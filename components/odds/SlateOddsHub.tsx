'use client';

import { useState } from 'react';
import { BookLogo, bookLabel } from '../BookLogo';
import { Card, DataTable, EmptyState, Tabs } from '../ui';
import type { SlateGameRef } from './SlateOddsMovers';
import { boardBooks, holdList, type SlateOddsGame } from '@/lib/odds/section/slate';
import { fmtAmerican, fmtLine, fmtPct } from '@/lib/odds/section/format';

type Hub = 'board' | 'openers' | 'hold' | 'lines';

/**
 * The Slate's Market hub (odds build P8, O4; the mockup's `slateMarket`): the
 * odds hub, with no separate odds page. Best prices (games × books, the best
 * per side filled), Openers vs now, Lowest hold at the best prices (a negative
 * hold is a fact, D20) and Line disagreements on the total. Edges arrive in
 * P11 and Where the money is in P10. A price gap, not a model edge.
 */
export function SlateOddsHub({ games, refs }: { games: SlateOddsGame[]; refs: Map<string, SlateGameRef> }) {
  const [hub, setHub] = useState<Hub>('board');
  const priced = games.filter(g => g.books > 0);
  const cols = boardBooks(priced);
  const name = (id: string) => refs.get(id)?.label ?? id;
  const disagree = priced.filter(g => g.totalLines.length > 1);
  const hold = holdList(priced);
  return (
    <Card title="Market" scope="the odds hub · full-game lines" flush className="mt-3"
      caption="Best prices across every book the app reads. A price gap between books, not a model edge.">
      <div className="px-4 pt-1">
        <Tabs<Hub> label="Market hub" value={hub} onChange={setHub} items={[
          { value: 'board', label: 'Best prices' },
          { value: 'openers', label: 'Openers vs now' },
          { value: 'hold', label: 'Lowest hold' },
          { value: 'lines', label: 'Line disagreements', count: disagree.length || undefined },
        ]} />
      </div>
      {priced.length === 0 ? <EmptyState title="No game lines yet" reason="No book has priced a game on this slate." /> : hub === 'board' ? (
        <DataTable<SlateOddsGame>
          caption="Every book's moneyline per game"
          density="compact"
          rows={priced}
          rowKey={g => g.gameId}
          columns={[
            { key: 'g', label: 'Game · moneyline', sortable: false, render: g => <b>{name(g.gameId)}</b> },
            ...cols.map(b => ({
              key: b, sortable: false, numeric: true,
              label: <BookLogo bookId={b} size={14} withLabel />,
              render: (g: SlateOddsGame) => {
                const q = g.board[b];
                if (!q) return <span className="text-ink-faint">·</span>;
                const cell = (v: number | null, side: 'home' | 'away') => (
                  <span className={g.ml[side]?.book === b ? 'rounded-xs bg-good px-1 font-semibold text-ink' : 'font-semibold'}>{fmtAmerican(v)}</span>
                );
                return <span className="flex flex-col items-end leading-tight">{cell(q.away, 'away')}{cell(q.home, 'home')}</span>;
              },
            })),
          ]}
        />
      ) : hub === 'openers' ? (
        <DataTable<SlateOddsGame>
          caption="Openers against now"
          density="compact"
          rows={priced}
          rowKey={g => g.gameId}
          columns={[
            { key: 'g', label: 'Game', sortable: false, render: g => <b>{name(g.gameId)}</b> },
            { key: 'm', label: 'Home moneyline open → now', sortable: false, numeric: true, render: g => g.moved
              ? <span>{fmtAmerican(g.moved.open)} → <b>{fmtAmerican(g.moved.now)}</b> <span className="text-label text-ink-muted">{bookLabel(g.moved.book)}</span></span> : '—' },
            { key: 's', label: 'Spread open → now', sortable: false, numeric: true, render: g => g.spread.open != null
              ? <span>{fmtLine(g.spread.open, true)} → <b>{fmtLine(g.spread.line, true)}</b></span> : '—' },
            { key: 't', label: 'Total open → now', sortable: false, numeric: true, render: g => g.total.open != null
              ? <span>{fmtLine(g.total.open)} → <b>{fmtLine(g.total.line)}</b></span> : '—' },
          ]}
        />
      ) : hub === 'hold' ? (
        <DataTable<SlateOddsGame>
          caption="Lowest hold at the best moneyline prices"
          density="compact"
          rows={hold}
          rowKey={g => g.gameId}
          columns={[
            { key: 'g', label: 'Game · moneyline', sortable: false, render: g => <b>{name(g.gameId)}</b> },
            { key: 'a', label: 'Best away', sortable: false, render: g => <span className="inline-flex items-center gap-1.5">{fmtAmerican(g.ml.away!.price)} <BookLogo bookId={g.ml.away!.book} size={14} /></span> },
            { key: 'h', label: 'Best home', sortable: false, render: g => <span className="inline-flex items-center gap-1.5">{fmtAmerican(g.ml.home!.price)} <BookLogo bookId={g.ml.home!.book} size={14} /></span> },
            { key: 'x', label: 'Hold at best', sortable: false, numeric: true, render: g => <b>{fmtPct(g.ml.hold!)}</b> },
          ]}
        />
      ) : disagree.length ? (
        <DataTable<SlateOddsGame>
          caption="Totals the US and sharp books disagree on"
          density="compact"
          rows={disagree}
          rowKey={g => g.gameId}
          columns={[
            { key: 'g', label: 'Game · total', sortable: false, render: g => <b>{name(g.gameId)}</b> },
            { key: 'd', label: 'Books disagree', sortable: false, wrap: true, render: g => (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {g.totalLines.map(l => (
                  <span key={l.line} className="inline-flex items-center gap-1"><b>{fmtLine(l.line)}</b>:{l.books.map(b => <BookLogo key={b} bookId={b} size={14} />)}</span>
                ))}
              </span>
            ) },
          ]}
        />
      ) : <EmptyState title="The books agree" reason="Every US and sharp book hangs the same main total on every game." />}
    </Card>
  );
}
