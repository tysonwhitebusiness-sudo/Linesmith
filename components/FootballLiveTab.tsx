'use client';

import { useFootballLiveGame } from './useFootballLiveGame';
import type { GameHeroTeamPanelData } from './GameHeroCard';
import { C } from './GameHeroCard';
import { LiveBandHeader, LiveSpotlightCard, LivePeriodStrip, LiveEventRow, LiveTabEmptyState, LiveBoxTable, type LiveBoxRow } from './LiveDetailPrimitives';
import type { FootballPlayerLine } from '@/lib/sports/multiSport/footballLiveGame';

/**
 * Full passing/rushing/receiving tables for one team — every player who
 * touched the ball, not just the single top-passer spotlight above it
 * (2026-08-24 unified-card redesign: the first pass of this tab undersold
 * `footballLiveGame.ts`'s own `playersByTeam`, which already carried every
 * player's full line — this was a pure render gap, not a data gap). Empty
 * groups (e.g. a team with no rushing yet) render nothing rather than an
 * empty table.
 */
function TeamStatTables({ teamAbbr, teamLogoUrl, players }: { teamAbbr: string; teamLogoUrl?: string; players: FootballPlayerLine[] }) {
  const passers = players.filter((p) => p.passingYards != null).sort((a, b) => (b.passingYards ?? 0) - (a.passingYards ?? 0));
  const rushers = players.filter((p) => p.rushingYards != null).sort((a, b) => (b.rushingYards ?? 0) - (a.rushingYards ?? 0));
  const receivers = players.filter((p) => p.receivingYards != null).sort((a, b) => (b.receivingYards ?? 0) - (a.receivingYards ?? 0));

  const toRows = (list: FootballPlayerLine[], cells: (p: FootballPlayerLine) => string[]): LiveBoxRow[] =>
    list.map((p) => ({ id: p.name, name: p.name, cells: cells(p) }));

  return (
    <div className="min-w-0">
      {passers.length > 0 ? (
        <LiveBoxTable
          teamAbbr={teamAbbr}
          teamLogoUrl={teamLogoUrl}
          summaryLine="Passing"
          columns={['C/ATT', 'YDS', 'TD', 'INT']}
          rows={toRows(passers, (p) => [p.passingCompAtt ?? '—', String(p.passingYards ?? 0), String(p.passingTds ?? 0), String(p.passingInts ?? 0)])}
          emptyLabel="No passing yet."
        />
      ) : null}
      {rushers.length > 0 ? (
        <LiveBoxTable
          teamAbbr={teamAbbr}
          teamLogoUrl={teamLogoUrl}
          summaryLine="Rushing"
          columns={['CAR', 'YDS', 'TD']}
          rows={toRows(rushers, (p) => [p.rushingCarries != null ? String(p.rushingCarries) : '—', String(p.rushingYards ?? 0), String(p.rushingTds ?? 0)])}
          emptyLabel="No rushing yet."
        />
      ) : null}
      {receivers.length > 0 ? (
        <LiveBoxTable
          teamAbbr={teamAbbr}
          teamLogoUrl={teamLogoUrl}
          summaryLine="Receiving"
          columns={['REC', 'YDS', 'TD']}
          rows={toRows(receivers, (p) => [p.receptions != null ? String(p.receptions) : '—', String(p.receivingYards ?? 0), String(p.receivingTds ?? 0)])}
          emptyLabel="No receiving yet."
        />
      ) : null}
      {passers.length === 0 && rushers.length === 0 && receivers.length === 0 ? (
        <p className="px-[26px] py-3 text-dense" style={{ color: C.faintMono }}>No box score yet.</p>
      ) : null}
    </div>
  );
}

