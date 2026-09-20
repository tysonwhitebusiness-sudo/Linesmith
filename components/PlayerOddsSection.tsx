'use client';

import type { ReactNode } from 'react';
import { Card, Chip, DataTable } from './ui';
import { BookLogo, bookLabel } from './BookLogo';
import { fmt } from './charts/tokens';
import { relativeAge } from '@/lib/odds/priceFreshness';
import type { PlayerPriceQuote, PlayerPriceRow } from '@/lib/odds/props/playerPrices';

/**
 * "Odds & prices" — the player page's odds, in one section after the game log
 * (R6.1d, G2 `oddsCard`). It replaces the context rail's "Today's line", "Line
 * movement" and "Recorded price" cards and the main column's "All books".
 *
 * Every price here is at R2's main line, the line the prop block's stepper opens
 * on. Once a game has started the rows are the ones that stood at the start
 * (`usePropOdds`'s `startIso`), so the section says "at the start" and never
 * puts an in-play price beside a pre-game line (R2-F6).
 *
 * Sport-neutral: the rows are `prop_odds` for every sport, and the movement,
 * books and game-line cards arrive as nodes the page already builds.
 */
export function PlayerOddsSection({
  prices,
  loading,
  started,
  activeMarketKey,
  marketLabel,
  onPickMarket,
  movement,
  books,
  gameLine,
}: {
  prices: PlayerPriceRow[];
  loading: boolean;
  started: boolean;
  activeMarketKey: string | null;
  marketLabel: (marketKey: string) => string;
  /** Switches the prop block to a market the player has a candidate for; `null` when there is none. */
  onPickMarket: ((marketKey: string) => void) | null;
  movement: ReactNode;
  books: ReactNode;
  gameLine: ReactNode;
}) {
  const priced = prices.filter((p) => p.kind !== 'alternates-only');
  const scope = loading || prices.length === 0 ? undefined : `${priced.length} priced ${priced.length === 1 ? 'market' : 'markets'}${started ? ' · at the start' : ''}`;
  return (
    <>
      <Card
        title="Prices by market"
        scope={scope}
        info="The main line is the one the most books quote on both sides. Best over and under are the highest prices at that line; pick'em apps are left out."
        dense
        state={
          loading
            ? { kind: 'loading', lines: 4 }
            : prices.length === 0
              ? {
                  kind: 'empty',
                  title: 'No prices posted',
                  reason: "No book has priced this player's next game, or it is not on the slate. The research above doesn't depend on a line.",
                }
              : { kind: 'ready' }
        }
      >
        <DataTable
          caption="Best prices for this player, by market, at the main line"
          rows={prices}
          rowKey={(r) => r.marketKey}
          onRowClick={onPickMarket ? (r) => onPickMarket(r.marketKey) : undefined}
          columns={[
            {
              key: 'market',
              label: 'Market',
              sortValue: (r) => marketLabel(r.marketKey),
              render: (r) => (
                <span className="inline-flex items-center gap-2">
                  <span className={r.marketKey === activeMarketKey ? 'font-semibold text-ink' : 'text-ink'}>{marketLabel(r.marketKey)}</span>
                  {r.marketKey === activeMarketKey ? <Chip>In view</Chip> : null}
                </span>
              ),
            },
            {
              key: 'line',
              label: 'Line',
              numeric: true,
              sortValue: (r) => r.line,
              render: (r) =>
                r.kind === 'main' ? (
                  <span>{r.line}</span>
                ) : r.kind === 'yes-no' ? (
                  <span className="text-ink-muted">yes</span>
                ) : (
                  <span className="text-ink-muted" title="No book quotes both sides of any line">
                    alternates {r.availableLines.length > 1 ? `${r.availableLines[0]}–${r.availableLines[r.availableLines.length - 1]}` : r.availableLines[0]}
                  </span>
                ),
            },
            { key: 'over', label: 'Best over', numeric: true, sortValue: (r) => r.over?.americanOdds, render: (r) => <Quote q={r.over} /> },
            { key: 'under', label: 'Best under', numeric: true, sortValue: (r) => r.under?.americanOdds, render: (r) => <Quote q={r.under} /> },
            { key: 'books', label: 'Books', numeric: true },
            { key: 'updatedAt', label: 'Updated', sortValue: (r) => r.updatedAt, render: (r) => <span className="text-ink-muted">{relativeAge(r.updatedAt) ?? '—'}</span> },
          ]}
        />
      </Card>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="min-w-0">{movement}</div>
        <div className="min-w-0">{books}</div>
      </div>
      {gameLine}
    </>
  );
}

function Quote({ q }: { q: PlayerPriceQuote | null }) {
  if (!q) return <span className="text-ink-muted">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5" title={`${bookLabel(q.bookmaker)}, ${new Date(q.capturedAt).toLocaleString()}`}>
      <span className="font-semibold text-ink">{fmt.american(q.americanOdds)}</span>
      <BookLogo bookId={q.bookmaker} size={14} />
    </span>
  );
}
