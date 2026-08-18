'use client';

import { TeamLogo, nflTeamLogoUrl } from './SubjectAvatar';
import { teamPrimaryColor, withAlpha } from '@/lib/sports/nfl/teamColors';
import type { TeamGrade } from '@/lib/sports/nfl/nflTeamGrades';
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { GameSituationStrip } from '@/lib/sports/nfl/liveGameState';
import { formatAmerican } from '@/lib/odds/display';

export interface NflGameHeroTeam {
  abbr: string;
  displayName: string;
  wins: number;
  losses: number;
  grades: { offense: TeamGrade | null; defense: TeamGrade | null; specialTeams: TeamGrade | null } | null;
}

export function GradeChip({ label, grade }: { label: string; grade: TeamGrade | null }) {
  if (!grade) return null;
  return (
    <span className="lb-chip bg-ink/5 text-[10px] font-semibold text-ink-muted" title={`${label}: rank ${grade.rank} of ${grade.poolSize}`}>
      {label} {grade.grade}
    </span>
  );
}

function TeamPanel({ team, align }: { team: NflGameHeroTeam; align: 'left' | 'right' }) {
  const logoUrl = nflTeamLogoUrl(team.abbr);
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2.5 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo logoUrl={logoUrl} abbreviation={team.abbr} size={40} />
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold">{team.displayName}</p>
        <p className="text-[11px] text-ink-muted">{team.wins}-{team.losses}</p>
        <div className={`mt-1 flex flex-wrap gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
          <GradeChip label="OFF" grade={team.grades?.offense ?? null} />
          <GradeChip label="DEF" grade={team.grades?.defense ?? null} />
          <GradeChip label="ST" grade={team.grades?.specialTeams ?? null} />
        </div>
      </div>
    </div>
  );
}

function CenterStatus({
  kickoff,
  liveState,
  gameLine,
}: {
  kickoff: string;
  liveState: GameSituationStrip | null;
  gameLine: UnifiedGameLine | null;
}) {
  if (liveState) {
    const possessionAbbr = liveState.possessionTeamId ?? null;
    return (
      <div className="flex min-w-[120px] flex-col items-center gap-1 text-center">
        <span className="lb-chip bg-bad/10 text-[10px] font-bold uppercase tracking-wide text-bad">Live</span>
        <span className="text-[15px] font-bold tabular-nums">{liveState.awayScore ?? 0}–{liveState.homeScore ?? 0}</span>
        <span className="text-[11px] text-ink-muted">
          {liveState.period ? `Q${liveState.period}` : ''} {liveState.displayClock ?? ''}
        </span>
        {liveState.down != null && liveState.distance != null ? (
          <span className="text-[10px] text-ink-faint">
            {liveState.down === 1 ? '1st' : liveState.down === 2 ? '2nd' : liveState.down === 3 ? '3rd' : '4th'} &amp; {liveState.distance}
            {liveState.yardLine != null ? ` at ${liveState.yardLine}` : ''}
            {possessionAbbr ? ` · ${possessionAbbr} ball` : ''}
            {liveState.isRedZone ? ' · Red zone' : ''}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-[120px] flex-col items-center gap-1 text-center">
      <span className="text-[11px] text-ink-muted">{new Date(kickoff).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      {gameLine ? (
        <div className="flex flex-col items-center gap-0.5 text-[10.5px]">
          {gameLine.moneyline ? (
            <span className="tabular-nums text-ink-muted">
              ML {formatAmerican(gameLine.moneyline.away)} / {formatAmerican(gameLine.moneyline.home)}
            </span>
          ) : null}
          {gameLine.spread ? (
            <span className="tabular-nums text-ink-faint">
              Spread {gameLine.spread.homePoint != null ? (gameLine.spread.homePoint > 0 ? `+${gameLine.spread.homePoint}` : gameLine.spread.homePoint) : '—'}
            </span>
          ) : null}
          {gameLine.total?.point != null ? <span className="tabular-nums text-ink-faint">O/U {gameLine.total.point}</span> : null}
        </div>
      ) : (
        <span className="text-[10.5px] text-ink-faint">No game line yet</span>
      )}
    </div>
  );
}

export interface NflGameHeroCardProps {
  home: NflGameHeroTeam;
  away: NflGameHeroTeam;
  kickoff: string;
  liveState: GameSituationStrip | null;
  gameLine: UnifiedGameLine | null;
}

export function NflGameHeroCard({ home, away, kickoff, liveState, gameLine }: NflGameHeroCardProps) {
  return (
    <section
      className="lb-card-hero overflow-hidden"
      style={{
        background: `linear-gradient(90deg, ${withAlpha(teamPrimaryColor(away.abbr), '20')} 0%, #ffffff 50%, ${withAlpha(teamPrimaryColor(home.abbr), '20')} 100%)`,
        borderTop: '3px solid #141619',
      }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <TeamPanel team={away} align="left" />
        <CenterStatus kickoff={kickoff} liveState={liveState} gameLine={gameLine} />
        <TeamPanel team={home} align="right" />
      </div>
    </section>
  );
}

export default NflGameHeroCard;
