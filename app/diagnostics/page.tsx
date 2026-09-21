'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ModelStatusRow } from '@/lib/models/modelStatus';
import { SubjectAvatar, TeamLogo, mlbHeadshotUrl, mlbTeamLogoUrl } from '@/components/SubjectAvatar';
import { ConfidenceChip } from '@/components/ConfidenceChip';
import { LockIcon, ClockIcon } from '@/components/icons';
import { Button, Chip, DataTable, Input, Modal, SearchIcon, SegmentedToggle, Tabs, Tooltip, type ChipTone } from '@/components/ui';
import { formatAmerican, americanToDecimal } from '@/lib/odds/display';

interface OddsApiLine {
  eventId: string;
  matchup: string;
  commenceTime: string;
  moneyline: { home?: number; away?: number; book?: string } | null;
  total: number | null;
  bookCount: number;
}

interface GameOddsBookLinesSourceHealth {
  source: string;
  count: number;
  latestFetchedAt: string;
  ageHours: number;
}

interface GameOddsBookLinesSportHealth {
  sport: string;
  healthy: boolean;
  status: string;
  sources: GameOddsBookLinesSourceHealth[];
}

/** Phase 04 admin-center IA groups (docs/four-feature-gameplan-2026-08-22.md) — replaces the old flat 15-section scroll. */
type AdminGroup = 'health' | 'pipelines' | 'model' | 'spend' | 'picks' | 'debug';
const ADMIN_GROUPS: { id: AdminGroup; label: string }[] = [
  { id: 'health', label: 'System Health' },
  { id: 'pipelines', label: 'Data Pipelines' },
  { id: 'model', label: 'Model & Calibration' },
  { id: 'spend', label: 'Usage & Spend' },
  { id: 'picks', label: 'Pick History' },
  { id: 'debug', label: 'Debug' },
];

/**
 * Copy-pasteable resume instructions for the one piece of the odds-
 * architecture rebuild (docs/odds-architecture-rebuild-2026-08-25.md,
 * Phases 5 and 8.4) that couldn't be closed on 2026-08-26 for a reason
 * that isn't fixable by more work: NHL and NBA were both off-season, so
 * there was no live game to visually verify against. Everything else about
 * those two sports (adapter code, the shared read path, the sport-key
 * convention) was checked and is believed correct — this is specifically
 * the "confirm a real game actually renders" step, deferred, not skipped.
 */
const NHL_NBA_RESUME_PROMPT = `NHL and NBA Game Detail/Scan-page verification was deferred on 2026-08-26 because both sports were off-season (no live games to check against) — everything else about the odds-architecture rebuild was verified. Resume this now that games exist:

1. Confirm real rows are landing: check /diagnostics's "Game Odds Book Lines" card (System Health tab) shows nhl/nba as healthy with a recent fetched_at, or query game_odds_book_lines directly for sport IN ('nhl','nba') with fetched_at in the last 24h.
2. Open a real NHL game's Game Detail page (/nhl/game/{gameId}) and a real NBA game's (/nba/game/{gameId}). Confirm the "Line shopping" card's Game tab renders a real bookmaker grid — multiple real books, moneyline at minimum, spread/total if the sport's sources provide them, correct best-price highlighting (only the actual best price per row marked, not a gradient).
3. Open each sport's Slate page and confirm the same real per-game data renders in the Games section.
4. If either sport shows no data despite games being scheduled: both nhl and nba already have a real ScrapeTarget in harvester_scrape.py's SCRAPE_CONFIG as of 2026-08-26 (confirmed by reading the file, not assumed), so a gap here points at the OddsHarvester Scheduled Task not actually running for that sport, or the Render worker (line-buddy-odds-worker) being down/not landing real rows from refreshNbaJob/refreshSportsGameOddsJob — check job_health_checks and the worker's own logs before assuming the code itself is missing something.
5. Once both sports show real, correct data on both pages, close out Phase 5 (NHL) and the NHL/NBA portion of Phase 8.4 in the odds-architecture rebuild plan.`;

/** Small, dependency-free "copied" flash — matches every other transient-state pattern already in this file (aiSummaryLoading, backfillResult, etc.), no new UI primitive needed for one button. */
function copyResumePromptToClipboard(text: string, onDone: () => void) {
  navigator.clipboard.writeText(text).then(onDone).catch(() => {
    /* Clipboard API can be denied by browser permissions — the modal's own
       text is still fully selectable/copyable by hand, so this failing
       silently doesn't lose the user anything. */
  });
}

interface ClvMarketRow {
  market: string;
  referenceBookmaker: string;
  picksConsidered: number;
  picksWithClose: number;
  meanClvProbPoints: number | null;
  medianClvProbPoints: number | null;
  positiveClvRate: number | null;
  summary: string;
}

interface ClvSummary {
  available: boolean;
  reason?: string;
  computedAt?: string;
  referenceDefinition?: string;
  markets?: ClvMarketRow[];
}

interface HealthCheckRow {
  name: string;
  healthy: boolean;
  status: string;
  detail: unknown;
  checkedAt: string;
}

interface AiSummary {
  severity: 'ok' | 'warning' | 'critical';
  summary: string;
  highlights: string[];
  generatedAt: string;
  tokensUsed: number;
}

const AI_SEVERITY_CLASS: Record<AiSummary['severity'], string> = {
  ok: 'bg-good/15 text-good-ink border border-good/30',
  warning: 'bg-warn/10 text-warn-ink border border-warn/30',
  critical: 'bg-bad/10 text-bad-ink border border-bad/30',
};

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
  gameOddsBookLines: {
    allHealthy: boolean;
    bySport: GameOddsBookLinesSportHealth[];
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

interface SystemHealthResponse {
  tables: TableRowCount[];
  dataAccumulation: DataAccumulationRow[];
  elo: EloCoverageRow[];
  parkFactors: ParkFactorCoverageRow[];
  historicalOdds: HistoricalOddsCoverageRow[];
  statsApiErrors: StatsApiError[];
  /** Task 3.2 — cachedRoute write failures over the last 24h. A spike here means the app is serving correct data and caching none of it. */
  cacheFailures?: {
    last24h: number;
    lastHour: number;
    distinctKeys: number;
    mostRecentAt: string | null;
    topKeys: { key: string; failures: number }[];
  };
  recentEvents: SystemEventRow[];
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
  if (outcome === 'win') return 'bg-good/15 text-good-ink border border-good/30';
  if (outcome === 'loss') return 'bg-bad/10 text-bad-ink border border-bad/30';
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
    <Tooltip content={"This lean can still move until it locks 3 hours before first pitch."}><span className="inline-flex items-center gap-1">
      <ClockIcon size={9} /> {lockAt ? `Locks at ${lockAt}` : 'Not yet locked'}
      {late ? ' (late read)' : ''}
    </span></Tooltip>
  );
}

