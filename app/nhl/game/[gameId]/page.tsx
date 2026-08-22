'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { PickCandidate } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import { GameDetail } from '@/components/GameDetail';
import SlipModal from '@/components/SlipModal';
import { BrandedLoader } from '@/components/BrandedLoader';

/** `/nhl/game/[gameId]` — the NHL equivalent of `/cfb/game/[gameId]`/`/nba/game/[gameId]`. */
export default function NhlGameDetailPage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const sport = 'nhl' as const;
  const gameId = String(params?.gameId ?? '');

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [gameId]);

  const selectedPlayerId = search.get('player') ?? undefined;
  const selectedMarket = search.get('market') ?? undefined;

  const onSelectCandidate = (subjectId: string | null, dimension?: string) => {
    const qs = new URLSearchParams();
    if (subjectId) {
      qs.set('player', subjectId);
      if (dimension) qs.set('market', dimension);
    }
    const suffix = qs.toString();
    router.replace(`/nhl/game/${gameId}${suffix ? `?${suffix}` : ''}`);
  };

  const gameCandidates = useMemo(() => {
    const all = snapshot?.candidates ?? [];
    return all.filter((c) => String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk) === gameId);
  }, [snapshot, gameId]);

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
            <button
              type="button"
              onClick={() => router.push('/nhl')}
              className="whitespace-nowrap px-2 py-3 text-[13px] font-medium text-masters"
            >
              ← Scan
            </button>
          }
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
      </header>

      <main className="px-3 py-3">
        {error ? <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div> : null}

        <>
          {!detailReady && <BrandedLoader size="page" />}
          <div style={{ display: detailReady ? 'block' : 'none' }}>
            <GameDetail
              sport={sport}
              gameId={gameId}
              candidates={gameCandidates}
              picks={slip.picks}
              pickedKeys={slip.pickedKeys}
              onAdd={onAdd}
              onRemovePick={slip.removePick}
              odds={null}
              snapshot={snapshot}
              selectedPlayerId={selectedPlayerId}
              selectedMarket={selectedMarket}
              onSelectCandidate={onSelectCandidate}
              eventContext={eventContext}
              onReadyChange={setDetailReady}
            />
          </div>
        </>
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
