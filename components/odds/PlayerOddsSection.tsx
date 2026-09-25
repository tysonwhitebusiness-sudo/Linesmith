'use client';

import { useMemo, useState } from 'react';
import { Button, Card, SegmentedToggle, Tabs } from '../ui';
import { BestPrice } from './BestPrice';
import { Coverage } from './Coverage';
import { Depth } from './Depth';
import { GameLineCompact, type TeamsRef } from './GameLineCompact';
import { Ladder } from './Ladder';
import { LineMovement } from './LineMovement';
import { OpenNow } from './OpenNow';
import { PriceBoard } from './PriceBoard';
import { SharpPrices } from './SharpPrices';
import { usePlayerOdds } from './useOdds';
import { bestPrice, boardRows, consensusLine, pricedLines } from '@/lib/odds/section/board';
import { freshness } from '@/lib/odds/section/freshness';
import { fmtAgo, fmtAmerican, fmtClock, fmtLine, secondsSince } from '@/lib/odds/section/format';
import { pinnacleAt, pinnacleMain } from '@/lib/odds/section/sharp';
import { marketSpec, type OddsMarket } from '@/lib/odds/section/types';
import { bookLabel } from '@/lib/odds/books/registry';

/**
 * The player page's "Odds & prices" (odds build P8, O2) — the approved
 * mockup's player surface, in its order: market tabs · line stepper · Sharp
 * prices · Best price (the Edge slot stays empty until P11) · Every book (This
 * line / All lines) · Line movement (Where the money is joins in P10) ·
 * Opening → now + Depth · Coverage · Game line. Sport-agnostic: every number
 * comes from `/api/odds/player` through `lib/odds/section/*`.
 */
