'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { PickCandidate } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { useGameLines } from '@/components/useGameLines';
import { GamesStrip } from '@/components/GamesStrip';
import { TopBar } from '@/components/TopBar';
import SlipModal from '@/components/SlipModal';
import { TeamDetailPanel } from '@/components/TeamDetailPanel';
import type { GameDetailGame } from '@/components/GameDetail';

/**
 * `/mlb/team/[teamId]` — a thin wrapper: chrome (TopBar, GamesStrip, slip)
 * plus `TeamDetailPanel`, which is where the actual page lives (searchable
 * team list + the PlayerDetail-equivalent detail pane). The URL param only
 * decides which team opens first; switching teams after that is client-side.
 */
export default function TeamPage() {
  const params = useParams<{ teamId: string }>();
  const router = useRouter();
  const teamId = Number(params?.teamId);
  const sport = 'mlb' as const;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const odds = useGameLines(sport, snapshot?.fetchedAt ?? null);
  const [slipOpen, setSlipOpen] = useState(false);

  const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as GameDetailGame[];

  const onAdd = (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => {
    const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;
    void slip.addPick(candidate, eventContext, oddsInfo);
  };

  if (!Number.isFinite(teamId) || teamId <= 0) {
    return <div className="lb-card m-4 p-6 text-center text-sm text-ink-muted">Invalid team.</div>;
  }

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          tab="Teams"
          onTabChange={(t) => router.push(t === 'Players' ? '/mlb?tab=Players' : '/mlb')}
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
        <GamesStrip
          games={games}
          selectedGamePk={null}
          onSelectGame={(pk) => router.push(pk === null ? '/mlb' : `/mlb/game/${pk}`)}
          onNavigateToGame={(pk) => router.push(`/mlb/game/${pk}`)}
        />
      </header>

      <main className="px-3 py-3">
        {error ? <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div> : null}
        <TeamDetailPanel initialTeamId={teamId} snapshot={snapshot} odds={odds.result} onAdd={onAdd} addedKeys={slip.pickedKeys} />
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
