'use client';

import { useEffect, useMemo, useState } from 'react';
import { Avatar, Card, Chip, DataTable, EmptyState, SegmentedToggle, Tabs, type Column, SectionBand } from '@/components/ui';
import { Sparkline } from '@/components/charts';
import { espnHeadshot, mlbHeadshot } from '@/lib/sports/shared/identity';
import type { ConsensusMover, MoverKind, MoverWindow } from '@/lib/slate/marketMoves';

/**
 * Movers (MV3, spec §3.2) — how the market has moved on the games still to
 * start, for game lines and props.
 *
 * Every number is the CONSENSUS: the median across at least three books,
 * pre-game only, first seen to now, with exchanges and pick'em apps left out
 * (`lib/slate/marketMoves.ts`). A single book re-pricing on its own never makes
 * a row. Movement is market information, not a prediction, and the caption
 * says so. Nothing here compares a move to a model, and nothing is coloured
 * as good or bad.
 */

export interface SlateMoversData {
  games: number;
  lines: ConsensusMover[];
  props: ConsensusMover[];
}

const WINDOWS: Array<{ value: MoverWindow; label: string }> = [
  { value: 'first', label: 'Since first seen' },
  { value: 'h3', label: '3h' },
  { value: 'h1', label: '1h' },
];

/** A move smaller than this in the chosen window is not listed under it. */
const MIN_SHOWN_PTS = 1.5;

/** Rows the card lists in a window, so the nav count and the card agree. */
export function moversShown(data: SlateMoversData | null, win: MoverWindow = 'first'): number {
  if (!data) return 0;
  return [...data.lines, ...data.props].filter((m) => Math.abs(m.moves[win]) >= MIN_SHOWN_PTS).length;
}

const american = (n: number) => (n > 0 ? `+${n}` : String(n));

