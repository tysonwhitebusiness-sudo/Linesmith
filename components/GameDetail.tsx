'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { PickCandidate, Sport, SportSnapshot } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';
import { sortByComingUp } from '@/lib/core/pickEngine';
import type { SlateGame } from '@/lib/odds/matching';
import { projectLine, formatAmerican } from '@/lib/odds/display';
import { computeMoneylineEdge, computeTotalEdge } from '@/lib/odds/gameEdge';
import type { UnifiedLinesResult, UnifiedGameLine } from '@/lib/odds/types';
import { BookmakerBreakdown } from './GameLine';
import { GamePropLineShoppingRail } from './PropOddsPanel';
import type { MoneylineResult } from '@/lib/sports/mlb/gameModel';
import type { TeamGrades } from '@/lib/sports/nfl/nflTeamGrades';
import { toPicksPanelGame, toRecentResultRow, toInjuryRow, type RecentResultRow, type InjuryRow } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import { useGameContext, type GameContextState } from './useGameContext';
import { useBullpen, type BullpenState } from './useBullpen';
import { useNflGameDetail } from './useNflGameDetail';
import { useSoccerGameDetail } from './useSoccerGameDetail';
import { useCfbGameDetail } from './useCfbGameDetail';
import { useNbaGameDetail } from './useNbaGameDetail';
import { useNhlGameDetail } from './useNhlGameDetail';
import { useTennisGameDetail } from './useTennisGameDetail';
import { useGameOddsBookLines } from './useGameOddsBookLines';
import { useAllNbaTeams } from './useAllNbaTeams';
import { useAllNhlTeams } from './useAllNhlTeams';
import type { PickRow } from './useSlip';
import { SubjectAvatar, TeamLogo, nflTeamLogoUrl } from './SubjectAvatar';
import { TwoSidedStatRankRow } from './StatRankRow';
import { MarketLabel, MarketLine } from './MarketLabel';
import { OddsChip, StoredOddsChip, EdgeBadge } from './OddsChip';
import { BookLogo } from './BookLogo';
import { PlayerDetail, ordinal } from './PlayerDetail';
import { SegmentedToggle } from './SegmentedToggle';
import { usePropOdds, resolveCandidateEdge, type PropOddsRow } from './usePropOdds';
import { useMarketCalibration, type MarketCalibrationState } from './useMarketCalibration';
import { isGoodBet, candidateGoodBetSignals } from '@/lib/odds/goodBets';
import { isOk, type WindowedStat } from '@/lib/core/windowedStat';
import { InsufficientMark } from './StatCells';
import { useGamePickHistory, type GamePickView } from './useGamePickRecord';
import { PitchingMatchupCard } from './PitchingMatchupCard';
import { BatterPitcherMatchupCard } from './BatterPitcherMatchupCard';
import { NflPlayerVsDefenseCard } from './NflPlayerVsDefenseCard';
import { NflTeamScopePanel } from './NflTeamScopePanel';
import { GradeChip } from './GradeChip';
import { GameHeroCard, LiveTab } from './GameHeroCard';
import { NhlLiveTab } from './NhlLiveTab';
import { NbaLiveTab } from './NbaLiveTab';
import { SoccerLiveTab } from './SoccerLiveTab';
import { FootballLiveTab } from './FootballLiveTab';
import { TennisLiveTab } from './TennisLiveTab';
import {
  toGameDetailData as toMlbGameDetailData,
  type GameDetailData,
  type StatComparisonData,
  type RankingsData,
} from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import { toGameDetailData as toNflGameDetailData } from '@/lib/sports/nfl/adapters/gameDetailAdapter';
import { toGameDetailData as toSoccerGameDetailData } from '@/lib/sports/soccer/adapters/gameDetailAdapter';
import { toGameDetailData as toCfbGameDetailData } from '@/lib/sports/cfb/adapters/gameDetailAdapter';
import { toGameDetailData as toNbaGameDetailData } from '@/lib/sports/nba/adapters/gameDetailAdapter';
import { toGameDetailData as toNhlGameDetailData } from '@/lib/sports/nhl/adapters/gameDetailAdapter';
import { toGameDetailData as toTennisGameDetailData } from '@/lib/sports/tennis/adapters/gameDetailAdapter';
import type { SoccerLeague, TennisTour } from '@/lib/core/types';
import { heatFill, heatInk } from '@/lib/ui/heat';

/**
 * Game Detail's main pane, at the depth spec'd for a Linemate-equivalent game
 * summary: matchup context, season/last-5/head-to-head records, a team stat
 * comparison, league rankings and injuries — plus the per-game candidate list
 * that is Linesmith's own contribution. Clicking a candidate swaps this whole
 * pane for `PlayerDetail` rather than duplicating it.
 *
 * Every section here reads real numbers or states plainly that the number
 * isn't available (`—`, "No reported injuries", "not tracked") — the same
 * discipline Phase 1's `WindowedStat` established for props applies here to
 * team-level data that simply doesn't have five games behind it yet.
 */

// ---------------------------------------------------------------------------
// The extra shape the MLB adapter attaches to each slate game for this page
// ---------------------------------------------------------------------------

interface TeamGameContext {
  teamId: number;
  record: { wins: number; losses: number } | null;
  divisionRank: string | null;
  homeRecord: { wins: number; losses: number } | null;
  awayRecord: { wins: number; losses: number } | null;
  lastTen: { wins: number; losses: number } | null;
  forStats: Record<string, number | null>;
  /** Undivided season totals, alongside `forStats`'s per-game rate — same numbers, before the `perGame` division. */
  forStatsSeason: Record<string, number | null>;
  againstStats: Record<string, number | null>;
  forRanks: Record<string, string | null>;
  againstRanks: Record<string, string | null>;
}

export interface GameDetailGame extends SlateGame {
  away?: TeamGameContext;
  home?: TeamGameContext;
  weatherNarrative?: string | null;
  /** MLB person IDs for the two probable starters — used for headshot URLs on the Pitching matchup card. */
  awayStarterId?: number | null;
  homeStarterId?: number | null;
}

export interface StatKeyDef {
  key: string;
  label: string;
  decimals: number;
}

/** What the three Rankings views actually read off `game.away`/`game.home` — narrower than `GameDetailGame` so a non-MLB caller (NFL) can pass a minimal compatible object instead of fabricating MLB-only TeamGameContext fields (record, lastTen, forStatsSeason, ...) it has no use for. */
export interface RankableTeamStats {
  forRanks: Record<string, string | null>;
  againstRanks: Record<string, string | null>;
}

function teamLogoUrl(teamId?: number): string | undefined {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : undefined;
}

function fmtRecord(r: { wins: number; losses: number } | null): string {
  return r ? `${r.wins}-${r.losses}` : '—';
}

