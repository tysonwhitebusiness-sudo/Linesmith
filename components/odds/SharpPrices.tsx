'use client';

import { BookLogo } from '../BookLogo';
import { Button, Card, LiveDot } from '../ui';
import { exchangesAt, nearestKalshi, pinnacleMain, SHARP_STALE_S, toAmerican, twoSidedAt, type TwoSided } from '@/lib/odds/section/sharp';
import { fmtAgo, fmtAmerican, fmtClock, fmtLine, fmtMoney, fmtPct, secondsSince } from '@/lib/odds/section/format';
import type { MarketSpec, OddsMarket } from '@/lib/odds/section/types';

/**
 * Sharp prices (O-S of the approved mockup, `sharpStrip`): Pinnacle's two
 * prices and its no-vig fair split, Circa where it prices the market, and the
 * exchanges at this exact line. When the selected line has no Pinnacle price
 * it says so in the same place, with a "go to" its own line.
 */
export function SharpPrices({ market, spec, line, sideLabels, now, onGoToLine }: {
  market: OddsMarket;
  spec: MarketSpec;
  line: number | null;
  /** The two sides' words with the line: ["Over 66.5", "Under 66.5"] or ["GB −4.5", "ATL +4.5"]. */
  sideLabels: [string, string];
  now: number;
  onGoToLine?: (line: number) => void;
}) {
  const pin = twoSidedAt(market, spec, 'pinnacle', line);
  const circa = twoSidedAt(market, spec, 'circa', line);
  const ex = exchangesAt(market, spec, line);
  const pm = pinnacleMain(market, spec);
  const near = !ex.some(e => e.book === 'kalshi') && line != null ? nearestKalshi(market, spec, line) : [];
  const sharpChecks = market.cur.filter(q => ['pinnacle', 'circa', 'kalshi', 'polymarket', 'novig', 'prophetx'].includes(q.book) && q.checkedAt)
    .map(q => q.checkedAt!).sort();
  return (
    <Card
      title={<span className="inline-flex flex-wrap items-center gap-2">Sharp prices <LiveDot checkedAt={sharpChecks[sharpChecks.length - 1]} cadenceS={70} now={now} /></span>}
      scope="fair = Pinnacle with the vig removed"
      info="Pinnacle's price with its margin taken out, multiplicatively, is the fair split. Circa is shown where it prices this market; exchanges at this exact line."
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {pin ? <SharpTile book="pinnacle" p={pin} labels={sideLabels} now={now} /> : (
          <div className="rounded-ctl bg-card-sunk p-3">
            <BookLogo bookId="pinnacle" size={18} withLabel />
            <div className="mt-2 text-body-sm text-ink-secondary">No Pinnacle price at {spec.noLine ? 'this market' : fmtLine(line, spec.signed)}</div>
            {pm != null && onGoToLine ? (
              <div className="mt-1 text-label text-ink-muted">
                Pinnacle prices {fmtLine(pm, spec.signed)} —{' '}
                <Button variant="link" size="sm" onPress={() => onGoToLine(pm)}>go to {fmtLine(pm, spec.signed)}</Button>
              </div>
            ) : pm == null ? <div className="mt-1 text-label text-ink-muted">Pinnacle does not price this market.</div> : null}
          </div>
        )}
        {circa ? <SharpTile book="circa" p={circa} labels={sideLabels} now={now}
          extra={<KV k="Source" v={circa.a.source.endsWith('vsin') ? 'VSiN line tracker' : 'relayed'} />} /> : null}
        <div className="rounded-ctl bg-card-sunk p-3">
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-label">Exchanges</b>
            <span className="text-label text-ink-muted">{sideLabels[0]} · bid–ask · volume</span>
          </div>
          {ex.length ? ex.map(e => (
            <div key={e.book} className="mt-1.5 grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 text-body-sm">
              <BookLogo bookId={e.book} size={14} withLabel />
              <b className="tabular-nums">{fmtAmerican(e.quote.price)}</b>
              <span className="text-label text-ink-muted tabular-nums">{e.bid != null && e.ask != null ? `${Math.round(e.bid * 100)}–${Math.round(e.ask * 100)}¢` : ''}</span>
              <span className="text-label text-ink-muted">{e.volume24h ? `${fmtMoney(e.volume24h)} 24h` : e.liquidity ? `${fmtMoney(e.liquidity)} liq.` : ''}</span>
            </div>
          )) : <div className="mt-1.5 text-body-sm text-ink-muted">No exchange at this line</div>}
          {near.length ? (
            <div className="mt-2 text-label text-ink-muted">
              Kalshi has no contract at {fmtLine(line)} · nearest{' '}
              {near.map(q => `${Math.ceil(q.line!)}+ ${Math.round(Number(q.extra?.yes_bid) * 100)}–${Math.round(Number(q.extra?.yes_ask) * 100)}¢`).join(' · ')}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function KV({ k, v, warn }: { k: string; v: React.ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-2 text-label">
      <span className="text-ink-muted">{k}</span>
      <span className={warn ? 'text-warn-ink' : 'text-ink-secondary'}>{v}</span>
    </div>
  );
}

/** Two-sided prices, the fair price and the split bar (the mockup's `sharpTile`). */
function SharpTile({ book, p, labels, now, extra }: { book: string; p: TwoSided; labels: [string, string]; now: number; extra?: React.ReactNode }) {
  const limit = typeof p.a.extra?.limit === 'number' ? (p.a.extra.limit as number) : null;
  const sinceS = secondsSince(p.a.since, now);
  const stale = sinceS != null && sinceS > SHARP_STALE_S;
  return (
    <div className="rounded-ctl bg-card-sunk p-3">
      <BookLogo bookId={book} size={18} withLabel />
      <div className="mt-2 flex items-end gap-4">
        <div><div className="text-overline text-ink-muted">{labels[0]}</div><b className="text-title tabular-nums">{fmtAmerican(p.a.price)}</b></div>
        <div><div className="text-overline text-ink-muted">{labels[1]}</div><b className="text-title tabular-nums">{fmtAmerican(p.b.price)}</b></div>
        <div className="ml-auto text-right">
          <div className="text-overline text-ink-muted">fair {labels[0]}</div>
          <b className="text-title text-good-ink tabular-nums">{fmtAmerican(toAmerican(p.fairA))}</b>
        </div>
      </div>
      <SplitBar p={p.fairA} labels={labels} />
      <div className="mt-2 space-y-1">
        <KV k="Checked" v={`${fmtAgo(secondsSince(p.a.checkedAt, now))} ago`} />
        <KV k={stale ? 'Unchanged for' : 'Price since'} v={stale ? fmtAgo(sinceS) : fmtClock(p.a.since, now)} warn={stale} />
        {limit ? <KV k="Limit" v={<b>${Math.round(limit).toLocaleString('en-US')}</b>} /> : null}
        {extra}
      </div>
    </div>
  );
}

/** The no-vig split in the two comparison colours (the mockup's `fairBar`). */
export function SplitBar({ p, labels, colors }: {
  p: number;
  labels: [string, string];
  /** The two teams' colours (the Slate's game card, O4); unset draws the neutral comparison pair. */
  colors?: [string | null | undefined, string | null | undefined];
}) {
  return (
    <div className="mt-2">
      <div className="flex h-1.5 overflow-hidden rounded-full" role="img" aria-label={`${labels[0]} ${fmtPct(p)}, ${labels[1]} ${fmtPct(1 - p)}`}>
        <span className={colors?.[0] ? undefined : 'bg-cmp-a'} style={{ width: `${(p * 100).toFixed(1)}%`, ...(colors?.[0] ? { background: colors[0] } : {}) }} />
        <span className={colors?.[1] ? undefined : 'bg-cmp-b'} style={{ width: `${((1 - p) * 100).toFixed(1)}%`, ...(colors?.[1] ? { background: colors[1] } : {}) }} />
      </div>
      <div className="mt-1 flex justify-between text-label text-ink-muted">
        <span>{labels[0]} <b className="text-ink">{fmtPct(p)}</b></span>
        <span><b className="text-ink">{fmtPct(1 - p)}</b> {labels[1]}</span>
      </div>
    </div>
  );
}
