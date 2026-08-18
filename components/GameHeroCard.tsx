'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { RecentGameResult } from '@/lib/sports/mlb/statsapi';
import type { RecommendedMoneylinePick, TotalLean } from '@/lib/odds/recommendedPick';
import type { GamePickView } from './useGamePickRecord';
import { TeamLogo, mlbTeamLogoUrl, SubjectAvatar, mlbHeadshotUrl } from './SubjectAvatar';
import { LockIcon, ClockIcon } from './icons';
import { useLiveGame } from './useLiveGame';
import { useBullpen, type TeamBullpen, type RankedPitcherSummary } from './useBullpen';
import { computeStreak, type GameDetailGame } from './GameDetail';
import { teamPrimaryColor, withAlpha } from '@/lib/sports/mlb/teamColors';
import type { BoxScoreTeam, BoxScoreBatter, BoxScorePitcher, LiveInningPlay, LiveTotals } from '@/lib/sports/mlb/liveGame';

/**
 * Game hero card — top-of-page matchup summary, rebuilt against
 * `Game Hero Card.html`. A Matchup/Live tab pair sits over the same
 * team/pick/weather footer: Matchup is the always-available overview (score
 * or first pitch, Linesmith's picks, venue/weather), Live is a detailed
 * in-game view (count/outs/bases, by-inning line score, live pitching
 * lines) only meaningful — and only enabled — once the game is actually in
 * progress.
 *
 * `C` used to be this card's own one-off palette, independent of the shared
 * `masters`/`ink-*` tokens the rest of the redesigned cards use — that
 * independence was the root of a real inconsistency (this card's "home"
 * read differently than every other card's). It's now a local alias of the
 * shared tokens, kept as an object purely for call-site brevity in a file
 * this dense with inline styles — every value below is copied straight
 * from tailwind.config.ts, not invented here. Only the `live*` values stay
 * genuinely local, since they're the one surface (the live-inning band)
 * dark enough that nothing in the existing token set covers it — those are
 * now the `live` token group in tailwind.config.ts instead of one-off hex.
 */

const C = {
  cardBorder: '#d3d4d7', // line
  divider: '#dcdee1', // line-soft
  tabTrack: '#f1f2f3', // surface-subtle
  tabActiveBg: '#0c0d0f', // ink
  tabActiveText: '#f1f2f3', // paper
  tabInactiveText: '#7f8083', // ink-soft
  faintMono: '#97989b', // ink-faint
  ink: '#0c0d0f', // ink
  recordText: '#616366', // ink-muted
  pulseDot: '#0f7a4f', // good — genuine live/positive signal, stays green
  statusPillBg: '#d9dbdd', // accent-soft
  olive: '#0f7a4f', // good — genuine live/positive signal, stays green
  liveBandBg: '#111213', // live-bg
  liveGreen: '#a8d5b5', // live-green — the pulse dot + live status text itself (genuine live signal), not decorative — stays green
  liveMuted: '#535559', // live-muted
  liveSecondary: '#7e8083', // live-secondary
  inningCurrentBg: '#d9dbdd', // accent-soft
  inningCurrentBorder: '#70727466', // accent, 40% alpha
  inningBg: '#f1f2f3', // surface-subtle
  inningFuture: '#b6b7ba', // ink-disabled
  weatherEmpty: '#d3d4d7', // line
};

function fmtRecord(r: { wins: number; losses: number } | null): string {
  return r ? `${r.wins}-${r.losses}` : '—';
}

function streakLabel(streak: number): string | null {
  if (streak === 0) return null;
  return streak > 0 ? `W${streak}` : `L${-streak}`;
}

