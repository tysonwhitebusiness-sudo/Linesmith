'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { notFound } from 'next/navigation';
import type { PickCandidate, SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import SlipModal from '@/components/SlipModal';
import { TeamDetailPanel } from '@/components/TeamDetailPanel';

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

/** `/soccer/[league]/teams` — soccer's Teams tab landing page, same shell as `/nfl/teams`. */
export default function SoccerTeamsIndexPage() {
  const params = useParams<{ league: string }>();
  const router = useRouter();
  const league = params?.league ?? '';
  if (!isSoccerLeague(league)) notFound();
  const sport = 'soccer' as const;

  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  const onAdd = (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => {
    void slip.addPick(candidate, null, oddsInfo);
  };

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          league={league}
          onLeagueChange={(next) => router.push(`/soccer/${next}/teams`)}
          tab="Teams"
          onTabChange={(t) => router.push(t === 'Players' ? `/soccer/${league}?tab=Players` : `/soccer/${league}`)}
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={() => {}}
          loading={false}
          lastFetched={null}
        />
      </header>

      <main className="px-3 py-3">
        <TeamDetailPanel sport={sport} league={league} snapshot={null} onAdd={onAdd} addedKeys={slip.pickedKeys} />
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
