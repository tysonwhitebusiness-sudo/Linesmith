'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { useGolfPlayerStats } from '@/components/useGolfPlayerStats';
import { TopBar } from '@/components/TopBar';
import { GolferStrip } from '@/components/GolferStrip';
import { PlayerDetail } from '@/components/PlayerDetail';
import SlipModal from '@/components/SlipModal';
import { BrandedLoader } from '@/components/BrandedLoader';

/**
 * One golfer, one market — `/golf/player/[playerId]?market=[dimension]` —
 * parallel to the MLB player page. The hole-score candidates render through
 * the same generic `PlayerDetail` MLB uses (sport-agnostic already); the
 * strokes-gained + tournament-log card above it is golf-only, new for this
 * rebuild.
 */
export default function GolfPlayerDetailPage() {
  const params = useParams<{ playerId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const sport = 'golf' as const;

  const playerId = String(params?.playerId ?? '');
  const market = search.get('market') ?? undefined;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const playerStats = useGolfPlayerStats(playerId || null);
  const [slipOpen, setSlipOpen] = useState(false);

  // See the MLB player page's identical block for why this exists.
  // `playerStats` is fetched at this page level (not inside PlayerDetail),
  // so it's folded into `fullyReady` directly rather than via the callback.
  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [playerId]);
  const fullyReady = detailReady && !playerStats.loading;

  const mine = useMemo(
    () => (snapshot?.candidates ?? []).filter((c) => c.subjectId === playerId),
    [snapshot, playerId],
  );

  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          leading={
            <button
              type="button"
              onClick={() => router.back()}
              className="whitespace-nowrap px-2 py-3 text-[13px] font-medium text-masters"
            >
              ← Back
            </button>
          }
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
        <GolferStrip
          subjects={snapshot?.subjects ?? []}
          selectedPlayerId={playerId}
          onSelectPlayer={(id) => router.push(id === null ? '/golf' : `/golf/player/${id}`)}
          onNavigateToPlayer={(id) => router.push(`/golf/player/${id}`)}
        />
      </header>

      <main className="space-y-3 px-3 py-3">
        {error ? (
          <div className="lb-card border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div>
        ) : null}

        {loading && mine.length === 0 ? (
          <BrandedLoader size="page" />
        ) : mine.length === 0 ? (
          <div className="lb-card p-8 text-center text-sm text-ink-muted">
            No tracked markets for this golfer on today&apos;s event.
          </div>
        ) : (
          <>
            {!fullyReady && <BrandedLoader size="page" />}
            <div style={{ display: fullyReady ? 'block' : 'none' }}>
              <PlayerDetail
                candidates={mine}
                snapshot={snapshot}
                odds={null}
                market={market}
                onMarketChange={(next) =>
                  router.replace(`/golf/player/${encodeURIComponent(playerId)}?market=${encodeURIComponent(next)}`)
                }
                onAdd={(candidate) => slip.addPick(candidate, eventContext)}
                addedKeys={slip.pickedKeys}
                golfStats={{
                  strokesGained: playerStats.result?.strokesGained ?? null,
                  seasonLog: playerStats.result?.seasonLog ?? null,
                  advancedStats: playerStats.result?.advancedStats ?? [],
                  loading: playerStats.loading,
                }}
                onReadyChange={setDetailReady}
              />
            </div>
          </>
        )}
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
