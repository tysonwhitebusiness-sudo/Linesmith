'use client';

import { BestPrice } from '@/components/odds/BestPrice';
import { Coverage } from '@/components/odds/Coverage';
import { Depth } from '@/components/odds/Depth';
import { EdgeCard } from '@/components/odds/EdgeCard';
import { ScanEdgeCell } from '@/components/odds/ScanEdgeCell';
import { SlateEdges } from '@/components/odds/SlateEdges';
import { SlateEvCard } from '@/components/odds/SlateEvCard';
import { SlipLegPrice } from '@/components/odds/SlipLegPrice';
import { slipBest } from '@/lib/odds/slipBest';
import { GameLineCompact } from '@/components/odds/GameLineCompact';
import { GameFinalOddsSection } from '@/components/odds/GameFinalOddsSection';
import { GameOddsSection } from '@/components/odds/GameOddsSection';
import { Ladder } from '@/components/odds/Ladder';
import { LineMovement } from '@/components/odds/LineMovement';
import { MoneyCard } from '@/components/odds/MoneyCard';
import { OpenNow } from '@/components/odds/OpenNow';
import { PlayerOddsSection } from '@/components/odds/PlayerOddsSection';
import { PriceBoard } from '@/components/odds/PriceBoard';
import { SharpPrices } from '@/components/odds/SharpPrices';
import { SlateGameOdds } from '@/components/odds/SlateGameOdds';
import { SlateOddsHub } from '@/components/odds/SlateOddsHub';
import { SlateOddsMovers } from '@/components/odds/SlateOddsMovers';
import { TeamOddsSection } from '@/components/odds/TeamOddsSection';
import { Heartbeat, LiveHeader } from '@/components/odds/LiveHeader';
import { LiveProvider, STILL } from '@/components/odds/live';
import { Card, DataTable, FlashValue, LiveDot } from '@/components/ui';
import { boardRows } from '@/lib/odds/section/board';
import { fmtAmerican } from '@/lib/odds/section/format';
import { KIT_NOW, kitEdgeRanking, kitEdgeView, kitEdges, kitOneBookMarket, kitPropMarket, kitSlateGames } from '@/lib/odds/section/kitFixture';
import { marketSpec } from '@/lib/odds/section/types';

/**
 * The odds section's components (odds build P8, O1) in every state, on a
 * synthetic market (`lib/odds/section/kitFixture.ts`): many books, one book,
 * no sharp price, a pulled row, an outlier row and crossed best prices
 * (negative hold). `tests/odds-ui.test.ts` checks every `components/odds/*.tsx`
 * is rendered here.
 */
