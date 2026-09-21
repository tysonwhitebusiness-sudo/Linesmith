'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Chip, DataTable, PickList, cx, Tooltip, type Column } from './ui';
import Link from 'next/link';
import type { ScheduleEvent } from '@/lib/sports/golf/schedule';
import type { PickCandidate, SportSnapshot, SubjectSummary, WeatherContext, WeatherForecastHour } from '@/lib/core/types';
import type { GolfOutrightLine } from '@/lib/odds/golfLines';
import type { GolferStrokesGained } from '@/lib/sports/golf/pgatourStats';
import { entryValue } from '@/lib/core/windowedStat';
import { gradientCardStyle } from '@/lib/ui/heat';
import { SubjectAvatar } from './SubjectAvatar';
import { TournamentLinesView } from './TournamentLinesView';
import { tournamentLogoUrl } from '@/lib/sports/golf/tournamentLogos';
import { TournamentNotStartedNotice } from './TournamentNotStartedNotice';
import { SunIcon, CloudIcon, CloudRainIcon, WindIcon } from './icons';

/** Picks a weather icon from actual conditions — rain wins over wind wins over clouds wins over sun, since that's the order they start mattering for a round. */
function WeatherIcon({ windMph, rainPct, size = 15, className = '' }: { windMph: number; rainPct: number; size?: number; className?: string }) {
  if (rainPct >= 40) return <CloudRainIcon size={size} className={className} />;
  if (windMph >= 15) return <WindIcon size={size} className={className} />;
  if (rainPct >= 15) return <CloudIcon size={size} className={className} />;
  return <SunIcon size={size} className={className} />;
}