function ChangedBadge({ from }: { from: string }) {
  return (
    <span className="lb-chip bg-warn/15 text-warn" title={`Locked pick differs from the 6am read: ${from}`}>
      ↺ changed
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared footer
// ---------------------------------------------------------------------------

const WIND_COMPASS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/** Low/Med/High is a placeholder heuristic (wind + rain thresholds), not a model output — there's no real weather-impact model in the codebase yet. */
function weatherImpact(weather: { windMph?: number; rainPct?: number }): { level: 'Low' | 'Medium' | 'High'; segments: number } {
  const wind = weather.windMph ?? 0;
  const rain = weather.rainPct ?? 0;
  if (wind >= 15 || rain >= 40) return { level: 'High', segments: 3 };
  if (wind >= 8 || rain >= 15) return { level: 'Medium', segments: 2 };
  return { level: 'Low', segments: 1 };
}

function VenueForecastFooter({
  venue,
  weather,
  weatherNarrative,
}: {
  venue?: string;
  weather?: { tempF?: number; windMph?: number; windDir?: string; rainPct?: number };
  weatherNarrative?: string | null;
}) {
  const impact = weather ? weatherImpact(weather) : null;
  const bearing = weather?.windDir ? WIND_COMPASS[weather.windDir.toUpperCase()] : undefined;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 px-[26px] pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
        <div className="text-title font-semibold" style={{ color: C.ink }}>
          {venue ?? '—'}
        </div>
        {weather ? (
          <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>
            GAME-TIME FORECAST
          </div>
        ) : null}
      </div>
      {weather ? (
        <div className="grid grid-cols-2 gap-x-0 gap-y-3 px-[26px] pb-5 pt-3.5 sm:grid-cols-4">
          <div className="flex flex-col gap-1 pr-[18px]">
            <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>TEMP</div>
            <div className="text-display-sm font-bold tabular-nums tracking-[-.02em]" style={{ color: C.ink }}>
              {weather.tempF != null ? `${Math.round(weather.tempF)}°F` : '—'}
            </div>
            <div className="text-dense" style={{ color: C.recordText }}>{weatherNarrative ?? ''}</div>
          </div>
          <div className="flex flex-col gap-1 px-[18px]" style={{ borderLeft: `1px solid ${C.divider}` }}>
            <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>WIND</div>
            <div className="flex items-baseline gap-1.5 text-display-sm font-bold tabular-nums tracking-[-.02em]" style={{ color: C.ink }}>
              {weather.windMph != null ? (
                <>
                  <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: bearing != null ? `rotate(${bearing}deg)` : undefined }}>
                    <path d="M8 1.5v13M8 1.5 4.5 6M8 1.5 11.5 6" />
                  </svg>
                  {weather.windMph}
                  <span className="text-emphasis font-medium" style={{ color: C.tabInactiveText }}>mph {weather.windDir ?? ''}</span>
                </>
              ) : '—'}
            </div>
            <div className="text-dense" style={{ color: C.recordText }}>&nbsp;</div>
          </div>
          <div className="flex flex-col gap-1 px-[18px]" style={{ borderLeft: `1px solid ${C.divider}` }}>
            <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>RAIN</div>
            <div className="text-display-sm font-bold tabular-nums tracking-[-.02em]" style={{ color: C.ink }}>
              {weather.rainPct != null ? `${Math.round(weather.rainPct)}%` : '—'}
            </div>
            <div className="text-dense" style={{ color: C.recordText }}>&nbsp;</div>
          </div>
          {impact ? (
            <div className="flex flex-col gap-1.5 pl-[18px]" style={{ borderLeft: `1px solid ${C.divider}` }}>
              <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>WEATHER IMPACT</div>
              <div className="text-display-sm font-bold tracking-[-.02em]" style={{ color: C.ink }}>{impact.level}</div>
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-1.5 w-7 rounded-full" style={{ backgroundColor: i < impact.segments ? C.olive : C.weatherEmpty }} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pick panel (winner / total)
// ---------------------------------------------------------------------------

function PickPanel({
  label,
  headline,
  percent,
  locked,
  lockTime,
  changedFrom,
  border,
}: {
  label: string;
  headline: string | null;
  percent: number | null;
  locked: boolean;
  lockTime: Date | null;
  changedFrom: string | null;
  border?: 'right';
}) {
  return (
    <div
      className="flex flex-col gap-2.5 px-[26px] py-[18px]"
      style={border === 'right' ? { borderRight: `1px solid ${C.divider}` } : undefined}
    >
      <div className="text-meta tracking-[.12em]" style={{ color: C.faintMono }}>{label}</div>
      {headline ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div className="text-display-sm font-bold" style={{ color: C.ink }}>{headline}</div>
            {percent != null ? (
              <div className="rounded-lg px-2.5 py-1 text-body font-medium tabular-nums text-white" style={{ backgroundColor: C.olive }}>
                {percent}%
              </div>
            ) : null}
          </div>
          {percent != null ? (
            <div className="h-1 overflow-hidden rounded-full" style={{ backgroundColor: C.divider }}>
              <div className="h-full" style={{ width: `${percent}%`, backgroundColor: C.olive }} />
            </div>
          ) : null}
          <div className="flex items-center gap-1.5 text-meta" style={{ color: C.faintMono }}>
            {locked ? (
              <span className="inline-flex items-center gap-1"><LockIcon size={9} /> Locked</span>
            ) : lockTime ? (
              <span className="inline-flex items-center gap-1" title="This lean can still move until it locks 3 hours before first pitch.">
                <ClockIcon size={9} /> Locks at {lockTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            ) : (
              'Provisional'
            )}
            {changedFrom ? <ChangedBadge from={changedFrom} /> : null}
          </div>
        </>
      ) : (
        <div className="text-body" style={{ color: C.tabInactiveText }}>—</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matchup tab
// ---------------------------------------------------------------------------

function TeamPanel({
  side,
  abbr,
  teamId,
  name,
  record,
  divisionRank,
  streak,
}: {
  side: 'away' | 'home';
  abbr: string;
  teamId?: number;
  name?: string;
  record: { wins: number; losses: number } | null;
  divisionRank: string | null;
  streak: number;
}) {
  const away = side === 'away';
  const meta = [fmtRecord(record), divisionRank ? `${divisionRank} in division` : null, streakLabel(streak)].filter(Boolean).join(' · ');
  // A soft wash of the team's own primary color rather than a fixed
  // cream/blue pair — every matchup reads in that team's own colors instead
  // of an arbitrary away/home palette.
  const tint = withAlpha(teamPrimaryColor(teamId), '26');
  return (
    <Link
      href={teamId ? `/mlb/team/${teamId}` : '#'}
      className={`flex flex-col gap-2.5 px-[26px] py-7 ${away ? '' : 'items-end text-right'}`}
      style={{
        background: away
          ? `linear-gradient(90deg, ${tint}, #ffffff)`
          : `linear-gradient(270deg, ${tint}, #ffffff)`,
      }}
    >
      <div className={`flex items-center gap-3 ${away ? '' : 'flex-row-reverse'}`}>
        <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-white" style={{ border: `1px solid ${C.cardBorder}` }}>
          <TeamLogo logoUrl={mlbTeamLogoUrl(teamId)} size={36} />
        </div>
        <div>
          <div className="text-meta tracking-[.12em]" style={{ color: C.faintMono }}>{away ? 'AWAY' : 'HOME'}</div>
          <div className="text-display-sm font-bold tracking-[-.02em]" style={{ color: C.ink }}>{name ?? abbr}</div>
        </div>
      </div>
      <div className="text-body" style={{ color: C.recordText }}>{meta || '—'}</div>
    </Link>
  );
}

function CenterStatus({
  isLive,
  isFinal,
  liveScore,
  livePeriod,
  firstPitch,
}: {
  isLive: boolean;
  isFinal: boolean;
  liveScore?: { home: string; away: string };
  livePeriod?: string;
  firstPitch: string | null | undefined;
}) {
  if (isLive && liveScore) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1.5 px-[30px] py-7"
        style={{ borderLeft: `1px solid ${C.divider}`, borderRight: `1px solid ${C.divider}` }}
      >
        <div className="text-display-lg font-extrabold leading-none tabular-nums tracking-[-.04em]" style={{ color: C.ink }}>
          {liveScore.away}–{liveScore.home}
        </div>
        {livePeriod ? (
          <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ backgroundColor: C.statusPillBg }}>
            <span className="h-1.5 w-1.5 animate-lb-pulse rounded-full" style={{ backgroundColor: C.pulseDot }} />
            <span className="text-meta font-medium uppercase tracking-[.1em]" style={{ color: C.pulseDot }}>{livePeriod}</span>
          </div>
        ) : null}
      </div>
    );
  }
  if (isFinal) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1.5 px-[30px] py-7"
        style={{ borderLeft: `1px solid ${C.divider}`, borderRight: `1px solid ${C.divider}` }}
      >
        <div className="text-display-lg font-extrabold leading-none tabular-nums tracking-[-.04em]" style={{ color: C.tabInactiveText }}>
          {liveScore ? `${liveScore.away}–${liveScore.home}` : '—'}
        </div>
        <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>FINAL</div>
      </div>
    );
  }
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 px-[30px] py-7"
      style={{ borderLeft: `1px solid ${C.divider}`, borderRight: `1px solid ${C.divider}` }}
    >
      <div className="text-display-sm font-bold" style={{ color: C.ink }}>
        {firstPitch ? new Date(firstPitch).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD'}
      </div>
      <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>FIRST PITCH</div>
    </div>
  );
}

function MatchupTab({
  game,
  isLive,
  isFinal,
  liveScore,
  awayRecent,
  homeRecent,
  recommendedPick,
  totalLean,
  gamePick,
  pickLoading,
}: {
  game: GameDetailGame;
  isLive: boolean;
  isFinal: boolean;
  liveScore?: { home: string; away: string };
  awayRecent?: { recent: RecentGameResult[] };
  homeRecent?: { recent: RecentGameResult[] };
  recommendedPick?: RecommendedMoneylinePick | null;
  totalLean?: TotalLean | null;
  gamePick: GamePickView | null;
  pickLoading?: boolean;
}) {
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());

  const mlLocked = gamePick?.moneyline.locked ?? false;
  const mlSide: 'home' | 'away' | null = mlLocked ? gamePick?.moneyline.pickSide ?? null : recommendedPick?.side ?? null;
  const mlTeam = mlLocked
    ? gamePick?.moneyline.pickTeamName ?? null
    : recommendedPick
      ? (recommendedPick.side === 'home' ? gamePick?.homeTeamName : gamePick?.awayTeamName) ?? (recommendedPick.side === 'home' ? homeAbbr : awayAbbr)
      : null;
  const mlPercent = mlLocked ? gamePick?.moneyline.confidence?.pct ?? null : recommendedPick ? Math.round(recommendedPick.modelProb * 100) : null;

  const totalLocked = gamePick?.total.locked ?? false;
  const totalSide = totalLocked ? gamePick?.total.pickSide : totalLean?.side ?? null;
  const totalLine = totalLocked ? gamePick?.total.line : totalLean?.line ?? null;
  const totalPercent = totalLocked ? gamePick?.total.confidence?.pct ?? null : totalLean ? Math.round(totalLean.probability * 100) : null;
  const totalHeadline = totalSide ? `${totalSide === 'over' ? 'Over' : 'Under'} ${totalLine ?? ''}` : null;

  const lockTime = game.firstPitch ? new Date(new Date(game.firstPitch).getTime() - 3 * 60 * 60 * 1000) : null;

  const showPicks = pickLoading || mlTeam || totalHeadline;

  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_1fr]">
        <TeamPanel
          side="away"
          abbr={awayAbbr}
          teamId={game.awayTeamId}
          name={game.awayTeamName ?? awayAbbr}
          record={game.away?.record ?? null}
          divisionRank={game.away?.divisionRank ?? null}
          streak={computeStreak((awayRecent?.recent ?? []).slice(0, 5))}
        />
        <CenterStatus isLive={isLive} isFinal={isFinal} liveScore={liveScore} livePeriod={game.livePeriod} firstPitch={game.firstPitch} />
        <TeamPanel
          side="home"
          abbr={homeAbbr}
          teamId={game.homeTeamId}
          name={game.homeTeamName ?? homeAbbr}
          record={game.home?.record ?? null}
          divisionRank={game.home?.divisionRank ?? null}
          streak={computeStreak((homeRecent?.recent ?? []).slice(0, 5))}
        />
      </div>

      {showPicks ? (
        pickLoading && !mlTeam && !totalHeadline ? (
          <div className="grid grid-cols-1 gap-px sm:grid-cols-2" style={{ backgroundColor: C.divider, borderTop: `1px solid ${C.divider}` }}>
            <div className="h-[86px] animate-pulse bg-white" />
            <div className="h-[86px] animate-pulse bg-white" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-px sm:grid-cols-2" style={{ backgroundColor: C.divider, borderTop: `1px solid ${C.divider}` }}>
            <div className="bg-white">
              <PickPanel
                label="PICK · WINNER"
                headline={mlTeam}
                percent={mlPercent}
                locked={mlLocked}
                lockTime={lockTime}
                changedFrom={gamePick?.moneyline.changed && gamePick.moneyline.initialTeamName ? gamePick.moneyline.initialTeamName : null}
              />
            </div>
            <div className="bg-white">
              <PickPanel
                label="PICK · TOTAL"
                headline={totalHeadline}
                percent={totalPercent}
                locked={totalLocked}
                lockTime={lockTime}
                changedFrom={
                  gamePick?.total.changed && gamePick.total.initialSide
                    ? `${gamePick.total.initialSide === 'over' ? 'Over' : 'Under'} ${gamePick.total.initialLine ?? ''}`
                    : null
                }
              />
            </div>
          </div>
        )
      ) : null}

      <VenueForecastFooter venue={game.venue} weather={game.weather} weatherNarrative={game.weatherNarrative} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live tab
// ---------------------------------------------------------------------------

function BasesDiamond({ bases }: { bases: { first: boolean; second: boolean; third: boolean } }) {
  const base = (filled: boolean) => (
    <div
      className="h-4 w-4 rotate-45 rounded-[2px]"
      style={filled ? { backgroundColor: C.liveGreen } : { border: `1.5px solid ${C.liveMuted}` }}
    />
  );
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="grid grid-cols-3 grid-rows-2 place-items-center gap-[3px]">
        <div />
        {base(bases.second)}
        <div />
        {base(bases.third)}
        <div />
        {base(bases.first)}
      </div>
      <div className="text-label tracking-[.1em]" style={{ color: C.liveSecondary }}>
        {[bases.first && '1ST', bases.second && '2ND', bases.third && '3RD'].filter(Boolean).length > 0
          ? `RUNNERS ON ${[bases.first && '1ST', bases.second && '2ND', bases.third && '3RD'].filter(Boolean).join(', ')}`
          : 'BASES EMPTY'}
      </div>
    </div>
  );
}

function InningPlayRow({ play }: { play: LiveInningPlay }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5" style={{ borderTop: `1px solid ${C.divider}` }}>
      <div className="min-w-0">
        <span className="text-dense font-medium" style={{ color: C.ink }}>{play.batter}</span>
        {play.description ? (
          <span className="text-dense" style={{ color: C.recordText }}> — {play.description}</span>
        ) : null}
      </div>
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-label font-medium tracking-[.04em]"
        style={{ backgroundColor: play.rbi > 0 ? C.statusPillBg : C.tabTrack, color: play.rbi > 0 ? C.olive : C.tabInactiveText }}
      >
        {play.event}{play.rbi > 0 ? ` · ${play.rbi} RBI` : ''}
      </span>
    </div>
  );
}

