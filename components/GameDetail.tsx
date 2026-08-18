'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PickCandidate, Sport, SportSnapshot } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';
import { sortByComingUp } from '@/lib/core/pickEngine';
import type { SlateGame } from '@/lib/odds/matching';
import { projectLine } from '@/lib/odds/display';
import { computeMoneylineEdge, computeTotalEdge } from '@/lib/odds/gameEdge';
import type { UnifiedLinesResult, UnifiedGameLine } from '@/lib/odds/types';
import type { RecentGameResult } from '@/lib/sports/mlb/statsapi';
import type { GameContextState } from './useGameContext';
import type { PickRow } from './useSlip';
import { SubjectAvatar, TeamLogo } from './SubjectAvatar';
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
import {
  computeRecommendedMoneylinePick,
  computeTotalLean,
  type RecommendedMoneylinePick,
  type TotalLean,
} from '@/lib/odds/recommendedPick';
import { useGamePickHistory, type GamePickView } from './useGamePickRecord';
import type { BullpenState } from './useBullpen';
import { PitchingMatchupCard } from './PitchingMatchupCard';
import { GameHeroCard } from './GameHeroCard';
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

function teamLogoUrl(teamId?: number): string | undefined {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : undefined;
}

function fmtRecord(r: { wins: number; losses: number } | null): string {
  return r ? `${r.wins}-${r.losses}` : '—';
}

