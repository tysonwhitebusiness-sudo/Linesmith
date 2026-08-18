'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { useGolfSchedule } from '@/components/useGolfSchedule';
import { useGolfLines } from '@/components/useGolfLines';
import { useGolfFieldStats } from '@/components/useGolfFieldStats';
import { TopBar } from '@/components/TopBar';
import SlipModal from '@/components/SlipModal';
import { GolfScheduleView } from '@/components/GolfScheduleView';
import { GolferStrip } from '@/components/GolferStrip';

/**
 * `/golf/schedule` — golf's Teams-tab equivalent. Golf has no team concept
 * (confirmed in docs/prompt-3-teams.md), so this is what the fourth tab
 * becomes instead: the season schedule, with an in-depth course overview
 * for whichever event is currently live.
 */
export default function GolfSchedulePage() {
  const router = useRouter();
  const sport = 'golf' as const;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const schedule = useGolfSchedule();
  const golfLines = useGolfLines(snapshot?.fetchedAt ?? null);
  const fieldStats = useGolfFieldStats(snapshot?.fetchedAt ?? null);
  const [slipOpen, setSlipOpen] = useState(false);
  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          tab="Schedule"
          onTabChange={(t) => router.push(t === 'Players' ? '/golf?tab=Players' : t === 'Schedule' ? '/golf/schedule' : '/golf')}
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
        <GolferStrip
          subjects={snapshot?.subjects ?? []}
          selectedPlayerId={null}
          onSelectPlayer={(id) => router.push(id === null ? '/golf' : `/golf/player/${id}`)}
          onNavigateToPlayer={(id) => router.push(`/golf/player/${id}`)}
        />
      </header>

      <main className="px-3 py-3">
        {error ? <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div> : null}
        <GolfScheduleView
          events={schedule.events}
          loading={schedule.loading}
          warnings={schedule.warnings}
          snapshot={snapshot}
          golfLines={golfLines.result?.lines ?? []}
          golfLinesLoading={golfLines.loading}
          golfLinesWarnings={golfLines.result?.warnings ?? []}
          fieldStats={fieldStats.result?.golfers ?? null}
          fieldStatsLoading={fieldStats.loading}
          onAdd={(c) => slip.addPick(c, eventContext)}
          addedKeys={slip.pickedKeys}
        />
      </main>

      <SlipModal
        sport={sport}
        picks={slip.picks}
        candidates={snapshot?.candidates ?? []}
        subjects={snapshot?.subjects ?? []}
        open={slipOpen}
        onClose={() => setSlipOpen(false)}
        onRemove={slip.removePick}
        onClear={slip.clearSlip}
        onSetOdds={slip.setOdds}
        onAdd={(c, odds) => slip.addPick(c, eventContext, odds)}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}
