'use client';

import { useState } from 'react';
import { useNhlLiveGame } from './useNhlLiveGame';
import type { GameHeroTeamPanelData } from './GameHeroCard';
import { C } from './GameHeroCard';
import { LiveBandHeader, LiveSpotlightCard, LivePeriodStrip, LiveEventRow, LiveSubTabBar, LiveBoxTable, LiveTabEmptyState } from './LiveDetailPrimitives';

const PERIOD_LABEL: Record<string, (n: number) => string> = {
  REG: (n) => `${n === 1 ? '1ST' : n === 2 ? '2ND' : '3RD'}`,
  OT: (n) => (n <= 4 ? `OT${n - 3 > 1 ? n - 3 : ''}` : `OT${n - 3}`),
  SO: () => 'SO',
};

function periodShortLabel(type: string, n: number): string {
  return (PERIOD_LABEL[type] ?? ((x: number) => `P${x}`))(n);
}

type NhlLiveSubTab = 'situation' | 'boxscore';

export function NhlLiveTab({
  gameId,
  away,
  home,
  active,
  isFinal,
}: {
  gameId: string;
  away: GameHeroTeamPanelData;
  home: GameHeroTeamPanelData;
  active: boolean;
  isFinal: boolean;
}) {
  const { data, loading } = useNhlLiveGame(gameId, active, isFinal ? null : 20_000);
  const [subTab, setSubTab] = useState<NhlLiveSubTab>('situation');

  if (!data) {
    return <LiveTabEmptyState loading={loading} isFinal={isFinal} notStartedText="Puck hasn't dropped yet — live details will show up here once the game starts." />;
  }

  const leadDiff = data.homeScore - data.awayScore;
  const leadsText = leadDiff === 0 ? 'Tied' : leadDiff > 0 ? `${home.abbr} leads` : `${away.abbr} leads`;
  const statusLabel = data.clock
    ? `${periodShortLabel(data.period?.type ?? 'REG', data.period?.number ?? 1)} · ${data.clock.inIntermission ? 'INT' : data.clock.timeRemaining}`
    : (data.period ? periodShortLabel(data.period.type, data.period.number) : undefined);

  const maxPeriod = Math.max(3, ...data.periods.map((p) => p.period));
  const segments = Array.from({ length: maxPeriod }, (_, i) => {
    const p = data.periods.find((x) => x.period === i + 1);
    const type = i < 3 ? 'REG' : 'OT';
    return { label: periodShortLabel(type, i + 1), away: p?.awayGoals ?? null, home: p?.homeGoals ?? null, index: i + 1 };
  });

  const topAwaySkater = [...(data.skatersByTeam[away.abbr] ?? [])].sort((a, b) => b.points - a.points)[0];
  const topHomeSkater = [...(data.skatersByTeam[home.abbr] ?? [])].sort((a, b) => b.points - a.points)[0];

  return (
    <div>
      <LiveBandHeader
        away={{ abbr: away.abbr, name: away.name, logoUrl: away.logoUrl, statLine: `${data.awaySog} SOG` }}
        home={{ abbr: home.abbr, name: home.name, logoUrl: home.logoUrl, statLine: `${data.homeSog} SOG` }}
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
          {(topAwaySkater || topHomeSkater) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ borderBottom: `1px solid ${C.divider}` }}>
              {topAwaySkater ? (
                <LiveSpotlightCard
                  role="TOP SKATER"
                  name={topAwaySkater.name}
                  teamAbbr={away.abbr}
                  teamLogoUrl={away.logoUrl}
                  statLine={`${topAwaySkater.goals}G ${topAwaySkater.assists}A · ${topAwaySkater.shots} SOG`}
                  border="right"
                />
              ) : null}
              {topHomeSkater ? (
                <LiveSpotlightCard
                  role="TOP SKATER"
                  name={topHomeSkater.name}
                  teamAbbr={home.abbr}
                  teamLogoUrl={home.logoUrl}
                  statLine={`${topHomeSkater.goals}G ${topHomeSkater.assists}A · ${topHomeSkater.shots} SOG`}
                />
              ) : null}
            </div>
          ) : null}

          <LivePeriodStrip
            title="BY PERIOD"
            segments={segments}
            currentIndex={data.period?.number ?? null}
            totalsLine={`SOG ${data.awaySog}–${data.homeSog}`}
          />

          {data.goals.length > 0 ? (
            <div className="px-[26px] py-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div className="mb-1 text-meta tracking-[.1em]" style={{ color: C.faintMono }}>SCORING</div>
              {data.goals.map((g, i) => (
                <LiveEventRow
                  key={i}
                  primary={g.scorerName}
                  secondary={`${g.teamAbbr} · P${g.period}`}
                  badgeText={g.strength === 'pp' ? 'PPG' : g.strength === 'sh' ? 'SHG' : 'GOAL'}
                  highlighted
                />
              ))}
            </div>
          ) : null}

          {data.penalties.length > 0 ? (
            <div className="px-[26px] py-3">
              <div className="mb-1 text-meta tracking-[.1em]" style={{ color: C.faintMono }}>PENALTIES</div>
              {data.penalties.map((p, i) => (
                <LiveEventRow key={i} primary={p.teamAbbr} secondary={`${p.description} · P${p.period}`} />
              ))}
            </div>
          ) : (
            <p className="px-[26px] pb-3 text-dense" style={{ color: C.faintMono }}>No penalties.</p>
          )}
        </>
      ) : (
        <>
          <LiveBoxTable
            teamAbbr={away.abbr}
            teamLogoUrl={away.logoUrl}
            summaryLine={`SOG ${data.awaySog}`}
            columns={['G', 'A', 'PTS', 'SOG', 'HIT', 'BLK']}
            rows={(data.skatersByTeam[away.abbr] ?? []).map((s) => ({
              id: s.playerId,
              name: s.name,
              cells: [String(s.goals), String(s.assists), String(s.points), String(s.shots), String(s.hits), String(s.blockedShots)],
            }))}
            emptyLabel="No skater stats yet."
          />
          <div style={{ borderTop: `1px solid ${C.divider}` }} />
          <LiveBoxTable
            teamAbbr={home.abbr}
            teamLogoUrl={home.logoUrl}
            summaryLine={`SOG ${data.homeSog}`}
            columns={['G', 'A', 'PTS', 'SOG', 'HIT', 'BLK']}
            rows={(data.skatersByTeam[home.abbr] ?? []).map((s) => ({
              id: s.playerId,
              name: s.name,
              cells: [String(s.goals), String(s.assists), String(s.points), String(s.shots), String(s.hits), String(s.blockedShots)],
            }))}
            emptyLabel="No skater stats yet."
          />
        </>
      )}
    </div>
  );
}