export function PlayerOddsSection({ sport, gameId, subjectId, teams, userBook, marketLabel, activeMarketKey, onPickMarket }: {
  sport: string;
  gameId: string | null;
  subjectId: string | null;
  teams: TeamsRef | null;
  userBook?: string | null;
  marketLabel: (key: string) => string;
  /** The prop block's market, when it has one: the section opens on it. */
  activeMarketKey?: string | null;
  onPickMarket?: ((key: string) => void) | null;
}) {
  const odds = usePlayerOdds(sport, gameId, subjectId);
  const now = odds.data ? Date.parse(odds.data.asOf) : Date.now();
  const spec = marketSpec('prop');
  const markets = useMemo(() => (odds.data?.markets ?? [])
    .filter(m => new Set(m.cur.map(q => q.book)).size >= 1)
    .sort((a, b) => new Set(b.cur.map(q => q.book)).size - new Set(a.cur.map(q => q.book)).size), [odds.data]);
  const [picked, setPicked] = useState<string | null>(null);
  const key = picked ?? (activeMarketKey && markets.some(m => m.key === activeMarketKey) ? activeMarketKey : markets[0]?.key ?? null);
  const market = markets.find(m => m.key === key) ?? null;
  const [lineByMarket, setLineByMarket] = useState<Record<string, number>>({});
  const [all, setAll] = useState<'line' | 'all'>('line');

  if (odds.loading && !odds.data) return <Card title="Odds & prices" state={{ kind: 'loading', lines: 6 }} />;
  if (!market) {
    return (
      <>
        <Card title="Odds & prices" state={{ kind: 'empty', title: 'No prices posted', reason: odds.error ? 'The odds could not be read just now.' : 'No book has priced a market for this player yet.' }} />
        {gameId && teams ? <GameLineCompact sport={sport} gameId={gameId} teams={teams} /> : null}
      </>
    );
  }
  const modal = consensusLine(market, spec).modal;
  const span = market.key === 'anytime-td' ? 0 : Math.max(4, Math.abs(modal ?? 0) * 0.2);
  const lines = pricedLines(market, spec, span);
  const def = pinnacleMain(market, spec) ?? modal;
  const L = lineByMarket[market.key] != null && lines.includes(lineByMarket[market.key]) ? lineByMarket[market.key] : def;
  const li = L == null ? -1 : lines.indexOf(L);
  const setL = (v: number) => setLineByMarket(s => ({ ...s, [market.key]: v }));
  const rows = boardRows(market, spec, L, userBook);
  const fr = freshness(market, rows, now);
  const labels: [string, string] = [`Over ${fmtLine(L)}`, `Under ${fmtLine(L)}`];
  const tab = (m: OddsMarket) => {
    const ml = consensusLine(m, spec).modal;
    const rr = boardRows(m, spec, ml, userBook);
    const b0 = bestPrice(rr, 0), b1 = bestPrice(rr, 1);
    const pin = pinnacleAt(m, spec, ml) ?? pinnacleAt(m, spec, pinnacleMain(m, spec));
    return {
      value: m.key,
      label: (
        <span className="block min-w-36">
          <span className="block text-body-sm font-semibold text-ink">{marketLabel(m.key)}</span>
          <span className="block text-label text-ink-secondary tabular-nums">{fmtLine(ml)} · O {fmtAmerican(b0?.quote.price)} / U {fmtAmerican(b1?.quote.price)}</span>
          <span className="block text-label text-ink-muted">{new Set(m.cur.map(q => q.book)).size} books · {pin ? `Pin ${fmtAmerican(pin.a.price)}/${fmtAmerican(pin.b.price)}` : 'no sharp'}</span>
        </span>
      ),
    };
  };
  return (
    <div className="space-y-3">
      <p className="text-label text-ink-muted">
        {fr.changes30m} changes in 30 min · {fr.books} books · newest check {fmtAgo(secondsSince(fr.newestCheckAt, now))} ago
        {fr.oldestUnchanged ? ` · oldest unchanged price ${bookLabel(fr.oldestUnchanged.book)} since ${fmtClock(fr.oldestUnchanged.since, now)}` : ''}
        {fr.pulled.length ? <span className="text-bad-ink"> · {fr.pulled.length} pulled</span> : null}
      </p>
      <Tabs variant="cards" label="Markets" value={market.key} items={markets.slice(0, 8).map(tab)}
        onChange={k => { setPicked(k); onPickMarket?.(k); }} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label font-semibold">Line</span>
        <Button size="sm" variant="secondary" aria-label="Lower line" isDisabled={li <= 0} onPress={() => setL(lines[li - 1])}>◀</Button>
        <b className="min-w-12 text-center tabular-nums">{market.key === 'anytime-td' ? 'Yes' : fmtLine(L)}</b>
        <Button size="sm" variant="secondary" aria-label="Higher line" isDisabled={li < 0 || li >= lines.length - 1} onPress={() => setL(lines[li + 1])}>▶</Button>
        <span className="text-label text-ink-muted">{lines.length} lines priced · consensus {fmtLine(modal)} · Pinnacle {fmtLine(pinnacleMain(market, spec)) || '—'}</span>
      </div>
      <SharpPrices market={market} spec={spec} line={L} sideLabels={labels} now={now} onGoToLine={setL} />
      <BestPrice rows={rows} spec={spec} line={L} sideLabels={labels} userBook={userBook} now={now} />
      <Card title="Every book" scope={`at ${fmtLine(L)}`} flush
        info="Every book's price at the line in view; a book not at this line shows its own, greyed. Filled = best. Checked = when a source last confirmed the price; since = when it last changed.">
        <div className="px-3 pt-2">
          <SegmentedToggle label="Board view" size="sm" value={all} onChange={setAll}
            options={[{ value: 'line', label: 'This line' }, { value: 'all', label: 'All lines' }]} />
        </div>
        {all === 'all'
          ? <Ladder market={market} spec={spec} span={span || 8} line={L} sideLabels={labels} />
          : <PriceBoard market={market} spec={spec} line={L} rows={rows} sideLabels={labels} userBook={userBook} latency={odds.data?.latency ?? []} now={now} />}
      </Card>
      <LineMovement market={market} spec={spec} sideLabels={labels} userBook={userBook} now={now} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <OpenNow market={market} spec={spec} now={now} />
        <Depth market={market} spec={spec} line={L} now={now} />
      </div>
      <Coverage markets={markets} marketLabel={marketLabel} />
      {gameId && teams ? <GameLineCompact sport={sport} gameId={gameId} teams={teams} /> : null}
    </div>
  );
}
