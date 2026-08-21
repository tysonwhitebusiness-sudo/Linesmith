'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SubjectAvatar, TeamLogo, mlbHeadshotUrl, mlbTeamLogoUrl } from '@/components/SubjectAvatar';
import { ConfidenceChip } from '@/components/ConfidenceChip';
import { LockIcon, ClockIcon } from '@/components/icons';
import { formatAmerican, americanToDecimal } from '@/lib/odds/display';

interface OddsApiLine {
  eventId: string;
  matchup: string;
  commenceTime: string;
  moneyline: { home?: number; away?: number; book?: string } | null;
  total: number | null;
  bookCount: number;
}

interface HarvesterBookmaker {
  name: string;
  homeOdds: number | null;
  awayOdds: number | null;
  totalPoint: number | null;
  overPrice: number | null;
  underPrice: number | null;
}

interface HarvesterLine {
  matchUrl: string;
  matchup: string;
  matchDate: string;
  bookmakers: HarvesterBookmaker[];
  livePeriod: string | null;
  liveScore: { home: string; away: string } | null;
}

interface MergedLine {
  eventId: string;
  matchup: string;
  source: string;
  moneyline: { home?: number; away?: number; book?: string } | null;
  total: number | null;
  bookCount: number;
  bookmakers: Array<{ name: string; homeOdds: number | null; awayOdds: number | null }>;
  hasLiveData: boolean;
}

interface DiagnosticsData {
  timestamp: string;
  oddsApi: {
    enabled: boolean;
    status: string;
    linesReturned: number;
    fetchedAt: string | null;
    fromCache: boolean;
    nextRefreshAt: string | null;
    requestsRemaining: number | null;
    requestsUsed: number | null;
    warnings: string[];
    cache: {
      fetchedAt: string;
      requestsRemaining: number | null;
      requestsUsed: number | null;
      payloadBytes: number;
    } | null;
    lines: OddsApiLine[];
  };
  oddsHarvester: {
    live: {
      filename: string;
      exists: boolean;
      sizeBytes: number | null;
      modifiedAt: string | null;
      matchCount: number | null;
      error: string | null;
    };
    upcoming: {
      filename: string;
      exists: boolean;
      sizeBytes: number | null;
      modifiedAt: string | null;
      matchCount: number | null;
      error: string | null;
    };
    lines: HarvesterLine[];
  };
  merged: {
    totalLines: number;
    bySource: Record<string, number>;
    withLiveData: number;
    lines: MergedLine[];
  };
  env: {
    oddsApiKeyConfigured: boolean;
    oddsApiTtlMinutes: number;
    oddsApiReserve: number;
    nodeEnv: string;
  };
}

interface PropsProviderMeta {
  id: string;
  label: string;
  /** Renamed from 'tier' 2026-08-20 — see lib/odds/props/types.ts's ProviderMeta.scheduled doc. */
  scheduled: boolean;
  enabled: boolean;
  delaySeconds: number | null;
  books: string[];
}

interface PropsBudget {
  used: number;
  limit: number;
  remaining: number;
  softCap: number | null;
  exhausted: boolean;
  overSoftCap: boolean;
}

interface UnresolvedRow {
  id: number;
  providerId: string;
  kind: string;
  rawValue: string;
  context: string | null;
  seenAt: string;
}

interface PropsDiagnosticsData {
  userSportsbook: string;
  providers: PropsProviderMeta[];
  budgets: Record<string, PropsBudget>;
  unresolved: UnresolvedRow[];
}

interface RankedPitcherRow {
  personId: number;
  fullName: string;
  role: 'starter' | 'closer' | 'reliever';
  values: Partial<Record<string, number>>;
  ranks: Partial<Record<string, number>>;
  poolSize: number;
  composite: number | null;
  overallRank: number | null;
  raw: {
    teamId?: number;
    gamesStarted: number;
    gamesPitched: number;
    gamesFinished: number;
    inningsPitched?: number;
    saves: number;
    saveOpportunities: number;
    holds: number;
    blownSaves: number;
  };
}

interface PitcherRoleRankingsResponse {
  season: number;
  computedAt: string;
  starters: RankedPitcherRow[];
  closers: RankedPitcherRow[];
  relievers: RankedPitcherRow[];
}

interface RankedBatterRow {
  personId: number;
  fullName: string;
  teamId?: number;
  position: string;
  values: Partial<Record<string, number>>;
  overallRanks: Partial<Record<string, number>>;
  positionRanks: Partial<Record<string, number>>;
  poolSize: number;
  positionPoolSize: number;
  composite: number | null;
  overallRank: number | null;
  positionComposite: number | null;
  positionRank: number | null;
}

interface BatterRankingsResponse {
  season: number;
  computedAt: string;
  batters: RankedBatterRow[];
}

interface CalibrationCounts {
  totalRows: number;
  gradedRows: number;
  ungradedRows: number;
  backfillRows: number;
  liveRows: number;
  withModelProb: number;
}

interface CalibrationBucket {
  bucket: number;
  n: number;
  wins: number;
}

interface MarketCalibration {
  dimension: string;
  n: number;
  wins: number;
  brierScore: number | null;
}

interface CalibrationData {
  counts: CalibrationCounts;
  buckets: CalibrationBucket[];
  byMarket: MarketCalibration[];
  overallBrierScore: number | null;
}

// ---------------------------------------------------------------------------
// Model Health — version history, feature weights, drift check, Elo sanity
// ---------------------------------------------------------------------------

interface ModelWeightsRow {
  id: number;
  sport: string;
  market: string;
  version: number;
  featureNames: string[];
  weights: number[];
  intercept: number;
  trainGames: number;
  trainBrier: number;
  holdoutGames: number;
  holdoutBrier: number;
  baselineHoldoutBrier: number | null;
  active: boolean;
  fittedAt: string;
  /** Null on fits produced before this was tracked. */
  trainSeasons: number[] | null;
  holdoutSeasons: number[] | null;
}

interface FeatureExplanation {
  name: string;
  displayName: string;
  weight: number;
  practicalContribution: number;
  label: 'dominant' | 'meaningful' | 'minor' | 'negligible';
  note?: string;
}

interface ModelVersionsResponse {
  moneyline: ModelWeightsRow[];
  total: ModelWeightsRow[];
  /** Home Run model plan — market = 'home-run' in the DB, camelCased here like every other JSON key in this response. */
  homeRun: ModelWeightsRow[];
  explanations: {
    moneyline: FeatureExplanation[] | null;
    total: FeatureExplanation[] | null;
    homeRun: FeatureExplanation[] | null;
  };
}

interface DriftResult {
  market: 'moneyline' | 'total';
  activeVersion: number | null;
  expectedBrier: number | null;
  liveBrier: number | null;
  liveGames: number;
  status: 'on-track' | 'underperforming' | 'insufficient-sample' | 'no-active-model';
}

interface DriftCheckResponse {
  rollingWindow: number;
  minSample: number;
  moneyline: DriftResult;
  total: DriftResult;
}

interface EloTeamRating {
  teamId: number;
  name: string;
  abbreviation: string;
  elo: number;
  gamesPlayed: number;
}

interface EloSanityResponse {
  season: number;
  teams: EloTeamRating[];
}

interface TotalBaselinesResult {
  holdoutGames: number;
  formulaBrier: number;
  marketOnlyBrier: number;
  marketOnlyGames: number;
  preFittedBlendBrier: number;
  fittedBrier: number;
}

// ---------------------------------------------------------------------------
// Data Sources & System
// ---------------------------------------------------------------------------

interface TableRowCount {
  table: string;
  rows: number;
}

interface EloCoverageRow {
  season: number;
  teams: number;
  rows: number;
}

interface ParkFactorCoverageRow {
  season: number;
  venues: number;
  computedAt: string | null;
}

interface HistoricalOddsCoverageRow {
  season: number;
  games: number;
  source: string;
}

interface DataAccumulationRow {
  table: string;
  label: string;
  rows: number;
  earliest: string | null;
  latest: string | null;
  last24h: number;
  last7d: number;
}

interface StatsApiError {
  url: string;
  reason: string;
  at: string;
}

interface SystemEventRow {
  id: number;
  level: 'error' | 'warning';
  source: string;
  message: string;
  detail: string | null;
  occurredAt: string;
}

interface GolfCalibrationSummary {
  holeRound: { total: number; graded: number; ungraded: number; hitRate: number | null; meanBrier: number | null };
  tournament: {
    total: number;
    graded: number;
    ungraded: number;
    winBrier: number | null;
    top5Brier: number | null;
    top10Brier: number | null;
    madeCutBrier: number | null;
  };
}

interface SystemHealthResponse {
  tables: TableRowCount[];
  dataAccumulation: DataAccumulationRow[];
  elo: EloCoverageRow[];
  parkFactors: ParkFactorCoverageRow[];
  historicalOdds: HistoricalOddsCoverageRow[];
  statsApiErrors: StatsApiError[];
  recentEvents: SystemEventRow[];
  golfCalibration: GolfCalibrationSummary;
}

// ---------------------------------------------------------------------------
// Linesmith Pick lock system — pick history table
// ---------------------------------------------------------------------------

interface ConfidenceGrade {
  letter: string;
  pct: number;
}

interface StakeSuggestion {
  pointStake: number;
  conservativeStake: number | null;
}

interface MoneylinePickView {
  pickSide: 'home' | 'away' | null;
  pickTeamName: string | null;
  price: number | null;
  confidence: ConfidenceGrade | null;
  probLower: number | null;
  probUpper: number | null;
  stake: StakeSuggestion | null;
  locked: boolean;
  late: boolean;
  changed: boolean;
  initialTeamName: string | null;
  outcome: 'win' | 'loss' | null;
}

interface TotalPickView {
  pickSide: 'over' | 'under' | null;
  line: number | null;
  price: number | null;
  confidence: ConfidenceGrade | null;
  probLower: number | null;
  probUpper: number | null;
  stake: StakeSuggestion | null;
  locked: boolean;
  late: boolean;
  changed: boolean;
  initialSide: 'over' | 'under' | null;
  initialLine: number | null;
  outcome: 'win' | 'loss' | null;
}

interface GamePickView {
  gameId: string;
  matchup: string | null;
  awayTeamId: number | null;
  homeTeamId: number | null;
  awayTeamName: string | null;
  homeTeamName: string | null;
  commenceTime: string | null;
  finalScore: { home: number; away: number } | null;
  moneyline: MoneylinePickView;
  total: TotalPickView;
}

function teamLogoUrl(teamId: number | null): string | undefined {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : undefined;
}

interface GamePickHistoryResponse {
  record: { moneyline: { wins: number; losses: number }; total: { wins: number; losses: number } };
  rows: GamePickView[];
}

function pickDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function pickTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Green when the pick is graded a win, red when a loss, neutral otherwise (ungraded/pushed/no pick). */
function outcomeClass(outcome: 'win' | 'loss' | null): string {
  if (outcome === 'win') return 'bg-good/15 text-good border border-good/30';
  if (outcome === 'loss') return 'bg-bad/10 text-bad border border-bad/30';
  return 'bg-ink/5 text-ink-muted border border-line';
}

/** "Locked" once past the 3-hour mark; otherwise says plainly when it will, instead of the bare word "provisional". */
function LockStatus({ locked, late, commenceTime }: { locked: boolean; late: boolean; commenceTime: string | null }) {
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1">
        <LockIcon size={9} /> Locked{late ? ' (late)' : ''}
      </span>
    );
  }
  const t = commenceTime ? Date.parse(commenceTime) : NaN;
  const lockAt = Number.isFinite(t) ? new Date(t - 3 * 60 * 60 * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <span className="inline-flex items-center gap-1" title="This lean can still move until it locks 3 hours before first pitch.">
      <ClockIcon size={9} /> {lockAt ? `Locks at ${lockAt}` : 'Not yet locked'}
      {late ? ' (late read)' : ''}
    </span>
  );
}