function recordFrom(games: { win: boolean | null }[]): { wins: number; losses: number } | null {
  if (games.length === 0) return null;
  return { wins: games.filter((g) => g.win).length, losses: games.filter((g) => !g.win).length };
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A minimal `PickCandidate` for a game-level leg (moneyline/spread/total).
 *
 * `meta.homeTeamId`/`awayTeamId`/`side` and `line` are carried through
 * `subjectMeta` purely so a submitted bet (see useSlip.addPick) has enough on
 * it to be graded later — moneyline/total grading compares `side` against
 * the final score, the same way `lib/odds/props/betGrading.ts` grades a
 * player prop. Spread is deliberately left without a gradable `side` (ATS
 * math isn't implemented) — same "left ungraded, not guessed at" gap
 * grading.ts already documents for vs-LHP/vs-RHP.
 */
export function gameMarketCandidate(
  sport: Sport,
  gamePk: number | string,
  subjectName: string,
  dimension: string,
  category: string,
  categoryLabel: string,
  meta?: { line?: number | null; homeTeamId?: number | null; awayTeamId?: number | null; side?: 'home' | 'away' | 'over' | 'under' },
): PickCandidate {
  return {
    sport,
    subjectId: `game-${gamePk}-${dimension}-${category}`,
    subjectName,
    dimension,
    dimensionLabel: dimension,
    category,
    categoryLabel,
    line: meta?.line ?? undefined,
    subjectMeta: {
      gamePk,
      homeTeamId: meta?.homeTeamId ?? null,
      awayTeamId: meta?.awayTeamId ?? null,
      side: meta?.side ?? null,
    },
    history: [],
    consistent: false,
    sampleSize: 0,
    liveState: { status: 'pre', distanceToSubject: null, distanceUnit: 'games', etaMinutes: null, etaConfidence: null },
  };
}

// ---------------------------------------------------------------------------
// Left rail
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Candidate scoring — round(L5×0.25 + L10×0.35 + L15×0.40), only when every
// window has enough games behind it. Feeds the Ranked/Tiles views and the
// score filter chips; the Player (grouped) view shows every good-bet
// candidate regardless, same as before, just with this strip added.
// ---------------------------------------------------------------------------

type Trend = 'up' | 'cooling' | 'steady';

const TREND_LABEL: Record<Trend, string> = { up: 'trending up', cooling: 'cooling', steady: 'steady' };
// Sourced from the shared ramp (up/cooling sit at its two ends) rather than
// hand-typed hex — 'steady' has no direction, so it stays the ink-faint
// token rather than a ramp midpoint amber.
const TREND_INK: Record<Trend, string> = { up: heatInk(1), cooling: heatInk(0), steady: '#97989b' };

// Continuous rather than the old 50/70 bucket jumps — same reasoning
// lib/ui/heat's own docs give for the dense-table tiles: a percentage this
// granular should track its exact value, not snap between three fixed hues.
function windowInk(pct: number): string {
  return heatInk(pct / 100);
}
function windowFill(pct: number): string {
  return heatFill(pct / 100);
}
// A flat-fill badge reads best as a small number of clearly distinct
// states, so this keeps its three buckets — but samples their color from
// the shared ramp at representative points instead of inventing separate
// hex per bucket.
function scoreBucket(score: number): { bg: string; ink: string } {
  const t = score >= 80 ? 0.9 : score >= 60 ? 0.5 : 0.1;
  return { bg: heatFill(t, 0.16), ink: heatInk(t) };
}

/** "SEA · @ NYY" — own team abbreviation plus opponent, same subjectMeta fields the old row already read. */
function metaLine(candidate: PickCandidate): string {
  const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
  const team = typeof meta.team === 'string' ? meta.team : undefined;
  const opponent = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  const isHome = meta.isHome === true;
  return [team, opponent ? `${isHome ? 'vs' : '@'} ${opponent}` : null].filter(Boolean).join(' · ');
}

export interface ScoredCandidate {
  candidate: PickCandidate;
  meta: string;
  score: number | null;
  trend: Trend | null;
  l5: WindowedStat;
  l10: WindowedStat;
  l15: WindowedStat;
}

function scoreCandidate(candidate: PickCandidate): ScoredCandidate {
  const { l5, l10, l15 } = candidateGoodBetSignals(candidate);
  let score: number | null = null;
  let trend: Trend | null = null;
  if (isOk(l5) && isOk(l10) && isOk(l15)) {
    const p5 = l5.rate * 100, p10 = l10.rate * 100, p15 = l15.rate * 100;
    score = Math.round(p5 * 0.25 + p10 * 0.35 + p15 * 0.4);
    const diff = p15 - p5;
    trend = diff > 6 ? 'up' : diff < -6 ? 'cooling' : 'steady';
  }
  return { candidate, meta: metaLine(candidate), score, trend, l5, l10, l15 };
}

/** One L5/L10/L15 mini bar — width/color from that window's own rate; an insufficient window shows the standard dash rather than a fabricated bar (windows are independent: a player can have a real L5 and an insufficient L15 at once). */
function WindowBar({ label, stat }: { label: string; stat: WindowedStat }) {
  if (!isOk(stat)) {
    return (
      <div className="flex flex-col gap-1">
        <div className="h-[5px] rounded-[3px]" style={{ backgroundColor: '#dcdee1' }} />
        <div className="flex items-baseline gap-1">
          <span className="text-micro tracking-[.06em] text-ink-faint">{label}</span>
          <InsufficientMark available={stat.available} required={stat.required} />
        </div>
      </div>
    );
  }
  const pct = Math.round(stat.rate * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="h-[5px] rounded-[3px]" style={{ backgroundColor: '#dcdee1' }}>
        <div className="h-full rounded-[3px]" style={{ width: `${pct}%`, backgroundColor: windowFill(pct) }} />
      </div>
      <div className="flex items-baseline gap-[5px]">
        <span className="text-micro tracking-[.06em] text-ink-faint">{label}</span>
        <span className="text-meta" style={{ color: windowInk(pct) }}>{pct}%</span>
      </div>
    </div>
  );
}

/** Track + pill buttons matching the candidates rail's own flat token set (`#f1f2f3` track, `#141619` active) rather than the rest of the app's bordered `SegmentedToggle`. */
function RailPills<T extends string>({
  options,
  value,
  onChange,
  radius = 999,
  fontSize = 12,
}: {
  options: Array<{ key: T; label: string }>;
  value: T;
  onChange: (key: T) => void;
  radius?: number;
  fontSize?: number;
}) {
  return (
    <div className="flex gap-0.5 rounded-[6px] p-[3px]" style={{ backgroundColor: '#f1f2f3', borderRadius: radius === 999 ? 999 : 6 }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className="px-3 py-1 transition-colors"
          style={{
            fontSize,
            borderRadius: radius,
            fontWeight: value === o.key ? 600 : 400,
            backgroundColor: value === o.key ? '#141619' : 'transparent',
            color: value === o.key ? '#f1f2f3' : '#616366',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SCORE_CHIPS = [
  { key: 'all', label: 'All', min: 0 },
  { key: '60', label: '60+', min: 60 },
  { key: '75', label: '75+', min: 75 },
  { key: '85', label: '85+', min: 85 },
] as const;

type ScoreFilterKey = (typeof SCORE_CHIPS)[number]['key'];

function ScoreFilterBar({
  value,
  onChange,
  visibleCount,
}: {
  value: ScoreFilterKey;
  onChange: (key: ScoreFilterKey) => void;
  visibleCount: number;
}) {
  const active = SCORE_CHIPS.find((c) => c.key === value)!;
  const summary = active.min === 0 ? 'no filter' : `${active.min}+ · ${visibleCount} left`;
  return (
    <div className="flex flex-col gap-2 px-4 py-2.5" style={{ backgroundColor: '#f1f2f3', borderBottom: '1px solid #dcdee1' }}>
      <div className="flex items-center justify-between">
        <span className="text-label uppercase tracking-[.14em] text-ink-faint">Min score</span>
        <span className="text-meta text-ink-secondary">{summary}</span>
      </div>
      <div className="flex gap-[5px]">
        {SCORE_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onChange(c.key)}
            aria-pressed={value === c.key}
            className="flex-1 rounded-full py-1 text-center text-meta transition-colors"
            style={{
              border: value === c.key ? 'none' : '1px solid #d3d4d7',
              backgroundColor: value === c.key ? '#141619' : 'transparent',
              color: value === c.key ? '#f1f2f3' : '#616366',
              fontWeight: value === c.key ? 600 : 400,
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player (grouped) view
// ---------------------------------------------------------------------------

function PropTile({ scored, selected, onSelect }: { scored: ScoredCandidate; selected: boolean; onSelect: () => void }) {
  const { candidate, l5, l10, l15 } = scored;
  const headline = isOk(l15) ? Math.round(l15.rate * 100) : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="flex w-full flex-col gap-2 rounded-lg p-2.5 text-left transition-colors"
      style={{ border: selected ? '1px solid #141619' : '1px solid #d3d4d7', backgroundColor: selected ? '#d9dbdd' : '#f1f2f3' }}
    >
      <div className="flex items-center justify-between gap-2">
        <MarketLine sport={candidate.sport} dimension={candidate.dimension} category={candidate.category} line={candidate.line} />
        {headline != null ? (
          <span className="text-dense font-semibold" style={{ color: windowInk(headline) }}>{headline}% L15</span>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <WindowBar label="L5" stat={l5} />
        <WindowBar label="L10" stat={l10} />
        <WindowBar label="L15" stat={l15} />
      </div>
    </button>
  );
}

/** Shape adapter.ts's `ownStatcastSummary` attaches to a batter candidate's `subjectMeta.ownStatcastSummary` — see PlayerDetail.tsx's identical local copy. */
interface OwnStatcastSummary {
  overallRank: number | null;
  poolSize: number;
  position: string;
  positionRank: number | null;
  positionPoolSize: number;
}

/** Compact "#N" rank badge for a batter candidate row — same data PlayerDetail's header badge and Quality of Contact card read, just condensed for a list row. Renders nothing for pitcher candidates or a season with no batter rankings computed yet. */
function OwnStatcastBadge({ meta }: { meta: Record<string, unknown> }) {
  const summary = meta.ownStatcastSummary as OwnStatcastSummary | undefined;
  if (summary?.overallRank == null) return null;
  return (
    <span
      className="whitespace-nowrap rounded-full bg-accent-soft px-1.5 py-0.5 text-micro font-semibold text-masters"
      title={`Quality of contact: ${ordinal(summary.overallRank)} of ${summary.poolSize} overall${
        summary.positionRank != null ? `, ${ordinal(summary.positionRank)} of ${summary.positionPoolSize} at ${summary.position}` : ''
      }`}
    >
      #{summary.overallRank}
    </span>
  );
}

function PlayerGroup({
  scoredProps,
  selectedPlayerId,
  selectedMarket,
  onSelectCandidate,
}: {
  scoredProps: ScoredCandidate[];
  selectedPlayerId?: string;
  selectedMarket?: string;
  onSelectCandidate: (subjectId: string, dimension: string) => void;
}) {
  const first = scoredProps[0].candidate;
  const meta = (first.subjectMeta ?? {}) as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-3 p-3.5" style={{ borderBottom: '1px solid #dcdee1' }}>
      <div className="flex items-center gap-2.5">
        <SubjectAvatar
          name={first.subjectName}
          headshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
          fallbackUrl={typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined}
          size={34}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-emphasis font-semibold">{first.subjectName}</span>
            <OwnStatcastBadge meta={meta} />
          </div>
          <div className="text-label uppercase tracking-[.1em] text-ink-faint">{scoredProps[0].meta}</div>
        </div>
        <span className="text-meta text-ink-soft">{scoredProps.length} prop{scoredProps.length === 1 ? '' : 's'}</span>
      </div>
      <div className="flex flex-col gap-2">
        {scoredProps.map((s) => (
          <PropTile
            key={candidateKey(s.candidate)}
            scored={s}
            selected={s.candidate.subjectId === selectedPlayerId && s.candidate.dimension === selectedMarket}
            onSelect={() => onSelectCandidate(s.candidate.subjectId, s.candidate.dimension)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranked view
// ---------------------------------------------------------------------------

function RankedRow({
  scored,
  selected,
  onSelect,
}: {
  scored: ScoredCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  const { candidate, score, trend, l5, l10, l15 } = scored;
  if (score == null || trend == null) return null;
  const bucket = scoreBucket(score);
  const windows = [l5, l10, l15];
  const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="flex w-full items-center gap-3 p-3 text-left transition-colors"
      style={{ borderBottom: '1px solid #e7e8ea', backgroundColor: selected ? '#f1f2f3' : undefined }}
    >
      <div className="flex h-[38px] w-[38px] shrink-0 flex-col items-center justify-center rounded-[9px]" style={{ backgroundColor: bucket.bg }}>
        <div className="text-emphasis font-semibold leading-none" style={{ color: bucket.ink }}>{score}</div>
        <div className="text-micro uppercase tracking-[.1em] opacity-70" style={{ color: bucket.ink }}>score</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-body font-semibold">{candidate.subjectName}</span>
          <OwnStatcastBadge meta={meta} />
          <span className="whitespace-nowrap text-label text-ink-faint">{scored.meta}</span>
        </div>
        <MarketLine sport={candidate.sport} dimension={candidate.dimension} category={candidate.category} line={candidate.line} className="text-ink-secondary" />
        <div className="flex items-center gap-2">
          <div className="flex h-4 items-end gap-[3px]">
            {windows.map((w, i) => {
              const pct = isOk(w) ? Math.round(w.rate * 100) : 0;
              return <div key={i} className="w-[9px] rounded-t-[2px]" style={{ height: Math.max(4, Math.round(pct * 0.16)), backgroundColor: isOk(w) ? windowFill(pct) : '#dcdee1' }} />;
            })}
          </div>
          <span className="text-label text-ink-faint">L5 · L10 · L15</span>
          <span className="ml-auto text-meta" style={{ color: TREND_INK[trend] }}>{TREND_LABEL[trend]}</span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tiles view
// ---------------------------------------------------------------------------

function TileCard({ scored, selected, onSelect }: { scored: ScoredCandidate; selected: boolean; onSelect: () => void }) {
  const { candidate, l5, l10, l15 } = scored;
  if (!isOk(l15)) return null;
  const best = Math.round(l15.rate * 100);
  const windows: Array<{ label: string; stat: WindowedStat }> = [
    { label: 'L5', stat: l5 },
    { label: 'L10', stat: l10 },
    { label: 'L15', stat: l15 },
  ];
  const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="flex flex-col overflow-hidden rounded-[10px] bg-white text-left transition-colors"
      style={{ border: selected ? '1px solid #141619' : '1px solid #d3d4d7' }}
    >
      <div className="flex items-start justify-between gap-2.5 p-3">
        <div className="flex min-w-0 flex-col gap-1">
          <MarketLine sport={candidate.sport} dimension={candidate.dimension} category={candidate.category} line={candidate.line} size="md" className="font-semibold" />
          <div className="flex items-center gap-2">
            <SubjectAvatar
              name={candidate.subjectName}
              headshotUrl={typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined}
              fallbackUrl={typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined}
              size={20}
            />
            <span className="text-dense text-ink-secondary">{candidate.subjectName}</span>
            <OwnStatcastBadge meta={meta} />
            <span className="text-label text-ink-faint">{scored.meta}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-display-md font-medium leading-none tracking-[-.03em]" style={{ color: windowInk(best) }}>{best}%</span>
          <span className="text-micro uppercase tracking-[.14em] text-ink-faint">Last 15</span>
        </div>
      </div>
      <div className="grid grid-cols-3" style={{ borderTop: '1px solid #d3d4d7' }}>
        {windows.map((w, i) => {
          const pct = isOk(w.stat) ? Math.round(w.stat.rate * 100) : null;
          return (
            <div key={w.label} className="flex flex-col gap-1.5 p-2.5" style={i > 0 ? { borderLeft: '1px solid #e7e8ea' } : undefined}>
              {pct == null ? (
                <>
                  <InsufficientMark available={(w.stat as { available: number }).available} required={(w.stat as { required: number }).required} className="text-micro" />
                  <div className="h-1 rounded-[2px]" style={{ backgroundColor: '#f1f2f3' }} />
                </>
              ) : (
                <>
                  <div className="flex items-baseline gap-[5px]">
                    <span className="text-micro tracking-[.1em] text-ink-faint">{w.label}</span>
                    <span className="text-dense" style={{ color: windowInk(pct) }}>{pct}%</span>
                  </div>
                  <div className="h-1 rounded-[2px]" style={{ backgroundColor: '#f1f2f3' }}>
                    <div className="h-full rounded-[2px]" style={{ width: `${pct}%`, backgroundColor: windowFill(pct) }} />
                  </div>
                  <span className="text-micro" style={{ color: '#b6b7ba' }}>
                    {isOk(w.stat) ? `${w.stat.hits} of ${w.stat.total}` : ''}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Team scope
// ---------------------------------------------------------------------------

function TeamScopePanel({
  rawTeamCandidates,
  topPlayerPicks,
  onSelectCandidate,
  onGoPlayers,
}: {
  rawTeamCandidates: PickCandidate[];
  topPlayerPicks: ScoredCandidate[];
  onSelectCandidate: (subjectId: string, dimension: string) => void;
  onGoPlayers: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-2 rounded-[9px] p-4" style={{ border: '1px dashed #dcdee1', backgroundColor: '#f1f2f3' }}>
        <span className="text-label uppercase tracking-[.14em] text-ink-faint">
          0 of {rawTeamCandidates.length || 0} market{rawTeamCandidates.length === 1 ? '' : 's'} qualify
        </span>
        <p className="text-body leading-[1.45]">No team candidate clears the Good Bets bar for this game.</p>
        {rawTeamCandidates.length > 0 ? (
          <div className="flex flex-col gap-1.5 pt-1">
            {rawTeamCandidates.map((c) => (
              <div key={candidateKey(c)} className="flex items-center justify-between text-dense text-ink-soft">
                <span>{c.dimensionLabel}</span>
                <span>below bar</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {topPlayerPicks.length > 0 ? (
        <>
          <span className="text-dense text-ink-soft">Strongest player props instead:</span>
          {topPlayerPicks.map((s) => (
            <button
              key={candidateKey(s.candidate)}
              type="button"
              onClick={() => onSelectCandidate(s.candidate.subjectId, s.candidate.dimension)}
              className="flex items-center gap-2.5 rounded-lg p-2.5 text-left"
              style={{ border: '1px solid #d3d4d7', backgroundColor: '#f1f2f3' }}
            >
              <span className="text-body" style={{ color: isOk(s.l15) ? windowInk(Math.round(s.l15.rate * 100)) : '#97989b' }}>
                {isOk(s.l15) ? `${Math.round(s.l15.rate * 100)}%` : '—'}
              </span>
              <div className="min-w-0 flex-1">
                <MarketLine sport={s.candidate.sport} dimension={s.candidate.dimension} category={s.candidate.category} line={s.candidate.line} className="truncate" />
                <div className="truncate text-label text-ink-faint">{s.candidate.subjectName}</div>
              </div>
            </button>
          ))}
        </>
      ) : null}
      <button
        type="button"
        onClick={onGoPlayers}
        className="rounded-full py-1.5 text-center text-dense transition-colors"
        style={{ border: '1px solid #d3d4d7', color: '#141619' }}
      >
        See player candidates
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left rail
// ---------------------------------------------------------------------------

const GROUPED_CAP = 3;
const RANKED_CAP = 6;
const TILES_CAP = 4;

export function LeftRail({
  candidates,
  selectedPlayerId,
  selectedMarket,
  onSelectCandidate,
  propRows,
  userSportsbook,
  sharedCalibration,
  goodBetsGated = true,
  teamScopePanel: TeamScopePanelOverride,
}: {
  candidates: PickCandidate[];
  selectedPlayerId?: string;
  selectedMarket?: string;
  onSelectCandidate: (subjectId: string, dimension: string) => void;
  propRows: PropOddsRow[];
  userSportsbook: string;
  /** Reuse GameDetail's own already-fetched calibration instead of this component independently fetching an identical copy — same idiom as PlayerDetail's sharedCalibration. Omitted, LeftRail fetches its own (e.g. if ever mounted outside GameDetail). */
  sharedCalibration?: MarketCalibrationState;
  /** Default true (MLB's existing behavior, unaffected). Set false for a sport with no graded history to gate against (e.g. NFL) — every real candidate then flows into scoring/grouping/view-modes untouched instead of being filtered down to an empty rail. */
  goodBetsGated?: boolean;
  /** Overrides the team-scope panel's content when goodBetsGated is false — the default TeamScopePanel is hardcoded Good-Bets-only copy ("below bar"), which would be dishonest for a sport with nothing being gated. */
  teamScopePanel?: (props: {
    rawTeamCandidates: PickCandidate[];
    topPlayerPicks: ScoredCandidate[];
    onSelectCandidate: (subjectId: string, dimension: string) => void;
    onGoPlayers: () => void;
  }) => ReactNode;
}) {
  const [scope, setScope] = useState<'player' | 'team'>('player');
  const [view, setView] = useState<'grouped' | 'ranked' | 'tiles'>('grouped');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilterKey>('all');
  const [expanded, setExpanded] = useState(false);
  const calibrationFetched = useMarketCalibration(!sharedCalibration, candidates[0]?.sport ?? 'mlb');
  const calibration = sharedCalibration ?? calibrationFetched;

  useEffect(() => setExpanded(false), [scope, view, scoreFilter]);

  // Good Bets engine (lib/odds/goodBets.ts) — this panel used to list every
  // candidate for both teams regardless of whether it was actually worth
  // anything; now it only shows ones that clear the same edge/calibration/
  // price-ceiling bar Scan's Good Bets tab does.
  const goodBets = useMemo(
    () =>
      goodBetsGated
        ? candidates.filter((c) => {
            const info = resolveCandidateEdge(c, propRows, userSportsbook);
            return isGoodBet(
              {
                edge: info.edge,
                marketProb: info.marketProb,
                sampleSize: c.sampleSize,
                dimension: c.dimension,
                priceAmerican: info.price,
                ...candidateGoodBetSignals(c),
              },
              calibration.trustedMarkets,
            );
          })
        : candidates,
    [candidates, propRows, userSportsbook, calibration.trustedMarkets, goodBetsGated],
  );
  const playerCandidates = useMemo(
    () => sortByComingUp(goodBets.filter((c) => (c.subjectMeta as Record<string, unknown> | undefined)?.isTeamCandidate !== true)),
    [goodBets],
  );
  const teamCandidates = useMemo(
    () => goodBets.filter((c) => (c.subjectMeta as Record<string, unknown> | undefined)?.isTeamCandidate === true),
    [goodBets],
  );
  const rawTeamCandidates = useMemo(
    () => candidates.filter((c) => (c.subjectMeta as Record<string, unknown> | undefined)?.isTeamCandidate === true),
    [candidates],
  );

  const playerScored = useMemo(() => playerCandidates.map(scoreCandidate), [playerCandidates]);
  const topPlayerPicks = useMemo(
    () => playerScored.filter((s) => s.score != null).sort((a, b) => b.score! - a.score!).slice(0, 3),
    [playerScored],
  );

  const minScore = SCORE_CHIPS.find((c) => c.key === scoreFilter)!.min;
  const byScore = useMemo(
    () => (minScore === 0 ? playerScored : playerScored.filter((s) => s.score != null && s.score >= minScore)),
    [playerScored, minScore],
  );
  const rankedScored = useMemo(
    () => byScore.filter((s) => s.score != null).sort((a, b) => b.score! - a.score!),
    [byScore],
  );

  const grouped = useMemo(() => {
    const groups: { subjectId: string; props: ScoredCandidate[] }[] = [];
    for (const s of byScore) {
      let g = groups.find((x) => x.subjectId === s.candidate.subjectId);
      if (!g) { g = { subjectId: s.candidate.subjectId, props: [] }; groups.push(g); }
      g.props.push(s);
    }
    return groups;
  }, [byScore]);

  const visible = view === 'grouped' ? byScore : rankedScored;
  const totalForView = view === 'grouped' ? grouped.length : visible.length;
  const cap = view === 'grouped' ? GROUPED_CAP : view === 'ranked' ? RANKED_CAP : TILES_CAP;
  const shownGrouped = expanded ? grouped : grouped.slice(0, cap);
  const shownRanked = expanded ? rankedScored : rankedScored.slice(0, cap);
  const remaining = totalForView - (expanded ? totalForView : cap);

  return (
    <div className="lb-card flex h-full flex-col overflow-hidden">
      <div className="flex flex-col gap-2.5 p-3.5" style={{ borderBottom: '1px solid #dcdee1' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-title font-semibold">Candidates</h2>
            <span className="text-meta text-ink-faint">
              {scope === 'team' ? teamCandidates.length : byScore.length} {scope === 'team' ? 'markets' : 'props'}
            </span>
          </div>
          <RailPills options={[{ key: 'player', label: 'Player' }, { key: 'team', label: 'Team' }]} value={scope} onChange={setScope} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-label uppercase tracking-[.14em] text-ink-faint">View</span>
          <RailPills
            options={[{ key: 'grouped', label: 'Player' }, { key: 'ranked', label: 'Ranked' }, { key: 'tiles', label: 'Tiles' }]}
            value={view}
            onChange={setView}
            radius={6}
            fontSize={11}
          />
        </div>
      </div>

      {scope === 'player' ? <ScoreFilterBar value={scoreFilter} onChange={setScoreFilter} visibleCount={byScore.length} /> : null}

      {/* flex-1 + min-h-0 lets this scroll region actually fill the card's
          stretched grid height rather than stopping at a fixed vh cap and
          leaving blank space below it. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {scope === 'team' ? (
          TeamScopePanelOverride ? (
            <TeamScopePanelOverride
              rawTeamCandidates={rawTeamCandidates}
              topPlayerPicks={topPlayerPicks}
              onSelectCandidate={onSelectCandidate}
              onGoPlayers={() => setScope('player')}
            />
          ) : (
            <TeamScopePanel
              rawTeamCandidates={rawTeamCandidates}
              topPlayerPicks={topPlayerPicks}
              onSelectCandidate={onSelectCandidate}
              onGoPlayers={() => setScope('player')}
            />
          )
        ) : byScore.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-7 text-center">
            <p className="text-body font-semibold">No props at {minScore}+</p>
            {playerScored.length > 0 ? (
              <p className="text-dense leading-[1.5] text-ink-soft">
                The strongest candidate in this game scores {Math.max(...playerScored.map((s) => s.score ?? 0))}.
              </p>
            ) : (
              <p className="text-dense leading-[1.5] text-ink-soft">No player candidate clears the Good Bets bar for this game right now.</p>
            )}
            {minScore > 0 ? (
              <button type="button" onClick={() => setScoreFilter('all')} className="rounded-full px-3.5 py-1.5 text-dense" style={{ border: '1px solid #d3d4d7', color: '#141619' }}>
                Clear filter
              </button>
            ) : null}
          </div>
        ) : view === 'grouped' ? (
          <>
            {shownGrouped.map((g) => (
              <PlayerGroup
                key={g.subjectId}
                scoredProps={g.props}
                selectedPlayerId={selectedPlayerId}
                selectedMarket={selectedMarket}
                onSelectCandidate={onSelectCandidate}
              />
            ))}
          </>
        ) : view === 'ranked' ? (
          <>
            {shownRanked.map((s) => (
              <RankedRow
                key={candidateKey(s.candidate)}
                scored={s}
                selected={s.candidate.subjectId === selectedPlayerId && s.candidate.dimension === selectedMarket}
                onSelect={() => onSelectCandidate(s.candidate.subjectId, s.candidate.dimension)}
              />
            ))}
          </>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 p-3" style={{ backgroundColor: '#f1f2f3' }}>
            {rankedScored.slice(0, expanded ? undefined : TILES_CAP).map((s) => (
              <TileCard
                key={candidateKey(s.candidate)}
                scored={s}
                selected={s.candidate.subjectId === selectedPlayerId && s.candidate.dimension === selectedMarket}
                onSelect={() => onSelectCandidate(s.candidate.subjectId, s.candidate.dimension)}
              />
            ))}
          </div>
        )}

        {scope === 'player' && byScore.length > 0 ? (
          remaining > 0 ? (
            <button type="button" onClick={() => setExpanded(true)} className="w-full py-2.5 text-center text-dense text-ink-muted">
              Show {remaining} more
            </button>
          ) : (
            <p className="py-2.5 text-center text-dense text-ink-muted">That&rsquo;s all for this game.</p>
          )
        ) : null}
      </div>
    </div>
  );
}

function CardHeader({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-3">
      <h2 className="text-meta font-semibold uppercase tracking-[.18em] text-ink-secondary">{children}</h2>
      {right}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** Mono win% as ".xxx" — the stats-page convention, not "0.xxx". */
function winPctStr(r: { wins: number; losses: number } | null): string {
  if (!r || r.wins + r.losses === 0) return '—';
  return (r.wins / (r.wins + r.losses)).toFixed(3).replace(/^0/, '');
}

function RecordPanel({
  abbr,
  logoUrl,
  record,
  standing,
  home,
  away,
  leading,
  align,
}: {
  abbr: string;
  logoUrl?: string;
  record: { wins: number; losses: number } | null;
  standing: string | null;
  home: { wins: number; losses: number } | null;
  away: { wins: number; losses: number } | null;
  leading: boolean;
  align: 'left' | 'right';
}) {
  const reversed = align === 'right';
  return (
    <div className={`p-5 ${reversed ? 'text-right' : ''}`}>
      <div className={`flex items-center gap-2.5 ${reversed ? 'flex-row-reverse' : ''}`}>
        <TeamLogo logoUrl={logoUrl} abbreviation={abbr} size={26} />
        <span className="text-title font-semibold">{abbr}</span>
        <span className={`text-dense text-ink-muted ${reversed ? 'mr-auto' : 'ml-auto'}`}>{winPctStr(record)}</span>
      </div>
      <div className={`mt-2 flex items-baseline gap-2 ${reversed ? 'flex-row-reverse' : ''}`}>
        <span className="text-display-lg font-medium leading-[.9] tracking-[-.03em]" style={{ color: leading ? '#0f7a4f' : '#0c0d0f' }}>
          {fmtRecord(record)}
        </span>
        {standing ? <span className="text-dense text-ink-soft">{standing}</span> : null}
      </div>
      <div className="mt-3 border-t border-line-soft">
        <div className="flex items-center justify-between border-b border-line-soft py-[11px] text-body">
          <span className="text-ink-muted">Home</span>
          <span className="font-medium">{fmtRecord(home)}</span>
        </div>
        <div className="flex items-center justify-between py-[11px] text-body">
          <span className="text-ink-muted">Away</span>
          <span className="font-medium">{fmtRecord(away)}</span>
        </div>
      </div>
    </div>
  );
}

export interface RecordsSectionTeam {
  abbr: string;
  logoUrl?: string;
  divisionRank?: string | null;
  season: { wins: number; losses: number } | null;
  seasonHome: { wins: number; losses: number } | null;
  seasonAway: { wins: number; losses: number } | null;
  /** Most-recent-first, sliced to the last 5 by the caller (matches computeStreak's own "already sliced" contract). */
  recent: RecentResultRow[];
  /** Meetings within the tracked H2H window — MLB: 45 days; each sport's adapter decides its own window. */
  h2h: RecentResultRow[];
}

export function RecordsSection({
  away,
  home,
  loading,
}: {
  away: RecordsSectionTeam;
  home: RecordsSectionTeam;
  loading: boolean;
}) {
  const [tab, setTab] = useState<'season' | 'last5' | 'h2h'>('season');

  const data = useMemo(() => {
    if (tab === 'season') {
      return {
        away: away.season,
        home: home.season,
        awayHome: away.seasonHome,
        awayAway: away.seasonAway,
        homeHome: home.seasonHome,
        homeAway: home.seasonAway,
      };
    }
    const awaySet = tab === 'last5' ? away.recent : away.h2h;
    const homeSet = tab === 'last5' ? home.recent : home.h2h;
    return {
      away: recordFrom(awaySet),
      home: recordFrom(homeSet),
      awayHome: recordFrom(awaySet.filter((g) => g.isHome)),
      awayAway: recordFrom(awaySet.filter((g) => !g.isHome)),
      homeHome: recordFrom(homeSet.filter((g) => g.isHome)),
      homeAway: recordFrom(homeSet.filter((g) => !g.isHome)),
    };
  }, [tab, away, home]);

  const awayPct = data.away && data.away.wins + data.away.losses > 0 ? data.away.wins / (data.away.wins + data.away.losses) : null;
  const homePct = data.home && data.home.wins + data.home.losses > 0 ? data.home.wins / (data.home.wins + data.home.losses) : null;
  const awayLeads = awayPct != null && homePct != null && awayPct > homePct;
  const homeLeads = awayPct != null && homePct != null && homePct > awayPct;

  return (
    <section className="lb-card overflow-hidden">
      <CardHeader
        right={
          <SegmentedToggle
            value={tab}
            onChange={setTab}
            options={[
              { key: 'season', label: 'Season' },
              { key: 'last5', label: 'Last 5' },
              { key: 'h2h', label: 'Head to Head', title: "Meetings within the last 45 days — earlier-season meetings aren't counted" },
            ]}
          />
        }
      >
        Records
      </CardHeader>
      {tab !== 'season' && loading ? (
        <div className="space-y-1.5 p-4">
          <div className="h-10 animate-pulse rounded bg-line-soft" />
          <div className="h-10 animate-pulse rounded bg-line-soft" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1px_1fr]">
          <RecordPanel
            abbr={away.abbr}
            logoUrl={away.logoUrl}
            record={data.away}
            standing={tab === 'season' && away.divisionRank ? `${away.divisionRank} in division` : null}
            home={data.awayHome}
            away={data.awayAway}
            leading={awayLeads}
            align="left"
          />
          <div className="hidden bg-line-soft sm:block" />
          <RecordPanel
            abbr={home.abbr}
            logoUrl={home.logoUrl}
            record={data.home}
            standing={tab === 'season' && home.divisionRank ? `${home.divisionRank} in division` : null}
            home={data.homeHome}
            away={data.homeAway}
            leading={homeLeads}
            align="right"
          />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Team stat comparison
// ---------------------------------------------------------------------------

/** Rate stats (batting average and friends) print as ".232", not "0.232". */
function fmtStatCell(v: number | null, decimals: number): string {
  if (v == null) return '—';
  if (decimals === 3) return v.toFixed(3).replace(/^(-?)0/, '$1');
  return v.toFixed(decimals);
}

/** Leader gets the ink (masters green); trailer stays a neutral grey — regardless of home/away. */
function StatComparisonRow({ label, away, home, decimals }: { label: string; away: number | null; home: number | null; decimals: number }) {
  const a = away ?? 0;
  const h = home ?? 0;
  const max = Math.max(Math.abs(a), Math.abs(h), 0.0001);
  const awayBetter = away != null && home != null && away > home;
  const homeBetter = away != null && home != null && home > away;

  return (
    <div className="grid grid-cols-[52px_1fr_64px_1fr_52px] items-center gap-2 py-1">
      <span className={`text-right text-body tabular-nums ${awayBetter ? 'font-semibold text-ink' : 'text-ink-soft'}`}>{fmtStatCell(away, decimals)}</span>
      <div className="h-3 rounded-[2px] bg-line-soft">
        <div
          className="ml-auto h-full rounded-[2px] transition-all duration-200 ease-out"
          style={{ width: `${Math.max((Math.abs(a) / max) * 100, 4)}%`, backgroundColor: awayBetter ? '#323335' : '#b6b7ba' }}
        />
      </div>
      <span className="text-center text-meta font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
      <div className="h-3 rounded-[2px] bg-line-soft">
        <div
          className="h-full rounded-[2px] transition-all duration-200 ease-out"
          style={{ width: `${Math.max((Math.abs(h) / max) * 100, 4)}%`, backgroundColor: homeBetter ? '#0f7a4f' : '#b6b7ba' }}
        />
      </div>
      <span className={`text-body tabular-nums ${homeBetter ? 'font-semibold text-good' : 'text-ink-soft'}`}>{fmtStatCell(home, decimals)}</span>
    </div>
  );
}

/**
 * The Stat comparison section — MLB's away/home magnitude bars
 * (`StatComparisonRow`, grouped Batting/Rate) or NFL's ranked rows
 * (`TwoSidedStatRankRow`, grouped by box-score category). Genuinely
 * different visual language, not just different data — `data.bars`/
 * `data.ranked` are mutually exclusive per sport (see `StatComparisonData`'s
 * own doc comment), so which one renders is a presence check, not a sport
 * check.
 */
function StatComparison({ data }: { data: StatComparisonData }) {
  return (
    <section className="lb-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-meta font-semibold uppercase tracking-[.18em] text-ink-secondary">Team stat comparison</h2>
        <div className="flex items-center gap-3 text-micro uppercase tracking-wide text-ink-faint">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: '#b6b7ba' }} />{data.awayAbbr}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-masters" />{data.homeAbbr}</span>
        </div>
      </div>
      {data.bars ? (
        <div className="space-y-3">
          {data.bars.map((g) => (
            <div key={g.label}>
              <div className="mb-1 text-label font-semibold uppercase tracking-[.18em] text-ink-faint">{g.label}</div>
              {g.rows.map((r) => (
                <StatComparisonRow key={r.key} label={r.label} away={r.away} home={r.home} decimals={r.decimals} />
              ))}
            </div>
          ))}
        </div>
      ) : data.ranked ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {data.ranked.map((g) => (
            <div key={g.label}>
              <div className="mb-1 text-center text-label font-semibold uppercase tracking-[.18em] text-ink-faint">{g.label}</div>
              {g.rows.map((r) => (
                <TwoSidedStatRankRow key={r.key} label={r.label} subject={r.away} opponent={r.home} />
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Last 5 games
// ---------------------------------------------------------------------------

/** Most recent first; a positive run = current win streak, negative = current losing streak. */
export function computeStreak(games: { win: boolean | null }[]): number {
  if (games.length === 0) return 0;
  const first = games[0].win;
  let n = 0;
  for (const g of games) {
    if (g.win !== first) break;
    n++;
  }
  return first ? n : -n;
}

function GameTile({ g }: { g: RecentResultRow }) {
  const win = g.win;
  return (
    <div
      className="shrink-0 rounded-lg border px-2.5 py-2 text-center text-meta leading-tight"
      style={{ borderColor: win ? '#dde8e1' : '#f0ddda', backgroundColor: win ? '#f2f6f3' : '#fbf3f2' }}
    >
      <div className="flex items-center justify-center gap-1.5">
        <span
          className="flex h-[19px] w-[19px] items-center justify-center rounded-full text-label font-semibold text-white"
          style={{ backgroundColor: win ? '#0f7a4f' : '#c23b2c' }}
        >
          {win ? 'W' : 'L'}
        </span>
        <span className="text-emphasis tabular-nums" style={{ color: win ? '#0f7a4f' : '#c23b2c' }}>{g.scoreFor}-{g.scoreAgainst}</span>
      </div>
      <div className="mt-1 flex items-center justify-center gap-1 text-ink-muted">
        {g.isHome ? 'vs' : '@'} {g.opponentAbbr}
        <span className="text-ink-faint">· {shortDate(g.date)}</span>
      </div>
    </div>
  );
}

function BoxScorePanel({ abbr, logoUrl, games }: { abbr: string; logoUrl?: string; games: RecentResultRow[] }) {
  const rec = recordFrom(games);
  return (
    <div className="overflow-hidden rounded-lg border border-line-soft">
      <div className="flex items-center gap-2 bg-surface-header px-3 py-2">
        <TeamLogo logoUrl={logoUrl} abbreviation={abbr} size={18} />
        <span className="text-label uppercase tracking-wide text-ink-muted">{fmtRecord(rec)} last five</span>
      </div>
      {games.length === 0 ? (
        <p className="p-3 text-meta text-ink-faint">No recent results in this window.</p>
      ) : (
        <div className="divide-y divide-line-hair">
          {games.map((g) => (
            <div key={g.gameId} className="px-3 py-2">
              <div className="grid grid-cols-[20px_1fr_54px] items-center gap-2 text-dense">
                <span className="font-semibold" style={{ color: g.win ? '#0f7a4f' : '#c23b2c' }}>{g.win ? 'W' : 'L'}</span>
                <span className="truncate text-ink-muted">
                  {g.isHome ? 'vs' : '@'} {g.opponentAbbr} <span className="text-ink-faint">· {shortDate(g.date)}</span>
                </span>
                <span className="text-right tabular-nums">{g.scoreFor}-{g.scoreAgainst}</span>
              </div>
              <div className="mt-1.5 flex gap-1">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-soft">
                  <div className="h-full rounded-full" style={{ width: `${Math.min((g.scoreFor / 12) * 100, 100)}%`, backgroundColor: g.win ? '#0f7a4f' : '#b6b7ba' }} />
                </div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-soft">
                  <div className="h-full rounded-full" style={{ width: `${Math.min((g.scoreAgainst / 12) * 100, 100)}%`, backgroundColor: '#dcdee1' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface LastFiveGamesTeam {
  abbr: string;
  logoUrl?: string;
  /** Most-recent-first, sliced to the last 5 by the caller. */
  games: RecentResultRow[];
}

export function LastFiveGames({ away, home, loading }: {
  away: LastFiveGamesTeam;
  home: LastFiveGamesTeam;
  loading: boolean;
}) {
  const [mode, setMode] = useState<'form' | 'box'>('form');
  const teams = [away, home];

  return (
    <section className="lb-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-meta font-semibold uppercase tracking-[.18em] text-ink-secondary">Last 5 games</h2>
        <SegmentedToggle
          value={mode}
          onChange={setMode}
          options={[
            { key: 'form', label: 'Form' },
            { key: 'box', label: 'Box score' },
          ]}
        />
      </div>
      {loading ? (
        <div className="space-y-2">
          <div className="h-16 animate-pulse rounded bg-line-soft" />
          <div className="h-16 animate-pulse rounded bg-line-soft" />
        </div>
      ) : mode === 'form' ? (
        <div className="space-y-3">
          {teams.map(({ abbr, logoUrl, games }) => {
            const streak = computeStreak(games);
            return (
              <div key={abbr} className="flex items-center gap-3">
                <div className="w-[130px] shrink-0">
                  <div className="flex items-center gap-1.5">
                    <TeamLogo logoUrl={logoUrl} abbreviation={abbr} size={20} />
                    <span className="text-body font-semibold">{abbr}</span>
                  </div>
                  <div className="mt-0.5 text-title font-medium">{fmtRecord(recordFrom(games))}</div>
                  {streak !== 0 ? <div className="text-meta text-ink-soft">{streak > 0 ? `W${streak}` : `L${-streak}`}</div> : null}
                </div>
                <div className="lb-scroll-x flex flex-1 gap-1.5">
                  {games.length === 0 ? (
                    <span className="self-center text-meta text-ink-faint">No recent results in this window.</span>
                  ) : (
                    games.map((g) => <GameTile key={g.gameId} g={g} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {teams.map(({ abbr, logoUrl, games }) => (
            <BoxScorePanel key={abbr} abbr={abbr} logoUrl={logoUrl} games={games} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

/** `forRanks`/`againstRanks` are pre-formatted ordinal strings ("28th") — this pulls the raw int back out for bucket/position math. */
function parseRank(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function rankHeatStyle(rank: number | null): { bg: string; fg: string } {
  if (rank == null) return { bg: '#f1f2f3', fg: '#b6b7ba' };
  const t = (30 - rank) / 29;
  return { bg: heatFill(t, 0.16), fg: heatInk(t) };
}

/** Elite/Bottom cutoffs scale proportionally with poolSize (8/30 and 22/30 of a 30-team pool) so a 32-team league gets the same top-~27%/bottom-~27% split, not a literal 30-team-sized band. */
function tierFor(rank: number | null, poolSize = 30): { label: string; bg: string; fg: string } | null {
  if (rank == null) return null;
  const t = (poolSize - rank) / (poolSize - 1);
  const eliteCutoff = Math.round((poolSize * 8) / 30);
  const bottomCutoff = Math.round((poolSize * 22) / 30);
  if (rank <= eliteCutoff) return { label: 'Elite', bg: heatFill(t, 0.1), fg: heatInk(t) };
  if (rank <= bottomCutoff) return { label: 'Middle', bg: '#f1f2f3', fg: '#616366' };
  return { label: 'Bottom', bg: heatFill(t, 0.1), fg: heatInk(t) };
}

export function RankingsHeatGrid({
  game,
  statKeys,
  awayAbbr,
  homeAbbr,
  awayLogoUrl,
  homeLogoUrl,
}: {
  game: { away?: RankableTeamStats; home?: RankableTeamStats };
  statKeys: StatKeyDef[];
  awayAbbr: string;
  homeAbbr: string;
  /** Resolved by the caller (each sport builds its own logo URL differently — MLB by numeric team id, NFL by abbreviation) rather than this component assuming one convention. */
  awayLogoUrl?: string;
  homeLogoUrl?: string;
}) {
  return (
    <div className="lb-scroll-x overflow-auto">
      <table className="w-full min-w-[480px] text-dense">
        <thead>
          <tr className="bg-surface-header">
            <th className="px-3 py-2 text-left text-label font-medium uppercase tracking-[.1em] text-ink-faint">Stat</th>
            <th className="border-l border-line-soft px-2 py-2 text-right text-label font-medium uppercase tracking-[.1em] text-ink-secondary">
              <span className="inline-flex items-center justify-end gap-1"><TeamLogo logoUrl={awayLogoUrl} size={12} />{awayAbbr} for</span>
            </th>
            <th className="px-2 py-2 text-right text-label font-medium uppercase tracking-[.1em] text-ink-faint">{awayAbbr} agn</th>
            <th className="border-l border-line-soft px-2 py-2 text-right text-label font-medium uppercase tracking-[.1em] text-ink-secondary">
              <span className="inline-flex items-center justify-end gap-1"><TeamLogo logoUrl={homeLogoUrl} size={12} />{homeAbbr} for</span>
            </th>
            <th className="px-2 py-2 text-right text-label font-medium uppercase tracking-[.1em] text-ink-faint">{homeAbbr} agn</th>
          </tr>
        </thead>
        <tbody>
          {statKeys.map((k) => {
            const cells = [
              parseRank(game.away?.forRanks[k.key]),
              parseRank(game.away?.againstRanks[k.key]),
              parseRank(game.home?.forRanks[k.key]),
              parseRank(game.home?.againstRanks[k.key]),
            ];
            return (
              <tr key={k.key} className="border-t border-line-hair">
                <td className="px-3 py-1 font-sans text-body font-medium text-ink">{k.label}</td>
                {cells.map((rank, i) => {
                  const s = rankHeatStyle(rank);
                  return (
                    <td key={i} className={`px-2 py-1 text-right tabular-nums ${i === 0 || i === 2 ? 'border-l border-line-soft' : ''}`} style={{ backgroundColor: s.bg, color: s.fg }}>
                      {rank ?? '—'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Only stats where both teams actually have a rank plot meaningfully on a shared scale — ER/RBI (often null) would otherwise show as a dot pinned to one edge. */
export function RankingsScale({ game, statKeys, awayAbbr, homeAbbr, poolSize = 30 }: { game: { away?: RankableTeamStats; home?: RankableTeamStats }; statKeys: StatKeyDef[]; awayAbbr: string; homeAbbr: string; /** Size of the ranked pool (30 for MLB, 32 for NFL) — the scale's divisor, so a mid-pack rank still lands visually mid-scale regardless of league size. */ poolSize?: number }) {
  const rows = statKeys
    .map((k) => ({ key: k.key, label: k.label, away: parseRank(game.away?.forRanks[k.key]), home: parseRank(game.home?.forRanks[k.key]) }))
    .filter((r): r is { key: string; label: string; away: number; home: number } => r.away != null && r.home != null);

  const pos = (rank: number) => ((rank - 1) / (poolSize - 1)) * 100;
  const mid = Math.round((poolSize + 1) / 2);

  return (
    <div className="p-4">
      <div className="mb-3 flex justify-between text-micro uppercase tracking-[.1em] text-ink-faint">
        <span>1st</span>
        <span>{ordinal(mid)}</span>
        <span>{ordinal(poolSize)}</span>
      </div>
      <div className="space-y-4">
        {rows.map((r) => {
          const left = Math.min(pos(r.away), pos(r.home));
          const width = Math.abs(pos(r.away) - pos(r.home));
          return (
            <div key={r.key}>
              <div className="mb-1 text-meta font-medium text-ink-secondary">{r.label}</div>
              <div className="relative h-[3px] rounded-full bg-line-soft">
                <div className="absolute top-1/2 h-[5px] -translate-y-1/2 rounded-full bg-line" style={{ left: `${left}%`, width: `${width}%` }} />
                <span
                  className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                  style={{ left: `${pos(r.away)}%`, backgroundColor: '#97989b' }}
                  title={`${awayAbbr} ${ordinal(r.away)}`}
                />
                <span
                  className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                  style={{ left: `${pos(r.home)}%`, backgroundColor: '#0f7a4f' }}
                  title={`${homeAbbr} ${ordinal(r.home)}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RankingsTiers({ game, statKeys, awayAbbr, homeAbbr, poolSize = 30 }: { game: { away?: RankableTeamStats; home?: RankableTeamStats }; statKeys: StatKeyDef[]; awayAbbr: string; homeAbbr: string; poolSize?: number }) {
  const columns = [
    { label: `${awayAbbr} for`, ranks: game.away?.forRanks },
    { label: `${awayAbbr} agn`, ranks: game.away?.againstRanks },
    { label: `${homeAbbr} for`, ranks: game.home?.forRanks },
    { label: `${homeAbbr} agn`, ranks: game.home?.againstRanks },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {columns.map((col) => (
        <div key={col.label} className="rounded-lg border border-line-soft p-3">
          <div className="mb-2 text-label font-semibold uppercase tracking-[.14em] text-ink-faint">{col.label}</div>
          <div className="space-y-1.5">
            {statKeys.map((k) => {
              const rank = parseRank(col.ranks?.[k.key]);
              const tier = tierFor(rank, poolSize);
              return (
                <div key={k.key} className="flex items-center justify-between gap-2 text-meta">
                  <span className="text-ink-muted">{k.label}</span>
                  {tier ? (
                    <span className="rounded-full px-1.5 py-0.5 text-micro font-semibold" style={{ backgroundColor: tier.bg, color: tier.fg }}>
                      {rank}
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Rankings({ data }: { data: RankingsData }) {
  const [view, setView] = useState<'heat' | 'scale' | 'tiers'>('heat');
  const game = { away: data.away, home: data.home };
  return (
    <section className="lb-card overflow-hidden">
      <CardHeader
        right={
          <SegmentedToggle
            value={view}
            onChange={setView}
            options={[
              { key: 'heat', label: 'Heat grid' },
              { key: 'scale', label: 'Rank scale' },
              { key: 'tiers', label: 'Tiers' },
            ]}
          />
        }
      >
        Rankings · of {data.poolSize}
      </CardHeader>
      {view === 'heat' ? <RankingsHeatGrid game={game} statKeys={data.statKeys} awayAbbr={data.awayAbbr} homeAbbr={data.homeAbbr} awayLogoUrl={data.awayLogoUrl} homeLogoUrl={data.homeLogoUrl} /> : null}
      {view === 'scale' ? <RankingsScale game={game} statKeys={data.statKeys} awayAbbr={data.awayAbbr} homeAbbr={data.homeAbbr} poolSize={data.poolSize} /> : null}
      {view === 'tiers' ? <RankingsTiers game={game} statKeys={data.statKeys} awayAbbr={data.awayAbbr} homeAbbr={data.homeAbbr} poolSize={data.poolSize} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Injuries
// ---------------------------------------------------------------------------

/** Darkest/reddest for the longest expected absence, fading toward neutral for day-to-day and anything unrecognized. */
function severityColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('60-day')) return heatInk(0);
  if (s.includes('15-day')) return heatInk(0.3);
  if (s.includes('10-day') || s.includes('7-day')) return '#616366'; // ink-muted — not on the ramp, just a shorter absence
  return '#323335'; // ink-secondary
}

function InjuryPanel({ abbr, logoUrl, rows, subtle }: { abbr: string; logoUrl?: string; rows: InjuryRow[]; subtle?: boolean }) {
  return (
    <div className={subtle ? 'bg-surface-subtle' : ''}>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <TeamLogo logoUrl={logoUrl} abbreviation={abbr} size={22} />
        <span className="text-body font-semibold">{abbr}</span>
        <span className="ml-auto text-meta text-ink-faint">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 pb-3 text-meta text-ink-faint">No reported injuries.</p>
      ) : (
        <div>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-3 border-t border-line-hair px-4 py-2.5">
              <span className="h-[30px] w-[3px] shrink-0 rounded-full" style={{ backgroundColor: severityColor(r.status) }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium">{r.playerName}</div>
                <div className="text-label uppercase tracking-[.1em] text-ink-faint">{r.position || 'P'} · {r.note ?? 'Not reported'}</div>
              </div>
              <span className="shrink-0 text-meta text-ink-muted">{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface InjuriesTeam {
  abbr: string;
  logoUrl?: string;
  rows: InjuryRow[];
}

export function Injuries({ away, home, loading }: { away: InjuriesTeam; home: InjuriesTeam; loading: boolean }) {
  const total = away.rows.length + home.rows.length;

  return (
    <section className="lb-card overflow-hidden">
      <CardHeader right={<span className="text-dense text-ink-soft">{total} player{total === 1 ? '' : 's'} out</span>}>Injuries</CardHeader>
      {loading ? (
        <div className="space-y-2 p-4">
          <div className="h-10 animate-pulse rounded bg-line-soft" />
          <div className="h-10 animate-pulse rounded bg-line-soft" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1px_1fr]">
          <InjuryPanel abbr={away.abbr} logoUrl={away.logoUrl} rows={away.rows} />
          <div className="hidden bg-line-soft sm:block" />
          <InjuryPanel abbr={home.abbr} logoUrl={home.logoUrl} rows={home.rows} subtle />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Right panel — picks
// ---------------------------------------------------------------------------

/**
 * Narrowed `game` shape `PicksPanel` actually needs — same narrowing
 * precedent `RankableTeamStats` established for the Rankings views (above).
 * `sport` replaces what used to be a hardcoded `'mlb'` literal inside
 * `addLeg`; `homeTeamId`/`awayTeamId` are `null` for a sport with no numeric
 * team ids (e.g. NFL) rather than omitted — `gameMarketCandidate` already
 * normalizes an absent value to `null` internally, so this is a faithful,
 * zero-behavior-change generalization. See `docs/sport-adapter-design.md` §1d.
 */
export interface PicksPanelGame {
  id: string;
  sport: Sport;
  awayAbbr: string;
  homeAbbr: string;
  homeTeamId: number | null;
  awayTeamId: number | null;
  /** MLB-only in practice; `null` for a sport with no probability model yet — moneylineEdge/totalEdge and EdgeBadge naturally don't render when this is null. */
  gameModel: MoneylineResult | null;
}

export function PicksPanel({
  game,
  gameCandidateSubjectIds,
  picks,
  onRemovePick,
  onAdd,
  eventContext,
  gameLine,
  disabled,
  propRows,
  userSportsbook,
}: {
  game: PicksPanelGame;
  gameCandidateSubjectIds: Set<string>;
  picks: PickRow[];
  onRemovePick: (id: number) => void;
  onAdd: (candidate: PickCandidate, odds?: { americanOdds: string; source: string }) => void;
  eventContext: string | null;
  gameLine: UnifiedGameLine | null;
  disabled: boolean;
  propRows: PropOddsRow[];
  userSportsbook: string;
}) {
  const { awayAbbr, homeAbbr } = game;
  const scoped = picks.filter(
    (p) => gameCandidateSubjectIds.has(p.subjectId) || p.subjectId.startsWith(`game-${game.id}-`),
  );
  const projected = gameLine ? projectLine(gameLine) : null;
  const moneylineEdge = computeMoneylineEdge(game.gameModel, projected?.moneyline);
  const totalEdge = computeTotalEdge(game.gameModel, projected?.total);

  const addLeg = (
    dimension: string,
    category: string,
    categoryLabel: string,
    subjectName: string,
    price: number | null | undefined,
    meta?: { line?: number | null; side?: 'home' | 'away' | 'over' | 'under' },
  ) => {
    if (price == null || disabled) return;
    onAdd(
      gameMarketCandidate(game.sport, game.id, subjectName, dimension, category, categoryLabel, {
        ...meta,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
      }),
      { americanOdds: String(price), source: 'odds-api' },
    );
  };

  return (
    <aside className="space-y-3">
      <section className="lb-card p-3">
        <h2 className="mb-2 text-meta font-semibold uppercase tracking-wide text-ink-muted">
          My picks ({scoped.length})
        </h2>
        {scoped.length === 0 ? (
          <p className="text-dense text-ink-faint">Nothing on the slip for this game yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {scoped.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-dense">
                <div className="min-w-0 truncate">
                  <span className="font-medium">{p.subjectName}</span>{' '}
                  <MarketLabel sport={game.sport} dimension={p.dimension} category={p.category} mode="compact" />
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <StoredOddsChip
                    odds={p.americanOdds ? { americanOdds: p.americanOdds, source: (p.oddsSource as any) ?? 'manual', capturedAt: p.createdAt } : undefined}
                  />
                  <button type="button" onClick={() => onRemovePick(p.id)} aria-label="Remove pick" className="text-ink-faint hover:text-bad">
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lb-card p-3">
        <h2 className="mb-2 text-meta font-semibold uppercase tracking-wide text-ink-muted">Add to picks</h2>
        {!projected?.available ? (
          <p className="text-dense text-ink-faint">No game line for this matchup yet.</p>
        ) : (
          <div className="space-y-2.5 text-dense">
            {projected.moneyline ? (
              <div>
                <div className="mb-1 flex items-center justify-between text-label uppercase tracking-wide text-ink-faint">
                  <span>Moneyline</span>
                  <BookLogo bookId={projected.moneyline.book} size={12} withLabel />
                </div>
                <div className="flex gap-1.5">
                  <button type="button" disabled={disabled} onClick={() => addLeg('moneyline', awayAbbr, awayAbbr, awayAbbr, projected.moneyline?.away, { side: 'away' })} className="flex-1 rounded-lg border border-line px-2 py-1.5 disabled:opacity-40">
                    <OddsChip price={projected.moneyline.away} source={projected.source} side={awayAbbr} />
                  </button>
                  <button type="button" disabled={disabled} onClick={() => addLeg('moneyline', homeAbbr, homeAbbr, homeAbbr, projected.moneyline?.home, { side: 'home' })} className="flex-1 rounded-lg border border-line px-2 py-1.5 disabled:opacity-40">
                    <OddsChip price={projected.moneyline.home} source={projected.source} side={homeAbbr} />
                  </button>
                </div>
                {moneylineEdge ? (
                  <div className="mt-1 flex gap-1.5">
                    <EdgeBadge edge={moneylineEdge.away} modelProb={moneylineEdge.awayModelProb} marketProb={moneylineEdge.awayMarketProb} label={awayAbbr} />
                    <EdgeBadge edge={moneylineEdge.home} modelProb={moneylineEdge.homeModelProb} marketProb={moneylineEdge.homeMarketProb} label={homeAbbr} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {projected.spread ? (
              <div>
                <div className="mb-1 flex items-center justify-between text-label uppercase tracking-wide text-ink-faint">
                  <span>Spread</span>
                  <BookLogo bookId={projected.spread.book} size={12} withLabel />
                </div>
                <div className="flex gap-1.5">
                  <button type="button" disabled={disabled} onClick={() => addLeg('spread', awayAbbr, `${awayAbbr} ${projected.spread?.awayPoint ?? ''}`, awayAbbr, projected.spread?.awayPrice)} className="flex-1 rounded-lg border border-line px-2 py-1.5 disabled:opacity-40">
                    <OddsChip price={projected.spread.awayPrice} source={projected.source} side={`${awayAbbr} ${projected.spread.awayPoint ?? ''}`} />
                  </button>
                  <button type="button" disabled={disabled} onClick={() => addLeg('spread', homeAbbr, `${homeAbbr} ${projected.spread?.homePoint ?? ''}`, homeAbbr, projected.spread?.homePrice)} className="flex-1 rounded-lg border border-line px-2 py-1.5 disabled:opacity-40">
                    <OddsChip price={projected.spread.homePrice} source={projected.source} side={`${homeAbbr} ${projected.spread.homePoint ?? ''}`} />
                  </button>
                </div>
              </div>
            ) : null}
            {projected.total?.point != null ? (
              <div>
                <div className="mb-1 flex items-center justify-between text-label uppercase tracking-wide text-ink-faint">
                  <span>Total {projected.total.point}</span>
                  <BookLogo bookId={projected.total.book} size={12} withLabel />
                </div>
                <div className="flex gap-1.5">
                  <button type="button" disabled={disabled} onClick={() => addLeg('total', 'over', 'Over', `Total ${projected.total?.point}`, projected.total?.overPrice, { side: 'over', line: projected.total?.point ?? null })} className="flex-1 rounded-lg border border-line px-2 py-1.5 disabled:opacity-40">
                    <OddsChip price={projected.total.overPrice} source={projected.source} side={`O${projected.total.point}`} />
                  </button>
                  <button type="button" disabled={disabled} onClick={() => addLeg('total', 'under', 'Under', `Total ${projected.total?.point}`, projected.total?.underPrice, { side: 'under', line: projected.total?.point ?? null })} className="flex-1 rounded-lg border border-line px-2 py-1.5 disabled:opacity-40">
                    <OddsChip price={projected.total.underPrice} source={projected.source} side={`U${projected.total.point}`} />
                  </button>
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
        )}
      </section>

      <LineShoppingSection projected={projected} awayAbbr={awayAbbr} homeAbbr={homeAbbr} propRows={propRows} userSportsbook={userSportsbook} />
    </aside>
  );
}

/**
 * Game and player-prop line shopping used to be two stacked cards (a
 * BookmakerBreakdown grid inside "Add to picks", a separate "Player props"
 * card below it) — same underlying idea (compare real book prices), so a
 * Game/Player toggle on one card replaces two, rather than widening either.
 */
function LineShoppingSection({
  projected,
  awayAbbr,
  homeAbbr,
  propRows,
  userSportsbook,
}: {
  projected: ReturnType<typeof projectLine> | null;
  awayAbbr: string;
  homeAbbr: string;
  propRows: PropOddsRow[];
  userSportsbook: string;
}) {
  const [view, setView] = useState<'game' | 'player'>('game');

  return (
    <section className="lb-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-meta font-semibold uppercase tracking-wide text-ink-muted">Line shopping</h2>
        <div className="inline-flex rounded-md border border-line p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setView('game')}
            className={`rounded px-2 py-0.5 font-medium ${view === 'game' ? 'bg-accent-soft text-masters' : 'text-ink-faint'}`}
          >
            Game
          </button>
          <button
            type="button"
            onClick={() => setView('player')}
            className={`rounded px-2 py-0.5 font-medium ${view === 'player' ? 'bg-accent-soft text-masters' : 'text-ink-faint'}`}
          >
            Player
          </button>
        </div>
      </div>

      {view === 'game' ? (
        projected?.available ? (
          <BookmakerBreakdown
            bookmakers={projected.bookmakers}
            selectedBook={projected.headlineBook}
            awayLabel={awayAbbr}
            homeLabel={homeAbbr}
          />
        ) : (
          <p className="text-dense text-ink-faint">No game line for this matchup yet.</p>
        )
      ) : (
        <GamePropLineShoppingRail allRows={propRows} userSportsbook={userSportsbook} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The whole page
// ---------------------------------------------------------------------------

export interface GameDetailProps {
  sport: Sport;
  /** MLB: `gamePk` as a string. NFL: the game id already used by its own routes/API. Soccer: same as NFL, ESPN's own event id. */
  gameId: string;
  /** Soccer/tennis-only — which league or tour's game route to call. Required (and unused) for every other sport. */
  league?: SoccerLeague | TennisTour;
  /** Page-filtered player-level candidates for this game — the page still owns snapshot filtering (and, for MLB, the global filter sidebar), same as before this component owned its own data-fetching. */
  candidates: PickCandidate[];
  snapshot: SportSnapshot | null;
  odds: UnifiedLinesResult | null;
  picks: PickRow[];
  pickedKeys: Set<string>;
  onAdd: (candidate: PickCandidate, odds?: { americanOdds: string; source: string }) => void;
  onRemovePick: (id: number) => void;
  selectedPlayerId?: string;
  selectedMarket?: string;
  onSelectCandidate: (subjectId: string | null, dimension?: string) => void;
  eventContext: string | null;
  /**
   * Fires whenever this component's own data-fetching hooks (game context,
   * bullpen, prop odds, calibration, pick history — MLB; the `useNflGameDetail`
   * meta fetch — NFL) settle, not just when the parent's outer snapshot fetch
   * resolves. See `PlayerDetail`'s identically-named prop for why this exists.
   */
  onReadyChange?: (ready: boolean) => void;
}

/**
 * The Matchup section. MLB: a single `PitchingMatchupCard` (today's two
 * starters, no toggle — `data.tabs` is a one-entry list). NFL: a Team/Player
 * toggle. See `GameMatchupData`'s own doc comment for why these stay two
 * different card types instead of one forced shape.
 */
function MatchupSection({
  data,
  matchupTab,
  onMatchupTabChange,
  onMatchupPlayerChange,
}: {
  data: GameDetailData['matchup'];
  matchupTab: string | null;
  onMatchupTabChange: (key: string) => void;
  onMatchupPlayerChange: (id: string) => void;
}) {
  if (!data) return null;
  const activeTab = matchupTab ?? data.tabs[0]?.key ?? null;

  if (data.pitching) {
    return <PitchingMatchupCard game={data.pitching.game} bullpen={data.pitching.bullpen} bullpenLoading={data.pitching.bullpenLoading} />;
  }

  return (
    <section className="lb-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-masters">Matchup</h2>
        <SegmentedToggle value={activeTab ?? ''} onChange={onMatchupTabChange} options={data.tabs.map((t) => ({ key: t.key, label: t.label }))} />
      </div>
      <div className="space-y-3 p-3">
        {activeTab === 'team' ? (
          <>
            {data.teamAway ? <BatterPitcherMatchupCard {...data.teamAway} /> : <p className="p-3 text-center text-[12px] text-ink-muted">No opponent stats available yet.</p>}
            {data.teamHome ? <BatterPitcherMatchupCard {...data.teamHome} /> : null}
          </>
        ) : activeTab === 'player' && data.selectedPlayerCard ? (
          <>
            <select
              value={data.selectedPlayerId ?? ''}
              onChange={(e) => onMatchupPlayerChange(e.target.value)}
              aria-label="Pick a player"
              className="rounded-lg border border-line bg-card px-2 py-1 text-[12px] focus:border-masters focus:outline-none"
            >
              {(data.playerOptions ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <NflPlayerVsDefenseCard {...data.selectedPlayerCard} />
          </>
        ) : (
          <p className="p-3 text-center text-[12px] text-ink-muted">No skill-position players with season stats yet.</p>
        )}
      </div>
    </section>
  );
}

const GRADE_ROWS: Array<{ key: keyof TeamGrades; label: string }> = [
  { key: 'offense', label: 'Offense' },
  { key: 'defense', label: 'Defense' },
  { key: 'specialTeams', label: 'Special teams' },
  { key: 'passingOffense', label: 'Passing offense' },
  { key: 'rushingOffense', label: 'Rushing offense' },
  { key: 'receivingOffense', label: 'Receiving offense' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'linebackers', label: 'Linebackers' },
  { key: 'dLine', label: 'D-line' },
];

/** NFL-only unit-grade table — MLB has no grading model, so `data.unitGrades` is always null there and this section never renders. */
function UnitGradesSection({ data }: { data: NonNullable<GameDetailData['unitGrades']> }) {
  return (
    <section className="lb-card overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Unit grades</h2>
      <div className="overflow-hidden">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="border-b border-line px-2 py-1 text-left font-semibold text-ink-muted">Unit</th>
              <th className="border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">{data.awayAbbr}</th>
              <th className="border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">{data.homeAbbr}</th>
            </tr>
          </thead>
          <tbody>
            {GRADE_ROWS.map((row) => {
              const a = data.away?.[row.key] ?? null;
              const h = data.home?.[row.key] ?? null;
              return (
                <tr key={row.key} className="border-b border-line/50">
                  <td className="px-2 py-1 text-left text-ink-muted">{row.label}</td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">{a ? `${a.grade}` : '—'}</td>
                  <td className="px-2 py-1 text-right font-semibold tabular-nums">{h ? `${h.grade}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** NFL-only flat "every candidate for this game" list — MLB's `LeftRail` already covers this ground, so `data.propsForGame` stays null there. */
function PropsForGameSection({ data, playerHref }: { data: NonNullable<GameDetailData['propsForGame']>; playerHref: (subjectId: string) => string }) {
  return (
    <section className="lb-card overflow-hidden">
      <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
        Props for this game ({data.candidates.length})
      </h2>
      {data.candidates.length === 0 ? (
        <p className="p-6 text-center text-[12px] text-ink-muted">No props tracked for this game yet.</p>
      ) : (
        <ul className="divide-y divide-line/60">
          {data.candidates.map((c) => (
            <li key={candidateKey(c)}>
              <Link href={playerHref(c.subjectId)} className="flex items-center justify-between gap-2 px-3 py-2 text-[12px] hover:bg-surface-subtle">
                <span className="flex min-w-0 items-center gap-2">
                  <SubjectAvatar name={c.subjectName} size={24} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.subjectName}</span>
                    <span className="block truncate text-[10.5px] text-ink-faint">{c.dimensionLabel}</span>
                  </span>
                </span>
                {c.odds ? <OddsChip price={c.odds.americanOdds} source={c.odds.source} capturedAt={c.odds.capturedAt} size="sm" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function GameDetail({
  sport,
  gameId,
  league,
  candidates,
  snapshot,
  odds,
  picks,
  pickedKeys,
  onAdd,
  onRemovePick,
  selectedPlayerId,
  selectedMarket,
  onSelectCandidate,
  eventContext,
  onReadyChange,
}: GameDetailProps) {
  const [matchupTab, setMatchupTab] = useState<string | null>(null);
  const [matchupPlayerId, setMatchupPlayerId] = useState<string | null>(null);

  useEffect(() => {
    setMatchupTab(null);
    setMatchupPlayerId(null);
  }, [gameId]);

  // Every hook below is always called (rules of hooks) — NFL's real data
  // model is three bespoke endpoint calls (`useNflGameDetail`) instead of
  // MLB's own composed hooks over an already-resolved slate game, so both
  // sets run unconditionally and the unused half's queries simply go
  // nowhere, same pattern `TeamDetail.tsx`/`PlayerDetail.tsx` already use.
  const games = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as GameDetailGame[],
    [snapshot],
  );
  const statKeys = useMemo(
    () => ((snapshot?.context?.other as Record<string, unknown> | undefined)?.statKeys ?? []) as StatKeyDef[],
    [snapshot],
  );
  const mlbGame = games.find((g) => String(g.gamePk) === gameId);
  const gameContext = useGameContext(mlbGame?.awayTeamId, mlbGame?.homeTeamId);
  const bullpen = useBullpen(mlbGame?.awayTeamId, mlbGame?.homeTeamId);

  const nflGame = useNflGameDetail(sport === 'nfl' ? gameId : undefined);
  const soccerGame = useSoccerGameDetail(sport === 'soccer' ? (league as SoccerLeague | undefined) : undefined, sport === 'soccer' ? gameId : undefined);
  const cfbGame = useCfbGameDetail(sport === 'cfb' ? gameId : undefined);
  const nbaGame = useNbaGameDetail(sport === 'nba' ? gameId : undefined);
  const nhlGame = useNhlGameDetail(sport === 'nhl' ? gameId : undefined);
  // Real division rank for the Records section (2026-08-24) — always
  // called (rules of hooks), mostly idle for other sports, same convention
  // every other per-sport hook on this page already follows.
  const nbaStandings = useAllNbaTeams(sport === 'nba');
  const nhlStandings = useAllNhlTeams(sport === 'nhl');
  const tennisGame = useTennisGameDetail(sport === 'tennis' ? (league as TennisTour | undefined) : undefined, sport === 'tennis' ? gameId : undefined);
  // The real per-game bookmaker grid, for every sport (odds-architecture
  // rebuild Phase 6) — replaces the old per-sport `mlbGameLine`/
  // `nflGameLine` derivations (each pulling from a different ad hoc
  // live-fetch mechanism, only ever populated for those two sports) with
  // one uniform read from game_odds_book_lines that works the same way
  // for all 7 sports below (golf has no game-detail page).
  const gameOddsBookLine = useGameOddsBookLines(sport, gameId).line;

  const props = usePropOdds(gameId, snapshot?.fetchedAt);
  const calibration = useMarketCalibration(true, sport);
  const pickHistory = useGamePickHistory('mlb');
  const gamePick = useMemo(() => pickHistory.rows.find((r) => r.gameId === gameId) ?? null, [pickHistory.rows, gameId]);

  const data: GameDetailData | null =
    sport === 'nfl'
      ? nflGame.meta
        ? toNflGameDetailData({
            meta: nflGame.meta,
            home: nflGame.home,
            away: nflGame.away,
            gameLine: gameOddsBookLine,
            scope: { matchupPlayerId },
            candidates,
          })
        : null
      : sport === 'soccer'
        ? soccerGame.meta?.game && league
          ? toSoccerGameDetailData({
              league: league as SoccerLeague,
              meta: soccerGame.meta,
              home: soccerGame.home,
              away: soccerGame.away,
              candidates,
              gameLine: gameOddsBookLine,
            })
          : null
        : sport === 'cfb'
          ? cfbGame.meta?.game
            ? toCfbGameDetailData({
                meta: cfbGame.meta,
                home: cfbGame.home,
                away: cfbGame.away,
                candidates,
                gameLine: gameOddsBookLine,
              })
            : null
          : sport === 'nba'
            ? nbaGame.meta?.game
              ? toNbaGameDetailData({
                  meta: nbaGame.meta,
                  home: nbaGame.home,
                  away: nbaGame.away,
                  candidates,
                  standingsTeams: nbaStandings.teams,
                  gameLine: gameOddsBookLine,
                })
              : null
            : sport === 'nhl'
              ? nhlGame.meta?.game
                ? toNhlGameDetailData({
                    meta: nhlGame.meta,
                    home: nhlGame.home,
                    away: nhlGame.away,
                    candidates,
                    standingsTeams: nhlStandings.teams,
                    gameLine: gameOddsBookLine,
                  })
                : null
              : sport === 'tennis'
                ? tennisGame.meta && league
                  ? toTennisGameDetailData({
                      tour: league as TennisTour,
                      meta: tennisGame.meta,
                      player1Recent: tennisGame.player1Recent,
                      player2Recent: tennisGame.player2Recent,
                      player1H2h: tennisGame.player1H2h,
                      player2H2h: tennisGame.player2H2h,
                      candidates,
                      gameLine: gameOddsBookLine,
                    })
                  : null
              : mlbGame
                ? toMlbGameDetailData({
                    game: mlbGame,
                    statKeys,
                    gameContext,
                    bullpen: { byTeam: bullpen.byTeam, loading: bullpen.loading },
                    gameLine: gameOddsBookLine,
                    trustedMarkets: calibration.trustedMarkets,
                    gamePick,
                    pickLoading: calibration.loading,
                    candidates,
                  })
                : null;

  const detailError =
    sport === 'nfl'
      ? nflGame.error
      : sport === 'soccer'
        ? soccerGame.error
        : sport === 'cfb'
          ? cfbGame.error
          : sport === 'nba'
            ? nbaGame.error
            : sport === 'nhl'
              ? nhlGame.error
              : sport === 'tennis'
                ? tennisGame.error
                : null;

  // Combined readiness for `onReadyChange` — must run before any early
  // return below (rules of hooks). `data` itself already gates on the outer
  // game resolving (mlbGame/nflGame.meta); gameContext/bullpen/pickHistory
  // are this component's own sub-fetches that would otherwise pop in after
  // `data` first renders. `props`/`calibration` (usePropOdds/
  // useMarketCalibration) are deliberately EXCLUDED — `calibration.loading`
  // does gate a real skeleton (GameHeroCard's pick-lock panel, via
  // `pickLoading`), but `/api/props/calibration` was measured taking 60+
  // seconds on a cold cache in this codebase (a real, separate performance
  // issue — see the session's own notes), so blocking the entire page on it
  // would be strictly worse than the pre-existing behavior of letting that
  // one panel show its own brief skeleton while the rest of the page is
  // already interactive. An error also counts as "ready" — a stuck loader
  // would be worse than showing the error state below.
  const internalReady =
    Boolean(detailError) ||
    (data !== null &&
      !pickHistory.loading &&
      (sport === 'nfl' || sport === 'soccer' || sport === 'cfb' || sport === 'nba' || sport === 'nhl' || sport === 'tennis'
        ? true
        : !gameContext.loading && !bullpen.loading));
  useEffect(() => {
    onReadyChange?.(internalReady);
  }, [internalReady, onReadyChange]);

  if (detailError) return <div className="lb-card border-bad/30 bg-bad/5 p-3 text-sm text-bad">{detailError}</div>;
  if (!data) {
    return (
      <div className="lb-card overflow-hidden">
        <div className="lb-skel h-24 w-full" />
      </div>
    );
  }

  const isFinal = data.hero.isFinal;
  const selectedCandidates = selectedPlayerId ? candidates.filter((c) => c.subjectId === selectedPlayerId) : [];
  const gameCandidateSubjectIds = new Set(candidates.map((c) => c.subjectId));
  const playerHref = (subjectId: string) => `/${sport}/player/${encodeURIComponent(subjectId)}`;

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr_260px]">
      <LeftRail
        candidates={data.leftRail.candidates}
        selectedPlayerId={selectedPlayerId}
        selectedMarket={selectedMarket}
        onSelectCandidate={onSelectCandidate}
        propRows={props.rows}
        userSportsbook={props.userSportsbook}
        sharedCalibration={calibration}
        goodBetsGated={data.leftRail.goodBetsGated}
        teamScopePanel={
          data.leftRail.nflTeamScope
            ? (railProps) => (
                <NflTeamScopePanel
                  rawTeamCandidates={railProps.rawTeamCandidates}
                  gameLine={data.leftRail.nflTeamScope!.gameLine}
                  homeAbbr={data.leftRail.nflTeamScope!.homeAbbr}
                  onAdd={onAdd}
                  pickedKeys={pickedKeys}
                />
              )
            : undefined
        }
      />

      <div className="min-w-0 space-y-3">
        {selectedCandidates.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => onSelectCandidate(null)}
              className="text-dense font-medium text-masters"
            >
              ← Game summary
            </button>
            <PlayerDetail
              candidates={selectedCandidates}
              snapshot={snapshot}
              odds={odds}
              market={selectedMarket}
              onMarketChange={(next) => onSelectCandidate(selectedPlayerId ?? null, next)}
              onAdd={isFinal ? undefined : (c, odds) => onAdd(c, odds)}
              addedKeys={pickedKeys}
              embedded
              sharedPropOdds={props}
              sharedCalibration={calibration}
            />
          </>
        ) : (
          <>
            <GameHeroCard
              away={{ ...data.hero.away, renderBadges: data.hero.awayGrades ? () => (
                <>
                  <GradeChip label="OFF" grade={data.hero.awayGrades?.offense ?? null} />
                  <GradeChip label="DEF" grade={data.hero.awayGrades?.defense ?? null} />
                  <GradeChip label="ST" grade={data.hero.awayGrades?.specialTeams ?? null} />
                </>
              ) : undefined }}
              home={{ ...data.hero.home, renderBadges: data.hero.homeGrades ? () => (
                <>
                  <GradeChip label="OFF" grade={data.hero.homeGrades?.offense ?? null} />
                  <GradeChip label="DEF" grade={data.hero.homeGrades?.defense ?? null} />
                  <GradeChip label="ST" grade={data.hero.homeGrades?.specialTeams ?? null} />
                </>
              ) : undefined }}
              isLive={data.hero.isLive}
              isFinal={data.hero.isFinal}
              liveScore={data.hero.liveScore}
              livePeriodLabel={data.hero.livePeriodLabel}
              renderLiveExtra={data.hero.liveExtraText ? () => <span className="text-[10px] text-ink-faint">{data.hero.liveExtraText}</span> : undefined}
              startTimeLabel={data.hero.startTimeLabel}
              startTimeCaption={data.hero.startTimeCaption}
              model={data.hero.model}
              pickLockAt={data.hero.pickLockAt}
              pickLoading={data.hero.pickLoading}
              venue={data.hero.venue}
              renderCenterPregameExtra={
                data.hero.pregameLines !== undefined
                  ? () =>
                      data.hero.pregameLines ? (
                        <div className="flex flex-col items-center gap-0.5 text-[10.5px]">
                          {data.hero.pregameLines.moneyline ? (
                            <span className="tabular-nums text-ink-muted">
                              ML {formatAmerican(data.hero.pregameLines.moneyline.away)} / {formatAmerican(data.hero.pregameLines.moneyline.home)}
                            </span>
                          ) : null}
                          {data.hero.pregameLines.spread ? (
                            <span className="tabular-nums text-ink-faint">
                              Spread {data.hero.pregameLines.spread.homePoint != null ? (data.hero.pregameLines.spread.homePoint > 0 ? `+${data.hero.pregameLines.spread.homePoint}` : data.hero.pregameLines.spread.homePoint) : '—'}
                            </span>
                          ) : null}
                          {data.hero.pregameLines.total?.point != null ? <span className="tabular-nums text-ink-faint">O/U {data.hero.pregameLines.total.point}</span> : null}
                        </div>
                      ) : (
                        <span className="text-[10.5px] text-ink-faint">No game line yet</span>
                      )
                  : undefined
              }
              renderLiveDetail={
                data.hero.mlbLiveGame
                  ? (active) => <LiveTab game={data.hero.mlbLiveGame!} gamePk={data.hero.mlbGamePk ?? undefined} active={active} isFinal={isFinal} />
                  : sport === 'nhl'
                    ? (active) => <NhlLiveTab gameId={data.gameId} away={data.hero.away} home={data.hero.home} active={active} isFinal={isFinal} />
                    : sport === 'nba'
                      ? (active) => <NbaLiveTab eventId={data.gameId} away={data.hero.away} home={data.hero.home} active={active} isFinal={isFinal} />
                      : sport === 'soccer'
                        ? (active) => <SoccerLiveTab league={league as string} eventId={data.gameId} away={data.hero.away} home={data.hero.home} active={active} isFinal={isFinal} />
                        : sport === 'nfl' || sport === 'cfb'
                          ? (active) => <FootballLiveTab sport={sport} eventId={data.gameId} away={data.hero.away} home={data.hero.home} active={active} isFinal={isFinal} />
                          : sport === 'tennis'
                            ? (active) => <TennisLiveTab tour={league as string} matchId={data.gameId} away={data.hero.away} home={data.hero.home} active={active} isFinal={isFinal} />
                            : undefined
              }
            />
            <MatchupSection
              data={data.matchup}
              matchupTab={matchupTab}
              onMatchupTabChange={setMatchupTab}
              onMatchupPlayerChange={setMatchupPlayerId}
            />
            <RecordsSection away={data.records.away} home={data.records.home} loading={data.records.loading} />
            {data.statComparison ? <StatComparison data={data.statComparison} /> : null}
            <LastFiveGames away={data.lastFive.away} home={data.lastFive.home} loading={data.lastFive.loading} />
            {data.rankings ? <Rankings data={data.rankings} /> : null}
            {data.unitGrades ? <UnitGradesSection data={data.unitGrades} /> : null}
            <Injuries away={data.injuries.away} home={data.injuries.home} loading={data.injuries.loading} />
            {data.propsForGame ? <PropsForGameSection data={data.propsForGame} playerHref={playerHref} /> : null}
          </>
        )}
      </div>

      <PicksPanel
        game={data.picksPanelGame}
        gameCandidateSubjectIds={gameCandidateSubjectIds}
        picks={picks}
        onRemovePick={onRemovePick}
        onAdd={onAdd}
        eventContext={eventContext}
        gameLine={gameOddsBookLine}
        disabled={isFinal}
        propRows={props.rows}
        userSportsbook={props.userSportsbook}
      />
    </div>
  );
}

export default GameDetail;
