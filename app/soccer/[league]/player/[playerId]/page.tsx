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
import { SubjectAvatar, TeamLogo } from '@/components/SubjectAvatar';
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

  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [playerId]);

  // PlayerDetail Score/Edge fix (Phase 1 of docs/scan-playerdetail-parity-
  // gameplan-2026-08-27.md) — same real merge Scan's AppShell.tsx uses,
  // applied here since this page fetches its own candidate list
  // independently rather than sharing AppShell's.
  const shouldMergeModelData = needsModelDataMerge(sport);
  const modelData = usePickHistoryModelData(sport, snapshot?.fetchedAt ?? null, shouldMergeModelData);

  const mine = useMemo(() => {
    const all = (snapshot?.candidates ?? []).filter((c) => c.subjectId === playerId);
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

        {(loading && mine.length === 0 && !hasIdentity) || waitingOnSynthetic ? (
          <BrandedLoader size="page" />
        ) : effectiveCandidates.length === 0 && hasIdentity ? (
          <div className="lb-card p-6">
            <div className="flex items-center gap-3">
              <SubjectAvatar name={identity.name ?? ''} headshotUrl={identity.headshot ?? undefined} size={56} />
              <div className="min-w-0">
                <p className="truncate text-[16px] font-semibold text-ink">{identity.name}</p>
                <p className="flex items-center gap-1.5 text-[13px] text-ink-muted">
                  <TeamLogo logoUrl={identity.teamLogoUrl ?? undefined} abbreviation={identity.team ?? undefined} size={16} />
                  {identity.teamName ?? identity.team}
                  {identity.pos ? ` · ${identity.pos}` : ''}
                </p>
              </div>
            </div>
            <p className="mt-4 text-[13px] text-ink-muted">
              No real match history found for this player yet — no props tracked, and this player&apos;s name
              couldn&apos;t be matched to their real {league === 'epl' ? 'Understat' : 'ASA'} match log.
            </p>
          </div>
        ) : effectiveCandidates.length === 0 ? (
          <div className="lb-card p-8 text-center text-sm text-ink-muted">
            No tracked markets for this player on today&apos;s slate.
          </div>
        ) : (
          <>
            {!detailReady && <BrandedLoader size="page" />}
            <div style={{ display: detailReady ? 'block' : 'none' }}>
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