/** "pitcher-strikeouts" -> "Pitcher strikeouts". */
function marketLabel(key: string): string {
  const words = key.replace(/[-_]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function sideLabel(m: ConsensusMover): string {
  if (m.kind === 'props') return m.line == null ? (m.side === 'under' ? 'No' : 'Yes') : `${m.side === 'under' ? 'Under' : 'Over'} ${m.line}`;
  if (m.market === 'total') return `Over ${m.line ?? ''}`.trim();
  const team = m.matchup ? (m.side === 'home' ? m.matchup.split('@')[1] : m.matchup.split('@')[0])?.trim() : null;
  const who = team || (m.side === 'home' ? 'Home' : 'Away');
  if (m.market === 'spread') return `${who} ${m.line != null && m.line > 0 ? '+' : ''}${m.line ?? ''}`.trim();
  return who;
}

function lineText(m: ConsensusMover): string {
  if (m.line == null) return '—';
  if (m.lineFirst == null || m.lineFirst === m.line) return String(m.line);
  return `${m.lineFirst} → ${m.line}`;
}

function timeText(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** A player headshot from the subject id, same id-space rules the player rail uses. */
function moverHeadshot(sport: string, subjectId: string | null): string | null {
  if (!subjectId) return null;
  if (sport === 'mlb') return mlbHeadshot(subjectId);
  if (sport === 'nfl') return espnHeadshot('nfl', subjectId);
  if (sport === 'cfb') return espnHeadshot('college-football', subjectId);
  if (sport === 'nba') return espnHeadshot('nba', subjectId);
  if (sport === 'tennis') return espnHeadshot('tennis', subjectId);
  return null;
}

function columnsFor(kind: MoverKind, win: MoverWindow, maxMove: number, sport: string): Column<ConsensusMover>[] {
  return [
    {
      key: 'subject',
      label: kind === 'props' ? 'Player' : 'Game',
      sortable: false,
      render: (m) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5">
            {kind === 'props' && m.subjectId ? (
              <Avatar label={m.subjectName ?? m.subjectId} src={moverHeadshot(sport, m.subjectId) ?? undefined} size={24} decorative />
            ) : null}
            <span className="truncate text-ink">{kind === 'props' ? (m.subjectName ?? m.subjectId) : (m.matchup ?? m.gameId)}</span>
            {m.steam ? (
              <Chip size="sm" shape="box" title="At least three books moved the same way within 30 minutes.">
                Steam
              </Chip>
            ) : null}
            {m.split ? (
              <Chip size="sm" shape="box" title="The line moved one way and the price at the main line the other.">
                Split
              </Chip>
            ) : null}
          </span>
          <span className="truncate text-label text-ink-muted">
            {[kind === 'props' ? m.matchup : null, m.otherLinesMoved > 0 ? `also moved at ${m.otherLinesMoved} other line${m.otherLinesMoved === 1 ? '' : 's'}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      ),
    },
    {
      key: 'market',
      label: 'Market',
      sortable: false,
      render: (m) => (
        <span className="flex flex-col">
          <span className="text-ink">{marketLabel(m.market)}</span>
          <span className="text-label text-ink-muted">{sideLabel(m)}</span>
        </span>
      ),
    },
    {
      key: 'line',
      label: 'Line',
      numeric: true,
      sortable: false,
      info: 'The main line when we first saw it, and now: the line priced nearest even money across books.',
      render: lineText,
    },
    {
      key: 'price',
      label: 'Price',
      numeric: true,
      sortable: false,
      info: 'The consensus price at the main line, first seen and now: the median implied probability across at least three books, shown as American odds. The opening price is not held, so this starts from the first price we saw.',
      render: (m) => (
        <span className="whitespace-nowrap">
          {american(m.priceFirst)} <span className="text-ink-muted">→</span> {american(m.priceNow)}
        </span>
      ),
    },
    {
      key: 'move',
      label: 'Move',
      numeric: true,
      info: 'Implied-probability points, consensus, in the chosen window. Movement is market information, not a prediction.',
      sortValue: (m) => Math.abs(m.moves[win]),
      render: (m) => `${m.moves[win] > 0 ? '+' : ''}${m.moves[win].toFixed(1)}`,
      bar: (m) => (maxMove > 0 ? Math.abs(m.moves[win]) / maxMove : 0),
    },
    {
      key: 'books',
      label: 'Books',
      numeric: true,
      info: 'Books whose price moved, of the books quoting this line. Exchanges and pick’em apps are not counted.',
      sortValue: (m) => m.booksMoved,
      render: (m) => (
        <span>
          {m.booksMoved}
          <span className="text-ink-muted">/{m.booksQuoting}</span>
        </span>
      ),
    },
    { key: 'firstMove', label: 'First move', numeric: true, sortable: false, render: (m) => timeText(m.firstMoveAt) },
    {
      key: 'trend',
      label: 'Trend',
      sortable: false,
      align: 'right',
      render: (m) => <Sparkline values={m.trend} neutral label={`Consensus price, hourly: ${marketLabel(m.market)}`} className="ml-auto" />,
    },
  ];
}

export function SlateMovers({ data, loading, sport }: { data: SlateMoversData | null; loading: boolean; sport: string }) {
  const [kind, setKind] = useState<MoverKind>('props');
  const [win, setWin] = useState<MoverWindow>('first');

  const lists = useMemo(() => {
    const pick = (rows: ConsensusMover[]) =>
      rows.filter((m) => Math.abs(m.moves[win]) >= MIN_SHOWN_PTS).sort((a, b) => Math.abs(b.moves[win]) - Math.abs(a.moves[win]));
    return { lines: pick(data?.lines ?? []), props: pick(data?.props ?? []) };
  }, [data, win]);

  const total = (data?.lines.length ?? 0) + (data?.props.length ?? 0);
  if (!loading && total === 0) return null;

  // Open on whichever tab has something, props first.
  const active: MoverKind = lists[kind].length > 0 || lists[kind === 'props' ? 'lines' : 'props'].length === 0 ? kind : kind === 'props' ? 'lines' : 'props';
  const rows = lists[active];
  const maxMove = rows.reduce((m, r) => Math.max(m, Math.abs(r.moves[win])), 0);

  return (
    <section id="slate-movers" className="mb-6 scroll-mt-[150px]">
      <SectionBand title="Movers" />
      <Card
        title="How the market has moved"
        count={rows.length || undefined}
        scope={data ? `Pre-game · ${data.games} game${data.games === 1 ? '' : 's'} still to start` : undefined}
        flush
        state={loading && total === 0 ? { kind: 'loading', lines: 6 } : { kind: 'ready' }}
        caption="Movement is market information, not a prediction. The consensus of at least three books; exchanges and pick'em apps are left out."
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-1">
          <Tabs<MoverKind>
            label="Movers market"
            value={active}
            onChange={setKind}
            items={[
              { value: 'props', label: 'Props', count: lists.props.length },
              { value: 'lines', label: 'Game lines', count: lists.lines.length },
            ]}
          />
          <SegmentedToggle<MoverWindow> label="Movers window" size="sm" value={win} onChange={setWin} options={WINDOWS} />
        </div>
        {rows.length > 0 ? (
          <DataTable<ConsensusMover>
            caption={`Movers, ${active === 'props' ? 'props' : 'game lines'}`}
            columns={columnsFor(active, win, maxMove, sport)}
            rows={rows}
            rowKey={(m) => `${m.gameId}|${m.subjectId ?? ''}|${m.market}|${m.side}`}
            paging={{ mode: 'more', pageSize: 20 }}
          />
        ) : (
          <EmptyState title="Nothing has moved in this window" reason="No consensus move of 1.5 points or more on a game still to start." />
        )}
      </Card>
    </section>
  );
}

/** `league` is the soccer league or the tennis tour, whichever the sport has. */
export function useSlateMovers(sport: string, league: string | null, date: string | null, refreshKey?: string | null) {
  const [data, setData] = useState<SlateMoversData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ sport });
        if (league) {
          params.set('league', league);
          params.set('tour', league);
        }
        if (date) params.set('date', date);
        const res = await fetch(`/api/slate/movers?${params}`, { cache: 'no-store' });
        if (!cancelled) setData(res.ok ? ((await res.json()) as SlateMoversData) : null);
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
