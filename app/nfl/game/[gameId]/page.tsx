'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { PickCandidate } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { useGameLines } from '@/components/useGameLines';
import { GamesStrip } from '@/components/GamesStrip';
import { TopBar } from '@/components/TopBar';
import { GameDetail } from '@/components/GameDetail';
import { nflTeamLogoUrl } from '@/components/SubjectAvatar';
import SlipModal from '@/components/SlipModal';

interface NflGamesStripGame {
  gamePk: string | number;
  matchup?: string;
  awayTeamName?: string;
  homeTeamName?: string;
  firstPitch?: string;
}

/** `/nfl/game/[gameId]` — the NFL equivalent of `/mlb/game/[gameId]`. */
export default function NflGameDetailPage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const sport = 'nfl' as const;
  const gameId = String(params?.gameId ?? '');

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const odds = useGameLines(sport, snapshot?.fetchedAt ?? null);
  const [slipOpen, setSlipOpen] = useState(false);

  const selectedPlayerId = search.get('player') ?? undefined;
  const selectedMarket = search.get('market') ?? undefined;

  const onSelectCandidate = (subjectId: string | null, dimension?: string) => {
    const qs = new URLSearchParams();
    if (subjectId) {
      qs.set('player', subjectId);
      if (dimension) qs.set('market', dimension);
    }
    const suffix = qs.toString();
    router.replace(`/nfl/game/${gameId}${suffix ? `?${suffix}` : ''}`);
  };

  const games = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as NflGamesStripGame[],
    [snapshot],
  );

  const selectedGame = useMemo(() => games.find((g) => String(g.gamePk) === gameId), [games, gameId]);

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
              onClick={() => router.push('/nfl')}
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
        <GamesStrip
          games={games}
          selectedGamePk={gameId}
          onSelectGame={(pk) => router.push(pk === null ? '/nfl' : `/nfl/game/${pk}`)}
          onNavigateToGame={(pk) => {
            if (String(pk) !== gameId) router.push(`/nfl/game/${pk}`);
          }}
          logoFor={nflTeamLogoUrl}
        />
      </header>

      <main className="px-3 py-3">
        {error ? <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div> : null}

        {loading && !selectedGame ? (
          <div className="lb-card p-4">
            <div className="h-20 animate-pulse rounded-lg bg-line/30" />
          </div>
        ) : !selectedGame ? (
          <div className="lb-card p-6 text-center text-sm text-ink-muted">Game not found.</div>
        ) : (
          <GameDetail
            sport={sport}
            gameId={gameId}
            candidates={gameCandidates}
            picks={slip.picks}
            pickedKeys={slip.pickedKeys}
            onAdd={onAdd}
            onRemovePick={slip.removePick}
            odds={odds.result}
            snapshot={snapshot}
            selectedPlayerId={selectedPlayerId}
            selectedMarket={selectedMarket}
            onSelectCandidate={onSelectCandidate}
            eventContext={eventContext}
          />
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
        onAdd={onAdd}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}
