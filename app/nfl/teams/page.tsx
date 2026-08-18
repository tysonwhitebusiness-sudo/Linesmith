'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PickCandidate } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import SlipModal from '@/components/SlipModal';
import { TeamDetailPanel } from '@/components/TeamDetailPanel';

/** `/nfl/teams` — NFL's Teams tab landing page, same shell as `/mlb/teams`. */
export default function NflTeamsIndexPage() {
  const router = useRouter();
  const sport = 'nfl' as const;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  const onAdd = (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => {
    const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;
    void slip.addPick(candidate, eventContext, oddsInfo);
  };

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          tab="Teams"
          onTabChange={(t) => router.push(t === 'Players' ? '/nfl?tab=Players' : '/nfl')}
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
      </header>

      <main className="px-3 py-3">
        {error ? <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div> : null}
        <TeamDetailPanel sport={sport} snapshot={snapshot} onAdd={onAdd} addedKeys={slip.pickedKeys} />
      </main>

      <SlipModal
        sport={sport}
        picks={slip.picks}
        candidates={[]}
        subjects={[]}
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
