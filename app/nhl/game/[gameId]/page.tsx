'use client';

import { useState } from 'react';
import { BackLink } from '@/components/ui';
import { useParams, useRouter } from 'next/navigation';
import type { PickCandidate } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import SlipModal from '@/components/SlipModal';
import { GameResearchPage } from '@/components/GameResearchPage';

/**
 * `/nhl/game/[gameId]` — the game page for any NHL game by NHL game id
 * (R8.4b, 2025021270): before puck drop, live, or final, on `GameResearchPage`.
 */
export default function NhlGameDetailPage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const sport = 'nhl' as const;
  const gameId = String(params?.gameId ?? '');

  const { snapshot, loading, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;
  const onAdd = (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => {
    void slip.addPick(candidate, eventContext, oddsInfo);
  };

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          leading={
            <BackLink href="/nhl" label="Slate" />
          }
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
      </header>

      <main className="mx-auto max-w-[1280px] px-3 py-3 [--lb-gutter:12px] md:px-6 md:[--lb-gutter:24px]">
        <GameResearchPage sport={sport} gameId={gameId} />
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
        onAdd={onAdd}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}
