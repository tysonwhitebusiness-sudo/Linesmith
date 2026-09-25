'use client';

import { BookLogo } from '../BookLogo';
import { Button, Card, Collapse, useNow } from '../ui';
import { bookLabel } from '@/lib/odds/books/registry';
import { fmtAgo, fmtAmerican, fmtClock, fmtLine, fmtPct, secondsSince } from '@/lib/odds/section/format';
import type { MarketEdge, MarketSpec } from '@/lib/odds/section/types';

/**
 * The Edge card (odds build P11, the approved mockup's O-C `edgeCard`): a soft
 * book's price against the sharp fair price, shown only where every gate
 * passed. RENDER ONLY — every number is a field of the payload's `edges`
 * (Python's `market_edges`); this file never de-vigs, never converts a price
 * to a probability and never compares one book with another
 * (tests/scan-no-edge.test.ts). `edges` absent = hidden by the operator's kill
 * switch or the self-check, and the card is not drawn at all.
 */
const GATES = ['Sharp two-sided at this line', 'Fresh on both sides (D13)', 'Other copies agree', 'Settled, not pulled',
  'Pre-game', 'Positive at every de-vig', 'One book, one price', 'Under the 8% cap', 'Self-check clear'];

/** The edges for the market and line in view (a spread's side B reads its own, negated line). */
export function edgesAt(edges: MarketEdge[] | undefined, marketKey: string, spec: MarketSpec, line: number | null): MarketEdge[] {
  return (edges ?? []).filter(e => e.marketKey === marketKey && (spec.noLine
    || e.line === (e.side === spec.sides[1] && spec.signed && line != null ? -line : line)));
}

/** Market keys with an edge at any line: the market tabs' green dot. */
export function edgeMarketKeys(edges: MarketEdge[] | undefined): Set<string> {
  return new Set((edges ?? []).map(e => e.marketKey));
}

export function EdgeDot({ title = 'An edge passes every gate' }: { title?: string }) {
  return <span aria-label={title} role="img" className="inline-block h-2 w-2 shrink-0 rounded-full bg-good align-middle" data-edge-dot />;
}

