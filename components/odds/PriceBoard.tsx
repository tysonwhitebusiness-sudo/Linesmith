'use client';

import { useState } from 'react';
import { BookLogo } from '../BookLogo';
import { Button, DataTable, Tooltip, type Column } from '../ui';
import { LivePrice } from './LiveHeader';
import { FLASH_CAP, useLive } from './live';
import { bookLabel } from '@/lib/odds/books/registry';
import { bestPrice, noPrice, pulledBooks } from '@/lib/odds/section/board';
import { priceKey, rowKeyOf } from '@/lib/odds/section/liveDiff';
import { fmtAgo, fmtAmerican, fmtClock, fmtLine, fmtMoney, secondsSince } from '@/lib/odds/section/format';
import type { BoardRow, MarketSpec, OddsMarket, OddsQuote, SourceLatencyRow } from '@/lib/odds/section/types';

const GROUP_LABEL: Record<string, string> = { sharp: 'Sharp', exchange: 'Exchanges', us: 'US books', nevada: 'Nevada',
  offshore: 'Offshore', intl: 'International', pickem: "Pick'em" };
/** D18: these groups start collapsed behind "+ N books". */
const COLLAPSED = ['offshore', 'intl'];

type Row = BoardRow & { pulled?: { at: string; line: number | null; a: number | null; b: number | null } };

/**
 * Every book (O-A of the approved mockup, `boardCard`): one row per book at
 * the selected line, else its own line dimmed (never dropped); groups in D18
 * order; your book pinned; best = the `good` fill; a price far from every
 * other book reads "⚠ check" and never counts as best; a book that pulled the
 * market stays, struck through. "Checked" is when a source last confirmed the
 * price; "since" is when it last changed.
 */