function InningDetail({
  inning,
  plays,
  awayAbbr,
  homeAbbr,
}: {
  inning: number;
  plays: LiveInningPlay[];
  awayAbbr: string;
  homeAbbr: string;
}) {
  const top = plays.filter((p) => p.inning === inning && p.half === 'top');
  const bottom = plays.filter((p) => p.inning === inning && p.half === 'bottom');
  return (
    <div className="rounded-lg px-3 py-2" style={{ backgroundColor: C.tabTrack, border: `1px solid ${C.divider}` }}>
      {top.length > 0 ? (
        <div className="mb-2">
          <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>TOP · {awayAbbr}</div>
          {top.map((p, i) => <InningPlayRow key={i} play={p} />)}
        </div>
      ) : null}
      {bottom.length > 0 ? (
        <div>
          <div className="text-meta tracking-[.1em]" style={{ color: C.faintMono }}>BOTTOM · {homeAbbr}</div>
          {bottom.map((p, i) => <InningPlayRow key={i} play={p} />)}
        </div>
      ) : null}
      {top.length === 0 && bottom.length === 0 ? (
        <p className="py-1 text-dense" style={{ color: C.faintMono }}>No play-by-play available for this inning.</p>
      ) : null}
    </div>
  );
}

function InningStrip({
  linescore,
  currentInning,
  totals,
  awayAbbr,
  homeAbbr,
  awayTeamId,
  homeTeamId,
  plays,
}: {
  linescore: { inning: number; away: number | null; home: number | null }[];
  currentInning: number;
  totals: { away: { r: number; h: number; e: number }; home: { r: number; h: number; e: number } };
  awayAbbr: string;
  homeAbbr: string;
  awayTeamId?: number;
  homeTeamId?: number;
  plays: LiveInningPlay[];
}) {
  const byInning = new Map(linescore.map((l) => [l.inning, l]));
  const innings = Array.from({ length: 9 }, (_, i) => i + 1);
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-2.5 px-[26px] py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-meta tracking-[.12em]" style={{ color: C.faintMono }}>
          BY INNING · <TeamLogo logoUrl={mlbTeamLogoUrl(awayTeamId)} size={12} /> {awayAbbr} · <TeamLogo logoUrl={mlbTeamLogoUrl(homeTeamId)} size={12} /> {homeAbbr}
        </div>
        <div className="text-dense tabular-nums" style={{ color: C.recordText }}>
          R {totals.away.r}–{totals.home.r} · H {totals.away.h}–{totals.home.h} · E {totals.away.e}–{totals.home.e}
        </div>
      </div>
      <div className="flex gap-1.5">
        {innings.map((n) => {
          const line = byInning.get(n);
          const played = Boolean(line);
          const current = n === currentInning;
          const isExpanded = expanded === n;
          return (
            <button
              key={n}
              type="button"
              disabled={!played}
              onClick={() => setExpanded((e) => (e === n ? null : n))}
              className="flex-1 rounded-lg py-1.5 text-center disabled:cursor-default"
              style={{
                border: isExpanded
                  ? `1px solid ${C.olive}`
                  : played
                    ? (current ? `1px solid ${C.inningCurrentBorder}` : `1px solid ${C.divider}`)
                    : `1px dashed ${C.divider}`,
                backgroundColor: isExpanded ? C.inningCurrentBg : current ? C.inningCurrentBg : undefined,
                cursor: played ? 'pointer' : 'default',
              }}
            >
              <div className="text-label tabular-nums" style={{ color: played ? (current || isExpanded ? C.olive : C.faintMono) : C.inningFuture }}>{n}</div>
              <div
                className="text-body tabular-nums"
                style={{ color: played ? (current || isExpanded ? C.olive : C.ink) : C.inningFuture, fontWeight: current || isExpanded ? 500 : 400 }}
              >
                {played ? `${line?.away ?? '–'} · ${line?.home ?? '–'}` : '·'}
              </div>
            </button>
          );
        })}
      </div>
      {expanded != null ? (
        <InningDetail inning={expanded} plays={plays} awayAbbr={awayAbbr} homeAbbr={homeAbbr} />
      ) : null}
    </div>
  );
}

