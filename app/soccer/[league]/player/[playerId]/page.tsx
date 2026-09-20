'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams, notFound } from 'next/navigation';
import type { SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import { PlayerDetail } from '@/components/PlayerDetail';
import { Button, ErrorState } from '@/components/ui';
import { sameSubject } from '@/lib/sports/shared/playerResearchShapes';
import SlipModal from '@/components/SlipModal';
import { useSyntheticPlayerCandidates } from '@/components/useSyntheticPlayerCandidates';
import { usePickHistoryModelData, needsModelDataMerge, mergeModelData } from '@/components/usePickHistoryModelData';

function isSoccerLeague(v: string): v is SoccerLeague {
  return (SOCCER_LEAGUES as string[]).includes(v);
}

/** Soccer's version of the MLB/NFL player-detail page — same shape, `/soccer/[league]` routes. */
export default function SoccerPlayerDetailPage() {
  const params = useParams<{ league: string; playerId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const league = params?.league ?? '';
  if (!isSoccerLeague(league)) notFound();
  const sport = 'soccer' as const;

  // Same decode-on-read requirement as NFL's page — subjectIds contain colons.
  const playerId = decodeURIComponent(String(params?.playerId ?? ''));
  const market = search.get('market') ?? undefined;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport, undefined, league);
  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  // PlayerDetail Score/Edge fix (Phase 1 of docs/scan-playerdetail-parity-
  // gameplan-2026-08-27.md) — same real merge Scan's AppShell.tsx uses,
  // applied here since this page fetches its own candidate list
  // independently rather than sharing AppShell's.
  const shouldMergeModelData = needsModelDataMerge(sport);
  const modelData = usePickHistoryModelData(sport, snapshot?.fetchedAt ?? null, shouldMergeModelData);

  const mine = useMemo(() => {
    const all = (snapshot?.candidates ?? []).filter((c) => sameSubject(c.subjectId, playerId));
    return shouldMergeModelData ? mergeModelData(all, modelData.rowsByKey) : all;
  }, [snapshot, playerId, shouldMergeModelData, modelData.rowsByKey]);

  // Real identity carried via the roster link's own query params (see
  // teamDetailAdapter.ts) — every real roster player is real, not every
  // one has an active tracked market right now. 2026-08-24: this used to
  // carry zero query params, so a player with no active prop showed
  // nothing at all, not even a name — now matches CFB's/NBA's fallback.
  const identity = {
    name: search.get('name'),
    team: search.get('team'),
    teamName: search.get('teamName'),
    teamLogoUrl: search.get('teamLogoUrl'),
    pos: search.get('pos'),
    headshot: search.get('headshot'),
  };
  const hasIdentity = Boolean(identity.name);

  const synthetic = useSyntheticPlayerCandidates({
    sport,
    subjectId: playerId,
    team: identity.team ?? undefined,
    position: identity.pos ?? undefined,
    name: identity.name ?? undefined,
    headshotUrl: identity.headshot ?? undefined,
    teamLogoUrl: identity.teamLogoUrl ?? undefined,
    league,
    enabled: mine.length === 0 && hasIdentity,
  });
  const effectiveCandidates = mine.length > 0 ? mine : synthetic.candidates;
  const waitingOnSynthetic = mine.length === 0 && hasIdentity && synthetic.loading;

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          league={league}
          onLeagueChange={(next) => router.push(`/soccer/${next}`)}
          leading={
            <Button variant="link" size="sm" onPress={() => router.back()} className="min-h-[44px] px-2">
              <span aria-hidden>←</span> Back
            </Button>
          }
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
      </header>

      <main className="px-3 py-3">
        {error ? (
          // R3: human text and a retry, never the raw error string (D5).
          <ErrorState className="mb-3" message="We couldn't refresh today's markets for this player." onRetry={refresh} />
        ) : null}
        {/* R6.1a: the player is the page. It renders with or without a market;
            the prop block is one section of it and says why it is empty. */}
        <PlayerDetail
          candidates={effectiveCandidates}
          snapshot={snapshot}
          odds={null}
          market={market}
          onMarketChange={(next) =>
            router.replace(`/soccer/${league}/player/${encodeURIComponent(playerId)}?market=${encodeURIComponent(next)}`)
          }
          onAdd={(candidate, oddsInfo) => slip.addPick(candidate, null, oddsInfo)}
          addedKeys={slip.pickedKeys}
          subject={{ sport, id: playerId, league: league, name: identity.name ?? mine[0]?.subjectName ?? null }}
          marketsLoading={(loading && mine.length === 0) || waitingOnSynthetic}
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
        onAdd={(c, oddsInfo) => slip.addPick(c, null, oddsInfo)}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}