export function PriceBoard({ market, spec, line, rows, sideLabels, userBook, latency, now, picks }: {
  market: OddsMarket;
  spec: MarketSpec;
  line: number | null;
  rows: BoardRow[];
  sideLabels: [string, string];
  userBook?: string | null;
  latency: SourceLatencyRow[];
  now: number;
  /** Pick'em context by book ("1,598 of 1,757 entries picked over"). */
  picks?: Record<string, string>;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const live = useLive();
  const rk = (book: string) => rowKeyOf(market.key, book, live.game);
  const changedNow = (q: OddsQuote | null) => !!q && live.diffAt != null && live.change(priceKey(market.key, q, live.game))?.seenAt === live.diffAt;
  // The flash cap, counted on the values THIS board shows (not every alt line
  // in the market — the live check found that tripping on every refresh):
  // past 12 in one refresh, the rows take a tint and the cells skip their roll.
  const shownChanges = rows.reduce((n, r) => n + (changedNow(r.qa) ? 1 : 0) + (changedNow(r.qb) ? 1 : 0), 0);
  const capped = shownChanges > FLASH_CAP;
  const tintRows = capped && live.diffAt != null && Date.now() - live.diffAt < 4000;
  const b0 = bestPrice(rows, 0), b1 = bestPrice(rows, 1);
  const follow = new Map(latency.filter(l => l.measure === 'follow_lag' && l.n >= 30 && l.medianS != null)
    .map(l => [l.book, Math.round(l.medianS! / 60)]));
  const hidden: Record<string, number> = {};
  const shown: Row[] = rows.filter(r => {
    if (COLLAPSED.includes(r.group) && !open.includes(r.group) && r.book !== userBook) {
      hidden[r.group] = (hidden[r.group] ?? 0) + 1;
      return false;
    }
    return true;
  });
  for (const k of pulledBooks(market, rows)) {
    const h = market.hist[k];
    const last = h[h.length - 1];
    shown.push({ book: k, group: 'pulled', qa: null, qb: null, at: false, line: last[1], checkedAt: null, since: last[0],
      source: '', extra: null, opener: null, mainLine: null, pulled: { at: last[0], line: last[1], a: last[2], b: last[3] } });
  }
  const cell = (r: Row, q: OddsQuote | null, i: 0 | 1) => {
    if (r.pulled) return <span className="tabular-nums">{fmtAmerican(i ? r.pulled.b : r.pulled.a)}</span>;
    if (!q) return <span className="text-ink-faint">—</span>;
    if (noPrice(r.book, q)) return <span className="text-ink-faint">line</span>;
    if (i ? r.outlierB : r.outlierA) {
      return (
        <Tooltip content="Far from every other book: probably a different market relayed under this name. Kept, never used as best.">
          <span className="text-warn-ink">⚠ check <span className="text-ink-muted tabular-nums">{fmtAmerican(q.price)}</span></span>
        </Tooltip>
      );
    }
    const best = r.at && ((i === 0 && b0?.book === r.book) || (i === 1 && b1?.book === r.book));
    return (
      <span className="inline-flex items-baseline gap-1">
        <LivePrice marketKey={market.key} quote={q} best={best} quiet={capped} />
        {!r.at && !spec.noLine ? <span className="text-label text-ink-muted">{fmtLine(i === 0 || !spec.signed ? r.line : r.line == null ? null : -r.line, spec.signed)}</span> : null}
      </span>
    );
  };
  const columns: Column<Row>[] = [
    {
      key: 'book', label: 'Book', sortable: false,
      render: r => {
        const x = r.extra ?? {};
        const bid = typeof x.yes_bid === 'number' ? x.yes_bid : typeof x.bid === 'number' ? x.bid : null;
        const ask = typeof x.yes_ask === 'number' ? x.yes_ask : typeof x.ask === 'number' ? x.ask : null;
        const lag = follow.get(r.book);
        return (
          <div className="py-1">
            <span className="inline-flex items-center gap-1">
              <BookLogo bookId={r.book} size={14} withLabel />
              {r.book === userBook ? <span className="text-warn-ink" aria-label="Your book">★</span> : null}
            </span>
            {bid != null && ask != null ? <div className="text-label text-ink-muted">bid {Math.round(bid * 100)}¢ · ask {Math.round(ask * 100)}¢{typeof x.volume_24h === 'number' ? ` · ${fmtMoney(x.volume_24h)} 24h` : ''}</div> : null}
            {r.group === 'pickem' && picks?.[r.book] ? <div className="text-label text-ink-muted">{picks[r.book]}</div> : null}
            {r.book === 'underdog' && typeof x.multiplier === 'number' ? <div className="text-label text-ink-muted">payout-implied price{x.multiplier !== 1 ? ` · ×${x.multiplier}` : ''}</div> : null}
            {r.book === 'prizepicks' ? <div className="text-label text-ink-muted">line only — PrizePicks posts no price</div> : null}
            {lag != null ? <div className="text-label text-ink-muted">⏱ follows Pinnacle by ~{lag} min</div> : null}
          </div>
        );
      },
    },
    { key: 'a', label: sideLabels[0], numeric: true, sortable: false, render: r => cell(r, r.qa, 0) },
    { key: 'b', label: sideLabels[1], numeric: true, sortable: false, render: r => cell(r, r.qb, 1) },
    {
      key: 'move', label: 'Open → now', sortable: false,
      render: r => {
        if (r.pulled) return <span className="text-ink-muted">last at {fmtLine(r.pulled.line, spec.signed)}</span>;
        const o = r.opener;
        if (!o) return <span className="text-ink-faint">—</span>;
        const flag = o.flagged ? <Tooltip content={o.reason ?? 'This opener failed the sanity check against the other books.'}><span className="ml-1 text-warn-ink">⚠ check</span></Tooltip> : null;
        if (spec.noLine) {
          return <span>{o.priceA != null && r.qa ? (o.priceA === r.qa.price ? <span className="text-ink-muted">unchanged</span> : `${fmtAmerican(o.priceA)} → ${fmtAmerican(r.qa.price)}`) : '—'}{flag}</span>;
        }
        const now = r.mainLine ?? r.line;
        return <span>{o.line === now ? <span className="text-ink-muted">opened here</span> : `${fmtLine(o.line, spec.signed)} → ${fmtLine(now, spec.signed)}`}{flag}</span>;
      },
    },
    {
      key: 'checked', label: 'Checked', numeric: true, sortable: false,
      render: r => r.pulled
        ? <span className="text-label text-ink-muted">last seen {fmtClock(r.pulled.at, now)}</span>
        : (
          <span className="text-label text-ink-muted whitespace-nowrap">
            {fmtAgo(secondsSince(r.checkedAt, now))}
            <span className={(secondsSince(r.since, now) ?? 0) > 12 * 3600 ? 'text-warn-ink' : ''}> · since {fmtClock(r.since, now)}</span>
          </span>
        ),
    },
  ];
  return (
    <div>
      <DataTable<Row>
        caption={`Every book's price${spec.noLine ? '' : ` at ${fmtLine(line, spec.signed)}`}`}
        columns={columns}
        rows={shown}
        rowKey={r => `${r.group}|${r.book}`}
        groupBy={r => (r.pulled ? 'Pulled' : GROUP_LABEL[r.group] ?? r.group)}
        highlight={r => r.book === userBook}
        rowState={r => {
          if (r.pulled) return 'pulled';
          const st = live.rowState(rk(r.book))?.state;
          return st === 'returned' || st === 'new' ? st : null;
        }}
        rowStateAt={r => live.rowState(rk(r.book))?.at ?? null}
        rowClassName={r => [!r.at && !spec.noLine && !r.pulled ? 'text-ink-muted' : '', tintRows && (changedNow(r.qa) || changedNow(r.qb)) ? 'lb-row-tint' : '']
          .filter(Boolean).join(' ') || undefined}
      />
      {Object.keys(hidden).length ? (
        <div className="flex flex-wrap gap-2 border-t border-line-soft px-3 py-2">
          {Object.entries(hidden).map(([g, n]) => (
            <Button key={g} variant="secondary" size="sm" onPress={() => setOpen(o => [...o, g])}>
              + {n} {GROUP_LABEL[g].toLowerCase()} {n === 1 ? 'book' : 'books'}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const bookName = bookLabel;
