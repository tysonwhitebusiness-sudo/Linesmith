import { BookLogo } from '../BookLogo';
import { DataTable, EmptyState } from '../ui';
import type { SlateGameRef } from './SlateOddsMovers';
import { marketLabel } from '@/lib/odds/props/marketLabels';
import { fmtAgo, fmtAmerican, fmtLine, fmtPct, secondsSince } from '@/lib/odds/section/format';
import type { MarketEdge } from '@/lib/odds/section/types';

const GAME_MARKET: Record<string, string> = { sp: 'spread', tot: 'total', ml: 'moneyline', tt_home: 'home team total', tt_away: 'away team total' };

/**
 * The Market hub's Edges tab (odds build P11): every market edge passing every
 * gate on the slate, highest EV first. RENDER ONLY — each number is a field of
 * `/api/odds/edges` (Python's `market_edges`); nothing here converts a price
 * or compares two (tests/scan-no-edge.test.ts).
 */
export function SlateEdges({ edges, refs }: { edges: MarketEdge[]; refs: Map<string, SlateGameRef> }) {
  const now = Date.now();
  const teams = (id: string) => (refs.get(id)?.label ?? '').split(' @ ');
  const what = (e: MarketEdge) => e.kind === 'prop'
    ? `${e.subjectName ?? 'Player'} · ${marketLabel(e.marketKey)} ${fmtLine(e.line)}`
    : GAME_MARKET[e.marketKey.split('_').slice(1).join('_')] ?? e.marketKey;
  const pick = (e: MarketEdge) => {
    if (e.side === 'home' || e.side === 'away') {
      const [away, home] = teams(e.gameId);
      const team = (e.side === 'home' ? home : away) || e.side;
      return e.line == null ? team : `${team} ${fmtLine(e.line, true)}`;
    }
    return `${e.side === 'under' ? 'Under' : e.side === 'over' ? 'Over' : e.side} ${fmtLine(e.line)}`;
  };
  return edges.length ? (
    <>
      <DataTable<MarketEdge>
        caption="Only markets where every gate passes, highest EV first"
        density="compact"
        rows={edges}
        rowKey={e => `${e.gameId}|${e.subjectId}|${e.marketKey}|${e.side}|${e.line}|${e.book}`}
        columns={[
          { key: 'm', label: 'Market', sortable: false, render: e => <span><b>{refs.get(e.gameId)?.label ?? e.gameId}</b> · {what(e)}</span> },
          { key: 'p', label: 'Price', sortable: false, render: e => <span className="inline-flex items-center gap-1.5">{pick(e)} at <BookLogo bookId={e.book} size={14} /> <b className="tabular-nums">{fmtAmerican(e.price)}</b></span> },
          { key: 'f', label: 'Fair', numeric: true, sortable: false, render: e => fmtPct(e.fair) },
          { key: 'ev', label: 'EV', numeric: true, sortable: false, render: e => <b className="text-good-ink">+{fmtPct(e.ev)}</b> },
          { key: 'a', label: 'Checked', numeric: true, sortable: false,
            render: e => <span className="text-label text-ink-muted">{fmtAgo(secondsSince(e.softCheckedAt, now))} / sharp {fmtAgo(secondsSince(e.sharpCheckedAt, now))}</span> },
        ]}
      />
      <div className="px-4 pb-3 pt-1 text-label text-ink-muted">Expect few and small. More than a handful above 5% at once turns edge display off (the self-check).</div>
    </>
  ) : <EmptyState title="No edges right now" reason="No book's price beats the sharp fair price after every gate on this slate. That is the usual state." />;
}
