'use client';

import { BookLogo } from '../BookLogo';
import { Card, FlashValue } from '../ui';
import { CardLiveDot, LivePrice } from './LiveHeader';
import { bookLabel } from '@/lib/odds/books/registry';
import { bestPrice, decimal, withinFiveCents } from '@/lib/odds/section/board';
import { holdSummary } from '@/lib/odds/section/hold';
import { fmtAgo, fmtAmerican, fmtClock, fmtLine, fmtPct, secondsSince } from '@/lib/odds/section/format';
import type { BestPrice as Best, BoardRow, MarketSpec } from '@/lib/odds/section/types';

/**
 * Best price + market hold (O-B of the approved mockup, `bestCard`): the best
 * price on each side, your book against it, how many books sit within 5 cents,
 * and the hold at one book (median) against the hold at the best prices. A
 * negative hold is stated as a fact (D20), never labelled an opportunity.
 */
export function BestPrice({ rows, spec, line, sideLabels, userBook, now, marketKey }: {
  /** The market's key: its prices roll and flash in the live layer (P9). Unset = static (/kit). */
  marketKey?: string;
  rows: BoardRow[];
  spec: MarketSpec;
  line: number | null;
  sideLabels: [string, string];
  userBook?: string | null;
  now: number;
}) {
  const b0 = bestPrice(rows, 0), b1 = bestPrice(rows, 1);
  const hold = holdSummary(rows, b0, b1);
  const me = userBook ? rows.find(r => r.book === userBook) : undefined;
  const checks = rows.map(r => r.checkedAt).filter((v): v is string => !!v).sort();
  const lc = (s: string) => s.replace(/^(Over|Under)\b/, m => m.toLowerCase());
  const off = (b: Best | null, q: BoardRow['qa']) => (b && q ? Math.round((decimal(b.quote.price) - decimal(q.price)) * 100) : null);
  const W = (h: number) => `${Math.max(2, Math.min(100, (h / 0.1) * 100))}%`;
  return (
    <Card
      title={<span className="inline-flex flex-wrap items-center gap-2">Best price <CardLiveDot marketKeys={marketKey ? [marketKey] : []} checkedAt={checks[checks.length - 1]} sources={rows.map(r => r.source)} /></span>}
      scope={spec.noLine ? 'Moneyline' : `at ${fmtLine(line, spec.signed)}`}
      info="The highest price any book offers on each side at this line. Pick'em apps and prices far from every other book (⚠ check) never count as best."
    >
      <div className="grid grid-cols-2 gap-3">
        <BestBox best={b0} label={sideLabels[0]} now={now} marketKey={marketKey} />
        <BestBox best={b1} label={sideLabels[1]} now={now} marketKey={marketKey} />
      </div>
      {me ? (
        <div className="mt-3 text-body-sm text-ink-secondary">
          <BookLogo bookId={me.book} size={14} withLabel /> ★{' '}
          {!me.at ? <>is at {fmtLine(me.line, spec.signed)}, not {fmtLine(line, spec.signed)}</> : (
            <>
              {lc(sideLabels[0])} {fmtAmerican(me.qa?.price)} {off(b0, me.qa) ? <span className="text-ink-muted">({off(b0, me.qa)}¢ off best)</span> : <span className="text-good-ink">best</span>}
              {' · '}{lc(sideLabels[1])} {fmtAmerican(me.qb?.price)} {off(b1, me.qb) ? <span className="text-ink-muted">({off(b1, me.qb)}¢ off best)</span> : <span className="text-good-ink">best</span>}
            </>
          )}
        </div>
      ) : null}
      <div className="mt-1 text-label text-ink-muted">
        {withinFiveCents(rows, b0, 0)} books within 5¢ of the best {lc(sideLabels[0])} · {withinFiveCents(rows, b1, 1)} of the best {lc(sideLabels[1])}
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-label"><b>Market hold</b><span className="text-ink-muted">vig you pay</span></div>
        {hold.typical && hold.atBest != null ? (
          <>
            <div className="mt-1.5 grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2 text-label">
              <span>At one book <span className="text-ink-muted">(median)</span></span>
              <span className="h-1.5 overflow-hidden rounded-full bg-line-soft"><span className="block h-full bg-warn" style={{ width: W(hold.typical.hold) }} /></span>
              <b className="text-right tabular-nums">{fmtPct(hold.typical.hold)}</b>
              <span>At the best prices</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-line-soft"><span className="block h-full bg-good" style={{ width: W(Math.max(0, hold.atBest)) }} /></span>
              <b className="text-right tabular-nums">{fmtPct(hold.atBest)}</b>
            </div>
            <div className="mt-1 text-label text-ink-muted">
              {hold.atBest < 0
                ? 'Best prices cross (negative hold) — shown as a fact, never labelled an opportunity.'
                : `Shopping takes the hold from ${fmtPct(hold.typical.hold)} to ${fmtPct(hold.atBest)}. Lowest single book: ${hold.lowest ? `${bookLabel(hold.lowest.book)} ${fmtPct(hold.lowest.hold)}` : '—'}.`}
            </div>
          </>
        ) : <div className="mt-1 text-label text-ink-muted">Needs two-sided prices at this line.</div>}
      </div>
    </Card>
  );
}

function BestBox({ best, label, now, marketKey }: { best: Best | null; label: string; now: number; marketKey?: string }) {
  return (
    <div className="rounded-ctl bg-card-sunk p-3">
      <div className="text-overline text-ink-muted">Best {label.replace(/^(Over|Under)\b/, m => m.toLowerCase())}</div>
      {best ? (
        <>
          <div className="text-display">{marketKey ? <LivePrice marketKey={marketKey} quote={best.quote} /> : <FlashValue value={best.quote.price} format={fmtAmerican} />}</div>
          <div className="mt-0.5 text-body-sm"><BookLogo bookId={best.book} size={14} withLabel /></div>
          <div className="text-label text-ink-muted">checked {fmtAgo(secondsSince(best.quote.checkedAt, now))} ago · since {fmtClock(best.quote.since, now)}</div>
        </>
      ) : <><div className="text-display text-ink-muted">—</div><div className="text-label text-ink-muted">no book at this line</div></>}
    </div>
  );
}
