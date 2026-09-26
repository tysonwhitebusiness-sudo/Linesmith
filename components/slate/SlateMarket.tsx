'use client';

import { SlateOddsHub } from '../odds/SlateOddsHub';
import type { MarketEdge } from '@/lib/odds/section/types';
import type { SlateGameRef } from '../odds/SlateOddsMovers';
import type { SlateOddsGame } from '@/lib/odds/section/slate';
import { useEffect, useState } from 'react';
import { Card, DataTable, EmptyState, Tooltip, cx, type Column, SectionBand } from '@/components/ui';
import { GameMark, PlayerSubject } from './SlateSubject';
import { BookLogo, bookLabel } from '../BookLogo';
import { headshotFor } from '@/lib/sports/shared/identity';
import type { DisagreementRow, OutlierRow } from '@/lib/slate/marketMoves';

/**
 * The Slate's two market-shape cards (S2): Price outliers and Line
 * disagreements. Side by side from 1024 up, stacked below.
 *
 * NEITHER IS AN EDGE, and both captions say so in the reader's own words. A
 * price gap between books is a fact about the books. Two books hanging
 * different numbers is a fact about the books. Neither is a claim that anything
 * is mispriced, and nothing here computes, sorts by or colours a difference
 * against a model.
 *
 * slate-polish v4: the Slate's row anatomy (face, name, the game under it with
 * its logos), the market as its own column, the odd book's price in bold red
 * against the median, the other line in bold amber, the books as logos.
 *
 * Movers, S2's third card, is its own section now (`SlateMovers.tsx`, MV3):
 * the noise that kept it out was live in-game pricing, cut since (SL-29).
 */

export interface SlateMarketData {
  outliers: OutlierRow[];
  disagreements: DisagreementRow[];
}

const american = (n: number) => (n > 0 ? `+${n}` : String(n));

