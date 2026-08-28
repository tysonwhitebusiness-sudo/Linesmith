'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import { PlayerDetail } from '@/components/PlayerDetail';
import SlipModal from '@/components/SlipModal';
import { BrandedLoader } from '@/components/BrandedLoader';
import { SubjectAvatar, TeamLogo } from '@/components/SubjectAvatar';
import { useSyntheticPlayerCandidates } from '@/components/useSyntheticPlayerCandidates';
import { usePickHistoryModelData, needsModelDataMerge, mergeModelData } from '@/components/usePickHistoryModelData';
import { useTeamDefenseAllowed } from '@/components/useTeamDefenseAllowed';
import type { NhlTeamDefenseAllowed } from '@/lib/sports/nhl/teamDefenseAllowed';
import { nhlMatchupFavorableFor } from '@/lib/sports/nhl/matchupFavorable';
import { mergeMatchupFavorable } from '@/lib/odds/props/matchupFavorable';

/** NHL's version of the CFB/NBA player-detail page — same shape, `/nhl` routes. */
export default function NhlPlayerDetailPage() {
  const params = useParams<{ playerId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const sport = 'nhl' as const;

  const playerId = decodeURIComponent(String(params?.playerId ?? ''));
  const market = search.get('market') ?? undefined;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  // PlayerDetail Score/Edge fix (Phase 1 of docs/scan-playerdetail-parity-
  // gameplan-2026-08-27.md) — same real merge Scan's AppShell.tsx uses,
  // applied here since this page fetches its own candidate list
  // independently rather than sharing AppShell's.
  const shouldMergeModelData = needsModelDataMerge(sport);
  const modelData = usePickHistoryModelData(sport, snapshot?.fetchedAt ?? null, shouldMergeModelData);
  const nhlTeamDefense = useTeamDefenseAllowed<NhlTeamDefenseAllowed>('/api/nhl/team-defense-allowed', true);

  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [playerId]);

  const games = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{ gamePk: string; firstPitch?: string }>,
    [snapshot],
  );

  const mine = useMemo(() => {
    let all = (snapshot?.candidates ?? []).filter((c) => c.subjectId === playerId);
    if (all.length === 0) return all;
    if (shouldMergeModelData) all = mergeModelData(all, modelData.rowsByKey);
    if (nhlTeamDefense.teams.length > 0) {
      const position = (snapshot?.subjects ?? []).find((s) => s.subjectId === playerId)?.meta?.position as string | undefined;
      all = mergeMatchupFavorable(all, (c) =>
        nhlMatchupFavorableFor(position, (c.subjectMeta as Record<string, unknown> | undefined)?.opponent as string | undefined, nhlTeamDefense.teams),
      );
    }
    const kickoffByGamePk = new Map(games.map((g) => [String(g.gamePk), g.firstPitch]));
    const soonestGamePk = [...new Set(all.map((c) => String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk)))]
      .sort((a, b) => {
        const da = kickoffByGamePk.get(a);
        const db = kickoffByGamePk.get(b);
        if (!da || !db) return 0;
        return Date.parse(da) - Date.parse(db);
      })[0];
    return all.filter((c) => String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk) === soonestGamePk);
  }, [snapshot, playerId, games, shouldMergeModelData, modelData.rowsByKey, nhlTeamDefense.teams]);

  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;

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
    enabled: mine.length === 0 && hasIdentity && Boolean(identity.team),
  });
  const effectiveCandidates = mine.length > 0 ? mine : synthetic.candidates;
  const waitingOnSynthetic = mine.length === 0 && hasIdentity && Boolean(identity.team) && synthetic.loading;

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
      </header>

      <main className="px-3 py-3">
        {error ? <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div> : null}

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
              No real game history found for this player yet — no props tracked, and no real box scores from this or
              last season to build a pattern from.
              {snapshot?.seasonStatus && !snapshot.seasonStatus.started
                ? snapshot.seasonStatus.nextGameDate
                  ? ` The 2026-27 season hasn't dropped the puck yet — first real games are ${new Date(snapshot.seasonStatus.nextGameDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`
                  : " The 2026-27 season hasn't dropped the puck yet."
                : ''}
            </p>
          </div>
        ) : effectiveCandidates.length === 0 ? (
          <div className="lb-card p-8 text-center text-sm text-ink-muted">No tracked markets for this player on today&apos;s slate.</div>
        ) : (
          <>
            {!detailReady && <BrandedLoader size="page" />}
            <div style={{ display: detailReady ? 'block' : 'none' }}>
              <PlayerDetail
                candidates={effectiveCandidates}
                snapshot={snapshot}
                odds={null}
                market={market}
                onMarketChange={(next) => router.replace(`/nhl/player/${encodeURIComponent(playerId)}?market=${encodeURIComponent(next)}`)}
                onAdd={(candidate, oddsInfo) => slip.addPick(candidate, eventContext, oddsInfo)}
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
        onAdd={(c, oddsInfo) => slip.addPick(c, eventContext, oddsInfo)}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}
