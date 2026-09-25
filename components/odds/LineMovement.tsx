'use client';

import { useMemo, useState } from 'react';
import { StepLines, type StepSeries } from '../charts/StepLines';
import { CATEGORICAL, EMPHASIS } from '../charts/tokens';
import { BookLogo } from '../BookLogo';
import { Button, Card, Chip, Collapse, DataTable, LiveDot, SegmentedToggle } from '../ui';
import { BOOK_GROUP_ORDER, bookGroup, bookLabel } from '@/lib/odds/books/registry';
import { consensusLine, implied } from '@/lib/odds/section/board';
import { fmtAmerican, fmtClock, fmtLine, fmtPct } from '@/lib/odds/section/format';
import type { MarketSpec, MoveRow, OddsMarket } from '@/lib/odds/section/types';

type Win = '2h' | '6h' | '12h' | '48h' | 'open';
const WIN_H: Record<Exclude<Win, 'open'>, number> = { '2h': 2, '6h': 6, '12h': 12, '48h': 48 };
const CONSENSUS = '__consensus';

/**
 * Line movement (O-D of the approved mockup, `moveCard`): per-book step series
 * in a window, Line or Price (side A's implied probability), presets and a book
 * picker (chips show each book's moves in the window). Unselected books are
 * grey context; the consensus (modal main line) is an optional series; a
 * pulled price leaves a gap with a tick at the pull. First movers come from
 * the payload's steam rows.
 */