function recordFrom(games: RecentGameResult[]): { wins: number; losses: number } | null {
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

interface ScoredCandidate {
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

function LeftRail({
  candidates,
  selectedPlayerId,
  selectedMarket,
  onSelectCandidate,
  propRows,
  userSportsbook,
  sharedCalibration,
}: {
  candidates: PickCandidate[];
  selectedPlayerId?: string;
  selectedMarket?: string;
  onSelectCandidate: (subjectId: string, dimension: string) => void;
  propRows: PropOddsRow[];
  userSportsbook: string;
  /** Reuse GameDetail's own already-fetched calibration instead of this component independently fetching an identical copy — same idiom as PlayerDetail's sharedCalibration. Omitted, LeftRail fetches its own (e.g. if ever mounted outside GameDetail). */
  sharedCalibration?: MarketCalibrationState;
}) {
  const [scope, setScope] = useState<'player' | 'team'>('player');
  const [view, setView] = useState<'grouped' | 'ranked' | 'tiles'>('grouped');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilterKey>('all');
  const [expanded, setExpanded] = useState(false);
  const calibrationFetched = useMarketCalibration(!sharedCalibration);
  const calibration = sharedCalibration ?? calibrationFetched;

  useEffect(() => setExpanded(false), [scope, view, scoreFilter]);

  // Good Bets engine (lib/odds/goodBets.ts) — this panel used to list every
  // candidate for both teams regardless of whether it was actually worth
  // anything; now it only shows ones that clear the same edge/calibration/
  // price-ceiling bar Scan's Good Bets tab does.
  const goodBets = useMemo(
    () =>
      candidates.filter((c) => {
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
      }),
    [candidates, propRows, userSportsbook, calibration.trustedMarkets],
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
          <TeamScopePanel
            rawTeamCandidates={rawTeamCandidates}
            topPlayerPicks={topPlayerPicks}
            onSelectCandidate={onSelectCandidate}
            onGoPlayers={() => setScope('player')}
          />
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

function RecordsSection({
  game,
  awayRecent,
  homeRecent,
  loading,
}: {
  game: GameDetailGame;
  awayRecent?: { recent: RecentGameResult[]; h2h: RecentGameResult[] };
  homeRecent?: { recent: RecentGameResult[]; h2h: RecentGameResult[] };
  loading: boolean;
}) {
  const [tab, setTab] = useState<'season' | 'last5' | 'h2h'>('season');
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());

  const data = useMemo(() => {
    if (tab === 'season') {
      return {
        away: game.away?.record ?? null,
        home: game.home?.record ?? null,
        awayHome: game.away?.homeRecord ?? null,
        awayAway: game.away?.awayRecord ?? null,
        homeHome: game.home?.homeRecord ?? null,
        homeAway: game.home?.awayRecord ?? null,
      };
    }
    const awaySet = tab === 'last5' ? (awayRecent?.recent.slice(0, 5) ?? []) : (awayRecent?.h2h ?? []);
    const homeSet = tab === 'last5' ? (homeRecent?.recent.slice(0, 5) ?? []) : (homeRecent?.h2h ?? []);
    return {
      away: recordFrom(awaySet),
      home: recordFrom(homeSet),
      awayHome: recordFrom(awaySet.filter((g) => g.isHome)),
      awayAway: recordFrom(awaySet.filter((g) => !g.isHome)),
      homeHome: recordFrom(homeSet.filter((g) => g.isHome)),
      homeAway: recordFrom(homeSet.filter((g) => !g.isHome)),
    };
  }, [tab, game, awayRecent, homeRecent]);

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
            abbr={awayAbbr}
            logoUrl={teamLogoUrl(game.awayTeamId)}
            record={data.away}
            standing={tab === 'season' && game.away?.divisionRank ? `${game.away.divisionRank} in division` : null}
            home={data.awayHome}
            away={data.awayAway}
            leading={awayLeads}
            align="left"
          />
          <div className="hidden bg-line-soft sm:block" />
          <RecordPanel
            abbr={homeAbbr}
            logoUrl={teamLogoUrl(game.homeTeamId)}
            record={data.home}
            standing={tab === 'season' && game.home?.divisionRank ? `${game.home.divisionRank} in division` : null}
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

function StatComparison({ game, statKeys }: { game: GameDetailGame; statKeys: StatKeyDef[] }) {
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
  const battingKeys = statKeys.filter((k) => k.decimals !== 3);
  const rateKeys = statKeys.filter((k) => k.decimals === 3);

  const group = (keys: StatKeyDef[], title: string) =>
    keys.length === 0 ? null : (
      <div>
        <div className="mb-1 text-label font-semibold uppercase tracking-[.18em] text-ink-faint">{title}</div>
        {keys.map((k) => (
          <StatComparisonRow key={k.key} label={k.label} away={game.away?.forStats[k.key] ?? null} home={game.home?.forStats[k.key] ?? null} decimals={k.decimals} />
        ))}
      </div>
    );

  return (
    <section className="lb-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-meta font-semibold uppercase tracking-[.18em] text-ink-secondary">Team stat comparison</h2>
        <div className="flex items-center gap-3 text-micro uppercase tracking-wide text-ink-faint">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: '#b6b7ba' }} />{awayAbbr}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-masters" />{homeAbbr}</span>
        </div>
      </div>
      <div className="space-y-3">
        {group(battingKeys, 'Batting')}
        {group(rateKeys, 'Rate')}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Last 5 games
// ---------------------------------------------------------------------------

/** Most recent first; a positive run = current win streak, negative = current losing streak. */
export function computeStreak(games: RecentGameResult[]): number {
  if (games.length === 0) return 0;
  const first = games[0].win;
  let n = 0;
  for (const g of games) {
    if (g.win !== first) break;
    n++;
  }
  return first ? n : -n;
}

function GameTile({ g }: { g: RecentGameResult }) {
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
        <span className="text-emphasis tabular-nums" style={{ color: win ? '#0f7a4f' : '#c23b2c' }}>{g.runsFor}-{g.runsAgainst}</span>
      </div>
      <div className="mt-1 flex items-center justify-center gap-1 text-ink-muted">
        {g.isHome ? 'vs' : '@'} {g.opponentAbbr}
        <span className="text-ink-faint">· {shortDate(g.date)}</span>
      </div>
    </div>
  );
}

function BoxScorePanel({ abbr, teamId, games }: { abbr: string; teamId?: number; games: RecentGameResult[] }) {
  const rec = recordFrom(games);
  return (
    <div className="overflow-hidden rounded-lg border border-line-soft">
      <div className="flex items-center gap-2 bg-surface-header px-3 py-2">
        <TeamLogo logoUrl={teamLogoUrl(teamId)} abbreviation={abbr} size={18} />
        <span className="text-label uppercase tracking-wide text-ink-muted">{fmtRecord(rec)} last five</span>
      </div>
      {games.length === 0 ? (
        <p className="p-3 text-meta text-ink-faint">No recent results in this window.</p>
      ) : (
        <div className="divide-y divide-line-hair">
          {games.map((g) => (
            <div key={g.gamePk} className="px-3 py-2">
              <div className="grid grid-cols-[20px_1fr_54px] items-center gap-2 text-dense">
                <span className="font-semibold" style={{ color: g.win ? '#0f7a4f' : '#c23b2c' }}>{g.win ? 'W' : 'L'}</span>
                <span className="truncate text-ink-muted">
                  {g.isHome ? 'vs' : '@'} {g.opponentAbbr} <span className="text-ink-faint">· {shortDate(g.date)}</span>
                </span>
                <span className="text-right tabular-nums">{g.runsFor}-{g.runsAgainst}</span>
              </div>
              <div className="mt-1.5 flex gap-1">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-soft">
                  <div className="h-full rounded-full" style={{ width: `${Math.min((g.runsFor / 12) * 100, 100)}%`, backgroundColor: g.win ? '#0f7a4f' : '#b6b7ba' }} />
                </div>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-line-soft">
                  <div className="h-full rounded-full" style={{ width: `${Math.min((g.runsAgainst / 12) * 100, 100)}%`, backgroundColor: '#dcdee1' }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LastFiveGames({ game, awayRecent, homeRecent, loading }: {
  game: GameDetailGame;
  awayRecent?: { recent: RecentGameResult[] };
  homeRecent?: { recent: RecentGameResult[] };
  loading: boolean;
}) {
  const [mode, setMode] = useState<'form' | 'box'>('form');
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
  const awayGames = (awayRecent?.recent ?? []).slice(0, 5);
  const homeGames = (homeRecent?.recent ?? []).slice(0, 5);

  const teams = [
    { abbr: awayAbbr, teamId: game.awayTeamId, games: awayGames },
    { abbr: homeAbbr, teamId: game.homeTeamId, games: homeGames },
  ];

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
          {teams.map(({ abbr, teamId, games }) => {
            const streak = computeStreak(games);
            return (
              <div key={abbr} className="flex items-center gap-3">
                <div className="w-[130px] shrink-0">
                  <div className="flex items-center gap-1.5">
                    <TeamLogo logoUrl={teamLogoUrl(teamId)} abbreviation={abbr} size={20} />
                    <span className="text-body font-semibold">{abbr}</span>
                  </div>
                  <div className="mt-0.5 text-title font-medium">{fmtRecord(recordFrom(games))}</div>
                  {streak !== 0 ? <div className="text-meta text-ink-soft">{streak > 0 ? `W${streak}` : `L${-streak}`}</div> : null}
                </div>
                <div className="lb-scroll-x flex flex-1 gap-1.5">
                  {games.length === 0 ? (
                    <span className="self-center text-meta text-ink-faint">No recent results in this window.</span>
                  ) : (
                    games.map((g) => <GameTile key={g.gamePk} g={g} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {teams.map(({ abbr, teamId, games }) => (
            <BoxScorePanel key={abbr} abbr={abbr} teamId={teamId} games={games} />
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

function tierFor(rank: number | null): { label: string; bg: string; fg: string } | null {
  if (rank == null) return null;
  const t = (30 - rank) / 29;
  if (rank <= 8) return { label: 'Elite', bg: heatFill(t, 0.1), fg: heatInk(t) };
  if (rank <= 22) return { label: 'Middle', bg: '#f1f2f3', fg: '#616366' };
  return { label: 'Bottom', bg: heatFill(t, 0.1), fg: heatInk(t) };
}

function RankingsHeatGrid({ game, statKeys, awayAbbr, homeAbbr }: { game: GameDetailGame; statKeys: StatKeyDef[]; awayAbbr: string; homeAbbr: string }) {
  return (
    <div className="lb-scroll-x overflow-auto">
      <table className="w-full min-w-[480px] text-dense">
        <thead>
          <tr className="bg-surface-header">
            <th className="px-3 py-2 text-left text-label font-medium uppercase tracking-[.1em] text-ink-faint">Stat</th>
            <th className="border-l border-line-soft px-2 py-2 text-right text-label font-medium uppercase tracking-[.1em] text-ink-secondary">
              <span className="inline-flex items-center justify-end gap-1"><TeamLogo logoUrl={teamLogoUrl(game.awayTeamId)} size={12} />{awayAbbr} for</span>
            </th>
            <th className="px-2 py-2 text-right text-label font-medium uppercase tracking-[.1em] text-ink-faint">{awayAbbr} agn</th>
            <th className="border-l border-line-soft px-2 py-2 text-right text-label font-medium uppercase tracking-[.1em] text-ink-secondary">
              <span className="inline-flex items-center justify-end gap-1"><TeamLogo logoUrl={teamLogoUrl(game.homeTeamId)} size={12} />{homeAbbr} for</span>
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

/** Only stats where both teams actually have a rank plot meaningfully on a shared 1–30 scale — ER/RBI (often null) would otherwise show as a dot pinned to one edge. */
function RankingsScale({ game, statKeys, awayAbbr, homeAbbr }: { game: GameDetailGame; statKeys: StatKeyDef[]; awayAbbr: string; homeAbbr: string }) {
  const rows = statKeys
    .map((k) => ({ key: k.key, label: k.label, away: parseRank(game.away?.forRanks[k.key]), home: parseRank(game.home?.forRanks[k.key]) }))
    .filter((r): r is { key: string; label: string; away: number; home: number } => r.away != null && r.home != null);

  const pos = (rank: number) => ((rank - 1) / 29) * 100;

  return (
    <div className="p-4">
      <div className="mb-3 flex justify-between text-micro uppercase tracking-[.1em] text-ink-faint">
        <span>1st</span>
        <span>15th</span>
        <span>30th</span>
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

function RankingsTiers({ game, statKeys, awayAbbr, homeAbbr }: { game: GameDetailGame; statKeys: StatKeyDef[]; awayAbbr: string; homeAbbr: string }) {
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
              const tier = tierFor(rank);
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

function Rankings({ game, statKeys }: { game: GameDetailGame; statKeys: StatKeyDef[] }) {
  const [view, setView] = useState<'heat' | 'scale' | 'tiers'>('heat');
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
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
        Rankings · of 30
      </CardHeader>
      {view === 'heat' ? <RankingsHeatGrid game={game} statKeys={statKeys} awayAbbr={awayAbbr} homeAbbr={homeAbbr} /> : null}
      {view === 'scale' ? <RankingsScale game={game} statKeys={statKeys} awayAbbr={awayAbbr} homeAbbr={homeAbbr} /> : null}
      {view === 'tiers' ? <RankingsTiers game={game} statKeys={statKeys} awayAbbr={awayAbbr} homeAbbr={homeAbbr} /> : null}
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

function InjuryPanel({ abbr, teamId, rows, subtle }: { abbr: string; teamId?: number; rows: import('@/lib/sports/mlb/statsapi').InjuryEntry[]; subtle?: boolean }) {
  return (
    <div className={subtle ? 'bg-surface-subtle' : ''}>
      <div className="flex items-center gap-2 px-4 py-2.5">
        <TeamLogo logoUrl={teamLogoUrl(teamId)} abbreviation={abbr} size={22} />
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
                <div className="text-label uppercase tracking-[.1em] text-ink-faint">{r.position || 'P'} · {r.injury ?? 'Not reported'}</div>
              </div>
              <span className="shrink-0 text-meta text-ink-muted">{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Injuries({ game, gameContext }: { game: GameDetailGame; gameContext: GameContextState }) {
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
  const awayInjuries = (game.awayTeamId ? gameContext.injuries[game.awayTeamId] : undefined) ?? [];
  const homeInjuries = (game.homeTeamId ? gameContext.injuries[game.homeTeamId] : undefined) ?? [];
  const total = awayInjuries.length + homeInjuries.length;

  return (
    <section className="lb-card overflow-hidden">
      <CardHeader right={<span className="text-dense text-ink-soft">{total} player{total === 1 ? '' : 's'} out</span>}>Injuries</CardHeader>
      {gameContext.loading ? (
        <div className="space-y-2 p-4">
          <div className="h-10 animate-pulse rounded bg-line-soft" />
          <div className="h-10 animate-pulse rounded bg-line-soft" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1px_1fr]">
          <InjuryPanel abbr={awayAbbr} teamId={game.awayTeamId} rows={awayInjuries} />
          <div className="hidden bg-line-soft sm:block" />
          <InjuryPanel abbr={homeAbbr} teamId={game.homeTeamId} rows={homeInjuries} subtle />
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Right panel — picks
// ---------------------------------------------------------------------------

function PicksPanel({
  game,
  gameCandidateSubjectIds,
  picks,
  onRemovePick,
  onAdd,
  eventContext,
  gameLine,
  disabled,
}: {
  game: GameDetailGame;
  gameCandidateSubjectIds: Set<string>;
  picks: PickRow[];
  onRemovePick: (id: number) => void;
  onAdd: (candidate: PickCandidate, odds?: { americanOdds: string; source: string }) => void;
  eventContext: string | null;
  gameLine: UnifiedGameLine | null;
  disabled: boolean;
}) {
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
  const scoped = picks.filter(
    (p) => gameCandidateSubjectIds.has(p.subjectId) || p.subjectId.startsWith(`game-${game.gamePk}-`),
  );
  const projected = gameLine ? projectLine(gameLine) : null;
  const gameModel = game.gameModel ?? null;
  const moneylineEdge = computeMoneylineEdge(gameModel, projected?.moneyline);
  const totalEdge = computeTotalEdge(gameModel, projected?.total);

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
      gameMarketCandidate('mlb', game.gamePk ?? 'unknown', subjectName, dimension, category, categoryLabel, {
        ...meta,
        homeTeamId: game.homeTeamId ?? null,
        awayTeamId: game.awayTeamId ?? null,
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
                  <MarketLabel sport="mlb" dimension={p.dimension} category={p.category} mode="compact" />
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
    </aside>
  );
}

// ---------------------------------------------------------------------------
// The whole page
// ---------------------------------------------------------------------------

export interface GameDetailProps {
  game: GameDetailGame;
  statKeys: StatKeyDef[];
  candidates: PickCandidate[];
  allCandidates: PickCandidate[];
  snapshot: SportSnapshot | null;
  odds: UnifiedLinesResult | null;
  gameLine: UnifiedGameLine | null;
  gameContext: GameContextState;
  bullpen: BullpenState;
  picks: PickRow[];
  pickedKeys: Set<string>;
  onAdd: (candidate: PickCandidate, odds?: { americanOdds: string; source: string }) => void;
  onRemovePick: (id: number) => void;
  selectedPlayerId?: string;
  selectedMarket?: string;
  onSelectCandidate: (subjectId: string | null, dimension?: string) => void;
  eventContext: string | null;
}

export function GameDetail({
  game,
  statKeys,
  candidates,
  allCandidates,
  snapshot,
  odds,
  gameLine,
  gameContext,
  bullpen,
  picks,
  pickedKeys,
  onAdd,
  onRemovePick,
  selectedPlayerId,
  selectedMarket,
  onSelectCandidate,
  eventContext,
}: GameDetailProps) {
  const isLive = /live|in progress/i.test(game.state ?? '');
  const isFinal = /final/i.test(game.state ?? '');

  const gameIdStr = game.gamePk != null ? String(game.gamePk) : undefined;
  const props = usePropOdds(gameIdStr, snapshot?.fetchedAt);

  const selectedCandidates = useMemo(
    () => (selectedPlayerId ? candidates.filter((c) => c.subjectId === selectedPlayerId) : []),
    [candidates, selectedPlayerId],
  );

  const gameCandidateSubjectIds = useMemo(() => new Set(candidates.map((c) => c.subjectId)), [candidates]);

  const awayRecent = game.awayTeamId != null ? gameContext.recent[game.awayTeamId] : undefined;
  const homeRecent = game.homeTeamId != null ? gameContext.recent[game.homeTeamId] : undefined;

  // P1-7 — Recommended Pick badge, computed once here rather than inside
  // GameHeroCard so it uses the exact same gameLine every other odds display
  // on this page reads from.
  const matchupProjected = gameLine ? projectLine(gameLine) : null;
  const calibration = useMarketCalibration();
  const recommendedPick = computeRecommendedMoneylinePick(game.gameModel, matchupProjected?.moneyline, calibration.trustedMarkets);
  const totalLean = computeTotalLean(game.gameModel, matchupProjected?.total);

  const pickHistory = useGamePickHistory('mlb');
  const gamePick = useMemo(
    () => pickHistory.rows.find((r) => r.gameId === gameIdStr) ?? null,
    [pickHistory.rows, gameIdStr],
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[280px_1fr_260px]">
      <LeftRail
        candidates={candidates}
        selectedPlayerId={selectedPlayerId}
        selectedMarket={selectedMarket}
        onSelectCandidate={onSelectCandidate}
        propRows={props.rows}
        userSportsbook={props.userSportsbook}
        sharedCalibration={calibration}
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
              game={game}
              isLive={isLive}
              isFinal={isFinal}
              liveScore={game.liveScore}
              awayRecent={awayRecent}
              homeRecent={homeRecent}
              recommendedPick={recommendedPick}
              totalLean={totalLean}
              gamePick={gamePick}
              pickLoading={calibration.loading}
            />
            <PitchingMatchupCard game={game} bullpen={bullpen.byTeam} bullpenLoading={bullpen.loading} />
            <RecordsSection game={game} awayRecent={awayRecent} homeRecent={homeRecent} loading={gameContext.loading} />
            <StatComparison game={game} statKeys={statKeys} />
            <LastFiveGames game={game} awayRecent={awayRecent} homeRecent={homeRecent} loading={gameContext.loading} />
            <Rankings game={game} statKeys={statKeys} />
            <Injuries game={game} gameContext={gameContext} />
          </>
        )}
      </div>

      <PicksPanel
        game={game}
        gameCandidateSubjectIds={gameCandidateSubjectIds}
        picks={picks}
        onRemovePick={onRemovePick}
        onAdd={onAdd}
        eventContext={eventContext}
        gameLine={gameLine}
        disabled={isFinal}
      />
    </div>
  );
}

export default GameDetail;