function GamePickHistoryTable({ rows }: { rows: GamePickView[] }) {
  if (rows.length === 0) {
    return <p className="text-[12px] text-ink-faint">No games have gone through the pick lock system yet.</p>;
  }
  return (
    <div className="max-h-[520px] overflow-y-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="sticky top-0 bg-paper text-left text-ink-faint">
            <th className="py-1.5 pr-2">Matchup</th>
            <th className="py-1.5 pr-2">Date</th>
            <th className="py-1.5 pr-2">Start</th>
            <th className="py-1.5 pr-2">Score</th>
            <th className="py-1.5 pr-2">Moneyline pick</th>
            <th className="py-1.5">O/U pick</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.gameId} className="border-b border-line/50 align-top">
              <td className="py-1.5 pr-2 font-medium">
                <div className="flex items-center gap-1.5">
                  <TeamLogo logoUrl={teamLogoUrl(r.awayTeamId)} size={16} />
                  {r.awayTeamName ?? '?'}
                  <span className="text-ink-faint">@</span>
                  <TeamLogo logoUrl={teamLogoUrl(r.homeTeamId)} size={16} />
                  {r.homeTeamName ?? '?'}
                </div>
              </td>
              <td className="py-1.5 pr-2 text-ink-muted">{pickDate(r.commenceTime)}</td>
              <td className="py-1.5 pr-2 text-ink-muted">{pickTime(r.commenceTime)}</td>
              <td className="py-1.5 pr-2 tabular-nums">
                {r.finalScore ? `${r.finalScore.away}-${r.finalScore.home}` : '—'}
              </td>
              <td className="py-1.5 pr-2">
                {r.moneyline.pickTeamName ? (
                  <div className={`inline-flex flex-col gap-1 rounded-md px-1.5 py-1.5 ${outcomeClass(r.moneyline.outcome)}`}>
                    <span className="font-semibold">
                      {r.moneyline.pickTeamName}
                      {r.moneyline.price != null ? (
                        <span className="ml-1 font-normal opacity-80 tabular-nums">{formatAmerican(r.moneyline.price)}</span>
                      ) : null}
                    </span>
                    <div className="flex flex-wrap items-center gap-1 text-[10px] opacity-90">
                      {r.moneyline.confidence ? <ConfidenceChip letter={r.moneyline.confidence.letter} pct={r.moneyline.confidence.pct} size="sm" /> : null}
                      <LockStatus locked={r.moneyline.locked} late={r.moneyline.late} commenceTime={r.commenceTime} />
                      {r.moneyline.changed ? (
                        <span
                          className="lb-chip bg-warn/15 text-warn"
                          title={`Changed from the 6am pick: ${r.moneyline.initialTeamName ?? '—'}`}
                        >
                          ↺ changed
                        </span>
                      ) : null}
                    </div>
                    {r.moneyline.probLower != null || r.moneyline.stake ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
                        {r.moneyline.probLower != null && r.moneyline.probUpper != null ? (
                          <span title={`90% confidence interval: ${(r.moneyline.probLower * 100).toFixed(0)}%–${(r.moneyline.probUpper * 100).toFixed(0)}%`}>
                            ±{Math.round(((r.moneyline.probUpper - r.moneyline.probLower) / 2) * 100)}%
                          </span>
                        ) : null}
                        {r.moneyline.stake ? (
                          <span
                            title={
                              r.moneyline.stake.conservativeStake != null
                                ? 'Half-Kelly stake, sized off the confidence interval’s lower bound'
                                : 'Half-Kelly stake off the point-probability estimate (no confidence interval available)'
                            }
                          >
                            stake {((r.moneyline.stake.conservativeStake ?? r.moneyline.stake.pointStake) * 100).toFixed(1)}%
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </td>
              <td className="py-1.5">
                {r.total.pickSide ? (
                  <div className={`inline-flex flex-col gap-1 rounded-md px-1.5 py-1.5 ${outcomeClass(r.total.outcome)}`}>
                    <span className="font-semibold">
                      {r.total.pickSide === 'over' ? 'Over' : 'Under'} {r.total.line ?? ''}
                      {r.total.price != null ? (
                        <span className="ml-1 font-normal opacity-80 tabular-nums">{formatAmerican(r.total.price)}</span>
                      ) : null}
                    </span>
                    <div className="flex flex-wrap items-center gap-1 text-[10px] opacity-90">
                      {r.total.confidence ? <ConfidenceChip letter={r.total.confidence.letter} pct={r.total.confidence.pct} size="sm" /> : null}
                      <LockStatus locked={r.total.locked} late={r.total.late} commenceTime={r.commenceTime} />
                      {r.total.changed ? (
                        <span
                          className="lb-chip bg-warn/15 text-warn"
                          title={`Changed from the 6am pick: ${r.total.initialSide === 'over' ? 'Over' : 'Under'} ${r.total.initialLine ?? ''}`}
                        >
                          ↺ changed
                        </span>
                      ) : null}
                    </div>
                    {r.total.probLower != null || r.total.stake ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
                        {r.total.probLower != null && r.total.probUpper != null ? (
                          <span title={`90% confidence interval: ${(r.total.probLower * 100).toFixed(0)}%–${(r.total.probUpper * 100).toFixed(0)}%`}>
                            ±{Math.round(((r.total.probUpper - r.total.probLower) / 2) * 100)}%
                          </span>
                        ) : null}
                        {r.total.stake ? (
                          <span
                            title={
                              r.total.stake.conservativeStake != null
                                ? 'Half-Kelly stake, sized off the confidence interval’s lower bound'
                                : 'Half-Kelly stake off the point-probability estimate (no confidence interval available)'
                            }
                          >
                            stake {((r.total.stake.conservativeStake ?? r.total.stake.pointStake) * 100).toFixed(1)}%
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-ink-faint">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pick record analysis — confidence-tier breakdown, Kelly ROI, rolling trend.
// All computed client-side from the rows the page already fetched; no new
// backend endpoint needed for any of these three.
// ---------------------------------------------------------------------------

const CONFIDENCE_TIERS = ['A+', 'A', 'B+', 'B', 'C+', 'C'] as const;

interface TierStat {
  tier: string;
  n: number;
  wins: number;
}

/** Does "A+" actually win more than "C+"? A direct check the reliability diagram doesn't give you, since that's bucketed on raw probability, not the picked side's own letter grade. */
function confidenceTierBreakdown(rows: GamePickView[], market: 'moneyline' | 'total'): TierStat[] {
  const counts = new Map<string, TierStat>(CONFIDENCE_TIERS.map((t) => [t, { tier: t, n: 0, wins: 0 }]));
  for (const r of rows) {
    const pick = market === 'moneyline' ? r.moneyline : r.total;
    if (!pick.confidence || pick.outcome == null) continue;
    const bucket = counts.get(pick.confidence.letter);
    if (!bucket) continue;
    bucket.n += 1;
    if (pick.outcome === 'win') bucket.wins += 1;
  }
  return CONFIDENCE_TIERS.map((t) => counts.get(t)!).filter((t) => t.n > 0);
}

interface KellyRoiSummary {
  /** Net change in bankroll, as a fraction of a hypothetical starting bankroll of 1.0 — e.g. 0.15 means +15%. */
  netUnits: number;
  bets: number;
}

/** "If you'd staked the suggested half-Kelly fraction on every locked, graded pick, where would bankroll be" — turns the Kelly work from Phase 0 into something visible instead of a number buried in a tooltip. Sizes off the conservative (CI lower-bound) stake when available, matching what the tooltip already tells the user to actually act on. */
function kellyRoiSummary(rows: GamePickView[], market: 'moneyline' | 'total'): KellyRoiSummary {
  let netUnits = 0;
  let bets = 0;
  for (const r of rows) {
    const pick = market === 'moneyline' ? r.moneyline : r.total;
    if (!pick.stake || pick.price == null || pick.outcome == null) continue;
    const fraction = pick.stake.conservativeStake ?? pick.stake.pointStake;
    if (fraction <= 0) continue;
    const decimal = americanToDecimal(pick.price);
    if (decimal == null) continue;
    bets += 1;
    netUnits += pick.outcome === 'win' ? fraction * (decimal - 1) : -fraction;
  }
  return { netUnits, bets };
}

/** Win rate over the most recent N graded picks (by commence time) — a plain rolling trend, not a full chart, but enough to see if recent form is drifting from the season-long record. */
function recentWinRate(rows: GamePickView[], market: 'moneyline' | 'total', window: number): { wins: number; n: number } {
  const graded = rows
    .filter((r) => r.commenceTime && (market === 'moneyline' ? r.moneyline : r.total).outcome != null)
    .sort((a, b) => (b.commenceTime! > a.commenceTime! ? 1 : -1))
    .slice(0, window);
  const wins = graded.filter((r) => (market === 'moneyline' ? r.moneyline : r.total).outcome === 'win').length;
  return { wins, n: graded.length };
}

function PickRecordAnalysis({ rows }: { rows: GamePickView[] }) {
  const markets = ['moneyline', 'total'] as const;
  return (
    <div className="mt-4 grid gap-4 border-t border-line pt-3 sm:grid-cols-2">
      {markets.map((market) => {
        const tiers = confidenceTierBreakdown(rows, market);
        const roi = kellyRoiSummary(rows, market);
        const trend = recentWinRate(rows, market, 10);
        return (
          <div key={market}>
            <h3 className="mb-2 text-[12px] font-semibold text-ink-muted">{market === 'moneyline' ? 'Moneyline' : 'Total (O/U)'}</h3>

            {tiers.length === 0 ? (
              <p className="text-[11px] text-ink-faint">No graded picks with a confidence grade yet.</p>
            ) : (
              <div className="mb-2 space-y-1">
                {tiers.map((t) => {
                  const rate = t.n > 0 ? t.wins / t.n : 0;
                  return (
                    <div key={t.tier} className="flex items-center gap-2 text-[11px]">
                      <span className="w-6 shrink-0 font-medium text-ink-muted">{t.tier}</span>
                      <div className="relative h-2.5 flex-1 rounded-full bg-line/30">
                        <div
                          className={`absolute inset-y-0 left-0 rounded-full ${rate >= 0.5 ? 'bg-good' : 'bg-bad'}`}
                          style={{ width: `${Math.min(100, rate * 100)}%`, opacity: 0.6 }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right tabular-nums text-ink-muted">
                        {t.wins}-{t.n - t.wins}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-faint">
              <span title="Last 10 graded picks, most recent first">
                Last 10: <span className="font-medium text-ink-muted">{trend.n > 0 ? `${trend.wins}-${trend.n - trend.wins}` : '—'}</span>
              </span>
              <span title="Net bankroll change if half-Kelly (conservative, CI-lower-bound where available) had been staked on every locked, graded, priced pick, starting from 1.0 unit">
                Kelly ROI:{' '}
                <span className={`font-medium ${roi.netUnits > 0 ? 'text-good' : roi.netUnits < 0 ? 'text-bad' : 'text-ink-muted'}`}>
                  {roi.netUnits >= 0 ? '+' : ''}
                  {(roi.netUnits * 100).toFixed(1)}%
                </span>{' '}
                ({roi.bets} bets)
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "2022-2023" for a contiguous range, "2022" for a single season, "—" for null/empty (fits from before season tracking existed). */
function formatSeasonRange(seasons: number[] | null): string {
  if (!seasons || seasons.length === 0) return '—';
  const min = Math.min(...seasons);
  const max = Math.max(...seasons);
  return min === max ? String(min) : `${min}-${max}`;
}

/**
 * The most recent MLB season that's actually finished — the World Series
 * usually wraps by early November, so before that this season's own data is
 * still incomplete and shouldn't be flagged as "missing" from training.
 * A simple month cutoff, not exact schedule data — fine for a diagnostics
 * hint, not something a model itself should key off of.
 */
function latestCompleteSeason(): number {
  const now = new Date();
  return now.getMonth() >= 10 /* November */ ? now.getFullYear() : now.getFullYear() - 1;
}

/** Null when the active version has no recorded seasons (fit from before tracking existed) or is already caught up. */
function trainingStaleness(active: ModelWeightsRow): { newestSeason: number; missingSeasons: number[] } | null {
  const seasons = [...(active.trainSeasons ?? []), ...(active.holdoutSeasons ?? [])];
  if (seasons.length === 0) return null;
  const newestSeason = Math.max(...seasons);
  const latest = latestCompleteSeason();
  if (newestSeason >= latest) return null;
  const missingSeasons: number[] = [];
  for (let s = newestSeason + 1; s <= latest; s++) missingSeasons.push(s);
  return { newestSeason, missingSeasons };
}

/**
 * Player-prop Beta-Binomial priors (lib/odds/props/edgeModel.ts) are
 * explicitly disclosed as v1 — hand-set, not yet fit against real
 * calibration data — pending "a real season of live-graded edges" in
 * prop_odds_history, which has no historical backfill (unlike moneyline/
 * total's ingested 2010-2025 archive) and only starts accumulating from
 * whenever this app first ran. Six months is a practical proxy for "a real
 * season" — enough live-graded picks to fit against without waiting a full
 * calendar year through an offseason. Null when the table has no rows yet
 * (nothing to project a target from).
 */
function playerPropCalibrationReadiness(earliest: string | null): { targetDate: Date; daysElapsed: number; daysRemaining: number; ready: boolean } | null {
  if (!earliest) return null;
  const start = new Date(earliest);
  const targetDate = new Date(start);
  targetDate.setMonth(targetDate.getMonth() + 6);
  const now = new Date();
  const daysElapsed = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  const daysRemaining = Math.max(0, Math.ceil((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  return { targetDate, daysElapsed, daysRemaining, ready: now >= targetDate };
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    live: 'bg-good text-white',
    cached: 'bg-warn text-white',
    disabled: 'bg-bad text-white',
    unknown: 'bg-ink/10 text-ink-muted',
  };
  return `lb-chip text-[11px] font-semibold ${map[status] ?? map.unknown}`;
}

function HealthDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-good' : 'bg-bad'}`}
      title={ok ? 'OK' : 'Not OK'}
    />
  );
}

/** One market's reliability diagram — predicted-probability bucket vs. realized rate. Extracted so moneyline and total can each get their own instead of being blended into one bucket set. */
function ReliabilityDiagram({ buckets }: { buckets: CalibrationBucket[] }) {
  if (buckets.length === 0) return <p className="text-[11px] text-ink-faint">No graded rows yet.</p>;
  return (
    <div className="space-y-1">
      {buckets.map((b) => {
        const actual = b.n > 0 ? b.wins / b.n : 0;
        const gap = actual - b.bucket;
        return (
          <div key={b.bucket} className="flex items-center gap-2 text-[11px]">
            <span className="w-9 shrink-0 tabular-nums text-ink-faint">{Math.round(b.bucket * 100)}%</span>
            <div className="relative h-3 flex-1 rounded-full bg-line/30">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-ink/15"
                style={{ width: `${Math.min(100, b.bucket * 100)}%` }}
              />
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${Math.abs(gap) < 0.05 ? 'bg-good' : 'bg-masters'}`}
                style={{ width: `${Math.min(100, actual * 100)}%`, opacity: 0.6 }}
              />
            </div>
            <span className="w-20 shrink-0 text-right tabular-nums text-ink-muted">{Math.round(actual * 100)}%</span>
            <span className="w-12 shrink-0 text-right tabular-nums text-ink-faint">n={b.n}</span>
          </div>
        );
      })}
    </div>
  );
}

const DOMINANCE_STYLE: Record<FeatureExplanation['label'], string> = {
  dominant: 'bg-masters/15 text-masters',
  meaningful: 'bg-good/15 text-good',
  minor: 'bg-ink/10 text-ink-muted',
  negligible: 'bg-ink/5 text-ink-faint',
};

/** One active model's coefficients, translated to a plain-language dominance read — see lib/sports/mlb/featureExplain.ts for the "why" behind the bucketing. */
function FeatureWeightsList({ explanations }: { explanations: FeatureExplanation[] }) {
  const sorted = [...explanations].sort((a, b) => b.practicalContribution - a.practicalContribution);
  return (
    <div className="space-y-1.5">
      {sorted.map((f) => (
        <div key={f.name} className="flex items-center justify-between gap-2 text-[12px]" title={f.note}>
          <span className="text-ink-muted">{f.displayName}</span>
          <span className={`lb-chip text-[10px] font-semibold ${DOMINANCE_STYLE[f.label]}`}>{f.label}</span>
        </div>
      ))}
    </div>
  );
}

const DRIFT_STATUS_STYLE: Record<DriftResult['status'], string> = {
  'on-track': 'bg-good/15 text-good',
  underperforming: 'bg-bad/15 text-bad',
  'insufficient-sample': 'bg-ink/10 text-ink-muted',
  'no-active-model': 'bg-ink/5 text-ink-faint',
};

const DRIFT_STATUS_LABEL: Record<DriftResult['status'], string> = {
  'on-track': 'On track',
  underperforming: 'Underperforming',
  'insufficient-sample': 'Not enough live picks yet',
  'no-active-model': 'No active model',
};

const PITCHER_RANK_COLUMNS: Array<{ key: string; label: string; decimals: number }> = [
  { key: 'era', label: 'ERA', decimals: 2 },
  { key: 'fip', label: 'FIP', decimals: 2 },
  { key: 'whip', label: 'WHIP', decimals: 2 },
  { key: 'kbbPct', label: 'K-BB%', decimals: 1 },
  { key: 'whiffPct', label: 'Whiff%', decimals: 1 },
  { key: 'barrelPct', label: 'Barrel%', decimals: 1 },
  { key: 'exitVelo', label: 'Exit Velo', decimals: 1 },
  { key: 'hardHitPct', label: 'HardHit%', decimals: 1 },
];

/** `1` -> `1st`, `22` -> `22nd` — same convention the app's own DVP/matchup ranks already read in ("Opponent ranks 20 of 30"). */
function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

const PITCHER_ROLE_LABEL: Record<RankedPitcherRow['role'], string> = {
  starter: 'Starter',
  closer: 'Closer',
  reliever: 'Reliever',
};

const PITCHER_ROLE_BADGE_CLASS: Record<RankedPitcherRow['role'], string> = {
  starter: 'bg-accent-soft text-masters',
  closer: 'bg-warn/15 text-warn',
  reliever: 'bg-ink/8 text-ink-muted',
};

function renderPitcherRankingsTable(rows: RankedPitcherRow[]) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">No pitchers match this search/filter.</p>;
  }
  return (
    <div className="max-h-[480px] overflow-y-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line text-center text-ink-faint">
            <th className="py-1.5 px-2 text-left">Pitcher</th>
            <th className="py-1.5 px-2">Role</th>
            <th className="py-1.5 px-2">Rank</th>
            <th className="py-1.5 px-2">Score</th>
            {PITCHER_RANK_COLUMNS.map((c) => (
              <th key={c.key} className="py-1.5 px-2">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.personId} className="border-b border-line/50">
              <td className="py-1.5 px-2 text-left">
                <div className="flex items-center gap-2">
                  <SubjectAvatar name={p.fullName} headshotUrl={mlbHeadshotUrl(p.personId)} size={24} />
                  <TeamLogo logoUrl={mlbTeamLogoUrl(p.raw.teamId)} size={16} />
                  <span className="font-medium">{p.fullName}</span>
                </div>
              </td>
              <td className="py-1.5 px-2 text-center">
                <span className={`lb-chip text-[10px] font-semibold ${PITCHER_ROLE_BADGE_CLASS[p.role]}`}>
                  {PITCHER_ROLE_LABEL[p.role]}
                </span>
              </td>
              <td className="py-1.5 px-2 text-center tabular-nums font-semibold text-masters">
                {p.overallRank != null ? `${ordinal(p.overallRank)} of ${p.poolSize}` : '—'}
              </td>
              <td className="py-1.5 px-2 text-center tabular-nums">{p.composite != null ? p.composite.toFixed(0) : '—'}</td>
              {PITCHER_RANK_COLUMNS.map((c) => {
                const value = p.values[c.key];
                const rank = p.ranks[c.key];
                return (
                  <td key={c.key} className="py-1.5 px-2 text-center tabular-nums text-ink-muted">
                    {value != null ? `${value.toFixed(c.decimals)}${rank != null ? ` (${rank}/${p.poolSize})` : ''}` : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BATTER_RANK_COLUMNS: Array<{ key: string; label: string; decimals: number }> = [
  { key: 'barrelPct', label: 'Barrel%', decimals: 1 },
  { key: 'exitVelo', label: 'Exit Velo', decimals: 1 },
  { key: 'hardHitPct', label: 'HardHit%', decimals: 1 },
  { key: 'whiffPct', label: 'Whiff%', decimals: 1 },
];

const BATTER_POSITION_FILTERS = ['all', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH'] as const;

/** `showPositionRank` swaps the headline rank column from overall to position-scoped — same rows, whichever pool the active filter is scoped to. */
function renderBatterRankingsTable(rows: RankedBatterRow[], showPositionRank: boolean) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">No batters match this search/filter.</p>;
  }
  return (
    <div className="max-h-[480px] overflow-y-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line text-center text-ink-faint">
            <th className="py-1.5 px-2 text-left">Batter</th>
            <th className="py-1.5 px-2">Pos</th>
            <th className="py-1.5 px-2">{showPositionRank ? 'Position rank' : 'Overall rank'}</th>
            <th className="py-1.5 px-2">Score</th>
            {BATTER_RANK_COLUMNS.map((c) => (
              <th key={c.key} className="py-1.5 px-2">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const rank = showPositionRank ? b.positionRank : b.overallRank;
            const poolSize = showPositionRank ? b.positionPoolSize : b.poolSize;
            const composite = showPositionRank ? b.positionComposite : b.composite;
            const ranks = showPositionRank ? b.positionRanks : b.overallRanks;
            return (
              <tr key={b.personId} className="border-b border-line/50">
                <td className="py-1.5 px-2 text-left">
                  <div className="flex items-center gap-2">
                    <SubjectAvatar name={b.fullName} headshotUrl={mlbHeadshotUrl(b.personId)} size={24} />
                    <TeamLogo logoUrl={mlbTeamLogoUrl(b.teamId)} size={16} />
                    <span className="font-medium">{b.fullName}</span>
                  </div>
                </td>
                <td className="py-1.5 px-2 text-center">
                  <span className="lb-chip bg-ink/8 text-[10px] font-semibold text-ink-muted">{b.position}</span>
                </td>
                <td className="py-1.5 px-2 text-center tabular-nums font-semibold text-masters">
                  {rank != null ? `${ordinal(rank)} of ${poolSize}` : '—'}
                </td>
                <td className="py-1.5 px-2 text-center tabular-nums">{composite != null ? composite.toFixed(0) : '—'}</td>
                {BATTER_RANK_COLUMNS.map((c) => {
                  const value = b.values[c.key];
                  const statRank = ranks[c.key];
                  return (
                    <td key={c.key} className="py-1.5 px-2 text-center tabular-nums text-ink-muted">
                      {value != null ? `${value.toFixed(c.decimals)}${statRank != null ? ` (${statRank}/${poolSize})` : ''}` : '—'}
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

export default function DiagnosticsPage() {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [propsData, setPropsData] = useState<PropsDiagnosticsData | null>(null);
  const [propsError, setPropsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forcing, setForcing] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [gameCalibration, setGameCalibration] = useState<CalibrationData | null>(null);
  const [gameCalibrationError, setGameCalibrationError] = useState<string | null>(null);
  const [gameBackfillRunning, setGameBackfillRunning] = useState(false);
  const [gameBackfillResult, setGameBackfillResult] = useState<string | null>(null);
  const [pickHistory, setPickHistory] = useState<GamePickHistoryResponse | null>(null);
  const [pickHistoryError, setPickHistoryError] = useState<string | null>(null);
  const [modelVersions, setModelVersions] = useState<ModelVersionsResponse | null>(null);
  const [modelVersionsError, setModelVersionsError] = useState<string | null>(null);
  const [driftCheck, setDriftCheck] = useState<DriftCheckResponse | null>(null);
  const [driftCheckError, setDriftCheckError] = useState<string | null>(null);
  const [eloSanity, setEloSanity] = useState<EloSanityResponse | null>(null);
  const [eloSanityError, setEloSanityError] = useState<string | null>(null);
  const [moneylineCalibration, setMoneylineCalibration] = useState<CalibrationData | null>(null);
  const [moneylineCalibrationError, setMoneylineCalibrationError] = useState<string | null>(null);
  const [totalCalibration, setTotalCalibration] = useState<CalibrationData | null>(null);
  const [totalCalibrationError, setTotalCalibrationError] = useState<string | null>(null);
  const [totalBaselines, setTotalBaselines] = useState<TotalBaselinesResult | null>(null);
  const [totalBaselinesRunning, setTotalBaselinesRunning] = useState(false);
  const [totalBaselinesError, setTotalBaselinesError] = useState<string | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealthResponse | null>(null);
  const [systemHealthError, setSystemHealthError] = useState<string | null>(null);
  const [pitcherRanks, setPitcherRanks] = useState<PitcherRoleRankingsResponse | null>(null);
  const [pitcherRanksLoading, setPitcherRanksLoading] = useState(false);
  const [pitcherRanksError, setPitcherRanksError] = useState<string | null>(null);
  const [pitcherRanksLoaded, setPitcherRanksLoaded] = useState(false);
  const [pitcherSearch, setPitcherSearch] = useState('');
  const [pitcherRoleFilter, setPitcherRoleFilter] = useState<'all' | RankedPitcherRow['role']>('all');
  const [batterRanks, setBatterRanks] = useState<BatterRankingsResponse | null>(null);
  const [batterRanksLoading, setBatterRanksLoading] = useState(false);
  const [batterRanksError, setBatterRanksError] = useState<string | null>(null);
  const [batterRanksLoaded, setBatterRanksLoaded] = useState(false);
  const [batterSearch, setBatterSearch] = useState('');
  const [batterPositionFilter, setBatterPositionFilter] = useState<(typeof BATTER_POSITION_FILTERS)[number]>('all');

  const fetchData = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = force ? '/api/diagnostics?force=1' : '/api/diagnostics';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as DiagnosticsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
      setForcing(false);
    }
  }, []);

  const fetchPropsData = useCallback(async () => {
    setPropsError(null);
    try {
      const res = await fetch('/api/props/diagnostics', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPropsData((await res.json()) as PropsDiagnosticsData);
    } catch (err) {
      setPropsError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchCalibration = useCallback(async () => {
    setCalibrationError(null);
    try {
      const res = await fetch('/api/props/calibration?scope=player', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCalibration((await res.json()) as CalibrationData);
    } catch (err) {
      setCalibrationError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchGameCalibration = useCallback(async () => {
    setGameCalibrationError(null);
    try {
      const res = await fetch('/api/props/calibration?scope=game', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGameCalibration((await res.json()) as CalibrationData);
    } catch (err) {
      setGameCalibrationError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchMoneylineCalibration = useCallback(async () => {
    setMoneylineCalibrationError(null);
    try {
      const res = await fetch('/api/props/calibration?dimension=moneyline', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMoneylineCalibration((await res.json()) as CalibrationData);
    } catch (err) {
      setMoneylineCalibrationError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchTotalCalibration = useCallback(async () => {
    setTotalCalibrationError(null);
    try {
      const res = await fetch('/api/props/calibration?dimension=total', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTotalCalibration((await res.json()) as CalibrationData);
    } catch (err) {
      setTotalCalibrationError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchModelVersions = useCallback(async () => {
    setModelVersionsError(null);
    try {
      const res = await fetch('/api/props/model-versions?sport=mlb', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setModelVersions((await res.json()) as ModelVersionsResponse);
    } catch (err) {
      setModelVersionsError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchDriftCheck = useCallback(async () => {
    setDriftCheckError(null);
    try {
      const res = await fetch('/api/props/drift-check?sport=mlb', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDriftCheck((await res.json()) as DriftCheckResponse);
    } catch (err) {
      setDriftCheckError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchSystemHealth = useCallback(async () => {
    setSystemHealthError(null);
    try {
      const res = await fetch('/api/props/system-health', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSystemHealth((await res.json()) as SystemHealthResponse);
    } catch (err) {
      setSystemHealthError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchEloSanity = useCallback(async () => {
    setEloSanityError(null);
    try {
      const res = await fetch('/api/props/elo-sanity', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEloSanity((await res.json()) as EloSanityResponse);
    } catch (err) {
      setEloSanityError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  // Button-triggered only, deliberately never auto-fetched — this re-fits
  // against the full 2010-2025 span (~90s, ~480 external bullpen-ERA calls),
  // so it must never end up on the mount effect or the force-refresh handler.
  const runTotalBaselinesCheck = async () => {
    setTotalBaselinesRunning(true);
    setTotalBaselinesError(null);
    try {
      const res = await fetch('/api/props/evaluate-total-baselines', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      setTotalBaselines(json as TotalBaselinesResult);
    } catch (err) {
      setTotalBaselinesError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setTotalBaselinesRunning(false);
    }
  };

  const fetchPitcherRanks = async (refresh = false) => {
    setPitcherRanksLoading(true);
    setPitcherRanksError(null);
    try {
      const res = await fetch(`/api/diagnostics/pitcher-ranks${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      setPitcherRanks(json as PitcherRoleRankingsResponse);
      setPitcherRanksLoaded(true);
    } catch (err) {
      setPitcherRanksError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setPitcherRanksLoading(false);
    }
  };

  const filteredPitcherRanks = useMemo(() => {
    if (!pitcherRanks) return [];
    const pool =
      pitcherRoleFilter === 'all'
        ? [...pitcherRanks.starters, ...pitcherRanks.closers, ...pitcherRanks.relievers].sort(
            (a, b) => (b.composite ?? -1) - (a.composite ?? -1),
          )
        : pitcherRoleFilter === 'starter'
          ? pitcherRanks.starters
          : pitcherRoleFilter === 'closer'
            ? pitcherRanks.closers
            : pitcherRanks.relievers;
    const query = pitcherSearch.trim().toLowerCase();
    return query ? pool.filter((p) => p.fullName.toLowerCase().includes(query)) : pool;
  }, [pitcherRanks, pitcherRoleFilter, pitcherSearch]);

  const fetchBatterRanks = async (refresh = false) => {
    setBatterRanksLoading(true);
    setBatterRanksError(null);
    try {
      const res = await fetch(`/api/diagnostics/batter-ranks${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      setBatterRanks(json as BatterRankingsResponse);
      setBatterRanksLoaded(true);
    } catch (err) {
      setBatterRanksError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setBatterRanksLoading(false);
    }
  };

  const filteredBatterRanks = useMemo(() => {
    if (!batterRanks) return [];
    const pool =
      batterPositionFilter === 'all'
        ? [...batterRanks.batters].sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1))
        : batterRanks.batters
            .filter((b) => b.position === batterPositionFilter)
            .sort((a, b) => (b.positionComposite ?? -1) - (a.positionComposite ?? -1));
    const query = batterSearch.trim().toLowerCase();
    return query ? pool.filter((b) => b.fullName.toLowerCase().includes(query)) : pool;
  }, [batterRanks, batterPositionFilter, batterSearch]);

  const runBackfill = async () => {
    setBackfillRunning(true);
    setBackfillResult(null);
    try {
      const res = await fetch('/api/props/backfill', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      setBackfillResult(`${json.rowsWritten} rows written across ${json.subjectsConsidered} players.`);
      void fetchCalibration();
    } catch (err) {
      setBackfillResult(`Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBackfillRunning(false);
    }
  };

  const runGameBackfill = async () => {
    setGameBackfillRunning(true);
    setGameBackfillResult(null);
    try {
      const res = await fetch('/api/props/game-backfill', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      setGameBackfillResult(`${json.rowsWritten} rows written across ${json.gamesConsidered} games.`);
      void fetchGameCalibration();
      void fetchMoneylineCalibration();
    } catch (err) {
      setGameBackfillResult(`Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setGameBackfillRunning(false);
    }
  };

  const [totalBackfillRunning, setTotalBackfillRunning] = useState(false);
  const [totalBackfillResult, setTotalBackfillResult] = useState<string | null>(null);

  /** Total's backfill only covers seasons with real historical odds ingested (2010-2025), not the season in progress — see game-total-backfill's own comment for why that's structurally different from moneyline's current-season-only backfill. */
  const runTotalBackfill = async () => {
    setTotalBackfillRunning(true);
    setTotalBackfillResult(null);
    try {
      const res = await fetch('/api/props/game-total-backfill', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      setTotalBackfillResult(`${json.totalRowsWritten} rows written across ${json.totalGamesConsidered} games, ${json.seasons.length} seasons.`);
      void fetchGameCalibration();
      void fetchTotalCalibration();
    } catch (err) {
      setTotalBackfillResult(`Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setTotalBackfillRunning(false);
    }
  };

  const [pickHistoryFrom, setPickHistoryFrom] = useState('');
  const [pickHistoryTo, setPickHistoryTo] = useState('');

  const fetchPickHistory = useCallback(async (from?: string, to?: string) => {
    setPickHistoryError(null);
    try {
      const params = new URLSearchParams({ sport: 'mlb' });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/picks/game-history?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPickHistory((await res.json()) as GamePickHistoryResponse);
    } catch (err) {
      setPickHistoryError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  useEffect(() => {
    void fetchData();
    void fetchPropsData();
    void fetchCalibration();
    void fetchGameCalibration();
    void fetchPickHistory();
    void fetchMoneylineCalibration();
    void fetchTotalCalibration();
    void fetchModelVersions();
    void fetchDriftCheck();
    void fetchEloSanity();
    void fetchSystemHealth();
  }, [
    fetchData,
    fetchPropsData,
    fetchCalibration,
    fetchGameCalibration,
    fetchPickHistory,
    fetchMoneylineCalibration,
    fetchTotalCalibration,
    fetchModelVersions,
    fetchDriftCheck,
    fetchEloSanity,
    fetchSystemHealth,
  ]);

  const handleForceRefresh = () => {
    setForcing(true);
    void fetchData(true);
    void fetchPropsData();
    void fetchCalibration();
    void fetchGameCalibration();
    void fetchPickHistory();
    void fetchMoneylineCalibration();
    void fetchTotalCalibration();
    void fetchModelVersions();
    void fetchDriftCheck();
    void fetchEloSanity();
    void fetchSystemHealth();
  };

  if (loading && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-ink-muted">Loading diagnostics…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper pb-12">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">Diagnostics</h1>
            <p className="text-xs text-ink-muted">
              API health, scraper status, and line data
            </p>
          </div>
          <button
            type="button"
            onClick={handleForceRefresh}
            disabled={forcing}
            className="lb-btn-primary rounded-xl bg-masters px-4 py-2 text-sm font-semibold text-white shadow-card disabled:opacity-50"
          >
            {forcing ? 'Refreshing…' : 'Rescan now'}
          </button>
        </div>
        <nav className="mt-2 flex gap-3 overflow-x-auto text-[11px] text-ink-muted">
          <a href="#pick-history" className="shrink-0 hover:text-masters">Picks</a>
          <a href="#model-health" className="shrink-0 hover:text-masters">Model Health</a>
          <a href="#data-sources" className="shrink-0 hover:text-masters">Data Sources</a>
          <a href="#debug" className="shrink-0 hover:text-masters">Debug</a>
        </nav>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        {error ? (
          <div className="lb-card border-bad/30 bg-bad/5 p-4 text-sm text-bad">{error}</div>
        ) : null}

        {data ? (
          <>
            {/* Status overview */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Status Overview</h2>
              <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                <div>
                  <div className="text-ink-faint">Odds API</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <HealthDot ok={data.oddsApi.enabled} />
                    <span className="font-semibold">{data.oddsApi.enabled ? 'Connected' : 'Off'}</span>
                  </div>
                </div>
                <div>
                  <div className="text-ink-faint">Harvester (live)</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <HealthDot ok={data.oddsHarvester.live.exists} />
                    <span className="font-semibold">
                      {data.oddsHarvester.live.exists
                        ? `${data.oddsHarvester.live.matchCount} matches`
                        : 'No file'}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-ink-faint">Merged lines</div>
                  <div className="mt-1 font-semibold">{data.merged.totalLines}</div>
                </div>
                <div>
                  <div className="text-ink-faint">Live data</div>
                  <div className="mt-1 font-semibold">{data.merged.withLiveData} games</div>
                </div>
                <div>
                  <div className="text-ink-faint">MLB Stats API</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <HealthDot ok={!systemHealth || systemHealth.statsApiErrors.length === 0} />
                    <span className="font-semibold">
                      {systemHealth ? (systemHealth.statsApiErrors.length === 0 ? 'OK' : `${systemHealth.statsApiErrors.length} errors`) : '—'}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-ink-faint">Active models</div>
                  {/*
                    HealthDot only tracks moneyline/total — those are expected
                    to always be active in normal operation. home-run is
                    included in the count for visibility but deliberately
                    excluded from the ok/not-ok signal: it starting inactive
                    (or staying inactive across refits that don't beat the
                    live Beta-Binomial baseline) is the activation gate
                    working correctly, not a system health problem.
                  */}
                  <div className="mt-1 flex items-center gap-1.5">
                    <HealthDot ok={!!modelVersions?.moneyline.some((v) => v.active) && !!modelVersions?.total.some((v) => v.active)} />
                    <span className="font-semibold">
                      {modelVersions
                        ? `${(modelVersions.moneyline.some((v) => v.active) ? 1 : 0) + (modelVersions.total.some((v) => v.active) ? 1 : 0) + (modelVersions.homeRun.some((v) => v.active) ? 1 : 0)}/3`
                        : '—'}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-ink-faint">Recent errors</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <HealthDot ok={!systemHealth || systemHealth.recentEvents.length === 0} />
                    <span className="font-semibold">{systemHealth ? systemHealth.recentEvents.length : '—'}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 text-[11px] text-ink-faint">
                Last checked: {formatTime(data.timestamp)}
                {forcing ? ' (refreshing…)' : ''}
              </div>
            </section>

            {/* Pitcher role rankings — starters/closers/relievers, traditional + FIP/K-BB% + Statcast, 24h cached. Not fetched on mount — a cold cache takes a couple minutes (season-long Statcast backfill), so loading is opt-in via the button below rather than slowing every diagnostics page visit. */}
            <section id="pitcher-rankings" className="lb-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Pitcher Rankings
                  {pitcherRanks
                    ? ` (${pitcherRanks.starters.length} starters, ${pitcherRanks.closers.length} closers, ${pitcherRanks.relievers.length} relievers)`
                    : ''}
                </h2>
                <div className="flex items-center gap-3 text-[12px] text-ink-muted">
                  {pitcherRanks ? (
                    <span>Computed {new Date(pitcherRanks.computedAt).toLocaleString()} · season {pitcherRanks.season}</span>
                  ) : null}
                  <button
                    type="button"
                    disabled={pitcherRanksLoading}
                    onClick={() => void fetchPitcherRanks(pitcherRanksLoaded)}
                    className="rounded-md border border-line px-2 py-1 font-semibold text-ink hover:bg-accent-soft/30 disabled:opacity-50"
                  >
                    {pitcherRanksLoading ? 'Loading…' : pitcherRanksLoaded ? 'Refresh now' : 'Load pitcher rankings'}
                  </button>
                </div>
              </div>

              {pitcherRanksError ? <p className="mb-2 text-sm text-bad">{pitcherRanksError}</p> : null}
              {pitcherRanksLoading && !pitcherRanks ? (
                <p className="py-6 text-center text-sm text-ink-muted">
                  First run pulls a season of Statcast data — can take a couple minutes. Cached for 24h after that.
                </p>
              ) : null}

              {pitcherRanks ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input
                      type="search"
                      value={pitcherSearch}
                      onChange={(e) => setPitcherSearch(e.target.value)}
                      placeholder="Search pitcher name…"
                      className="min-w-[180px] flex-1 rounded-md border border-line px-2 py-1.5 text-[13px] outline-none focus:border-masters"
                    />
                    <div className="flex items-center gap-1">
                      {(['all', 'starter', 'closer', 'reliever'] as const).map((role) => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setPitcherRoleFilter(role)}
                          className={`rounded-md border px-2 py-1.5 text-[12px] font-semibold ${
                            pitcherRoleFilter === role ? 'border-masters bg-accent-soft text-masters' : 'border-line text-ink-muted hover:bg-accent-soft/30'
                          }`}
                        >
                          {role === 'all' ? 'All' : PITCHER_ROLE_LABEL[role]}
                        </button>
                      ))}
                    </div>
                  </div>
                  {renderPitcherRankingsTable(filteredPitcherRanks)}
                </>
              ) : null}
            </section>

            {/* Batter rankings — overall + per-position pools, Statcast quality-of-contact composite, 24h cached. Same opt-in-via-button pattern as Pitcher Rankings above; shares the same underlying Statcast aggregate, so a warm pitcher-ranks cache usually means this loads fast too. */}
            <section id="batter-rankings" className="lb-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Batter Rankings
                  {batterRanks ? ` (${batterRanks.batters.length} batters)` : ''}
                </h2>
                <div className="flex items-center gap-3 text-[12px] text-ink-muted">
                  {batterRanks ? (
                    <span>Computed {new Date(batterRanks.computedAt).toLocaleString()} · season {batterRanks.season}</span>
                  ) : null}
                  <button
                    type="button"
                    disabled={batterRanksLoading}
                    onClick={() => void fetchBatterRanks(batterRanksLoaded)}
                    className="rounded-md border border-line px-2 py-1 font-semibold text-ink hover:bg-accent-soft/30 disabled:opacity-50"
                  >
                    {batterRanksLoading ? 'Loading…' : batterRanksLoaded ? 'Refresh now' : 'Load batter rankings'}
                  </button>
                </div>
              </div>

              {batterRanksError ? <p className="mb-2 text-sm text-bad">{batterRanksError}</p> : null}
              {batterRanksLoading && !batterRanks ? (
                <p className="py-6 text-center text-sm text-ink-muted">
                  First run pulls a season of Statcast data — can take a couple minutes. Cached for 24h after that.
                </p>
              ) : null}

              {batterRanks ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input
                      type="search"
                      value={batterSearch}
                      onChange={(e) => setBatterSearch(e.target.value)}
                      placeholder="Search batter name…"
                      className="min-w-[180px] flex-1 rounded-md border border-line px-2 py-1.5 text-[13px] outline-none focus:border-masters"
                    />
                    <div className="flex items-center gap-1">
                      {BATTER_POSITION_FILTERS.map((position) => (
                        <button
                          key={position}
                          type="button"
                          onClick={() => setBatterPositionFilter(position)}
                          className={`rounded-md border px-2 py-1.5 text-[12px] font-semibold ${
                            batterPositionFilter === position ? 'border-masters bg-accent-soft text-masters' : 'border-line text-ink-muted hover:bg-accent-soft/30'
                          }`}
                        >
                          {position === 'all' ? 'All' : position}
                        </button>
                      ))}
                    </div>
                  </div>
                  {renderBatterRankingsTable(filteredBatterRanks, batterPositionFilter !== 'all')}
                </>
              ) : null}
            </section>

            {/* Linesmith Pick lock system — history + record */}
            <section id="pick-history" className="lb-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Pick History</h2>
                {pickHistory ? (
                  <div className="flex gap-3 text-[12px]">
                    <span>
                      ML{' '}
                      <span className="font-semibold tabular-nums">
                        {pickHistory.record.moneyline.wins}-{pickHistory.record.moneyline.losses}
                      </span>
                    </span>
                    <span>
                      O/U{' '}
                      <span className="font-semibold tabular-nums">
                        {pickHistory.record.total.wins}-{pickHistory.record.total.losses}
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>
              <p className="mb-3 text-[11px] text-ink-faint">
                Picks lock 3 hours before first pitch (initial read ~6am CT). Green/red shows the graded result of the
                locked pick; &quot;changed&quot; means the 3-hour lock differs from the 6am read.
              </p>

              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px]">
                <label className="flex items-center gap-1 text-ink-faint">
                  From
                  <input
                    type="date"
                    value={pickHistoryFrom}
                    onChange={(e) => setPickHistoryFrom(e.target.value)}
                    className="rounded border border-line bg-card px-1.5 py-0.5"
                  />
                </label>
                <label className="flex items-center gap-1 text-ink-faint">
                  To
                  <input
                    type="date"
                    value={pickHistoryTo}
                    onChange={(e) => setPickHistoryTo(e.target.value)}
                    className="rounded border border-line bg-card px-1.5 py-0.5"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void fetchPickHistory(pickHistoryFrom || undefined, pickHistoryTo || undefined)}
                  className="rounded-md border border-line px-2 py-0.5 font-medium text-ink-muted hover:border-masters/40 hover:text-masters"
                >
                  Apply
                </button>
                {pickHistoryFrom || pickHistoryTo ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPickHistoryFrom('');
                      setPickHistoryTo('');
                      void fetchPickHistory();
                    }}
                    className="text-ink-faint underline hover:text-masters"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              {pickHistoryError ? (
                <p className="text-[12px] text-bad">{pickHistoryError}</p>
              ) : !pickHistory ? (
                <p className="text-[12px] text-ink-muted">Loading…</p>
              ) : (
                <>
                  <GamePickHistoryTable rows={pickHistory.rows} />
                  <PickRecordAnalysis rows={pickHistory.rows} />
                </>
              )}
            </section>

            {/* Player-prop providers (update-09's five-provider feed) */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">
                Player Prop Providers
                {propsData ? (
                  <span className="ml-2 text-[11px] font-normal text-ink-faint">
                    your book: {propsData.userSportsbook}
                  </span>
                ) : null}
              </h2>

              {propsError ? (
                <p className="text-[12px] text-bad">{propsError}</p>
              ) : !propsData ? (
                <p className="text-[12px] text-ink-muted">Loading…</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="border-b border-line text-left text-ink-faint">
                          <th className="py-1.5 pr-2">Provider</th>
                          <th className="py-1.5 pr-2">Schedule</th>
                          <th className="py-1.5 pr-2">Status</th>
                          <th className="py-1.5 pr-2">Delay</th>
                          <th className="py-1.5 pr-2 text-right">Budget used</th>
                          <th className="py-1.5 text-right">Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {propsData.providers.map((p) => {
                          const budget = propsData.budgets[p.id];
                          return (
                            <tr key={p.id} className="border-b border-line/50">
                              <td className="py-1.5 pr-2 font-medium">{p.label}</td>
                              <td className="py-1.5 pr-2">
                                <span className="lb-chip bg-ink/5 text-ink-muted">{p.scheduled ? 'Scheduled' : 'Manual'}</span>
                              </td>
                              <td className="py-1.5 pr-2">
                                <div className="flex items-center gap-1.5">
                                  <HealthDot ok={p.enabled} />
                                  <span>{p.enabled ? 'Enabled' : 'Disabled'}</span>
                                </div>
                              </td>
                              <td className="py-1.5 pr-2 text-ink-muted">
                                {p.delaySeconds != null ? `~${p.delaySeconds}s` : 'not disclosed'}
                              </td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">
                                {budget ? (
                                  <span className={budget.exhausted ? 'text-bad' : budget.overSoftCap ? 'text-warn' : ''}>
                                    {budget.used} / {budget.limit}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="py-1.5 text-right tabular-nums">{budget?.remaining ?? '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Unresolved players/markets/books — the coverage-gap visibility update-09 §6 asked for */}
                  <div className="mt-3 border-t border-line pt-3">
                    <h3 className="mb-2 text-[12px] font-semibold text-ink-muted">
                      Unresolved from most recent fetches ({propsData.unresolved.length})
                    </h3>
                    {propsData.unresolved.length === 0 ? (
                      <p className="text-[12px] text-ink-faint">
                        Nothing unresolved — every player, market, and bookmaker from the last fetch per provider
                        matched cleanly.
                      </p>
                    ) : (
                      <div className="max-h-[300px] overflow-y-auto">
                        <table className="w-full border-collapse text-[11px]">
                          <thead>
                            <tr className="border-b border-line text-left text-ink-faint">
                              <th className="py-1 pr-2">Provider</th>
                              <th className="py-1 pr-2">Kind</th>
                              <th className="py-1 pr-2">Raw value</th>
                              <th className="py-1">Context</th>
                            </tr>
                          </thead>
                          <tbody>
                            {propsData.unresolved.map((u) => (
                              <tr key={u.id} className="border-b border-line/50">
                                <td className="py-1 pr-2 text-ink-muted">{u.providerId}</td>
                                <td className="py-1 pr-2">
                                  <span className="lb-chip bg-warn/10 text-warn">{u.kind}</span>
                                </td>
                                <td className="py-1 pr-2 font-medium">{u.rawValue}</td>
                                <td className="py-1 text-ink-faint">{u.context ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

            {/* Phase C.0 — model calibration: does predicted probability match reality */}
            <section className="lb-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Model Calibration</h2>
                <button
                  type="button"
                  disabled={backfillRunning}
                  onClick={() => void runBackfill()}
                  title="Reconstructs what the model would have predicted using only prior games, then grades against real outcomes — walk-forward, no lookahead."
                  className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:border-masters/40 hover:text-masters disabled:opacity-40"
                >
                  {backfillRunning ? 'Running backfill…' : 'Run historical backfill'}
                </button>
              </div>
              {backfillResult ? <p className="mb-2 text-[11px] text-ink-faint">{backfillResult}</p> : null}

              {calibrationError ? (
                <p className="text-[12px] text-bad">{calibrationError}</p>
              ) : !calibration ? (
                <p className="text-[12px] text-ink-muted">Loading…</p>
              ) : calibration.counts.withModelProb === 0 ? (
                <p className="text-[12px] text-ink-faint">
                  No graded predictions with a model probability yet. Run the historical backfill, or wait for live
                  games to finish and get graded automatically.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                    <div>
                      <span className="text-ink-faint">Surfaced</span>
                      <div className="font-semibold tabular-nums">{calibration.counts.totalRows.toLocaleString()}</div>
                    </div>
                    <div>
                      <span className="text-ink-faint">Graded</span>
                      <div className="font-semibold tabular-nums">
                        {calibration.counts.gradedRows.toLocaleString()}
                        <span className="ml-1 text-[11px] font-normal text-ink-faint">
                          ({calibration.counts.ungradedRows.toLocaleString()} pending)
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-ink-faint">Backfilled / live</span>
                      <div className="font-semibold tabular-nums">
                        {calibration.counts.backfillRows.toLocaleString()} / {calibration.counts.liveRows.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <span className="text-ink-faint" title="Mean squared error between predicted probability and outcome. Lower is better; 0.25 is what guessing 50/50 always scores.">
                        Brier score
                      </span>
                      <div className="font-semibold tabular-nums">{calibration.overallBrierScore?.toFixed(4) ?? '—'}</div>
                    </div>
                  </div>

                  {/* Reliability diagram — predicted probability bucket vs. realized win rate */}
                  <div className="mt-4 border-t border-line pt-3">
                    <h3 className="mb-2 text-[12px] font-semibold text-ink-muted">
                      Reliability — predicted vs. realized
                    </h3>
                    <div className="space-y-1">
                      {calibration.buckets.map((b) => {
                        const actual = b.n > 0 ? b.wins / b.n : 0;
                        const gap = actual - b.bucket;
                        return (
                          <div key={b.bucket} className="flex items-center gap-2 text-[11px]">
                            <span className="w-10 shrink-0 tabular-nums text-ink-faint">{Math.round(b.bucket * 100)}%</span>
                            <div className="relative h-3 flex-1 rounded-full bg-line/30">
                              <div
                                className="absolute inset-y-0 left-0 rounded-full bg-ink/15"
                                style={{ width: `${Math.min(100, b.bucket * 100)}%` }}
                              />
                              <div
                                className={`absolute inset-y-0 left-0 rounded-full ${Math.abs(gap) < 0.05 ? 'bg-good' : 'bg-masters'}`}
                                style={{ width: `${Math.min(100, actual * 100)}%`, opacity: 0.6 }}
                              />
                            </div>
                            <span className="w-24 shrink-0 text-right tabular-nums text-ink-muted">
                              actual {Math.round(actual * 100)}%
                            </span>
                            <span className="w-14 shrink-0 text-right tabular-nums text-ink-faint">n={b.n}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[10px] text-ink-faint">
                      Dark bar = predicted probability, green/masters bar = what actually happened. A well-calibrated
                      model has the two ending in about the same place at every bucket.
                    </p>
                  </div>

                  {/* Per-market breakdown */}
                  <div className="mt-4 border-t border-line pt-3">
                    <h3 className="mb-2 text-[12px] font-semibold text-ink-muted">By market</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="border-b border-line text-left text-ink-faint">
                            <th className="py-1 pr-2">Market</th>
                            <th className="py-1 pr-2 text-right">N</th>
                            <th className="py-1 pr-2 text-right">Win rate</th>
                            <th className="py-1 text-right">Brier</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calibration.byMarket.map((m) => (
                            <tr key={m.dimension} className="border-b border-line/50">
                              <td className="py-1 pr-2 font-medium">{m.dimension}</td>
                              <td className="py-1 pr-2 text-right tabular-nums">{m.n.toLocaleString()}</td>
                              <td className="py-1 pr-2 text-right tabular-nums">{((m.wins / m.n) * 100).toFixed(1)}%</td>
                              <td className="py-1 text-right tabular-nums">{m.brierScore?.toFixed(4) ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* Model Health — version history + plain-language feature weights for the currently active fit, per market. */}
            <section id="model-health" className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Model Versions</h2>
              {modelVersionsError ? (
                <p className="text-[12px] text-bad">{modelVersionsError}</p>
              ) : !modelVersions ? (
                <p className="text-[12px] text-ink-muted">Loading…</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(['moneyline', 'total', 'homeRun'] as const).map((market) => {
                    const versions = modelVersions[market];
                    const explanations = modelVersions.explanations[market];
                    const active = versions.find((v) => v.active);
                    const staleness = active ? trainingStaleness(active) : null;
                    return (
                      <div key={market}>
                        <h3 className="mb-2 text-[12px] font-semibold text-ink-muted">
                          {market === 'moneyline' ? 'Moneyline' : market === 'total' ? 'Total (O/U)' : 'Home Run'}
                        </h3>
                        {staleness ? (
                          <p className="mb-2 rounded-md border border-warn/30 bg-warn/5 px-2 py-1 text-[11px] text-warn">
                            Active model&apos;s newest season is {staleness.newestSeason} — {staleness.missingSeasons.join(', ')}{' '}
                            {staleness.missingSeasons.length === 1 ? 'is' : 'are'} available but not trained on yet.
                          </p>
                        ) : null}
                        {versions.length === 0 ? (
                          <p className="text-[12px] text-ink-faint">No fit has ever run for this market.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-[11px]">
                              <thead>
                                <tr className="border-b border-line text-left text-ink-faint">
                                  <th className="py-1 pr-2">v</th>
                                  <th className="py-1 pr-2">Fitted</th>
                                  <th className="py-1 pr-2">Seasons (train / holdout)</th>
                                  <th className="py-1 pr-2 text-right">Train / holdout</th>
                                  <th className="py-1 pr-2 text-right">Holdout Brier</th>
                                  <th className="py-1 pr-2 text-right">vs. baseline</th>
                                  <th className="py-1 text-right">Active</th>
                                </tr>
                              </thead>
                              <tbody>
                                {versions.map((v) => (
                                  <tr key={v.id} className={`border-b border-line/50 ${v.active ? 'bg-good/5' : ''}`}>
                                    <td className="py-1 pr-2 font-medium">{v.version}</td>
                                    <td className="py-1 pr-2 text-ink-muted">{formatDate(v.fittedAt)}</td>
                                    <td className="py-1 pr-2 text-ink-faint">{formatSeasonRange(v.trainSeasons)} / {formatSeasonRange(v.holdoutSeasons)}</td>
                                    <td className="py-1 pr-2 text-right tabular-nums text-ink-muted">
                                      {v.trainGames.toLocaleString()} / {v.holdoutGames.toLocaleString()}
                                    </td>
                                    <td className="py-1 pr-2 text-right tabular-nums font-medium">{v.holdoutBrier.toFixed(4)}</td>
                                    <td className="py-1 pr-2 text-right tabular-nums text-ink-faint">
                                      {v.baselineHoldoutBrier != null ? v.baselineHoldoutBrier.toFixed(4) : '—'}
                                    </td>
                                    <td className="py-1 text-right">{v.active ? <HealthDot ok /> : null}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {explanations ? (
                          <div className="mt-3 border-t border-line pt-2">
                            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-ink-faint">Active feature weights</p>
                            <FeatureWeightsList explanations={explanations} />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Live-vs-backfill drift alarm — the regression guardrail between refits, not just at fit time. */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Live Drift Check</h2>
              {driftCheckError ? (
                <p className="text-[12px] text-bad">{driftCheckError}</p>
              ) : !driftCheck ? (
                <p className="text-[12px] text-ink-muted">Loading…</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {[driftCheck.moneyline, driftCheck.total].map((d) => (
                    <div key={d.market} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                      <div>
                        <div className="text-[12px] font-semibold">{d.market === 'moneyline' ? 'Moneyline' : 'Total (O/U)'}</div>
                        <div className="text-[11px] text-ink-faint">
                          {d.liveGames > 0 ? (
                            <>
                              live Brier {d.liveBrier?.toFixed(4) ?? '—'} over last {d.liveGames} · expected{' '}
                              {d.expectedBrier?.toFixed(4) ?? '—'}
                            </>
                          ) : (
                            'no live graded picks yet'
                          )}
                        </div>
                      </div>
                      <span className={`lb-chip shrink-0 text-[10px] font-semibold ${DRIFT_STATUS_STYLE[d.status]}`}>
                        {DRIFT_STATUS_LABEL[d.status]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[10px] text-ink-faint">
                Rolling Brier from the last {driftCheck?.rollingWindow ?? 100} real (non-backfill) graded picks, compared
                against the active model's own holdout Brier. Below {driftCheck?.minSample ?? 20} live picks this reads
                &quot;not enough live picks yet&quot; rather than a false alarm either direction.
              </p>
            </section>

            {/* Elo sanity check — a glance should catch anything obviously broken without knowing every team's rating by heart. */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Elo Ratings</h2>
              {eloSanityError ? (
                <p className="text-[12px] text-bad">{eloSanityError}</p>
              ) : !eloSanity ? (
                <p className="text-[12px] text-ink-muted">Loading…</p>
              ) : (
                <div className="max-h-[360px] overflow-y-auto">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-line text-left text-ink-faint">
                        <th className="py-1 pr-2">#</th>
                        <th className="py-1 pr-2">Team</th>
                        <th className="py-1 pr-2 text-right">Elo</th>
                        <th className="py-1 text-right">Games</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eloSanity.teams.map((t, i) => (
                        <tr key={t.teamId} className="border-b border-line/50">
                          <td className="py-1 pr-2 text-ink-faint">{i + 1}</td>
                          <td className="py-1 pr-2 font-medium">
                            {t.name}
                            <span className="ml-1 text-ink-faint">{t.abbreviation}</span>
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums font-medium">{t.elo}</td>
                          <td className="py-1 text-right tabular-nums text-ink-faint">{t.gamesPlayed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-[10px] text-ink-faint">
                1500 is the starting value every team is regressed toward each off-season. A team still sitting near
                1500 mid-season with real games played, or an outlier score with almost no games played, is worth a
                second look.
              </p>
            </section>

            {/* G7 — game-level model calibration, moneyline and total each get their own diagram now that both are correctly counted as game-level (see scopeClause's fix) rather than blended into one bucket set that hid how differently they actually perform. */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Game Model Calibration</h2>

              {gameCalibrationError ? (
                <p className="text-[12px] text-bad">{gameCalibrationError}</p>
              ) : !gameCalibration ? (
                <p className="text-[12px] text-ink-muted">Loading…</p>
              ) : (
                <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                  <div>
                    <span className="text-ink-faint">Surfaced (both markets)</span>
                    <div className="font-semibold tabular-nums">{gameCalibration.counts.totalRows.toLocaleString()}</div>
                  </div>
                  <div>
                    <span className="text-ink-faint">Graded</span>
                    <div className="font-semibold tabular-nums">
                      {gameCalibration.counts.gradedRows.toLocaleString()}
                      <span className="ml-1 text-[11px] font-normal text-ink-faint">
                        ({gameCalibration.counts.ungradedRows.toLocaleString()} pending)
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-ink-faint">Backfilled / live</span>
                    <div className="font-semibold tabular-nums">
                      {gameCalibration.counts.backfillRows.toLocaleString()} / {gameCalibration.counts.liveRows.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <span className="text-ink-faint" title="Mean squared error between predicted probability and outcome. Lower is better; 0.25 is what guessing 50/50 always scores.">
                      Brier by market
                    </span>
                    <div className="font-semibold tabular-nums">
                      {gameCalibration.byMarket
                        .filter((m) => m.dimension === 'moneyline' || m.dimension === 'total')
                        .map((m) => `${m.dimension === 'moneyline' ? 'ML' : 'O/U'} ${m.brierScore?.toFixed(4) ?? '—'}`)
                        .join(' · ') || '—'}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid gap-4 border-t border-line pt-3 sm:grid-cols-2">
                {/* Moneyline */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[12px] font-semibold text-ink-muted">Moneyline</h3>
                    <button
                      type="button"
                      disabled={gameBackfillRunning}
                      onClick={() => void runGameBackfill()}
                      title="Walks the season chronologically, predicting each game from only prior results, then grades against real final scores — no lookahead."
                      className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:border-masters/40 hover:text-masters disabled:opacity-40"
                    >
                      {gameBackfillRunning ? 'Running…' : 'Backfill'}
                    </button>
                  </div>
                  {gameBackfillResult ? <p className="mb-2 text-[11px] text-ink-faint">{gameBackfillResult}</p> : null}
                  {moneylineCalibrationError ? (
                    <p className="text-[12px] text-bad">{moneylineCalibrationError}</p>
                  ) : !moneylineCalibration ? (
                    <p className="text-[12px] text-ink-muted">Loading…</p>
                  ) : moneylineCalibration.counts.withModelProb === 0 ? (
                    <p className="text-[12px] text-ink-faint">No graded moneyline predictions yet.</p>
                  ) : (
                    <ReliabilityDiagram buckets={moneylineCalibration.buckets} />
                  )}
                </div>

                {/* Total (O/U) */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-[12px] font-semibold text-ink-muted">Total (O/U)</h3>
                    <button
                      type="button"
                      disabled={totalBackfillRunning}
                      onClick={() => void runTotalBackfill()}
                      title="Grades against real historical total lines (2010-2025 ingested odds) — the season in progress has no historical line to grade against yet, so this only ever covers past seasons."
                      className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:border-masters/40 hover:text-masters disabled:opacity-40"
                    >
                      {totalBackfillRunning ? 'Running…' : 'Backfill'}
                    </button>
                  </div>
                  {totalBackfillResult ? <p className="mb-2 text-[11px] text-ink-faint">{totalBackfillResult}</p> : null}
                  {totalCalibrationError ? (
                    <p className="text-[12px] text-bad">{totalCalibrationError}</p>
                  ) : !totalCalibration ? (
                    <p className="text-[12px] text-ink-muted">Loading…</p>
                  ) : totalCalibration.counts.withModelProb === 0 ? (
                    <p className="text-[12px] text-ink-faint">No graded total predictions yet.</p>
                  ) : (
                    <ReliabilityDiagram buckets={totalCalibration.buckets} />
                  )}
                </div>
              </div>
              <p className="mt-3 text-[10px] text-ink-faint">
                Dark bar = predicted probability, green/masters bar = what actually happened. A well-calibrated
                model has the two ending in about the same place at every bucket.
              </p>

              {/* Formula vs. market vs. old blend vs. fitted — the real "does this actually beat the market" check for totals. Button-triggered only: this re-fits against the full 2010-2025 span (~90s, ~480 external bullpen-ERA calls), never auto-fetched. */}
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[12px] font-semibold text-ink-muted">Total: does the model actually beat the market?</h3>
                  <button
                    type="button"
                    disabled={totalBaselinesRunning}
                    onClick={() => void runTotalBaselinesCheck()}
                    title="Re-scores formula-alone, market-alone, the old pre-fit blend, and the fitted model on the same 2024-2025 holdout games — takes about 90 seconds."
                    className="rounded-md border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted hover:border-masters/40 hover:text-masters disabled:opacity-40"
                  >
                    {totalBaselinesRunning ? 'Running (~90s)…' : 'Check vs. market'}
                  </button>
                </div>
                {totalBaselinesError ? (
                  <p className="text-[12px] text-bad">Failed: {totalBaselinesError}</p>
                ) : totalBaselines ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                    <div>
                      <span className="text-ink-faint">Formula alone</span>
                      <div className="font-semibold tabular-nums">{totalBaselines.formulaBrier.toFixed(4)}</div>
                    </div>
                    <div>
                      <span className="text-ink-faint">Market alone</span>
                      <div className="font-semibold tabular-nums">
                        {totalBaselines.marketOnlyBrier.toFixed(4)}
                        <span className="ml-1 text-[11px] font-normal text-ink-faint">n={totalBaselines.marketOnlyGames}</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-ink-faint">Old pre-fit blend</span>
                      <div className="font-semibold tabular-nums">{totalBaselines.preFittedBlendBrier.toFixed(4)}</div>
                    </div>
                    <div>
                      <span className="text-ink-faint">Fitted model</span>
                      <div className="font-semibold tabular-nums">
                        {totalBaselines.fittedBrier.toFixed(4)}
                        {totalBaselines.fittedBrier < totalBaselines.marketOnlyBrier ? (
                          <span className="ml-1 text-[11px] font-normal text-good">beats market</span>
                        ) : (
                          <span className="ml-1 text-[11px] font-normal text-ink-faint">≈ market</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-ink-faint">Not run yet this session — click Check vs. market for a fresh read on {gameCalibration ? '2024-2025 holdout games' : 'the holdout set'}.</p>
                )}
              </div>
            </section>

            {/* Data Sources & System — MLB Stats API health (recentFetchErrors existed but had no UI home), pipeline freshness for the season-scoped sources, DB row counts, and the new persisted error log. */}
            <section id="data-sources" className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Data Sources &amp; System</h2>

              {systemHealthError ? (
                <p className="text-[12px] text-bad">{systemHealthError}</p>
              ) : !systemHealth ? (
                <p className="text-[12px] text-ink-muted">Loading…</p>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <HealthDot ok={systemHealth.statsApiErrors.length === 0} />
                    <h3 className="text-[12px] font-semibold text-ink-muted">MLB Stats API</h3>
                  </div>
                  {systemHealth.statsApiErrors.length === 0 ? (
                    <p className="mb-3 text-[12px] text-ink-faint">No fetch failures recorded since the process started.</p>
                  ) : (
                    <div className="mb-3 max-h-[160px] overflow-y-auto rounded-md border border-bad/20 bg-bad/5 p-2">
                      {systemHealth.statsApiErrors.map((e, i) => (
                        <div key={i} className="border-b border-bad/10 py-1 text-[11px] last:border-0">
                          <span className="text-ink-faint">{formatDate(e.at)}</span> · <span className="text-bad">{e.reason}</span>{' '}
                          <span className="text-ink-faint">{e.url}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <h3 className="mb-2 border-t border-line pt-3 text-[12px] font-semibold text-ink-muted">Pipeline freshness</h3>
                  <div className="mb-3 grid gap-4 text-[12px] sm:grid-cols-3">
                    <div>
                      <div className="mb-1 text-ink-faint">Historical odds</div>
                      <div className="font-semibold tabular-nums">
                        {systemHealth.historicalOdds.length} season-source rows
                        <span className="ml-1 font-normal text-ink-faint">
                          ({systemHealth.historicalOdds.length > 0 ? `${Math.min(...systemHealth.historicalOdds.map((r) => r.season))}–${Math.max(...systemHealth.historicalOdds.map((r) => r.season))}` : 'none'})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-ink-faint">Park factors</div>
                      <div className="font-semibold tabular-nums">
                        {systemHealth.parkFactors.length} seasons
                        <span className="ml-1 font-normal text-ink-faint">
                          (last computed {formatDate(systemHealth.parkFactors.reduce<string | null>((max, r) => (r.computedAt && (!max || r.computedAt > max) ? r.computedAt : max), null))})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-ink-faint">Elo history</div>
                      <div className="font-semibold tabular-nums">
                        {systemHealth.elo.length} seasons
                        <span className="ml-1 font-normal text-ink-faint">
                          ({systemHealth.elo.reduce((s, r) => s + r.rows, 0).toLocaleString()} rows)
                        </span>
                      </div>
                    </div>
                  </div>

                  <h3 className="mb-2 border-t border-line pt-3 text-[12px] font-semibold text-ink-muted">DB row counts</h3>
                  <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
                    {systemHealth.tables.map((t) => (
                      <div key={t.table} className="flex justify-between gap-2">
                        <span className="text-ink-faint">{t.table}</span>
                        <span className="tabular-nums font-medium">{t.rows.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>

                  {/*
                    Own-data accumulation — separate from the flat row counts
                    above, this is specifically "is ingestion still running."
                    There's no historical player-prop odds archive anywhere
                    to backfill (unlike historical_odds' real 2010-2025
                    ingested set for moneyline/total) — forward accumulation
                    starting from whenever this app first ran is the only
                    path to a real dataset. last24h === 0 on a table that
                    already has rows is the actual "something stopped"
                    signal.
                  */}
                  <h3 className="mb-2 border-t border-line pt-3 text-[12px] font-semibold text-ink-muted">
                    Own data accumulation
                  </h3>
                  <p className="mb-2 text-[11px] text-ink-faint">
                    No historical player-prop odds exist anywhere to backfill — this is what we&apos;ve collected ourselves,
                    growing forward from whenever this app first ran. A stalled row here (rows &gt; 0 but nothing in the
                    last 24h) means ingestion silently stopped, not that there&apos;s simply nothing to collect yet.
                  </p>
                  <div className="mb-3 overflow-x-auto">
                    <table className="w-full border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-line text-left text-ink-faint">
                          <th className="py-1 pr-2">Table</th>
                          <th className="py-1 pr-2 text-right">Rows</th>
                          <th className="py-1 pr-2 text-right">Earliest</th>
                          <th className="py-1 pr-2 text-right">Latest</th>
                          <th className="py-1 pr-2 text-right">Last 24h</th>
                          <th className="py-1 pr-2 text-right">Last 7d</th>
                          <th className="py-1 text-right">Growing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {systemHealth.dataAccumulation.map((d) => {
                          const stalled = d.rows > 0 && d.last24h === 0;
                          return (
                            <tr key={d.table} className="border-b border-line/50">
                              <td className="py-1 pr-2">
                                <div className="font-medium">{d.table}</div>
                                <div className="text-[10px] text-ink-faint">{d.label}</div>
                              </td>
                              <td className="py-1 pr-2 text-right tabular-nums font-medium">{d.rows.toLocaleString()}</td>
                              <td className="py-1 pr-2 text-right text-ink-muted">{formatDate(d.earliest)}</td>
                              <td className="py-1 pr-2 text-right text-ink-muted">{formatDate(d.latest)}</td>
                              <td className="py-1 pr-2 text-right tabular-nums">{d.last24h.toLocaleString()}</td>
                              <td className="py-1 pr-2 text-right tabular-nums">{d.last7d.toLocaleString()}</td>
                              <td className="py-1 text-right">
                                <HealthDot ok={!stalled} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Golf Phase A models' "how is it performing" check — separate
                      from the row-counts/accumulation tables above, which only
                      answer "is data coming in." A prediction is logged every
                      poll (adapter.ts) and graded once a real outcome lands
                      (grading.ts); every field here stays a dash until at
                      least one has actually been graded — no fabricated
                      placeholder score. */}
                  <h3 className="mb-2 border-t border-line pt-3 text-[12px] font-semibold text-ink-muted">
                    Golf model performance
                  </h3>
                  <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded border border-line p-2.5 text-[11px]">
                      <div className="mb-1.5 font-semibold text-ink-muted">Hole &amp; round predictions</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <span className="text-ink-faint">Logged</span>
                        <span className="text-right tabular-nums font-medium">{systemHealth.golfCalibration.holeRound.total.toLocaleString()}</span>
                        <span className="text-ink-faint">Graded</span>
                        <span className="text-right tabular-nums font-medium">
                          {systemHealth.golfCalibration.holeRound.graded.toLocaleString()}
                          <span className="text-ink-faint"> ({systemHealth.golfCalibration.holeRound.ungraded.toLocaleString()} pending)</span>
                        </span>
                        <span className="text-ink-faint">Hit rate</span>
                        <span className="text-right tabular-nums font-medium">
                          {systemHealth.golfCalibration.holeRound.hitRate != null ? `${(systemHealth.golfCalibration.holeRound.hitRate * 100).toFixed(1)}%` : '—'}
                        </span>
                        <span className="text-ink-faint" title="Mean (predicted − actual)² across every graded prediction. Lower is better; 0.25 is what a coin-flip forecaster scores on a 50/50 event.">
                          Brier score
                        </span>
                        <span className="text-right tabular-nums font-medium">
                          {systemHealth.golfCalibration.holeRound.meanBrier != null ? systemHealth.golfCalibration.holeRound.meanBrier.toFixed(4) : '—'}
                        </span>
                      </div>
                      {systemHealth.golfCalibration.holeRound.graded === 0 ? (
                        <p className="mt-1.5 text-[10px] text-ink-faint">No predictions graded yet — needs a hole/round to actually finish first.</p>
                      ) : null}
                    </div>

                    <div className="rounded border border-line p-2.5 text-[11px]">
                      <div className="mb-1.5 font-semibold text-ink-muted">Tournament winner</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <span className="text-ink-faint">Logged</span>
                        <span className="text-right tabular-nums font-medium">{systemHealth.golfCalibration.tournament.total.toLocaleString()}</span>
                        <span className="text-ink-faint">Graded</span>
                        <span className="text-right tabular-nums font-medium">
                          {systemHealth.golfCalibration.tournament.graded.toLocaleString()}
                          <span className="text-ink-faint"> ({systemHealth.golfCalibration.tournament.ungraded.toLocaleString()} pending)</span>
                        </span>
                        <span className="text-ink-faint">Win Brier</span>
                        <span className="text-right tabular-nums font-medium">
                          {systemHealth.golfCalibration.tournament.winBrier != null ? systemHealth.golfCalibration.tournament.winBrier.toFixed(4) : '—'}
                        </span>
                        <span className="text-ink-faint">Top5 / Top10 Brier</span>
                        <span className="text-right tabular-nums font-medium">
                          {systemHealth.golfCalibration.tournament.top5Brier != null
                            ? `${systemHealth.golfCalibration.tournament.top5Brier.toFixed(4)} / ${systemHealth.golfCalibration.tournament.top10Brier?.toFixed(4)}`
                            : '—'}
                        </span>
                      </div>
                      {systemHealth.golfCalibration.tournament.graded === 0 ? (
                        <p className="mt-1.5 text-[10px] text-ink-faint">Only grades once a full tournament finishes — none have yet since this started logging.</p>
                      ) : null}
                    </div>
                  </div>

                  {(() => {
                    const propOdds = systemHealth.dataAccumulation.find((d) => d.table === 'prop_odds_history');
                    const readiness = playerPropCalibrationReadiness(propOdds?.earliest ?? null);
                    if (!readiness) return null;
                    return (
                      <div
                        className={`mb-3 rounded border px-3 py-2 text-[11px] ${
                          readiness.ready ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line bg-panel-muted text-ink-muted'
                        }`}
                      >
                        <span className="font-semibold">Player-prop model (non-HR) is still v1 (hand-set priors, not fit).</span>{' '}
                        {readiness.ready ? (
                          <>
                            prop_odds_history has been accumulating for {readiness.daysElapsed} days — past the ~6-month mark
                            ({readiness.targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}).
                            Worth revisiting edgeModel.ts's hand-set priors against real graded outcomes now.
                          </>
                        ) : (
                          <>
                            Revisit once prop_odds_history has ~6 months of live-graded history — {readiness.daysElapsed} days in
                            so far, ~{readiness.daysRemaining} to go (target{' '}
                            {readiness.targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}).
                          </>
                        )}
                      </div>
                    );
                  })()}

                  <h3 className="mb-2 border-t border-line pt-3 text-[12px] font-semibold text-ink-muted">
                    Recent errors ({systemHealth.recentEvents.length})
                  </h3>
                  {systemHealth.recentEvents.length === 0 ? (
                    <p className="text-[12px] text-ink-faint">Nothing logged yet.</p>
                  ) : (
                    <div className="max-h-[200px] overflow-y-auto">
                      {systemHealth.recentEvents.map((e) => (
                        <div key={e.id} className="border-b border-line/50 py-1 text-[11px]">
                          <span className="text-ink-faint">{formatDate(e.occurredAt)}</span>{' '}
                          <span className="lb-chip bg-bad/10 text-bad text-[10px]">{e.source}</span>{' '}
                          <span className="text-ink-muted">{e.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>

            {/* Odds API detail */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">
                Odds API
                <span className={statusBadge(data.oddsApi.status)}>{data.oddsApi.status}</span>
              </h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
                <div>
                  <span className="text-ink-faint">Credits used</span>
                  <div className="font-semibold tabular-nums">
                    {data.oddsApi.requestsUsed ?? '—'} / 500
                  </div>
                </div>
                <div>
                  <span className="text-ink-faint">Credits left</span>
                  <div className="font-semibold tabular-nums">
                    {data.oddsApi.requestsRemaining ?? '—'}
                  </div>
                </div>
                <div>
                  <span className="text-ink-faint">Lines returned</span>
                  <div className="font-semibold tabular-nums">{data.oddsApi.linesReturned}</div>
                </div>
                <div>
                  <span className="text-ink-faint">Last fetch</span>
                  <div>{formatDate(data.oddsApi.fetchedAt)}</div>
                </div>
                <div>
                  <span className="text-ink-faint">Next refresh</span>
                  <div>{formatDate(data.oddsApi.nextRefreshAt)}</div>
                </div>
                <div>
                  <span className="text-ink-faint">API key</span>
                  <div>{data.env.oddsApiKeyConfigured ? '✓ Set' : '✗ Missing'}</div>
                </div>
                <div>
                  <span className="text-ink-faint">TTL</span>
                  <div>{data.env.oddsApiTtlMinutes}m</div>
                </div>
                <div>
                  <span className="text-ink-faint">Reserve</span>
                  <div>{data.env.oddsApiReserve} credits</div>
                </div>
              </div>
              {data.oddsApi.warnings.length > 0 ? (
                <div className="mt-3 space-y-1 border-t border-line pt-3">
                  {data.oddsApi.warnings.map((w, i) => (
                    <p key={i} className="text-[12px] text-warn">{w}</p>
                  ))}
                </div>
              ) : null}
              {data.oddsApi.cache ? (
                <div className="mt-3 border-t border-line pt-3 text-[11px] text-ink-faint">
                  SQLite cache: {formatDate(data.oddsApi.cache.fetchedAt)} ·{' '}
                  {(data.oddsApi.cache.payloadBytes / 1024).toFixed(1)} KB
                </div>
              ) : null}
            </section>

            {/* OddsHarvester detail */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">OddsHarvester (Scraper)</h2>
              {(['live', 'upcoming'] as const).map((mode) => {
                const file = data.oddsHarvester[mode];
                return (
                  <div
                    key={mode}
                    className={`mb-2 rounded-lg border p-3 ${file.exists ? 'border-line' : 'border-bad/20 bg-bad/5'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <HealthDot ok={file.exists} />
                        <span className="text-[13px] font-semibold">{file.filename}</span>
                        <span className="lb-chip bg-ink/5 text-ink-muted">{mode}</span>
                      </div>
                      {file.exists ? (
                        <span className="text-[11px] text-ink-faint">
                          {file.matchCount} matches · {(file.sizeBytes! / 1024).toFixed(1)} KB
                        </span>
                      ) : null}
                    </div>
                    {file.exists ? (
                      <div className="mt-1 text-[11px] text-ink-faint">
                        Modified: {formatDate(file.modifiedAt)}
                      </div>
                    ) : (
                      <div className="mt-1 text-[12px] text-bad">{file.error}</div>
                    )}
                  </div>
                );
              })}
            </section>

            {/* Merged lines */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">
                Merged Lines ({data.merged.totalLines})
              </h2>
              <div className="mb-3 flex gap-3 text-[12px]">
                <span className="lb-chip bg-accent-soft text-masters">
                  Both: {data.merged.bySource.both ?? 0}
                </span>
                <span className="lb-chip bg-ink/5 text-ink-muted">
                  API only: {data.merged.bySource['odds-api'] ?? 0}
                </span>
                <span className="lb-chip bg-ink/5 text-ink-muted">
                  Scraper only: {data.merged.bySource.oddsharvester ?? 0}
                </span>
              </div>
              {data.merged.lines.length === 0 ? (
                <p className="text-sm text-ink-muted">No lines available.</p>
              ) : (
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-line text-left text-ink-faint">
                        <th className="py-1.5 pr-2">Matchup</th>
                        <th className="py-1.5 pr-2">Source</th>
                        <th className="py-1.5 pr-2 text-right">ML Home</th>
                        <th className="py-1.5 pr-2 text-right">ML Away</th>
                        <th className="py-1.5 pr-2 text-right">Total</th>
                        <th className="py-1.5 text-right">Books</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.merged.lines.map((line, i) => (
                        <tr key={i} className="border-b border-line/50">
                          <td className="py-1.5 pr-2 font-medium">{line.matchup}</td>
                          <td className="py-1.5 pr-2">
                            <span
                              className={`lb-chip text-[10px] ${
                                line.source === 'both'
                                  ? 'bg-accent-soft text-masters'
                                  : 'bg-ink/5 text-ink-muted'
                              }`}
                            >
                              {line.source}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {line.moneyline?.home != null ? (
                              <span className={line.moneyline.home > 0 ? 'text-good' : ''}>
                                {line.moneyline.home > 0 ? '+' : ''}{line.moneyline.home}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {line.moneyline?.away != null ? (
                              <span className={line.moneyline.away > 0 ? 'text-good' : ''}>
                                {line.moneyline.away > 0 ? '+' : ''}{line.moneyline.away}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {line.total != null ? line.total : '—'}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{line.bookCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Debug drawer — raw dumps and env vars, demoted below everything a normal check-in actually needs. */}
            <div id="debug" className="space-y-4">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Debug</p>

            {/* Per-source detail */}
            <details className="lb-card cursor-pointer p-4">
              <summary className="text-sm font-semibold">Raw Odds API Lines ({data.oddsApi.lines.length})</summary>
              {data.oddsApi.lines.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No lines from Odds API.</p>
              ) : (
                <div className="mt-3 max-h-[400px] overflow-y-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-line text-left text-ink-faint">
                        <th className="py-1.5 pr-2">Matchup</th>
                        <th className="py-1.5 pr-2 text-right">ML Home</th>
                        <th className="py-1.5 pr-2 text-right">ML Away</th>
                        <th className="py-1.5 pr-2 text-right">Total</th>
                        <th className="py-1.5 text-right">Books</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.oddsApi.lines.map((line, i) => (
                        <tr key={i} className="border-b border-line/50">
                          <td className="py-1.5 pr-2 font-medium">{line.matchup}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {line.moneyline?.home != null
                              ? `${line.moneyline.home > 0 ? '+' : ''}${line.moneyline.home}`
                              : '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {line.moneyline?.away != null
                              ? `${line.moneyline.away > 0 ? '+' : ''}${line.moneyline.away}`
                              : '—'}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {line.total != null ? line.total : '—'}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{line.bookCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>

            <details className="lb-card cursor-pointer p-4">
              <summary className="text-sm font-semibold">
                Raw Harvester Lines ({data.oddsHarvester.lines.length})
              </summary>
              {data.oddsHarvester.lines.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No lines from OddsHarvester.</p>
              ) : (
                <div className="mt-3 max-h-[400px] overflow-y-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-line text-left text-ink-faint">
                        <th className="py-1.5 pr-2">Matchup</th>
                        <th className="py-1.5 pr-2">Books</th>
                        <th className="py-1.5 pr-2 text-right">Best ML</th>
                        <th className="py-1.5 text-right">Live</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.oddsHarvester.lines.map((line, i) => (
                        <tr key={i} className="border-b border-line/50">
                          <td className="py-1.5 pr-2 font-medium">{line.matchup}</td>
                          <td className="py-1.5 pr-2 text-ink-muted">
                            {line.bookmakers.map((b) => b.name).join(', ')}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {line.bookmakers[0]?.homeOdds != null
                              ? `${line.bookmakers[0].homeOdds > 0 ? '+' : ''}${line.bookmakers[0].homeOdds}`
                              : '—'}
                          </td>
                          <td className="py-1.5 text-right">
                            {line.liveScore
                              ? `${line.liveScore.away}–${line.liveScore.home}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>


            {/* Environment */}
            <details className="lb-card cursor-pointer p-4">
              <summary className="text-sm font-semibold">Environment</summary>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                <div>
                  <span className="text-ink-faint">ODDS_API_KEY</span>
                  <div>{data.env.oddsApiKeyConfigured ? 'Configured ✓' : 'Not set ✗'}</div>
                </div>
                <div>
                  <span className="text-ink-faint">ODDS_API_TTL_MINUTES</span>
                  <div>{data.env.oddsApiTtlMinutes}</div>
                </div>
                <div>
                  <span className="text-ink-faint">ODDS_API_RESERVE</span>
                  <div>{data.env.oddsApiReserve}</div>
                </div>
                <div>
                  <span className="text-ink-faint">NODE_ENV</span>
                  <div>{data.env.nodeEnv}</div>
                </div>
              </div>
            </details>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