export function LineMovement({ market, spec, sideLabels, userBook, now, closed }: {
  market: OddsMarket;
  spec: MarketSpec;
  sideLabels: [string, string];
  userBook?: string | null;
  now: number;
  closed?: boolean;
}) {
  const books = useMemo(() => Object.keys(market.hist).sort((a, b) =>
    BOOK_GROUP_ORDER.indexOf(bookGroup(a)) - BOOK_GROUP_ORDER.indexOf(bookGroup(b)) || bookLabel(a).localeCompare(bookLabel(b))), [market]);
  const [win, setWin] = useState<Win>('2h');
  const t0 = win === 'open'
    ? Math.min(now - 3600e3, ...books.map(k => Date.parse(market.hist[k][0][0])))
    : now - WIN_H[win] * 3600e3;
  const cnt = (k: string) => market.hist[k].filter((p, i) => i && Date.parse(p[0]) >= t0).length;
  const defaultSel = () => {
    const top = books.filter(k => k !== 'pinnacle' && bookGroup(k) !== 'pickem').sort((a, b) => cnt(b) - cnt(a)).slice(0, 3);
    return [...(books.includes('pinnacle') ? ['pinnacle'] : []), ...(userBook && books.includes(userBook) ? [userBook] : []),
      ...top.filter(k => k !== userBook)].slice(0, 5);
  };
  const [sel, setSel] = useState<string[] | null>(null);
  const selected = (sel ?? defaultSel()).filter(k => books.includes(k) || k === CONSENSUS);
  const lineMoves = selected.some(k => (market.hist[k] ?? []).some((p, i, h) => i && p[1] !== h[i - 1][1] && Date.parse(p[0]) >= t0));
  const [metricPick, setMetric] = useState<'line' | 'price' | null>(null);
  const metric = spec.noLine ? 'price' : metricPick ?? (lineMoves ? 'line' : 'price');
  const [allChips, setAllChips] = useState(false);
  const [showMoves, setShowMoves] = useState(false);
  const color: Record<string, string> = {};
  books.forEach((k, i) => { color[k] = k === 'pinnacle' ? EMPHASIS : CATEGORICAL[i % CATEGORICAL.length]; });
  const value = (p: [string, number | null, number | null, number | null]) =>
    metric === 'line' ? p[1] : p[2] != null ? implied(p[2]) : null;
  const toSeries = (k: string, context: boolean): StepSeries => ({
    id: k, label: bookLabel(k), color: color[k], emphasis: k === 'pinnacle', context,
    points: market.hist[k].map(p => [Date.parse(p[0]), value(p)] as [number, number | null]).filter((p): p is [number, number] => p[1] != null),
    gaps: (market.pulls ?? []).filter(p => p.book === k).map(p => [Date.parse(p.pulledAt), p.returnedAt ? Date.parse(p.returnedAt) : null]),
  });
  const series: StepSeries[] = [
    ...books.filter(k => !selected.includes(k) && bookGroup(k) !== 'pickem').map(k => toSeries(k, true)),
    ...selected.filter(k => k !== CONSENSUS).map(k => toSeries(k, false)),
  ];
  if (selected.includes(CONSENSUS) && metric === 'line') {
    const c = consensusLine(market, spec).modal;
    if (c != null) series.push({ id: CONSENSUS, label: 'Consensus', color: EMPHASIS, points: [[t0, c], [now, c]] });
  }
  const steams = (market.steam ?? []).filter(s => Date.parse(s.t) >= t0);
  let moves: MoveRow[] = (market.moves ?? []).filter(m => Date.parse(m[0]) >= t0).slice(-40).reverse();
  if (spec.noLine || !moves.length) {
    moves = [];
    for (const k of selected.filter(b => b !== CONSENSUS)) {
      const h = market.hist[k] ?? [];
      for (let i = 1; i < h.length; i++) {
        if (Date.parse(h[i][0]) < t0) continue;
        if (!spec.noLine && h[i][1] !== h[i - 1][1]) moves.push([h[i][0], k, h[i - 1][1], h[i][1]]);
        else if (spec.noLine && h[i][2] != null && h[i - 1][2] != null && Math.abs(implied(h[i][2]!) - implied(h[i - 1][2]!)) >= 0.01) moves.push([h[i][0], k, h[i - 1][2], h[i][2]]);
      }
    }
    moves = moves.sort((a, b) => b[0].localeCompare(a[0])).slice(0, 40);
  }
  const starters = new Set(steams.map(s => s.t + s.books[0]));
  const shownBooks = allChips ? books : books.filter(k => !['intl', 'offshore'].includes(bookGroup(k)) || selected.includes(k));
  const toggle = (k: string) => setSel(s => { const cur = s ?? defaultSel(); return cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]; });
  const checks = market.cur.map(q => q.checkedAt).filter((v): v is string => !!v).sort();
  const preset = (p: 'sharp' | 'mine' | 'most' | 'all' | 'none') => setSel(
    p === 'sharp' ? books.filter(k => ['sharp', 'exchange'].includes(bookGroup(k)))
      : p === 'mine' ? books.filter(k => k === userBook || k === 'pinnacle')
        : p === 'most' ? [...books].sort((a, b) => cnt(b) - cnt(a)).slice(0, 5)
          : p === 'all' ? books.filter(k => bookGroup(k) !== 'pickem') : []);
  return (
    <Card
      title={<span className="inline-flex flex-wrap items-center gap-2">Line movement {closed ? <span className="text-label font-normal text-ink-muted">closed</span> : <LiveDot checkedAt={checks[checks.length - 1]} cadenceS={70} now={now} />}</span>}
      scope={`${sideLabels[0]} · ${metric === 'line' ? 'the line' : `implied probability, ${sideLabels[0].split(' ')[0].toLowerCase()}`}`}
      state={books.length ? { kind: 'ready' } : { kind: 'empty', title: 'No movement recorded', reason: 'No book has changed this market in the last ten days.' }}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SegmentedToggle label="Window" size="sm" value={win} onChange={setWin}
          options={[{ value: '2h', label: '2h' }, { value: '6h', label: '6h' }, { value: '12h', label: '12h' }, { value: '48h', label: '48h' }, { value: 'open', label: 'Since open' }]} />
        {spec.noLine ? null : (
          <SegmentedToggle label="Metric" size="sm" value={metric} onChange={v => setMetric(v)}
            options={[{ value: 'line', label: 'Line' }, { value: 'price', label: 'Price' }]} />
        )}
        <span className="inline-flex flex-wrap gap-1">
          <Button size="sm" variant="tertiary" onPress={() => preset('sharp')}>Sharp</Button>
          <Button size="sm" variant="tertiary" onPress={() => preset('mine')}>My book</Button>
          <Button size="sm" variant="tertiary" onPress={() => preset('most')}>Most moves</Button>
          <Button size="sm" variant="tertiary" onPress={() => preset('all')}>All</Button>
          <Button size="sm" variant="tertiary" onPress={() => preset('none')}>Clear</Button>
        </span>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {spec.noLine ? null : (
          <Chip onClick={() => toggle(CONSENSUS)} selected={selected.includes(CONSENSUS)} dot={selected.includes(CONSENSUS) ? EMPHASIS : undefined}>Consensus</Chip>
        )}
        {shownBooks.map(k => (
          <Chip key={k} onClick={() => toggle(k)} selected={selected.includes(k)} dot={selected.includes(k) ? color[k] : undefined}>
            {bookLabel(k)} <span className="font-normal text-ink-muted">{cnt(k)}</span>
          </Chip>
        ))}
        {books.length > shownBooks.length || allChips ? (
          <Chip onClick={() => setAllChips(v => !v)}>{allChips ? 'fewer books' : `+ ${books.length - shownBooks.length} offshore & international`}</Chip>
        ) : null}
      </div>
      <StepLines series={series} t0={t0} t1={now} liveEdge={closed ? undefined : { now }} label={`${sideLabels[0]} movement by book`}
        bounds={metric === 'price' ? [0, 1] : undefined}
        format={v => (metric === 'line' ? fmtLine(v, spec.signed) : fmtPct(v, 0))}
        markers={steams.slice(-3).map(s => ({ t: Date.parse(s.t), label: `${bookLabel(s.books[0])} first` }))} />
      {steams.length ? (
        <div className="mt-2 space-y-1">
          {steams.slice(-3).reverse().map(s => (
            <div key={s.t + s.books[0]} className="text-body-sm">
              <b>First mover:</b> <b>{bookLabel(s.books[0])}</b> moved {fmtLine(s.from, spec.signed)} → {fmtLine(s.to[0], spec.signed)} at {fmtClock(s.t, now)};{' '}
              {s.books.length - 1} {s.books.length > 2 ? 'books' : 'book'} followed within {Math.round((Date.parse(s.times[s.times.length - 1]) - Date.parse(s.times[0])) / 60000)} min
              <span className="text-ink-muted"> ({s.books.slice(1).map(bookLabel).join(', ')})</span>
            </div>
          ))}
        </div>
      ) : null}
      <Button className="mt-2" size="sm" variant="tertiary" aria-expanded={showMoves} aria-controls="odds-every-move"
        onPress={() => setShowMoves(v => !v)}>
        {showMoves ? '▾' : '▸'} Every move in this window ({moves.length} {spec.noLine ? 'price changes of 1 pt+ on the selected books' : 'line changes'})
      </Button>
      <Collapse open={showMoves} id="odds-every-move">
        <DataTable<MoveRow>
          caption="Every move in the window"
          density="compact"
          rows={moves}
          rowKey={(m, i) => `${m[0]}|${m[1]}|${i}`}
          columns={[
            { key: 't', label: 'Time', sortable: false, render: m => <span className="text-label text-ink-muted">{fmtClock(m[0], now)}</span> },
            { key: 'b', label: 'Book', sortable: false, render: m => <BookLogo bookId={m[1]} size={14} withLabel /> },
            { key: 'mv', label: 'From → to', sortable: false, render: m => spec.noLine
              ? <span>{fmtAmerican(m[2])} → <b>{fmtAmerican(m[3])}</b></span>
              : <span>{fmtLine(m[2], spec.signed)} → <b>{fmtLine(m[3], spec.signed)}</b></span> },
            { key: 'f', label: '', sortable: false, render: m => (starters.has(m[0] + m[1]) ? <Chip tone="strong">First mover</Chip> : null) },
          ]}
        />
      </Collapse>
    </Card>
  );
}