/** Wraps a tournament's name with its logo when one is known — same graceful-degrade-on-404 pattern `TeamMark` (GamesStrip.tsx) uses for team logos. */
function TournamentLogo({ name, size = 20 }: { name: string; size?: number }) {
  const url = tournamentLogoUrl(name);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="shrink-0 object-contain"
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

/**
 * `/golf/schedule` — golf's Teams-tab equivalent, and (for whichever event
 * is currently live) a full Tournament Detail page: the golf counterpart to
 * `GameDetail.tsx`, one event standing in for "both teams" since a
 * tournament has a full field rather than two sides. Every card below is
 * computed client-side from `snapshot.candidates`/`subjects` — no new fetch,
 * since the hole-by-hole and grouping data those already carry (adapter.ts's
 * `buildRoundGroups`) already covers everything this page needs.
 */

// ---------------------------------------------------------------------------
// Shared golf-display helpers — same small duplication already used across
// PlayerDetail.tsx and ScanTable.tsx rather than a new shared module.
// ---------------------------------------------------------------------------

function relDisplay(v: number | null): string {
  if (v === null) return '–';
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : String(v);
}

function relDisplayAvg(v: number): string {
  if (Math.abs(v) < 0.05) return 'E';
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

/** Categorical, not continuous — see PlayerDetail.tsx's own copy for the full rationale. */
function golfScoreHeat(relativeToPar: number): number {
  if (relativeToPar === 0) return 0.5;
  if (relativeToPar < 0) return Math.min(1, 0.78 + (Math.abs(relativeToPar) - 1) * 0.12);
  return Math.max(0, 0.22 - (relativeToPar - 1) * 0.12);
}

/** The lowest-score-first sort every leaderboard surface uses — parses the leading score token off a statusLine/totalScore string ("-3 · thru 14", "+2"). */
function leaderboardScore(token: string | undefined): number {
  const first = token?.split(' ')[0] ?? '';
  if (/^e$/i.test(first)) return 0;
  const n = Number(first.replace('+', ''));
  return Number.isFinite(n) ? n : 999;
}

/** `meta.teeTime` is a raw ISO timestamp (adapter.ts's `teeTimeForDisplay` only decides *whether* to show it, not how — see timing.ts) — every display site needs to format it itself. */
function formatTeeTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "-3 · thru 14" -> ["-3", "thru 14"]. */
function splitStatusLine(statusLine: string | undefined): [string, string | null] {
  if (!statusLine) return ['—', null];
  const [score, ...rest] = statusLine.split(' · ');
  return [score, rest.length > 0 ? rest.join(' · ') : null];
}

/** This golfer's hole-by-hole line for one round, read off the full candidate list (every golfer's every hole) rather than just "mine" — needed for All Matchups, where every card is comparing golfers other than whichever one you navigated in from. */
function holeLineFor(golferId: string, round: number | null, holesByGolfer: Map<string, PickCandidate[]>) {
  if (round == null) return [];
  return (holesByGolfer.get(golferId) ?? [])
    .map((c) => {
      const parMatch = /Par (\d+)/.exec(c.dimensionLabel);
      const entry = c.history.find((h) => h.period === round);
      return {
        hole: Number(c.dimension.slice('hole-'.length)),
        par: parMatch ? Number(parMatch[1]) : null,
        value: entry ? entryValue(entry) : null,
      };
    })
    .sort((a, b) => a.hole - b.hole);
}

// ---------------------------------------------------------------------------
// Event list (unchanged) — date range, status.
// ---------------------------------------------------------------------------

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  return `${s.toLocaleDateString('en-US', opts)}–${e.toLocaleDateString('en-US', opts)}`;
}

function StatusChip({ status, completed }: { status: ScheduleEvent['status']; completed: boolean }) {
  if (status === 'in') return <Chip tone="live" size="sm">Live</Chip>;
  if (completed || status === 'post') return <Chip tone="neutral" size="sm">Final</Chip>;
  return <Chip tone="neutral" size="sm">Upcoming</Chip>;
}

// ---------------------------------------------------------------------------
// Tournament Hero
// ---------------------------------------------------------------------------

interface SpotlightCard {
  key: string;
  label: string;
  subjectId: string;
  name: string;
  headshotUrl?: string;
  flagUrl?: string;
  value: string;
  tone: 'good' | 'bad' | 'neutral';
}

/** Leader + 2nd/3rd place + today's best and worst mover — the hero carousel's 5 cards. Reuses `buildBigMovers` rather than recomputing today's-round totals a second way. */
function buildSpotlightCards(
  subjects: SubjectSummary[],
  candidates: PickCandidate[],
  currentRound: number | null,
  holesByGolfer: Map<string, PickCandidate[]>,
): SpotlightCard[] {
  const ordered = [...subjects].sort((a, b) => leaderboardScore(a.statusLine) - leaderboardScore(b.statusLine));
  const cards: SpotlightCard[] = [];
  const positionLabels = ['Leader', '2nd place', '3rd place'];

  ordered.slice(0, 3).forEach((s, i) => {
    const meta = (s.meta ?? {}) as Record<string, unknown>;
    const [score] = splitStatusLine(s.statusLine);
    cards.push({
      key: `pos-${s.subjectId}`,
      label: positionLabels[i],
      subjectId: s.subjectId,
      name: s.subjectName,
      headshotUrl: typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined,
      flagUrl: typeof meta.flagUrl === 'string' ? meta.flagUrl : undefined,
      value: score,
      tone: 'neutral',
    });
  });

  const movers = buildBigMovers(candidates, currentRound, holesByGolfer);
  if (movers.length > 0) {
    const best = movers[0];
    cards.push({ key: `mover-best-${best.id}`, label: 'Best today', subjectId: best.id, name: best.name, headshotUrl: best.headshotUrl, value: relDisplay(best.total), tone: 'good' });
  }
  if (movers.length > 1) {
    const worst = movers[movers.length - 1];
    if (worst.id !== movers[0].id) {
      cards.push({ key: `mover-worst-${worst.id}`, label: 'Worst today', subjectId: worst.id, name: worst.name, headshotUrl: worst.headshotUrl, value: relDisplay(worst.total), tone: 'bad' });
    }
  }

  return cards;
}

/** Cycles through the 5 spotlight cards on a timer, one at a time — a fade+slide on each change (see tailwind.config.ts's `lb-fade-slide`) rather than a hard cut, with dots for manual control and no motion at all under prefers-reduced-motion. */
function HeroSpotlightCarousel({ cards }: { cards: SpotlightCard[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (cards.length <= 1) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % cards.length), 3500);
    return () => clearInterval(timer);
  }, [cards.length]);

  if (cards.length === 0) return null;
  const safeIndex = index % cards.length;
  const card = cards[safeIndex];
  const toneClass = card.tone === 'good' ? 'text-good-ink' : card.tone === 'bad' ? 'text-bad-ink' : 'text-masters';

  return (
    <div className="shrink-0 overflow-hidden rounded-xl border border-line bg-card/90">
      <Link
        key={card.key}
        href={`/golf/player/${card.subjectId}`}
        className="flex animate-lb-fade-slide items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-subtle"
      >
        <SubjectAvatar name={card.name} headshotUrl={card.headshotUrl} fallbackUrl={card.flagUrl} size={30} />
        <div className="min-w-0 text-left">
          <div className="text-overline font-semibold uppercase tracking-wide text-ink-muted">{card.label}</div>
          <div className="max-w-[110px] truncate text-label font-semibold text-ink">{card.name}</div>
        </div>
        <div className={`shrink-0 text-title font-bold tabular-nums ${toneClass}`}>{card.value}</div>
      </Link>
      {cards.length > 1 ? (
        <div className="flex justify-center gap-1 pb-1.5">
          {cards.map((c, i) => (
            <Button
              key={c.key}
              variant="tertiary"
              size="sm"
              onPress={() => setIndex(i)}
              aria-label={`Show ${c.label}`}
              aria-current={i === safeIndex}
              className={cx('h-1.5 w-1.5 min-w-0 rounded-full px-0', i === safeIndex ? 'bg-masters hover:bg-masters' : 'bg-ink/15 hover:bg-ink/15')}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TournamentHeroCard({
  event,
  courseName,
  spotlightCards,
  weather,
  currentRound,
}: {
  event: ScheduleEvent;
  courseName?: string;
  spotlightCards: SpotlightCard[];
  weather?: WeatherContext;
  currentRound: number | null;
}) {
  return (
    <section
      className="lb-card-hero lb-card-interactive overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 140% at 100% 0%, rgba(15,122,79,0.22) 0%, rgba(15,122,79,0.05) 45%, white 75%), linear-gradient(135deg, rgba(20,22,25,0.05) 0%, white 60%)',
        borderTop: '3px solid var(--color-masters)',
      }}
    >
      <div className="flex flex-wrap items-center gap-4 px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <TournamentLogo name={event.name} size={26} />
            <h1 className="truncate text-heading font-bold leading-tight text-ink">{event.name}</h1>
            <StatusChip status={event.status} completed={event.completed} />
            {currentRound != null ? <Chip tone="neutral" size="sm">Round {currentRound}</Chip> : null}
          </div>
          <p className="flex flex-wrap items-center gap-1.5 text-label font-normal text-ink-muted">
            <span>{formatDateRange(event.startDate, event.endDate)}</span>
            {courseName ? (
              <>
                <span className="text-ink-muted">·</span>
                <span>{courseName}</span>
              </>
            ) : null}
            {weather ? (
              <>
                <span className="text-ink-muted">·</span>
                <span>
                  {weather.tempF != null ? `${weather.tempF}°F · ` : ''}
                  Wind {weather.windMph} mph {weather.windDir}
                </span>
              </>
            ) : null}
          </p>
        </div>

        <HeroSpotlightCarousel cards={spotlightCards} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live Leaderboard
// ---------------------------------------------------------------------------

/** Standing through the round *before* `currentRound`, compared to standing now — a positive move means gained spots today. Returns an empty map before Round 2 (nothing to compare against yet). */
function buildMoveMap(candidates: PickCandidate[], currentRound: number | null, orderedIds: string[]): Map<string, number | null> {
  if (currentRound == null || currentRound <= 1) return new Map();
  const roundScoreCandidates = candidates.filter((c) => c.dimension === 'round-score');
  const priorTotals = roundScoreCandidates.map((c) => ({
    id: c.subjectId,
    prior: c.history.filter((h) => h.period < currentRound).reduce((sum, h) => sum + (entryValue(h) ?? 0), 0),
  }));
  const priorRankById = new Map([...priorTotals].sort((a, b) => a.prior - b.prior).map((p, i) => [p.id, i + 1]));

  const move = new Map<string, number | null>();
  orderedIds.forEach((id, i) => {
    const priorRank = priorRankById.get(id);
    move.set(id, priorRank != null ? priorRank - (i + 1) : null);
  });
  return move;
}

interface LeaderboardRow {
  id: string;
  position: string;
  name: string;
  headshotUrl?: string;
  flagUrl?: string;
  rounds: Array<number | null>;
  avg: number | null;
  score: string;
  thru: string;
  move: number | null;
}

function leaderboardRow(s: SubjectSummary, i: number, roundCandidate: PickCandidate | undefined, roundsPresent: number[], move: number | null): LeaderboardRow {
  const meta = (s.meta ?? {}) as Record<string, unknown>;
  const [score] = splitStatusLine(s.statusLine);
  const thru = typeof meta.thru === 'number' ? meta.thru : null;
  const teeTime = typeof meta.teeTime === 'string' ? meta.teeTime : null;
  const rounds = roundsPresent.map((r) => {
    const entry = roundCandidate?.history.find((h) => h.period === r);
    return entry ? entryValue(entry) : null;
  });
  const played = rounds.filter((v): v is number => v !== null);
  return {
    id: s.subjectId,
    position: typeof meta.position === 'string' ? meta.position : String(i + 1),
    name: s.subjectName,
    headshotUrl: typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined,
    flagUrl: typeof meta.flagUrl === 'string' ? meta.flagUrl : undefined,
    rounds,
    avg: played.length > 0 ? played.reduce((x, y) => x + y, 0) / played.length : null,
    score,
    thru: thru != null && thru > 0 ? `thru ${thru}` : (formatTeeTime(teeTime) ?? '–'),
    move,
  };
}

/** Under par is good, over par bad, par nothing — categorical, as golf reads it. */
const parTone = (v: number | null | undefined): 'good' | 'bad' | null => (v == null || v === 0 ? null : v < 0 ? 'good' : 'bad');

function leaderboardColumns(roundsPresent: number[]): Column<LeaderboardRow>[] {
  return [
    { key: 'pos', label: 'Pos', sortable: false, render: (r) => <span className="font-bold text-ink-muted">{r.position}</span> },
    {
      key: 'player',
      label: 'Player',
      sortable: false,
      render: (r) => (
        <Link href={`/golf/player/${r.id}`} className="flex max-w-[150px] items-center gap-1.5 hover:underline">
          <SubjectAvatar name={r.name} headshotUrl={r.headshotUrl} fallbackUrl={r.flagUrl} size={20} />
          <span className="truncate font-medium text-ink">{r.name}</span>
        </Link>
      ),
    },
    ...roundsPresent.map<Column<LeaderboardRow>>((round, idx) => ({
      key: `r${round}`,
      label: `R${round}`,
      numeric: true,
      align: 'center',
      sortValue: (r) => r.rounds[idx],
      render: (r) => relDisplay(r.rounds[idx]),
      ink: (r) => parTone(r.rounds[idx]),
    })),
    { key: 'avg', label: 'Avg', numeric: true, align: 'center', sortValue: (r) => r.avg, render: (r) => (r.avg != null ? relDisplayAvg(r.avg) : '–') },
    { key: 'total', label: 'Total', numeric: true, align: 'center', sortValue: (r) => leaderboardScore(r.score), render: (r) => <span className="font-bold text-ink">{r.score}</span> },
    { key: 'thru', label: 'Thru', align: 'center', sortable: false, render: (r) => <span className="text-ink-muted">{r.thru}</span> },
    {
      key: 'move',
      label: 'Move',
      numeric: true,
      align: 'center',
      sortValue: (r) => r.move,
      render: (r) => (r.move == null || r.move === 0 ? '–' : r.move > 0 ? `▲${r.move}` : `▼${Math.abs(r.move)}`),
      ink: (r) => (r.move == null || r.move === 0 ? null : r.move > 0 ? 'good' : 'bad'),
    },
  ];
}

/* ---------------------------------------------------------------- HoleGrid */

interface HoleGridHole {
  n: number;
  par?: number | null;
}

interface HoleGridRow {
  id: string;
  label: ReactNode;
  cells: Array<number | null>;
  total?: number | null;
}

/**
 * U6: every 18-hole grid on this page is one `DataTable` — the group
 * scorecard, course difficulty by round and the course card. Each hole's
 * header links to that hole's market on the Slate. Scores carry the
 * categorical par tone (`parTone`); plain numbers (par, yards) carry none.
 */
function HoleGrid({
  caption,
  holes,
  rows,
  totals,
  format,
  toned = true,
  showTotal = true,
}: {
  caption: string;
  holes: HoleGridHole[];
  rows: HoleGridRow[];
  totals?: HoleGridRow[];
  format: (v: number | null) => ReactNode;
  toned?: boolean;
  showTotal?: boolean;
}) {
  const columns: Column<HoleGridRow>[] = [
    { key: 'label', label: '', sortable: false, render: (r) => <span className="font-semibold text-ink">{r.label}</span> },
    ...holes.map<Column<HoleGridRow>>((h, idx) => ({
      key: `h${h.n}`,
      sortable: false,
      numeric: true,
      align: 'center',
      label: (
        <Tooltip content={`See every golfer's hole ${h.n} market on the Slate`}>
          <Link href={`/golf?market=hole-${h.n}`} className="block hover:text-ink hover:underline">
            {h.n}
            {h.par != null ? <span className="block font-normal">Par {h.par}</span> : null}
          </Link>
        </Tooltip>
      ),
      render: (r) => format(r.cells[idx] ?? null),
      ink: toned ? (r) => parTone(r.cells[idx]) : undefined,
    })),
    ...(showTotal
      ? [
          {
            key: 'total',
            label: 'Total',
            sortable: false,
            numeric: true,
            align: 'center',
            render: (r) => format(r.total ?? null),
            ink: toned ? (r) => parTone(r.total) : undefined,
          } satisfies Column<HoleGridRow>,
        ]
      : []),
  ];
  return <DataTable caption={caption} density="compact" columns={columns} rows={rows} totals={totals} rowKey={(r) => r.id} />;
}

function LiveLeaderboardCard({
  subjects,
  candidates,
  currentRound,
}: {
  subjects: SubjectSummary[];
  candidates: PickCandidate[];
  currentRound: number | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const ordered = useMemo(
    () => [...subjects].sort((a, b) => leaderboardScore(a.statusLine) - leaderboardScore(b.statusLine)),
    [subjects],
  );
  const rows = showAll ? ordered : ordered.slice(0, 15);

  const roundScoreById = useMemo(() => {
    const map = new Map<string, PickCandidate>();
    for (const c of candidates) if (c.dimension === 'round-score') map.set(c.subjectId, c);
    return map;
  }, [candidates]);

  const roundsPresent = useMemo(() => {
    const periods = candidates.filter((c) => c.dimension === 'round-score').flatMap((c) => c.history.map((h) => h.period));
    return Array.from(new Set(periods)).sort((a, b) => a - b).slice(0, 4);
  }, [candidates]);

  const moveMap = useMemo(
    () => buildMoveMap(candidates, currentRound, ordered.map((s) => s.subjectId)),
    [candidates, currentRound, ordered],
  );

  if (ordered.length === 0) {
    return null;
  }

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-label font-semibold text-masters">Leaderboard</h2>
        {ordered.length > 15 ? (
          <Button variant="link" size="sm" onPress={() => setShowAll((v) => !v)} className="text-overline">
            {showAll ? 'Show top 15' : `Show all ${ordered.length}`}
          </Button>
        ) : null}
      </div>
      {/* U6: the kit DataTable. Round scores carry a categorical TONE —
          under par good, over par bad, par plain — which is what the old
          gradient wash encoded; a rank-based heat would have called a
          birdie neutral in a field of birdies. */}
      <DataTable
        caption="Leaderboard"
        density="compact"
        columns={leaderboardColumns(roundsPresent)}
        rows={rows.map((s, i) => leaderboardRow(s, i, roundScoreById.get(s.subjectId), roundsPresent, moveMap.get(s.subjectId) ?? null))}
        rowKey={(r) => r.id}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// All Matchups — table of every tee-time group, click a row to expand into
// that group's live hole-by-hole scorecard. Leaderboard-sorted, so the
// leaders' group naturally reads first without a separate "featured" card.
// ---------------------------------------------------------------------------

interface MatchupMember {
  id: string;
  name: string;
  headshotUrl?: string;
  totalScore?: string;
  position?: string;
}

interface MatchupGroup {
  key: string;
  members: MatchupMember[];
  /** Shared across the group — they tee off together, so thru/tee time is one value, not per-member. */
  thru: number | null;
  teeTime: string | null;
}

function buildAllMatchups(candidates: PickCandidate[]): MatchupGroup[] {
  const roundScoreCandidates = candidates.filter((c) => c.dimension === 'round-score');
  const byId = new Map(roundScoreCandidates.map((c) => [c.subjectId, c]));
  const seen = new Set<string>();
  const groups: MatchupGroup[] = [];

  for (const c of roundScoreCandidates) {
    const meta = (c.subjectMeta ?? {}) as Record<string, unknown>;
    const groupedWith = (meta.groupedWith as Array<{ id: string; name: string; headshotUrl?: string }> | undefined) ?? [];
    if (groupedWith.length === 0) continue;

    const key = [c.subjectId, ...groupedWith.map((g) => g.id)].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const toMember = (id: string, name: string, headshotUrl: string | undefined, m: Record<string, unknown>): MatchupMember => ({
      id,
      name,
      headshotUrl,
      totalScore: typeof m.totalScore === 'string' ? m.totalScore : undefined,
      position: typeof m.position === 'string' ? m.position : undefined,
    });

    const members: MatchupMember[] = [
      toMember(c.subjectId, c.subjectName, typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined, meta),
      ...groupedWith.map((g) => toMember(g.id, g.name, g.headshotUrl, (byId.get(g.id)?.subjectMeta ?? {}) as Record<string, unknown>)),
    ];

    groups.push({
      key,
      members,
      thru: typeof meta.thru === 'number' ? meta.thru : null,
      teeTime: typeof meta.teeTime === 'string' ? meta.teeTime : null,
    });
  }

  return groups.sort(
    (a, b) => Math.min(...a.members.map((m) => leaderboardScore(m.totalScore))) - Math.min(...b.members.map((m) => leaderboardScore(m.totalScore))),
  );
}

function AllMatchupsCard({
  candidates,
  currentRound,
  holesByGolfer,
}: {
  candidates: PickCandidate[];
  currentRound: number | null;
  holesByGolfer: Map<string, PickCandidate[]>;
}) {
  const groups = useMemo(() => buildAllMatchups(candidates), [candidates]);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-label font-semibold text-masters">
        All matchups{currentRound != null ? ` · Round ${currentRound}` : ''}
      </h2>
      {groups.length === 0 ? (
        <p className="p-4 text-center text-label font-normal text-ink-muted">No tee-time pairings posted yet.</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {groups.map((g) => {
            const isOpen = expanded === g.key;
            return (
              <div key={g.key}>
                <Button
                  variant="tertiary"
                  size="sm"
                  onPress={() => setExpanded(isOpen ? null : g.key)}
                  aria-expanded={isOpen}
                  className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2 text-left font-normal hover:bg-surface-subtle"
                >
                  <span className="flex shrink-0 -space-x-2">
                    {g.members.map((m) => (
                      <span key={m.id} className="rounded-full ring-2 ring-card">
                        <SubjectAvatar name={m.name} headshotUrl={m.headshotUrl} size={24} />
                      </span>
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-label font-medium text-ink">
                    {g.members
                      .map((m) => `${m.name}${m.position ? ` (${m.position})` : ''}`)
                      .join(' · ')}
                  </span>
                  <span className="shrink-0 flex items-center gap-2 text-overline font-normal tracking-normal tabular-nums text-ink-muted">
                    {g.members.map((m) => splitStatusLine(m.totalScore)[0]).join(' / ')}
                  </span>
                  <span className="shrink-0 w-24 text-right text-overline font-normal tracking-normal tabular-nums text-ink-muted">
                    {g.thru != null && g.thru > 0 ? `thru ${g.thru}` : (formatTeeTime(g.teeTime) ?? '–')}
                  </span>
                  <span className={`shrink-0 text-ink-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                </Button>

                {isOpen ? (
                  <div className="border-t border-line-soft bg-surface-subtle p-2.5">
                    <HoleGrid
                      caption={`Scorecard, ${g.members.map((m) => m.name).join(', ')}`}
                      holes={Array.from({ length: 18 }, (_, i) => ({ n: i + 1 }))}
                      format={relDisplay}
                      rows={g.members.map((m) => {
                        const line = holeLineFor(m.id, currentRound, holesByGolfer);
                        const played = line.filter((h) => h.value !== null);
                        return {
                          id: m.id,
                          label: <span className="block max-w-[100px] truncate">{m.name}</span>,
                          cells: line.map((h) => h.value),
                          total: played.length > 0 ? played.reduce((sum, h) => sum + (h.value ?? 0), 0) : null,
                        };
                      })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Big Movers — biggest gainers/losers for the round in progress, read off
// each golfer's own hole lines rather than `round-score`'s history (that
// only fills in once a round is fully complete; movers matters most mid-round).
// ---------------------------------------------------------------------------

interface MoverRowData {
  id: string;
  name: string;
  headshotUrl?: string;
  total: number;
  thru: number;
}

function buildBigMovers(candidates: PickCandidate[], currentRound: number | null, holesByGolfer: Map<string, PickCandidate[]>): MoverRowData[] {
  if (currentRound == null) return [];
  const roundScoreCandidates = candidates.filter((c) => c.dimension === 'round-score');

  const rows: MoverRowData[] = roundScoreCandidates.map((c) => {
    const meta = (c.subjectMeta ?? {}) as Record<string, unknown>;
    const line = holeLineFor(c.subjectId, currentRound, holesByGolfer);
    const played = line.filter((h) => h.value !== null);
    return {
      id: c.subjectId,
      name: c.subjectName,
      headshotUrl: typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined,
      total: played.reduce((sum, h) => sum + (h.value ?? 0), 0),
      thru: played.length,
    };
  });

  return rows.filter((r) => r.thru > 0).sort((a, b) => a.total - b.total);
}

function MoverRow({ row }: { row: MoverRowData }) {
  const gradient = gradientCardStyle(golfScoreHeat(row.total));
  return (
    <li>
      <Link href={`/golf/player/${row.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1 text-label font-normal transition-colors hover:bg-surface-subtle">
        <SubjectAvatar name={row.name} headshotUrl={row.headshotUrl} size={20} />
        <span className="min-w-0 flex-1 truncate text-ink">{row.name}</span>
        <span className="shrink-0 font-bold tabular-nums" style={{ color: gradient.valueColor }}>
          {relDisplay(row.total)}
        </span>
        <span className="w-14 shrink-0 text-right text-overline font-normal tracking-normal text-ink-muted">thru {row.thru}</span>
      </Link>
    </li>
  );
}

function BigMoversCard({
  candidates,
  currentRound,
  holesByGolfer,
}: {
  candidates: PickCandidate[];
  currentRound: number | null;
  holesByGolfer: Map<string, PickCandidate[]>;
}) {
  const movers = useMemo(() => buildBigMovers(candidates, currentRound, holesByGolfer), [candidates, currentRound, holesByGolfer]);
  if (movers.length === 0) return null;

  const climbing = movers.slice(0, 5);
  const falling = [...movers].reverse().slice(0, 5);

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-label font-semibold text-masters">Big movers · Round {currentRound}</h2>
      <div className="grid grid-cols-1 gap-4 p-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-overline font-semibold uppercase tracking-wide text-good-ink">Climbing today</div>
          <ul className="space-y-1.5">
            {climbing.map((r) => (
              <MoverRow key={r.id} row={r} />
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1.5 text-overline font-semibold uppercase tracking-wide text-bad-ink">Falling today</div>
          <ul className="space-y-1.5">
            {falling.map((r) => (
              <MoverRow key={r.id} row={r} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Course Insights — field-wide scoring per hole, broken out by round plus a
// tournament-total column, and an Advanced Stats section (scoring
// distribution + season SG leaders within this field). Real substitute for
// "common errors": no shot-level data exists anywhere for this app to draw
// on, but "which holes are actually playing hard, and on which day" is the
// same question a broadcast graphic answers, and this is genuine field data.
// ---------------------------------------------------------------------------

interface HoleDifficultyRow {
  hole: number;
  par: number | null;
  byRound: Record<number, number | null>;
  total: number | null;
}

function avgOf(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function buildCourseDifficultyByRound(candidates: PickCandidate[], rounds: number[]): HoleDifficultyRow[] {
  const byHole = new Map<number, PickCandidate[]>();
  for (const c of candidates) {
    if (!/^hole-\d+$/.test(c.dimension)) continue;
    const hole = Number(c.dimension.slice('hole-'.length));
    const arr = byHole.get(hole);
    if (arr) arr.push(c);
    else byHole.set(hole, [c]);
  }

  const out: HoleDifficultyRow[] = [];
  for (const [hole, cands] of byHole) {
    const parMatch = /Par (\d+)/.exec(cands[0]?.dimensionLabel ?? '');
    const byRound: Record<number, number | null> = {};
    for (const r of rounds) {
      byRound[r] = avgOf(
        cands
          .map((c) => c.history.find((h) => h.period === r))
          .filter((h): h is NonNullable<typeof h> => h != null)
          .map(entryValue)
          .filter((v): v is number => v !== null),
      );
    }
    const total = avgOf(cands.flatMap((c) => c.history.map(entryValue)).filter((v): v is number => v !== null));
    out.push({ hole, par: parMatch ? Number(parMatch[1]) : null, byRound, total });
  }
  return out.sort((a, b) => a.hole - b.hole);
}

/** Every hole-instance played, bucketed birdie/par/bogey — the field's overall scoring character, not any one hole's. */
function buildScoringDistribution(candidates: PickCandidate[]): { birdiePct: number; parPct: number; bogeyPct: number; total: number } {
  let birdie = 0;
  let par = 0;
  let bogey = 0;
  for (const c of candidates) {
    if (!/^hole-\d+$/.test(c.dimension)) continue;
    for (const h of c.history) {
      if (h.category === 'birdie') birdie += 1;
      else if (h.category === 'par') par += 1;
      else if (h.category === 'bogey') bogey += 1;
    }
  }
  const total = birdie + par + bogey;
  return {
    birdiePct: total ? (birdie / total) * 100 : 0,
    parPct: total ? (par / total) * 100 : 0,
    bogeyPct: total ? (bogey / total) * 100 : 0,
    total,
  };
}

interface HoleDistribution {
  hole: number;
  birdiePct: number;
  parPct: number;
  bogeyPct: number;
  total: number;
}

/** Same birdie/par/bogey tally as `buildScoringDistribution`, kept per-hole instead of summed across the field — the "by hole" breakdown. */
function buildHoleScoringDistribution(candidates: PickCandidate[]): HoleDistribution[] {
  const byHole = new Map<number, { birdie: number; par: number; bogey: number }>();
  for (const c of candidates) {
    if (!/^hole-\d+$/.test(c.dimension)) continue;
    const hole = Number(c.dimension.slice('hole-'.length));
    const counts = byHole.get(hole) ?? { birdie: 0, par: 0, bogey: 0 };
    for (const h of c.history) {
      if (h.category === 'birdie') counts.birdie += 1;
      else if (h.category === 'par') counts.par += 1;
      else if (h.category === 'bogey') counts.bogey += 1;
    }
    byHole.set(hole, counts);
  }

  return Array.from(byHole.entries())
    .map(([hole, c]) => {
      const total = c.birdie + c.par + c.bogey;
      return {
        hole,
        birdiePct: total ? (c.birdie / total) * 100 : 0,
        parPct: total ? (c.par / total) * 100 : 0,
        bogeyPct: total ? (c.bogey / total) * 100 : 0,
        total,
      };
    })
    .sort((a, b) => a.hole - b.hole);
}

function CourseInsightsCard({
  candidates,
  rounds,
  fieldStats,
  fieldStatsLoading,
}: {
  candidates: PickCandidate[];
  rounds: number[];
  fieldStats: GolferStrokesGained[] | null;
  fieldStatsLoading: boolean;
}) {
  const holes = useMemo(() => buildCourseDifficultyByRound(candidates, rounds), [candidates, rounds]);
  const distribution = useMemo(() => buildScoringDistribution(candidates), [candidates]);
  const holeDistribution = useMemo(() => buildHoleScoringDistribution(candidates), [candidates]);
  const [showByHole, setShowByHole] = useState(false);
  const scored = holes.filter((h): h is HoleDifficultyRow & { total: number } => h.total !== null);

  const sgLeaders = useMemo(
    () => (fieldStats ? [...fieldStats].sort((a, b) => a.rank - b.rank).slice(0, 5) : []),
    [fieldStats],
  );

  if (scored.length === 0) return null;

  const hardest = [...scored].sort((a, b) => b.total - a.total)[0];
  const easiest = [...scored].sort((a, b) => a.total - b.total)[0];

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-label font-semibold text-masters">How the course is playing</h2>
        <span className="text-overline font-normal tracking-normal text-masters/70">
          Hardest: Hole {hardest.hole} ({relDisplayAvg(hardest.total)}) · Easiest: Hole {easiest.hole} ({relDisplayAvg(easiest.total)})
        </span>
      </div>

      <div className="p-2.5">
        <HoleGrid
          caption="Course difficulty by round"
          holes={holes.map((h) => ({ n: h.hole, par: h.par }))}
          format={(v) => (v == null ? '–' : relDisplayAvg(v))}
          rows={rounds.map((r) => ({
            id: `r${r}`,
            label: `R${r}`,
            cells: holes.map((h) => h.byRound[r] ?? null),
            total: avgOf(holes.map((h) => h.byRound[r]).filter((v): v is number => v !== null)),
          }))}
          totals={[{ id: 'all', label: 'All', cells: holes.map((h) => h.total), total: avgOf(scored.map((h) => h.total)) }]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-line-soft p-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-overline font-semibold uppercase tracking-wide text-ink-muted">Scoring distribution ({distribution.total} holes played)</span>
            <Button variant="link" size="sm" onPress={() => setShowByHole((v) => !v)} className="text-overline">
              {showByHole ? 'Hide by hole' : 'By hole'}
            </Button>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink/5">
            <Tooltip content={`Birdie or better: ${distribution.birdiePct.toFixed(1)}%`}><div className="bg-good" style={{ width: `${distribution.birdiePct}%` }} /></Tooltip>
            <Tooltip content={`Par: ${distribution.parPct.toFixed(1)}%`}><div className="bg-warn" style={{ width: `${distribution.parPct}%` }} /></Tooltip>
            <Tooltip content={`Bogey or worse: ${distribution.bogeyPct.toFixed(1)}%`}><div className="bg-bad" style={{ width: `${distribution.bogeyPct}%` }} /></Tooltip>
          </div>
          <div className="mt-1.5 flex justify-between text-overline font-normal tracking-normal text-ink-muted">
            <span>Birdie {distribution.birdiePct.toFixed(0)}%</span>
            <span>Par {distribution.parPct.toFixed(0)}%</span>
            <span>Bogey {distribution.bogeyPct.toFixed(0)}%</span>
          </div>

          {showByHole ? (
            <div className="lb-scroll-x mt-3 overflow-x-auto">
              <div className="flex min-w-full gap-1">
                {holeDistribution.map((h) => (
                  <div key={h.hole} className="flex min-w-[22px] flex-1 flex-col items-center gap-0.5">
                    <Tooltip content={`Hole ${h.hole}: ${h.birdiePct.toFixed(0)}% birdie, ${h.parPct.toFixed(0)}% par, ${h.bogeyPct.toFixed(0)}% bogey`}><div
                      className="flex h-14 w-3 flex-col-reverse overflow-hidden rounded-full bg-ink/5"
                    >
                      <div className="bg-good" style={{ height: `${h.birdiePct}%` }} />
                      <div className="bg-warn" style={{ height: `${h.parPct}%` }} />
                      <div className="bg-bad" style={{ height: `${h.bogeyPct}%` }} />
                    </div></Tooltip>
                    <span className="text-overline font-normal tracking-normal text-ink-muted">{h.hole}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div>
          <div className="mb-1.5 text-overline font-semibold uppercase tracking-wide text-ink-muted">
            Season SG leaders in this field{fieldStats ? ` · ${new Date().getFullYear()}` : ''}
          </div>
          {fieldStatsLoading && sgLeaders.length === 0 ? (
            <p className="text-overline font-normal tracking-normal text-ink-muted">Loading…</p>
          ) : sgLeaders.length === 0 ? (
            <p className="text-overline font-normal tracking-normal text-ink-muted">No strokes-gained data matched to this field yet.</p>
          ) : (
            <ul className="space-y-1">
              {sgLeaders.map((g) => (
                <li key={g.pgaTourPlayerId}>
                  {g.espnId ? (
                    <Link href={`/golf/player/${g.espnId}`} className="flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-overline font-normal tracking-normal transition-colors hover:bg-surface-subtle">
                      <span className="truncate text-ink">
                        #{g.rank} {g.playerName}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-ink-muted">{g.avgPerRound != null ? `${g.avgPerRound > 0 ? '+' : ''}${g.avgPerRound.toFixed(2)}` : '–'}</span>
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-overline font-normal tracking-normal text-ink-muted">Season strokes-gained, not tournament-specific — pgatour.com official stats.</p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Course Overview — existing par/yardage table, restyled to match.
// ---------------------------------------------------------------------------

function CourseOverviewCard({
  courseName,
  par,
  yards,
  city,
  holes,
}: {
  courseName?: string;
  par?: number;
  yards?: number;
  city?: string;
  holes: Array<{ number: number; shotsToPar: number; totalYards?: number }>;
}) {
  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-label font-semibold text-masters">Course overview</h2>
      <div className="p-3">
        {courseName ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm">
            <span className="font-semibold text-ink">{courseName}</span>
            {par != null ? <span className="text-ink-muted">Par {par}</span> : null}
            {yards != null ? <span className="text-ink-muted">{yards.toLocaleString()} yds</span> : null}
            {city ? <span className="text-ink-muted">{city}</span> : null}
          </div>
        ) : (
          <p className="mb-2 text-label font-normal text-ink-muted">No course record for this event yet.</p>
        )}

        {holes.length > 0 ? (
          <HoleGrid
            caption="Course"
            toned={false}
            showTotal={false}
            holes={holes.map((h) => ({ n: h.number }))}
            format={(v) => (v == null ? '—' : v)}
            rows={[
              { id: 'par', label: 'Par', cells: holes.map((h) => (typeof h.shotsToPar === 'number' ? h.shotsToPar : Number(h.shotsToPar) || null)) },
              ...(holes.some((h) => h.totalYards) ? [{ id: 'yards', label: 'Yards', cells: holes.map((h) => h.totalYards ?? null) }] : []),
            ]}
          />
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Weather — current reading + short forecast strip.
// ---------------------------------------------------------------------------

/**
 * How this hour's conditions typically play for a golfer — real golf-strategy
 * knowledge, not derived from any feed. Thresholds are the standard rules of
 * thumb (a club per ~10mph of wind, greens holding better in rain, ball
 * flying farther in heat), not measured against this course specifically.
 */
function weatherImpactText(hour: WeatherForecastHour): string {
  const parts: string[] = [];

  if (hour.windMph < 5) {
    parts.push('Calm — negligible effect on ball flight or club selection.');
  } else if (hour.windMph < 15) {
    parts.push('Light-to-moderate wind — expect some drift on approach shots; players will often go a club up or down into or with it.');
  } else if (hour.windMph < 25) {
    parts.push('Strong wind — a real factor in distance control and trajectory. Expect shorter, lower shots into the wind and putts on exposed greens getting harder to read.');
  } else {
    parts.push('Severe wind — very difficult scoring conditions. Expect wide score variance across the field and a lot of low, punched-out shots.');
  }

  if (hour.rainPct >= 60) {
    parts.push('High rain probability — greens typically get softer and more receptive (easier to hold an approach, but slower and harder to read), and tee shots lose roll.');
  } else if (hour.rainPct >= 30) {
    parts.push('Some rain risk — grip and footing become a small factor, and wet gloves can cost a bit of control.');
  }

  if (hour.tempF != null) {
    if (hour.tempF < 50) {
      parts.push('Cold — the ball flies noticeably shorter, and full swings are harder to make until players are warmed up.');
    } else if (hour.tempF > 90) {
      parts.push('Hot — the ball flies farther, but fatigue over a full round becomes a real factor, especially late.');
    }
  }

  return parts.join(' ');
}

function WeatherCard({ weather }: { weather: WeatherContext }) {
  const [selected, setSelected] = useState<number | null>(null);
  const forecast = weather.forecast ?? [];
  const selectedHour = selected != null ? forecast[selected] : null;

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-label font-semibold text-masters">Weather</h2>
      <div className="p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm">
          <WeatherIcon windMph={weather.windMph} rainPct={weather.rainPct} size={18} className="text-masters" />
          <span className="font-bold text-ink">
            {weather.windMph} mph {weather.windDir}
          </span>
          <span className="text-ink-muted">{weather.rainPct}% rain</span>
          {weather.tempF != null ? <span className="text-ink-muted">{weather.tempF}°F</span> : null}
        </div>
        <p className="mt-1 text-overline font-normal tracking-normal text-ink-muted">{weather.approximateLocation ? 'City-level estimate' : 'Course-exact'}</p>

        {forecast.length > 1 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto lb-scroll-x">
            {forecast.map((f, i) => {
              const isSelected = selected === i;
              return (
                <Button
                  key={f.time}
                  variant="secondary"
                  size="sm"
                  onPress={() => setSelected(isSelected ? null : i)}
                  aria-pressed={isSelected}
                  className={cx(
                    'h-auto min-w-[62px] flex-col gap-0.5 border px-2 py-1.5 text-center font-normal ring-0',
                    isSelected ? 'border-masters bg-accent-soft hover:bg-accent-soft' : 'border-line hover:border-masters/30 hover:bg-card',
                  )}
                >
                  <span className="text-overline tracking-normal font-semibold text-ink-muted">
                    {i === 0 ? 'Now' : new Date(f.time).toLocaleTimeString('en-US', { hour: 'numeric' })}
                  </span>
                  <WeatherIcon windMph={f.windMph} rainPct={f.rainPct} size={16} className={isSelected ? 'text-masters' : 'text-ink-muted'} />
                  <span className="text-label font-bold tabular-nums text-ink">{f.windMph}</span>
                  <span className="text-overline font-normal tracking-normal text-ink-muted">{f.windDir} mph</span>
                  {f.tempF != null ? <span className="text-overline font-normal tracking-normal text-ink-muted">{f.tempF}°</span> : null}
                </Button>
              );
            })}
          </div>
        ) : null}

        {selectedHour ? (
          <div className="mt-3 rounded-lg border border-line-soft bg-surface-subtle p-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-overline tracking-normal font-semibold text-ink">
              <span>{selected === 0 ? 'Right now' : new Date(selectedHour.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
              <span className="font-normal text-ink-muted">
                {selectedHour.windMph} mph {selectedHour.windDir} · {selectedHour.rainPct}% rain
                {selectedHour.tempF != null ? ` · ${selectedHour.tempF}°F` : ''}
              </span>
            </div>
            <p className="text-overline font-normal tracking-normal leading-snug text-ink-muted">{weatherImpactText(selectedHour)}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Top Standings — Top 5 / Top 10 as a real filterable view of the current
// leaderboard. Not a priced market: real Top 5/Top 10 lines don't exist from
// any free source (checked again — unchanged since the original golf-rebuild
// audit), so this is standing, clearly labeled as such, not a bet.
// ---------------------------------------------------------------------------

function TopStandingsCard({ subjects }: { subjects: SubjectSummary[] }) {
  const [view, setView] = useState<5 | 10>(5);
  const ordered = useMemo(
    () => [...subjects].sort((a, b) => leaderboardScore(a.statusLine) - leaderboardScore(b.statusLine)),
    [subjects],
  );
  const rows = ordered.slice(0, view);

  if (rows.length === 0) return null;

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-label font-semibold text-masters">Top {view}</h2>
        <span className="inline-flex items-center gap-0.5 rounded-lg bg-ink/[0.05] p-0.5">
          {([5, 10] as const).map((n) => (
            <Button
              key={n}
              size="sm"
              variant="tertiary"
              onPress={() => setView(n)}
              aria-pressed={view === n}
              className={cx('h-auto rounded-md px-2 py-0.5 text-overline', view === n ? 'bg-card text-ink shadow-card hover:bg-card' : 'text-ink-muted')}
            >
              Top {n}
            </Button>
          ))}
        </span>
      </div>
      <ul className="divide-y divide-line-soft">
        {rows.map((s, i) => {
          const meta = (s.meta ?? {}) as Record<string, unknown>;
          const [score] = splitStatusLine(s.statusLine);
          return (
            <li key={s.subjectId}>
              <Link href={`/golf/player/${s.subjectId}`} className="flex items-center gap-2 px-3 py-1.5 text-label font-normal transition-colors hover:bg-surface-subtle">
                <span className="w-6 shrink-0 text-center font-bold text-ink-muted">{i + 1}</span>
                <SubjectAvatar
                  name={s.subjectName}
                  headshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
                  fallbackUrl={typeof meta.flagUrl === 'string' ? meta.flagUrl : undefined}
                  size={20}
                />
                <span className="min-w-0 flex-1 truncate text-ink">{s.subjectName}</span>
                <span className="shrink-0 font-bold tabular-nums text-ink">{score}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line-soft px-3 py-1.5 text-overline font-normal tracking-normal text-ink-muted">
        Current standing, not a priced line — no free Top 5/Top 10 odds source exists yet.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Our Lines — the app's own real markets (Hole Props / Round Score) for
// this event, surfaced here since the odds rail otherwise only ever shows
// the third-party Match Winner board.
// ---------------------------------------------------------------------------

function OurLinesCard({
  candidates,
  onAdd,
  addedKeys,
}: {
  candidates: PickCandidate[];
  onAdd?: (candidate: PickCandidate) => void;
  addedKeys?: Set<string>;
}) {
  const rows = useMemo(
    () =>
      candidates
        .filter((c) => c.dimension === 'round-score' && c.consistent && c.sampleSize >= 2)
        .sort((a, b) => b.sampleSize - a.sampleSize)
        .slice(0, 6),
    [candidates],
  );

  if (rows.length === 0) return null;

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-label font-semibold text-masters">Our lines</h2>
      <ul className="divide-y divide-line-soft">
        {rows.map((c) => {
          const meta = (c.subjectMeta ?? {}) as Record<string, unknown>;
          const key = `${c.sport}:${c.subjectId}:${c.dimension}:${c.category}`;
          const added = addedKeys?.has(key);
          return (
            <li key={key} className="flex items-center gap-2 px-3 py-1.5 text-label font-normal">
              <SubjectAvatar name={c.subjectName} headshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined} size={20} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ink">{c.subjectName}</div>
                <div className="truncate text-overline font-normal tracking-normal text-ink-muted">
                  {c.categoryLabel} · {c.sampleSize}/{c.sampleSize} rounds
                </div>
              </div>
              {onAdd ? (
                <Button
                  size="sm"
                  variant={added ? 'secondary' : 'primary'}
                  onPress={() => onAdd(c)}
                  isDisabled={added}
                  aria-label={added ? 'On slip' : 'Add to slip'}
                  className="h-auto px-2 py-1 text-overline"
                >
                  {added ? '✓' : '+'}
                </Button>
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

export function GolfScheduleView({
  events,
  loading,
  warnings,
  snapshot,
  golfLines,
  golfLinesLoading,
  golfLinesWarnings,
  fieldStats,
  fieldStatsLoading,
  onAdd,
  addedKeys,
}: {
  events: ScheduleEvent[];
  loading: boolean;
  warnings: string[];
  snapshot: SportSnapshot | null;
  golfLines: GolfOutrightLine[];
  golfLinesLoading: boolean;
  golfLinesWarnings: string[];
  fieldStats: GolferStrokesGained[] | null;
  fieldStatsLoading: boolean;
  onAdd?: (candidate: PickCandidate) => void;
  addedKeys?: Set<string>;
}) {
  const currentEventName = snapshot?.eventName ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const currentEvent = events.find((e) => e.name === currentEventName);
  const activeId = selectedId ?? currentEvent?.id ?? events[0]?.id ?? null;
  const active = events.find((e) => e.id === activeId) ?? null;
  const isLiveEvent = active != null && active.name === currentEventName;

  const candidates = snapshot?.candidates ?? [];
  const subjects = snapshot?.subjects ?? [];
  const course = (snapshot?.context?.other as Record<string, unknown> | undefined) ?? {};
  const holes = Array.isArray(course.holes) ? (course.holes as Array<{ number: number; shotsToPar: number; totalYards?: number }>) : [];
  const weather = snapshot?.context?.weather;

  const currentRound = useMemo(() => {
    const periods = candidates.filter((c) => /^hole-\d+$/.test(c.dimension)).flatMap((c) => c.history.map((h) => h.period));
    return periods.length > 0 ? Math.max(...periods) : null;
  }, [candidates]);

  const roundsPresent = useMemo(() => {
    const periods = candidates.filter((c) => /^hole-\d+$/.test(c.dimension)).flatMap((c) => c.history.map((h) => h.period));
    return Array.from(new Set(periods)).sort((a, b) => a - b).slice(0, 4);
  }, [candidates]);

  const holesByGolfer = useMemo(() => {
    const map = new Map<string, PickCandidate[]>();
    for (const c of candidates) {
      if (!/^hole-\d+$/.test(c.dimension)) continue;
      const arr = map.get(c.subjectId);
      if (arr) arr.push(c);
      else map.set(c.subjectId, [c]);
    }
    return map;
  }, [candidates]);

  const spotlightCards = useMemo(
    () => buildSpotlightCards(subjects, candidates, currentRound, holesByGolfer),
    [subjects, candidates, currentRound, holesByGolfer],
  );

  if (loading && events.length === 0) {
    return <div className="lb-card h-48 animate-pulse" />;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr] lg:items-start">
      <div className="lb-card overflow-hidden lg:sticky lg:top-4">
        {warnings.length > 0 ? (
          <div className="border-b border-warn/30 bg-warn/5 p-2 text-overline font-normal tracking-normal text-warn-ink">
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}
        {/* U3: the kit PickList (React Aria ListBox). */}
        <PickList
          label="Schedule"
          className="max-h-[75vh] overflow-y-auto p-1.5"
          value={activeId}
          onChange={setSelectedId}
          empty="No schedule data available."
          items={events.map((e) => ({
            key: e.id,
            label: e.name,
            image: <TournamentLogo name={e.name} size={16} />,
            badge: <StatusChip status={e.status} completed={e.completed} />,
            sub: formatDateRange(e.startDate, e.endDate),
          }))}
        />
      </div>

      <div className="min-w-0">
        {!active ? (
          <div className="lb-card p-8 text-center text-sm text-ink-muted">Select an event to see its details.</div>
        ) : !isLiveEvent ? (
          <div className="space-y-3">
            <div className="lb-card p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="text-body font-semibold text-ink">{active.name}</h2>
                <StatusChip status={active.status} completed={active.completed} />
              </div>
              <p className="text-label font-normal text-ink-muted">{formatDateRange(active.startDate, active.endDate)}</p>
            </div>
            <div className="lb-card p-3 text-label font-normal text-ink-muted">
              Detailed course info, leaderboard, matchups and weather are only available once this becomes the active
              tournament — ESPN&apos;s schedule feed doesn&apos;t carry that detail for future or past weeks. Check back
              when {active.name} is live.
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px] lg:items-start">
            <div className="min-w-0 space-y-3">
              <TournamentHeroCard
                event={active}
                courseName={typeof course.courseName === 'string' ? course.courseName : undefined}
                spotlightCards={spotlightCards}
                weather={weather}
                currentRound={currentRound}
              />
              {subjects.length === 0 ? (
                <TournamentNotStartedNotice eventName={active.name} detail={formatDateRange(active.startDate, active.endDate)} />
              ) : null}
              <LiveLeaderboardCard subjects={subjects} candidates={candidates} currentRound={currentRound} />
              <AllMatchupsCard candidates={candidates} currentRound={currentRound} holesByGolfer={holesByGolfer} />
              <BigMoversCard candidates={candidates} currentRound={currentRound} holesByGolfer={holesByGolfer} />
              <CourseInsightsCard candidates={candidates} rounds={roundsPresent} fieldStats={fieldStats} fieldStatsLoading={fieldStatsLoading} />
              <CourseOverviewCard
                courseName={typeof course.courseName === 'string' ? course.courseName : undefined}
                par={typeof course.par === 'number' ? course.par : undefined}
                yards={typeof course.yards === 'number' ? course.yards : undefined}
                city={typeof course.city === 'string' ? course.city : undefined}
                holes={holes}
              />
              {weather ? <WeatherCard weather={weather} /> : null}
            </div>

            <div className="space-y-3 lg:sticky lg:top-4">
              <TournamentLinesView lines={golfLines} subjects={subjects} eventName={snapshot?.eventName ?? null} loading={golfLinesLoading} warnings={golfLinesWarnings} />
              <TopStandingsCard subjects={subjects} />
              <OurLinesCard candidates={candidates} onAdd={onAdd} addedKeys={addedKeys} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default GolfScheduleView;
