'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { useGolfPlayerStats } from '@/components/useGolfPlayerStats';
import { TopBar } from '@/components/TopBar';
import { GolferStrip } from '@/components/GolferStrip';
import { PlayerDetail } from '@/components/PlayerDetail';
import { Button, ErrorState } from '@/components/ui';
import { sameSubject } from '@/lib/sports/shared/playerResearchShapes';
import SlipModal from '@/components/SlipModal';

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

  const mine = useMemo(
    () => (snapshot?.candidates ?? []).filter((c) => sameSubject(c.subjectId, playerId)),
    [snapshot, playerId],
  );

  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
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
        <GolferStrip
          subjects={snapshot?.subjects ?? []}
          selectedPlayerId={playerId}
          onSelectPlayer={(id) => router.push(id === null ? '/golf' : `/golf/player/${id}`)}
          onNavigateToPlayer={(id) => router.push(`/golf/player/${id}`)}
        />
      </header>

      <main className="space-y-3 px-3 py-3">
        {error ? (
          // R3: human text and a retry, never the raw error string (D5).
          <ErrorState className="mb-3" message="We couldn't refresh today's markets for this player." onRetry={refresh} />
        ) : null}
        {/* R6.1a: the player is the page. It renders with or without a market;
            the prop block is one section of it and says why it is empty. */}
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
          subject={{ sport, id: playerId, name: mine[0]?.subjectName ?? null }}
          marketsLoading={loading && mine.length === 0}
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
        onAdd={(c, odds) => slip.addPick(c, eventContext, odds)}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}