function CurrentPitcherSpotlight({
  pitcher,
  teamAbbr,
  teamId,
  border,
}: {
  pitcher: { id: number; name: string; ip: string; h: number; r: number; k: number; pitches: number };
  teamAbbr: string;
  teamId?: number;
  border?: 'right';
}) {
  return (
    <div
      className="flex items-center gap-3 px-[26px] py-4"
      style={border === 'right' ? { borderRight: `1px solid ${C.divider}` } : undefined}
    >
      <SubjectAvatar name={pitcher.name} headshotUrl={mlbHeadshotUrl(pitcher.id)} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-meta tracking-[.1em]" style={{ color: C.faintMono }}>
          <TeamLogo logoUrl={mlbTeamLogoUrl(teamId)} size={13} /> ON THE MOUND · {teamAbbr}
        </div>
        <div className="truncate text-title font-semibold" style={{ color: C.ink }}>{pitcher.name}</div>
        <div className="text-dense tabular-nums" style={{ color: C.recordText }}>
          {pitcher.ip} IP · {pitcher.h} H · {pitcher.r} R · {pitcher.k} K · {pitcher.pitches} P
        </div>
      </div>
    </div>
  );
}

function CurrentBatterSpotlight({
  batter,
  teamAbbr,
  teamId,
}: {
  batter: { id: number; name: string; todayLine: string };
  teamAbbr: string;
  teamId?: number;
}) {
  return (
    <div className="flex items-center gap-3 px-[26px] py-4">
      <SubjectAvatar name={batter.name} headshotUrl={mlbHeadshotUrl(batter.id)} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-meta tracking-[.1em]" style={{ color: C.faintMono }}>
          <TeamLogo logoUrl={mlbTeamLogoUrl(teamId)} size={13} /> AT THE PLATE · {teamAbbr}
        </div>
        <div className="truncate text-title font-semibold" style={{ color: C.ink }}>{batter.name}</div>
        <div className="text-dense tabular-nums" style={{ color: C.recordText }}>{batter.todayLine}</div>
      </div>
    </div>
  );
}

