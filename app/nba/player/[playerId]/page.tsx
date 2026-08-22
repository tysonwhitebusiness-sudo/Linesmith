'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { TopBar } from '@/components/TopBar';
import { PlayerDetail } from '@/components/PlayerDetail';
import SlipModal from '@/components/SlipModal';
import { BrandedLoader } from '@/components/BrandedLoader';

/** NBA's version of the CFB player-detail page — same shape, `/nba` routes. */
export default function NbaPlayerDetailPage() {
  const params = useParams<{ playerId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const sport = 'nba' as const;

  const playerId = decodeURIComponent(String(params?.playerId ?? ''));
  const market = search.get('market') ?? undefined;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport);
  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  const [detailReady, setDetailReady] = useState(false);
  useEffect(() => {
    setDetailReady(false);
  }, [playerId]);

  const games = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{ gamePk: string; firstPitch?: string }>,
    [snapshot],
  );

  const mine = useMemo(() => {
    const all = (snapshot?.candidates ?? []).filter((c) => c.subjectId === playerId);
    if (all.length === 0) return all;
    const kickoffByGamePk = new Map(games.map((g) => [String(g.gamePk), g.firstPitch]));
    const soonestGamePk = [...new Set(all.map((c) => String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk)))]
      .sort((a, b) => {
        const da = kickoffByGamePk.get(a);
        const db = kickoffByGamePk.get(b);
        if (!da || !db) return 0;
        return Date.parse(da) - Date.parse(db);
      })[0];
    return all.filter((c) => String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk) === soonestGamePk);
  }, [snapshot, playerId, games]);

  const eventContext = snapshot ? [snapshot.eventName, snapshot.eventDetail].filter(Boolean).join(' · ') : null;

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

        {loading && mine.length === 0 ? (
          <BrandedLoader size="page" />
        ) : mine.length === 0 ? (
          <div className="lb-card p-8 text-center text-sm text-ink-muted">No tracked markets for this player on today&apos;s slate.</div>
        ) : (
          <>
            {!detailReady && <BrandedLoader size="page" />}
            <div style={{ display: detailReady ? 'block' : 'none' }}>
              <PlayerDetail
                candidates={mine}
                snapshot={snapshot}
                odds={null}
                market={market}
                onMarketChange={(next) => router.replace(`/nba/player/${encodeURIComponent(playerId)}?market=${encodeURIComponent(next)}`)}
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
