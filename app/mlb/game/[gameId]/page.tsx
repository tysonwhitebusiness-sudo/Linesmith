'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { PickCandidate } from '@/lib/core/types';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { useGameLines } from '@/components/useGameLines';
import { useGameContext } from '@/components/useGameContext';
import { useBullpen } from '@/components/useBullpen';
import { GamesStrip } from '@/components/GamesStrip';
import { TopBar } from '@/components/TopBar';
import { GameDetail, type GameDetailGame, type StatKeyDef } from '@/components/GameDetail';
import SlipModal from '@/components/SlipModal';
import { ScanListSkeleton } from '@/components/Skeleton';
import { buildSlate } from '@/lib/odds/matching';
import { useFilters, applyFilters } from '@/components/useFilters';

/**
 * `/mlb/game/[gameId]` — Linemate-equivalent game summary, replacing the old
 * flat matchup-header + candidate-list page. Candidate selection lives in the
 * query string (`?player=&market=`) so the swap to `PlayerDetail` is a real
 * URL, not just local state — reload the page mid-swap and you land back on
 * the same candidate's detail.
 */
export default function GameDetailPage() {
  const params = useParams<{ gameId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const gameId = Number(params?.gameId);
  const sport = 'mlb' as const;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const odds = useGameLines(sport, snapshot?.fetchedAt ?? null);
  const { filters } = useFilters();
  const [slipOpen, setSlipOpen] = useState(false);

  const selectedPlayerId = search.get('player') ?? undefined;
  const selectedMarket = search.get('market') ?? undefined;

  const games = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as GameDetailGame[],
    [snapshot],
  );
  const statKeys = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.statKeys ?? []) as StatKeyDef[],
    [snapshot],
  );

  const selectedGame = useMemo(() => games.find((g) => Number(g.gamePk) === gameId), [games, gameId]);

  const gameLine = useMemo(() => {
    const slate = buildSlate(games, odds.result?.lines ?? []);
    return slate.entries.find((e) => Number(e.game.gamePk) === gameId)?.line ?? null;
  }, [games, odds.result, gameId]);

  const gameContext = useGameContext(selectedGame?.awayTeamId, selectedGame?.homeTeamId);
  const bullpen = useBullpen(selectedGame?.awayTeamId, selectedGame?.homeTeamId);

  const gameCandidates = useMemo(() => {
    const all = snapshot?.candidates ?? [];
    return all.filter((c) => (c.subjectMeta as Record<string, unknown> | undefined)?.gamePk === gameId);
  }, [snapshot, gameId]);

  const filtered = useMemo(() => applyFilters(gameCandidates, filters), [gameCandidates, filters]);

  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;

  const onSelectCandidate = (subjectId: string | null, dimension?: string) => {
    const qs = new URLSearchParams();
    if (subjectId) {
      qs.set('player', subjectId);
      if (dimension) qs.set('market', dimension);
    }
    const suffix = qs.toString();
    router.replace(`/mlb/game/${gameId}${suffix ? `?${suffix}` : ''}`);
  };

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
              onClick={() => router.push('/mlb')}
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
          onSelectGame={(pk) => router.push(pk === null ? '/mlb' : `/mlb/game/${pk}`)}
          onNavigateToGame={(pk) => {
            if (pk !== gameId) router.push(`/mlb/game/${pk}`);
          }}
        />
      </header>

      <main className="px-3 py-3">
        {error ? (
          <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div>
        ) : null}

        {loading && !selectedGame ? (
          <div className="space-y-3">
            <div className="lb-card p-4">
              <div className="h-20 animate-pulse rounded-lg bg-line/30" />
            </div>
            <ScanListSkeleton />
          </div>
        ) : !selectedGame ? (
          <div className="lb-card p-6 text-center text-sm text-ink-muted">Game not found.</div>
        ) : (
          <GameDetail
            game={selectedGame}
            statKeys={statKeys}
            candidates={filtered}
            allCandidates={snapshot?.candidates ?? []}
            snapshot={snapshot}
            odds={odds.result}
            gameLine={gameLine}
            gameContext={gameContext}
            bullpen={bullpen}
            picks={slip.picks}
            pickedKeys={slip.pickedKeys}
            onAdd={onAdd}
            onRemovePick={slip.removePick}
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
