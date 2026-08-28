'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, notFound } from 'next/navigation';
import type { TennisTour } from '@/lib/core/types';
import { TENNIS_TOURS } from '@/lib/core/types';
import type { LeaderStat } from '@/lib/sports/tennis/seasonLeaders';
import { useSnapshot } from '@/components/useSnapshot';
import { useSlip } from '@/components/useSlip';
import { useTennisSchedule } from '@/components/useTennisSchedule';
import { useTennisDraw } from '@/components/useTennisDraw';
import { useTennisMoneylines } from '@/components/useTennisMoneylines';
import { useTennisLines } from '@/components/useTennisLines';
import { useTennisRankings } from '@/components/useTennisRankings';
import { useTennisSeasonLeaders } from '@/components/useTennisSeasonLeaders';
import { useTennisWeather } from '@/components/useTennisWeather';
import { TopBar } from '@/components/TopBar';
import SlipModal from '@/components/SlipModal';
import { TennisScheduleView } from '@/components/TennisScheduleView';
import { TennisMatchStrip } from '@/components/TennisMatchStrip';

function isTennisTour(v: string): v is TennisTour {
  return (TENNIS_TOURS as string[]).includes(v);
}

/**
 * `/tennis/[tour]/schedule` — tennis's Schedule tab, built the same "not an
 * adapter, own view" way golf's `/golf/schedule` is (see
 * `TennisScheduleView.tsx`'s own header comment for why). Doesn't route
 * through `AppShell`, matching both golf's schedule page and tennis's own
 * `/tennis/[tour]/game/[gameId]` page — neither statically imports `AppShell`,
 * which is what the documented chunk-loading bug on `/tennis/[tour]`
 * (this route's own sibling) was actually about.
 */
export default function TennisSchedulePage() {
  const params = useParams<{ tour: string }>();
  const router = useRouter();
  const tour = params?.tour ?? '';
  if (!isTennisTour(tour)) notFound();
  const sport = 'tennis' as const;

  const { snapshot, loading, error, lastFetched, refresh } = useSnapshot(sport, undefined, tour);
  const slip = useSlip(sport);
  const [slipOpen, setSlipOpen] = useState(false);

  const schedule = useTennisSchedule(tour);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Default to whichever tournament ESPN itself has live; falls back to the
  // most recently started one so the page never opens on a blank "select a
  // tournament" state when nothing's live right now.
  useEffect(() => {
    if (selectedEventId || schedule.events.length === 0) return;
    const now = Date.now();
    const live = schedule.events.find((e) => e.status === 'in');
    // "Most recently started" must be scoped to events that have actually
    // started by now — a plain latest-startDate sort over the whole season
    // list picks the season's LAST event regardless of today's date (caught
    // live: it opened on a December tournament while testing in August).
    const started = schedule.events.filter((e) => Date.parse(e.startDate) <= now);
    const mostRecentStarted = [...started].sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate))[0];
    setSelectedEventId((live ?? mostRecentStarted ?? schedule.events[0])?.id ?? null);
  }, [schedule.events, selectedEventId]);

  const selectedEvent = useMemo(() => schedule.events.find((e) => e.id === selectedEventId) ?? null, [schedule.events, selectedEventId]);
  const eventWindow = selectedEvent ? { id: selectedEvent.id, startDate: selectedEvent.startDate, endDate: selectedEvent.endDate } : null;

  const drawState = useTennisDraw(tour, eventWindow);
  const moneylines = useTennisMoneylines(tour, eventWindow);
  const linesState = useTennisLines(tour, drawState.draw?.eventName ?? null);
  const rankingsState = useTennisRankings(tour);
  const [leaderStat, setLeaderStat] = useState<LeaderStat>('aces');
  const seasonLeadersState = useTennisSeasonLeaders(tour, leaderStat);
  const weatherState = useTennisWeather(tour, drawState.draw?.venueCity ?? null);

  const eventContext = drawState.draw ? drawState.draw.eventName : null;

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={sport}
          league={tour}
          tab="Schedule"
          onTabChange={(t) => router.push(t === 'Players' ? `/tennis/${tour}?tab=Players` : t === 'Schedule' ? `/tennis/${tour}/schedule` : `/tennis/${tour}`)}
          onLeagueChange={(next) => router.push(`/tennis/${next}/schedule`)}
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={refresh}
          loading={loading}
          lastFetched={lastFetched}
        />
        <TennisMatchStrip matches={drawState.draw?.matches ?? []} onSelectMatch={(matchId) => router.push(`/tennis/${tour}/game/${matchId}`)} />
      </header>

      <main className="px-3 py-3">
        {error ? <div className="lb-card mb-3 border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div> : null}
        <TennisScheduleView
          tour={tour}
          events={schedule.events}
          scheduleLoading={schedule.loading}
          scheduleWarnings={schedule.warnings}
          selectedEventId={selectedEventId}
          onSelectEvent={(e) => setSelectedEventId(e.id)}
          draw={drawState.draw}
          drawLoading={drawState.loading}
          drawWarnings={drawState.warnings}
          moneylines={moneylines.lines}
          linesResult={linesState.result}
          linesLoading={linesState.loading}
          rankings={rankingsState.rankings}
          rankingsLoading={rankingsState.loading}
          seasonLeaders={seasonLeadersState.leaders}
          seasonLeadersLoading={seasonLeadersState.loading}
          leaderStat={leaderStat}
          onChangeLeaderStat={setLeaderStat}
          weather={weatherState.weather}
          snapshot={snapshot}
          onAdd={(c) => slip.addPick(c, eventContext)}
          addedKeys={slip.pickedKeys}
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
