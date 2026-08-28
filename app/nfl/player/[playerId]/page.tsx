'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { useGameLines } from '@/components/useGameLines';
import { usePickHistoryModelData, needsModelDataMerge, mergeModelData } from '@/components/usePickHistoryModelData';
import { TopBar } from '@/components/TopBar';
import { GamesStrip } from '@/components/GamesStrip';
import { PlayerDetail } from '@/components/PlayerDetail';
import { nflTeamLogoUrl } from '@/components/SubjectAvatar';
import SlipModal from '@/components/SlipModal';
import { BrandedLoader } from '@/components/BrandedLoader';
import type { SlateGame } from '@/lib/odds/matching';

/** NFL's version of the MLB player-detail page — same shape, `/nfl` routes. */
export default function NflPlayerDetailPage() {
  const params = useParams<{ playerId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const sport = 'nfl' as const;

  // NFL subjectIds contain colons (`espn:football:{id}`), which every link
  // that builds this URL encodes via encodeURIComponent — Next's useParams
  // does not auto-decode dynamic segments, so this must undo that or the
  // subjectId here never matches a real candidate's subjectId below.
  const playerId = decodeURIComponent(String(params?.playerId ?? ''));
  const market = search.get('market') ?? undefined;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const odds = useGameLines(sport, snapshot?.fetchedAt ?? null);
  const [slipOpen, setSlipOpen] = useState(false);

  // PlayerDetail Score/Edge fix (Phase 1 of docs/scan-playerdetail-parity-
  // gameplan-2026-08-27.md) — same real merge Scan's AppShell.tsx uses,
  // applied here since this page fetches its own candidate list
  // independently rather than sharing AppShell's.
  const shouldMergeModelData = needsModelDataMerge(sport);
  const modelData = usePickHistoryModelData(sport, snapshot?.fetchedAt ?? null, shouldMergeModelData);

  // See the MLB player page's identical block for why this exists.
  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [playerId]);

  const games: SlateGame[] = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as SlateGame[],
    [snapshot],
  );

  // NFL's scoreboard looks 14 days ahead (multiSportGameContext.ts), unlike
  // MLB's "today only" — a player can genuinely have real candidates for two
  // different upcoming games at once (this week's and next week's). This
  // page shows one player, one game's worth of markets at a time, so scope
  // to whichever of the player's games kicks off soonest rather than mixing
  // two games' dimensions under the same market tabs (which produced
  // duplicate-key market tabs before this scoping existed).
  const mine = useMemo(() => {
    let all = (snapshot?.candidates ?? []).filter((c) => c.subjectId === playerId);
    if (all.length === 0) return all;
    if (shouldMergeModelData) all = mergeModelData(all, modelData.rowsByKey);
    const kickoffByGamePk = new Map(games.map((g) => [String(g.gamePk), g.firstPitch]));
    const soonestGamePk = [...new Set(all.map((c) => String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk)))]
      .sort((a, b) => {
        const da = kickoffByGamePk.get(a);
        const db = kickoffByGamePk.get(b);
        if (!da || !db) return 0;
        return Date.parse(da) - Date.parse(db);
      })[0];
    return all.filter((c) => String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk) === soonestGamePk);
  }, [snapshot, playerId, games, shouldMergeModelData, modelData.rowsByKey]);

  const gamePk = useMemo(() => {
    const meta = mine[0]?.subjectMeta as Record<string, unknown> | undefined;
    // ESPN's NFL event ids are purely numeric strings ("401873272") — Number()
    // here is a lossless parse, matching GamesStrip's own `Number(game.gamePk)`.
    const n = meta?.gamePk != null ? Number(meta.gamePk) : NaN;
    return Number.isFinite(n) ? n : null;
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
          onSelectGame={(pk) => router.push(pk === null ? '/nfl' : `/nfl/game/${pk}`)}
          onNavigateToGame={(pk) => router.push(`/nfl/game/${pk}`)}
          logoFor={nflTeamLogoUrl}
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
                odds={odds.result}
                market={market}
                onMarketChange={(next) =>
                  router.replace(`/nfl/player/${encodeURIComponent(playerId)}?market=${encodeURIComponent(next)}`)
                }
                onAdd={(candidate, odds) => slip.addPick(candidate, eventContext, odds)}
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
        onAdd={(c, odds) => slip.addPick(c, eventContext, odds)}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}
