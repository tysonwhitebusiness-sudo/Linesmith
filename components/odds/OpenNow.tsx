'use client';

import { BookLogo } from '../BookLogo';
import { Card, DataTable, Tooltip } from '../ui';
import { bookLabel } from '@/lib/odds/books/registry';
import { openNow, type OpenNowRow } from '@/lib/odds/section/openers';
import { fmtAmerican, fmtClock, fmtLine } from '@/lib/odds/section/format';
import type { MarketSpec, OddsMarket } from '@/lib/odds/section/types';

/**
 * Opening → now (O-F of the approved mockup, `openCard`): the first price
 * recorded per book against its main line now. A flagged opener (it failed
 * the sanity check against the other books) reads "⚠ check" and is never
 * counted as the opening line (D21).
 */
export function OpenNow({ market, spec, now, title = 'Opening → now' }: { market: OddsMarket; spec: MarketSpec; now: number; title?: string }) {
  const o = openNow(market, spec);
  const rng = (r: [number, number] | null) => (!r ? '—' : r[0] === r[1] ? fmtLine(r[0], spec.signed) : `${fmtLine(r[0], spec.signed)}–${fmtLine(r[1], spec.signed)}`);
  const pair = (a: number | null | undefined, b: number | null | undefined) => `${fmtAmerican(a)}/${fmtAmerican(b)}`;
  return (
    <Card title={title} scope="first seen per book" dense
      state={o.rows.length ? { kind: 'ready' } : { kind: 'empty', title: 'No opener recorded', reason: 'No source has recorded a first price for this market yet.' }}
      caption={'"Opened" is the first price any source recorded for that book (scraper history starts Sep 22). VSiN\'s own OPEN row is used for its Nevada books.'}>
      {!spec.noLine && o.rows.length ? (
        <p className="mb-2 text-body-sm text-ink-secondary">
          Opened <b>{rng(o.openRange)}</b>{o.firstSeen ? ` (first seen ${fmtClock(o.firstSeen, now)})` : ''} → now <b>{rng(o.nowRange)}</b>.
          {o.latestSteam ? <> Latest move led by <b>{bookLabel(o.latestSteam.leader)}</b> at {fmtClock(o.latestSteam.at, now)}, {o.latestSteam.followers} followed.</> : null}
        </p>
      ) : null}
      <DataTable<OpenNowRow>
        caption="Each book's opening price against its price now"
        density="compact"
        rows={o.rows}
        rowKey={r => r.book}
        columns={[
          { key: 'book', label: 'Book', sortable: false, render: r => <BookLogo bookId={r.book} size={14} withLabel /> },
          { key: 'at', label: 'Opened', sortable: false, render: r => <span className="text-label text-ink-muted">{fmtClock(r.open.at, now)}</span> },
          {
            key: 'open', label: 'Open', numeric: true, sortable: false,
            render: r => (
              <span>
                {r.open.flagged ? <Tooltip content={r.open.reason ?? 'Failed the sanity check against the other books.'}><span className="mr-1 text-warn-ink">⚠ check</span></Tooltip> : null}
                {spec.noLine ? '' : `${fmtLine(r.open.line, spec.signed)} `}<span className="text-ink-muted">{pair(r.open.priceA, r.open.priceB)}</span>
              </span>
            ),
          },
          {
            key: 'now', label: 'Now', numeric: true, sortable: false,
            render: r => r.nowA
              ? <span>{spec.noLine ? '' : <b>{fmtLine(r.nowA.line, spec.signed)} </b>}<span className="text-ink-muted">{pair(r.nowA.price, r.nowB?.price)}</span></span>
              : <span className="text-ink-faint">—</span>,
          },
        ]}
      />
    </Card>
  );
}
