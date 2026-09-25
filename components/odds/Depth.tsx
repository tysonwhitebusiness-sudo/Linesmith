'use client';

import { BookLogo } from '../BookLogo';
import { Card, StatGrid, StatValue } from '../ui';
import { depth } from '@/lib/odds/section/depth';
import { fmtClock, fmtLine, fmtMoney } from '@/lib/odds/section/format';
import type { MarketSpec, OddsMarket } from '@/lib/odds/section/types';

/**
 * Depth, limits & order book (O-H of the approved mockup, `depthCard`):
 * Pinnacle's limit, how many books price the market, and the nearest exchange
 * ladder — bids against asks, bar length by the square root of size.
 */
export function Depth({ market, spec, line, now }: { market: OddsMarket; spec: MarketSpec; line: number | null; now: number }) {
  const d = depth(market, spec, line);
  const lad = d.ladder;
  const mx = lad ? Math.max(1, ...lad.bids.concat(lad.asks).map(l => l[1])) : 1;
  const Level = ({ l, bid }: { l: [number, number]; bid: boolean }) => (
    <div className="grid grid-cols-[2.5rem_1fr_3.5rem] items-center gap-2 text-label">
      <b className="tabular-nums">{Math.round(l[0] * 100)}¢</b>
      <span className="h-2 overflow-hidden rounded-xs bg-line-hair">
        <span className={`block h-full ${bid ? 'bg-good' : 'bg-bad'}`} style={{ width: `${Math.max(3, 100 * Math.sqrt(l[1] / mx))}%` }} />
      </span>
      <span className="text-right text-ink-muted tabular-nums">{fmtMoney(l[1] * (lad?.exchange === 'kalshi' ? 1 : l[0]))}</span>
    </div>
  );
  return (
    <Card title="Depth, limits & order book" scope="confidence behind the prices" dense>
      <StatGrid>
        <StatValue label="Pinnacle limit" value={d.pinnacleLimit ? `$${Math.round(d.pinnacleLimit).toLocaleString('en-US')}` : '—'} />
        <StatValue label="Books pricing it" value={String(d.books)} />
        {lad?.spreadCents != null ? <StatValue label={`${lad.exchange === 'kalshi' ? 'Kalshi' : 'Polymarket'} spread`} value={`${lad.spreadCents}¢`} /> : null}
      </StatGrid>
      {lad && (lad.bids.length || lad.asks.length) ? (
        <div className="mt-3">
          <div className="mb-1.5 text-label">
            <BookLogo bookId={lad.exchange} size={14} withLabel /> · {spec.signed ? fmtLine(lad.quote.line, true) : lad.quote.line != null ? `${Math.ceil(lad.quote.line)}+` : ''} contract
            <span className="text-ink-muted"> · price since {fmtClock(lad.quote.since, now)}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><div className="mb-1 text-overline text-ink-muted">Bids (buy yes)</div>{lad.bids.slice(0, 8).map((l, i) => <Level key={i} l={l} bid />)}</div>
            <div><div className="mb-1 text-overline text-ink-muted">Asks (sell yes)</div>{lad.asks.slice(0, 8).map((l, i) => <Level key={i} l={l} bid={false} />)}</div>
          </div>
          <div className="mt-1.5 text-label text-ink-muted">
            {[lad.volume24h != null ? `${fmtMoney(lad.volume24h)} traded 24h` : null, lad.openInterest != null ? `${fmtMoney(lad.openInterest)} open interest` : null,
              lad.liquidity != null ? `${fmtMoney(lad.liquidity)} liquidity` : null, `top ${lad.bids.length} levels stored`].filter(Boolean).join(' · ')}
          </div>
        </div>
      ) : <p className="mt-3 text-body-sm text-ink-muted">No exchange ladder stored for this market yet.</p>}
    </Card>
  );
}
