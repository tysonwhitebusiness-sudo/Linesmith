'use client';

import { useMemo, useState } from 'react';
import { BackLink } from '@/components/ui';
import { useParams, useRouter } from 'next/navigation';
import type { PickCandidate } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { GamesStrip } from '@/components/GamesStrip';
import { TopBar } from '@/components/TopBar';
import type { MlbSlateGame } from '@/lib/sports/mlb/slateGameShapes';
import SlipModal from '@/components/SlipModal';
import { GameResearchPage } from '@/components/GameResearchPage';

/**
 * `/mlb/game/[gameId]` — the game page for any MLB game by pk (R8.1): before
 * the start, live, or final. The page is `GameResearchPage`, which reads the
 * game from `/api/game-research` rather than from today's slate, so a past
 * game resolves (R6-F6, B5). The games strip still shows today's slate.
 */
export default function GameDetailPage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const gameId = String(params?.gameId ?? '');
  const sport = 'mlb' as const;

  const { snapshot, loading, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  const games = useMemo(() => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as MlbSlateGame[], [snapshot]);
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
            <BackLink href="/mlb" label="Slate" />
          }
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
        <GamesStrip
          games={games}
          selectedGamePk={Number(gameId)}
          onSelectGame={(pk) => router.push(pk === null ? '/mlb' : `/mlb/game/${pk}`)}
          onNavigateToGame={(pk) => {
            if (String(pk) !== gameId) router.push(`/mlb/game/${pk}`);
          }}
        />
      </header>

      <main className="mx-auto max-w-[1280px] px-3 py-3 md:px-6">
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
