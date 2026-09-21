'use client';

import { useState } from 'react';
import { BackLink } from '@/components/ui';
import { useParams, useRouter } from 'next/navigation';
import type { PickCandidate, TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import SlipModal from '@/components/SlipModal';
import { GameResearchPage } from '@/components/GameResearchPage';

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

/**
 * `/tennis/[tour]/game/[gameId]` — the match page for any ATP or WTA singles
 * match by ESPN competition id (R8.3b): before the first serve, live, or final,
 * on `GameResearchPage`. The research route names the tour as its sport
 * (`tennis_atp`, `tennis_wta`), the way `player_game_history` spells it.
 */
export default function TennisGameDetailPage() {
  const params = useParams<{ tour: string; gameId: string }>();
  const tour = params?.tour ?? '';
  if (!isTennisTour(tour)) {
    return <div className="lb-card m-3 p-6 text-center text-sm text-ink-muted">Unknown tour.</div>;
  }
  return <TennisMatchPage tour={tour} gameId={String(params?.gameId ?? '')} />;
}

function TennisMatchPage({ tour, gameId }: { tour: TennisTour; gameId: string }) {
  const router = useRouter();
  const sport = 'tennis' as const;
  const { snapshot, loading, lastFetched, refresh } = useSnapshot(sport, undefined, tour);
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
          league={tour}
          onLeagueChange={(next) => router.push(`/tennis/${next}`)}
          leading={
            <BackLink href={`/tennis/${tour}`} label="Slate" />
          }
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
      </header>

      <main className="mx-auto max-w-[1280px] px-3 py-3 [--lb-gutter:12px] md:px-6 md:[--lb-gutter:24px]">
        <GameResearchPage sport={tour === 'wta' ? 'tennis_wta' : 'tennis_atp'} gameId={gameId} />
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
