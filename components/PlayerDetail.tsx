'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PickCandidate, SportSnapshot, HistoryEntry } from '@/lib/core/types';
import {
  categoriseByLine,
  entryValue,
  fixedWindow,
  openWindow,
  subsetWindow,
  isOk,
  OVER,
  UNDER,
  type WindowedStat,
} from '@/lib/core/windowedStat';
import { compareInk, gradientCardStyle, deltaGradientStyle, heatFill, toneFill } from '@/lib/ui/heat';
import { markFor, TONE_CLASS } from '@/lib/ui/marks';
import { teamPrimaryColor, withAlpha } from '@/lib/sports/mlb/teamColors';
import { teamNameFor } from '@/lib/sports/mlb/teamAliases';
import { projectLine } from '@/lib/odds/display';
import { computeMoneylineEdge, computeTotalEdge } from '@/lib/odds/gameEdge';
import { buildSlate, liveFor, type SlateEntry, type SlateGame } from '@/lib/odds/matching';
import { useLiveGame } from './useLiveGame';
import { useTeamStatcast } from './useTeamStatcast';
import { StatRankRow } from './StatRankRow';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import { SubjectAvatar, TeamLogo, mlbHeadshotUrl } from './SubjectAvatar';
import { marketText, directionMark } from './MarketLabel';
import { InsufficientMark, formatRate } from './StatCells';
import { OddsChip, GetOddsButton, EdgeBadge } from './OddsChip';
import { BookLogo } from './BookLogo';
import { usePropOdds, resolveCandidateEdge } from './usePropOdds';
import { PropOddsBoard } from './PropOddsPanel';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import { SegmentedToggle } from './SegmentedToggle';
import { computePropScore } from '@/lib/odds/props/propScore';
import { useMarketCalibration, type MarketCalibrationState } from './useMarketCalibration';
import { PropScoreBadge } from './PropScoreBadge';
import { BatterPitcherMatchupCard } from './BatterPitcherMatchupCard';
import type { GameDetailGame, StatKeyDef } from './GameDetail';
import { GolfPlayerStatsCard } from './GolfPlayerStatsCard';
import type { AdvancedStat, GolferStrokesGained } from '@/lib/sports/golf/pgatourStats';
import type { PlayerSeasonLog } from '@/lib/sports/golf/playerSeason';
import type { GolfCategory } from '@/lib/sports/golf/adapter';

/**
 * Everything known about one player's one market.
 *
 * Built as a component rather than a page so Game Detail can swap it into its
 * main pane without a second implementation — the route is a thin wrapper.
 *
 * The line stepper is the piece that makes this more than a report: moving the
 * threshold re-reads the same games and asks a different question of them, so
 * every window, the chart and its baseline recompute together off one number.
 */

// ---------------------------------------------------------------------------
// Gamelog columns
// ---------------------------------------------------------------------------

/**
 * The per-game stat columns, keyed to what the Stats API returns on a split.
 *
 * Kept in step with `GAME_LOG_FIELDS` in `statsapi.ts` — a key absent from that
 * allow-list arrives undefined and renders as a dash, which looks like a zero
 * game rather than a missing field.
 */
const GAMELOG_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'plateAppearances', label: 'PA' },
  { key: 'atBats', label: 'AB' },
  { key: 'hits', label: 'H' },
  { key: 'runs', label: 'R' },
  { key: 'rbi', label: 'RBI' },
  { key: 'totalBases', label: 'TB' },
  { key: 'doubles', label: '2B' },
  { key: 'triples', label: '3B' },
  { key: 'homeRuns', label: 'HR' },
  { key: 'baseOnBalls', label: 'BB' },
  { key: 'strikeOuts', label: 'SO' },
  { key: 'stolenBases', label: 'SB' },
  { key: 'hitByPitch', label: 'HBP' },
  { key: 'earnedRuns', label: 'ER' },
  { key: 'inningsPitched', label: 'IP' },
];

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

function mlbLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

/** Minimal stroke icons, matching TopBar's icon language (16px viewBox, currentColor). */
function TicketIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden>
      <path d="M1.5 6.5a1.5 1.5 0 0 0 0-3V2.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1V3.5a1.5 1.5 0 0 0 0 3v.5a1.5 1.5 0 0 0 0 3v1a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-1a1.5 1.5 0 0 0 0-3v-.5Z" strokeLinejoin="round" />
      <path d="M6 2v11" strokeDasharray="1.4 1.4" strokeLinecap="round" />
    </svg>
  );
}

function PulseIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.4" className={className} aria-hidden>
      <path d="M1 8.5h3l1.5-4 3 7 1.5-4.5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Shape adapter.ts's `opposingStarterCard` attaches to `subjectMeta.opposingStarterStats`. */
export interface OpposingStarterStat {
  key: string;
  label: string;
  value: number;
  decimals: number;
  rank: number;
  poolSize: number;
}

/** Shape adapter.ts's `ownStatcastSummary` attaches to `subjectMeta.ownStatcastSummary` — the composite headline for the Quality of Contact card's per-stat tiles. */
interface OwnStatcastSummary {
  overallRank: number | null;
  poolSize: number;
  position: string;
  positionRank: number | null;
  positionPoolSize: number;
}

export function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

/** "#12 " to lead a pitcher's name with their overall composite rank — empty string (not "#N/A") until the rankings have been computed for the season, so a name just reads plainly instead of showing a placeholder. */
export function pitcherRankPrefix(overallRank: { rank: number | null; poolSize: number } | undefined): string {
  return overallRank?.rank != null ? `#${overallRank.rank} ` : '';
}

/** Same convention, batter side — leads the PlayerDetail header with the batter's own overall Statcast composite rank. */
function ownStatcastRankPrefix(summary: OwnStatcastSummary | undefined): string {
  return summary?.overallRank != null ? `#${summary.overallRank} ` : '';
}

/** `forRanks` are pre-formatted ordinal strings ("28th") — pulls the raw int back out. Duplicated from GameDetail.tsx's own local helper (same small-duplication convention already used elsewhere in this file). */
function parseRank(s: string | null | undefined): number | null {
  const m = /^(\d+)/.exec(s ?? '');
  return m ? Number(m[1]) : null;
}

/** Converts a team's season `forStats`/`forRanks` into the same `OpposingStarterStat[]` shape as the ranked player-level stats, for the "Pitcher vs. lineup" matchup card's opponent side — reuses the team context Game Detail/Team Detail already read off the same slate game, no new fetch. */
function teamSeasonStatRows(team: GameDetailGame['home'], statKeys: StatKeyDef[]): OpposingStarterStat[] {
  if (!team) return [];
  return statKeys
    .map((k): OpposingStarterStat | null => {
      const value = team.forStats[k.key];
      const rank = parseRank(team.forRanks[k.key]);
      if (value == null || rank == null) return null;
      return { key: k.key, label: k.label, value, decimals: k.decimals, rank, poolSize: 30 };
    })
    .filter((s): s is OpposingStarterStat => s != null);
}

/** Columns with at least one real value — a batter shouldn't show ER and IP. */
function usedColumns(history: PickCandidate['history']) {
  return GAMELOG_COLUMNS.filter(({ key }) =>
    history.some((entry) => {
      const value = rawOf(entry)[key];
      return value != null && value !== '' && Number(value) !== 0;
    }),
  );
}

/** The 5 headline stats shown as label+value pairs on a gamelog card — a subset of GAMELOG_COLUMNS, labeled inline since a card row has no column header to label it. */
const STAT_BADGE_DEFS: Array<{ key: string; label: string }> = [
  { key: 'hits', label: 'H' },
  { key: 'runs', label: 'R' },
  { key: 'rbi', label: 'RBI' },
  { key: 'baseOnBalls', label: 'BB' },
  { key: 'strikeOuts', label: 'SO' },
];

function fieldSeries(history: PickCandidate['history'], key: string): number[] {
  return history.map((entry) => Number(rawOf(entry)[key]) || 0);
}

function fieldSum(history: PickCandidate['history'], key: string): number {
  return fieldSeries(history, key).reduce((a, b) => a + b, 0);
}

/** Baseball convention drops the leading zero — ".179", never "0.179". */
function formatAvg(rate: number): string {
  return rate.toFixed(3).replace(/^0\./, '.');
}

// ---------------------------------------------------------------------------
// Distribution chart
// ---------------------------------------------------------------------------

/**
 * One bar per game, with the line drawn across them.
 *
 * The threshold line is the point of the chart: bars are coloured by which side
 * of it they landed, so "how often" and "by how much" are answerable in one
 * look. Hovering a bar dims the rest and reveals its exact value — the number
 * only matters for the game you're actually looking at, so it stays out of the
 * way otherwise.
 *
 * Bars grow up from zero whenever `refreshKey` changes (market switch, line
 * stepper move, or a fresh snapshot) — not on every re-render, e.g. a hover.
 */
