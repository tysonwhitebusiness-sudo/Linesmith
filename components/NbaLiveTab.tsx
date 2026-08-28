'use client';

import { useState } from 'react';
import { useNbaLiveGame } from './useNbaLiveGame';
import type { GameHeroTeamPanelData } from './GameHeroCard';
import { C } from './GameHeroCard';
import { LiveBandHeader, LiveSpotlightCard, LivePeriodStrip, LiveSubTabBar, LiveBoxTable, LiveTabEmptyState } from './LiveDetailPrimitives';

type NbaLiveSubTab = 'situation' | 'boxscore';

function fgPct(stats: { label: string; displayValue: string }[], label: string): string | null {
  return stats.find((s) => s.label === label)?.displayValue ?? null;
}

export function NbaLiveTab({
  eventId,
  away,
  home,
  active,
  isFinal,
}: {
  eventId: string;
  away: GameHeroTeamPanelData;
  home: GameHeroTeamPanelData;
  active: boolean;
  isFinal: boolean;
}) {
  const { data, loading } = useNbaLiveGame(eventId, active, isFinal ? null : 15_000);
  const [subTab, setSubTab] = useState<NbaLiveSubTab>('situation');

  if (!data) {
    return <LiveTabEmptyState loading={loading} isFinal={isFinal} notStartedText="Tip-off hasn't happened yet — live details will show up here once the game starts." />;
  }

  const leadDiff = data.homeScore - data.awayScore;
  const leadsText = leadDiff === 0 ? 'Tied' : leadDiff > 0 ? `${home.abbr} leads` : `${away.abbr} leads`;
  const statusLabel = data.period != null ? `Q${data.period}${data.displayClock ? ` · ${data.displayClock}` : ''}` : data.statusDetail;

  const maxQ = Math.max(4, data.awayLinescores.length, data.homeLinescores.length);
  const segments = Array.from({ length: maxQ }, (_, i) => ({
    label: i < 4 ? `Q${i + 1}` : `OT${i - 3 > 1 ? i - 3 : ''}`,
    away: data.awayLinescores[i] ?? null,
    home: data.homeLinescores[i] ?? null,
    index: i + 1,
  }));

  const awayFg = fgPct(data.teamStats.away, 'Field Goal %');
  const homeFg = fgPct(data.teamStats.home, 'Field Goal %');
  const away3p = fgPct(data.teamStats.away, 'Three Point %');
  const home3p = fgPct(data.teamStats.home, 'Three Point %');

  return (
    <div>
      <LiveBandHeader
        away={{ abbr: away.abbr, name: away.name, logoUrl: away.logoUrl, statLine: awayFg ? `${awayFg}% FG` : undefined }}
        home={{ abbr: home.abbr, name: home.name, logoUrl: home.logoUrl, statLine: homeFg ? `${homeFg}% FG` : undefined }}
        isFinal={isFinal}
        statusLabel={statusLabel}
        score={{ away: data.awayScore, home: data.homeScore }}
        subLabel={leadsText}
      />

      <LiveSubTabBar
        tabs={[{ key: 'situation', label: 'Situation' }, { key: 'boxscore', label: 'Box Score' }]}
        active={subTab}
        onChange={setSubTab}
      />

      {subTab === 'situation' ? (
        <>
          {(data.awayTopScorer || data.homeTopScorer) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ borderBottom: `1px solid ${C.divider}` }}>
              {data.awayTopScorer ? (
                <LiveSpotlightCard
                  role="TOP SCORER"
                  name={data.awayTopScorer.name}
                  teamAbbr={away.abbr}
                  teamLogoUrl={away.logoUrl}
                  headshotUrl={data.awayTopScorer.headshotUrl}
                  statLine={`${data.awayTopScorer.points} PTS`}
                  border="right"
                />
              ) : null}
              {data.homeTopScorer ? (
                <LiveSpotlightCard
                  role="TOP SCORER"
                  name={data.homeTopScorer.name}
                  teamAbbr={home.abbr}
                  teamLogoUrl={home.logoUrl}
                  headshotUrl={data.homeTopScorer.headshotUrl}
                  statLine={`${data.homeTopScorer.points} PTS`}
                />
              ) : null}
            </div>
          ) : null}

          <LivePeriodStrip
            title="BY QUARTER"
            segments={segments}
            currentIndex={data.period}
            totalsLine={awayFg && homeFg ? `FG ${awayFg}%–${homeFg}% · 3PT ${away3p ?? '—'}%–${home3p ?? '—'}%` : undefined}
          />
        </>
      ) : (
        <>
          <LiveBoxTable
            teamAbbr={away.abbr}
            teamLogoUrl={away.logoUrl}
            summaryLine={awayFg ? `FG ${awayFg}%` : undefined}
            columns={['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO']}
            rows={(data.boxByTeam[away.abbr] ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              headshotUrl: p.headshotUrl,
              cells: [p.min, String(p.pts), String(p.reb), String(p.ast), String(p.stl), String(p.blk), String(p.to)],
            }))}
            emptyLabel="No player stats yet."
          />
          <div style={{ borderTop: `1px solid ${C.divider}` }} />
          <LiveBoxTable
            teamAbbr={home.abbr}
            teamLogoUrl={home.logoUrl}
            summaryLine={homeFg ? `FG ${homeFg}%` : undefined}
            columns={['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO']}
            rows={(data.boxByTeam[home.abbr] ?? []).map((p) => ({
              id: p.id,
              name: p.name,
              headshotUrl: p.headshotUrl,
              cells: [p.min, String(p.pts), String(p.reb), String(p.ast), String(p.stl), String(p.blk), String(p.to)],
            }))}
            emptyLabel="No player stats yet."
          />
        </>
      )}
    </div>
  );
}
