'use client';

import { BestPrice } from '@/components/odds/BestPrice';
import { Coverage } from '@/components/odds/Coverage';
import { Depth } from '@/components/odds/Depth';
import { GameLineCompact } from '@/components/odds/GameLineCompact';
import { GameFinalOddsSection } from '@/components/odds/GameFinalOddsSection';
import { GameOddsSection } from '@/components/odds/GameOddsSection';
import { Ladder } from '@/components/odds/Ladder';
import { LineMovement } from '@/components/odds/LineMovement';
import { OpenNow } from '@/components/odds/OpenNow';
import { PlayerOddsSection } from '@/components/odds/PlayerOddsSection';
import { PriceBoard } from '@/components/odds/PriceBoard';
import { SharpPrices } from '@/components/odds/SharpPrices';
import { TeamOddsSection } from '@/components/odds/TeamOddsSection';
import { Card, FlashValue, LiveDot } from '@/components/ui';
import { boardRows } from '@/lib/odds/section/board';
import { fmtAmerican } from '@/lib/odds/section/format';
import { KIT_NOW, kitOneBookMarket, kitPropMarket } from '@/lib/odds/section/kitFixture';
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
        <SharpPrices market={m} spec={sp} line={65.5} sideLabels={labels} now={KIT_NOW} />
        <SharpPrices market={m} spec={sp} line={69.5} sideLabels={['Over 69.5', 'Under 69.5']} now={KIT_NOW} onGoToLine={() => undefined} />
        <BestPrice rows={rows} spec={sp} line={65.5} sideLabels={labels} userBook="fanduel" now={KIT_NOW} />
        <BestPrice rows={boardRows(one, sp, 5.5)} spec={sp} line={5.5} sideLabels={['Over 5.5', 'Under 5.5']} now={KIT_NOW} />
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
        <PlayerOddsSection sport="mlb" gameId={null} subjectId={null} teams={null} marketLabel={label} />
      </div>
    </section>
  );
}
