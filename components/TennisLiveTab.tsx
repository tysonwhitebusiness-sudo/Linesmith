'use client';

import { useTennisLiveGame } from './useTennisLiveGame';
import type { GameHeroTeamPanelData } from './GameHeroCard';
import { LiveBandHeader, LivePeriodStrip, LiveTabEmptyState } from './LiveDetailPrimitives';

function setLabel(v: { value: number; tiebreak?: number } | undefined): string | null {
  if (!v) return null;
  return v.tiebreak != null ? `${v.value}(${v.tiebreak})` : String(v.value);
}

export function TennisLiveTab({
  tour,
  matchId,
  away,
  home,
  active,
  isFinal,
}: {
  tour: string;
  matchId: string;
  away: GameHeroTeamPanelData;
  home: GameHeroTeamPanelData;
  active: boolean;
  isFinal: boolean;
}) {
  const { data, loading } = useTennisLiveGame(tour, matchId, active, isFinal ? null : 20_000);

  if (!data) {
    return <LiveTabEmptyState loading={loading} isFinal={isFinal} notStartedText="This match hasn't started yet — live details will show up here once play begins." />;
  }

  const setsWonAway = data.away.sets.filter((s) => s.winner).length;
  const setsWonHome = data.home.sets.filter((s) => s.winner).length;
  const leadsText = data.away.winner ? `${away.abbr} wins` : data.home.winner ? `${home.abbr} wins` : setsWonAway === setsWonHome ? 'Even' : setsWonAway > setsWonHome ? `${away.abbr} leads` : `${home.abbr} leads`;

  const maxSets = Math.max(data.away.sets.length, data.home.sets.length, 3);
  const segments = Array.from({ length: maxSets }, (_, i) => ({
    label: `SET ${i + 1}`,
    away: setLabel(data.away.sets[i]),
    home: setLabel(data.home.sets[i]),
    index: i + 1,
  }));

  return (
    <div>
      <LiveBandHeader
        away={{ abbr: away.abbr, name: away.name ?? data.away.name, logoUrl: away.logoUrl }}
        home={{ abbr: home.abbr, name: home.name ?? data.home.name, logoUrl: home.logoUrl }}
        isFinal={isFinal}
        statusLabel={data.statusDetail}
        score={{ away: setsWonAway, home: setsWonHome }}
        subLabel={leadsText}
      />

      <LivePeriodStrip title="BY SET" segments={segments} currentIndex={data.away.sets.length || null} />
    </div>
  );
}
