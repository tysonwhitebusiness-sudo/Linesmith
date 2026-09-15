'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams, notFound } from 'next/navigation';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import { PlayerDetail } from '@/components/PlayerDetail';
import { ErrorState } from '@/components/ui';
import { sameSubject } from '@/lib/sports/shared/playerResearchShapes';
import SlipModal from '@/components/SlipModal';
import { useSyntheticPlayerCandidates } from '@/components/useSyntheticPlayerCandidates';

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

/** Tennis's version of the MLB/NFL/soccer player-detail page — same shape, `/tennis/[tour]` routes. */
export default function TennisPlayerDetailPage() {
  const params = useParams<{ tour: string; playerId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const tour = params?.tour ?? '';
  if (!isTennisTour(tour)) notFound();
  const sport = 'tennis' as const;

  // Same decode-on-read requirement as NFL's/soccer's pages — subjectIds contain colons.
  const playerId = decodeURIComponent(String(params?.playerId ?? ''));
  const market = search.get('market') ?? undefined;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport, undefined, tour);
  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  const mine = useMemo(() => (snapshot?.candidates ?? []).filter((c) => sameSubject(c.subjectId, playerId)), [snapshot, playerId]);

  // Tennis's game-hero links don't carry identity query params (unlike
  // NBA/NHL's roster-href pattern) — resolve identity from `snapshot.subjects`
  // instead, which `buildTennisSnapshot` already populates for every real
  // scheduled player regardless of whether they have an active prop.
  const subject = useMemo(() => (snapshot?.subjects ?? []).find((s) => s.subjectId === playerId) ?? null, [snapshot, playerId]);
  const hasIdentity = Boolean(subject?.subjectName);

  const synthetic = useSyntheticPlayerCandidates({
    sport,
    subjectId: playerId,
    name: subject?.subjectName,
    tour,
    enabled: mine.length === 0 && hasIdentity,
  });
  const effectiveCandidates = mine.length > 0 ? mine : synthetic.candidates;
  const waitingOnSynthetic = mine.length === 0 && hasIdentity && synthetic.loading;

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          league={tour}
          onLeagueChange={(next) => router.push(`/tennis/${next}`)}
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
            router.replace(`/tennis/${tour}/player/${encodeURIComponent(playerId)}?market=${encodeURIComponent(next)}`)
          }
          onAdd={(candidate, oddsInfo) => slip.addPick(candidate, null, oddsInfo)}
          addedKeys={slip.pickedKeys}
          subject={{ sport, id: playerId, league: tour, name: subject?.subjectName ?? mine[0]?.subjectName ?? null }}
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
