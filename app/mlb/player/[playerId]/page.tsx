'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { useGameLines } from '@/components/useGameLines';
import { TopBar } from '@/components/TopBar';
import { GamesStrip } from '@/components/GamesStrip';
import { PlayerDetail } from '@/components/PlayerDetail';
import { ErrorState } from '@/components/ui';
import { sameSubject } from '@/lib/sports/shared/playerResearchShapes';
import SlipModal from '@/components/SlipModal';
import type { SlateGame } from '@/lib/odds/matching';

/**
 * One player, one market — `/mlb/player/[playerId]?market=[dimension]`.
 *
 * A thin wrapper: the market lives in the query string so a row click from the
 * Scan table deep-links to the exact prop it was showing, and switching tabs
 * rewrites that parameter rather than navigating. All the substance is in
 * `PlayerDetail`, which Game Detail mounts directly.
 */
export default function PlayerDetailPage() {
  const params = useParams<{ playerId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const sport = 'mlb' as const;

  const playerId = String(params?.playerId ?? '');
  const market = search.get('market') ?? undefined;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const odds = useGameLines(sport, snapshot?.fetchedAt ?? null);
  const [slipOpen, setSlipOpen] = useState(false);

  // Holds the full-page loader until PlayerDetail's OWN data-fetching hooks
  // (live game, opponent Statcast, prop odds, calibration) settle too — not
  // just this page's outer snapshot fetch — so the page appears all at once
  // instead of its sub-sections popping in piecemeal. Resets whenever the
  // viewed player changes, since a new player means a fresh round of fetches.

  const mine = useMemo(
    () => (snapshot?.candidates ?? []).filter((c) => sameSubject(c.subjectId, playerId)),
    [snapshot, playerId],
  );

  const games: SlateGame[] = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as SlateGame[],
    [snapshot],
  );

  // The player's own game, so the strip shows where they're playing.
  const gamePk = useMemo(() => {
    const meta = mine[0]?.subjectMeta as Record<string, unknown> | undefined;
    return typeof meta?.gamePk === 'number' ? meta.gamePk : null;
  }, [mine]);

  const eventContext = snapshot
    ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ')
    : null;

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
        <GamesStrip
          games={games}
          selectedGamePk={gamePk}
          onSelectGame={(pk) => router.push(pk === null ? '/mlb' : `/mlb/game/${pk}`)}
          onNavigateToGame={(pk) => router.push(`/mlb/game/${pk}`)}
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
          candidates={mine}
          snapshot={snapshot}
          odds={odds.result}
          market={market}
          // Replace rather than push: stepping through a player's markets
          // shouldn't bury the Scan table under a stack of history entries.
          onMarketChange={(next) =>
            router.replace(`/mlb/player/${encodeURIComponent(playerId)}?market=${encodeURIComponent(next)}`)
          }
          onAdd={(candidate, odds) => slip.addPick(candidate, eventContext, odds)}
          addedKeys={slip.pickedKeys}
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
