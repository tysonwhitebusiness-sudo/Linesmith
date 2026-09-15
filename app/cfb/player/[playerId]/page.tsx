'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import { PlayerDetail } from '@/components/PlayerDetail';
import { ErrorState } from '@/components/ui';
import { sameSubject } from '@/lib/sports/shared/playerResearchShapes';
import SlipModal from '@/components/SlipModal';
import { useSyntheticPlayerCandidates } from '@/components/useSyntheticPlayerCandidates';
import { usePickHistoryModelData, needsModelDataMerge, mergeModelData } from '@/components/usePickHistoryModelData';
import { useTeamDefenseAllowed } from '@/components/useTeamDefenseAllowed';
import type { CfbTeamDefenseAllowed } from '@/lib/sports/cfb/teamDefenseAllowed';
import { cfbMatchupFavorableFor } from '@/lib/sports/cfb/teamDefenseAllowedMatch';
import { mergeMatchupFavorable } from '@/lib/odds/props/matchupFavorable';

/** CFB's version of the NFL player-detail page — same shape, `/cfb` routes. No `useGameLines`/`GamesStrip.logoFor`: CFB embeds odds per-candidate (adapter.ts), same as soccer, not via a slate-wide odds-provider fetch. */
export default function CfbPlayerDetailPage() {
  const params = useParams<{ playerId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const sport = 'cfb' as const;

  // CFB subjectIds contain colons (`espn:football:{id}`) — must be decoded
  // the same way NFL's player page does.
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
  const cfbTeamDefense = useTeamDefenseAllowed<CfbTeamDefenseAllowed>('/api/cfb/team-defense-allowed', true);

  const games = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{ gamePk: string; firstPitch?: string }>,
    [snapshot],
  );

  // Same "soonest of the player's real upcoming games" scoping as NFL's
  // player page — CFB's game-context window is also multi-week (21 days),
  // so a player can genuinely have real candidates for two different games.
  const mine = useMemo(() => {
    let all = (snapshot?.candidates ?? []).filter((c) => sameSubject(c.subjectId, playerId));
    if (all.length === 0) return all;
    if (shouldMergeModelData) all = mergeModelData(all, modelData.rowsByKey);
    if (cfbTeamDefense.teams.length > 0) {
      all = mergeMatchupFavorable(all, (c) =>
        cfbMatchupFavorableFor(c.dimension, (c.subjectMeta as Record<string, unknown> | undefined)?.opponentName as string | undefined, cfbTeamDefense.teams),
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
  }, [snapshot, playerId, games, shouldMergeModelData, modelData.rowsByKey, cfbTeamDefense.teams]);

  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;

  // Real identity carried via the roster link's own query params (see
  // teamDetailAdapter.ts) — every FBS roster player is real, not every one
  // has an active tracked market right now. Renders honest identity + "no
  // props yet" instead of a bare dead-end when a player was reached this
  // way. A player reached with no identity context AND no candidates (e.g.
  // a stale/direct URL) still gets the plain "no tracked markets" message —
  // nothing to show without real data either way.
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
    enabled: mine.length === 0 && hasIdentity,
  });
  const effectiveCandidates = mine.length > 0 ? mine : synthetic.candidates;
  const waitingOnSynthetic = mine.length === 0 && hasIdentity && synthetic.loading;

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
          onMarketChange={(next) => router.replace(`/cfb/player/${encodeURIComponent(playerId)}?market=${encodeURIComponent(next)}`)}
          onAdd={(candidate, oddsInfo) => slip.addPick(candidate, eventContext, oddsInfo)}
          addedKeys={slip.pickedKeys}
          subject={{ sport, id: playerId, name: identity.name ?? mine[0]?.subjectName ?? null }}
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
        onAdd={(c, oddsInfo) => slip.addPick(c, eventContext, oddsInfo)}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}
