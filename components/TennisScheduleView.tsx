'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { PickCandidate, SportSnapshot, TennisTour, WeatherContext } from '@/lib/core/types';
import type { ScheduleEvent, DrawMatch, DrawSetScore, TournamentDraw } from '@/lib/sports/tennis/schedule';
import { roundOrder } from '@/lib/sports/tennis/roundOrder';
import type { CourtSurface } from '@/lib/sports/tennis/surfaces';
import { tournamentSurface } from '@/lib/sports/tennis/surfaces';
import { computeTournamentConditions } from '@/lib/sports/tennis/seasonLeaders';
import type { SeasonLeaderRow, LeaderStat } from '@/lib/sports/tennis/seasonLeaders';
import type { RankingRow } from '@/lib/sports/tennis/rankings';
import type { TennisLinesResult, TennisMoneyline } from '@/lib/odds/tennisLines';
import { SubjectAvatar } from './SubjectAvatar';
import { OddsChip } from './OddsChip';
import { TennisLinesView } from './TennisLinesView';
import { TournamentNotStartedNotice } from './TournamentNotStartedNotice';
import { SunIcon, CloudIcon, CloudRainIcon, WindIcon } from './icons';

/**
 * `/tennis/[tour]/schedule` — tennis's counterpart to `GolfScheduleView.tsx`.
 * Not an adapter (same reasoning golf's schedule page isn't one — see
 * CLAUDE.md's sport-adapter section): this is a standalone view built around
 * data shapes (a knockout draw, a season schedule) that don't fit the shared
 * PlayerDetail/TeamDetail/GameDetail `{Component}Data` contracts at all.
 *
 * Structurally different from golf's page for a real reason, not a copy:
 * golf has exactly one live stroke-play field to describe; tennis is a
 * single-elimination draw of 1v1 matches, and — confirmed live — more than
 * one ATP/WTA tournament can be genuinely live at once. So "the active
 * event" here is always whatever the sidebar has selected, not an implicit
 * single current event the way golf's page can assume.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  return `${s.toLocaleDateString('en-US', opts)}–${e.toLocaleDateString('en-US', opts)}`;
}

function StatusChip({ status, completed }: { status: ScheduleEvent['status']; completed: boolean }) {
  if (status === 'in') return <span className="lb-chip bg-good/10 text-good">Live</span>;
  if (completed || status === 'post') return <span className="lb-chip bg-ink/5 text-ink-muted">Final</span>;
  return <span className="lb-chip bg-accent-soft text-masters">Upcoming</span>;
}

const SURFACE_LABEL: Record<CourtSurface, string> = { hard: 'Hard', clay: 'Clay', grass: 'Grass' };
const SURFACE_CLASS: Record<CourtSurface, string> = {
  hard: 'bg-accent-soft text-masters',
  clay: 'bg-bad/10 text-bad',
  grass: 'bg-good/10 text-good',
};

function SurfaceChip({ surface }: { surface: CourtSurface | null }) {
  if (!surface) return null;
  return <span className={`lb-chip ${SURFACE_CLASS[surface]}`}>{SURFACE_LABEL[surface]}</span>;
}

function formatSetScore(sets: DrawSetScore[]): string {
  if (sets.length === 0) return '–';
  return sets.map((s) => (s.tiebreak != null ? `${s.value}(${s.tiebreak})` : String(s.value))).join(' ');
}

// ---------------------------------------------------------------------------
// Match Hero
// ---------------------------------------------------------------------------

function MatchHeroCarousel({ matches, tour }: { matches: DrawMatch[]; tour: TennisTour }) {
  const featured = matches.filter((m) => m.state === 'in').slice(0, 5);
  const fallback = matches.filter((m) => m.state === 'pre').sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  const cards = featured.length > 0 ? featured : fallback ? [fallback] : [];
  const [index, setIndex] = useState(0);
  if (cards.length === 0) return null;
  const safeIndex = index % cards.length;
  const m = cards[safeIndex];
  const label = m.state === 'in' ? 'On court now' : 'Next up';

  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-line bg-card/90">
      <Link href={`/tennis/${tour}/game/${m.matchId}`} className="flex flex-col gap-1 px-3 py-2 transition-colors hover:bg-surface-subtle">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <SubjectAvatar name={m.home.name} fallbackUrl={m.home.flagUrl ?? undefined} size={18} />
          {m.home.name}
          {m.state === 'in' ? <span className="ml-auto font-bold tabular-nums text-masters">{formatSetScore(m.home.sets)}</span> : null}
        </span>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <SubjectAvatar name={m.away.name} fallbackUrl={m.away.flagUrl ?? undefined} size={18} />
          {m.away.name}
          {m.state === 'in' ? <span className="ml-auto font-bold tabular-nums text-masters">{formatSetScore(m.away.sets)}</span> : null}
        </span>
      </Link>
      {cards.length > 1 ? (
        <div className="flex justify-center gap-1 pb-1.5">
          {cards.map((c, i) => (
            <button
              key={c.matchId}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show match ${i + 1}`}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${i === safeIndex ? 'bg-masters' : 'bg-ink/15'}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MatchHeroCard({ event, draw, tour }: { event: ScheduleEvent; draw: TournamentDraw; tour: TennisTour }) {
  const surface = tournamentSurface(draw.eventName);
  return (
    <section
      className="lb-card-hero lb-card-interactive overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 140% at 100% 0%, rgba(15,122,79,0.22) 0%, rgba(15,122,79,0.05) 45%, #ffffff 75%), linear-gradient(135deg, rgba(20,22,25,0.05) 0%, #ffffff 60%)',
        borderTop: '3px solid #141619',
      }}
    >
      <div className="flex flex-wrap items-center gap-4 px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[22px] font-bold leading-tight text-ink">{draw.eventName}</h1>
            <StatusChip status={event.status} completed={event.completed} />
            {draw.major ? <span className="lb-chip bg-masters text-white">Grand Slam</span> : null}
            <SurfaceChip surface={surface} />
          </div>
          <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
            <span>{formatDateRange(event.startDate, event.endDate)}</span>
            {draw.venueCity ? (
              <>
                <span className="text-ink-faint">·</span>
                <span>{draw.venueCity}</span>
              </>
            ) : null}
          </p>
        </div>

        <MatchHeroCarousel matches={draw.matches} tour={tour} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Today's Matches
// ---------------------------------------------------------------------------

function TodaysMatchesCard({ matches, tour, moneylines }: { matches: DrawMatch[]; tour: TennisTour; moneylines: TennisMoneyline[] }) {
  const moneylineByMatch = useMemo(() => new Map(moneylines.map((m) => [m.matchId, m])), [moneylines]);
  const rows = useMemo(
    () =>
      matches
        .filter((m) => !m.completed)
        .sort((a, b) => (a.state === 'in' && b.state !== 'in' ? -1 : b.state === 'in' && a.state !== 'in' ? 1 : Date.parse(a.date) - Date.parse(b.date)))
        .slice(0, 40),
    [matches],
  );

  if (rows.length === 0) {
    return <p className="lb-card p-4 text-center text-[12px] text-ink-muted">No live or upcoming matches in this draw right now.</p>;
  }

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-[12px] font-semibold text-masters">Today&apos;s matches</h2>
      <div className="divide-y divide-line-soft">
        {rows.map((m) => {
          const ml = moneylineByMatch.get(m.matchId);
          return (
            <Link key={m.matchId} href={`/tennis/${tour}/game/${m.matchId}`} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-subtle">
              <div className="w-16 shrink-0 text-[10px] text-ink-faint">
                {m.state === 'in' ? <span className="lb-chip bg-good/10 text-good">Live</span> : m.court || m.round}
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  <SubjectAvatar name={m.home.name} fallbackUrl={m.home.flagUrl ?? undefined} size={16} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{m.home.name}</span>
                  {m.state === 'in' ? <span className="shrink-0 font-bold tabular-nums text-ink">{formatSetScore(m.home.sets)}</span> : null}
                  {ml?.home.bestPrice ? <OddsChip price={ml.home.bestPrice.americanOdds} source="sharpapi" /> : null}
                </div>
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  <SubjectAvatar name={m.away.name} fallbackUrl={m.away.flagUrl ?? undefined} size={16} />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{m.away.name}</span>
                  {m.state === 'in' ? <span className="shrink-0 font-bold tabular-nums text-ink">{formatSetScore(m.away.sets)}</span> : null}
                  {ml?.away.bestPrice ? <OddsChip price={ml.away.bestPrice.americanOdds} source="sharpapi" /> : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Draw / Bracket
// ---------------------------------------------------------------------------

function SeedBadge({ seed }: { seed: number | null }) {
  if (seed == null) return null;
  return <span className="shrink-0 text-[9px] font-semibold text-ink-faint">({seed})</span>;
}

function DrawMatchRow({ match, tour }: { match: DrawMatch; tour: TennisTour }) {
  return (
    <Link href={`/tennis/${tour}/game/${match.matchId}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-[12px] transition-colors hover:bg-surface-subtle">
      <div className="min-w-0 flex-1 space-y-0.5">
        {[match.home, match.away].map((c) => (
          <div key={c.athleteId} className="flex items-center gap-1.5">
            <SubjectAvatar name={c.name} fallbackUrl={c.flagUrl ?? undefined} size={16} />
            <SeedBadge seed={c.seed} />
            <span className={`min-w-0 flex-1 truncate ${c.winner ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{c.name}</span>
            {match.completed || match.state === 'in' ? <span className={`shrink-0 tabular-nums ${c.winner ? 'font-bold text-ink' : 'text-ink-faint'}`}>{formatSetScore(c.sets)}</span> : null}
          </div>
        ))}
      </div>
      {!match.completed && match.state !== 'in' ? (
        <span className="shrink-0 text-[10px] text-ink-faint">{new Date(match.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      ) : null}
    </Link>
  );
}

function DrawBracketCard({ matches, tour }: { matches: DrawMatch[]; tour: TennisTour }) {
  const byRound = useMemo(() => {
    const map = new Map<string, DrawMatch[]>();
    for (const m of matches) {
      const bucket = map.get(m.round);
      if (bucket) bucket.push(m);
      else map.set(m.round, [m]);
    }
    return [...map.entries()].sort((a, b) => roundOrder(a[0]) - roundOrder(b[0]));
  }, [matches]);

  // Default open: the round with a live match, else the latest round with any match — a 128-draw Slam has ~7 rounds, no reason to dump all of them open at once.
  const defaultOpenRound = useMemo(() => {
    const live = matches.find((m) => m.state === 'in');
    if (live) return live.round;
    return byRound.length > 0 ? byRound[byRound.length - 1][0] : null;
  }, [matches, byRound]);
  const [openRounds, setOpenRounds] = useState<Set<string>>(() => new Set(defaultOpenRound ? [defaultOpenRound] : []));

  if (byRound.length === 0) {
    return <p className="lb-card p-4 text-center text-[12px] text-ink-muted">Draw hasn&apos;t been released yet.</p>;
  }

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-[12px] font-semibold text-masters">Draw</h2>
      <div className="divide-y divide-line-soft">
        {byRound.map(([round, roundMatches]) => {
          const isOpen = openRounds.has(round);
          return (
            <div key={round}>
              <button
                type="button"
                onClick={() =>
                  setOpenRounds((prev) => {
                    const next = new Set(prev);
                    if (next.has(round)) next.delete(round);
                    else next.add(round);
                    return next;
                  })
                }
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-surface-subtle"
              >
                <span className="text-[12px] font-semibold text-ink">{round}</span>
                <span className="flex items-center gap-2 text-[10px] text-ink-faint">
                  {roundMatches.length} match{roundMatches.length === 1 ? '' : 'es'}
                  <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                </span>
              </button>
              {isOpen ? (
                <div className="space-y-0.5 border-t border-line-soft bg-surface-subtle p-1.5">
                  {roundMatches.map((m) => (
                    <DrawMatchRow key={m.matchId} match={m} tour={tour} />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tournament Insights — season leaders + straight-sets/retirement read
// ---------------------------------------------------------------------------

function TournamentInsightsCard({
  matches,
  seasonLeaders,
  seasonLeadersLoading,
  leaderStat,
  onChangeLeaderStat,
}: {
  matches: DrawMatch[];
  seasonLeaders: SeasonLeaderRow[];
  seasonLeadersLoading: boolean;
  leaderStat: LeaderStat;
  onChangeLeaderStat: (stat: LeaderStat) => void;
}) {
  const conditions = useMemo(() => computeTournamentConditions(matches), [matches]);

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-[12px] font-semibold text-masters">Tournament insights</h2>
        {conditions.completedCount > 0 ? (
          <span className="text-[10px] text-masters/70">
            {conditions.straightSetsPct.toFixed(0)}% straight sets · {conditions.probableRetirements} retirement{conditions.probableRetirements === 1 ? '' : 's'} so far
          </span>
        ) : null}
      </div>

      <div className="p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Season leaders (tour-wide)</span>
          <span className="inline-flex items-center gap-0.5 rounded-lg bg-ink/[0.05] p-0.5">
            {(['aces', 'gamesWon'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChangeLeaderStat(s)}
                aria-pressed={leaderStat === s}
                className={`rounded-md px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${leaderStat === s ? 'bg-card text-ink shadow-card' : 'text-ink-muted'}`}
              >
                {s === 'aces' ? 'Aces' : 'Games won'}
              </button>
            ))}
          </span>
        </div>
        {seasonLeadersLoading && seasonLeaders.length === 0 ? (
          <p className="text-[11px] text-ink-faint">Loading…</p>
        ) : seasonLeaders.length === 0 ? (
          <p className="text-[11px] text-ink-faint">No season data yet.</p>
        ) : (
          <ul className="space-y-1">
            {seasonLeaders.slice(0, 5).map((row, i) => (
              <li key={row.name} className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-[11px]">
                <span className="truncate text-ink">
                  #{i + 1} {row.name}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-ink-muted">
                  {row.total} ({row.perMatch.toFixed(1)}/match)
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[9px] text-ink-faint">Season totals across all real matches this year — not tournament-specific.</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tournament Info
// ---------------------------------------------------------------------------

function TournamentInfoCard({ draw, tour }: { draw: TournamentDraw; tour: TennisTour }) {
  const surface = tournamentSurface(draw.eventName);
  const earliestRound = useMemo(() => {
    if (draw.matches.length === 0) return null;
    return [...draw.matches].sort((a, b) => roundOrder(a.round) - roundOrder(b.round))[0]?.round ?? null;
  }, [draw.matches]);
  const drawSize = earliestRound ? draw.matches.filter((m) => m.round === earliestRound).length * 2 : null;

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-[12px] font-semibold text-masters">Tournament info</h2>
      <div className="space-y-2 p-3 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-ink-muted">Surface</span>
          {surface ? <SurfaceChip surface={surface} /> : <span className="text-ink-faint">Not on file yet</span>}
        </div>
        {draw.venueCity ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-ink-muted">Venue</span>
            <span className="text-ink">{draw.venueCity}</span>
          </div>
        ) : null}
        {drawSize ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-ink-muted">Draw size</span>
            <span className="text-ink">{drawSize}</span>
          </div>
        ) : null}
        {draw.defendingChampion ? (
          <div className="flex items-center gap-2 border-t border-line-soft pt-2">
            <span className="text-ink-muted">Defending champion</span>
            {draw.defendingChampion.athleteId ? (
              <Link href={`/tennis/${tour}/player/${encodeURIComponent(draw.defendingChampion.athleteId)}`} className="flex items-center gap-1.5 hover:underline">
                <SubjectAvatar name={draw.defendingChampion.name} headshotUrl={draw.defendingChampion.headshotUrl ?? undefined} size={20} />
                <span className="font-medium text-ink">{draw.defendingChampion.name}</span>
              </Link>
            ) : (
              <span className="flex items-center gap-1.5">
                <SubjectAvatar name={draw.defendingChampion.name} headshotUrl={draw.defendingChampion.headshotUrl ?? undefined} size={20} />
                <span className="font-medium text-ink">{draw.defendingChampion.name}</span>
              </span>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Weather — same idea as golf's WeatherCard, no golf-strategy copy since it doesn't apply here.
// ---------------------------------------------------------------------------

function WeatherIcon({ windMph, rainPct, size = 15, className = '' }: { windMph: number; rainPct: number; size?: number; className?: string }) {
  if (rainPct >= 40) return <CloudRainIcon size={size} className={className} />;
  if (windMph >= 15) return <WindIcon size={size} className={className} />;
  if (rainPct >= 15) return <CloudIcon size={size} className={className} />;
  return <SunIcon size={size} className={className} />;
}

function WeatherCard({ weather }: { weather: WeatherContext }) {
  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-[12px] font-semibold text-masters">Weather</h2>
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
          <WeatherIcon windMph={weather.windMph} rainPct={weather.rainPct} size={18} className="text-masters" />
          <span className="font-bold text-ink">
            {weather.windMph} mph {weather.windDir}
          </span>
          <span className="text-ink-muted">{weather.rainPct}% rain</span>
          {weather.tempF != null ? <span className="text-ink-muted">{weather.tempF}°F</span> : null}
        </div>
        <p className="mt-1 text-[10px] text-ink-faint">{weather.approximateLocation ? 'City-level estimate' : 'Venue-exact'}</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// World Rankings — real replacement for golf's non-priced Top 5/Top 10.
// ---------------------------------------------------------------------------

function TrendArrow({ current, previous }: { current: number; previous: number | null }) {
  if (previous == null || previous === current) return <span className="text-[10px] text-ink-faint">–</span>;
  const up = previous > current; // a lower rank number is better
  return <span className={`text-[10px] font-bold ${up ? 'text-good' : 'text-bad'}`}>{up ? `▲${previous - current}` : `▼${current - previous}`}</span>;
}

function WorldRankingsCard({ tour, rankings, loading }: { tour: TennisTour; rankings: RankingRow[]; loading: boolean }) {
  const [view, setView] = useState<10 | 25>(10);
  const rows = rankings.slice(0, view);

  if (loading && rankings.length === 0) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="lb-card h-9 animate-pulse" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-[12px] font-semibold text-masters">World rankings</h2>
        <span className="inline-flex items-center gap-0.5 rounded-lg bg-ink/[0.05] p-0.5">
          {([10, 25] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setView(n)}
              aria-pressed={view === n}
              className={`rounded-md px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${view === n ? 'bg-card text-ink shadow-card' : 'text-ink-muted'}`}
            >
              Top {n}
            </button>
          ))}
        </span>
      </div>
      <ul className="divide-y divide-line-soft">
        {rows.map((r) => (
          <li key={r.athleteId}>
            <Link href={`/tennis/${tour}/player/${encodeURIComponent(r.athleteId)}`} className="flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors hover:bg-surface-subtle">
              <span className="w-6 shrink-0 text-center font-bold text-ink-muted">{r.rank}</span>
              <SubjectAvatar name={r.name} size={20} />
              <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
              <TrendArrow current={r.rank} previous={r.previousRank} />
              {r.points != null ? <span className="w-14 shrink-0 text-right font-bold tabular-nums text-ink">{r.points.toLocaleString()}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      <p className="border-t border-line-soft px-3 py-1.5 text-[9px] text-ink-faint">Official ATP/WTA ranking points — not a priced market.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Our Lines
// ---------------------------------------------------------------------------

function OurLinesCard({ candidates, onAdd, addedKeys }: { candidates: PickCandidate[]; onAdd?: (candidate: PickCandidate) => void; addedKeys?: Set<string> }) {
  const rows = useMemo(
    () => candidates.filter((c) => c.consistent && c.sampleSize >= 2).sort((a, b) => b.sampleSize - a.sampleSize).slice(0, 6),
    [candidates],
  );
  if (rows.length === 0) return null;

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-[12px] font-semibold text-masters">Our lines</h2>
      <ul className="divide-y divide-line-soft">
        {rows.map((c) => {
          const key = `${c.sport}:${c.subjectId}:${c.dimension}:${c.category}`;
          const added = addedKeys?.has(key);
          return (
            <li key={key} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
              <SubjectAvatar name={c.subjectName} size={20} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{c.subjectName}</div>
                <div className="truncate text-[10px] text-ink-faint">
                  {c.dimensionLabel} · {c.categoryLabel} · {c.sampleSize} match{c.sampleSize === 1 ? '' : 'es'}
                </div>
              </div>
              {onAdd ? (
                <button
                  type="button"
                  onClick={() => onAdd(c)}
                  disabled={added}
                  className={`shrink-0 rounded px-2 py-1 text-[11px] font-semibold ${added ? 'bg-accent-soft text-masters' : 'bg-masters text-white'}`}
                >
                  {added ? '✓' : '+'}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function TennisScheduleView({
  tour,
  events,
  scheduleLoading,
  scheduleWarnings,
  selectedEventId,
  onSelectEvent,
  draw,
  drawLoading,
  drawWarnings,
  moneylines,
  linesResult,
  linesLoading,
  rankings,
  rankingsLoading,
  seasonLeaders,
  seasonLeadersLoading,
  leaderStat,
  onChangeLeaderStat,
  weather,
  snapshot,
  onAdd,
  addedKeys,
}: {
  tour: TennisTour;
  events: ScheduleEvent[];
  scheduleLoading: boolean;
  scheduleWarnings: string[];
  selectedEventId: string | null;
  onSelectEvent: (event: ScheduleEvent) => void;
  draw: TournamentDraw | null;
  drawLoading: boolean;
  drawWarnings: string[];
  moneylines: TennisMoneyline[];
  linesResult: TennisLinesResult | null;
  linesLoading: boolean;
  rankings: RankingRow[];
  rankingsLoading: boolean;
  seasonLeaders: SeasonLeaderRow[];
  seasonLeadersLoading: boolean;
  leaderStat: LeaderStat;
  onChangeLeaderStat: (stat: LeaderStat) => void;
  weather: WeatherContext | null;
  snapshot: SportSnapshot | null;
  onAdd?: (candidate: PickCandidate) => void;
  addedKeys?: Set<string>;
}) {
  const active = events.find((e) => e.id === selectedEventId) ?? null;

  const tournamentCandidates = useMemo(() => {
    if (!draw || !snapshot) return [];
    const matchIds = new Set(draw.matches.map((m) => m.matchId));
    return snapshot.candidates.filter((c) => matchIds.has(String((c.subjectMeta as Record<string, unknown> | undefined)?.gamePk)));
  }, [draw, snapshot]);

  if (scheduleLoading && events.length === 0) {
    return <div className="lb-card h-48 animate-pulse" />;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr] lg:items-start">
      <div className="lb-card overflow-hidden lg:sticky lg:top-4">
        {scheduleWarnings.length > 0 ? (
          <div className="border-b border-warn/30 bg-warn/5 p-2 text-[11px] text-warn">
            {scheduleWarnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}
        <ul className="max-h-[75vh] overflow-y-auto p-1.5" role="listbox" aria-label="Schedule">
          {events.length === 0 ? (
            <li className="p-4 text-center text-[12px] text-ink-muted">No schedule data available.</li>
          ) : (
            events.map((e) => {
              const selected = e.id === selectedEventId;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onSelectEvent(e)}
                    className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors ${selected ? 'bg-accent-soft' : 'hover:bg-ink/[0.03]'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-[13px] ${selected ? 'font-semibold text-masters' : 'text-ink'}`}>
                        {e.major ? '🏆 ' : ''}
                        {e.name}
                      </span>
                      <StatusChip status={e.status} completed={e.completed} />
                    </span>
                    <span className="text-[10px] text-ink-faint">{formatDateRange(e.startDate, e.endDate)}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="min-w-0">
        {!active ? (
          <div className="lb-card p-8 text-center text-sm text-ink-muted">Select a tournament to see its details.</div>
        ) : drawLoading && !draw ? (
          <div className="lb-card h-48 animate-pulse" />
        ) : !draw ? (
          <div className="lb-card p-3 text-[12px] text-ink-faint">
            {drawWarnings[0] ?? `Couldn't load ${active.name}'s draw right now.`}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px] lg:items-start">
            <div className="min-w-0 space-y-3">
              <MatchHeroCard event={active} draw={draw} tour={tour} />
              {draw.matches.length === 0 ? (
                <TournamentNotStartedNotice eventName={draw.eventName} detail={formatDateRange(active.startDate, active.endDate)} />
              ) : (
                <>
                  <TodaysMatchesCard matches={draw.matches} tour={tour} moneylines={moneylines} />
                  <DrawBracketCard matches={draw.matches} tour={tour} />
                  <TournamentInsightsCard
                    matches={draw.matches}
                    seasonLeaders={seasonLeaders}
                    seasonLeadersLoading={seasonLeadersLoading}
                    leaderStat={leaderStat}
                    onChangeLeaderStat={onChangeLeaderStat}
                  />
                </>
              )}
              <TournamentInfoCard draw={draw} tour={tour} />
              {weather ? <WeatherCard weather={weather} /> : null}
            </div>

            <div className="space-y-3 lg:sticky lg:top-4">
              <TennisLinesView tour={tour} lines={linesResult?.lines ?? []} eventName={linesResult?.eventName ?? null} loading={linesLoading} warnings={linesResult?.warnings ?? []} />
              <WorldRankingsCard tour={tour} rankings={rankings} loading={rankingsLoading} />
              <OurLinesCard candidates={tournamentCandidates} onAdd={onAdd} addedKeys={addedKeys} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TennisScheduleView;