export function DistributionChart({
  history,
  line,
  wantOver,
  height = 140,
  refreshKey,
  logoFor,
}: {
  history: PickCandidate['history'];
  line: number;
  wantOver: boolean;
  height?: number;
  refreshKey: string | number;
  /** Resolves a bar's opponent logo URL from its history entry. Defaults to MLB's numeric-opponentId lookup (`rawOf(entry).opponentId` via `mlbLogoUrl`) so every existing call site keeps working unchanged; a sport whose `raw` carries an opponent differently (NFL's `opponentAbbr`) passes its own resolver instead of forcing its shape through MLB's. */
  logoFor?: (entry: PickCandidate['history'][number]) => string | undefined;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [grown, setGrown] = useState(false);

  // A short timeout rather than requestAnimationFrame: rAF is paused while
  // the tab is backgrounded or not actively compositing, which would leave
  // bars stuck at zero height until the tab regains focus.
  useEffect(() => {
    setGrown(false);
    const t = setTimeout(() => setGrown(true), 20);
    return () => clearTimeout(t);
  }, [refreshKey]);

  const points = history.map((entry) => {
    const oid = rawOf(entry).opponentId as number | undefined;
    return {
      value: entryValue(entry),
      label: entry.periodLabel ?? '',
      logoUrl: logoFor ? logoFor(entry) : oid != null ? mlbLogoUrl(oid) : undefined,
    };
  });

  if (points.length === 0) {
    return <p className="p-6 text-center text-sm text-ink-muted">No games in this scope.</p>;
  }

  const max = Math.max(line + 1, ...points.map((p) => p.value ?? 0));
  const scale = (v: number) => (max <= 0 ? 0 : (v / max) * height);
  // Below-bar stack: 4px gap + 12px team logo + 4px gap + ~12px date label.
  const footer = 32;

  return (
    <div className="lb-scroll-x">
      <div className="relative flex min-w-full items-end gap-1 px-1" style={{ height: height + footer }}>
        {/* The line itself. */}
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-masters/70"
          style={{ bottom: footer + scale(line) }}
          aria-hidden
        >
          <span className="absolute -top-2 right-0 rounded bg-masters px-1 text-[9px] font-semibold text-white">
            {line}
          </span>
        </div>

        {points.map((point, index) => {
          const value = point.value;
          const targetHeight = value == null ? 2 : Math.max(2, scale(value));
          const barHeight = grown ? targetHeight : 0;
          const isHovered = hovered === index;
          const dimmed = hovered != null && !isHovered;
          // Signed margin over/under the line — always positive when cleared,
          // regardless of over/under direction — fed into the same OKLCH
          // gradient ramp the window tiles use, so a hit reads in the same
          // soft green as the rest of the page rather than a flatter, darker
          // tone from a different ramp.
          const signedDelta = value == null ? 0 : wantOver ? value - line : line - value;

          return (
            <div
              key={index}
              className="flex min-w-[32px] flex-1 flex-col items-center justify-end gap-1"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered((h) => (h === index ? null : h))}
            >
              <div
                className="relative w-full rounded-t-[2px] transition-[height,opacity] duration-500 ease-out"
                style={{
                  height: barHeight,
                  background: value == null ? 'rgb(147 162 154 / 0.35)' : deltaGradientStyle(signedDelta).fillBackground,
                  opacity: value == null ? (dimmed ? 0.25 : 0.5) : dimmed ? 0.3 : 0.85,
                }}
                title={`${point.label}: ${value ?? 'unrecorded'}`}
              >
                {/* Value lives inside the bar, subtle, hover-only — a label
                    floating above it competed with neighboring bars for
                    space at high game counts. */}
                <span
                  className="absolute inset-0 flex items-center justify-center text-[8px] font-semibold text-white/90 transition-opacity duration-150"
                  style={{ opacity: isHovered ? 1 : 0 }}
                >
                  {value ?? '–'}
                </span>
              </div>
              {point.logoUrl ? (
                <TeamLogo logoUrl={point.logoUrl} size={12} />
              ) : (
                <span className="h-3 w-3 shrink-0" aria-hidden />
              )}
              <span className="w-full truncate text-center text-[8px] leading-none text-ink-faint">
                {/* periodLabel is "MM-DD vs/@ Opponent Name" (adapter.ts) — the
                    logo above already says who, so only the date needs to fit
                    here; the full label is still on the bar's own title. */}
                {point.label.split(' ')[0]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gamelog — summary strip + per-game cards
// ---------------------------------------------------------------------------

/** One game, card form — the alternative to a gamelog table row. Same fields (team, date/opponent, per-game stats), read as a scannable list instead of a dense grid. */
function GamelogCard({ entry, columns }: { entry: PickCandidate['history'][number]; columns: Array<{ key: string; label: string }> }) {
  const raw = rawOf(entry);
  const entryOpponentId = raw.opponentId as number | undefined;
  const hits = Number(raw.hits) || 0;
  const atBats = Number(raw.atBats) || 0;
  const runs = Number(raw.runs) || 0;
  // "0-4" is the standard box-score AB line; only meaningful when this
  // entry actually carries batting fields (a pitcher's log won't).
  const hasBattingLine = columns.some((c) => c.key === 'hits') && columns.some((c) => c.key === 'atBats');
  const badges = STAT_BADGE_DEFS.filter((d) => columns.some((c) => c.key === d.key));

  return (
    <div
      className="flex items-center gap-3 border-l-[3px] px-3 py-2.5 transition-colors hover:bg-surface-subtle"
      style={{ borderLeftColor: entryOpponentId != null ? teamPrimaryColor(entryOpponentId) : 'transparent' }}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-card">
        {entryOpponentId != null ? <TeamLogo logoUrl={mlbLogoUrl(entryOpponentId)} size={18} /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-[12px] font-semibold text-ink">{entry.periodLabel ?? `Game #${entry.period}`}</span>
          {hasBattingLine ? (
            <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
              {hits}-{atBats}
              {runs > 0 ? `, ${runs} R` : ''}
            </span>
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {badges.map((badge) => {
            const value = raw[badge.key];
            return (
              <span key={badge.key} className="flex items-center gap-1 text-[11px]">
                <span className="font-semibold uppercase tracking-wide text-masters">{badge.label}</span>
                <span className="font-semibold tabular-nums text-ink">{value == null || value === '' ? '–' : String(value)}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live game — baserunners, count, line tracker
// ---------------------------------------------------------------------------

/** Occupied-base diamond — home at bottom (implied, not drawn as a base), 2nd/1st/3rd around it. Filled masters-green when occupied, outline otherwise; stroke-only, matching the app's icon language rather than a filled colored graphic. */
function BaseDiamond({ first, second, third }: { first: boolean; second: boolean; third: boolean }) {
  const base = (cx: number, cy: number, occupied: boolean) => (
    <rect
      x={cx - 4}
      y={cy - 4}
      width={8}
      height={8}
      transform={`rotate(45 ${cx} ${cy})`}
      fill={occupied ? '#141619' : '#ffffff'}
      stroke={occupied ? '#141619' : '#b6b7ba'}
      strokeWidth={1.5}
    />
  );
  return (
    <svg viewBox="0 0 40 40" width={30} height={30} aria-hidden>
      <path d="M20 10 L30 20 L20 30 L10 20 Z" fill="none" stroke="#d3d4d7" strokeWidth={1} />
      {base(20, 10, second)}
      {base(30, 20, first)}
      {base(10, 20, third)}
    </svg>
  );
}

/** Ball/strike/out lights — the same dot-row convention every broadcast score bug uses. */
function CountDots({ label, filled, total, color }: { label: string; filled: number; total: number; color: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-[8px] font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      <span className="flex gap-0.5">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: i < filled ? color : '#d3d4d7' }} />
        ))}
      </span>
    </span>
  );
}

/** One tracked market's live progress toward its line — cleared (green, checkmark) or a fill bar toward it. `liveValue` absent (vs-LHP/vs-RHP, no live mapping) renders nothing rather than a fabricated status. */
function LineTrackerRow({ candidate, liveValue }: { candidate: PickCandidate; liveValue: number | undefined }) {
  const dir = directionMark(candidate.category);
  if (liveValue == null || dir === null) return null;
  const line = candidate.line ?? 0.5;
  const cleared = dir === 'O' ? liveValue > line : liveValue <= line;
  const pct = dir === 'O' ? Math.min(1, line > 0 ? liveValue / line : liveValue) : 1 - Math.min(1, liveValue / (line + 1));

  return (
    <div
      className="flex items-center gap-2 border-b border-line-hair px-1.5 py-1 last:border-0"
      style={{ backgroundColor: cleared ? toneFill('good', 0.08) : undefined }}
    >
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
        {marketText(candidate.sport, candidate.dimension, 'full')} {dir === 'O' ? 'O' : 'U'} {line}
      </span>
      {candidate.odds ? (
        <span className="flex shrink-0 items-center gap-1">
          <BookLogo bookId={candidate.odds.source} size={10} />
          <OddsChip price={candidate.odds.americanOdds} source={candidate.odds.source} capturedAt={candidate.odds.capturedAt} />
        </span>
      ) : null}
      {!cleared ? (
        <span className="h-1 w-10 shrink-0 rounded-full bg-line-hair">
          <span
            className="block h-1 rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: heatFill(pct) }}
          />
        </span>
      ) : null}
      <span className="shrink-0 text-[11px] font-bold tabular-nums" style={{ color: cleared ? '#0f7a4f' : undefined }}>
        {cleared ? '✓' : liveValue}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Window summary boxes
// ---------------------------------------------------------------------------

export function WindowBox({
  label,
  stat,
  showCount,
}: {
  label: string;
  stat: WindowedStat;
  /** True for open-ended windows, whose denominator has to be disclosed. */
  showCount?: boolean;
}) {
  if (stat.status === 'insufficient') {
    return (
      <div className="relative min-w-[76px] flex-1 overflow-hidden rounded-[10px] border border-line bg-card px-1.5 py-2 text-center transition-all duration-150 ease-out hover:-translate-y-0.5 hover:border-masters/30">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
        <div className="mt-1 text-[14px] font-bold">
          <InsufficientMark available={stat.available} required={stat.required} />
        </div>
        <div className="mt-[5px] h-1 rounded-full bg-ink/[0.06]" />
      </div>
    );
  }

  const gradient = gradientCardStyle(stat.rate);
  const caption = showCount ? `${stat.hits}/${stat.total}` : `Avg ${stat.average.toFixed(2)}`;

  return (
    <div
      className="relative min-w-[76px] flex-1 overflow-hidden rounded-[10px] border border-black/[0.06] bg-card px-1.5 py-2 text-center transition-all duration-150 ease-out hover:-translate-y-0.5"
      style={{ boxShadow: gradient.boxShadow }}
      title={`${stat.hits} of ${stat.total}`}
    >
      <div className="pointer-events-none absolute -inset-2" style={{ background: gradient.labelGlow }} />
      <div className="relative text-[14px] font-bold leading-tight" style={{ color: gradient.valueColor }}>
        {formatRate(stat.rate)}
      </div>
      <div className="relative mt-px text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="relative mt-[3px] text-[8px] tabular-nums text-ink-faint/80">{caption}</div>
      <div className="relative mt-1 h-1 rounded-full bg-black/[0.06]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.round(stat.rate * 100)}%`, background: gradient.fillBackground }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matches — golf's live and historical group-matchup cards
// ---------------------------------------------------------------------------

/** Shape adapter.ts's `toGroupMate` attaches wherever a groupmate identity is needed — see GroupMate in lib/sports/golf/adapter.ts. */
interface GroupMateMeta {
  id: string;
  name: string;
  headshotUrl?: string;
}

/** Shape adapter.ts's `buildLiveRoundMatchup` attaches to `subjectMeta.liveRoundMatchup` — see LiveRoundMatchup in lib/sports/golf/adapter.ts. */
interface LiveRoundMatchupMeta {
  round: number;
  opponent: GroupMateMeta;
  holes: Array<{ hole: number; par: number | null; self: number | null; opponent: number | null }>;
}

/** Shape adapter.ts's `buildPastRoundMatchups` attaches to `subjectMeta.pastRoundMatchups` — see PastRoundMatchup in lib/sports/golf/adapter.ts. */
interface PastRoundMatchupMeta {
  round: number;
  selfRelative: number | null;
  opponents: Array<GroupMateMeta & { relative: number | null }>;
}

/** 'E' / '-1' / '+2' — golf's own convention for a relative-to-par score, reused for both matchup cards rather than piped through `formatRelative` (adapter.ts-only, not exported). */
function relDisplay(v: number | null): string {
  if (v === null) return '–';
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : String(v);
}

/**
 * Categorical, not continuous: birdie-or-better sits solidly in the green
 * end of the ramp, bogey-or-worse solidly in the red end, par flat at the
 * amber midpoint — a flatter per-stroke scale (the original version) left a
 * single-stroke birdie or bogey reading as barely-tinted amber, which is the
 * one distinction (birdie vs. par vs. bogey) this chart exists to show.
 * Magnitude still nudges within each band, so an eagle reads greener than a
 * birdie without diluting the birdie/par/bogey split itself.
 */
function golfScoreHeat(relativeToPar: number): number {
  if (relativeToPar === 0) return 0.5;
  if (relativeToPar < 0) return Math.min(1, 0.78 + (Math.abs(relativeToPar) - 1) * 0.12);
  return Math.max(0, 0.22 - (relativeToPar - 1) * 0.12);
}

/**
 * A hole/round-score candidate only ever carries the ONE category that's
 * actually consistent (or, failing that, modal) in the golfer's history —
 * adapter.ts's `candidatesForGolfer`/`roundScoreCandidate` pick it for you,
 * same as a Scan row. That's right for Scan (surfacing the one angle worth
 * flagging), but Player Detail is where someone checks a *specific* bet a
 * book is offering — which might not be the one the pattern-scan picked.
 * `GolfCategoryPicker` below lets the viewer swap which of the three
 * category buckets the hero/gradient boxes are read against, independent of
 * `active.category`. Mirrors adapter.ts's CATEGORY_LABEL/ROUND_CATEGORY_LABEL
 * exactly — duplicated locally since neither is exported (same convention as
 * `golfScoreHeat`/`relDisplay` above).
 */
const HOLE_CATEGORY_LABEL: Record<GolfCategory, string> = {
  birdie: 'Birdie or better',
  par: 'Par',
  bogey: 'Bogey or worse',
};
const ROUND_CATEGORY_LABEL: Record<GolfCategory, string> = {
  birdie: 'Under par',
  par: 'Even par',
  bogey: 'Over par',
};
function golfCategoryLabel(dimension: string, category: GolfCategory): string {
  return (dimension === 'round-score' ? ROUND_CATEGORY_LABEL : HOLE_CATEGORY_LABEL)[category];
}

function GolfCategoryPicker({
  dimension,
  value,
  onChange,
}: {
  dimension: string;
  value: GolfCategory;
  onChange: (category: GolfCategory) => void;
}) {
  const labels = dimension === 'round-score' ? ROUND_CATEGORY_LABEL : HOLE_CATEGORY_LABEL;
  return (
    <SegmentedToggle
      options={(['birdie', 'par', 'bogey'] as const).map((key) => ({ key, label: labels[key] }))}
      value={value}
      onChange={onChange}
      className="rounded-xl border border-line p-1 text-[12px]"
      buttonClassName="whitespace-nowrap rounded-lg px-2.5 py-1.5"
      gliderClassName="rounded-lg"
    />
  );
}

function MatchupHoleCell({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <td className="bg-ink/5 px-1.5 py-1 text-center align-middle text-ink-faint" title="Not played yet">
        –
      </td>
    );
  }
  const gradient = gradientCardStyle(golfScoreHeat(value));
  return (
    <td
      className="px-1.5 py-1 text-center align-middle text-[11px] font-bold tabular-nums"
      style={{ backgroundImage: gradient.tableWash, color: gradient.valueColor }}
    >
      {relDisplay(value)}
    </td>
  );
}

/**
 * Hole-by-hole scorecard for the round happening right now — golfer vs. the
 * first golfer sharing their tee time (a 3-ball still gets a clean two-way
 * card, same simplification real 2-ball books make). Nothing beyond the raw
 * score per hole: this isn't match play, just the two cards side by side.
 */
function LiveMatchupCard({
  matchup,
  selfName,
  selfHeadshotUrl,
}: {
  matchup: LiveRoundMatchupMeta;
  selfName: string;
  selfHeadshotUrl?: string;
}) {
  const selfPlayed = matchup.holes.filter((h) => h.self !== null);
  const opponentPlayed = matchup.holes.filter((h) => h.opponent !== null);
  const selfThru = selfPlayed.length;
  const opponentThru = opponentPlayed.length;
  const selfTotal = selfPlayed.reduce((sum, h) => sum + (h.self ?? 0), 0);
  const opponentTotal = opponentPlayed.reduce((sum, h) => sum + (h.opponent ?? 0), 0);

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-[12px] font-semibold text-masters">Round {matchup.round} live matchup</h2>
      </div>
      <div className="p-2.5">
        <div className="mb-2 flex items-center justify-center gap-2 text-[12px]">
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <SubjectAvatar name={selfName} headshotUrl={selfHeadshotUrl} size={20} />
            {selfName}
          </span>
          <span className="text-ink-faint">vs</span>
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <SubjectAvatar name={matchup.opponent.name} headshotUrl={matchup.opponent.headshotUrl} size={20} />
            {matchup.opponent.name}
          </span>
        </div>
        <div className="lb-scroll-x overflow-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-paper px-1.5 py-1 text-left font-semibold text-ink-muted" />
                {matchup.holes.map((h) => (
                  <th key={h.hole} className="px-1.5 py-1 text-center font-semibold text-ink-muted">
                    {h.hole}
                  </th>
                ))}
                <th className="px-1.5 py-1 text-center font-semibold text-ink-muted">Thru</th>
                <th className="px-1.5 py-1 text-center font-semibold text-ink-muted">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="sticky left-0 z-10 max-w-[76px] truncate bg-card px-1.5 py-1 text-left font-semibold text-ink">
                  {selfName}
                </td>
                {matchup.holes.map((h) => (
                  <MatchupHoleCell key={h.hole} value={h.self} />
                ))}
                <td className="px-1.5 py-1 text-center font-semibold tabular-nums">{selfThru}</td>
                <MatchupHoleCell value={selfThru > 0 ? selfTotal : null} />
              </tr>
              <tr>
                <td className="sticky left-0 z-10 max-w-[76px] truncate bg-card px-1.5 py-1 text-left font-semibold text-ink">
                  {matchup.opponent.name}
                </td>
                {matchup.holes.map((h) => (
                  <MatchupHoleCell key={h.hole} value={h.opponent} />
                ))}
                <td className="px-1.5 py-1 text-center font-semibold tabular-nums">{opponentThru}</td>
                <MatchupHoleCell value={opponentThru > 0 ? opponentTotal : null} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/**
 * Every completed round's group result, grouped by round header — pairings
 * reshuffle daily in stroke play, so each round lists whoever this golfer
 * actually played with that day, not necessarily today's group.
 */
function PastRoundMatchupsCard({ active, meta }: { active: PickCandidate; meta: Record<string, unknown> }) {
  const rounds = (meta.pastRoundMatchups as PastRoundMatchupMeta[] | undefined) ?? [];
  const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Past round matchups</h3>
      {rounds.length === 0 ? (
        <p className="p-3 text-[12px] text-ink-faint">No completed rounds with pairing data yet.</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {rounds.map((r) => (
            <div key={r.round} className="p-3">
              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Round {r.round}</div>
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2 rounded-lg bg-accent-soft px-1.5 py-1">
                  <SubjectAvatar name={active.subjectName} headshotUrl={headshotUrl} size={24} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-masters">{active.subjectName}</span>
                  <span className="shrink-0 text-[12px] font-bold tabular-nums">{relDisplay(r.selfRelative)}</span>
                </li>
                {r.opponents.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1">
                    <SubjectAvatar name={o.name} headshotUrl={o.headshotUrl} size={24} />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{o.name}</span>
                    <span className="shrink-0 text-[12px] font-bold tabular-nums">{relDisplay(o.relative)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Golf's Form card — which hole(s) this golfer has scored the same on in
 * every round played so far, i.e. every `hole-N` candidate the adapter
 * already flagged `consistent`. Reads `candidates` (every hole for this
 * golfer), not just `active`, since the pattern worth surfacing might not be
 * on whichever hole tab happens to be open. Requires at least 2 rounds
 * played — a "pattern" from one data point is noise, same floor the rest of
 * the app holds everywhere else (see windowedStat.ts).
 */
function ConsistentHolesForm({ candidates }: { candidates: PickCandidate[] }) {
  const consistentHoles = candidates
    .filter((c) => /^hole-\d+$/.test(c.dimension) && c.consistent && c.sampleSize >= 2)
    .sort((a, b) => b.sampleSize - a.sampleSize || a.dimension.localeCompare(b.dimension, undefined, { numeric: true }));

  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h3 className="flex items-center gap-1.5 bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
        <PulseIcon />
        Form
      </h3>
      <ul className="space-y-2 p-3">
        {consistentHoles.length === 0 ? (
          <li className="text-[12px] text-ink-faint">No hole has the same result in every round yet.</li>
        ) : (
          consistentHoles.slice(0, 5).map((c) => (
            <li key={c.dimension} className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="truncate text-ink-muted">{c.dimensionLabel}</span>
              <span className={`shrink-0 font-semibold tabular-nums ${TONE_CLASS[markFor(c.category).tone]}`}>
                {c.categoryLabel} · {c.sampleSize}/{c.sampleSize}
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Round score box — golf's window-box replacement (R1/R2/R3/R4 + tournament
// average, in place of MLB's L5/L10/L15/H2H/SZN hit-rate boxes, which need a
// game count golf doesn't have).
// ---------------------------------------------------------------------------

function RoundScoreBox({
  label,
  value,
  format = relDisplay,
  hit,
}: {
  label: string;
  value: number | null;
  /** Defaults to the integer-only 'E'/'+N' convention; the tournament-average box passes `relDisplayAvg` since an average is rarely a whole number. */
  format?: (v: number) => string;
  /**
   * When set, this box is graded against a *selected* bet category rather
   * than shown at face value — the tile becomes solid green/red for
   * hit/miss instead of the continuous birdie→bogey ramp `golfScoreHeat`
   * gives a bare score, so "does this round clear the category I'm
   * previewing" reads as one glance, not a color a reader has to place on
   * a ramp themselves. Omitted (undefined) keeps the plain score look —
   * used for the tournament-average box, where hit/miss doesn't apply.
   */
  hit?: boolean | null;
}) {
  if (value === null) {
    return (
      <div className="relative min-w-[76px] flex-1 overflow-hidden rounded-[10px] border border-line bg-card px-1.5 py-2 text-center">
        <div className="text-[14px] font-bold text-ink-faint">–</div>
        <div className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      </div>
    );
  }

  const gradient = gradientCardStyle(hit == null ? golfScoreHeat(value) : hit ? 1 : 0);
  return (
    <div
      className="relative min-w-[76px] flex-1 overflow-hidden rounded-[10px] border border-black/[0.06] bg-card px-1.5 py-2 text-center transition-all duration-150 ease-out hover:-translate-y-0.5"
      style={{ boxShadow: gradient.boxShadow }}
    >
      <div className="pointer-events-none absolute -inset-2" style={{ background: gradient.labelGlow }} />
      <div className="relative text-[14px] font-bold leading-tight" style={{ color: gradient.valueColor }}>
        {format(value)}
      </div>
      <div className="relative mt-px text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
        {hit != null ? <span className="ml-1" style={{ color: gradient.valueColor }}>{hit ? '✓' : '✕'}</span> : null}
      </div>
    </div>
  );
}

/** Average isn't a whole-number relative-to-par token, so it gets its own one-decimal formatting rather than `relDisplay`'s integer-only 'E'/'+N'. */
function relDisplayAvg(v: number): string {
  if (Math.abs(v) < 0.05) return 'E';
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

// ---------------------------------------------------------------------------
// Scorecard chart — golf's Chart-section replacement. One bar per hole for
// whichever round the round selector has picked. A normal single-direction
// bar chart, not a diverging one: every hole gets a visible bar (a par hole
// isn't just a gap), and the bar's color is the whole signal — green for
// birdie-or-better, amber for par, red for bogey-or-worse — rather than
// height doing double duty as both magnitude and (weakly) color.
// ---------------------------------------------------------------------------

function ScorecardChart({
  holes,
  height = 90,
}: {
  holes: Array<{ hole: number; par: number | null; value: number | null; strokes: number | null }>;
  height?: number;
}) {
  if (holes.length === 0) {
    return <p className="p-6 text-center text-sm text-ink-muted">No holes tracked for this golfer.</p>;
  }

  // Height is gross strokes, not deviation from par — a 4-shot birdie on a
  // par 5 and a 4-shot bogey on a par 3 really did take the same number of
  // swings, and should look it; only the color says which one was good.
  // Measuring by |relativeToPar| instead (the original version) drew both a
  // 1-under and a 1-over as identical-height bars regardless of the hole,
  // which is what actually looked unreadable.
  const maxStrokes = Math.max(3, ...holes.map((h) => h.strokes ?? 0));
  const barHeight = (strokes: number | null) => (strokes == null ? 8 : Math.max(14, (strokes / maxStrokes) * height));

  return (
    <div className="lb-scroll-x">
      <div className="flex min-w-full items-end gap-1 px-1" style={{ height: height + 58 }}>
        {holes.map((h) => {
          const v = h.value;
          const gradient = v == null ? null : gradientCardStyle(golfScoreHeat(v));
          return (
            <div key={h.hole} className="flex min-w-[28px] flex-1 flex-col items-center justify-end gap-0.5">
              <span className="text-[11px] font-bold leading-none tabular-nums" style={{ color: gradient?.valueColor }}>
                {h.strokes ?? '–'}
              </span>
              <span className="text-[8px] font-semibold leading-none" style={{ color: gradient?.valueColor }}>
                {v == null ? '' : relDisplay(v)}
              </span>
              <span
                className="mt-0.5 w-full max-w-[22px] origin-bottom rounded-t-[3px] transition-[height,transform,filter] duration-300 ease-out hover:scale-110 hover:brightness-110"
                style={{ height: barHeight(h.strokes), background: v == null ? 'rgb(147 162 154 / 0.35)' : gradient?.fillBackground }}
                title={h.strokes != null ? `${h.strokes} shot${h.strokes === 1 ? '' : 's'}${v != null ? ` (${relDisplay(v)})` : ''}` : 'Not played yet'}
              />
              <span className="mt-0.5 text-[9px] font-semibold text-ink-faint">{h.hole}</span>
              <span className="text-[10px] font-bold text-ink-muted">{h.par != null ? `Par ${h.par}` : '–'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The detail view
// ---------------------------------------------------------------------------

export interface PlayerDetailProps {
  /** Every candidate for this player, across markets. */
  candidates: PickCandidate[];
  snapshot: SportSnapshot | null;
  odds: UnifiedLinesResult | null;
  /** Market key to open on. Falls back to the first available. */
  market?: string;
  onMarketChange?: (market: string) => void;
  onAdd?: (candidate: PickCandidate, odds?: { americanOdds: string; source: string; bookmaker?: string }) => void;
  addedKeys?: Set<string>;
  /** Hides the header block when the host already shows one. */
  embedded?: boolean;
  /** Golf only — season/advanced stats, rendered inside the main column below
      everything else so it sits beside the context rail instead of spanning
      full-width underneath it. Omitted entirely for MLB. */
  golfStats?: {
    strokesGained: GolferStrokesGained | null;
    seasonLog: PlayerSeasonLog | null;
    advancedStats: AdvancedStat[];
    loading: boolean;
  };
  /**
   * Reuse a parent's already-fetched `usePropOdds`/`useMarketCalibration`
   * results instead of this component fetching its own copy of the exact
   * same game's data — set by `GameDetail` when it mounts this component
   * nested (for a selected player within a game already on screen), which
   * has already called both hooks with the same gameId/refreshKey for its
   * own use (LeftRail, PicksPanel). Omitted by every other caller (the
   * standalone player page, PlayerDetailPanel), which fall back to fetching
   * their own as before.
   */
  sharedPropOdds?: ReturnType<typeof usePropOdds>;
  sharedCalibration?: MarketCalibrationState;
}

export function PlayerDetail({
  candidates,
  snapshot,
  odds,
  market,
  onMarketChange,
  onAdd,
  addedKeys,
  embedded = false,
  golfStats,
  sharedPropOdds,
  sharedCalibration,
}: PlayerDetailProps) {
  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];

  // Golf only: which of the 3 bet categories (birdie-or-better/par/bogey-or-
  // worse) the hero + gradient boxes are graded against. Defaults to
  // `active.category` — the one angle adapter.ts's pattern-scan actually
  // found consistent — but the picker below lets the viewer check a
  // different one, since a book offers all 3 for every hole and the pattern
  // isn't always the bet someone's actually looking at. Resets on hole
  // change, not on every candidates refresh, so a manual pick survives a
  // snapshot poll but not a market switch.
  const [selectedGolfCategory, setSelectedGolfCategory] = useState<GolfCategory | null>(null);
  useEffect(() => {
    setSelectedGolfCategory(null);
  }, [active?.dimension]);
  const effectiveGolfCategory: GolfCategory = selectedGolfCategory ?? ((active?.category as GolfCategory) ?? 'par');
  const previewingOtherGolfCategory = active?.sport === 'golf' && effectiveGolfCategory !== active.category;

  // Line adjustment is an offset so switching markets doesn't carry a
  // threshold from one stat onto another where it would mean nothing.
  const [lineOffset, setLineOffset] = useState(0);
  const [opponentOnly, setOpponentOnly] = useState(false);
  const [venue, setVenue] = useState<'all' | 'home' | 'away'>('all');
  const [lastN, setLastN] = useState<number | 'all'>('all');
  const [showAllGames, setShowAllGames] = useState(false);
  const [gamelogView, setGamelogView] = useState<'cards' | 'table'>('cards');
  const [kpiScope, setKpiScope] = useState<'season' | 'l15'>('season');
  const [showAllAtBats, setShowAllAtBats] = useState(false);

  // /api/mlb only sends full box-score detail for each candidate's most
  // recent ~20 games (see historyTrim.ts) — older entries still carry
  // opponentId/isHome (so H2H/venue stats above are always correct for the
  // full season) but not the runs/hits/etc. the gamelog table shows. Only
  // fetch the rest when someone actually asks to see it.
  const [fullHistoryCache, setFullHistoryCache] = useState<Record<string, HistoryEntry[]>>({});
  useEffect(() => {
    if (!showAllGames || !active || active.sport !== 'mlb') return;
    const key = `${active.subjectId}:${active.dimension}`;
    if (fullHistoryCache[key]) return;
    let cancelled = false;
    fetch(`/api/mlb/player-gamelog?subjectId=${encodeURIComponent(active.subjectId)}&dimension=${encodeURIComponent(active.dimension)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { history?: HistoryEntry[] } | null) => {
        if (!cancelled && data?.history) setFullHistoryCache((prev) => ({ ...prev, [key]: data.history! }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showAllGames, active, fullHistoryCache]);
  const activeHistory = active ? (fullHistoryCache[`${active.subjectId}:${active.dimension}`] ?? active.history) : [];

  const meta = (active?.subjectMeta ?? {}) as Record<string, unknown>;
  const teamAbbr = typeof meta.team === 'string' ? meta.team : undefined;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  const opponentId = typeof meta.opponentId === 'number' ? meta.opponentId : undefined;
  const isHome = meta.isHome === true;

  const baseLine = active?.line ?? 0.5;
  const line = Math.max(0.5, baseLine + lineOffset);
  // The pattern names the side; the stepper only moves the threshold.
  const wantOver = directionMark(active?.category ?? '') !== 'U';

  const games: SlateGame[] = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as SlateGame[],
    [snapshot],
  );
  const statKeys = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.statKeys ?? []) as StatKeyDef[],
    [snapshot],
  );

  const slate = useMemo(() => buildSlate(games as SlateEntry['game'][], odds?.lines ?? []), [games, odds]);
  const todaysGame = teamAbbr ? slate.byAbbrev.get(teamAbbr.toUpperCase()) : undefined;
  const live = todaysGame ? liveFor(todaysGame) : {};
  // `live.liveScore` comes from the odds/OddsHarvester scraper and is only
  // populated when that live-score feed happens to be enabled — it's a real
  // "degraded state" per the odds design doc, not a reliable "is this game
  // live" signal. The MLB Stats API's own game state (already surfaced as
  // `todaysGame.game.state`, e.g. "In Progress") is the one that's always
  // present whenever a game genuinely is live, so that's what gates polling.
  const gameIsInProgress = /in progress/i.test(todaysGame?.game?.state ?? '');
  // Called above the `!active` early return (rules of hooks) — `active` is
  // safe to read optionally here since it's assigned above, just possibly
  // undefined until the guard below.
  const playerLive = useLiveGame(
    typeof meta.gamePk === 'number' ? meta.gamePk : undefined,
    gameIsInProgress,
    15_000,
    active?.subjectId,
  );

  // pitchHand is only ever set on pitcher-role candidates (adapter.ts) — the
  // one reliable "is this subject a pitcher" signal already in subjectMeta.
  const isPitcherSubject = typeof meta.pitchHand === 'string';
  // A pitcher has no single opposing pitcher to compare against — only fetch
  // the opposing team's hitting rollup when actually needed.
  const opponentTeamStatcast = useTeamStatcast(isPitcherSubject ? opponentId : undefined);

  /**
   * The games in scope, then those games re-read against the current line.
   *
   * Filters apply first so every number below — windows, chart, gamelog — is
   * describing the same set of games. Applying them at different points is how
   * a chart and its summary end up disagreeing.
   */
  const scoped = useMemo(() => {
    if (!active) return [];
    let list = activeHistory;

    if (opponentOnly && opponentId != null) {
      list = list.filter((e) => (rawOf(e).opponentId as number | undefined) === opponentId);
    }
    if (venue !== 'all') {
      list = list.filter((e) => rawOf(e).isHome === (venue === 'home'));
    }
    if (lastN !== 'all') list = list.slice(-lastN);

    return list;
  }, [active, activeHistory, opponentOnly, opponentId, venue, lastN]);

  const measured = useMemo(() => categoriseByLine(scoped, line), [scoped, line]);
  const wanted = wantOver ? OVER : UNDER;

  const windows = useMemo(
    () => ({
      l5: fixedWindow(measured, wanted, 5),
      l10: fixedWindow(measured, wanted, 10),
      l15: fixedWindow(measured, wanted, 15),
      szn: openWindow(measured, wanted, { minimum: 1 }),
      h2h:
        opponentId == null
          ? ({ status: 'insufficient', available: 0, required: 1 } as WindowedStat)
          : subsetWindow(
              categoriseByLine(activeHistory, line),
              wanted,
              (e) => (rawOf(e).opponentId as number | undefined) === opponentId,
              { minimum: 1 },
            ),
    }),
    [measured, wanted, opponentId, activeHistory, line],
  );

  // Golf's round selector — replaces venue/lastN for this sport. Rounds come
  // from the active hole's own history rather than a fixed 1-4, so a
  // 2-round-old tournament doesn't show two dead R3/R4 chips.
  const golfRounds = useMemo(
    () => Array.from(new Set(activeHistory.map((h) => h.period))).sort((a, b) => a - b),
    [activeHistory],
  );
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  // Defaults to the most recent round — "usually the live one" — but a
  // manual pick sticks until the golfer/hole changes (handled by the market
  // tab's own onClick resetting lineOffset already; round follows suit there).
  const effectiveRound = selectedRound ?? golfRounds[golfRounds.length - 1] ?? 1;

  // Every hole this golfer has a candidate for, scored at `effectiveRound` —
  // the scorecard chart's data. Reads `candidates` (every market for this
  // golfer), not just `active`, since a single hole's own history only ever
  // covers that one hole.
  const scorecardHoles = useMemo(() => {
    if (active.sport !== 'golf') return [];
    return candidates
      .filter((c) => /^hole-\d+$/.test(c.dimension))
      .map((c) => {
        const parMatch = /Par (\d+)/.exec(c.dimensionLabel);
        const par = parMatch ? Number(parMatch[1]) : null;
        const entry = c.history.find((h) => h.period === effectiveRound);
        const value = entry ? entryValue(entry) : null;
        // adapter.ts stashes the raw stroke count alongside relativeToPar —
        // that's the chart's bar height (see ScorecardChart's own comment for
        // why: relativeToPar alone can't tell a 4-shot birdie on a par 5 from
        // a 4-shot bogey on a par 3 apart, and those are very different holes
        // even though both read "the same size" on a deviation-only scale).
        // Falls back to par + relativeToPar on the rare entry ESPN sent a
        // relative score for but no raw stroke count.
        const raw = (entry?.raw ?? null) as { strokes?: number | null } | null;
        const strokes = raw?.strokes ?? (value != null && par != null ? par + value : null);
        return {
          hole: Number(c.dimension.slice('hole-'.length)),
          par,
          value,
          strokes,
        };
      })
      .sort((a, b) => a.hole - b.hole);
  }, [active.sport, candidates, effectiveRound]);

  const gamePk = typeof meta.gamePk === 'number' ? String(meta.gamePk) : undefined;
  // Hooks always run (rules of hooks) — `enabled: false` just skips the
  // fetch inside them when a parent already supplied the same data (see
  // `sharedPropOdds`/`sharedCalibration` on this component's props).
  const propOddsFetched = usePropOdds(gamePk, snapshot?.fetchedAt, !sharedPropOdds);
  const propOdds = sharedPropOdds ?? propOddsFetched;
  const activeMarketKey = active ? candidateDimensionToMarketKey(active.dimension) : null;
  const calibrationFetched = useMarketCalibration(!sharedCalibration);
  const calibration = sharedCalibration ?? calibrationFetched;

  if (!active) {
    return <div className="lb-card p-8 text-center text-sm text-ink-muted">No tracked markets for this player.</div>;
  }

  // Prop Score v1 — this player-page prop never had its own edge/score
  // resolution before (only the game-level moneyline/total edge below did);
  // same resolution ScanTable/ScanCard already use. Also reused for
  // "Add to slip" below — the resolved price is only valid for `active`'s
  // own base line, so it's only attached when `lineOffset === 0` (same gate
  // the OddsChip display beside it already uses).
  const activeTrustTier = calibration.trustTiers.get(active.dimension) ?? null;
  const activeEdgeInfo = resolveCandidateEdge(active, propOdds.rows, propOdds.userSportsbook);
  const activePropScore = activeTrustTier === 'excluded' ? null : computePropScore(active, activeEdgeInfo);
  const addOdds =
    lineOffset === 0 && activeEdgeInfo.price != null
      ? { americanOdds: String(activeEdgeInfo.price), source: activeEdgeInfo.priceSource ?? 'odds-api', bookmaker: activeEdgeInfo.bookmaker }
      : undefined;

  const columns = usedColumns(scoped);
  // Newest first, capped at 15 unless expanded — the same slice the card and
  // table views both render, so toggling between them never reorders games.
  const gamelogRows = [...scoped].reverse().slice(0, showAllGames ? undefined : 15);
  // Headline stats for the summary strip — either the full scoped set (season)
  // or just its most recent 15 games, per the kpiScope toggle.
  const kpiSource = kpiScope === 'l15' ? scoped.slice(-15) : scoped;
  const summaryStats = isPitcherSubject
    ? [
        { label: 'Strikeouts', display: String(fieldSum(kpiSource, 'strikeOuts')) },
        { label: 'Walks', display: String(fieldSum(kpiSource, 'baseOnBalls')) },
        { label: 'Hits allowed', display: String(fieldSum(kpiSource, 'hits')) },
        { label: 'Earned runs', display: String(fieldSum(kpiSource, 'earnedRuns')) },
      ]
    : [
        {
          label: 'Batting avg',
          display: formatAvg(fieldSum(kpiSource, 'atBats') > 0 ? fieldSum(kpiSource, 'hits') / fieldSum(kpiSource, 'atBats') : 0),
        },
        { label: 'Strikeouts', display: String(fieldSum(kpiSource, 'strikeOuts')) },
        { label: 'Walks', display: String(fieldSum(kpiSource, 'baseOnBalls')) },
        { label: 'Stolen bases', display: String(fieldSum(kpiSource, 'stolenBases')) },
      ];
  const projected = todaysGame?.line ? projectLine(todaysGame.line) : null;
  const gameStatus = todaysGame?.game?.state;

  // G6 — same edge math as Game Detail's picks panel, for whichever side is
  // this player's team.
  const gameModel = todaysGame?.game?.gameModel ?? null;
  const moneylineEdge = computeMoneylineEdge(gameModel, projected?.moneyline);
  const totalEdge = computeTotalEdge(gameModel, projected?.total);
  const rankLabel = ownStatcastRankPrefix(meta.ownStatcastSummary as OwnStatcastSummary | undefined).trim();

  return (
    <div className="space-y-3">
      {!embedded ? (
        <section
          className="lb-card-hero overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${withAlpha(teamPrimaryColor(typeof meta.teamId === 'number' ? meta.teamId : undefined), '26')} 0%, #ffffff 62%)`,
            borderTop: '3px solid #141619',
          }}
        >
          <div className="flex flex-wrap items-center gap-4 px-4 py-4">
            <div className="relative h-[76px] w-[76px] shrink-0">
              <SubjectAvatar
                name={active.subjectName}
                headshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
                fallbackUrl={typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined}
                size={76}
                shape="rounded"
              />
              <span className="absolute -bottom-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-white shadow-sm">
                <TeamLogo logoUrl={typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined} size={18} />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[24px] font-bold leading-tight text-ink">
                {active.subjectName}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
                {typeof meta.position === 'string' ? <span>{meta.position}</span> : null}
                <TeamLogo
                  logoUrl={typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined}
                  abbreviation={teamAbbr}
                  size={14}
                />
                {opponentAbbr ? (
                  <>
                    <span>{isHome ? 'vs' : '@'}</span>
                    <TeamLogo logoUrl={opponentId != null ? mlbLogoUrl(opponentId) : undefined} abbreviation={opponentAbbr} size={14} />
                  </>
                ) : null}
                {todaysGame?.game?.firstPitch ? (
                  <span className="text-ink-faint">
                    {new Date(todaysGame.game.firstPitch).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                ) : null}
                {gameStatus ? <span className="text-ink-faint">· {gameStatus}</span> : null}
              </p>
            </div>

            {rankLabel ? (
              <div className="shrink-0 text-center">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted">Rank</div>
                <div className="mt-0.5 text-[20px] font-bold tabular-nums text-ink">{rankLabel}</div>
              </div>
            ) : null}

            <span className="hidden h-11 w-px shrink-0 bg-masters/20 sm:block" />

            <div className="shrink-0 text-right">
              <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                {marketText(active.sport, active.dimension, 'full')}
              </div>
              {/* Golf's hole/round-score markets are a 3-way pick (birdie-or-better
                  / par / bogey-or-worse), not a numeric threshold — there's no
                  line to show, only which category is currently selected
                  (the picker below the market tabs). */}
              <div className="mt-0.5 text-[16px] font-bold text-ink">
                {active.sport === 'golf' ? golfCategoryLabel(active.dimension, effectiveGolfCategory) : `${wantOver ? 'O' : 'U'} ${line}`}
              </div>
            </div>

            {lineOffset === 0 ? <PropScoreBadge score={activePropScore} trust={null} size="sm" /> : null}
          </div>
        </section>
      ) : null}

      {/* Market tabs — re-scope everything below without a reload. */}
      {candidates.length > 1 ? (
        <div className="lb-scroll-x flex gap-1 border-b border-line">
          {candidates.map((candidate) => {
            const selected = candidate.dimension === active.dimension;
            return (
              <button
                key={`${candidate.dimension}-${candidate.category}`}
                type="button"
                onClick={() => {
                  setLineOffset(0);
                  setShowAllGames(false);
                  onMarketChange?.(candidate.dimension);
                }}
                aria-current={selected ? 'true' : undefined}
                className={`relative whitespace-nowrap px-2.5 pb-1.5 pt-1 text-[12px] transition-colors ${
                  selected
                    ? 'font-semibold text-ink after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-full after:bg-masters'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {marketText(candidate.sport, candidate.dimension, 'full')}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Line stepper + price — one grouped cluster, dividers between logical
          groups. Golf has no numeric line to step through (see the hero
          header above); the 3-way category picker takes the stepper's spot
          instead, since which of the 3 bets you're checking is the actual
          equivalent of moving an O/U line for this sport. */}
      <section className="lb-card flex flex-wrap items-center gap-3 p-2.5">
        {active.sport === 'golf' ? (
          <GolfCategoryPicker dimension={active.dimension} value={effectiveGolfCategory} onChange={setSelectedGolfCategory} />
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLineOffset((v) => v - 1)}
              aria-label="Lower the line"
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-line text-[14px] leading-none text-ink-muted hover:border-masters/40 hover:text-masters"
            >
              −
            </button>
            <span className="min-w-[64px] rounded-lg border border-line px-3 py-1.5 text-center text-[14px] font-bold tabular-nums" aria-live="polite">
              {wantOver ? 'O' : 'U'} {line}
            </span>
            <button
              type="button"
              onClick={() => setLineOffset((v) => v + 1)}
              aria-label="Raise the line"
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-line text-[14px] leading-none text-ink-muted hover:border-masters/40 hover:text-masters"
            >
              +
            </button>
          </div>
        )}

        <span className="h-[26px] w-px shrink-0 bg-line-soft" />

        <div className="flex flex-wrap items-center gap-2">
          {/* A price/Prop Score only exists for the candidate adapter.ts actually
              built (the auto-picked category) — same "not the real line"
              honesty golf borrows from the MLB lineOffset stepper, just keyed
              off the category picker instead of a numeric offset. */}
          {lineOffset === 0 && !previewingOtherGolfCategory && (activeEdgeInfo.price != null || active.odds) ? (
            <OddsChip
              price={activeEdgeInfo.price ?? active.odds!.americanOdds}
              source={activeEdgeInfo.price != null ? activeEdgeInfo.priceSource : active.odds!.source}
              capturedAt={activeEdgeInfo.price != null ? activeEdgeInfo.priceCapturedAt : active.odds!.capturedAt}
              size="md"
            />
          ) : lineOffset !== 0 ? (
            <span className="text-[11px] text-ink-faint">No price recorded at this alternate line.</span>
          ) : previewingOtherGolfCategory ? (
            <span className="text-[11px] text-ink-faint">
              Previewing {golfCategoryLabel(active.dimension, effectiveGolfCategory)} — this golfer&apos;s tracked pattern is {active.categoryLabel}.
            </span>
          ) : onAdd ? (
            <GetOddsButton onClick={() => onAdd(active)} label="Add to slip to record a price" />
          ) : null}

          {lineOffset === 0 && !previewingOtherGolfCategory ? <PropScoreBadge score={activePropScore} trust={activeTrustTier} /> : null}

          {lineOffset !== 0 ? (
            <button
              type="button"
              onClick={() => setLineOffset(0)}
              className="text-[11px] text-masters underline"
            >
              Reset to {baseLine}
            </button>
          ) : previewingOtherGolfCategory ? (
            <button
              type="button"
              onClick={() => setSelectedGolfCategory(null)}
              className="text-[11px] text-masters underline"
            >
              Back to {active.categoryLabel}
            </button>
          ) : null}
        </div>

        {onAdd ? (
          <>
            <span className="hidden h-[26px] w-px shrink-0 bg-line-soft sm:block" />
            <button
              type="button"
              onClick={() => onAdd(active, addOdds)}
              className="lb-btn-primary ml-auto rounded-lg bg-masters px-3 py-1.5 text-[12px] font-semibold text-white"
              title={previewingOtherGolfCategory ? `Adds this golfer's tracked pattern (${active.categoryLabel}), not the ${golfCategoryLabel(active.dimension, effectiveGolfCategory)} preview.` : undefined}
            >
              {addedKeys?.has(`${active.sport}:${active.subjectId}:${active.dimension}:${active.category}`)
                ? 'On slip ✓'
                : previewingOtherGolfCategory
                  ? `Add ${active.categoryLabel} to slip`
                  : 'Add to slip'}
            </button>
          </>
        ) : null}
      </section>

      {/* Scope filters — one set, governing every number below. Golf swaps
          this for the round selector: there's no venue/opponent to split by,
          and "last N games" means nothing against a 4-round tournament — a
          round IS the natural unit, and it drives the scorecard chart below
          rather than the windows (those show every round side by side
          already, see the R1-R4 boxes). */}
      {active.sport === 'golf' ? (
        <div className="lb-scroll-x flex items-center gap-1.5">
          {golfRounds.map((r) => (
            <FilterChip key={r} active={effectiveRound === r} onClick={() => setSelectedRound(r)}>
              Round {r}
            </FilterChip>
          ))}
        </div>
      ) : (
        <div className="lb-scroll-x flex items-center gap-1.5">
          <FilterChip active={venue === 'all'} onClick={() => setVenue('all')}>
            All venues
          </FilterChip>
          <FilterChip active={venue === 'home'} onClick={() => setVenue(venue === 'home' ? 'all' : 'home')}>
            Home
          </FilterChip>
          <FilterChip active={venue === 'away'} onClick={() => setVenue(venue === 'away' ? 'all' : 'away')}>
            Away
          </FilterChip>
          {opponentId != null ? (
            <FilterChip active={opponentOnly} onClick={() => setOpponentOnly((v) => !v)}>
              vs {opponentAbbr}
            </FilterChip>
          ) : null}
          <span className="mx-1 h-4 w-px bg-line" />
          {([5, 10, 15, 'all'] as const).map((n) => (
            <FilterChip key={String(n)} active={lastN === n} onClick={() => setLastN(n)}>
              {n === 'all' ? 'All games' : `Last ${n}`}
            </FilterChip>
          ))}
        </div>
      )}

      {/* Window boxes — golf shows each round's actual score plus the
          tournament average, rather than a hit-rate over a game count it
          rarely has enough of. */}
      {active.sport === 'golf' ? (
        <div className="flex gap-1.5 overflow-x-auto lb-scroll-x">
          {golfRounds.map((r) => {
            const entry = activeHistory.find((h) => h.period === r);
            return (
              <RoundScoreBox
                key={r}
                label={`R${r}`}
                value={entry ? entryValue(entry) : null}
                hit={entry ? entry.category === effectiveGolfCategory : null}
              />
            );
          })}
          <RoundScoreBox
            label="AVG"
            format={relDisplayAvg}
            value={(() => {
              const values = golfRounds.map((r) => entryValue(activeHistory.find((h) => h.period === r)!)).filter((v): v is number => v !== null);
              return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
            })()}
          />
        </div>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto lb-scroll-x">
          <WindowBox label="L5" stat={windows.l5} />
          <WindowBox label="L10" stat={windows.l10} />
          <WindowBox label="L15" stat={windows.l15} />
          <WindowBox label="H2H" stat={windows.h2h} showCount />
          <WindowBox label="SZN" stat={windows.szn} showCount />
        </div>
      )}

      {/* Main content (left) + persistent context rail (right, sticky at lg+) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px] lg:items-start">
        <div className="min-w-0 space-y-3">
          {/* Live stats — sits under the window boxes, above the Contact
              quality matchup card; only ever shown while the game is
              actually in progress and disappears once it isn't. Two
              columns: game context (score, count, bases, who's up/on the
              mound) on the left, and whether each of this player's tracked
              lines has hit yet on the right — the same
              STAT_MARKET_BY_DIMENSION table grading.ts uses to settle
              picks, just run mid-game via liveMarketValues. */}
          {gameIsInProgress && playerLive.loading && !playerLive.data ? (
            <div className="lb-card overflow-hidden">
              <div className="lb-skel h-7 w-full" />
              <div className="p-3">
                <div className="lb-skel h-24 w-full rounded" />
              </div>
            </div>
          ) : null}
          {playerLive.data?.player ? (
            (() => {
              const live = playerLive.data!;
              // `live.currentPitcher` — not derived from inning half, which
              // can point at whoever started the inning rather than whoever
              // is actually on the mound after a mid-inning pitching change.
              const currentPitcher = live.currentPitcher;
              const awayTeamId = todaysGame?.game?.awayTeamId;
              const homeTeamId = todaysGame?.game?.homeTeamId;
              const trackable = candidates.filter(
                (c) => live.liveValues?.[c.dimension] != null && directionMark(c.category) !== null,
              );
              return (
                <section className="lb-card overflow-hidden">
                  <h3 className="flex items-center gap-1.5 bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
                    <span className="inline-block h-1.5 w-1.5 animate-lb-pulse rounded-full bg-good" />
                    Live today
                  </h3>
                  <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[220px_1fr]">
                    {/* Left — game context */}
                    <div className="space-y-2.5">
                      <div className="rounded-lg bg-masters px-3 py-2.5 text-white">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                            {awayTeamId != null ? <TeamLogo logoUrl={mlbLogoUrl(awayTeamId)} size={16} /> : null} {todaysGame?.awayAbbrev}
                          </span>
                          <span className="text-[28px] font-bold leading-none tabular-nums">{live.score.away}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                            {homeTeamId != null ? <TeamLogo logoUrl={mlbLogoUrl(homeTeamId)} size={16} /> : null} {todaysGame?.homeAbbrev}
                          </span>
                          <span className="text-[28px] font-bold leading-none tabular-nums">{live.score.home}</span>
                        </div>
                        <div className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-white/80">
                          {live.inning.half === 'top' ? 'Top' : 'Bot'} {live.inning.ordinal}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2">
                        <div className="space-y-1">
                          <CountDots label="B" filled={live.count.balls} total={3} color="#0f7a4f" />
                          <CountDots label="S" filled={live.count.strikes} total={2} color="#c98a1f" />
                          <CountDots label="O" filled={live.outs} total={2} color="#c23b2c" />
                        </div>
                        <BaseDiamond first={live.bases.first} second={live.bases.second} third={live.bases.third} />
                      </div>

                      {/* Who's up and who's on the mound right now — shown
                          regardless of the subject's own role, since that's
                          useful game context either way. Stacked, not
                          side-by-side: the 220px rail is too narrow to also
                          fit a headshot + name + stat line in half that
                          width without cutting the one thing this card
                          exists to show. */}
                      <div className="space-y-2">
                        {live.batter ? (
                          <div className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[11px]">
                            <SubjectAvatar name={live.batter.name} headshotUrl={mlbHeadshotUrl(live.batter.id)} size={32} />
                            <div className="min-w-0 flex-1">
                              <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">At the plate</div>
                              <div className="truncate font-semibold text-ink">{live.batter.name}</div>
                              <div className="text-ink-faint">{live.batter.todayLine}</div>
                            </div>
                          </div>
                        ) : null}
                        {currentPitcher ? (
                          <div className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[11px]">
                            <SubjectAvatar name={currentPitcher.name} headshotUrl={mlbHeadshotUrl(currentPitcher.id)} size={32} />
                            <div className="min-w-0 flex-1">
                              <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">On the mound</div>
                              <div className="truncate font-semibold text-ink">{currentPitcher.name}</div>
                              <div className="text-ink-faint tabular-nums">
                                {currentPitcher.ip} IP · {currentPitcher.h} H · {currentPitcher.k} K
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {/* The live boxscore stubs a zeroed batting line for every
                          player, DH era or not — key off this subject's own known
                          role (pitchHand only ever set on pitcher candidates) rather
                          than presence, so a pitcher doesn't also show "0-for-0". */}
                      {live.player!.batting && !isPitcherSubject ? (
                        <div className="rounded-lg border border-line p-2.5">
                          <div className="flex items-center gap-2">
                            <SubjectAvatar
                              name={active.subjectName}
                              headshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
                              size={36}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[12px] font-semibold text-ink">{active.subjectName}</div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-ink-muted">
                                <span className="font-semibold text-ink">
                                  {live.player!.batting.hits}-for-{live.player!.batting.atBats}
                                </span>
                                <span>{live.player!.batting.runs} R</span>
                                <span>{live.player!.batting.rbi} RBI</span>
                                <span>{live.player!.batting.walks} BB</span>
                                <span>{live.player!.batting.strikeOuts} K</span>
                                {live.player!.isCurrentBatter ? <span className="font-semibold text-masters">At bat</span> : null}
                              </div>
                            </div>
                          </div>
                          {live.subjectPlays && live.subjectPlays.length > 0 ? (
                            <>
                              <ul className="mt-2 space-y-1 border-t border-line-hair pt-2">
                                {(() => {
                                  const plays = live.subjectPlays!;
                                  const startIndex = showAllAtBats ? 0 : Math.max(0, plays.length - 2);
                                  return plays.slice(startIndex).map((p, j) => {
                                    const i = startIndex + j;
                                    return (
                                      <li key={i} className="flex items-baseline gap-1.5 text-[11px]">
                                        <span className="shrink-0 font-semibold text-ink">AB{i + 1}</span>
                                        <span className="min-w-0 flex-1 text-ink-muted">
                                          {p.event}
                                          {p.description ? ` — ${p.description}` : ''}
                                        </span>
                                        {p.rbi > 0 ? <span className="shrink-0 font-semibold text-masters">{p.rbi} RBI</span> : null}
                                      </li>
                                    );
                                  });
                                })()}
                              </ul>
                              {live.subjectPlays.length > 2 ? (
                                <button
                                  type="button"
                                  onClick={() => setShowAllAtBats((v) => !v)}
                                  className="mt-1.5 text-[10.5px] font-semibold text-masters hover:underline"
                                >
                                  {showAllAtBats ? 'Show fewer' : `Show all ${live.subjectPlays.length} at-bats`}
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] tabular-nums">
                        {live.player!.pitching ? (
                          <>
                            <span className="font-semibold">{live.player!.pitching.inningsPitched} IP</span>
                            <span>{live.player!.pitching.hits} H</span>
                            <span>{live.player!.pitching.runs} R</span>
                            <span>{live.player!.pitching.earnedRuns} ER</span>
                            <span>{live.player!.pitching.walks} BB</span>
                            <span>{live.player!.pitching.strikeOuts} K</span>
                            <span className="text-ink-faint">{live.player!.pitching.pitches} pitches</span>
                            {live.player!.isCurrentPitcher ? <span className="text-[11px] font-semibold text-masters">On the mound</span> : null}
                          </>
                        ) : null}
                      </div>
                    </div>

                    {/* Right — line tracker */}
                    <div className="space-y-1.5">
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Today&apos;s lines</div>
                      {trackable.length === 0 ? (
                        <p className="text-[11px] text-ink-faint">No live-trackable lines for this player&apos;s markets.</p>
                      ) : (
                        trackable.map((c) => (
                          <LineTrackerRow key={`${c.dimension}-${c.category}`} candidate={c} liveValue={live.liveValues?.[c.dimension]} />
                        ))
                      )}
                    </div>
                  </div>
                </section>
              );
            })()
          ) : null}

          {/* Chart — golf gets the 18-hole scorecard for the selected round
              instead of DistributionChart, which measures one hole across
              rounds rather than every hole within one. */}
          {active.sport === 'golf' ? (
            <section className="lb-card lb-card-interactive overflow-hidden">
              <div className="flex items-baseline justify-between gap-2 bg-accent-soft px-3 py-1.5">
                <h2 className="text-[12px] font-semibold text-masters">Round {effectiveRound} scorecard</h2>
                <span className="text-[10px] text-masters/70">green under par, red over</span>
              </div>
              <div className="p-2.5">
                <ScorecardChart holes={scorecardHoles} />
              </div>
            </section>
          ) : (
            <section className="lb-card overflow-hidden">
              <div className="flex items-baseline justify-between gap-2 bg-accent-soft px-3 py-1.5">
                <h2 className="text-[12px] font-semibold text-masters">
                  {scoped.length} game{scoped.length === 1 ? '' : 's'} in scope
                </h2>
                <span className="text-[10px] text-masters/70">
                  green cleared {wantOver ? 'over' : 'under'} {line}
                </span>
              </div>
              <div className="p-2.5">
                <DistributionChart
                  history={scoped}
                  line={line}
                  wantOver={wantOver}
                  refreshKey={`${active.dimension}|${line}|${opponentOnly}|${venue}|${lastN}|${snapshot?.fetchedAt ?? ''}`}
                />
              </div>
            </section>
          )}

          {/* Live matchup — golf only, the middle-column counterpart to the
              Past Round Matchups card on the right rail. Only renders once
              ESPN has posted a tee time for the round in progress/next and
              at least one other golfer shares it. */}
          {active.sport === 'golf' && meta.liveRoundMatchup ? (
            <LiveMatchupCard
              matchup={meta.liveRoundMatchup as LiveRoundMatchupMeta}
              selfName={active.subjectName}
              selfHeadshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
            />
          ) : null}

          {/* Batter vs. opposing starter — season stats + quality-of-contact comparison. */}
          {!isPitcherSubject && Array.isArray(meta.ownStatcast) && meta.ownStatcast.length > 0 && typeof meta.opposingStarter === 'string' ? (
            <BatterPitcherMatchupCard
              subjectName={active.subjectName}
              subjectHeadshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
              subjectTeamAbbr={teamAbbr}
              subjectTeamLogoUrl={typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined}
              subjectStats={[
                ...(meta.ownStatcast as OpposingStarterStat[]),
                ...((meta.ownBattingStats as OpposingStarterStat[] | undefined) ?? []),
              ]}
              opponentName={meta.opposingStarter}
              opponentId={typeof meta.opposingStarterId === 'number' ? meta.opposingStarterId : undefined}
              opponentHand={typeof meta.opposingHand === 'string' ? meta.opposingHand : undefined}
              opponentRoleLabel="Allows"
              opponentTeamAbbr={opponentAbbr}
              opponentTeamLogoUrl={opponentId != null ? mlbLogoUrl(opponentId) : undefined}
              opponentStats={(meta.opposingStarterStats as OpposingStarterStat[] | undefined) ?? []}
            />
          ) : null}

          {/* Pitcher vs. opposing lineup — a starting pitcher faces a whole
              batting order, not one hitter, so the "opponent" side is the
              opposing team's aggregate hitting rollup (useTeamStatcast) —
              same 4 stat keys, same 1=best rank orientation, drop-in
              compatible with the same card. */}
          {isPitcherSubject && Array.isArray(meta.ownPitcherStats) && meta.ownPitcherStats.length > 0 && opponentTeamStatcast.loading ? (
            <div className="lb-card overflow-hidden">
              <div className="lb-skel h-7 w-full" />
              <div className="space-y-2 p-3">
                <div className="lb-skel h-14 w-full rounded-lg" />
                <div className="lb-skel h-24 w-full rounded-lg" />
              </div>
            </div>
          ) : null}
          {isPitcherSubject && Array.isArray(meta.ownPitcherStats) && meta.ownPitcherStats.length > 0 && opponentTeamStatcast.hitting.length > 0 ? (
            <BatterPitcherMatchupCard
              title="Pitcher vs. lineup"
              subjectName={active.subjectName}
              subjectHeadshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
              subjectTeamAbbr={teamAbbr}
              subjectTeamLogoUrl={typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined}
              subjectStats={meta.ownPitcherStats as OpposingStarterStat[]}
              subjectRoleLabel="Allows"
              opponentName={opponentAbbr ? `${opponentAbbr} lineup` : 'Opposing lineup'}
              opponentHeadshotUrl={opponentId != null ? mlbLogoUrl(opponentId) : undefined}
              opponentTeamAbbr={opponentAbbr}
              opponentTeamLogoUrl={opponentId != null ? mlbLogoUrl(opponentId) : undefined}
              opponentStats={[
                ...opponentTeamStatcast.hitting,
                ...teamSeasonStatRows(
                  (isHome ? (todaysGame?.game as GameDetailGame | undefined)?.away : (todaysGame?.game as GameDetailGame | undefined)?.home),
                  statKeys,
                ),
              ]}
              opponentRoleLabel="Produces"
            />
          ) : null}

          {/* All books, at the line as posted (not the stepped alternate) — every
              book's price for the exact market this candidate tracks, Fanatics
              shown first per update-09 § 5. */}
          {activeMarketKey ? (
            <section className="lb-card overflow-hidden">
              <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
                <h2 className="text-[12px] font-semibold text-masters">All books</h2>
                <div className="flex items-center gap-1.5">
                  {propOdds.scan.lastScannedAt ? (
                    <span className="text-[10px] text-ink-faint">
                      scanned{' '}
                      {new Date(propOdds.scan.lastScannedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    disabled={!gamePk || propOdds.scan.loading}
                    onClick={() => void propOdds.runScan()}
                    title="Refresh SharpAPI + Odds-API.io for this player's game right now — free, doesn't wait for the ~3-minute automatic cycle."
                    className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:border-masters/40 hover:text-masters disabled:opacity-40"
                  >
                    {propOdds.scan.loading ? 'Scanning…' : 'Scan'}
                  </button>
                </div>
              </div>
              <div className="p-2.5">
                {propOdds.scan.error ? <p className="mb-1.5 text-[10px] text-warn">{propOdds.scan.error}</p> : null}
                <PropOddsBoard
                  allRows={propOdds.rows}
                  subjectId={active.subjectId}
                  marketKey={activeMarketKey}
                  line={active.line ?? null}
                  userSportsbook={propOdds.userSportsbook}
                />
              </div>
            </section>
          ) : null}

          {/* Gamelog — MLB-only: box-score-shaped columns (batting average,
              strikeouts, walks, stolen bases) don't apply to golf's
              hole-by-hole history, which the Hole tabs above already cover
              on their own terms. Golf gets its own season summary
              (GolfPlayerStatsCard, rendered above this component on the
              golf player page) instead of this section. */}
          {active?.sport === 'mlb' ? (
          <section className="lb-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-accent-soft px-2.5 py-1.5">
              <h2 className="text-[12px] font-semibold text-masters">
                {showAllGames ? `All ${scoped.length} games` : `Last ${Math.min(scoped.length, 15)} games`}
              </h2>
              <div className="flex items-center gap-2">
                {scoped.length > 15 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllGames((v) => !v)}
                    className="text-[11px] font-medium text-masters hover:underline"
                  >
                    {showAllGames ? 'Show last 15' : `Show all ${scoped.length}`}
                  </button>
                ) : null}
                <div className="flex rounded-lg border border-line bg-card p-0.5" role="tablist" aria-label="Gamelog view">
                  {(['cards', 'table'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="tab"
                      aria-selected={gamelogView === v}
                      onClick={() => setGamelogView(v)}
                      className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium capitalize transition-colors ${
                        gamelogView === v ? 'bg-masters text-white' : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {scoped.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-muted">No games match this scope.</p>
            ) : (
              <>
                {/* Summary strip — headline totals, scoped to season or just the last 15 games. */}
                <div className="border-b border-line-soft px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Season stats</h3>
                    <SegmentedToggle
                      value={kpiScope}
                      onChange={setKpiScope}
                      className="rounded-lg border border-line bg-card p-0.5"
                      buttonClassName="rounded-md px-2 py-0.5 text-[10px]"
                      gliderClassName="rounded-md"
                      options={[
                        { key: 'season', label: 'Season' },
                        { key: 'l15', label: 'L15' },
                      ]}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                    {summaryStats.map((stat) => (
                      <div key={stat.label} className="min-w-0">
                        <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{stat.label}</div>
                        <div className="mt-0.5 text-[16px] font-bold leading-none tabular-nums text-ink">{stat.display}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {gamelogView === 'cards' ? (
                  <div className="divide-y divide-line-soft">
                    {gamelogRows.map((entry, index) => (
                      <GamelogCard key={index} entry={entry} columns={columns} />
                    ))}
                  </div>
                ) : (
                  <div className="lb-scroll-x overflow-auto">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr>
                          <th className="sticky left-0 top-0 z-30 border-b border-line bg-paper px-2 py-1 text-left font-semibold text-ink-muted">
                            Game
                          </th>
                          {columns.map((column) => (
                            <th
                              key={column.key}
                              className="sticky top-0 z-20 whitespace-nowrap border-b border-line bg-paper px-2 py-1 text-right font-semibold text-ink-muted"
                            >
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          let lastOpponentId: number | undefined | null = null;
                          return gamelogRows.map((entry, index) => {
                            const raw = rawOf(entry);
                            const entryOpponentId = raw.opponentId as number | undefined;
                            const entryIsHome = raw.isHome === true;
                            // A group header precedes the first row of each run of
                            // same-opponent games — including the very first row,
                            // since `lastOpponentId` starts at a sentinel no real
                            // opponent id (including undefined) can equal.
                            const startsNewGroup = entryOpponentId !== lastOpponentId;
                            lastOpponentId = entryOpponentId;
                            return (
                              <Fragment key={index}>
                                {startsNewGroup ? (
                                  <tr>
                                    <td colSpan={columns.length + 1} className="border-b border-line-soft bg-surface-subtle px-2 py-1.5">
                                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                                        {entryOpponentId != null ? <TeamLogo logoUrl={mlbLogoUrl(entryOpponentId)} size={14} /> : null}
                                        {entryOpponentId != null
                                          ? `${entryIsHome ? 'vs' : '@'} ${teamNameFor(entryOpponentId)}`
                                          : 'Opponent unknown'}
                                      </span>
                                    </td>
                                  </tr>
                                ) : null}
                                <tr className="group border-b border-line/60 transition-colors last:border-0 hover:bg-surface-subtle hover:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]">
                                  {/* Date and opponent travel together as one pinned group. No
                                      transform on hover here — this row has a sticky first
                                      column, and a transformed ancestor can break a sticky
                                      descendant's positioning across browsers. */}
                                  <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1 font-medium transition-colors group-hover:bg-surface-subtle">
                                    {/* periodLabel already carries date + vs/@ + opponent
                                        (adapter.ts) — the group header above says who, so
                                        only the date needs to show here. */}
                                    {entry.periodLabel?.split(' ')[0] ?? `#${entry.period}`}
                                  </td>
                                  {columns.map((column) => {
                                    const value = raw[column.key];
                                    return (
                                      <td key={column.key} className="px-2 py-1 text-right tabular-nums">
                                        {value == null || value === '' ? (
                                          <span className="text-ink-faint">–</span>
                                        ) : (
                                          String(value)
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              </Fragment>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
          ) : null}

          {active.sport === 'golf' && golfStats ? (
            <GolfPlayerStatsCard
              name={active.subjectName}
              headshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
              strokesGained={golfStats.strokesGained}
              seasonLog={golfStats.seasonLog}
              advancedStats={golfStats.advancedStats}
              loading={golfStats.loading}
            />
          ) : null}
        </div>

        {/* Context rail — sticky at lg+, stacks below the main column on mobile. */}
        <div className="space-y-3 lg:sticky lg:top-4">
          <section className="lb-card overflow-hidden">
            <h3 className="flex items-center gap-1.5 bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
              <TicketIcon />
              Today&apos;s line
            </h3>
            <div className="p-3">
              {live.liveScore ? (
                <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-good">
                  <span className="inline-block h-1.5 w-1.5 animate-lb-pulse rounded-full bg-good" />
                  {live.liveScore.away}–{live.liveScore.home} {live.livePeriod ?? ''}
                </p>
              ) : null}
              {projected?.available && projected.moneyline ? (
                <div className="space-y-1.5">
                  <div className="rounded-lg border border-line bg-card p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">Moneyline</span>
                      <BookLogo bookId={projected.moneyline.book} size={13} withLabel />
                    </div>
                    <div className="flex gap-1.5">
                      <OddsChip price={projected.moneyline.away} source={projected.source} side={todaysGame?.awayAbbrev} size="md" className="flex-1 justify-center" />
                      <OddsChip price={projected.moneyline.home} source={projected.source} side={todaysGame?.homeAbbrev} size="md" className="flex-1 justify-center" />
                    </div>
                    {moneylineEdge ? (
                      <div className="mt-1 flex gap-1.5">
                        <EdgeBadge edge={moneylineEdge.away} modelProb={moneylineEdge.awayModelProb} marketProb={moneylineEdge.awayMarketProb} label={todaysGame?.awayAbbrev ?? 'Away'} />
                        <EdgeBadge edge={moneylineEdge.home} modelProb={moneylineEdge.homeModelProb} marketProb={moneylineEdge.homeMarketProb} label={todaysGame?.homeAbbrev ?? 'Home'} />
                      </div>
                    ) : null}
                  </div>
                  {projected.total?.point != null ? (
                    <div className="rounded-lg border border-line bg-card p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">Total {projected.total.point}</span>
                        <BookLogo bookId={projected.total.book} size={13} withLabel />
                      </div>
                      <div className="flex gap-1.5">
                        <OddsChip price={projected.total.overPrice} source={projected.source} side={`O${projected.total.point}`} size="md" className="flex-1 justify-center" />
                        <OddsChip price={projected.total.underPrice} source={projected.source} side={`U${projected.total.point}`} size="md" className="flex-1 justify-center" />
                      </div>
                      {totalEdge ? (
                        <div className="mt-1 flex gap-1.5">
                          <EdgeBadge edge={totalEdge.over} modelProb={totalEdge.overModelProb} marketProb={totalEdge.overMarketProb} label="Over" />
                          <EdgeBadge edge={totalEdge.under} modelProb={totalEdge.underModelProb} marketProb={totalEdge.underMarketProb} label="Under" />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-[12px] text-ink-faint">No game line for this matchup yet.</p>
              )}
            </div>
          </section>

          {active.sport === 'golf' ? (
            <PastRoundMatchupsCard active={active} meta={meta} />
          ) : (
            (() => {
              const matchupBody = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <TeamLogo logoUrl={typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined} abbreviation={teamAbbr} size={20} />
                      <span className="text-[10px] font-semibold text-ink-faint">@</span>
                      <TeamLogo logoUrl={opponentId != null ? mlbLogoUrl(opponentId) : undefined} abbreviation={opponentAbbr} size={20} />
                    </div>
                    {todaysGame?.game?.firstPitch ? (
                      <span className="text-[10px] font-medium text-ink-faint">
                        {new Date(todaysGame.game.firstPitch).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[12px]">
                    {typeof meta.opposingStarter === 'string' ? (
                      <>
                        Facing{' '}
                        <span className="font-semibold">
                          {pitcherRankPrefix(meta.opposingStarterOverallRank as { rank: number | null; poolSize: number } | undefined)}
                          {meta.opposingStarter}
                        </span>
                        {typeof meta.opposingHand === 'string' ? ` (${meta.opposingHand}HP)` : ''}
                      </>
                    ) : (
                      <span className="text-ink-faint">Opposing starter not announced.</span>
                    )}
                  </p>
                  {typeof meta.matchupRank === 'number' ? (
                    <p className="mt-1 text-[11px] text-ink-muted">
                      {opponentAbbr} rank {meta.matchupRank} of 30 in {typeof meta.matchupStatLabel === 'string' ? meta.matchupStatLabel : 'this stat'}.
                    </p>
                  ) : null}
                  {active.context?.weather ? (
                    <p className="mt-1.5 text-[11px] text-ink-faint">
                      {active.context.weather.tempF != null ? `${active.context.weather.tempF}°F · ` : ''}
                      Wind {active.context.weather.windMph} mph {active.context.weather.windDir}
                    </p>
                  ) : null}
                </>
              );
              const header = (
                <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
                  Matchup{opponentId != null ? ' →' : ''}
                </h3>
              );
              return opponentId != null ? (
                <Link
                  href={`/mlb/team/${opponentId}`}
                  className="block overflow-hidden rounded-card border border-line bg-card transition-all duration-150 hover:-translate-y-px hover:shadow-card-hover"
                >
                  {header}
                  <div className="p-3">{matchupBody}</div>
                </Link>
              ) : (
                <section className="lb-card overflow-hidden">
                  {header}
                  <div className="p-3">{matchupBody}</div>
                </section>
              );
            })()
          )}

          {Array.isArray(meta.ownStatcast) && meta.ownStatcast.length > 0 ? (
            <section className="lb-card overflow-hidden">
              <h3 className="bg-accent-soft px-3 py-1.5 text-[9.5px] font-bold uppercase tracking-wide text-masters">Hitter stats</h3>
              <div className="p-3">
                {/* Season averages — same row-bar style as Quality of Contact
                    below, now that these carry a real league-wide rank
                    (ownBattingStats, adapter.ts) instead of being plain
                    unranked tiles. */}
                {Array.isArray(meta.ownBattingStats) && meta.ownBattingStats.length > 0 ? (
                  <div className="mb-3">
                    <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Season averages</div>
                    <div className="space-y-1.5">
                      {(meta.ownBattingStats as OpposingStarterStat[]).map((s) => (
                        <StatRankRow key={s.key} stat={s} />
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">Quality of contact</div>
                {meta.ownStatcastSummary ? (
                  <p className="mb-2 text-[9px] text-ink-faint">
                    {(() => {
                      const s = meta.ownStatcastSummary as OwnStatcastSummary;
                      const parts: string[] = [];
                      if (s.overallRank != null) parts.push(`${ordinal(s.overallRank)} of ${s.poolSize} overall`);
                      if (s.positionRank != null) parts.push(`${ordinal(s.positionRank)} of ${s.positionPoolSize} at ${s.position}`);
                      return parts.join(' · ');
                    })()}
                  </p>
                ) : null}
                <div className="space-y-1.5">
                  {(meta.ownStatcast as OpposingStarterStat[]).map((s) => (
                    <StatRankRow key={s.key} stat={s} />
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {active.sport === 'golf' ? (
            <ConsistentHolesForm candidates={candidates} />
          ) : (
            <section className="lb-card overflow-hidden">
              <h3 className="flex items-center gap-1.5 bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
                <PulseIcon />
                Form
              </h3>
              <ul className="space-y-2 p-3">
                {(active.supportingSplits ?? []).slice(0, 4).map((split) => (
                  <li key={`${split.kind}-${split.label}`}>
                    <div className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="truncate text-ink-muted">{split.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {isOk(split.stat) ? (
                          split.figure ?? `${Math.round(split.stat.rate * 100)}%`
                        ) : (
                          <InsufficientMark available={split.stat.available} required={split.stat.required} />
                        )}
                      </span>
                    </div>
                    {isOk(split.stat) ? (
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-line/40">
                        <div
                          className="h-full rounded-full transition-[width] duration-500 ease-out"
                          style={{ width: `${Math.round(split.stat.rate * 100)}%`, backgroundColor: compareInk(split.stat.rate) }}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
                {(active.supportingSplits ?? []).length === 0 ? (
                  <li className="text-[12px] text-ink-faint">No corroborating splits yet.</li>
                ) : null}
              </ul>
            </section>
          )}

          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Line movement</h3>
            <div className="p-3">
              {/*
                No history is retained anywhere in the odds layer — there are no
                price snapshots to draw a series from. Saying so is the only honest
                option; a fabricated movement table would be worse than none.
              */}
              <p className="text-[12px] text-ink-faint">
                Movement history isn&apos;t tracked. Prices are recorded when you enter or import them, so only the
                current value is known.
              </p>
              {active.odds ? (
                <div className="mt-2 flex items-center gap-2">
                  <OddsChip price={active.odds.americanOdds} source={active.odds.source} capturedAt={active.odds.capturedAt} />
                  <span className="text-[10px] text-ink-faint">
                    recorded {new Date(active.odds.capturedAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? 'border-masters bg-accent-soft text-masters' : 'border-line bg-card text-ink-muted hover:border-masters/30'
      }`}
    >
      {children}
    </button>
  );
}

export default PlayerDetail;
