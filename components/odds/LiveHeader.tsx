'use client';

import type { ReactNode } from 'react';
import { Button, FlashValue, LiveDot } from '../ui';
import { useLive } from './live';
import { cadenceOf } from '@/lib/odds/section/cadence';
import { fmtAmerican } from '@/lib/odds/section/format';
import { priceKey, splitMarketKey } from '@/lib/odds/section/liveDiff';
import type { OddsQuote } from '@/lib/odds/section/types';

/**
 * The live layer's odds-side pieces (odds build P9 §3). The kit's `LiveDot`
 * and `FlashValue` take plain props; these read the section's live memory
 * (`useLive`) and pass the right change in, so a card only names the market
 * and the quote.
 */

/** A market key as the live memory counts it: `period|market`. */
export function marketOf(marketKey: string, game: boolean): string {
  return splitMarketKey(marketKey, game).join('|');
}

/** One price that rolls and flashes when a refresh moves it. */
export function LivePrice({ marketKey, quote, best, className, format = fmtAmerican, value, quiet }: {
  marketKey: string;
  /** The flash cap, decided by the card from the values IT shows (PriceBoard). */
  quiet?: boolean;
  quote: Pick<OddsQuote, 'source' | 'book' | 'side' | 'line' | 'price'>;
  best?: boolean;
  className?: string;
  format?: (v: number) => string;
  /** Show a number other than the price (a line), still keyed by the quote. */
  value?: number | null;
}) {
  const live = useLive();
  const k = priceKey(marketKey, quote, live.game);
  return (
    <FlashValue value={value === undefined ? quote.price : value} format={format} best={best} className={className}
      change={live.change(k)} quiet={quiet} recent={live.recent(k)} />
  );
}

/** A card header's dot: ticks, uses the slowest cadence among the card's sources, and pings when the card's market changed. */
export function CardLiveDot({ marketKeys, checkedAt, sources, cadenceS }: {
  marketKeys: string[];
  checkedAt: string | null | undefined;
  sources: Iterable<string>;
  /** A card whose source is not a price feed (splits, pick counts) names its cadence directly. */
  cadenceS?: number;
}) {
  const live = useLive();
  const pings = marketKeys.map(k => live.pingFor(marketOf(k, live.game))).filter((v): v is number => v != null);
  return <LiveDot checkedAt={checkedAt} cadenceS={cadenceS ?? cadenceOf(sources)} pingAt={pings.length ? Math.max(...pings) : null} />;
}

/** 30 one-minute bars of price changes across every book, the current minute in `good` (the mockup's `heartbeat`). */
export function Heartbeat({ beats }: { beats: number[] }) {
  const mx = Math.max(1, ...beats);
  const total = beats.reduce((a, x) => a + x, 0);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-flex h-4 items-end gap-px" data-heartbeat>
        {beats.map((v, i) => (
          <i key={i} className={`block w-[3px] rounded-[1px] ${i === beats.length - 1 && v ? 'bg-good' : 'bg-ink-faint'}`}
            style={{ height: v ? Math.max(3, (16 * v) / mx) : 1 }} />
        ))}
      </span>
      <span>{total} changes in 30 min</span>
    </span>
  );
}

/**
 * The section header (O-I + Revision 4): the heartbeat and freshness strip,
 * then "N prices changed since you opened this · M pulled" — clicking it
 * outlines those cells (`data-recent`), and clicking again stops.
 */
export function LiveHeader({ beats, children }: { beats: number[]; children?: ReactNode }) {
  const live = useLive();
  const { changed, pulled } = live.sinceOpened;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-label text-ink-muted">
      <span className="inline-flex flex-wrap items-center gap-x-1">
        <Heartbeat beats={beats} />
        {children}
      </span>
      {changed || pulled ? (
        <Button size="sm" variant="tertiary" aria-pressed={live.showRecent} onPress={live.toggleRecent}>
          {changed} price{changed === 1 ? '' : 's'} changed since you opened this{pulled ? ` · ${pulled} pulled` : ''}
          {live.showRecent ? ' · hide' : ' · show'}
        </Button>
      ) : <span data-since-opened>No changes since you opened this page</span>}
    </div>
  );
}
