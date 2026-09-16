'use client';

import { useStickyHeaderHeight } from './useStickyHeaderHeight';
import { useEffect, useMemo, useState } from 'react';
import { Card, Chip, EmptyState, Section, SectionNav, SkeletonLines, StatusPill, Tabs } from './ui';
import { GameStateCard } from './GameStateCard';
import { PlayerOddsSection } from './PlayerOddsSection';
import { playerPriceRows } from '@/lib/odds/props/playerPrices';
import { usePlayerBio, usePlayerHistory } from './usePlayerResearch';
import { GameLogCard, PlayerHero, ResearchSectionBody, SeasonsCard, SourcesCard, SplitsCard, TrendsCard, asOfText } from './PlayerResearchSections';
import { athleteIdOf, historySportFor, type PlayerBio, type PlayerHistory, type PlayerResearchData } from '@/lib/sports/shared/playerResearchShapes';
import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import { entryValue, isOk, type WindowedStat } from '@/lib/core/windowedStat';
import { compareInk, gradientCardStyle, deltaGradientStyle } from '@/lib/ui/heat';
import { markFor, TONE_CLASS } from '@/lib/ui/marks';
import { useLiveGame } from './useLiveGame';
import { useFootballLiveGame } from './useFootballLiveGame';
import { useSoccerLiveGame } from './useSoccerLiveGame';
import { useSoccerUnderstat } from './useSoccerUnderstat';
import { useTennisLiveGame } from './useTennisLiveGame';
import { isNhlGameLive } from '@/lib/sports/nhl/gameStates';
import { useTennisArchive } from './useTennisArchive';
import type { NbaShotsInput } from '@/lib/sports/nba/playerShotShapes';
import type { NhlShotMapInput } from '@/lib/sports/nhl/playerShotMapShapes';
import type { TennisSurfaceInput } from '@/lib/sports/tennis/playerArchiveShapes';
import { tournamentSurface } from '@/lib/sports/tennis/surfaces';
import type { SoccerChancesInput } from '@/lib/sports/soccer/playerUnderstatShapes';
import { useTeamStatcast } from './useTeamStatcast';
import { useMlbStatcast } from './useMlbStatcast';
import type { MlbStatcastInput } from '@/lib/sports/mlb/adapters/playerResearchSections';
import { useNbaShots } from './useNbaShots';
import { useNhlShots } from './useNhlShots';
import { useNbaLiveGame } from './useNbaLiveGame';
import { useNhlLiveGame } from './useNhlLiveGame';
import { useNflTargets } from './useNflTargets';
import { useGolfResearch } from './useGolfResearch';
import type { GolfResearchInput } from '@/lib/sports/golf/playerResearchShapes';
import { nflTargetRole, nflTargetRoleFromKind, type NflTargetsInput } from '@/lib/sports/nfl/targetShapes';
import { footballResearchSpec } from '@/lib/sports/nfl/adapters/playerResearchSpec';
import { useLineHistory } from './useLineHistory';
import { candidateCategoryToSide, candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import { LineMovementCard } from './LineMovementCard';
import { StatRankRow } from './StatRankRow';
import { PlayerRoleMainSections, PlayerRoleRailSections } from './PlayerRoleSections';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import { SubjectAvatar, TeamLogo } from './SubjectAvatar';
import { marketText } from './MarketLabel';
import { InsufficientMark, formatRate } from './StatCells';
import { OddsChip, GetOddsButton, EdgeBadge } from './OddsChip';
import { BookLogo } from './BookLogo';
import { usePropOdds, resolveCandidateEdge } from './usePropOdds';
import { PropOddsBoard } from './PropOddsPanel';
import { SegmentedToggle } from './SegmentedToggle';
import { MatchupExplorerCard } from './MatchupExplorerCard';
import { LiveLineTrackerCard } from './LiveLineTrackerCard';
import { useTeamDefenseAllowed } from './useTeamDefenseAllowed';
import { GolfPlayerStatsCard } from './GolfPlayerStatsCard';
import type { AdvancedStat, GolferStrokesGained } from '@/lib/sports/golf/pgatourStats';
import type { PlayerSeasonLog } from '@/lib/sports/golf/playerSeason';
import type { GolfCategory } from '@/lib/sports/golf/adapter';
import {
  toPlayerDetailData as toMlbPlayerDetailData,
  toPlayerResearchData as toMlbPlayerResearchData,
  type PlayerDetailData,
} from '@/lib/sports/mlb/adapters/playerDetailAdapter';
import { toPlayerDetailData as toGolfPlayerDetailData, toPlayerResearchData as toGolfPlayerResearchData } from '@/lib/sports/golf/adapters/playerDetailAdapter';
import { toPlayerDetailData as toNflPlayerDetailData, toPlayerResearchData as toNflPlayerResearchData } from '@/lib/sports/nfl/adapters/playerDetailAdapter';
import { toPlayerDetailData as toSoccerPlayerDetailData, toPlayerResearchData as toSoccerPlayerResearchData } from '@/lib/sports/soccer/adapters/playerDetailAdapter';
import { toPlayerDetailData as toCfbPlayerDetailData, toPlayerResearchData as toCfbPlayerResearchData } from '@/lib/sports/cfb/adapters/playerDetailAdapter';
import { toPlayerDetailData as toNbaPlayerDetailData, toPlayerResearchData as toNbaPlayerResearchData } from '@/lib/sports/nba/adapters/playerDetailAdapter';
import { toPlayerDetailData as toNhlPlayerDetailData, toPlayerResearchData as toNhlPlayerResearchData } from '@/lib/sports/nhl/adapters/playerDetailAdapter';
import { toPlayerDetailData as toTennisPlayerDetailData, toPlayerResearchData as toTennisPlayerResearchData } from '@/lib/sports/tennis/adapters/playerDetailAdapter';
import { useReadyGate } from './useReadyGate';

/**
 * Everything known about one player's one market — sport-agnostic. Reads a
 * `PlayerDetailData` built by the active candidate's own sport adapter
 * (`lib/sports/{mlb,golf,nfl}/adapters/playerDetailAdapter.ts`); adding a new
 * sport here means writing one more adapter, not another branch in this file.
 *
 * Built as a component rather than a page so Game Detail can swap it into its
 * main pane without a second implementation — the route is a thin wrapper.
 *
 * The line stepper is the piece that makes this more than a report: moving the
 * threshold re-reads the same games and asks a different question of them, so
 * every window, the chart and its baseline recompute together off one number.
 */

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

function mlbLogoUrl(teamId: number): string {
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
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
  /**
   * This stat has no good/bad direction, so it is ranked but NOT coloured
   * (R2). A team that commits many fouls or throws many hits is playing a
   * style, not playing badly — the audit's complaint was fouls and offsides
   * rendering green. The rank still shows: "12th most fouls" is a real fact,
   * it just isn't a verdict.
   */
  neutral?: boolean;
}

export function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

/** "#12 " to lead a pitcher's name with their overall composite rank — empty string (not "#N/A") until the rankings have been computed for the season, so a name just reads plainly instead of showing a placeholder. */
export function pitcherRankPrefix(overallRank: { rank: number | null; poolSize: number } | undefined): string {
  return overallRank?.rank != null ? `#${overallRank.rank} ` : '';
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
              <span className="w-full truncate text-center text-[8px] leading-none text-ink-muted">
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
        <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
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
      <div className="relative mt-px text-[9px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="relative mt-[3px] text-[8px] tabular-nums text-ink-muted/80">{caption}</div>
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
      <td className="bg-ink/5 px-1.5 py-1 text-center align-middle text-ink-muted" title="Not played yet">
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
          <span className="text-ink-muted">vs</span>
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
        <p className="p-3 text-[12px] text-ink-muted">No completed rounds with pairing data yet.</p>
      ) : (
        <div className="divide-y divide-line-soft">
          {rounds.map((r) => (
            <div key={r.round} className="p-3">
              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">Round {r.round}</div>
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
 * already flagged `consistent`. Reads the adapter's precomputed
 * `data.golfFormHoles` rather than re-filtering `candidates` itself.
 */
function ConsistentHolesForm({ holes }: { holes: PickCandidate[] }) {
  return (
    <section className="lb-card lb-card-interactive overflow-hidden">
      <h3 className="flex items-center gap-1.5 bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
        <PulseIcon />
        Form
      </h3>
      <ul className="space-y-2 p-3">
        {holes.length === 0 ? (
          <li className="text-[12px] text-ink-muted">No hole has the same result in every round yet.</li>
        ) : (
          holes.slice(0, 5).map((c) => (
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
        <div className="text-[14px] font-bold text-ink-muted">–</div>
        <div className="mt-1 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
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
      <div className="relative mt-px text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
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
              <span className="mt-0.5 text-[9px] font-semibold text-ink-muted">{h.hole}</span>
              <span className="text-[10px] font-bold text-ink-muted">{h.par != null ? `Par ${h.par}` : '–'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scope chips — one generic row driven entirely by `PlayerDetailData.chips`.
// Each key encodes which filter it represents (`venue:home`, `opponent`,
// `lastN:10`, `round:2`); active-state and the click handler both parse that
// convention here, in the one place scope state actually lives, rather than
// forcing the adapter to also carry an `active` flag per chip.
// ---------------------------------------------------------------------------

function ScopeChips({
  chips,
  isActive,
  onSelect,
}: {
  chips: Array<{ key: string; label: string }>;
  isActive: (key: string) => boolean;
  onSelect: (key: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="lb-scroll-x flex items-center gap-1.5">
      {chips.map((chip) => (
        <FilterChip key={chip.key} active={isActive(chip.key)} onClick={() => onSelect(chip.key)}>
          {chip.label}
        </FilterChip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The detail view
// ---------------------------------------------------------------------------

/**
 * Each sport's research adapter, picked by the page's sport — the same
 * selection `data` makes below for the market adapters, but keyed on the
 * SUBJECT's sport so it works with no candidate at all (R6.1a).
 */
function toResearchData(
  sport: string,
  history: PlayerHistory | null,
  bio: PlayerBio | null,
  extras: {
    golf?: GolfResearchInput;
    mlbStatcast?: MlbStatcastInput;
    nflTargets?: NflTargetsInput;
    soccerChances?: SoccerChancesInput;
    tennisSurface?: TennisSurfaceInput;
    nbaShots?: NbaShotsInput;
    nhlShots?: NhlShotMapInput;
  },
): PlayerResearchData | null {
  // Golf reads its own tables (R6.6); every other sport needs its history.
  if (sport === 'golf') return extras.golf ? toGolfPlayerResearchData({ bio, golf: extras.golf }) : null;
  if (!history) return null;
  const input = { history, bio };
  switch (sport) {
    case 'mlb':
      return toMlbPlayerResearchData({ ...input, statcast: extras.mlbStatcast });
    case 'nfl':
      return toNflPlayerResearchData({ ...input, targets: extras.nflTargets });
    case 'cfb':
      return toCfbPlayerResearchData(input);
    case 'nba':
      return toNbaPlayerResearchData({ ...input, shots: extras.nbaShots });
    case 'nhl':
      return toNhlPlayerResearchData({ ...input, shots: extras.nhlShots });
    case 'soccer':
      return toSoccerPlayerResearchData({ ...input, understat: extras.soccerChances });
    case 'tennis':
      return toTennisPlayerResearchData({ ...input, archive: extras.tennisSurface });
    default:
      return null;
  }
}

/** A team page link where the sport has team pages keyed by the bio's team id. */
function teamHrefFor(sport: string, league: string | null, teamId: string): string | null {
  if (sport === 'soccer') return league ? `/soccer/${league}/team/${encodeURIComponent(teamId)}` : null;
  return ['mlb', 'nfl', 'cfb', 'nba', 'nhl'].includes(sport) ? `/${sport}/team/${encodeURIComponent(teamId)}` : null;
}

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
      full-width underneath it. Omitted entirely for MLB/NFL. */
  golfStats?: {
    strokesGained: GolferStrokesGained | null;
    seasonLog: PlayerSeasonLog | null;
    advancedStats: AdvancedStat[];
    loading: boolean;
  };
  /**
   * Reuse a parent's already-fetched `usePropOdds` result instead of this
   * component fetching its own copy of the exact same game's data — set by
   * `GameDetail` when it mounts this component nested (for a selected player
   * within a game already on screen), which has already called the hook with
   * the same gameId/refreshKey for its own use (LeftRail, PicksPanel). Omitted by every other caller (the
   * standalone player page, PlayerDetailPanel), which fall back to fetching
   * their own as before.
   */
  sharedPropOdds?: ReturnType<typeof usePropOdds>;
  /**
   * Fires whenever this component's OWN data-fetching hooks (live game,
   * opponent team Statcast, prop odds — see the "Hooks
   * that fetch live data stay in the component" block below) settle, not
   * just when the parent's outer snapshot fetch resolves. A host page uses
   * this to hold a full-page loader until the whole page is genuinely ready
   * instead of mounting this component the instant snapshot data exists and
   * letting its sub-sections pop in piecemeal as each hook finishes.
   */
  onReadyChange?: (ready: boolean) => void;
  /**
   * R6.1a — the player the page is about, independent of any market. With it
   * the page renders the player's hero and research sections whether or not a
   * candidate exists; the prop block becomes one section that can be empty.
   * `league` is soccer's league or tennis's tour. Omitted by the embedded
   * game-page host, which shows only the prop block.
   */
  subject?: { sport: string; id: string; league?: string | null; name?: string | null };
  /** The host's slate is still loading: the prop section shows a skeleton rather than claiming no line was posted. */
  marketsLoading?: boolean;
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
  onReadyChange,
  subject,
  marketsLoading = false,
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

  // Line adjustment is an offset so switching markets doesn't carry a
  // threshold from one stat onto another where it would mean nothing.
  const [lineOffset, setLineOffset] = useState(0);
  const [opponentOnly, setOpponentOnly] = useState(false);
  const [venue, setVenue] = useState<'all' | 'home' | 'away'>('all');
  const [lastN, setLastN] = useState<number | 'all'>('all');
  const [selectedRound, setSelectedRound] = useState<number | null>(null);

  // A different subject entirely (not just a market tab within the same
  // player) resets every scope control — mirrors NflPlayerDetail.tsx's own
  // reset effect, generalized so a host that keeps this component mounted
  // across a player-to-player navigation doesn't carry stale scope over.
  useEffect(() => {
    setLineOffset(0);
    setOpponentOnly(false);
    setVenue('all');
    setLastN('all');
    setSelectedRound(null);
  }, [active?.subjectId]);


  const meta = (active?.subjectMeta ?? {}) as Record<string, unknown>;

  // Round number this golfer's scope is currently reading, for highlighting
  // the right "Round N" chip and gating the round-scores' `hit` glyph. Cheap
  // to compute for every sport (an MLB/NFL history's own `period` numbers
  // just go unused); real duplication of the golf adapter's own
  // `effectiveRound`, same small-duplication convention already used
  // elsewhere in this file (`golfScoreHeat`/`relDisplay` etc.).
  const golfRounds = active ? Array.from(new Set(active.history.map((h) => h.period))).sort((a, b) => a - b) : [];
  const effectiveRound = selectedRound ?? golfRounds[golfRounds.length - 1] ?? 1;

  // Hooks that fetch live data stay in the component — an adapter is a pure
  // function, it can't call `useLiveGame`/`useTeamStatcast` itself. `enabled:
  // false` (via the subjectId/opponentId args going undefined) just skips the
  // fetch when the active subject doesn't need it; the hook itself always
  // runs (rules of hooks).
  const gamePk = typeof meta.gamePk === 'number' ? meta.gamePk : undefined;
  const gamePkStr = typeof meta.gamePk === 'number' || typeof meta.gamePk === 'string' ? String(meta.gamePk) : undefined;
  const opponentId = typeof meta.opponentId === 'number' ? meta.opponentId : undefined;
  const isPitcherSubject = typeof meta.pitchHand === 'string';
  // The game's start, from the slate: every sport's snapshot lists its games
  // with `gamePk` and `firstPitch`. Once it has passed, the page's prices are
  // the ones that stood at the start (R6.1d, R2-F6).
  const startIso = (() => {
    const slateGames = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{ gamePk?: unknown; firstPitch?: unknown }>;
    const g = gamePkStr ? slateGames.find((x) => String(x.gamePk) === gamePkStr) : undefined;
    return typeof g?.firstPitch === 'string' && g.firstPitch.includes('T') ? g.firstPitch : null;
  })();
  const started = startIso != null && Date.now() >= Date.parse(startIso);
  // Gates the live poll only; the adapter decides from the slate whether the
  // game is in progress (`data.gameState`). Before the start the route answers
  // 404, so there is nothing to poll for.
  const gameIsInProgressHint = active?.sport === 'mlb' && typeof meta.gamePk === 'number' && started;
  const playerLive = useLiveGame(gamePk, gameIsInProgressHint, 15_000, active?.subjectId);
  // C4 for football (R6.2). ESPN's summary answers for both leagues, so one
  // hook serves NFL and CFB; it idles until the scheduled start has passed.
  const isFootball = active?.sport === 'nfl' || active?.sport === 'cfb';
  const footballLive = useFootballLiveGame(active?.sport === 'cfb' ? 'cfb' : 'nfl', isFootball ? gamePkStr : undefined, isFootball && started, 15_000);
  // Soccer's own live feed: score, clock and key events (decision 5).
  const soccerLeague = typeof meta.league === 'string' ? meta.league : subject?.league ?? undefined;
  const soccerLive = useSoccerLiveGame(soccerLeague, active?.sport === 'soccer' ? gamePkStr : undefined, active?.sport === 'soccer' && started, 25_000);
  // Tennis: set scores are the whole live picture (R4 — no point-by-point source).
  const tennisTour = typeof meta.tour === 'string' ? (meta.tour as 'atp' | 'wta') : subject?.league === 'wta' ? 'wta' : 'atp';
  const tennisLive = useTennisLiveGame(tennisTour, active?.sport === 'tennis' ? gamePkStr : undefined, active?.sport === 'tennis' && started, 25_000);
  const opponentTeamStatcast = useTeamStatcast(isPitcherSubject ? opponentId : undefined);

  // MLB Statcast, from the R5a rollup (R6.1b). One route serves three readers:
  // the player's own season (the "Contact quality" section, and the prop
  // block's usage-mix and strike-zone roles through the row's `profile`
  // block), and tonight's opposing starter (the matchup's pitch mix). The id
  // comes from the page's SUBJECT, so a player with no market still gets his
  // sections; it is left undefined for every other sport and the hooks idle.
  const mlbSubjectNumeric =
    subject?.sport === 'mlb' ? Number(athleteIdOf(subject.id)) : active?.sport === 'mlb' ? Number(active.subjectId) : NaN;
  const mlbPlayerId = Number.isInteger(mlbSubjectNumeric) && mlbSubjectNumeric > 0 ? mlbSubjectNumeric : undefined;
  const statcastNowSeason = new Date().getUTCFullYear();
  // The sport section's season control. `null` opens on the current season.
  const [sportSectionSeason, setSportSectionSeason] = useState<number | null>(null);
  useEffect(() => setSportSectionSeason(null), [mlbPlayerId]);
  const statcastNow = useMlbStatcast(mlbPlayerId, statcastNowSeason);
  const statcastPicked = useMlbStatcast(
    sportSectionSeason != null && sportSectionSeason !== statcastNowSeason ? mlbPlayerId : undefined,
    sportSectionSeason ?? undefined,
  );
  const statcastForSection = sportSectionSeason == null || sportSectionSeason === statcastNowSeason ? statcastNow : statcastPicked;

  // TONIGHT'S OPPOSING STARTER. A pitcher's `pitchTypes[].xwoba` is what he
  // ALLOWS on that pitch, exactly as a batter's is what he HITS on it, so one
  // shape serves both sides of the comparison. Undefined for a pitcher's page
  // and every other sport, so the hook idles (rules of hooks).
  const opposingStarterId = (() => {
    if (isPitcherSubject || active?.sport !== 'mlb') return undefined;
    const raw = (active.subjectMeta as Record<string, unknown> | undefined)?.opposingStarterId;
    return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : undefined;
  })();
  const opposingStatcast = useMlbStatcast(opposingStarterId, statcastNowSeason);

  /** The rollup row's legacy pitch-profile block, in the shape the matchup roles read. */
  const profileOf = (state: ReturnType<typeof useMlbStatcast>, role: 'pitcher' | 'batter', id: number | undefined) => {
    const row = role === 'pitcher' ? state.data?.pitching : state.data?.batting;
    const block = row?.payload.profile;
    return { profile: block && id != null ? { ...block, season: row!.season, role, subjectId: id } : null, loading: state.loading };
  };
  const pitchProfile = profileOf(statcastNow, isPitcherSubject ? 'pitcher' : 'batter', mlbPlayerId);
  const opposingPitchProfile = profileOf(opposingStatcast, 'pitcher', opposingStarterId);

  // NHL's shot map (6.7). `nhl_shot_events.shooter_id` stores the bare NHL
  // C4 for both (R6.5). Live hooks run unconditionally and idle for the other
  // sports, as every other sport's already do.
  const nbaLive = useNbaLiveGame(active?.sport === 'nba' ? gamePkStr : undefined, active?.sport === 'nba' && started, 25_000);
  const nhlLive = useNhlLiveGame(active?.sport === 'nhl' ? gamePkStr : undefined, active?.sport === 'nhl' && started, 25_000);

  // Universal matchup card's league-wide defense-allowed leaderboards — one
  // fetch per sport, shared across every subject on the page (see
  // docs/matchup-card-rebuild-gameplan-2026-08-23.md §4.2/§8). `enabled`
  // gates the fetch, not the hook call itself (rules of hooks).
  const cfbTeamDefense = useTeamDefenseAllowed<import('@/lib/sports/cfb/teamDefenseAllowed').CfbTeamDefenseAllowed>('/api/cfb/team-defense-allowed', active?.sport === 'cfb');
  const nbaTeamDefense = useTeamDefenseAllowed<import('@/lib/sports/nba/teamDefenseAllowed').NbaTeamDefenseAllowed>('/api/nba/team-defense-allowed', active?.sport === 'nba');
  const nhlTeamDefense = useTeamDefenseAllowed<import('@/lib/sports/nhl/teamDefenseAllowed').NhlTeamDefenseAllowed>('/api/nhl/team-defense-allowed', active?.sport === 'nhl');

  const propOddsFetched = usePropOdds(gamePkStr, snapshot?.fetchedAt, !sharedPropOdds, startIso);
  const propOdds = sharedPropOdds ?? propOddsFetched;
  // Market calibration is no longer fetched here (R6.1d): its only reader, a
  // trust-tier value, had not been rendered since the page's R3 rebuild, and
  // a cold `/api/props/calibration` takes 60+ seconds.

  // R6.1a — the player, independent of any market. The embedded game-page host
  // passes no subject and keeps the prop block alone; every other host gets the
  // hero and the research sections, which load on their own and never gate the
  // page's loader (each renders its own skeleton).
  const researchSport = subject?.sport ?? null;
  const researchLeague = subject?.league ?? null;
  const researchAthleteId = subject ? athleteIdOf(subject.id) : null;
  const historySport = researchSport ? historySportFor(researchSport, researchLeague) : null;
  const bioState = usePlayerBio(researchSport === 'golf' ? 'golf' : historySport, researchAthleteId);
  const historyState = usePlayerHistory(historySport, researchAthleteId);
  // NFL's located passes (R6.2) — the page's own subject and the role his
  // position implies, so a player with no market still gets his section. The
  // route resolves the nflverse id; idle for every other sport.
  // Understat's shots and matches for an EPL player (R6.3), by his own name —
  // Understat publishes no id this app can join on, and covers no MLS.
  const understatName = historySport === 'soccer_epl' ? bioState.data?.name ?? subject?.name ?? undefined : undefined;
  const soccerUnderstat = useSoccerUnderstat(understatName);
  const soccerChances = useMemo<SoccerChancesInput | undefined>(
    () =>
      historySport !== 'soccer_epl' && historySport !== 'soccer_mls'
        ? undefined
        : historySport === 'soccer_mls'
          ? {
              // MLS is fetched from American Soccer Analysis, which carries no
              // shot coordinates at all, so the section says so rather than
              // being absent (the same rule CFB's efficiency card follows).
              season: null,
              data: null,
              loading: false,
              error: null,
              emptyReason: 'Understat covers the big five European leagues, not MLS; the app reads MLS from American Soccer Analysis, which publishes no shot locations.',
            }
          : {
            season: sportSectionSeason,
            data: soccerUnderstat.data,
            loading: soccerUnderstat.loading || (bioState.loading && !bioState.data),
            error: soccerUnderstat.error,
            emptyReason: 'Understat covers the big five leagues and this app fetches it per player by name; it holds no shots under this name.',
          },
    [historySport, sportSectionSeason, soccerUnderstat, bioState.loading, bioState.data],
  );
  // The TennisMyLife archive for this player (R6.4): surface, serve and rank,
  // none of which `player_game_history` stores for tennis.
  const tennisHistoryTour = historySport === 'tennis_wta' ? 'wta' : historySport === 'tennis_atp' ? 'atp' : undefined;
  // Golf's rounds, holes and shot seed (R6.6). Golf has no per-game history,
  // so this is its research source. The rounds key on the page's ESPN id; the
  // shots on the name, which waits for the bio (the seed keys on PGA's id).
  const golfResearch = useGolfResearch(
    researchSport === 'golf' ? researchAthleteId ?? undefined : undefined,
    researchSport === 'golf' ? bioState.data?.name ?? undefined : undefined,
  );
  const golfInput = useMemo<GolfResearchInput | undefined>(
    () =>
      researchSport !== 'golf'
        ? undefined
        : { data: golfResearch.data, loading: golfResearch.loading || (bioState.loading && !bioState.data), error: golfResearch.error },
    [researchSport, golfResearch, bioState.loading, bioState.data],
  );
  const tennisArchive = useTennisArchive(tennisHistoryTour, tennisHistoryTour ? bioState.data?.name ?? subject?.name ?? undefined : undefined);

  // NBA's and NHL's shot sections (R6.5): every located attempt, not the 3x3
  // grid that stood in for them (deleted with their routes and hooks). Both key
  // on the athlete id the page already has -- `shooter_id` for a shooter, and
  // `goalie_id` when that id finds no shots of its own.
  const nbaShots = useNbaShots(historySport === 'nba' ? researchAthleteId ?? undefined : undefined);
  const nhlShots = useNhlShots(historySport === 'nhl' ? researchAthleteId ?? undefined : undefined);
  const tennisSurface = useMemo<TennisSurfaceInput | undefined>(
    () =>
      !tennisHistoryTour
        ? undefined
        : {
            season: sportSectionSeason,
            data: tennisArchive.data,
            loading: tennisArchive.loading || (bioState.loading && !bioState.data),
            error: tennisArchive.error,
            // C7: the court today's match is on, from the event's own name.
            todaySurface: typeof meta.tournamentName === 'string' ? tournamentSurface(meta.tournamentName) : null,
            emptyReason: 'The TennisMyLife archive is keyed by name and holds no matches under this one.',
          },
    [tennisHistoryTour, sportSectionSeason, tennisArchive, bioState.loading, bioState.data, meta.tournamentName],
  );
  const nbaShotsInput = useMemo<NbaShotsInput | undefined>(
    () =>
      historySport !== 'nba'
        ? undefined
        : {
            season: sportSectionSeason,
            data: nbaShots.data,
            loading: nbaShots.loading,
            error: nbaShots.error,
            emptyReason: 'The shot feed holds no attempts for this player.',
          },
    [historySport, sportSectionSeason, nbaShots],
  );
  const nhlShotsInput = useMemo<NhlShotMapInput | undefined>(
    () =>
      historySport !== 'nhl'
        ? undefined
        : {
            season: sportSectionSeason,
            data: nhlShots.data,
            loading: nhlShots.loading,
            error: nhlShots.error,
            emptyReason: 'The shot feed holds no attempts for this player.',
          },
    [historySport, sportSectionSeason, nhlShots],
  );
  const nflRole =
    researchSport !== 'nfl'
      ? null
      : (nflTargetRole(bioState.data?.positionAbbr) ??
        (historyState.data ? nflTargetRoleFromKind(footballResearchSpec('nfl', bioState.data, historyState.data.games).kind) : null));
  const nflTargets = useNflTargets(researchSport === 'nfl' && nflRole ? researchAthleteId ?? undefined : undefined, nflRole ?? undefined);
  const nflTargetsInput = useMemo<NflTargetsInput | undefined>(
    () =>
      researchSport !== 'nfl' || !nflRole
        ? undefined
        : {
            season: sportSectionSeason,
            data: nflTargets.data,
            loading: nflTargets.loading || (bioState.loading && !bioState.data),
            error: nflTargets.error,
            emptyReason: 'The play-by-play the app stores holds 2024 onwards; this player has no located pass in it.',
          },
    [researchSport, nflRole, sportSectionSeason, nflTargets, bioState.loading, bioState.data],
  );
  // The Statcast rollup holds 2025 on; offer the seasons this player has games in.
  const mlbStatcastInput = useMemo<MlbStatcastInput | undefined>(() => {
    if (researchSport !== 'mlb') return undefined;
    const held = new Set((historyState.data?.games ?? []).map((g) => g.season));
    const seasons = Array.from({ length: statcastNowSeason - 2024 }, (_, i) => statcastNowSeason - i).filter((y) => held.size === 0 || held.has(y));
    return {
      season: sportSectionSeason ?? statcastNowSeason,
      seasons: seasons.length ? seasons : [statcastNowSeason],
      batting: statcastForSection.data?.batting ?? null,
      pitching: statcastForSection.data?.pitching ?? null,
      loading: statcastForSection.loading || (!statcastForSection.settled && mlbPlayerId != null),
      error: statcastForSection.error,
    };
  }, [researchSport, historyState.data, statcastNowSeason, sportSectionSeason, statcastForSection, mlbPlayerId]);
  const research = useMemo(
    () =>
      researchSport && (historyState.data || golfInput)
        ? toResearchData(researchSport, historyState.data, bioState.data, {
            golf: golfInput,
            mlbStatcast: mlbStatcastInput,
            nflTargets: nflTargetsInput,
            soccerChances,
            tennisSurface,
            nbaShots: nbaShotsInput,
            nhlShots: nhlShotsInput,
          })
        : null,
    [researchSport, historyState.data, bioState.data, golfInput, mlbStatcastInput, nflTargetsInput, soccerChances, tennisSurface, nbaShotsInput, nhlShotsInput],
  );
  const stickyTop = useStickyHeaderHeight(Boolean(subject) && !embedded);
  const sectionIds = (research?.sections ?? []).map((x) => `${x.id}:${x.navLabel}`).join('|');
  const sectionNav = useMemo(() => (sectionIds ? sectionIds.split('|').map((x) => ({ id: x.split(':')[0], label: x.split(':')[1] })) : []), [sectionIds]);
  // Whether the live section exists at all, for the nav — the card itself comes
  // from the adapter below. A successful live poll is the proof (the routes 404
  // unless a game is live), which is what the MLB adapter checks too.
  const liveNow = Boolean(
    (playerLive.data && !playerLive.error) ||
      (footballLive.data && footballLive.data.state === 'in') ||
      (soccerLive.data && soccerLive.data.state === 'in') ||
      (tennisLive.data && tennisLive.data.state === 'in') ||
      (nbaLive.data && nbaLive.data.state === 'in') ||
      (nhlLive.data && isNhlGameLive(nhlLive.data.gameState)),
  );
  const navItems = useMemo(
    () => [
      ...(liveNow ? [{ id: 'live', label: 'Live' }] : []),
      { id: 'props', label: 'Prop analysis' },
      ...(historySport
        ? [
            { id: 'seasons', label: 'Seasons' },
            { id: 'trends', label: 'Trends' },
            { id: 'splits', label: 'Splits' },
          ]
        : []),
      ...sectionNav,
      ...(historySport ? [{ id: 'log', label: 'Game log' }] : []),
      { id: 'odds', label: 'Odds' },
      { id: 'sources', label: 'Sources' },
    ],
    [historySport, sectionNav, liveNow],
  );

  const data: PlayerDetailData | null = !active
    ? null
    : active.sport === 'golf'
      ? toGolfPlayerDetailData({
          candidates,
          market: active.dimension,
          snapshot,
          scope: { selectedRound, selectedCategory: selectedGolfCategory },
          propOdds: { rows: propOdds.rows, userSportsbook: propOdds.userSportsbook },
          golfStats,
        })
      : active.sport === 'nfl'
        ? toNflPlayerDetailData({
            candidates,
            market: active.dimension,
            snapshot,
            scope: { lineOffset, opponentOnly, lastN },
            propOdds: { rows: propOdds.rows, userSportsbook: propOdds.userSportsbook },
            live: footballLive,
          })
        : active.sport === 'soccer'
          ? toSoccerPlayerDetailData({
              live: soccerLive,
              candidates,
              market: active.dimension,
              snapshot,
              scope: { lineOffset, opponentOnly, lastN },
              propOdds: { rows: propOdds.rows, userSportsbook: propOdds.userSportsbook },
            })
          : active.sport === 'cfb'
            ? toCfbPlayerDetailData({
                candidates,
                market: active.dimension,
                snapshot,
                scope: { lineOffset, opponentOnly, lastN },
                propOdds: { rows: propOdds.rows, userSportsbook: propOdds.userSportsbook },
                teamDefenseAllowed: cfbTeamDefense.teams,
                live: footballLive,
              })
            : active.sport === 'nba'
              ? toNbaPlayerDetailData({
                  live: nbaLive,
                  candidates,
                  market: active.dimension,
                  snapshot,
                  scope: { lineOffset, opponentOnly, lastN },
                  propOdds: { rows: propOdds.rows, userSportsbook: propOdds.userSportsbook },
                  teamDefenseAllowed: nbaTeamDefense.teams,
                })
              : active.sport === 'nhl'
                ? toNhlPlayerDetailData({
                    live: nhlLive,
                    candidates,
                    market: active.dimension,
                    snapshot,
                    scope: { lineOffset, opponentOnly, lastN },
                    propOdds: { rows: propOdds.rows, userSportsbook: propOdds.userSportsbook },
                    teamDefenseAllowed: nhlTeamDefense.teams,
                  })
                : active.sport === 'tennis'
                  ? toTennisPlayerDetailData({
                      live: tennisLive,
                      candidates,
                      market: active.dimension,
                      snapshot,
                      scope: { lineOffset, opponentOnly, lastN },
                      propOdds: { rows: propOdds.rows, userSportsbook: propOdds.userSportsbook },
                    })
          : toMlbPlayerDetailData({
            candidates,
            market: active.dimension,
            snapshot,
            odds,
            scope: { lineOffset, opponentOnly, venue, lastN },
            propOdds: { rows: propOdds.rows, userSportsbook: propOdds.userSportsbook },
            opponentTeamStatcast,
            live: playerLive,
            pitchProfile,
            opposingPitchProfile,
          });

  // Price movement for the active prop (6.16). Sport-agnostic — every sport
  // writes `prop_odds_history` through the same Python jobs — and gated by the
  // arguments going undefined rather than by a branch on the hook call.
  //
  // `active.dimension` IS NOT THE MARKET KEY. The candidate dimension is this
  // app's own vocabulary and `prop_odds_history.market_key` is the canonical
  // provider one; most coincide, but MLB's `hit-in-game` is stored as `hits`,
  // and passing the dimension straight through returned an empty series for
  // every hits prop while looking entirely healthy. `candidateDimensionToMarketKey`
  // and `candidateCategoryToSide` are the existing translators — the same pair
  // the MLB adapter already uses to find a candidate's real prices.
  //
  // PINNED TO THE LINE ON SCREEN (R2-F5, R6.1d): the stepper's opening line is
  // R2's main line, and the chart names the same line rather than the
  // most-observed rung. Cut at the start for a started game, like every other
  // price on the page. After `data`, because the line is the adapter's.
  const lineHistoryMarketKey = active ? (candidateDimensionToMarketKey(active.dimension) ?? undefined) : undefined;
  const lineHistorySide = active ? (candidateCategoryToSide(active.category ?? '') ?? 'over') : 'over';
  const lineHistory = useLineHistory(
    gamePkStr,
    active?.subjectId,
    lineHistoryMarketKey,
    lineHistorySide,
    data?.priceCandidate?.line ?? active?.line ?? null,
    started ? startIso : null,
  );

  // Combined readiness for `onReadyChange` — every hook on this page that
  // OWNS A VISIBLE CARD, not just the two that happen to drive an `lb-skel`
  // shimmer.
  //
  // MEASURED, 2026-08-31: the previous gate was `!playerLive.loading &&
  // !opponentTeamStatcast.loading`. Both are MLB-only — `useTeamStatcast` is
  // called with an id solely for an MLB pitcher subject — so on a warm
  // waterfall the loader released at 4.65s against a page that finished at
  // 6.47s, and PITCH MIX, STRIKE ZONE, PLATOON SPLIT, Line movement and the
  // 11-row All-books card all painted in after it. For a subject with no
  // live game and no opponent Statcast, BOTH gating hooks idle, the gate was
  // `true` from the start, and the loader covered none of a 6.3s load at all.
  //
  // Every hook below idles safely: each sets `loading = false` and returns
  // when its id argument is undefined, so a sport that never fires one is
  // never blocked by it. That is what makes listing all of them correct
  // rather than merely thorough — see each hook's own early return.
  const detailPending =
    playerLive.loading ||
    opponentTeamStatcast.loading ||
    statcastNow.loading ||
    opposingStatcast.loading ||
    nflTargets.loading ||
    footballLive.loading ||
    soccerLive.loading ||
    soccerUnderstat.loading ||
    tennisLive.loading ||
    tennisArchive.loading ||
    nbaLive.loading ||
    nhlLive.loading ||
    nbaShots.loading ||
    nhlShots.loading ||
    golfResearch.loading ||
    lineHistory.loading ||
    cfbTeamDefense.loading ||
    nbaTeamDefense.loading ||
    nhlTeamDefense.loading ||
    propOdds.loading;

  // The latch, the first-frame guard, the timeout and the anti-strobe floor
  // all live in the shared gate — see `useReadyGate` for why each is needed.
  const internalReady = useReadyGate(detailPending, {
    resetKey: `${active?.sport ?? 'none'}:${active?.subjectId ?? 'none'}:${active?.dimension ?? 'none'}`,
  });
  useEffect(() => {
    onReadyChange?.(internalReady);
  }, [internalReady, onReadyChange]);

  const sourceItems = [
    ...(bioState.data ? [{ label: 'Profile', detail: `${bioState.data.source}, ${asOfText(bioState.data.fetchedAt)}` }] : []),
    ...(historyState.data
      ? [
          {
            label: 'Game history',
            detail: `player_game_history, ${historyState.data.games.length} games${research ? ` (${research.seasonLabels.at(-1)?.label}–${research.seasonLabels[0]?.label})` : ''}, last written ${asOfText(historyState.data.asOf)}`,
          },
          { label: 'Results', detail: historyState.data.resultsSource },
        ]
      : []),
    ...(research?.sections ?? []).flatMap((sec) => (sec.source ? [{ label: sec.source.label, detail: `${sec.source.detail}, ${asOfText(sec.source.asOf)}` }] : [])),
    ...(snapshot ? [{ label: 'Markets and prop analysis', detail: `today's ${researchSport ?? active?.sport ?? ''} slate snapshot, ${asOfText(snapshot.fetchedAt)}` }] : []),
  ];

  // "Odds & prices" (R6.1d): every market this player is priced on, at R2's
  // main line, from the same rows the prop block reads. Markets the page has a
  // candidate for come first, in the tabs' order.
  const activeMarketKey = active ? candidateDimensionToMarketKey(active.dimension) : null;
  const marketDimension = (key: string) => candidates.find((c) => candidateDimensionToMarketKey(c.dimension) === key)?.dimension ?? null;
  const oddsSport = (active?.sport ?? subject?.sport ?? 'mlb') as PickCandidate['sport'];
  const marketLabel = (key: string) => marketText(oddsSport, marketDimension(key) ?? key, 'full');
  const priceSubjectId = active?.subjectId ?? null;
  const prices = useMemo(
    () =>
      priceSubjectId
        ? playerPriceRows(propOdds.rows, priceSubjectId, startIso, Date.now(), (key) => {
            const i = candidates.findIndex((c) => candidateDimensionToMarketKey(c.dimension) === key);
            return i < 0 ? candidates.length : i;
          })
        : [],
    [propOdds.rows, priceSubjectId, startIso, candidates],
  );

  /**
   * The page around the prop block: hero, section nav, research sections, odds,
   * sources. The embedded game-page host gets the prop block and the odds.
   */
  const renderPage = (
    propBlock: React.ReactNode,
    propSub: React.ReactNode,
    nextGame: React.ReactNode,
    oddsCards: { movement: React.ReactNode; books: React.ReactNode; gameLine: React.ReactNode } | null,
    live: React.ReactNode,
  ) => {
    const odds = (
      <PlayerOddsSection
        prices={prices}
        loading={marketsLoading || (Boolean(gamePkStr) && propOdds.loading && prices.length === 0)}
        started={started}
        activeMarketKey={activeMarketKey}
        marketLabel={marketLabel}
        onPickMarket={
          onMarketChange
            ? (key) => {
                const dimension = marketDimension(key);
                if (!dimension) return;
                setLineOffset(0);
                onMarketChange(dimension);
                document.getElementById('sec-props')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            : null
        }
        movement={oddsCards?.movement ?? null}
        books={oddsCards?.books ?? null}
        gameLine={oddsCards?.gameLine ?? null}
      />
    );
    if (!subject || embedded) {
      return (
        <div className="space-y-3">
          {propBlock}
          {odds}
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <PlayerHero
          bio={bioState.data}
          bioState={bioState}
          research={research}
          researchState={historyState}
          fallbackName={subject.name ?? active?.subjectName ?? null}
          teamHref={bioState.data?.team?.id ? teamHrefFor(subject.sport, subject.league ?? null, bioState.data.team.id) : null}
          nextGame={nextGame}
        />
        <SectionNav items={navItems} top={stickyTop} label="Player sections" />
        {/* C4 sits between the hero and the prop block, and only while a game
            is live (R6.3): inside "Prop analysis" it came between that heading
            and the block it introduces. */}
        {live ? (
          <Section id="live" title="Live now" sub="this game, as it happens">
            {live}
          </Section>
        ) : null}
        <Section id="props" title="Prop analysis" sub={propSub}>
          {propBlock}
        </Section>
        {historySport ? (
          <>
            <Section id="seasons" title="Season by season" sub="totals and per-game rates from every game held">
              <SeasonsCard research={research} state={historyState} />
            </Section>
            <Section id="trends" title="Trends">
              <TrendsCard research={research} state={historyState} />
            </Section>
            <Section id="splits" title="Splits" sub="per-game averages">
              <SplitsCard research={research} state={historyState} />
            </Section>
          </>
        ) : null}
        {/* A sport's own sections need no per-game history: golf has none (R6.6). */}
        {(research?.sections ?? []).map((sec) => (
          <Section key={sec.id} id={sec.id} title={sec.title} sub={sec.sub}>
            <ResearchSectionBody section={sec} onSeason={setSportSectionSeason} />
          </Section>
        ))}
        {historySport ? (
          <Section id="log" title="Game log">
            <GameLogCard research={research} state={historyState} />
          </Section>
        ) : null}
        <Section id="odds" title="Odds & prices" sub={started ? 'as they stood at the start' : 'main line, pre-game'}>
          {odds}
        </Section>
        <Section id="sources" title="Sources">
          <SourcesCard items={sourceItems} />
        </Section>
      </div>
    );
  };

  if (!active || !data) {
    if (subject && !embedded && marketsLoading) {
      return renderPage(
        <div className="rounded-card border border-line-soft bg-card p-4 shadow-card" aria-busy>
          <SkeletonLines lines={5} />
        </div>,
        null,
        null,
        null,
        null,
      );
    }
    if (subject && !embedded) {
      const seasonStatus = snapshot?.seasonStatus;
      const reason =
        seasonStatus && !seasonStatus.started
          ? `${seasonStatus.label ?? 'The season has not started'}${seasonStatus.nextGameDate ? ` — first games ${new Date(seasonStatus.nextGameDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}` : ''}. The research below is the player's own record and needs no line.`
          : "No book has posted a line for this player's next game, so there is nothing to measure the games against yet. The research below is the player's own record and needs no line.";
      return renderPage(
        <div className="rounded-card border border-line-soft bg-card shadow-card">
          <EmptyState title="No line posted for this player today" reason={reason} />
        </div>,
        null,
        null,
        null,
        null,
      );
    }
    return <div className="lb-card p-8 text-center text-sm text-ink-muted">No tracked markets for this player.</div>;
  }

  // Prop Score v1 — this player-page prop never had its own edge/score
  // resolution before (only the game-level moneyline/total edge below did);
  // same resolution ScanTable/ScanCard already use. Also reused for
  // "Add to slip" below — the resolved price is only valid for the opening
  // line, so it's only attached when `lineOffset === 0` (same gate the
  // OddsChip display beside it already uses).
  //
  // `priced` (R6.1d) is the candidate at the line the stepper opens on: MLB's
  // candidates carry the board line, and the adapter re-prices one at the
  // main line. Every other sport's candidate already is that line.
  const priced = data.priceCandidate ?? active;
  const activeEdgeInfo = resolveCandidateEdge(priced, propOdds.rows, propOdds.userSportsbook);
  const addOdds =
    lineOffset === 0 && activeEdgeInfo.price != null
      ? { americanOdds: String(activeEdgeInfo.price), source: activeEdgeInfo.priceSource ?? 'odds-api', bookmaker: activeEdgeInfo.bookmaker }
      : undefined;

  const effectiveGolfCategory: GolfCategory = data.lineControl?.kind === 'category' ? (data.lineControl.value as GolfCategory) : 'par';
  const previewingOtherGolfCategory = data.lineControl?.kind === 'category' && active.sport === 'golf' && effectiveGolfCategory !== active.category;
  const lineText = data.lineControl?.kind === 'stepper' ? `${data.lineControl.wantOver ? 'O' : 'U'} ${data.lineControl.line}` : null;
  const baseLine = data.lineControl?.kind === 'stepper' ? data.lineControl.baseLine : active.line ?? 0.5;
  // The model's probability, named with its own line when that is not the line
  // on screen (operator decision 2026-09-15): MLB's model runs on board lines.
  const modelControl = data.lineControl?.kind === 'stepper' ? data.lineControl : null;
  const modelText = modelControl?.model
    ? `Model ${Math.round(modelControl.model.prob * 100)}%${modelControl.model.line === modelControl.line ? '' : ` at ${modelControl.wantOver ? 'O' : 'U'} ${modelControl.model.line}`}`
    : null;

  function isChipActive(key: string): boolean {
    if (key.startsWith('venue:')) return venue === key.slice('venue:'.length);
    if (key === 'opponent') return opponentOnly;
    if (key.startsWith('lastN:')) {
      const raw = key.slice('lastN:'.length);
      return raw === 'all' ? lastN === 'all' : lastN === Number(raw);
    }
    if (key.startsWith('round:')) return effectiveRound === Number(key.slice('round:'.length));
    return false;
  }
  function selectChip(key: string) {
    if (key.startsWith('venue:')) {
      setVenue(key.slice('venue:'.length) as 'all' | 'home' | 'away');
    } else if (key === 'opponent') {
      setOpponentOnly((v) => !v);
    } else if (key.startsWith('lastN:')) {
      const raw = key.slice('lastN:'.length);
      setLastN(raw === 'all' ? 'all' : Number(raw));
    } else if (key.startsWith('round:')) {
      setSelectedRound(Number(key.slice('round:'.length)));
    }
  }

  // Today's game and the market in view, now that the hero is the player's (R6.1a).
  const live = data.gameState?.status === 'live' ? data.gameState : null;
  const nextGame = data.subject.opponentAbbr ? (
    <span className="inline-flex items-center gap-1.5">
      <span>{meta.isHome === true ? 'vs' : '@'}</span>
      {/* No `abbreviation`: the text beside it is the abbreviation, and a failed
          logo printed it twice ("@ HOU HOU", found rendering R6.3). */}
      <TeamLogo logoUrl={data.subject.opponentLogoUrl} size={14} />
      <span>{data.subject.opponentAbbr}</span>
      {live ? (
        // While the game is on, the hero shows the score rather than a start
        // time, and the live section below carries the detail.
        <Chip tone="live">
          {live.away.abbr} {live.away.score ?? '—'} – {live.home.abbr} {live.home.score ?? '—'}
          {live.periodLabel ? ` · ${live.periodLabel}` : ''}
        </Chip>
      ) : (
        <>
          {data.subject.gameStartTime ? <span>· {new Date(data.subject.gameStartTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span> : null}
          {data.subject.gameStatus ? <span>· {data.subject.gameStatus}</span> : null}
        </>
      )}
    </span>
  ) : null;
  const propSub = (
    <>
      {marketText(active.sport, active.dimension, 'full')} · {data.lineControl?.kind === 'category' ? golfCategoryLabel(active.dimension, effectiveGolfCategory) : lineText}
      {data.subject.rankDetail ? ` · ${data.subject.rankDetail}` : ''}
    </>
  );

  const todays = data.model?.todaysLine ?? null;
  const oddsCards = {
    movement: (
      <LineMovementCard
        data={lineHistory.data}
        loading={lineHistory.loading}
        userSportsbook={propOdds.userSportsbook}
        marketLabel={activeMarketKey ? marketLabel(activeMarketKey) : marketText(active.sport, active.dimension, 'full')}
      />
    ),
    books: (
      <Card
        title="All books"
        scope={data.propOddsBoard ? [marketLabel(data.propOddsBoard.marketKey), data.propOddsBoard.line].filter((x) => x != null).join(' ') : undefined}
        info="Every book's price at the line in view. Your book is starred."
        dense
        state={data.propOddsBoard ? { kind: 'ready' } : { kind: 'empty', title: 'No prices for this market', reason: 'This market has no book prices to compare.' }}
      >
        {data.propOddsBoard ? (
          <PropOddsBoard
            allRows={data.propOddsBoard.allRows}
            subjectId={data.propOddsBoard.subjectId}
            marketKey={data.propOddsBoard.marketKey}
            line={data.propOddsBoard.line}
            userSportsbook={data.propOddsBoard.userSportsbook}
          />
        ) : null}
      </Card>
    ),
    gameLine: (
      <Card
        title="Game line"
        scope={todays?.liveScore ? `${todays.liveScore.away}–${todays.liveScore.home} ${todays.livePeriod ?? ''}`.trim() : undefined}
        dense
        state={todays?.moneyline ? { kind: 'ready' } : { kind: 'empty', title: 'No game line yet', reason: 'No book has priced this matchup.' }}
      >
        {todays?.moneyline ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-ctl border border-line-soft p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-overline text-ink-muted">Moneyline</span>
                <BookLogo bookId={todays.moneyline.book} size={13} withLabel />
              </div>
              <div className="flex gap-1.5">
                <OddsChip price={todays.moneyline.away} source={todays.moneyline.source} side={data.subject.opponentAbbr} size="md" className="flex-1 justify-center" />
                <OddsChip price={todays.moneyline.home} source={todays.moneyline.source} side={data.subject.teamAbbr} size="md" className="flex-1 justify-center" />
              </div>
              {todays.moneylineEdge ? (
                <div className="mt-1 flex gap-1.5">
                  <EdgeBadge edge={todays.moneylineEdge.away} modelProb={todays.moneylineEdge.awayModelProb} marketProb={todays.moneylineEdge.awayMarketProb} label={data.subject.opponentAbbr ?? 'Away'} />
                  <EdgeBadge edge={todays.moneylineEdge.home} modelProb={todays.moneylineEdge.homeModelProb} marketProb={todays.moneylineEdge.homeMarketProb} label={data.subject.teamAbbr ?? 'Home'} />
                </div>
              ) : null}
            </div>
            {todays.total ? (
              <div className="rounded-ctl border border-line-soft p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-overline text-ink-muted">Total {todays.total.point}</span>
                  <BookLogo bookId={todays.total.book} size={13} withLabel />
                </div>
                <div className="flex gap-1.5">
                  <OddsChip price={todays.total.overPrice} source={todays.total.source} side={`O${todays.total.point}`} size="md" className="flex-1 justify-center" />
                  <OddsChip price={todays.total.underPrice} source={todays.total.source} side={`U${todays.total.point}`} size="md" className="flex-1 justify-center" />
                </div>
                {todays.totalEdge ? (
                  <div className="mt-1 flex gap-1.5">
                    <EdgeBadge edge={todays.totalEdge.over} modelProb={todays.totalEdge.overModelProb} marketProb={todays.totalEdge.overMarketProb} label="Over" />
                    <EdgeBadge edge={todays.totalEdge.under} modelProb={todays.totalEdge.underModelProb} marketProb={todays.totalEdge.underMarketProb} label="Under" />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    ),
  };

  return renderPage(
    <div className="space-y-3">
      {/* Market tabs — re-scope everything below without a reload. */}
      {candidates.length > 1 ? (
        // R3: real tabs (role="tab", arrow keys) instead of buttons styled as tabs.
        // One tab per market: a market can carry several candidates (golf's categories).
        <Tabs
          label="Market"
          value={active.dimension}
          items={[...new Map(candidates.map((c) => [c.dimension, c])).values()].map((c) => ({ value: c.dimension, label: marketText(c.sport, c.dimension, 'full') }))}
          onChange={(dimension) => {
            setLineOffset(0);
                    onMarketChange?.(dimension);
          }}
        />
      ) : null}

      {/* Line stepper + price — one grouped cluster, dividers between logical
          groups. Golf has no numeric line to step through (see the hero
          header above); the 3-way category picker takes the stepper's spot
          instead, since which of the 3 bets you're checking is the actual
          equivalent of moving an O/U line for this sport. */}
      <section className="lb-card flex flex-wrap items-center gap-3 p-2.5">
        {data.lineControl?.kind === 'category' ? (
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
              {lineText}
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
          {lineOffset === 0 && !previewingOtherGolfCategory && priced.lineStatus !== 'alternates-only' && (activeEdgeInfo.price != null || priced.odds) ? (
            <>
              <OddsChip
                price={activeEdgeInfo.price ?? priced.odds!.americanOdds}
                source={activeEdgeInfo.price != null ? activeEdgeInfo.priceSource : priced.odds!.source}
                capturedAt={activeEdgeInfo.price != null ? activeEdgeInfo.priceCapturedAt : priced.odds!.capturedAt}
                size="md"
              />
              {/* R2-F6: after the start the rows are the pre-game ones, and say so. */}
              {started ? <span className="text-label text-ink-muted">price at the start</span> : null}
            </>
          ) : lineOffset !== 0 ? (
            <span className="text-[11px] text-ink-muted">No price recorded at this alternate line.</span>
          ) : previewingOtherGolfCategory ? (
            <span className="text-[11px] text-ink-muted">
              Previewing {golfCategoryLabel(active.dimension, effectiveGolfCategory)} — this golfer&apos;s tracked pattern is {active.categoryLabel}.
            </span>
          ) : priced.lineStatus === 'alternates-only' ? (
            <StatusPill>Alternate lines only — no book quoted both sides, so this is not a market line</StatusPill>
          ) : onAdd ? (
            <GetOddsButton onClick={() => onAdd(priced)} label="Add to slip to record a price" />
          ) : null}
          {modelText ? (
            <Chip title="The model's probability for this side. MLB's model is computed at fixed lines, so it names its own line when that is not the line in view.">{modelText}</Chip>
          ) : null}


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
              onClick={() => onAdd(priced, addOdds)}
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

      {/* Scope filters — one generic chip row, driven by `data.chips`. Golf's
          round selector, MLB's venue+opponent+lastN, and NFL's opponent+lastN
          are all just different chip sets over the same key convention. */}
      <ScopeChips chips={data.chips} isActive={isChipActive} onSelect={selectChip} />

      {/* Window boxes — golf shows each round's actual score plus the
          tournament average, rather than a hit-rate over a game count it
          rarely has enough of. */}
      {data.roundScores ? (
        <div className="flex gap-1.5 overflow-x-auto lb-scroll-x">
          {data.roundScores.map((r) => (
            <RoundScoreBox
              key={r.key}
              label={r.label}
              value={r.value}
              format={r.format === 'average' ? relDisplayAvg : relDisplay}
              hit={r.hit}
            />
          ))}
        </div>
      ) : data.windows ? (
        <div className="flex gap-1.5 overflow-x-auto lb-scroll-x">
          <WindowBox label="L5" stat={data.windows.l5} />
          <WindowBox label="L10" stat={data.windows.l10} />
          <WindowBox label="L15" stat={data.windows.l15} />
          <WindowBox label="H2H" stat={data.windows.h2h} showCount />
          <WindowBox label="SZN" stat={data.windows.szn} showCount />
        </div>
      ) : null}

      {/* Main content (left) + persistent context rail (right, sticky at lg+) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_260px] lg:items-start">
        <div className="min-w-0 space-y-3">
          {/* Chart — golf gets the 18-hole scorecard for the selected round
              instead of DistributionChart, which measures one hole across
              rounds rather than every hole within one. */}
          {data.chart.kind === 'scorecard' ? (
            <Card title={data.chart.title} scope={data.chart.subtitle} dense>
              <ScorecardChart holes={data.chart.data} />
            </Card>
          ) : (
            <Card title={data.chart.title} scope={data.chart.subtitle} dense>
              <div>
                <DistributionChart
                  history={data.chart.data}
                  line={data.chart.line}
                  wantOver={data.chart.wantOver}
                  refreshKey={`${active.dimension}|${data.chart.line}|${opponentOnly}|${venue}|${lastN}|${snapshot?.fetchedAt ?? ''}`}
                  logoFor={data.chart.logoFor}
                />
              </div>
            </Card>
          )}

          {/* Live matchup — golf only, the middle-column counterpart to the
              Past Round Matchups card on the right rail. Only renders once
              ESPN has posted a tee time for the round in progress/next and
              at least one other golfer shares it. */}
          {data.liveMatchup ? (
            <LiveMatchupCard
              matchup={data.liveMatchup as unknown as LiveRoundMatchupMeta}
              selfName={data.subject.name}
              selfHeadshotUrl={data.subject.headshotUrl}
            />
          ) : null}

          {/* Universal matchup card — every sport (see
              docs/matchup-card-rebuild-gameplan-2026-08-23.md). Replaces the
              old MLB `matchups`/NFL `nflMatchup` cards outright. */}
          {data.matchupExplorer ? <MatchupExplorerCard data={data.matchupExplorer} /> : null}

          {/* THE BOARD DECIDES WHICH COLUMN, NOT THE ORDER THESE WERE WRITTEN IN.
              `docs/design/_ps-body.html` lays the page out as `1fr 288px` and
              rails eight of its twenty cards. Five of ours were here in the
              main column, stretched to roughly three times their designed
              width — which is what made the opposing-defence card read as
              mostly whitespace. Those five now render in the rail below;
              usage, the binary split and the spatial grid stay here, and the
              latter two are paired `.two-up` exactly as the board pairs them. */}
          <PlayerRoleMainSections
            roles={{
              opponentUnit: data.opponentUnit,
              usageMix: data.usageMix,
              spatialGrid: data.spatialGrid,
              binarySplit: data.binarySplit,
              conditions: data.conditions,
              careerH2H: data.careerH2H,
            }}
          />

          {/* Live line tracker — docs/live-matchup-and-line-tracker-gameplan-
              2026-08-23.md, Part 2. null for golf/soccer/tennis (no
              per-player live data source yet, see each adapter's own
              null-with-reason comment). */}
          {data.liveLineTracker ? <LiveLineTrackerCard data={data.liveLineTracker} subjectName={data.subject.name} /> : null}

          {data.seasonStatsCard ? (
            <GolfPlayerStatsCard
              name={active.subjectName}
              headshotUrl={data.subject.headshotUrl}
              strokesGained={data.seasonStatsCard.strokesGained}
              seasonLog={data.seasonStatsCard.seasonLog}
              advancedStats={data.seasonStatsCard.advancedStats}
              loading={data.seasonStatsCard.loading}
            />
          ) : null}
        </div>

        {/* Context rail.
            NO LONGER STICKY. It was `lg:sticky lg:top-4`, which works for a
            rail of three cards and fails for one of eight: once the rail is
            taller than the viewport, sticky pins its TOP and the bottom cards
            become unreachable while the main column scrolls past them. The
            design board's own rail is not sticky either. */}
        <div className="space-y-3">
          {/* The five cards the board rails — three roles and two analytics
              cards. Same components, rendered in the 260px column they were
              designed for rather than stretched across the main one. */}
          <PlayerRoleRailSections
            roles={{
              opponentUnit: data.opponentUnit,
              usageMix: data.usageMix,
              spatialGrid: data.spatialGrid,
              binarySplit: data.binarySplit,
              conditions: data.conditions,
              careerH2H: data.careerH2H,
            }}
          />
          {/* Golf keeps its own genuinely different context-rail card
              (§3 of the matchup-card rebuild gameplan). Every other sport's
              equivalent content now lives in the universal
              `MatchupExplorerCard` rendered in the main column above —
              the old MLB-only context-rail "Matchup →" card was fully
              subsumed by it (same data, more views), so it isn't
              duplicated here. */}
          {active.sport === 'golf' ? <PastRoundMatchupsCard active={active} meta={meta} /> : null}

          {/* Season stats — NFL, CFB, soccer and the others' ranked season
              card, in the context rail until each sport's own sub-phase. */}
          {data.nflSeasonStats ? (
            <section className="lb-card overflow-hidden">
              <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
                Season stats
                {data.nflSeasonStats.rankedAmongLabel ? (
                  <span className="ml-1.5 font-normal normal-case text-ink-muted">· ranked among {data.nflSeasonStats.rankedAmongLabel}s</span>
                ) : null}
              </h3>
              <div className="space-y-1.5 p-3">
                {data.nflSeasonStats.rows.map((r) =>
                  r.rank ? (
                    <StatRankRow key={r.key} stat={{ key: r.key, label: r.label, value: r.value, decimals: r.decimals, rank: r.rank.rank, poolSize: r.rank.poolSize }} />
                  ) : (
                    <div key={r.key} className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="w-20 shrink-0 text-ink-muted">{r.label}</span>
                      {/* F-B6: this branch printed the raw number and ignored
                          `r.decimals`, which the ranked branch beside it has
                          always honoured — so soccer's unranked xG rendered as
                          "3.4237903356552124". */}
                      <span className="font-semibold tabular-nums">{r.value.toFixed(r.decimals)}</span>
                    </div>
                  ),
                )}
              </div>
            </section>
          ) : null}

          {active.sport === 'golf' ? (
            <ConsistentHolesForm holes={data.golfFormHoles ?? []} />
          ) : (
            <Card title="Form" dense>
              <ul className="space-y-2">
                {(data.formWindows ?? []).slice(0, 4).map((split) => (
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
                {(data.formWindows ?? []).length === 0 ? (
                  <li className="text-body-sm text-ink-muted">No corroborating splits yet.</li>
                ) : null}
              </ul>
            </Card>
          )}

          {/* Line movement, the recorded price, all books and the game line are
              the "Odds & prices" section now (R6.1d). */}
        </div>
      </div>
    </div>,
    propSub,
    nextGame,
    oddsCards,
    data.gameState ? <GameStateCard state={data.gameState} subjectName={active.subjectName} /> : null,
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
  // R3: the G2 window chip (Last 5 / Last 10 / Season), through the one Chip.
  return (
    <Chip size="md" onClick={onClick} selected={active} className="shrink-0">
      {children}
    </Chip>
  );
}

export default PlayerDetail;