export function EdgeCard({ edges, marketKey, spec, line, sideLabels, sharpAtLine, sharpMainLine, onGoToLine, now }: {
  edges: MarketEdge[] | undefined;
  marketKey: string;
  spec: MarketSpec;
  line: number | null;
  sideLabels: [string, string];
  /** Whether Pinnacle prices both sides at this line, and its own main line (the empty state's "compare at"). */
  sharpAtLine: boolean;
  sharpMainLine: number | null;
  onGoToLine?: (line: number) => void;
  now: number;
}) {
  const tick = useNow(30_000);
  if (!edges) return null;
  const here = edgesAt(edges, marketKey, spec, line);
  const top = here[0] ?? null;
  const scope = spec.noLine ? 'Moneyline' : `at ${fmtLine(line, spec.signed)}`;
  const label = (side: string) => sideLabels[side === spec.sides[1] ? 1 : 0];
  return (
    <Card
      title={<span className="inline-flex items-center gap-2">Edge {top ? <EdgeDot /> : null}</span>}
      scope={scope}
      info="A market edge: a book's price against the sharp book's price with its margin removed. No model. Shown only while every gate passes; logged, and hidden the moment one fails."
    >
      <div data-edge-state={top ? 'on' : 'off'}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={top ? 'rounded-xs bg-good px-1.5 text-overline font-semibold text-good-on' : 'rounded-xs bg-card-sunk px-1.5 text-overline font-semibold text-ink-muted'}>
            {top ? 'EDGE' : 'NO EDGE'}
          </span>
          {top ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-ink">
                {label(top.side)} · <BookLogo bookId={top.book} size={18} withLabel />
              </span>
              <span className="ml-auto text-right">
                <b className="block text-display tabular-nums text-good-ink">+{fmtPct(top.ev)}</b>
                <span className="text-overline text-ink-muted">EV</span>
              </span>
            </>
          ) : <b className="text-body-sm text-ink">{sharpAtLine ? 'No book passes every gate here' : 'No sharp price at this line'}</b>}
        </div>
        <Collapse open={!!top} id={`edge-${marketKey}`}>
          {top ? <EdgeDetail e={top} label={label(top.side)} now={Math.max(now, tick)} /> : null}
        </Collapse>
        {!top ? (
          <div className="mt-2 flex items-start gap-3">
            <BookLogo bookId="pinnacle" size={22} />
            <div className="text-body-sm text-ink-secondary">
              {sharpAtLine
                ? 'Pinnacle prices both sides here, and no book beats its fair price after every check: fresh on both sides, not pulled, the same at every source, under the cap.'
                : sharpMainLine != null
                  ? `Pinnacle prices ${fmtLine(sharpMainLine, spec.signed)}, not ${fmtLine(line, spec.signed)}. An edge is only ever measured at the sharp book's own line.`
                  : 'Pinnacle does not price this market, so nothing can pass the first gate.'}
              {!sharpAtLine && sharpMainLine != null && onGoToLine
                ? <div className="mt-2"><Button size="sm" variant="secondary" onPress={() => onGoToLine(sharpMainLine)}>Compare at {fmtLine(sharpMainLine, spec.signed)}</Button></div>
                : null}
            </div>
          </div>
        ) : null}
        {here.length > 1 ? (
          <div className="mt-3 border-t border-line-soft pt-2 text-label text-ink-secondary">
            <b className="text-ink">Also passing</b>
            {here.slice(1, 5).map(e => (
              <div key={`${e.book}|${e.side}`} className="mt-1 flex items-center gap-1.5 tabular-nums">
                {label(e.side)} {fmtAmerican(e.price)} at <BookLogo bookId={e.book} size={14} withLabel /> · <span className="text-good-ink">+{fmtPct(e.ev)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function EdgeDetail({ e, label, now }: { e: MarketEdge; label: string; now: number }) {
  const lo = Math.min(e.implied, e.fair) - 0.025;
  const hi = Math.max(e.implied, e.fair) + 0.025;
  const x = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`;
  const ref = e.reference;
  const sharpPrices = Object.values(ref.prices).map(p => fmtAmerican(p)).join(' / ');
  return (
    <div className="mt-3">
      <div className="relative h-9" aria-hidden>
        <div className="absolute inset-x-0 top-4 h-1 rounded-full bg-line-soft" />
        <div className="absolute top-4 h-1 rounded-full bg-good" style={{ left: x(e.implied), width: `calc(${x(e.fair)} - ${x(e.implied)})` }} />
        <div className="absolute top-0 -translate-x-1/2 text-center text-label text-ink-secondary" style={{ left: x(e.implied) }}>
          {bookLabel(e.book)} <b className="tabular-nums">{fmtPct(e.implied)}</b>
        </div>
        <div className="absolute top-5 -translate-x-1/2 text-center text-label text-good-ink" style={{ left: x(e.fair) }}>
          Fair <b className="tabular-nums">{fmtPct(e.fair)}</b>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-body-sm">
        <div><div className="text-overline text-ink-muted">{bookLabel(e.book)} price</div><b className="tabular-nums">{fmtAmerican(e.price)}</b></div>
        <div><div className="text-overline text-ink-muted">Fair price</div><b className="tabular-nums text-good-ink">{fmtAmerican(e.fairPrice)}</b></div>
        <div><div className="text-overline text-ink-muted">Gap</div><b className="tabular-nums text-good-ink">+{(e.edgePts * 100).toFixed(1)} pts</b></div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-label text-ink-secondary" data-edge-passing>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" aria-hidden />
        Passing for <b>{fmtAgo(secondsSince(e.passingSince, now))}</b> · {label} {fmtAmerican(e.price)} unchanged since {fmtClock(e.softSince, now)}
      </div>
      <div className="mt-3">
        <div className="flex justify-between text-label"><b>Evidence</b><span className="text-ink-muted">checked</span></div>
        <div className="mt-1 space-y-1 text-label text-ink-secondary">
          <div className="flex items-center gap-1.5">
            <BookLogo bookId={ref.book} size={14} withLabel />
            <span>{sharpPrices}{ref.limit ? ` · limit $${ref.limit.toLocaleString('en-US')}` : ''}</span>
            <span className="ml-auto text-ink-muted">{fmtAgo(secondsSince(e.sharpCheckedAt, now))} ago</span>
          </div>
          {ref.second ? (
            <div className="flex items-center gap-1.5">
              <BookLogo bookId={ref.second.book} size={14} withLabel />
              <span>agrees · fair {fmtPct(ref.second.fair)}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <BookLogo bookId={e.book} size={14} withLabel />
            <span>{fmtAmerican(e.price)}{e.singleSource ? ' · one source' : ' · every source agrees'}</span>
            <span className="ml-auto text-ink-muted">{fmtAgo(secondsSince(e.softCheckedAt, now))} ago</span>
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-between text-label"><b>Gates</b><span className="font-semibold text-good-ink">{GATES.length} of {GATES.length} pass</span></div>
      <ul className="mt-1 grid grid-cols-1 gap-x-3 text-label text-ink-secondary sm:grid-cols-2">
        {GATES.map(g => <li key={g}><span className="text-good-ink" aria-hidden>✓</span> {g}</li>)}
      </ul>
      <div className="mt-2 text-label text-ink-muted">Logged to the edge log · hidden the moment any gate fails · the kill switch hides the card</div>
    </div>
  );
}