/** "total-bases" -> "Total bases". The market keys are kebab-case internally. */
function marketLabel(key: string): string {
  const words = key.replace(/[-_]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Refs = Map<string, SlateGameRef> | undefined;

/** A player row's subject: face, name, and the game under it (a prop row does not say which side the player is on). */
function subject(r: { subjectId: string; subjectName: string | null; gameId: string }, faceOf: (id: string) => string | null, refs: Refs) {
  const g = refs?.get(r.gameId);
  return (
    <PlayerSubject
      name={r.subjectName ?? r.subjectId}
      headshot={faceOf(r.subjectId)}
      sub={g?.teams ? <GameMark away={g.teams.away} home={g.teams.home} className="text-label font-normal text-ink-muted" /> : (g?.label ?? null)}
    />
  );
}

const OUTLIER_COLUMNS = (faceOf: (id: string) => string | null, refs: Refs): Column<OutlierRow>[] => [
  { key: 'subject', label: 'Player', sortable: false, render: (r) => subject(r, faceOf, refs) },
  {
    key: 'market',
    label: 'Market',
    sortable: false,
    render: (r) => (
      <span className="flex flex-col whitespace-nowrap">
        <span className="text-ink">{marketLabel(r.market)}</span>
        <span className="text-label text-ink-muted">{r.side === 'under' ? 'Under' : 'Over'} {r.line}</span>
      </span>
    ),
  },
  {
    key: 'bookmaker',
    label: 'Book',
    sortable: false,
    render: (r) => (
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <BookLogo bookId={r.bookmaker} size={16} withLabel />
        <b className="font-bold tabular-nums text-bad-ink">{american(r.odds)}</b>
      </span>
    ),
  },
  {
    key: 'medianOdds',
    label: 'Others',
    numeric: true,
    info: 'The median of every book quoting the same player, market and line. Gaps above 15 implied points are dropped as stale or exchange quotes rather than shown as bargains.',
    render: (r) => (
      <span className="flex flex-col items-end">
        <span className="tabular-nums text-ink">{american(r.medianOdds)}</span>
        <span className="text-label text-ink-muted">median · {r.books} books</span>
      </span>
    ),
  },
  { key: 'gapPts', label: 'Gap', numeric: true, render: (r) => <b className="font-bold tabular-nums text-warn-ink">{r.gapPts.toFixed(1)} pts</b> },
];

const DISAGREEMENT_COLUMNS = (faceOf: (id: string) => string | null, refs: Refs): Column<DisagreementRow>[] => [
  { key: 'subject', label: 'Player', sortable: false, render: (r) => subject(r, faceOf, refs) },
  { key: 'market', label: 'Market', sortable: false, render: (r) => <span className="whitespace-nowrap text-ink">{marketLabel(r.market)}</span> },
  {
    key: 'mainLine',
    label: 'Most books',
    numeric: true,
    render: (r) => (
      <span className="whitespace-nowrap">
        <b className="font-bold text-ink">{r.mainLine}</b> <span className="text-ink-muted">× {r.mainBooks}</span>
      </span>
    ),
  },
  {
    key: 'otherLine',
    label: 'Others',
    numeric: true,
    render: (r) => (
      <span className="whitespace-nowrap">
        <b className="font-bold text-warn-ink">{r.otherLine}</b> <span className="text-ink-muted">× {r.otherBooks}</span>
      </span>
    ),
  },
  {
    key: 'otherBookmakers',
    label: 'At the other line',
    sortable: false,
    wrap: true,
    render: (r) => (
      <span className="flex items-center gap-1">
        {r.otherBookmakers.slice(0, 5).map((b) => (
          <Tooltip key={b} content={bookLabel(b)}>
            <span className="inline-flex"><BookLogo bookId={b} size={18} /></span>
          </Tooltip>
        ))}
        {r.otherBookmakers.length > 5 ? (
          <span className="text-label text-ink-muted">+{r.otherBookmakers.length - 5}</span>
        ) : null}
      </span>
    ),
  },
];

export function SlateMarket({ data, loading, sport, odds, refs, edges }: {
  data: SlateMarketData | null;
  loading: boolean;
  sport: string;
  /** Unused since v4 (the row shows the game's logos, not the player's badge); kept so callers need not change. */
  teamLogoBySubject?: Map<string, string>;
  /** O4: the slate's game-line odds, for the Market hub under the prop cards. */
  odds?: SlateOddsGame[];
  refs?: Map<string, SlateGameRef>;
  /** P11: the market edges passing every gate, for the hub's Edges tab. */
  edges?: MarketEdge[];
}) {
  const outliers = data?.outliers ?? [];
  const splits = data?.disagreements ?? [];
  const faceOf = (id: string): string | null => headshotFor(sport, id);
  const hasOdds = !!odds?.some(g => g.books > 0);
  if (!loading && outliers.length === 0 && splits.length === 0 && !hasOdds) return null;

  return (
    <section id="slate-market" className="mb-6 scroll-mt-[150px]">
      <SectionBand title="Market" />
      <div className={cx('grid grid-cols-1 gap-3 lg:grid-cols-2')}>
        <Card
          title="Price outliers"
          count={outliers.length || undefined}
          scope="At least 5 books"
          flush
          state={loading && outliers.length === 0 ? { kind: 'loading', lines: 6 } : { kind: 'ready' }}
          caption="A price gap between books, not a model edge."
        >
          {outliers.length > 0 ? (
            <DataTable caption="Price outliers" columns={OUTLIER_COLUMNS(faceOf, refs)} rows={outliers} rowKey={(r, i) => `${r.subjectId}-${r.market}-${r.bookmaker}-${i}`} />
          ) : loading ? null : (
            <EmptyState title="No outliers right now" reason="Every line with at least five books quoting it is priced within four points of the rest." />
          )}
        </Card>

        <Card
          title="Line disagreements"
          count={splits.length || undefined}
          scope="Books split on the line"
          flush
          state={loading && splits.length === 0 ? { kind: 'loading', lines: 6 } : { kind: 'ready' }}
          caption="Where books disagree on the line itself. A price gap, not a model edge."
        >
          {splits.length > 0 ? (
            <DataTable caption="Line disagreements" columns={DISAGREEMENT_COLUMNS(faceOf, refs)} rows={splits} rowKey={(r, i) => `${r.subjectId}-${r.market}-${i}`} />
          ) : loading ? null : (
            <EmptyState title="The books agree" reason="Every market on this slate is hung at one line." />
          )}
        </Card>
      </div>
      {hasOdds ? <SlateOddsHub games={odds!} refs={refs ?? new Map()} edges={edges} /> : null}
    </section>
  );
}

/**
 * The market cards' own fetch, on their own schedule.
 *
 * They take two to six seconds against the real tables, which is why they are
 * a separate route and a separate hook: the Games section must not wait on
 * them, and neither must the props board.
 */
export function useSlateMarket(sport: string, league: string | null, date: string | null, refreshKey?: string | null) {
  const [data, setData] = useState<SlateMarketData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ sport });
        if (sport === 'soccer' && league) params.set('league', league);
        if (sport === 'tennis' && league) params.set('tour', league);
        if (date) params.set('date', date);
        const res = await fetch(`/api/slate/market?${params}`, { cache: 'no-store' });
        if (cancelled) return;
        // A failed read hides these two cards. They are an extra; the page is
        // the Games section and the props board.
        setData(res.ok ? ((await res.json()) as SlateMarketData) : null);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, league, date, refreshKey]);

  return { data, loading };
}
