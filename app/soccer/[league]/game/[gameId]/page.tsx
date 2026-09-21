'use client';

import { useState } from 'react';
import { BackLink } from '@/components/ui';
import { useParams, useRouter } from 'next/navigation';
import type { PickCandidate, SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import SlipModal from '@/components/SlipModal';
import { GameResearchPage } from '@/components/GameResearchPage';

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

/**
 * `/soccer/[league]/game/[gameId]` — the game page for any EPL or MLS match by
 * ESPN event id (R8.3a): before kickoff, live, or final, on `GameResearchPage`.
 * The research route names the league as its sport (`soccer_epl`, `soccer_mls`),
 * the way `player_game_history` spells it.
 */
export default function SoccerGameDetailPage() {
  const params = useParams<{ league: string; gameId: string }>();
  const league = params?.league ?? '';
  if (!isSoccerLeague(league)) {
    return <div className="lb-card m-3 p-6 text-center text-sm text-ink-muted">Unknown league.</div>;
  }
  return <SoccerGamePage league={league} gameId={String(params?.gameId ?? '')} />;
}

function SoccerGamePage({ league, gameId }: { league: SoccerLeague; gameId: string }) {
  const router = useRouter();
  const sport = 'soccer' as const;
  const { snapshot, loading, lastFetched, refresh } = useSnapshot(sport, undefined, league);
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
          league={league}
          onLeagueChange={(next) => router.push(`/soccer/${next}`)}
          leading={
            <BackLink href={`/soccer/${league}`} label="Slate" />
          }
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
      </header>

      <main className="mx-auto max-w-[1280px] px-3 py-3 [--lb-gutter:12px] md:px-6 md:[--lb-gutter:24px]">
        <GameResearchPage sport={league === 'mls' ? 'soccer_mls' : 'soccer_epl'} gameId={gameId} />
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
