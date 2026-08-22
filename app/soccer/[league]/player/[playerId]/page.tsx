'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams, notFound } from 'next/navigation';
import type { SoccerLeague } from '@/lib/core/types';
import { SOCCER_LEAGUES } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import { PlayerDetail } from '@/components/PlayerDetail';
import SlipModal from '@/components/SlipModal';
import { BrandedLoader } from '@/components/BrandedLoader';

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

  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [playerId]);

  const mine = useMemo(() => (snapshot?.candidates ?? []).filter((c) => c.subjectId === playerId), [snapshot, playerId]);

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          league={league}
          onLeagueChange={(next) => router.push(`/soccer/${next}`)}
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
      </header>

      <main className="px-3 py-3">
        {error ? (
          <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div>
        ) : null}

        {loading && mine.length === 0 ? (
          <BrandedLoader size="page" />
        ) : mine.length === 0 ? (
          <div className="lb-card p-8 text-center text-sm text-ink-muted">
            No tracked markets for this player on today&apos;s slate.
          </div>
        ) : (
          <>
            {!detailReady && <BrandedLoader size="page" />}
            <div style={{ display: detailReady ? 'block' : 'none' }}>
              <PlayerDetail
                candidates={mine}
                snapshot={snapshot}
                odds={null}
                market={market}
                onMarketChange={(next) =>
                  router.replace(`/soccer/${league}/player/${encodeURIComponent(playerId)}?market=${encodeURIComponent(next)}`)
                }
                onAdd={(candidate, oddsInfo) => slip.addPick(candidate, null, oddsInfo)}
                addedKeys={slip.pickedKeys}
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
        onAdd={(c, oddsInfo) => slip.addPick(c, null, oddsInfo)}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}