export function KitOdds() {
  const m = kitPropMarket(), one = kitOneBookMarket(), sp = marketSpec('prop');
  const labels: [string, string] = ['Over 65.5', 'Under 65.5'];
  const rows = boardRows(m, sp, 65.5, 'fanduel');
  const at = (minAgo: number) => new Date(KIT_NOW - minAgo * 60e3).toISOString();
  const label = (k: string) => k.replace(/-/g, ' ');
  return (
    <section id="odds" className="mt-12">
      <h2 className="text-heading text-ink">Odds section (P8)</h2>
      <p className="mt-1 text-body-sm text-ink-muted">Synthetic market: 9 books at 65.5, BetRivers pulled, bet365 +900 an outlier, Polymarket +108 crossing the best under.</p>
      <div className="mt-4 space-y-4">
        <Card title="LiveDot and FlashValue">
          <div className="flex flex-wrap items-center gap-6">
            <LiveDot checkedAt={at(1)} cadenceS={70} now={KIT_NOW} />
            <LiveDot checkedAt={at(5)} cadenceS={70} now={KIT_NOW} />
            <LiveDot checkedAt={at(30)} cadenceS={70} now={KIT_NOW} />
            <FlashValue value={-110} format={fmtAmerican} />
            <FlashValue value={108} format={fmtAmerican} best />
          </div>
        </Card>
        <MoneyCard now={KIT_NOW} view={{ kind: 'game', sport: 'nfl', marketKey: 'fg_ml', teams: { home: { abbr: 'GB' }, away: { abbr: 'ATL' } } }} money={{
          splits: [
            { at: at(4), source: 'dknetwork', kind: 'bets_money', book: 'draftkings', market: 'ml', side: 'home', line: null, pctBets: 83, pctMoney: 68, count: null, countTotal: null },
            { at: at(4), source: 'dknetwork', kind: 'bets_money', book: 'draftkings', market: 'ml', side: 'away', line: null, pctBets: 17, pctMoney: 32, count: null, countTotal: null },
            { at: at(9), source: 'vsin', kind: 'bets_money', book: 'circa', market: 'ml', side: 'home', line: null, pctBets: 55, pctMoney: 60, count: null, countTotal: null },
            { at: at(9), source: 'vsin', kind: 'bets_money', book: 'circa', market: 'ml', side: 'away', line: null, pctBets: 45, pctMoney: 40, count: null, countTotal: null },
            { at: at(6), source: 'actionnetwork', kind: 'bet_count', book: 'actionnetwork', market: 'game', side: '', line: null, pctBets: null, pctMoney: null, count: 96910, countTotal: null },
          ],
          splitHist: { 'dknetwork|draftkings|ml': [[at(480), null, 85, 79], [at(240), null, 84, 74], [at(60), null, 83, 70], [at(4), null, 83, 68]] },
          exchanges: [{ exchange: 'kalshi', market: 'ml', side: 'home', point: null, bestBid: 0.69, bestAsk: 0.7, volume24h: 578370, openInterest: 923486, liquidity: null, at: at(2) }],
        }} />
        <MoneyCard now={KIT_NOW} view={{ kind: 'prop', marketKey: 'receptions', line: 5.5 }} money={{
          splits: [
            { at: at(12), source: 'sleeper', kind: 'pick_counts', book: 'sleeper', market: 'receptions', side: 'over', line: 5.5, pctBets: null, pctMoney: null, count: 1598, countTotal: 1757 },
            { at: at(12), source: 'sleeper', kind: 'pick_counts', book: 'sleeper', market: 'receptions', side: 'under', line: 5.5, pctBets: null, pctMoney: null, count: 159, countTotal: 1757 },
          ],
          splitHist: {},
          exchanges: [{ exchange: 'kalshi', market: 'receptions', side: 'over', point: 5.5, bestBid: 0.44, bestAsk: 0.46, volume24h: 2210, openInterest: 6400, liquidity: null, at: at(3) }],
        }} />
        <Card title="Live layer (P9)" scope="frozen at a moment after each change">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-6">
              <LiveDot checkedAt={at(1)} cadenceS={70} now={KIT_NOW} pingAt={KIT_NOW} />
              <FlashValue value={-105} format={fmtAmerican} change={{ dir: 'up', seenAt: KIT_NOW - 12e3 }} now={KIT_NOW} />
              <FlashValue value={-118} format={fmtAmerican} change={{ dir: 'down', seenAt: KIT_NOW - 90e3 }} now={KIT_NOW} />
              <FlashValue value={-110} format={fmtAmerican} change={{ dir: 'up', seenAt: KIT_NOW - 0.4e3 }} now={KIT_NOW} />
              <Heartbeat beats={Array.from({ length: 30 }, (_, i) => (i * 7) % 5)} />
            </div>
            <LiveProvider value={{ ...STILL, sinceOpened: { changed: 7, pulled: 1 } }}>
              <LiveHeader beats={Array.from({ length: 30 }, (_, i) => (i % 4 === 0 ? 2 : 0))}><span>· 9 books</span></LiveHeader>
            </LiveProvider>
            <DataTable<{ book: string; st: 'pulled' | 'returned' | 'new' | null; at: number | null }>
              caption="Row states"
              density="compact"
              rows={[{ book: 'BetRivers', st: 'pulled', at: KIT_NOW - 14e3 }, { book: 'Caesars', st: 'returned', at: KIT_NOW - 30e3 },
                { book: 'Fanatics', st: 'new', at: KIT_NOW - 5e3 }, { book: 'DraftKings', st: null, at: null }]}
              rowKey={r => r.book}
              rowState={r => r.st}
              rowStateAt={r => r.at}
              columns={[{ key: 'book', label: 'Book', sortable: false }, { key: 'p', label: 'Over', numeric: true, sortable: false, render: () => '−110' }]}
            />
          </div>
        </Card>
        <SharpPrices market={m} spec={sp} line={65.5} sideLabels={labels} now={KIT_NOW} />
        <SharpPrices market={m} spec={sp} line={69.5} sideLabels={['Over 69.5', 'Under 69.5']} now={KIT_NOW} onGoToLine={() => undefined} />
        <BestPrice rows={rows} spec={sp} line={65.5} sideLabels={labels} userBook="fanduel" now={KIT_NOW} />
        <BestPrice rows={boardRows(one, sp, 5.5)} spec={sp} line={5.5} sideLabels={['Over 5.5', 'Under 5.5']} now={KIT_NOW} />
        {/* P11: the Edge card — passing (the mockup's London edge), the honest empty state, and no sharp at this line. */}
        <EdgeCard edges={kitEdges()} marketKey="receiving-yards" spec={sp} line={65.5} sideLabels={labels} sharpAtLine sharpMainLine={65.5} now={KIT_NOW} />
        <EdgeCard edges={[]} marketKey="receiving-yards" spec={sp} line={65.5} sideLabels={labels} sharpAtLine sharpMainLine={65.5} now={KIT_NOW} />
        <EdgeCard edges={[]} view={kitEdgeView('on')} marketKey="receiving-yards" spec={sp} line={65.5} sideLabels={labels} sharpAtLine sharpMainLine={65.5} now={KIT_NOW} />
        <EdgeCard edges={undefined} view={kitEdgeView('paused')} marketKey="receiving-yards" spec={sp} line={65.5} sideLabels={labels} sharpAtLine sharpMainLine={65.5} now={KIT_NOW} />
        <EdgeCard edges={undefined} view={kitEdgeView('off')} marketKey="receiving-yards" spec={sp} line={65.5} sideLabels={labels} sharpAtLine sharpMainLine={65.5} now={KIT_NOW} />
        <EdgeCard edges={[]} marketKey="receiving-yards" spec={sp} line={69.5} sideLabels={['Over 69.5', 'Under 69.5']} sharpAtLine={false} sharpMainLine={65.5} onGoToLine={() => undefined} now={KIT_NOW} />
        <Card title="Scan edge cell" scope="P11">
          <div className="flex gap-6 text-label"><ScanEdgeCell edge={{ book: 'underdog', side: 'over', price: 110, ev: 0.016 }} /><ScanEdgeCell edge={null} /></div>
        </Card>
        <Card title="Slip leg · best right now" scope="P12">
          <SlipLegPrice check={slipBest(m, 'over', 65.5, 'fanduel')} link="https://example.com/event" now={KIT_NOW} />
          <SlipLegPrice check={slipBest(m, 'over', 65.5, 'fanduel')} link={null} now={KIT_NOW} />
          <SlipLegPrice check={slipBest(m, 'over', 99.5, 'fanduel')} link={null} now={KIT_NOW} />
        </Card>
        <Card title="Market hub · Edges" flush>
          <SlateEdges edges={kitEdges()} refs={new Map([['kit-2', { label: 'ATL @ GB', href: null, home: 'GB' }]])} />
          <SlateEdges edges={[]} refs={new Map()} />
          <SlateEvCard ranking={kitEdgeRanking()} refs={new Map([['kit-1', { label: 'CHC @ BOS', teams: { away: { abbr: 'CHC', logoUrl: 'https://www.mlbstatic.com/team-logos/112.svg' }, home: { abbr: 'BOS', logoUrl: 'https://www.mlbstatic.com/team-logos/111.svg' } } }], ['kit-2', { label: 'ATL @ GB', teams: { away: { abbr: 'ATL' }, home: { abbr: 'GB' } } }]])} sport="mlb" nameOf={() => 'Tarik Skubal'} />
          <SlateEvCard ranking={{ status: 'stale', reason: 'The edge check last ran 22 min ago.' }} refs={new Map()} sport="mlb" />
        </Card>
        <Card title="Every book" scope="at 65.5" flush>
          <PriceBoard market={m} spec={sp} line={65.5} rows={rows} sideLabels={labels} userBook="fanduel" latency={[]} now={KIT_NOW} />
        </Card>
        <Card title="All lines" flush>
          <Ladder market={m} spec={sp} span={8} line={65.5} sideLabels={labels} />
        </Card>
        <LineMovement market={m} spec={sp} sideLabels={labels} userBook="fanduel" now={KIT_NOW} />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <OpenNow market={m} spec={sp} now={KIT_NOW} />
          <Depth market={m} spec={sp} line={65.5} now={KIT_NOW} />
        </div>
        <Coverage markets={[m, one]} marketLabel={label} />
        <GameLineCompact sport="mlb" gameId="kit-no-such-game" teams={{ home: { abbr: 'BOS' }, away: { abbr: 'CHC' } }} />
        <GameOddsSection sport="mlb" gameId="kit-no-such-game" teams={{ home: { abbr: 'BOS' }, away: { abbr: 'CHC' } }} />
        <GameFinalOddsSection sport="mlb" gameId="kit-no-such-game" teams={{ home: { abbr: 'BOS' }, away: { abbr: 'CHC' } }} start="2026-09-23T22:35:00Z" score={{ home: 4, away: 2 }} />
        <TeamOddsSection sport="mlb" gameId="kit-no-such-game" teams={{ home: { abbr: 'BOS' }, away: { abbr: 'CHC' } }} side="home" past={[]} />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {kitSlateGames().map(g => (
            <div key={g.gameId} className="overflow-hidden rounded-card border border-line-soft bg-card shadow-card">
              <SlateGameOdds odds={g} away="CHC" home="BOS" colors={['var(--color-cmp-a)', 'var(--color-cmp-b)']} now={KIT_NOW} />
            </div>
          ))}
        </div>
        <SlateOddsMovers games={kitSlateGames()} refs={new Map([['kit-1', { label: 'CHC @ BOS' }], ['kit-2', { label: 'ATL @ GB' }]])} now={KIT_NOW} />
        <SlateOddsHub games={kitSlateGames()} refs={new Map([['kit-1', { label: 'CHC @ BOS' }], ['kit-2', { label: 'ATL @ GB' }]])} edges={kitEdges()} />
        <PlayerOddsSection sport="mlb" gameId={null} subjectId={null} teams={null} marketLabel={label} />
      </div>
    </section>
  );
}
