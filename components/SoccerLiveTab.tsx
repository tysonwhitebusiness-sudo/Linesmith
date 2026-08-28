'use client';

import { useSoccerLiveGame } from './useSoccerLiveGame';
import type { GameHeroTeamPanelData } from './GameHeroCard';
import { C } from './GameHeroCard';
import { LiveBandHeader, LiveEventRow, LiveTabEmptyState } from './LiveDetailPrimitives';

const EVENT_BADGE: Record<string, string> = {
  Goal: 'GOAL',
  'Goal - Header': 'GOAL',
  'Goal - Penalty': 'PEN',
  'Yellow Card': 'YELLOW',
  'Red Card': 'RED',
  'Second Yellow Card': 'RED',
  Substitution: 'SUB',
};

export function SoccerLiveTab({
  league,
  eventId,
  away,
  home,
  active,
  isFinal,
}: {
  league: string;
  eventId: string;
  away: GameHeroTeamPanelData;
  home: GameHeroTeamPanelData;
  active: boolean;
  isFinal: boolean;
}) {
  const { data, loading } = useSoccerLiveGame(league, eventId, active, isFinal ? null : 25_000);

  if (!data) {
    return <LiveTabEmptyState loading={loading} isFinal={isFinal} notStartedText="Kickoff hasn't happened yet — live details will show up here once the match starts." />;
  }

  const leadDiff = data.homeScore - data.awayScore;
  const leadsText = leadDiff === 0 ? 'Level' : leadDiff > 0 ? `${home.abbr} leads` : `${away.abbr} leads`;
  const notableEvents = data.events.filter((e) => EVENT_BADGE[e.typeText]);

  return (
    <div>
      <LiveBandHeader
        away={{ abbr: away.abbr, name: away.name, logoUrl: away.logoUrl }}
        home={{ abbr: home.abbr, name: home.name, logoUrl: home.logoUrl }}
        isFinal={isFinal}
        statusLabel={data.clockDisplay ?? data.statusDetail}
        score={{ away: data.awayScore, home: data.homeScore }}
        subLabel={leadsText}
      />

      {data.awayHalfScores.length > 0 ? (
        <div className="flex items-center justify-between px-[26px] py-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <div className="text-meta tracking-[.12em]" style={{ color: C.faintMono }}>BY HALF</div>
          <div className="text-dense tabular-nums" style={{ color: C.recordText }}>
            {away.abbr} {data.awayHalfScores.join('–')} · {home.abbr} {data.homeHalfScores.join('–')}
          </div>
        </div>
      ) : null}

      <div className="px-[26px] py-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
        <div className="mb-1 text-meta tracking-[.1em]" style={{ color: C.faintMono }}>MATCH EVENTS</div>
        {notableEvents.length === 0 ? (
          <p className="py-1 text-dense" style={{ color: C.faintMono }}>No goals, cards, or substitutions yet.</p>
        ) : (
          notableEvents.map((e, i) => (
            <LiveEventRow
              key={i}
              primary={e.teamAbbr === 'away' ? away.abbr : e.teamAbbr === 'home' ? home.abbr : ''}
              secondary={`${e.description} · ${e.clockDisplay}`}
              badgeText={EVENT_BADGE[e.typeText]}
              highlighted={e.scoringPlay}
            />
          ))
        )}
      </div>

      {(data.teamStats.away.length > 0 || data.teamStats.home.length > 0) ? (
        <div className="px-[26px] py-3">
          <div className="mb-2 flex items-center justify-between text-micro uppercase tracking-wide" style={{ color: C.faintMono }}>
            <span>{away.abbr}</span>
            <span>Match stats</span>
            <span>{home.abbr}</span>
          </div>
          {data.teamStats.home.map((homeStat, i) => {
            const awayStat = data.teamStats.away[i];
            if (!awayStat) return null;
            return (
              <div key={homeStat.label} className="flex items-center justify-between py-1 text-dense" style={{ borderTop: i > 0 ? `1px solid ${C.divider}` : undefined }}>
                <span className="w-14 text-left tabular-nums font-medium" style={{ color: C.ink }}>{awayStat.displayValue}</span>
                <span className="text-label uppercase tracking-wide" style={{ color: C.faintMono }}>{homeStat.label}</span>
                <span className="w-14 text-right tabular-nums font-medium" style={{ color: C.ink }}>{homeStat.displayValue}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