function BoxScoreTable({ team, teamAbbr, teamId }: { team: BoxScoreTeam; teamAbbr: string; teamId?: number }) {
  return (
    <div className="px-[26px] py-4">
      <div className="mb-2 flex items-center gap-2">
        <TeamLogo logoUrl={mlbTeamLogoUrl(teamId)} size={18} />
        <span className="text-title font-semibold" style={{ color: C.ink }}>{teamAbbr}</span>
        <span className="ml-auto text-dense tabular-nums" style={{ color: C.recordText }}>
          R {team.totals.r} · H {team.totals.h} · E {team.totals.e}
        </span>
      </div>
      {team.batters.length === 0 ? (
        <p className="py-1 text-dense" style={{ color: C.faintMono }}>No plate appearances yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-dense">
            <thead>
              <tr style={{ color: C.faintMono }}>
                <th className="py-1 text-left font-medium">Batter</th>
                <th className="py-1 text-center font-medium">Pos</th>
                <th className="py-1 text-right font-medium">AB</th>
                <th className="py-1 text-right font-medium">R</th>
                <th className="py-1 text-right font-medium">H</th>
                <th className="py-1 text-right font-medium">RBI</th>
                <th className="py-1 text-right font-medium">BB</th>
                <th className="py-1 text-right font-medium">K</th>
              </tr>
            </thead>
            <tbody>
              {team.batters.map((b: BoxScoreBatter) => (
                <tr key={b.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      <SubjectAvatar name={b.name} headshotUrl={mlbHeadshotUrl(b.id)} size={20} />
                      <span className="truncate" style={{ color: C.ink }}>{b.name}</span>
                    </span>
                  </td>
                  <td className="py-1.5 text-center" style={{ color: C.recordText }}>{b.position}</td>
                  <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{b.atBats}</td>
                  <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{b.runs}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold" style={{ color: C.ink }}>{b.hits}</td>
                  <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{b.rbi}</td>
                  <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{b.walks}</td>
                  <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{b.strikeOuts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {team.pitchers.length > 0 ? (
        <>
          <div className="mb-1 mt-3 text-meta tracking-[.1em]" style={{ color: C.faintMono }}>PITCHING</div>
          <div className="overflow-x-auto">
            <table className="w-full text-dense">
              <thead>
                <tr style={{ color: C.faintMono }}>
                  <th className="py-1 text-left font-medium">Pitcher</th>
                  <th className="py-1 text-right font-medium">IP</th>
                  <th className="py-1 text-right font-medium">H</th>
                  <th className="py-1 text-right font-medium">R</th>
                  <th className="py-1 text-right font-medium">ER</th>
                  <th className="py-1 text-right font-medium">BB</th>
                  <th className="py-1 text-right font-medium">K</th>
                  <th className="py-1 text-right font-medium">P</th>
                </tr>
              </thead>
              <tbody>
                {team.pitchers.map((p: BoxScorePitcher) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5">
                        <SubjectAvatar name={p.name} headshotUrl={mlbHeadshotUrl(p.id)} size={20} />
                        <span className="truncate" style={{ color: C.ink }}>{p.name}</span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{p.inningsPitched}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{p.hits}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{p.runs}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{p.earnedRuns}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{p.walks}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{p.strikeOuts}</td>
                    <td className="py-1.5 text-right tabular-nums" style={{ color: C.recordText }}>{p.pitches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ReliefRow({ pitcher, role }: { pitcher: RankedPitcherSummary; role: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5" style={{ borderTop: `1px solid ${C.divider}` }}>
      <SubjectAvatar name={pitcher.fullName} headshotUrl={mlbHeadshotUrl(pitcher.personId)} size={26} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-dense font-medium" style={{ color: C.ink }}>{pitcher.fullName}</div>
        <div className="text-meta" style={{ color: C.faintMono }}>{role}</div>
      </div>
      {pitcher.overallRank != null ? (
        <span className="text-dense tabular-nums" style={{ color: C.recordText }}>#{pitcher.overallRank}</span>
      ) : null}
    </div>
  );
}

function BullpenTeam({ bullpen, teamAbbr, teamId }: { bullpen: TeamBullpen | undefined; teamAbbr: string; teamId?: number }) {
  const hasAny = bullpen?.closer != null || (bullpen?.setup?.length ?? 0) > 0;
  return (
    <div className="px-[26px] py-4">
      <div className="mb-1 flex items-center gap-2">
        <TeamLogo logoUrl={mlbTeamLogoUrl(teamId)} size={18} />
        <span className="text-title font-semibold" style={{ color: C.ink }}>{teamAbbr} bullpen</span>
      </div>
      {bullpen?.closer ? <ReliefRow pitcher={bullpen.closer} role="Closer" /> : null}
      {(bullpen?.setup ?? []).map((p) => (
        <ReliefRow key={p.personId} pitcher={p} role="Setup" />
      ))}
      {!hasAny ? <p className="py-2 text-dense" style={{ color: C.faintMono }}>No ranked relievers available.</p> : null}
    </div>
  );
}

type LiveSubTab = 'situation' | 'boxscore' | 'bullpen';

function LiveSubTabBar({ subTab, onChange }: { subTab: LiveSubTab; onChange: (t: LiveSubTab) => void }) {
  const tabs: Array<{ key: LiveSubTab; label: string }> = [
    { key: 'situation', label: 'Situation' },
    { key: 'boxscore', label: 'Box Score' },
    { key: 'bullpen', label: 'Bullpen' },
  ];
  return (
    <div className="flex gap-1.5 px-[26px] py-2.5" style={{ borderBottom: `1px solid ${C.divider}`, backgroundColor: C.tabTrack }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className="rounded-full px-3 py-1 text-dense font-medium tracking-[.04em]"
          style={{
            backgroundColor: subTab === t.key ? C.tabActiveBg : 'transparent',
            color: subTab === t.key ? C.tabActiveText : C.tabInactiveText,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function LiveTeamPanel({
  side,
  abbr,
  teamId,
  name,
  totals,
}: {
  side: 'away' | 'home';
  abbr: string;
  teamId?: number;
  name?: string;
  totals: LiveTotals;
}) {
  const away = side === 'away';
  return (
    <div className={`flex flex-col gap-2.5 px-[26px] py-7 ${away ? '' : 'items-end text-right'}`}>
      <div className={`flex items-center gap-3 ${away ? '' : 'flex-row-reverse'}`}>
        <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-white/5" style={{ border: `1px solid ${C.liveMuted}` }}>
          <TeamLogo logoUrl={mlbTeamLogoUrl(teamId)} size={36} />
        </div>
        <div>
          <div className="text-meta tracking-[.12em]" style={{ color: C.liveSecondary }}>{away ? 'AWAY' : 'HOME'}</div>
          <div className="text-display-sm font-bold tracking-[-.02em] text-white">{name ?? abbr}</div>
        </div>
      </div>
      <div className="text-body tabular-nums" style={{ color: C.liveSecondary }}>{totals.h} H · {totals.e} E</div>
    </div>
  );
}

function LiveCenterStatus({
  isFinal,
  inning,
  outs,
  count,
  score,
  leadsText,
  bases,
}: {
  isFinal: boolean;
  inning: { half: 'top' | 'bottom'; ordinal: string };
  outs: number;
  count: { balls: number; strikes: number };
  score: { home: number; away: number };
  leadsText: string;
  bases: { first: boolean; second: boolean; third: boolean } | null;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2.5 px-[24px] py-7"
      style={{ borderLeft: `1px solid ${C.liveMuted}`, borderRight: `1px solid ${C.liveMuted}` }}
    >
      {isFinal ? (
        <span className="text-meta font-medium tabular-nums tracking-[.14em]" style={{ color: C.liveSecondary }}>FINAL</span>
      ) : (
        <div className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 animate-lb-pulse rounded-full" style={{ backgroundColor: C.liveGreen }} />
          <span className="text-meta font-medium tabular-nums tracking-[.14em]" style={{ color: C.liveGreen }}>
            {inning.half.toUpperCase()} {inning.ordinal.toUpperCase()} · {outs} OUT{outs === 1 ? '' : 'S'} · {count.balls}–{count.strikes} COUNT
          </span>
        </div>
      )}
      <div className="text-display-lg font-extrabold leading-none tabular-nums tracking-[-.04em] text-white">
        {score.away}–{score.home}
      </div>
      <div className="text-dense" style={{ color: C.liveSecondary }}>{leadsText}</div>
      {bases ? <BasesDiamond bases={bases} /> : null}
    </div>
  );
}

function LiveTab({
  game,
  gamePk,
  active,
  isFinal,
}: {
  game: GameDetailGame;
  gamePk: string | number | undefined;
  active: boolean;
  isFinal: boolean;
}) {
  const { data, loading } = useLiveGame(gamePk, active, isFinal ? null : 15_000);
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
  const [subTab, setSubTab] = useState<LiveSubTab>('situation');
  const bullpen = useBullpen(game.awayTeamId, game.homeTeamId);

  if (!data) {
    return (
      <div className="px-[26px] py-10 text-center text-body" style={{ color: C.recordText }}>
        {loading
          ? 'Loading live details…'
          : isFinal
            ? 'Live details are unavailable for this game.'
            : "First pitch hasn't been thrown yet — live details will show up here once the game starts."}
      </div>
    );
  }

  const leadDiff = data.score.home - data.score.away;
  const leadsText = leadDiff === 0 ? 'Tied' : leadDiff > 0 ? `${homeAbbr} leads` : `${awayAbbr} leads`;
  // Baseball's own rule: away bats the top half, home bats the bottom — so
  // whichever team isn't at bat is the one currently pitching.
  const pitchingSide: 'away' | 'home' = data.inning.half === 'top' ? 'home' : 'away';
  const pitchingAbbr = pitchingSide === 'home' ? homeAbbr : awayAbbr;
  const pitchingTeamId = pitchingSide === 'home' ? game.homeTeamId : game.awayTeamId;
  const battingAbbr = pitchingSide === 'home' ? awayAbbr : homeAbbr;
  const battingTeamId = pitchingSide === 'home' ? game.awayTeamId : game.homeTeamId;

  return (
    <div>
      <div className="grid grid-cols-[1fr_auto_1fr]" style={{ backgroundColor: C.liveBandBg }}>
        <LiveTeamPanel side="away" abbr={awayAbbr} teamId={game.awayTeamId} name={game.awayTeamName ?? awayAbbr} totals={data.totals.away} />
        <LiveCenterStatus
          isFinal={isFinal}
          inning={data.inning}
          outs={data.outs}
          count={data.count}
          score={data.score}
          leadsText={leadsText}
          bases={isFinal ? null : data.bases}
        />
        <LiveTeamPanel side="home" abbr={homeAbbr} teamId={game.homeTeamId} name={game.homeTeamName ?? homeAbbr} totals={data.totals.home} />
      </div>

      <LiveSubTabBar subTab={subTab} onChange={setSubTab} />

      {subTab === 'situation' ? (
        <>
          {(data.currentPitcher || (!isFinal && data.batter)) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ borderBottom: `1px solid ${C.divider}` }}>
              {data.currentPitcher ? (
                <CurrentPitcherSpotlight pitcher={data.currentPitcher} teamAbbr={pitchingAbbr} teamId={pitchingTeamId} border="right" />
              ) : null}
              {!isFinal && data.batter ? (
                <CurrentBatterSpotlight batter={data.batter} teamAbbr={battingAbbr} teamId={battingTeamId} />
              ) : null}
            </div>
          ) : null}
          <InningStrip
            linescore={data.linescore}
            currentInning={data.inning.number}
            totals={data.totals}
            awayAbbr={awayAbbr}
            homeAbbr={homeAbbr}
            awayTeamId={game.awayTeamId}
            homeTeamId={game.homeTeamId}
            plays={data.plays}
          />
        </>
      ) : null}

      {subTab === 'boxscore' ? (
        <>
          <BoxScoreTable team={data.boxscore.away} teamAbbr={awayAbbr} teamId={game.awayTeamId} />
          <div style={{ borderTop: `1px solid ${C.divider}` }} />
          <BoxScoreTable team={data.boxscore.home} teamAbbr={homeAbbr} teamId={game.homeTeamId} />
        </>
      ) : null}

      {subTab === 'bullpen' ? (
        <>
          <BullpenTeam bullpen={game.awayTeamId != null ? bullpen.byTeam[game.awayTeamId] : undefined} teamAbbr={awayAbbr} teamId={game.awayTeamId} />
          <div style={{ borderTop: `1px solid ${C.divider}` }} />
          <BullpenTeam bullpen={game.homeTeamId != null ? bullpen.byTeam[game.homeTeamId] : undefined} teamAbbr={homeAbbr} teamId={game.homeTeamId} />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export function GameHeroCard({
  game,
  isLive,
  isFinal,
  liveScore,
  awayRecent,
  homeRecent,
  recommendedPick,
  totalLean,
  gamePick,
  pickLoading,
}: {
  game: GameDetailGame;
  isLive: boolean;
  isFinal: boolean;
  liveScore?: { home: string; away: string };
  awayRecent?: { recent: RecentGameResult[] };
  homeRecent?: { recent: RecentGameResult[] };
  recommendedPick?: RecommendedMoneylinePick | null;
  totalLean?: TotalLean | null;
  gamePick: GamePickView | null;
  pickLoading?: boolean;
}) {
  const [tab, setTab] = useState<'matchup' | 'live'>(isLive ? 'live' : 'matchup');

  return (
    <section className="lb-card-hero overflow-hidden">
      <div className="flex items-center gap-2.5 px-[26px] py-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
        <div className="flex rounded-full p-[3px]" style={{ backgroundColor: C.tabTrack }}>
          <button
            type="button"
            onClick={() => setTab('matchup')}
            className="rounded-full px-3.5 py-1.5 text-dense font-medium tracking-[.08em]"
            style={{ backgroundColor: tab === 'matchup' ? C.tabActiveBg : 'transparent', color: tab === 'matchup' ? C.tabActiveText : C.tabInactiveText }}
          >
            Matchup
          </button>
          <button
            type="button"
            onClick={() => setTab('live')}
            className="rounded-full px-3.5 py-1.5 text-dense font-medium tracking-[.08em]"
            style={{ backgroundColor: tab === 'live' ? C.tabActiveBg : 'transparent', color: tab === 'live' ? C.tabActiveText : C.tabInactiveText }}
          >
            Live
          </button>
        </div>
        {isLive ? (
          <div className="ml-auto text-meta tracking-[.08em]" style={{ color: C.faintMono }}>
            REFRESHES AT EACH HALF-INNING
          </div>
        ) : null}
      </div>

      {tab === 'matchup' ? (
        <MatchupTab
          game={game}
          isLive={isLive}
          isFinal={isFinal}
          liveScore={liveScore}
          awayRecent={awayRecent}
          homeRecent={homeRecent}
          recommendedPick={recommendedPick}
          totalLean={totalLean}
          gamePick={gamePick}
          pickLoading={pickLoading}
        />
      ) : (
        <LiveTab game={game} gamePk={game.gamePk} active={tab === 'live'} isFinal={isFinal} />
      )}
    </section>
  );
}

export default GameHeroCard;