function GamePickHistoryTable({ rows }: { rows: GamePickView[] }) {
  if (rows.length === 0) {
    return <p className="text-label font-normal text-ink-muted">No games have gone through the pick lock system yet.</p>;
  }
  return (
    <div className="max-h-[520px] overflow-y-auto">
      <DataTable
  caption="Game pick history"
  density="compact"
  rows={rows}
  rowKey={(r) => String(r.gameId)}
  columns={[
    { key: 'c0', label: 'Matchup', sortable: false, render: (r) => (<span className="font-medium"><div className="flex items-center gap-1.5">
                  <TeamLogo logoUrl={teamLogoUrl(r.awayTeamId)} size={16} />
                  {r.awayTeamName ?? '?'}
                  <span className="text-ink-muted">@</span>
                  <TeamLogo logoUrl={teamLogoUrl(r.homeTeamId)} size={16} />
                  {r.homeTeamName ?? '?'}
                </div></span>) },
    { key: 'c1', label: 'Date', sortable: false, render: (r) => (<span className="text-ink-muted">{pickDate(r.commenceTime)}</span>) },
    { key: 'c2', label: 'Start', sortable: false, render: (r) => (<span className="text-ink-muted">{pickTime(r.commenceTime)}</span>) },
    { key: 'c3', label: 'Score', sortable: false, render: (r) => (<span className="tabular-nums">{r.finalScore ? `${r.finalScore.away}-${r.finalScore.home}` : '—'}</span>) },
    { key: 'c4', label: 'Moneyline pick', sortable: false, render: (r) => (<>{r.moneyline.pickTeamName ? (
                  <div className={`inline-flex flex-col gap-1 rounded-md px-1.5 py-1.5 ${outcomeClass(r.moneyline.outcome)}`}>
                    <span className="font-semibold">
                      {r.moneyline.pickTeamName}
                      {r.moneyline.price != null ? (
                        <span className="ml-1 font-normal opacity-80 tabular-nums">{formatAmerican(r.moneyline.price)}</span>
                      ) : null}
                    </span>
                    <div className="flex flex-wrap items-center gap-1 text-overline font-normal tracking-normal opacity-90">
                      {r.moneyline.confidence ? <ConfidenceChip letter={r.moneyline.confidence.letter} pct={r.moneyline.confidence.pct} size="sm" /> : null}
                      <LockStatus locked={r.moneyline.locked} late={r.moneyline.late} commenceTime={r.commenceTime} />
                      {r.moneyline.changed ? (
                        <Chip title={`Changed from the 6am pick: ${r.moneyline.initialTeamName ?? '—'}`} tone="warn" size="sm">
                          ↺ changed
                        </Chip>
                      ) : null}
                    </div>
                    {r.moneyline.probLower != null || r.moneyline.stake ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-overline font-normal tracking-normal text-ink-muted">
                        {r.moneyline.probLower != null && r.moneyline.probUpper != null ? (
                          <Tooltip content={`90% confidence interval: ${(r.moneyline.probLower * 100).toFixed(0)}%–${(r.moneyline.probUpper * 100).toFixed(0)}%`}><span>
                            ±{Math.round(((r.moneyline.probUpper - r.moneyline.probLower) / 2) * 100)}%
                          </span></Tooltip>
                        ) : null}
                        {r.moneyline.stake ? (
                          <Tooltip content={
                              r.moneyline.stake.conservativeStake != null
                                ? 'Half-Kelly stake, sized off the confidence interval’s lower bound'
                                : 'Half-Kelly stake off the point-probability estimate (no confidence interval available)'
                            }><span
                          >
                            stake {((r.moneyline.stake.conservativeStake ?? r.moneyline.stake.pointStake) * 100).toFixed(1)}%
                          </span></Tooltip>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}</>) },
    { key: 'c5', label: 'O/U pick', sortable: false, render: (r) => (<>{r.total.pickSide ? (
                  <div className={`inline-flex flex-col gap-1 rounded-md px-1.5 py-1.5 ${outcomeClass(r.total.outcome)}`}>
                    <span className="font-semibold">
                      {r.total.pickSide === 'over' ? 'Over' : 'Under'} {r.total.line ?? ''}
                      {r.total.price != null ? (
                        <span className="ml-1 font-normal opacity-80 tabular-nums">{formatAmerican(r.total.price)}</span>
                      ) : null}
                    </span>
                    <div className="flex flex-wrap items-center gap-1 text-overline font-normal tracking-normal opacity-90">
                      {r.total.confidence ? <ConfidenceChip letter={r.total.confidence.letter} pct={r.total.confidence.pct} size="sm" /> : null}
                      <LockStatus locked={r.total.locked} late={r.total.late} commenceTime={r.commenceTime} />
                      {r.total.changed ? (
                        <Chip title={`Changed from the 6am pick: ${r.total.initialSide === 'over' ? 'Over' : 'Under'} ${r.total.initialLine ?? ''}`} tone="warn" size="sm">
                          ↺ changed
                        </Chip>
                      ) : null}
                    </div>
                    {r.total.probLower != null || r.total.stake ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-overline font-normal tracking-normal text-ink-muted">
                        {r.total.probLower != null && r.total.probUpper != null ? (
                          <Tooltip content={`90% confidence interval: ${(r.total.probLower * 100).toFixed(0)}%–${(r.total.probUpper * 100).toFixed(0)}%`}><span>
                            ±{Math.round(((r.total.probUpper - r.total.probLower) / 2) * 100)}%
                          </span></Tooltip>
                        ) : null}
                        {r.total.stake ? (
                          <Tooltip content={
                              r.total.stake.conservativeStake != null
                                ? 'Half-Kelly stake, sized off the confidence interval’s lower bound'
                                : 'Half-Kelly stake off the point-probability estimate (no confidence interval available)'
                            }><span
                          >
                            stake {((r.total.stake.conservativeStake ?? r.total.stake.pointStake) * 100).toFixed(1)}%
                          </span></Tooltip>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}</>) }
  ]}
/>
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
            <h3 className="mb-2 text-label font-semibold text-ink-muted">{market === 'moneyline' ? 'Moneyline' : 'Total (O/U)'}</h3>

            {tiers.length === 0 ? (
              <p className="text-overline font-normal tracking-normal text-ink-muted">No graded picks with a confidence grade yet.</p>
            ) : (
              <div className="mb-2 space-y-1">
                {tiers.map((t) => {
                  const rate = t.n > 0 ? t.wins / t.n : 0;
                  return (
                    <div key={t.tier} className="flex items-center gap-2 text-overline font-normal tracking-normal">
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

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-overline font-normal tracking-normal text-ink-muted">
              <Tooltip content={"Last 10 graded picks, most recent first"}><span>
                Last 10: <span className="font-medium text-ink-muted">{trend.n > 0 ? `${trend.wins}-${trend.n - trend.wins}` : '—'}</span>
              </span></Tooltip>
              <Tooltip content={"Net bankroll change if half-Kelly (conservative, CI-lower-bound where available) had been staked on every locked, graded, priced pick, starting from 1.0 unit"}><span>
                Kelly ROI:{' '}
                <span className={`font-medium ${roi.netUnits > 0 ? 'text-good-ink' : roi.netUnits < 0 ? 'text-bad-ink' : 'text-ink-muted'}`}>
                  {roi.netUnits >= 0 ? '+' : ''}
                  {(roi.netUnits * 100).toFixed(1)}%
                </span>{' '}
                ({roi.bets} bets)
              </span></Tooltip>
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

function statusTone(status: string): ChipTone {
  const map: Record<string, ChipTone> = { live: 'good', cached: 'warn', disabled: 'bad' };
  return map[status] ?? 'neutral';
}

function HealthDot({ ok }: { ok: boolean }) {
  return (
    <Tooltip content={ok ? 'OK' : 'Not OK'}><span
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-good' : 'bg-bad'}`}
    /></Tooltip>
  );
}

/** One market's reliability diagram — predicted-probability bucket vs. realized rate. Extracted so moneyline and total can each get their own instead of being blended into one bucket set. */
function ReliabilityDiagram({ buckets }: { buckets: CalibrationBucket[] }) {
  if (buckets.length === 0) return <p className="text-overline font-normal tracking-normal text-ink-muted">No graded rows yet.</p>;
  return (
    <div className="space-y-1">
      {buckets.map((b) => {
        const actual = b.n > 0 ? b.wins / b.n : 0;
        const gap = actual - b.bucket;
        return (
          <div key={b.bucket} className="flex items-center gap-2 text-overline font-normal tracking-normal">
            <span className="w-9 shrink-0 tabular-nums text-ink-muted">{Math.round(b.bucket * 100)}%</span>
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
            <span className="w-12 shrink-0 text-right tabular-nums text-ink-muted">n={b.n}</span>
          </div>
        );
      })}
    </div>
  );
}

const DOMINANCE_TONE: Record<FeatureExplanation['label'], ChipTone> = {
  dominant: 'strong',
  meaningful: 'good',
  minor: 'neutral',
  negligible: 'neutral',
};

/** One active model's coefficients, translated to a plain-language dominance read — see lib/sports/mlb/featureExplain.ts for the "why" behind the bucketing. */
function FeatureWeightsList({ explanations }: { explanations: FeatureExplanation[] }) {
  const sorted = [...explanations].sort((a, b) => b.practicalContribution - a.practicalContribution);
  return (
    <div className="space-y-1.5">
      {sorted.map((f) => (
        <Tooltip key={f.name} content={f.note}><div className="flex items-center justify-between gap-2 text-label font-normal">
          <span className="text-ink-muted">{f.displayName}</span>
          <Chip tone={DOMINANCE_TONE[f.label]} size="sm">{f.label}</Chip>
        </div></Tooltip>
      ))}
    </div>
  );
}

const DRIFT_STATUS_TONE: Record<DriftResult['status'], ChipTone> = {
  'on-track': 'good',
  underperforming: 'bad',
  'insufficient-sample': 'neutral',
  'no-active-model': 'neutral',
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

const PITCHER_ROLE_TONE: Record<RankedPitcherRow['role'], ChipTone> = {
  starter: 'strong',
  closer: 'warn',
  reliever: 'neutral',
};

function renderPitcherRankingsTable(rows: RankedPitcherRow[]) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">No pitchers match this search/filter.</p>;
  }
  return (
    <div className="max-h-[480px] overflow-y-auto">
      <DataTable
  caption="Pitcher ranks"
  density="compact"
  rows={rows}
  rowKey={(p) => String(p.personId)}
  columns={[
    { key: 'c0', label: 'Pitcher', sortable: false, render: (p) => (<span className="text-left"><div className="flex items-center gap-2">
                  <SubjectAvatar name={p.fullName} headshotUrl={mlbHeadshotUrl(p.personId)} size={24} />
                  <TeamLogo logoUrl={mlbTeamLogoUrl(p.raw.teamId)} size={16} />
                  <span className="font-medium">{p.fullName}</span>
                </div></span>) },
    { key: 'c1', label: 'Role', sortable: false, align: 'center', render: (p) => (<><Chip tone={PITCHER_ROLE_TONE[p.role]} size="sm">
                  {PITCHER_ROLE_LABEL[p.role]}
                </Chip></>) },
    { key: 'c2', label: 'Rank', sortable: false, align: 'center', render: (p) => (<span className="tabular-nums font-semibold text-masters">{p.overallRank != null ? `${ordinal(p.overallRank)} of ${p.poolSize}` : '—'}</span>) },
    { key: 'c3', label: 'Score', sortable: false, align: 'center', render: (p) => (<span className="tabular-nums">{p.composite != null ? p.composite.toFixed(0) : '—'}</span>) },
    ...PITCHER_RANK_COLUMNS.map((c) => ({
      key: c.key,
      label: c.label,
      sortable: false,
      align: 'center' as const,
      render: (p: (typeof rows)[number]) => {
        const value = p.values[c.key];
        const rank = p.ranks[c.key];
        return <span className="tabular-nums text-ink-muted">{value != null ? `${value.toFixed(c.decimals)}${rank != null ? ` (${rank}/${p.poolSize})` : ''}` : '—'}</span>;
      },
    }))
  ]}
/>
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
      <DataTable<RankedBatterRow>
        caption="Batter ranks"
        density="compact"
        rows={rows}
        rowKey={(b) => String(b.personId)}
        columns={[
          {
            key: 'batter',
            label: 'Batter',
            sortable: false,
            render: (b) => (
              <div className="flex items-center gap-2">
                <SubjectAvatar name={b.fullName} headshotUrl={mlbHeadshotUrl(b.personId)} size={24} />
                <TeamLogo logoUrl={mlbTeamLogoUrl(b.teamId)} size={16} />
                <span className="font-medium">{b.fullName}</span>
              </div>
            ),
          },
          { key: 'pos', label: 'Pos', sortable: false, align: 'center', render: (b) => <Chip size="sm">{b.position}</Chip> },
          {
            key: 'rank',
            label: showPositionRank ? 'Position rank' : 'Overall rank',
            sortable: false,
            align: 'center',
            render: (b) => {
              const rank = showPositionRank ? b.positionRank : b.overallRank;
              const poolSize = showPositionRank ? b.positionPoolSize : b.poolSize;
              return <span className="font-semibold tabular-nums text-masters">{rank != null ? `${ordinal(rank)} of ${poolSize}` : '—'}</span>;
            },
          },
          {
            key: 'score',
            label: 'Score',
            sortable: false,
            align: 'center',
            render: (b) => {
              const composite = showPositionRank ? b.positionComposite : b.composite;
              return composite != null ? composite.toFixed(0) : '—';
            },
          },
          ...BATTER_RANK_COLUMNS.map((c) => ({
            key: c.key,
            label: c.label,
            sortable: false,
            align: 'center' as const,
            render: (b: RankedBatterRow) => {
              const value = b.values[c.key];
              const poolSize = showPositionRank ? b.positionPoolSize : b.poolSize;
              const statRank = (showPositionRank ? b.positionRanks : b.overallRanks)[c.key];
              return <span className="tabular-nums text-ink-muted">{value != null ? `${value.toFixed(c.decimals)}${statRank != null ? ` (${statRank}/${poolSize})` : ''}` : '—'}</span>;
            },
          })),
        ]}
      />
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
  const [activeGroup, setActiveGroup] = useState<AdminGroup>('health');
  const [healthChecks, setHealthChecks] = useState<HealthCheckRow[] | null>(null);
  const [healthChecksError, setHealthChecksError] = useState<string | null>(null);
  // Task 4.5 (P3 M1) — Closing Line Value. Computed hourly by the Python
  // worker's clvSummaryJob and READ here (Q13: Python computes, TS renders).
  const [clv, setClv] = useState<ClvSummary | null>(null);
  const [clvError, setClvError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [showNhlNbaResumeModal, setShowNhlNbaResumeModal] = useState(false);
  const [nhlNbaPromptCopied, setNhlNbaPromptCopied] = useState(false);

  // M1 — the model register: what each sport's model is, and what a page may
  // claim from it. One table, one rule (lib/models/modelStatus.ts); this is the
  // first surface to read it.
  const [modelStatus, setModelStatus] = useState<ModelStatusRow[] | null>(null);
  const [modelStatusError, setModelStatusError] = useState<string | null>(null);
  const fetchModelStatus = useCallback(async () => {
    setModelStatusError(null);
    try {
      const res = await fetch('/api/model-status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { rows: ModelStatusRow[] };
      setModelStatus(json.rows);
    } catch (err) {
      setModelStatusError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchHealthChecks = useCallback(async () => {
    setHealthChecksError(null);
    try {
      const res = await fetch('/api/diagnostics/health', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { checks: HealthCheckRow[] };
      setHealthChecks(json.checks);
    } catch (err) {
      setHealthChecksError(err instanceof Error ? err.message : 'Fetch failed');
    }

    try {
      const res = await fetch('/api/diagnostics/clv', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setClv((await res.json()) as ClvSummary);
    } catch (err) {
      setClvError(err instanceof Error ? err.message : 'Fetch failed');
    }
  }, []);

  const fetchAiSummary = useCallback(async (refresh = false) => {
    setAiSummaryLoading(true);
    setAiSummaryError(null);
    try {
      const res = await fetch(`/api/diagnostics/ai-summary${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
      setAiSummary(json as AiSummary);
    } catch (err) {
      setAiSummaryError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      setAiSummaryLoading(false);
    }
  }, []);

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
    void fetchHealthChecks();
    void fetchModelStatus();
    void fetchAiSummary();
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
    fetchHealthChecks,
    fetchModelStatus,
    fetchAiSummary,
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
    void fetchHealthChecks();
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
          <Button variant="primary" loading={forcing} onPress={handleForceRefresh}>
            {forcing ? 'Refreshing…' : 'Rescan now'}
          </Button>
        </div>
        <Tabs<AdminGroup>
          className="mt-2"
          label="Admin sections"
          value={activeGroup}
          onChange={setActiveGroup}
          items={ADMIN_GROUPS.map((g) => ({ value: g.id, label: g.label }))}
        />
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4">
        {error ? (
          <div className="lb-card border-bad/30 bg-bad/5 p-4 text-sm text-bad-ink">{error}</div>
        ) : null}

        {data ? (
          <>
            {activeGroup === 'health' && (
              <>
                {/* Deferred-verification reminder — NHL/NBA's Game Detail/
                    Scan visual check couldn't be closed on 2026-08-26
                    (off-season, no live game to check against). Surfaced
                    here so it isn't forgotten between now and whenever
                    seasons start, rather than living only in a chat
                    transcript or a memory file nobody re-reads. */}
                <section className="lb-card border-warn/30 bg-warn/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-sm font-semibold text-warn-ink">Deferred: NHL/NBA odds verification</h2>
                      <p className="mt-0.5 text-label font-normal text-ink-muted">
                        Both sports were off-season on 2026-08-26 — no live game existed to verify the odds grid against. Everything else checks out; this is the one open item once their seasons start.
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" className="shrink-0 text-warn-ink" onPress={() => setShowNhlNbaResumeModal(true)}>
                      View resume instructions
                    </Button>
                  </div>
                </section>

                {/* M1 — the model register. The status is what decides whether a page
                    may put a probability beside a price; the evidence is why. */}
                <section className="lb-card p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Model status</h2>
                    <span className="text-overline font-normal tracking-normal text-ink-muted">gated = may show a probability beside a price · baseline = pick only</span>
                  </div>
                  {modelStatusError ? (
                    <p className="text-sm text-bad-ink">Failed: {modelStatusError}</p>
                  ) : modelStatus === null ? (
                    <p className="text-sm text-ink-muted">Loading…</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <DataTable
  caption="Model status"
  density="compact"
  rows={modelStatus}
  rowKey={(r) => `${r.sport}-${r.kind}`}
  columns={[
    { key: 'c0', label: 'Sport', sortable: false, render: (r) => (<span className="font-medium text-ink">{r.sport}</span>) },
    { key: 'c1', label: 'Kind', sortable: false, render: (r) => (<span className="text-ink-muted">{r.kind}</span>) },
    { key: 'c2', label: 'Status', sortable: false, render: (r) => (<><span
                                  className={
                                    r.status === 'gated'
                                      ? 'rounded bg-good/10 px-1.5 py-0.5 font-semibold text-good-ink'
                                      : r.status === 'baseline'
                                        ? 'rounded bg-warn/10 px-1.5 py-0.5 font-semibold text-warn-ink'
                                        : 'rounded bg-ink/5 px-1.5 py-0.5 font-semibold text-ink-muted'
                                  }
                                >
                                  {r.status}
                                </span></>) },
    { key: 'c3', label: 'Engine', sortable: false, render: (r) => (<span className="text-ink-muted">{r.engine ?? '—'}</span>) },
    { key: 'c4', label: 'Evidence', sortable: false, render: (r) => (<span className="text-ink-muted">{r.evidence}</span>) },
    { key: 'c5', label: 'Since', sortable: false, render: (r) => (<span className="text-ink-muted">{r.since}</span>) }
  ]}
/>
                    </div>
                  )}
                </section>

                {/* Phase 05 — DeepSeek plain-English summary over job_health_checks + provider_usage + recent system_events. Summarizer only, never autonomous triage — see docs/four-feature-gameplan-2026-08-22.md's Phase 05 scope note. */}
                <section className="lb-card p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">AI Summary</h2>
                    <Button variant="secondary" size="sm" isDisabled={aiSummaryLoading} onPress={() => fetchAiSummary(true)}>
                      {aiSummaryLoading ? 'Asking…' : 'Ask again'}
                    </Button>
                  </div>
                  {aiSummaryError ? (
                    <p className="text-sm text-bad-ink">Failed: {aiSummaryError}</p>
                  ) : aiSummary === null ? (
                    <p className="text-sm text-ink-muted">{aiSummaryLoading ? 'Asking DeepSeek…' : 'No summary yet.'}</p>
                  ) : (
                    <>
                      <div className="mb-2 flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-overline font-semibold uppercase tracking-wide ${AI_SEVERITY_CLASS[aiSummary.severity]}`}>
                          {aiSummary.severity}
                        </span>
                        <span className="text-overline font-normal tracking-normal text-ink-muted">
                          {new Date(aiSummary.generatedAt).toLocaleString()} · {aiSummary.tokensUsed} tokens
                        </span>
                      </div>
                      <p className="mb-2 text-body-sm text-ink">{aiSummary.summary}</p>
                      {aiSummary.highlights.length > 0 ? (
                        <ul className="list-inside list-disc space-y-0.5 text-label font-normal text-ink-muted">
                          {aiSummary.highlights.map((h, i) => (
                            <li key={i}>{h}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </section>

                {/* System health summary — Phase 04, backed by job_health_checks (health_check.py's persisted results). */}
                <section className="lb-card p-4">
                  <h2 className="mb-3 text-sm font-semibold">Job Health Checks</h2>
                  {healthChecksError ? (
                    <p className="text-sm text-bad-ink">Failed to load: {healthChecksError}</p>
                  ) : healthChecks === null ? (
                    <p className="text-sm text-ink-muted">Loading…</p>
                  ) : healthChecks.length === 0 ? (
                    <p className="text-sm text-ink-muted">
                      No checks recorded yet — health_check.py hasn't run against this database. It's meant to run on a
                      schedule (Render cron or similar); run it manually for a spot-check in the meantime.
                    </p>
                  ) : (
                    <>
                      <div className="mb-3 flex gap-3 text-label font-normal">
                        <Chip tone="good" size="sm">
                          {healthChecks.filter((c) => c.healthy).length} healthy
                        </Chip>
                        <Chip tone="bad" size="sm">
                          {healthChecks.filter((c) => !c.healthy).length} unhealthy
                        </Chip>
                        <span className="text-ink-muted">as of {new Date(healthChecks[0].checkedAt).toLocaleString()}</span>
                      </div>
                      <div className="space-y-1.5">
                        {healthChecks.map((c) => (
                          <div key={c.name} className="flex items-start gap-2 text-label font-normal">
                            <HealthDot ok={c.healthy} />
                            <div>
                              <span className="font-medium">{c.name}</span>
                              <span className="text-ink-muted"> — {c.status}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>

                {/* Task 4.5 (P3 M1) — CLV. Measurable in weeks, where win
                    rate takes years, which is why it earns dashboard space. */}
                <section className="lb-card p-4">
                  <h2 className="mb-1 text-sm font-semibold">Closing Line Value</h2>
                  <p className="mb-3 text-overline font-normal tracking-normal text-ink-muted">
                    Did the market move toward our side after we picked? Reference close ={' '}
                    {clv?.referenceDefinition ?? 'the last observed price before the game starts'}.
                  </p>
                  {clvError ? (
                    <p className="text-sm text-bad-ink">Failed to load: {clvError}</p>
                  ) : clv === null ? (
                    <p className="text-sm text-ink-muted">Loading…</p>
                  ) : !clv.available ? (
                    <p className="text-sm text-ink-muted">
                      Not computed yet — {clv.reason ?? 'clvSummaryJob has not run'}. Deliberately blank rather
                      than showing zeros, which would read as &ldquo;CLV is zero&rdquo;.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {(clv.markets ?? []).map((m) => {
                          const mean = m.meanClvProbPoints;
                          const rate = m.positiveClvRate;
                          return (
                            <div key={m.market} className="text-label font-normal">
                              <div className="flex items-center gap-2">
                                <span className="font-medium capitalize">{m.market}</span>
                                {m.picksWithClose === 0 ? (
                                  <Chip tone="neutral" size="sm">no close matched</Chip>
                                ) : (
                                  <>
                                    <Chip tone={mean != null && mean > 0 ? 'good' : 'bad'} size="sm">
                                      {mean != null ? `${mean > 0 ? '+' : ''}${mean.toFixed(4)} prob-pts mean` : '—'}
                                    </Chip>
                                    <Chip tone="neutral" size="sm">
                                      {rate != null ? `${(rate * 100).toFixed(1)}% beat the close` : '—'}
                                    </Chip>
                                  </>
                                )}
                              </div>
                              <div className="text-ink-muted">
                                {m.picksWithClose}/{m.picksConsidered} picks matched a {m.referenceBookmaker} close
                                {m.medianClvProbPoints != null && (
                                  <> · median {m.medianClvProbPoints > 0 ? '+' : ''}{m.medianClvProbPoints.toFixed(4)}</>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {clv.computedAt && (
                        <p className="mt-3 text-overline font-normal tracking-normal text-ink-muted">
                          Computed {new Date(clv.computedAt).toLocaleString()} by the worker&rsquo;s clvSummaryJob.
                          The mean is skewed by a few large moves; the median is the more robust read.
                        </p>
                      )}
                    </>
                  )}
                </section>

                {/* Status overview */}
                <section className="lb-card p-4">
                  <h2 className="mb-3 text-sm font-semibold">Status Overview</h2>
              <div className="grid grid-cols-2 gap-3 text-body-sm sm:grid-cols-4">
                <div>
                  <div className="text-ink-muted">Odds API</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <HealthDot ok={data.oddsApi.enabled} />
                    <span className="font-semibold">{data.oddsApi.enabled ? 'Connected' : 'Off'}</span>
                  </div>
                </div>
                <div>
                  <div className="text-ink-muted">Game odds book lines</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <HealthDot ok={data.gameOddsBookLines.allHealthy} />
                    <span className="font-semibold">
                      {data.gameOddsBookLines.allHealthy ? 'All sports healthy' : 'Stale sport(s) — see Pipelines'}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-ink-muted">Sports with recent rows</div>
                  <div className="mt-1 font-semibold">
                    {data.gameOddsBookLines.bySport.filter((s) => s.sources.length > 0).length} / {data.gameOddsBookLines.bySport.length}
                  </div>
                </div>
                <div>
                  <div className="text-ink-muted">MLB Stats API</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <HealthDot ok={!systemHealth || systemHealth.statsApiErrors.length === 0} />
                    <span className="font-semibold">
                      {systemHealth ? (systemHealth.statsApiErrors.length === 0 ? 'OK' : `${systemHealth.statsApiErrors.length} errors`) : '—'}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-ink-muted">Active models</div>
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
                  <div className="text-ink-muted">Recent errors</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <HealthDot ok={!systemHealth || systemHealth.recentEvents.length === 0} />
                    <span className="font-semibold">{systemHealth ? systemHealth.recentEvents.length : '—'}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 text-overline font-normal tracking-normal text-ink-muted">
                Last checked: {formatTime(data.timestamp)}
                {forcing ? ' (refreshing…)' : ''}
              </div>
            </section>
              </>
            )}

            {activeGroup === 'model' && (
              <>
            {/* Pitcher role rankings — starters/closers/relievers, traditional + FIP/K-BB% + Statcast, 24h cached. Not fetched on mount — a cold cache takes a couple minutes (season-long Statcast backfill), so loading is opt-in via the button below rather than slowing every diagnostics page visit. */}
            <section id="pitcher-rankings" className="lb-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Pitcher Rankings
                  {pitcherRanks
                    ? ` (${pitcherRanks.starters.length} starters, ${pitcherRanks.closers.length} closers, ${pitcherRanks.relievers.length} relievers)`
                    : ''}
                </h2>
                <div className="flex items-center gap-3 text-label font-normal text-ink-muted">
                  {pitcherRanks ? (
                    <span>Computed {new Date(pitcherRanks.computedAt).toLocaleString()} · season {pitcherRanks.season}</span>
                  ) : null}
                  <Button variant="secondary" size="sm" isDisabled={pitcherRanksLoading} onPress={() => void fetchPitcherRanks(pitcherRanksLoaded)}>
                    {pitcherRanksLoading ? 'Loading…' : pitcherRanksLoaded ? 'Refresh now' : 'Load pitcher rankings'}
                  </Button>
                </div>
              </div>

              {pitcherRanksError ? <p className="mb-2 text-sm text-bad-ink">{pitcherRanksError}</p> : null}
              {pitcherRanksLoading && !pitcherRanks ? (
                <p className="py-6 text-center text-sm text-ink-muted">
                  First run pulls a season of Statcast data — can take a couple minutes. Cached for 24h after that.
                </p>
              ) : null}

              {pitcherRanks ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Input
                      type="search"
                      size="sm"
                      leading={SearchIcon}
                      value={pitcherSearch}
                      onChange={(e) => setPitcherSearch(e.target.value)}
                      placeholder="Search pitcher name…"
                      aria-label="Search pitcher name"
                      className="min-w-[180px] flex-1"
                    />
                    <SegmentedToggle
                      label="Pitcher role"
                      size="sm"
                      value={pitcherRoleFilter}
                      onChange={setPitcherRoleFilter}
                      options={(['all', 'starter', 'closer', 'reliever'] as const).map((role) => ({ value: role, label: role === 'all' ? 'All' : PITCHER_ROLE_LABEL[role] }))}
                    />
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
                <div className="flex items-center gap-3 text-label font-normal text-ink-muted">
                  {batterRanks ? (
                    <span>Computed {new Date(batterRanks.computedAt).toLocaleString()} · season {batterRanks.season}</span>
                  ) : null}
                  <Button variant="secondary" size="sm" isDisabled={batterRanksLoading} onPress={() => void fetchBatterRanks(batterRanksLoaded)}>
                    {batterRanksLoading ? 'Loading…' : batterRanksLoaded ? 'Refresh now' : 'Load batter rankings'}
                  </Button>
                </div>
              </div>

              {batterRanksError ? <p className="mb-2 text-sm text-bad-ink">{batterRanksError}</p> : null}
              {batterRanksLoading && !batterRanks ? (
                <p className="py-6 text-center text-sm text-ink-muted">
                  First run pulls a season of Statcast data — can take a couple minutes. Cached for 24h after that.
                </p>
              ) : null}

              {batterRanks ? (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Input
                      type="search"
                      size="sm"
                      leading={SearchIcon}
                      value={batterSearch}
                      onChange={(e) => setBatterSearch(e.target.value)}
                      placeholder="Search batter name…"
                      aria-label="Search batter name"
                      className="min-w-[180px] flex-1"
                    />
                    <SegmentedToggle
                      label="Batter position"
                      size="sm"
                      value={batterPositionFilter}
                      onChange={setBatterPositionFilter}
                      options={BATTER_POSITION_FILTERS.map((position) => ({ value: position, label: position === 'all' ? 'All' : position }))}
                    />
                  </div>
                  {renderBatterRankingsTable(filteredBatterRanks, batterPositionFilter !== 'all')}
                </>
              ) : null}
            </section>
              </>
            )}

            {activeGroup === 'picks' && (
              <>
            {/* Linesmith Pick lock system — history + record */}
            <section id="pick-history" className="lb-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Pick History</h2>
                {pickHistory ? (
                  <div className="flex gap-3 text-label font-normal">
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
              <p className="mb-3 text-overline font-normal tracking-normal text-ink-muted">
                Picks lock 3 hours before first pitch (initial read ~6am CT). Green/red shows the graded result of the
                locked pick; &quot;changed&quot; means the 3-hour lock differs from the 6am read.
              </p>

              <div className="mb-3 flex flex-wrap items-center gap-2 text-overline font-normal tracking-normal">
                <label className="flex items-center gap-1 text-ink-muted">
                  From
                  <Input type="date" size="sm" value={pickHistoryFrom} onChange={(e) => setPickHistoryFrom(e.target.value)} className="w-auto" />
                </label>
                <label className="flex items-center gap-1 text-ink-muted">
                  To
                  <Input type="date" size="sm" value={pickHistoryTo} onChange={(e) => setPickHistoryTo(e.target.value)} className="w-auto" />
                </label>
                <Button variant="secondary" size="sm" onPress={() => void fetchPickHistory(pickHistoryFrom || undefined, pickHistoryTo || undefined)}>
                  Apply
                </Button>
                {pickHistoryFrom || pickHistoryTo ? (
                  <Button
                    variant="link"
                    size="sm"
                    onPress={() => {
                      setPickHistoryFrom('');
                      setPickHistoryTo('');
                      void fetchPickHistory();
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>

              {pickHistoryError ? (
                <p className="text-label font-normal text-bad-ink">{pickHistoryError}</p>
              ) : !pickHistory ? (
                <p className="text-label font-normal text-ink-muted">Loading…</p>
              ) : (
                <>
                  <GamePickHistoryTable rows={pickHistory.rows} />
                  <PickRecordAnalysis rows={pickHistory.rows} />
                </>
              )}
            </section>
              </>
            )}

            {activeGroup === 'spend' && (
              <>
            {/* Player-prop providers (update-09's five-provider feed) */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">
                Player Prop Providers
                {propsData ? (
                  <span className="ml-2 text-overline tracking-normal font-normal text-ink-muted">
                    your book: {propsData.userSportsbook}
                  </span>
                ) : null}
              </h2>

              {propsError ? (
                <p className="text-label font-normal text-bad-ink">{propsError}</p>
              ) : !propsData ? (
                <p className="text-label font-normal text-ink-muted">Loading…</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <DataTable<(typeof propsData.providers)[number]>
                      caption="Player prop providers"
                      density="compact"
                      rows={propsData.providers}
                      rowKey={(p) => p.id}
                      columns={[
                        { key: 'provider', label: 'Provider', sortable: false, render: (p) => <span className="font-medium">{p.label}</span> },
                        { key: 'schedule', label: 'Schedule', sortable: false, render: (p) => <Chip size="sm">{p.scheduled ? 'Scheduled' : 'Manual'}</Chip> },
                        {
                          key: 'status',
                          label: 'Status',
                          sortable: false,
                          render: (p) => (
                            <div className="flex items-center gap-1.5">
                              <HealthDot ok={p.enabled} />
                              <span>{p.enabled ? 'Enabled' : 'Disabled'}</span>
                            </div>
                          ),
                        },
                        { key: 'delay', label: 'Delay', sortable: false, render: (p) => <span className="text-ink-muted">{p.delaySeconds != null ? `~${p.delaySeconds}s` : 'not disclosed'}</span> },
                        {
                          key: 'used',
                          label: 'Budget used',
                          numeric: true,
                          sortable: false,
                          render: (p) => {
                            const budget = propsData.budgets[p.id];
                            return budget ? <span className={budget.exhausted ? 'text-bad-ink' : budget.overSoftCap ? 'text-warn-ink' : ''}>{budget.used} / {budget.limit}</span> : '—';
                          },
                        },
                        { key: 'remaining', label: 'Remaining', numeric: true, sortable: false, render: (p) => propsData.budgets[p.id]?.remaining ?? '—' },
                      ]}
                    />
                  </div>

                  {/* Unresolved players/markets/books — the coverage-gap visibility update-09 §6 asked for */}
                  <div className="mt-3 border-t border-line pt-3">
                    <h3 className="mb-2 text-label font-semibold text-ink-muted">
                      Unresolved from most recent fetches ({propsData.unresolved.length})
                    </h3>
                    {propsData.unresolved.length === 0 ? (
                      <p className="text-label font-normal text-ink-muted">
                        Nothing unresolved — every player, market, and bookmaker from the last fetch per provider
                        matched cleanly.
                      </p>
                    ) : (
                      <div className="max-h-[300px] overflow-y-auto">
                        <DataTable
  caption="Unresolved provider values"
  density="compact"
  rows={propsData.unresolved}
  rowKey={(u) => String(u.id)}
  columns={[
    { key: 'c0', label: 'Provider', sortable: false, render: (u) => (<span className="text-ink-muted">{u.providerId}</span>) },
    { key: 'c1', label: 'Kind', sortable: false, render: (u) => (<><Chip tone="warn" size="sm">{u.kind}</Chip></>) },
    { key: 'c2', label: 'Raw value', sortable: false, render: (u) => (<span className="font-medium">{u.rawValue}</span>) },
    { key: 'c3', label: 'Context', sortable: false, render: (u) => (<span className="text-ink-muted">{u.context ?? '—'}</span>) }
  ]}
/>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
              </>
            )}

            {activeGroup === 'model' && (
              <>
            {/* Phase C.0 — model calibration: does predicted probability match reality */}
            <section className="lb-card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Model Calibration</h2>
                <Tooltip content={"Reconstructs what the model would have predicted using only prior games, then grades against real outcomes — walk-forward, no lookahead."}><Button variant="secondary" size="sm" isDisabled={backfillRunning} onPress={() => void runBackfill()}>
                  {backfillRunning ? 'Running backfill…' : 'Run historical backfill'}
                </Button></Tooltip>
              </div>
              {backfillResult ? <p className="mb-2 text-overline font-normal tracking-normal text-ink-muted">{backfillResult}</p> : null}

              {calibrationError ? (
                <p className="text-label font-normal text-bad-ink">{calibrationError}</p>
              ) : !calibration ? (
                <p className="text-label font-normal text-ink-muted">Loading…</p>
              ) : calibration.counts.withModelProb === 0 ? (
                <p className="text-label font-normal text-ink-muted">
                  No graded predictions with a model probability yet. Run the historical backfill, or wait for live
                  games to finish and get graded automatically.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-4">
                    <div>
                      <span className="text-ink-muted">Surfaced</span>
                      <div className="font-semibold tabular-nums">{calibration.counts.totalRows.toLocaleString()}</div>
                    </div>
                    <div>
                      <span className="text-ink-muted">Graded</span>
                      <div className="font-semibold tabular-nums">
                        {calibration.counts.gradedRows.toLocaleString()}
                        <span className="ml-1 text-overline tracking-normal font-normal text-ink-muted">
                          ({calibration.counts.ungradedRows.toLocaleString()} pending)
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-ink-muted">Backfilled / live</span>
                      <div className="font-semibold tabular-nums">
                        {calibration.counts.backfillRows.toLocaleString()} / {calibration.counts.liveRows.toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <Tooltip content={"Mean squared error between predicted probability and outcome. Lower is better; 0.25 is what guessing 50/50 always scores."}><span className="text-ink-muted">
                        Brier score
                      </span></Tooltip>
                      <div className="font-semibold tabular-nums">{calibration.overallBrierScore?.toFixed(4) ?? '—'}</div>
                    </div>
                  </div>

                  {/* Reliability diagram — predicted probability bucket vs. realized win rate */}
                  <div className="mt-4 border-t border-line pt-3">
                    <h3 className="mb-2 text-label font-semibold text-ink-muted">
                      Reliability — predicted vs. realized
                    </h3>
                    <div className="space-y-1">
                      {calibration.buckets.map((b) => {
                        const actual = b.n > 0 ? b.wins / b.n : 0;
                        const gap = actual - b.bucket;
                        return (
                          <div key={b.bucket} className="flex items-center gap-2 text-overline font-normal tracking-normal">
                            <span className="w-10 shrink-0 tabular-nums text-ink-muted">{Math.round(b.bucket * 100)}%</span>
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
                            <span className="w-14 shrink-0 text-right tabular-nums text-ink-muted">n={b.n}</span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-overline font-normal tracking-normal text-ink-muted">
                      Dark bar = predicted probability, green/masters bar = what actually happened. A well-calibrated
                      model has the two ending in about the same place at every bucket.
                    </p>
                  </div>

                  {/* Per-market breakdown */}
                  <div className="mt-4 border-t border-line pt-3">
                    <h3 className="mb-2 text-label font-semibold text-ink-muted">By market</h3>
                    <div className="overflow-x-auto">
                      <DataTable
  caption="By market"
  density="compact"
  rows={calibration.byMarket}
  rowKey={(m) => String(m.dimension)}
  columns={[
    { key: 'c0', label: 'Market', sortable: false, render: (m) => (<span className="font-medium">{m.dimension}</span>) },
    { key: 'c1', label: 'N', sortable: false, align: 'right', render: (m) => (<span className="tabular-nums">{m.n.toLocaleString()}</span>) },
    { key: 'c2', label: 'Win rate', sortable: false, align: 'right', render: (m) => (<span className="tabular-nums">{((m.wins / m.n) * 100).toFixed(1)}%</span>) },
    { key: 'c3', label: 'Brier', sortable: false, align: 'right', render: (m) => (<span className="tabular-nums">{m.brierScore?.toFixed(4) ?? '—'}</span>) }
  ]}
/>
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* Model Health — version history + plain-language feature weights for the currently active fit, per market. */}
            <section id="model-health" className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Model Versions</h2>
              {modelVersionsError ? (
                <p className="text-label font-normal text-bad-ink">{modelVersionsError}</p>
              ) : !modelVersions ? (
                <p className="text-label font-normal text-ink-muted">Loading…</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(['moneyline', 'total', 'homeRun'] as const).map((market) => {
                    const versions = modelVersions[market];
                    const explanations = modelVersions.explanations[market];
                    const active = versions.find((v) => v.active);
                    const staleness = active ? trainingStaleness(active) : null;
                    return (
                      <div key={market}>
                        <h3 className="mb-2 text-label font-semibold text-ink-muted">
                          {market === 'moneyline' ? 'Moneyline' : market === 'total' ? 'Total (O/U)' : 'Home Run'}
                        </h3>
                        {staleness ? (
                          <p className="mb-2 rounded-md border border-warn/30 bg-warn/5 px-2 py-1 text-overline font-normal tracking-normal text-warn-ink">
                            Active model&apos;s newest season is {staleness.newestSeason} — {staleness.missingSeasons.join(', ')}{' '}
                            {staleness.missingSeasons.length === 1 ? 'is' : 'are'} available but not trained on yet.
                          </p>
                        ) : null}
                        {versions.length === 0 ? (
                          <p className="text-label font-normal text-ink-muted">No fit has ever run for this market.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <DataTable
  caption="Model Versions"
  density="compact"
  rows={versions}
  rowKey={(v) => String(v.id)}
  columns={[
    { key: 'c0', label: 'v', sortable: false, render: (v) => (<span className="font-medium">{v.version}</span>) },
    { key: 'c1', label: 'Fitted', sortable: false, render: (v) => (<span className="text-ink-muted">{formatDate(v.fittedAt)}</span>) },
    { key: 'c2', label: 'Seasons (train / holdout)', sortable: false, render: (v) => (<span className="text-ink-muted">{formatSeasonRange(v.trainSeasons)} / {formatSeasonRange(v.holdoutSeasons)}</span>) },
    { key: 'c3', label: 'Train / holdout', sortable: false, align: 'right', render: (v) => (<span className="tabular-nums text-ink-muted">{v.trainGames.toLocaleString()} / {v.holdoutGames.toLocaleString()}</span>) },
    { key: 'c4', label: 'Holdout Brier', sortable: false, align: 'right', render: (v) => (<span className="tabular-nums font-medium">{v.holdoutBrier.toFixed(4)}</span>) },
    { key: 'c5', label: 'vs. baseline', sortable: false, align: 'right', render: (v) => (<span className="tabular-nums text-ink-muted">{v.baselineHoldoutBrier != null ? v.baselineHoldoutBrier.toFixed(4) : '—'}</span>) },
    { key: 'c6', label: 'Active', sortable: false, align: 'right', render: (v) => (<>{v.active ? <HealthDot ok /> : null}</>) }
  ]}
/>
                          </div>
                        )}

                        {explanations ? (
                          <div className="mt-3 border-t border-line pt-2">
                            <p className="mb-1.5 text-overline font-normal uppercase tracking-wide text-ink-muted">Active feature weights</p>
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
                <p className="text-label font-normal text-bad-ink">{driftCheckError}</p>
              ) : !driftCheck ? (
                <p className="text-label font-normal text-ink-muted">Loading…</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {[driftCheck.moneyline, driftCheck.total].map((d) => (
                    <div key={d.market} className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                      <div>
                        <div className="text-label font-semibold">{d.market === 'moneyline' ? 'Moneyline' : 'Total (O/U)'}</div>
                        <div className="text-overline font-normal tracking-normal text-ink-muted">
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
                      <Chip tone={DRIFT_STATUS_TONE[d.status]} size="sm" className="shrink-0">
                        {DRIFT_STATUS_LABEL[d.status]}
                      </Chip>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-overline font-normal tracking-normal text-ink-muted">
                Rolling Brier from the last {driftCheck?.rollingWindow ?? 100} real (non-backfill) graded picks, compared
                against the active model's own holdout Brier. Below {driftCheck?.minSample ?? 20} live picks this reads
                &quot;not enough live picks yet&quot; rather than a false alarm either direction.
              </p>
            </section>

            {/* Elo sanity check — a glance should catch anything obviously broken without knowing every team's rating by heart. */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Elo Ratings</h2>
              {eloSanityError ? (
                <p className="text-label font-normal text-bad-ink">{eloSanityError}</p>
              ) : !eloSanity ? (
                <p className="text-label font-normal text-ink-muted">Loading…</p>
              ) : (
                <div className="max-h-[360px] overflow-y-auto">
                  <DataTable<(typeof eloSanity.teams)[number]>
                    caption="Elo ratings"
                    density="compact"
                    rows={eloSanity.teams}
                    rowKey={(t) => String(t.teamId)}
                    columns={[
                      { key: 'n', label: '#', sortable: false, render: (t) => <span className="text-ink-muted">{eloSanity.teams.indexOf(t) + 1}</span> },
                      {
                        key: 'team',
                        label: 'Team',
                        sortable: false,
                        render: (t) => (
                          <span className="font-medium">
                            {t.name}
                            <span className="ml-1 text-ink-muted">{t.abbreviation}</span>
                          </span>
                        ),
                      },
                      { key: 'elo', label: 'Elo', numeric: true, sortable: false, render: (t) => <span className="font-medium">{t.elo}</span> },
                      { key: 'games', label: 'Games', numeric: true, sortable: false, render: (t) => <span className="text-ink-muted">{t.gamesPlayed}</span> },
                    ]}
                  />
                </div>
              )}
              <p className="mt-3 text-overline font-normal tracking-normal text-ink-muted">
                1500 is the starting value every team is regressed toward each off-season. A team still sitting near
                1500 mid-season with real games played, or an outlier score with almost no games played, is worth a
                second look.
              </p>
            </section>

            {/* G7 — game-level model calibration, moneyline and total each get their own diagram now that both are correctly counted as game-level (see scopeClause's fix) rather than blended into one bucket set that hid how differently they actually perform. */}
            <section className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Game Model Calibration</h2>

              {gameCalibrationError ? (
                <p className="text-label font-normal text-bad-ink">{gameCalibrationError}</p>
              ) : !gameCalibration ? (
                <p className="text-label font-normal text-ink-muted">Loading…</p>
              ) : (
                <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-4">
                  <div>
                    <span className="text-ink-muted">Surfaced (both markets)</span>
                    <div className="font-semibold tabular-nums">{gameCalibration.counts.totalRows.toLocaleString()}</div>
                  </div>
                  <div>
                    <span className="text-ink-muted">Graded</span>
                    <div className="font-semibold tabular-nums">
                      {gameCalibration.counts.gradedRows.toLocaleString()}
                      <span className="ml-1 text-overline tracking-normal font-normal text-ink-muted">
                        ({gameCalibration.counts.ungradedRows.toLocaleString()} pending)
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="text-ink-muted">Backfilled / live</span>
                    <div className="font-semibold tabular-nums">
                      {gameCalibration.counts.backfillRows.toLocaleString()} / {gameCalibration.counts.liveRows.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <Tooltip content={"Mean squared error between predicted probability and outcome. Lower is better; 0.25 is what guessing 50/50 always scores."}><span className="text-ink-muted">
                      Brier by market
                    </span></Tooltip>
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
                    <h3 className="text-label font-semibold text-ink-muted">Moneyline</h3>
                    <Tooltip content={"Walks the season chronologically, predicting each game from only prior results, then grades against real final scores — no lookahead."}><Button variant="secondary" size="sm" isDisabled={gameBackfillRunning} onPress={() => void runGameBackfill()}>
                  {gameBackfillRunning ? 'Running…' : 'Backfill'}
                </Button></Tooltip>
                  </div>
                  {gameBackfillResult ? <p className="mb-2 text-overline font-normal tracking-normal text-ink-muted">{gameBackfillResult}</p> : null}
                  {moneylineCalibrationError ? (
                    <p className="text-label font-normal text-bad-ink">{moneylineCalibrationError}</p>
                  ) : !moneylineCalibration ? (
                    <p className="text-label font-normal text-ink-muted">Loading…</p>
                  ) : moneylineCalibration.counts.withModelProb === 0 ? (
                    <p className="text-label font-normal text-ink-muted">No graded moneyline predictions yet.</p>
                  ) : (
                    <ReliabilityDiagram buckets={moneylineCalibration.buckets} />
                  )}
                </div>

                {/* Total (O/U) */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="text-label font-semibold text-ink-muted">Total (O/U)</h3>
                    <Tooltip content={"Grades against real historical total lines (2010-2025 ingested odds) — the season in progress has no historical line to grade against yet, so this only ever covers past seasons."}><Button variant="secondary" size="sm" isDisabled={totalBackfillRunning} onPress={() => void runTotalBackfill()}>
                  {totalBackfillRunning ? 'Running…' : 'Backfill'}
                </Button></Tooltip>
                  </div>
                  {totalBackfillResult ? <p className="mb-2 text-overline font-normal tracking-normal text-ink-muted">{totalBackfillResult}</p> : null}
                  {totalCalibrationError ? (
                    <p className="text-label font-normal text-bad-ink">{totalCalibrationError}</p>
                  ) : !totalCalibration ? (
                    <p className="text-label font-normal text-ink-muted">Loading…</p>
                  ) : totalCalibration.counts.withModelProb === 0 ? (
                    <p className="text-label font-normal text-ink-muted">No graded total predictions yet.</p>
                  ) : (
                    <ReliabilityDiagram buckets={totalCalibration.buckets} />
                  )}
                </div>
              </div>
              <p className="mt-3 text-overline font-normal tracking-normal text-ink-muted">
                Dark bar = predicted probability, green/masters bar = what actually happened. A well-calibrated
                model has the two ending in about the same place at every bucket.
              </p>

              {/* Formula vs. market vs. old blend vs. fitted — the real "does this actually beat the market" check for totals. Button-triggered only: this re-fits against the full 2010-2025 span (~90s, ~480 external bullpen-ERA calls), never auto-fetched. */}
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-label font-semibold text-ink-muted">Total: does the model actually beat the market?</h3>
                  <Tooltip content={"Re-scores formula-alone, market-alone, the old pre-fit blend, and the fitted model on the same 2024-2025 holdout games — takes about 90 seconds."}><Button variant="secondary" size="sm" isDisabled={totalBaselinesRunning} onPress={() => void runTotalBaselinesCheck()}>
                    {totalBaselinesRunning ? 'Running (~90s)…' : 'Check vs. market'}
                  </Button></Tooltip>
                </div>
                {totalBaselinesError ? (
                  <p className="text-label font-normal text-bad-ink">Failed: {totalBaselinesError}</p>
                ) : totalBaselines ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-4">
                    <div>
                      <span className="text-ink-muted">Formula alone</span>
                      <div className="font-semibold tabular-nums">{totalBaselines.formulaBrier.toFixed(4)}</div>
                    </div>
                    <div>
                      <span className="text-ink-muted">Market alone</span>
                      <div className="font-semibold tabular-nums">
                        {totalBaselines.marketOnlyBrier.toFixed(4)}
                        <span className="ml-1 text-overline tracking-normal font-normal text-ink-muted">n={totalBaselines.marketOnlyGames}</span>
                      </div>
                    </div>
                    <div>
                      <span className="text-ink-muted">Old pre-fit blend</span>
                      <div className="font-semibold tabular-nums">{totalBaselines.preFittedBlendBrier.toFixed(4)}</div>
                    </div>
                    <div>
                      <span className="text-ink-muted">Fitted model</span>
                      <div className="font-semibold tabular-nums">
                        {totalBaselines.fittedBrier.toFixed(4)}
                        {totalBaselines.fittedBrier < totalBaselines.marketOnlyBrier ? (
                          <span className="ml-1 text-overline tracking-normal font-normal text-good-ink">beats market</span>
                        ) : (
                          <span className="ml-1 text-overline tracking-normal font-normal text-ink-muted">≈ market</span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-overline font-normal tracking-normal text-ink-muted">Not run yet this session — click Check vs. market for a fresh read on {gameCalibration ? '2024-2025 holdout games' : 'the holdout set'}.</p>
                )}
              </div>
            </section>
              </>
            )}

            {activeGroup === 'pipelines' && (
              <>
            {/* Data Sources & System — MLB Stats API health (recentFetchErrors existed but had no UI home), pipeline freshness for the season-scoped sources, DB row counts, and the new persisted error log. */}
            <section id="data-sources" className="lb-card p-4">
              <h2 className="mb-3 text-sm font-semibold">Data Sources &amp; System</h2>

              {systemHealthError ? (
                <p className="text-label font-normal text-bad-ink">{systemHealthError}</p>
              ) : !systemHealth ? (
                <p className="text-label font-normal text-ink-muted">Loading…</p>
              ) : (
                <>
                  {/* Task 3.2 (P5 E3), scoped by Q19 to no external error
                      tracking. cachedRoute used to swallow write failures
                      silently — the app returned healthy 200s while caching
                      nothing, which is how the free-tier read-only window ran
                      unnoticed. Task 3.1 made those failures visible; this is
                      where they surface. */}
                  <div className="mb-2 flex items-center gap-2">
                    <HealthDot ok={(systemHealth.cacheFailures?.last24h ?? 0) === 0} />
                    <h3 className="text-label font-semibold text-ink-muted">Cache writes</h3>
                  </div>
                  {!systemHealth.cacheFailures || systemHealth.cacheFailures.last24h === 0 ? (
                    <p className="mb-3 text-label font-normal text-ink-muted">No cache-write failures in the last 24 hours.</p>
                  ) : (
                    <div className="mb-3 rounded-md border border-bad/20 bg-bad/5 p-2 text-label font-normal">
                      <p className="mb-1 font-semibold text-bad-ink">
                        {systemHealth.cacheFailures.last24h} cache-write failure
                        {systemHealth.cacheFailures.last24h === 1 ? '' : 's'} in 24h
                        {systemHealth.cacheFailures.lastHour > 0 ? ` (${systemHealth.cacheFailures.lastHour} in the last hour)` : ''}
                        {' · '}
                        {systemHealth.cacheFailures.distinctKeys} distinct key
                        {systemHealth.cacheFailures.distinctKeys === 1 ? '' : 's'}
                      </p>
                      <p className="mb-2 text-overline font-normal tracking-normal text-ink-muted">
                        Requests still succeed — but nothing is being cached, so every request pays a full rebuild.
                        Many keys failing at once usually means the database is refusing writes (quota or read-only).
                      </p>
                      {systemHealth.cacheFailures.topKeys.map((k) => (
                        <div key={k.key} className="border-b border-bad/10 py-1 text-overline font-normal tracking-normal last:border-0">
                          <span className="tabular-nums text-bad-ink">{k.failures}x</span>{' '}
                          <span className="text-ink-muted">{k.key}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mb-2 flex items-center gap-2 border-t border-line pt-3">
                    <HealthDot ok={systemHealth.statsApiErrors.length === 0} />
                    <h3 className="text-label font-semibold text-ink-muted">MLB Stats API</h3>
                  </div>
                  {systemHealth.statsApiErrors.length === 0 ? (
                    <p className="mb-3 text-label font-normal text-ink-muted">No fetch failures recorded since the process started.</p>
                  ) : (
                    <div className="mb-3 max-h-[160px] overflow-y-auto rounded-md border border-bad/20 bg-bad/5 p-2">
                      {systemHealth.statsApiErrors.map((e, i) => (
                        <div key={i} className="border-b border-bad/10 py-1 text-overline font-normal tracking-normal last:border-0">
                          <span className="text-ink-muted">{formatDate(e.at)}</span> · <span className="text-bad-ink">{e.reason}</span>{' '}
                          <span className="text-ink-muted">{e.url}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <h3 className="mb-2 border-t border-line pt-3 text-label font-semibold text-ink-muted">Pipeline freshness</h3>
                  <div className="mb-3 grid gap-4 text-label font-normal sm:grid-cols-3">
                    <div>
                      <div className="mb-1 text-ink-muted">Historical odds</div>
                      <div className="font-semibold tabular-nums">
                        {systemHealth.historicalOdds.length} season-source rows
                        <span className="ml-1 font-normal text-ink-muted">
                          ({systemHealth.historicalOdds.length > 0 ? `${Math.min(...systemHealth.historicalOdds.map((r) => r.season))}–${Math.max(...systemHealth.historicalOdds.map((r) => r.season))}` : 'none'})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-ink-muted">Park factors</div>
                      <div className="font-semibold tabular-nums">
                        {systemHealth.parkFactors.length} seasons
                        <span className="ml-1 font-normal text-ink-muted">
                          (last computed {formatDate(systemHealth.parkFactors.reduce<string | null>((max, r) => (r.computedAt && (!max || r.computedAt > max) ? r.computedAt : max), null))})
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-ink-muted">Elo history</div>
                      <div className="font-semibold tabular-nums">
                        {systemHealth.elo.length} seasons
                        <span className="ml-1 font-normal text-ink-muted">
                          ({systemHealth.elo.reduce((s, r) => s + r.rows, 0).toLocaleString()} rows)
                        </span>
                      </div>
                    </div>
                  </div>

                  <h3 className="mb-2 border-t border-line pt-3 text-label font-semibold text-ink-muted">DB row counts</h3>
                  <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-overline font-normal tracking-normal sm:grid-cols-3">
                    {systemHealth.tables.map((t) => (
                      <div key={t.table} className="flex justify-between gap-2">
                        <span className="text-ink-muted">{t.table}</span>
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
                  <h3 className="mb-2 border-t border-line pt-3 text-label font-semibold text-ink-muted">
                    Own data accumulation
                  </h3>
                  <p className="mb-2 text-overline font-normal tracking-normal text-ink-muted">
                    No historical player-prop odds exist anywhere to backfill — this is what we&apos;ve collected ourselves,
                    growing forward from whenever this app first ran. A stalled row here (rows &gt; 0 but nothing in the
                    last 24h) means ingestion silently stopped, not that there&apos;s simply nothing to collect yet.
                  </p>
                  <div className="mb-3 overflow-x-auto">
                    <DataTable<(typeof systemHealth.dataAccumulation)[number]>
                      caption="Own data accumulation"
                      density="compact"
                      rows={systemHealth.dataAccumulation}
                      rowKey={(d) => d.table}
                      columns={[
                        {
                          key: 'table',
                          label: 'Table',
                          sortable: false,
                          render: (d) => (
                            <>
                              <div className="font-medium">{d.table}</div>
                              <div className="text-ink-muted">{d.label}</div>
                            </>
                          ),
                        },
                        { key: 'rows', label: 'Rows', numeric: true, sortable: false, render: (d) => <span className="font-medium">{d.rows.toLocaleString()}</span> },
                        { key: 'earliest', label: 'Earliest', numeric: true, sortable: false, render: (d) => <span className="text-ink-muted">{formatDate(d.earliest)}</span> },
                        { key: 'latest', label: 'Latest', numeric: true, sortable: false, render: (d) => <span className="text-ink-muted">{formatDate(d.latest)}</span> },
                        { key: 'd1', label: 'Last 24h', numeric: true, sortable: false, render: (d) => d.last24h.toLocaleString() },
                        { key: 'd7', label: 'Last 7d', numeric: true, sortable: false, render: (d) => d.last7d.toLocaleString() },
                        { key: 'growing', label: 'Growing', numeric: true, sortable: false, render: (d) => <HealthDot ok={!(d.rows > 0 && d.last24h === 0)} /> },
                      ]}
                    />
                  </div>

                  {(() => {
                    const propOdds = systemHealth.dataAccumulation.find((d) => d.table === 'prop_odds_history');
                    const readiness = playerPropCalibrationReadiness(propOdds?.earliest ?? null);
                    if (!readiness) return null;
                    return (
                      <div
                        className={`mb-3 rounded border px-3 py-2 text-overline font-normal tracking-normal ${
                          readiness.ready ? 'border-warn/40 bg-warn/10 text-warn-ink' : 'border-line bg-panel-muted text-ink-muted'
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

                  <h3 className="mb-2 border-t border-line pt-3 text-label font-semibold text-ink-muted">
                    Recent errors ({systemHealth.recentEvents.length})
                  </h3>
                  {systemHealth.recentEvents.length === 0 ? (
                    <p className="text-label font-normal text-ink-muted">Nothing logged yet.</p>
                  ) : (
                    <div className="max-h-[200px] overflow-y-auto">
                      {systemHealth.recentEvents.map((e) => (
                        <div key={e.id} className="border-b border-line/50 py-1 text-overline font-normal tracking-normal">
                          <span className="text-ink-muted">{formatDate(e.occurredAt)}</span>{' '}
                          <Chip tone="bad" size="sm">{e.source}</Chip>{' '}
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
                <Chip tone={statusTone(data.oddsApi.status)} size="sm">{data.oddsApi.status}</Chip>
              </h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-3">
                <div>
                  <span className="text-ink-muted">Credits used</span>
                  <div className="font-semibold tabular-nums">
                    {data.oddsApi.requestsUsed ?? '—'} / 500
                  </div>
                </div>
                <div>
                  <span className="text-ink-muted">Credits left</span>
                  <div className="font-semibold tabular-nums">
                    {data.oddsApi.requestsRemaining ?? '—'}
                  </div>
                </div>
                <div>
                  <span className="text-ink-muted">Lines returned</span>
                  <div className="font-semibold tabular-nums">{data.oddsApi.linesReturned}</div>
                </div>
                <div>
                  <span className="text-ink-muted">Last fetch</span>
                  <div>{formatDate(data.oddsApi.fetchedAt)}</div>
                </div>
                <div>
                  <span className="text-ink-muted">Next refresh</span>
                  <div>{formatDate(data.oddsApi.nextRefreshAt)}</div>
                </div>
                <div>
                  <span className="text-ink-muted">API key</span>
                  <div>{data.env.oddsApiKeyConfigured ? '✓ Set' : '✗ Missing'}</div>
                </div>
                <div>
                  <span className="text-ink-muted">TTL</span>
                  <div>{data.env.oddsApiTtlMinutes}m</div>
                </div>
                <div>
                  <span className="text-ink-muted">Reserve</span>
                  <div>{data.env.oddsApiReserve} credits</div>
                </div>
              </div>
              {data.oddsApi.warnings.length > 0 ? (
                <div className="mt-3 space-y-1 border-t border-line pt-3">
                  {data.oddsApi.warnings.map((w, i) => (
                    <p key={i} className="text-label font-normal text-warn-ink">{w}</p>
                  ))}
                </div>
              ) : null}
              {data.oddsApi.cache ? (
                <div className="mt-3 border-t border-line pt-3 text-overline font-normal tracking-normal text-ink-muted">
                  SQLite cache: {formatDate(data.oddsApi.cache.fetchedAt)} ·{' '}
                  {(data.oddsApi.cache.payloadBytes / 1024).toFixed(1)} KB
                </div>
              ) : null}
            </section>

            {/* Game odds book lines — the real "is data actually reaching the
                shared table" check (odds-architecture rebuild Phase 7).
                Replaces the old OddsHarvester-flat-file/Merged-Lines section,
                which read a file (data/*.json) nothing in production ever
                wrote — dead since before this rebuild, confirmed and
                retired 2026-08-26. Per-sport, not per-source: see
                readGameOddsBookLinesHealth's own comment in lib/db/client.ts
                for why a hardcoded expected-source list per sport isn't the
                right call here. */}
            <section className="lb-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                Game Odds Book Lines
                <HealthDot ok={data.gameOddsBookLines.allHealthy} />
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.gameOddsBookLines.bySport.map((s) => (
                  <div
                    key={s.sport}
                    className={`rounded-lg border p-3 ${s.healthy ? 'border-line' : 'border-bad/20 bg-bad/5'}`}
                  >
                    <div className="flex items-center gap-2">
                      <HealthDot ok={s.healthy} />
                      <span className="text-body-sm font-semibold uppercase">{s.sport}</span>
                    </div>
                    <p className={`mt-1 text-overline font-normal tracking-normal ${s.healthy ? 'text-ink-muted' : 'text-bad-ink'}`}>{s.status}</p>
                    {s.sources.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {s.sources.map((src) => (
                          <Chip key={src.source} title={`freshest ${src.ageHours.toFixed(1)}h ago`} tone="neutral" size="sm">
                            {src.source}: {src.count}
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
              </>
            )}

            {activeGroup === 'debug' && (
              <>
            {/* Debug drawer — raw dumps and env vars, demoted below everything a normal check-in actually needs. */}
            <div id="debug" className="space-y-4">
            <p className="px-1 text-overline font-semibold uppercase tracking-wide text-ink-muted">Debug</p>

            {/* Per-source detail */}
            <details className="lb-card cursor-pointer p-4">
              <summary className="text-sm font-semibold">Raw Odds API Lines ({data.oddsApi.lines.length})</summary>
              {data.oddsApi.lines.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No lines from Odds API.</p>
              ) : (
                <div className="mt-3 max-h-[400px] overflow-y-auto">
                  <DataTable<(typeof data.oddsApi.lines)[number]>
                    caption="Raw Odds API lines"
                    density="compact"
                    rows={data.oddsApi.lines}
                    rowKey={(line) => `${line.matchup}-${data.oddsApi.lines.indexOf(line)}`}
                    columns={[
                      { key: 'matchup', label: 'Matchup', sortable: false, render: (line) => <span className="font-medium">{line.matchup}</span> },
                      { key: 'mlh', label: 'ML Home', numeric: true, sortable: false, render: (line) => (line.moneyline?.home != null ? `${line.moneyline.home > 0 ? '+' : ''}${line.moneyline.home}` : '—') },
                      { key: 'mla', label: 'ML Away', numeric: true, sortable: false, render: (line) => (line.moneyline?.away != null ? `${line.moneyline.away > 0 ? '+' : ''}${line.moneyline.away}` : '—') },
                      { key: 'total', label: 'Total', numeric: true, sortable: false, render: (line) => (line.total != null ? line.total : '—') },
                      { key: 'books', label: 'Books', numeric: true, sortable: false, render: (line) => line.bookCount },
                    ]}
                  />
                </div>
              )}
            </details>

            {/* Environment */}
            <details className="lb-card cursor-pointer p-4">
              <summary className="text-sm font-semibold">Environment</summary>
              <div className="mt-3 grid grid-cols-2 gap-2 text-body-sm">
                <div>
                  <span className="text-ink-muted">ODDS_API_KEY</span>
                  <div>{data.env.oddsApiKeyConfigured ? 'Configured ✓' : 'Not set ✗'}</div>
                </div>
                <div>
                  <span className="text-ink-muted">ODDS_API_TTL_MINUTES</span>
                  <div>{data.env.oddsApiTtlMinutes}</div>
                </div>
                <div>
                  <span className="text-ink-muted">ODDS_API_RESERVE</span>
                  <div>{data.env.oddsApiReserve}</div>
                </div>
                <div>
                  <span className="text-ink-muted">NODE_ENV</span>
                  <div>{data.env.nodeEnv}</div>
                </div>
              </div>
            </details>
            </div>
              </>
            )}
          </>
        ) : null}
      </main>

      {/* U4: the kit Modal. */}
      <Modal
        isOpen={showNhlNbaResumeModal}
        onClose={() => setShowNhlNbaResumeModal(false)}
        width={560}
        title="NHL/NBA verification — resume instructions"
        footer={
          <>
            {nhlNbaPromptCopied ? <span className="self-center text-label text-good-ink">Copied</span> : null}
            <Button
              variant="primary"
              size="sm"
              onPress={() =>
                copyResumePromptToClipboard(NHL_NBA_RESUME_PROMPT, () => {
                  setNhlNbaPromptCopied(true);
                  setTimeout(() => setNhlNbaPromptCopied(false), 2000);
                })
              }
            >
              Copy prompt
            </Button>
          </>
        }
      >
        <pre className="whitespace-pre-wrap text-label font-normal leading-relaxed text-ink-muted">{NHL_NBA_RESUME_PROMPT}</pre>
      </Modal>
    </div>
  );
}