/** Shared NFL/CFB Live tab — both sports are the exact same ESPN shape (see `footballLiveGame.ts`'s header comment), so one component covers both, parameterized by `sport` for the fetch route and `notStartedText`'s wording only. */
export function FootballLiveTab({
  sport,
  eventId,
  away,
  home,
  active,
  isFinal,
}: {
  sport: 'nfl' | 'cfb';
  eventId: string;
  away: GameHeroTeamPanelData;
  home: GameHeroTeamPanelData;
  active: boolean;
  isFinal: boolean;
}) {
  const { data, loading } = useFootballLiveGame(sport, eventId, active, isFinal ? null : 15_000);

  if (!data) {
    return <LiveTabEmptyState loading={loading} isFinal={isFinal} notStartedText="Kickoff hasn't happened yet — live details will show up here once the game starts." />;
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

  return (
    <div>
      <LiveBandHeader
        away={{ abbr: away.abbr, name: away.name, logoUrl: away.logoUrl }}
        home={{ abbr: home.abbr, name: home.name, logoUrl: home.logoUrl }}
        isFinal={isFinal}
        statusLabel={statusLabel}
        score={{ away: data.awayScore, home: data.homeScore }}
        subLabel={leadsText}
      />

      {(data.awayTopPasser || data.homeTopPasser) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2" style={{ borderBottom: `1px solid ${C.divider}` }}>
          {data.awayTopPasser ? (
            <LiveSpotlightCard role="PASSING" name={data.awayTopPasser.name} teamAbbr={away.abbr} teamLogoUrl={away.logoUrl} statLine={data.awayTopPasser.statLine} border="right" />
          ) : null}
          {data.homeTopPasser ? (
            <LiveSpotlightCard role="PASSING" name={data.homeTopPasser.name} teamAbbr={home.abbr} teamLogoUrl={home.logoUrl} statLine={data.homeTopPasser.statLine} />
          ) : null}
        </div>
      ) : null}

      <div style={{ borderBottom: `1px solid ${C.divider}` }}>
        <div className="flex items-center justify-between px-[26px] pt-4">
          <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>FULL BOX SCORE — EVERY PLAYER</div>
          {!isFinal ? (
            <div className="flex items-center gap-1.5 text-meta font-medium" style={{ color: C.olive }}>
              <span className="h-1.5 w-1.5 animate-lb-pulse rounded-full" style={{ backgroundColor: C.olive }} />
              UPDATING LIVE
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <TeamStatTables teamAbbr={away.abbr} teamLogoUrl={away.logoUrl} players={data.playersByTeam[away.abbr] ?? []} />
          <TeamStatTables teamAbbr={home.abbr} teamLogoUrl={home.logoUrl} players={data.playersByTeam[home.abbr] ?? []} />
        </div>
      </div>

      <LivePeriodStrip title="BY QUARTER" segments={segments} currentIndex={data.period} />

      <div className="px-[26px] py-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
        <div className="mb-1 text-meta tracking-[.1em]" style={{ color: C.faintMono }}>SCORING PLAYS</div>
        {data.scoringPlays.length === 0 ? (
          <p className="py-1 text-dense" style={{ color: C.faintMono }}>No scores yet.</p>
        ) : (
          data.scoringPlays.map((p, i) => (
            <LiveEventRow
              key={i}
              primary={p.teamAbbr === 'away' ? away.abbr : p.teamAbbr === 'home' ? home.abbr : ''}
              secondary={`${p.description.trim()} · Q${p.period} ${p.clockDisplay}`}
              badgeText={`${p.awayScore}–${p.homeScore}`}
              highlighted
            />
          ))
        )}
      </div>

      {(data.teamStats.away.length > 0 || data.teamStats.home.length > 0) ? (
        <div className="px-[26px] py-3">
          <div className="mb-2 flex items-center justify-between text-micro uppercase tracking-wide" style={{ color: C.faintMono }}>
            <span>{away.abbr}</span>
            <span>Team stats</span>
            <span>{home.abbr}</span>
          </div>
          {data.teamStats.home.map((homeStat, i) => {
            const awayStat = data.teamStats.away[i];
            if (!awayStat) return null;
            return (
              <div key={homeStat.label} className="flex items-center justify-between py-1 text-dense" style={{ borderTop: i > 0 ? `1px solid ${C.divider}` : undefined }}>
                <span className="w-16 text-left tabular-nums font-medium" style={{ color: C.ink }}>{awayStat.displayValue}</span>
                <span className="text-label uppercase tracking-wide" style={{ color: C.faintMono }}>{homeStat.label}</span>
                <span className="w-16 text-right tabular-nums font-medium" style={{ color: C.ink }}>{homeStat.displayValue}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
