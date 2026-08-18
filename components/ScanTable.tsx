'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HistoryEntry, PickCandidate, Sport } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';
import {
  windowSet,
  subsetWindow,
  fixedWindow,
  deltaFromLine,
  rateOrNull,
  averageOrNull,
  entryValue,
} from '@/lib/core/windowedStat';
import { compareInk, gradientCardStyle } from '@/lib/ui/heat';
import { MarketLine } from './MarketLabel';
import { SubjectAvatar, TeamLogo } from './SubjectAvatar';
import { AverageCell, GradientRateCell, GradientStreakCell, GradientDeltaCell } from './StatCells';
import { OddsChip } from './OddsChip';
import { BookLogo } from './BookLogo';
import { resolveCandidateEdge, type PropOddsRow } from './usePropOdds';
import {
  goodBetReasons,
  candidateGoodBetSignals,
  performanceMatchDetails,
  type GoodBetReason,
} from '@/lib/odds/goodBets';
import { computePropScore, type PropScore } from '@/lib/odds/props/propScore';
import type { MarketTrust } from '@/lib/odds/props/marketTrust';
import { PropScoreBadge } from './PropScoreBadge';

/**
 * Scan's props table.
 *
 * This is the view Scan exists for: sweeping a whole slate's worth of
 * candidates and finding the two worth opening. Cards hold more context per
 * candidate but make that a scrolling exercise; this puts twelve measurements
 * per row on one line and lets the eye do the work.
 *
 * Two things it must get right, in order:
 *  1. The first column stays put while the numbers scroll under it. Losing
 *     track of whose row you're reading is what makes dense tables useless on a
 *     phone, and it is the single most important behaviour here.
 *  2. Every number is a `WindowedStat`, so a short sample shows a dash rather
 *     than a percentage it hasn't earned.
 */

type SortColumn =
  | 'player'
  | 'odds'
  | 'ip'
  | 'edge'
  | 'modelProb'
  | 'dvp'
  | 'avg'
  | 'diff'
  | 'l5'
  | 'l10'
  | 'l15'
  | 'h2h'
  | 'strk'
  | 'szn'
  | 'reason'
  | 'score'
  | 'r1'
  | 'r2'
  | 'r3'
  | 'r4'
  | 'hole'
  | 'thru'
  | 'line';

type SortDir = 'asc' | 'desc';

interface Column {
  key: SortColumn;
  label: string;
  /** Long form for the header's accessible name. */
  title: string;
  numeric: boolean;
}

const COLUMNS: Column[] = [
  { key: 'odds', label: 'Odds', title: 'Price', numeric: true },
  { key: 'ip', label: 'IP', title: 'Implied probability', numeric: true },
  {
    key: 'edge',
    label: 'Edge',
    title: 'Model probability minus the de-vigged market price — Phase C.1, still early: see /diagnostics for calibration',
    numeric: true,
  },
  { key: 'dvp', label: 'DVP', title: "Opponent's rank in this row's matchup stat", numeric: true },
  { key: 'avg', label: 'Avg L10', title: 'Average over the last 10 games', numeric: true },
  { key: 'diff', label: 'Diff', title: 'Average versus the line', numeric: true },
  { key: 'l5', label: 'L5', title: 'Hit rate, last 5 games', numeric: true },
  { key: 'l10', label: 'L10', title: 'Hit rate, last 10 games', numeric: true },
  { key: 'l15', label: 'L15', title: 'Hit rate, last 15 games', numeric: true },
  { key: 'h2h', label: 'H2H', title: 'Hit rate versus this opponent', numeric: true },
  { key: 'strk', label: 'Strk', title: 'Current streak', numeric: true },
  { key: 'szn', label: 'SZN', title: 'Hit rate this season', numeric: true },
];

/**
 * Golf's column set — an MLB game count (L5/L10/L15), matchup rank (DVP),
 * and averages-vs-line (Avg L10/Diff) don't exist for a golfer: there's no
 * opponent, and a tournament rarely runs past 4 rounds. What a bettor
 * actually wants for a hole-score prop is what the golfer shot on *this*
 * hole in each round played so far, so those replace the windows outright.
 * Odds/IP/Edge are dropped too — no book prices hole props today, so those
 * columns would only ever read as a permanent dash (see the golf odds audit
 * in project memory); Odds stays since "Check Book" is still an action.
 */
/** The hole number a golf dimension prices, or null for a dimension with no single hole (e.g. `round-score`). */
function holeNumberOf(dimension: string): number | null {
  const m = /^hole-(\d+)$/.exec(dimension);
  return m ? Number(m[1]) : null;
}

/** Mirrors `formatTeeTime` in GolfScheduleView.tsx/GolferStrip.tsx — a bare ISO timestamp read badly as a table cell, so it's duplicated locally per this codebase's convention rather than shared for one line of logic. */
function formatTeeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function golfColumns(rounds: number[]): Column[] {
  return [
    { key: 'line', label: 'Line', title: 'Which of the 3 categories this market bets — birdie-or-better, par, or bogey-or-worse', numeric: false },
    { key: 'hole', label: 'Hole', title: 'Which hole this market prices', numeric: true },
    { key: 'odds', label: 'Odds', title: 'Price', numeric: true },
    { key: 'thru', label: 'Thru', title: "Which hole this golfer is currently on live — compare against the Hole column to see how far away this market's hole is", numeric: true },
    ...rounds.map((n) => ({
      key: `r${n}` as SortColumn,
      label: `R${n}`,
      title: `Score on this hole in round ${n}, relative to par`,
      numeric: true,
    })),
    { key: 'strk', label: 'Strk', title: 'Current streak', numeric: true },
    { key: 'szn', label: 'TRN', title: 'Hit rate across the tournament so far', numeric: true },
  ];
}

/**
 * Categorical, not continuous — birdie-or-better sits solidly in the green
 * band, bogey-or-worse solidly in red, par flat at the amber midpoint. A
 * flatter per-stroke scale left a single-stroke birdie/bogey (the common
 * case) reading as barely-tinted amber, which defeats the point of a
 * birdie/par/bogey color code. Magnitude still nudges within each band, so
 * an eagle reads greener than a birdie.
 */
function golfScoreHeat(relativeToPar: number): number {
  if (relativeToPar === 0) return 0.5;
  if (relativeToPar < 0) return Math.min(1, 0.78 + (Math.abs(relativeToPar) - 1) * 0.12);
  return Math.max(0, 0.22 - (relativeToPar - 1) * 0.12);
}

/** One round's score for one hole — golf's dense-table counterpart to `GradientRateCell`, driven by the actual score instead of a hit rate. */
function GolfRoundCell({ entry }: { entry: HistoryEntry | undefined }) {
  const relativeToPar = entry ? entryValue(entry) : null;
  if (entry == null || relativeToPar === null) {
    return (
      <td className="bg-ink/5 px-1.5 py-1 text-center align-middle text-ink-faint" title="Not played yet">
        –
      </td>
    );
  }

  const gradient = gradientCardStyle(golfScoreHeat(relativeToPar));
  const categoryLabel = entry.category.charAt(0).toUpperCase() + entry.category.slice(1);

  return (
    <td className="bg-card px-1.5 py-1 text-center align-middle" style={{ backgroundImage: gradient.tableWash }} title={categoryLabel}>
      <div className="text-[12px] font-bold leading-none tabular-nums" style={{ color: gradient.valueColor }}>
        {entry.result}
      </div>
    </td>
  );
}

const GOLF_CATEGORY_TEXT_CLASS: Record<PickCandidate['category'], string> = {
  birdie: 'text-good',
  par: 'text-warn',
  bogey: 'text-bad',
};

/** The category this market bets — its own column now rather than folded into the pinned Player cell's subtitle, which duplicated the Hole column's own number. */
function GolfLineCell({ candidate }: { candidate: PickCandidate }) {
  return (
    <td className="whitespace-nowrap px-2 py-1 text-center text-[11px] font-semibold">
      <span className={GOLF_CATEGORY_TEXT_CLASS[candidate.category] ?? 'text-ink-muted'}>{candidate.categoryLabel}</span>
    </td>
  );
}

/** Odds — shared between MLB's column order and golf's (which now places it after Hole rather than first). */
function OddsCell({ row, candidate, onAdd }: { row: Row; candidate: PickCandidate; onAdd?: ScanTableProps['onAdd'] }) {
  return (
    <td className="px-2 py-1 text-center">
      {row.price != null ? (
        <span className="inline-flex items-center justify-center gap-1">
          <BookLogo bookId={row.bookmaker} size={11} />
          <OddsChip price={row.price} source={row.priceSource} capturedAt={row.priceCapturedAt} />
        </span>
      ) : onAdd ? (
        <button
          type="button"
          onClick={() => {
            // No prop-price feed exists; adding to the slip is where a price can actually be recorded.
            onAdd(candidate);
          }}
          title="No price posted for this market yet — this row can still qualify for Good Bets on performance or matchup alone, but check your sportsbook directly before betting it."
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap bg-[#fdf1d8] text-[#93630a] transition-colors hover:bg-[#fbe6b8]"
        >
          No Odds — Check Book
        </button>
      ) : (
        <span className="text-ink-faint">—</span>
      )}
    </td>
  );
}

/** Reason column — one pill per track a row cleared (goodBetReasons can return more than one). Same semantic-green styling as the rest of the app's positive/qualifying badges — the label carries the distinction, not the color. */
const REASON_STYLE: Record<GoodBetReason, { label: string; className: string }> = {
  edge: { label: 'E', className: 'bg-good/10 text-good' },
  performance: { label: 'P', className: 'bg-good/10 text-good' },
  matchup: { label: 'M', className: 'bg-good/10 text-good' },
};

/** Priority order for sorting the Reason column — performance outweighs edge outweighs matchup, matching goodBetReasons' own push order. A row's rank is its single best reason. */
const REASON_RANK: Record<GoodBetReason, number> = { performance: 3, edge: 2, matchup: 1 };
function reasonRank(reasons: GoodBetReason[]): number | null {
  if (reasons.length === 0) return null;
  return Math.max(...reasons.map((r) => REASON_RANK[r]));
}

/** Everything one row needs, computed once so sort and render agree exactly. */
interface Row {
  candidate: PickCandidate;
  key: string;
  windows: ReturnType<typeof windowSet>;
  h2h: ReturnType<typeof subsetWindow>;
  avgL10: ReturnType<typeof fixedWindow>;
  diff: ReturnType<typeof deltaFromLine>;
  price: number | null;
  priceSource?: string;
  priceCapturedAt?: string;
  bookmaker?: string;
  bookCount: number;
  impliedRaw: number | null;
  dvp: number | null;
  dvpLabel?: string;
  edge: number | null;
  /** Edge-resolution's modelProb — only set when a genuine live two-sided book price exists (see liveEdge.ts's resolveCandidateEdge); null far more often than the model actually having an answer. Kept as-is for the Edge column's own math. */
  modelProb: number | null;
  /** The model's own probability, independent of whether a live price exists to compare it against — straight off subjectMeta, same source computePropScore's `M` component reads. This is what the Model % column and its sort key use. */
  ownModelProb: number | null;
  marketProb: number | null;
  /** Which Good Bets track(s) this row qualifies on, in priority order — empty when `trustedMarkets` wasn't supplied to `buildRow` (i.e. outside the Good Bets tab). */
  reasons: GoodBetReason[];
  /** Which specific performance sub-criteria matched — short form shown right in the pill, long form (with thresholds) as its tooltip. Both null when `performance` isn't one of `reasons`. */
  performanceLabel: string | null;
  performanceDetail: string | null;
  /** Prop Score v1 — null when there's no model probability to build one from (see computePropScore). Shown regardless of `showReasons`, unlike the Good-Bets-only Reason column. */
  propScore: PropScore | null;
  trustTier: MarketTrust | null;
}

function meta(candidate: PickCandidate): Record<string, unknown> {
  return (candidate.subjectMeta ?? {}) as Record<string, unknown>;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function buildRow(
  candidate: PickCandidate,
  propRows: PropOddsRow[],
  userSportsbook: string,
  trustedMarkets?: ReadonlySet<string>,
  trustTiers?: ReadonlyMap<string, MarketTrust>,
): Row {
  const m = meta(candidate);
  const windows = windowSet(candidate.history, candidate.category);

  // H2H reads the opponent id the adapter stashed on each entry's `raw`.
  const opponentId = m.opponentId;
  const h2h = subsetWindow(
    candidate.history,
    candidate.category,
    (entry) => {
      const raw = entry.raw as { opponentId?: number } | null;
      return raw?.opponentId != null && opponentId != null && raw.opponentId === Number(opponentId);
    },
    { minimum: 1 },
  );

  const avgL10 = fixedWindow(candidate.history, candidate.category, 10);
  const diff = candidate.line != null ? deltaFromLine(avgL10, candidate.line) : null;

  // Real book prices from the five-provider feed, same resolution the Game
  // Detail candidate row uses — `candidate.odds` is only ever populated by a
  // manually-recorded slip price, so without this every stat market's Odds
  // column would sit empty regardless of what books actually have posted.
  const edgeInfo = resolveCandidateEdge(candidate, propRows, userSportsbook);

  const goodBetInput = {
    edge: edgeInfo.edge,
    marketProb: edgeInfo.marketProb,
    sampleSize: candidate.sampleSize,
    dimension: candidate.dimension,
    priceAmerican: edgeInfo.price,
    ...candidateGoodBetSignals(candidate),
  };
  const reasons = trustedMarkets ? goodBetReasons(goodBetInput, trustedMarkets) : [];
  const performanceDetails = reasons.includes('performance') ? performanceMatchDetails(goodBetInput) : [];
  const performanceLabel = performanceDetails.length > 0 ? performanceDetails.map((d) => d.short).join(', ') : null;
  const performanceDetail = performanceDetails.length > 0 ? performanceDetails.map((d) => d.long).join('; ') : null;

  const trustTier = trustTiers?.get(candidate.dimension) ?? null;
  const propScore = trustTier === 'excluded' ? null : computePropScore(candidate, edgeInfo);

  return {
    candidate,
    key: candidateKey(candidate),
    windows,
    h2h,
    avgL10,
    diff,
    price: edgeInfo.price,
    priceSource: edgeInfo.priceSource,
    priceCapturedAt: edgeInfo.priceCapturedAt,
    bookmaker: edgeInfo.bookmaker,
    bookCount: edgeInfo.bookCount,
    impliedRaw: edgeInfo.impliedRaw,
    dvp: typeof m.matchupRank === 'number' ? m.matchupRank : null,
    dvpLabel: str(m.matchupStatLabel),
    edge: edgeInfo.edge,
    modelProb: edgeInfo.modelProb,
    ownModelProb: typeof m.modelProb === 'number' ? m.modelProb : null,
    marketProb: edgeInfo.marketProb,
    reasons,
    performanceLabel,
    performanceDetail,
    propScore,
    trustTier,
  };
}

/** Sort key per column. Null sorts last in either direction. */
function sortValue(row: Row, column: SortColumn): number | null {
  switch (column) {
    case 'odds':
      return row.price;
    case 'ip':
      return row.impliedRaw;
    case 'edge':
      return row.edge;
    case 'modelProb':
      return row.ownModelProb;
    // A higher rank number means a softer opponent, which is the better matchup,
    // so descending on DVP puts the most exploitable defences on top.
    case 'dvp':
      return row.dvp;
    case 'avg':
      return averageOrNull(row.avgL10);
    case 'diff':
      return row.diff ? row.diff.absolute : null;
    case 'l5':
      return rateOrNull(row.windows.l5);
    case 'l10':
      return rateOrNull(row.windows.l10);
    case 'l15':
      return rateOrNull(row.windows.l15);
    case 'h2h':
      return rateOrNull(row.h2h);
    case 'strk':
      return row.windows.streak;
    case 'szn':
      return rateOrNull(row.windows.szn);
    case 'reason':
      return reasonRank(row.reasons);
    case 'score':
      return row.propScore?.score ?? null;
    case 'r1':
    case 'r2':
    case 'r3':
    case 'r4': {
      const entry = row.candidate.history.find((h) => h.period === Number(column.slice(1)));
      return entry ? entryValue(entry) : null;
    }
    case 'hole':
      return holeNumberOf(row.candidate.dimension);
    case 'thru': {
      const thru = meta(row.candidate).thru;
      return typeof thru === 'number' && thru > 0 ? thru : null;
    }
    // No natural numeric order, but a fixed birdie < par < bogey rank still
    // lets sorting group the same bet type together rather than doing nothing.
    case 'line':
      return { birdie: 0, par: 1, bogey: 2 }[row.candidate.category] ?? null;
    default:
      return null;
  }
}

export interface ScanTableProps {
  /** Picks the column set — golf's per-round score columns vs. MLB's game-window columns. Passed explicitly rather than inferred from `candidates[0]`, since candidates can arrive empty on first mount while a snapshot is still loading. */
  sport: Sport;
  candidates: PickCandidate[];
  pickedKeys?: Set<string>;
  watchedIds?: Set<string>;
  onAdd?: (candidate: PickCandidate, odds?: { americanOdds: string; source: string; bookmaker?: string }) => void;
  onToggleWatch?: (subjectId: string, subjectName: string) => void;
  loading?: boolean;
  /** Message for when filters exclude everything. */
  emptyMessage?: string;
  /** Real book prices from the five-provider feed, across the whole slate. */
  propRows?: PropOddsRow[];
  userSportsbook?: string;
  /** Markets whose calibration currently passes isMarketTrusted — required to show the Reason column, since a reason means nothing on an untrusted market. */
  trustedMarkets?: ReadonlySet<string>;
  /** Good Bets tab only — everywhere else, a "why" column for a bar the row isn't even being held to would be misleading. */
  showReasons?: boolean;
  /** Prop Score v1's Market Trust badge per dimension (lib/odds/props/marketTrust.ts) — shown alongside the Score column regardless of `showReasons`, since the score is useful everywhere Scan is used, not just the Good Bets tab. */
  trustTiers?: ReadonlyMap<string, MarketTrust>;
  /** Overrides the tab's usual default sort (reason for Good Bets, L10 hit rate everywhere else) — e.g. the Home Runs board defaults to 'modelProb' so it opens ranked by who's most likely to go deep, not by an unrelated hit-rate column. */
  defaultSortColumn?: SortColumn;
  defaultSortDir?: SortDir;
}

export function ScanTable({
  sport,
  candidates,
  pickedKeys,
  watchedIds,
  onAdd,
  onToggleWatch,
  loading = false,
  emptyMessage = 'No candidates match these filters.',
  propRows = [],
  userSportsbook = 'fanatics',
  trustedMarkets,
  showReasons = false,
  trustTiers,
  defaultSortColumn,
  defaultSortDir,
}: ScanTableProps) {
  const router = useRouter();
  // Good Bets defaults to ranking by which track a row cleared (performance
  // outweighs edge outweighs matchup) rather than by L10, since that
  // priority order is the whole point of sorting this tab in the first place.
  // Golf has no L10 column at all, so it defaults to TRN (tournament-to-date
  // rate) instead. `defaultSortColumn`/`defaultSortDir` (e.g. Home Runs ->
  // 'modelProb') take priority over both when the caller supplies them.
  const [sortCol, setSortCol] = useState<SortColumn>(
    defaultSortColumn ?? (showReasons ? 'reason' : sport === 'golf' ? 'szn' : 'l10'),
  );
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir ?? 'desc');

  // Row cap — MLB/golf's own slate never gets close to this, but NFL's
  // "All" view can carry 4000+ candidates at once (a 14-day scoreboard
  // window across every roster's every market), and mounting that many real
  // `<tr>`s in one commit — even scrolled off-screen under the table's own
  // max-height — is what was freezing the tab on every NFL page open. Same
  // "Show N more" convention NflTeamDetail's roster already uses.
  const PAGE_SIZE = 150;
  const [showAllRows, setShowAllRows] = useState(false);
  useEffect(() => {
    setShowAllRows(false);
  }, [candidates]);

  // Every hole-N candidate for every golfer carries one history entry per
  // round played so far — the union of periods across the whole slate is
  // "how many rounds has this tournament reached", capped at 4 (stroke play
  // never runs longer outside a playoff).
  const golfRounds = useMemo(() => {
    if (sport !== 'golf') return [];
    const rounds = new Set<number>();
    for (const c of candidates) for (const h of c.history) if (Number.isFinite(h.period)) rounds.add(h.period);
    const sorted = Array.from(rounds).sort((a, b) => a - b).slice(0, 4);
    return sorted.length > 0 ? sorted : [1];
  }, [candidates, sport]);

  const columns = useMemo(() => (sport === 'golf' ? golfColumns(golfRounds) : COLUMNS), [sport, golfRounds]);

  const rows = useMemo(() => {
    const built = candidates.map((c) => buildRow(c, propRows, userSportsbook, showReasons ? trustedMarkets : undefined, trustTiers));

    built.sort((a, b) => {
      if (sortCol === 'player') {
        const order = a.candidate.subjectName.localeCompare(b.candidate.subjectName);
        return sortDir === 'asc' ? order : -order;
      }

      const av = sortValue(a, sortCol);
      const bv = sortValue(b, sortCol);
      // Unknown always sinks, regardless of direction — a dash is not a low
      // score, and letting it float to the top on an ascending sort would
      // bury the rows the user asked to see.
      if (av === null && bv === null) return a.candidate.subjectName.localeCompare(b.candidate.subjectName);
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av === bv) return a.candidate.subjectName.localeCompare(b.candidate.subjectName);
      return sortDir === 'asc' ? av - bv : bv - av;
    });

    return built;
  }, [candidates, sortCol, sortDir, propRows, userSportsbook, showReasons, trustedMarkets, trustTiers]);

  const handleSort = (column: SortColumn) => {
    if (sortCol === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(column);
      // Numeric columns are almost always wanted best-first.
      setSortDir(column === 'player' ? 'asc' : 'desc');
    }
  };

  const openDetail = (candidate: PickCandidate) => {
    router.push(
      `/${candidate.sport}/player/${encodeURIComponent(candidate.subjectId)}?market=${encodeURIComponent(candidate.dimension)}`,
    );
  };

  if (loading && candidates.length === 0) return <ScanTableSkeleton />;

  if (candidates.length === 0) {
    return <div className="lb-card p-8 text-center text-sm text-ink-muted">{emptyMessage}</div>;
  }

  return (
    <div className="lb-card overflow-hidden">
      {/* One scroll container for both axes, so the sticky offsets share an
          origin and the pinned column and pinned header stay square. */}
      <div className="lb-scroll-x max-h-[calc(100vh-260px)] overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th
                scope="col"
                onClick={() => handleSort('player')}
                aria-sort={sortCol === 'player' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                // Both axes pinned, and above every other sticky cell.
                className="sticky left-0 top-0 z-30 cursor-pointer border-b border-line bg-paper px-2 py-1.5 text-left font-semibold text-ink-muted"
              >
                Player <SortMark active={sortCol === 'player'} dir={sortDir} />
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  title={column.title}
                  onClick={() => handleSort(column.key)}
                  aria-sort={sortCol === column.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className="sticky top-0 z-20 cursor-pointer whitespace-nowrap border-b border-line bg-paper px-2 py-1.5 text-center font-semibold text-ink-muted"
                >
                  {column.label} <SortMark active={sortCol === column.key} dir={sortDir} />
                </th>
              ))}
              <th
                scope="col"
                onClick={() => handleSort('score')}
                aria-sort={sortCol === 'score' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                title="Prop Score v1 — model conviction, live book edge, performance corroboration, and matchup, combined into one 0-100 rating. Market Trust badge underneath shows how much live-graded evidence backs this market's own model."
                className="sticky top-0 z-20 cursor-pointer whitespace-nowrap border-b border-line bg-paper px-2 py-1.5 text-center font-semibold text-ink-muted"
              >
                Score <SortMark active={sortCol === 'score'} dir={sortDir} />
              </th>
              {showReasons ? (
                <th
                  scope="col"
                  onClick={() => handleSort('reason')}
                  aria-sort={sortCol === 'reason' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title="Which Good Bets track(s) this row cleared, ranked Performance > Edge > Matchup — Performance (recent-form ladder, H2H, season rate, or hot streak — any one), Edge (real, priced), Matchup (opponent difficulty)"
                  className="sticky top-0 z-20 cursor-pointer whitespace-nowrap border-b border-line bg-paper px-2 py-1.5 text-center font-semibold text-ink-muted"
                >
                  Reason <SortMark active={sortCol === 'reason'} dir={sortDir} />
                </th>
              ) : null}
              {onAdd ? (
                <th scope="col" className="sticky top-0 z-20 border-b border-line bg-paper px-2 py-1.5">
                  <span className="sr-only">Add to slip</span>
                </th>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {(showAllRows ? rows : rows.slice(0, PAGE_SIZE)).map((row) => {
              const { candidate } = row;
              const m = meta(candidate);
              const added = pickedKeys?.has(row.key);
              const watched = watchedIds?.has(candidate.subjectId);

              return (
                <tr
                  key={row.key}
                  onClick={() => openDetail(candidate)}
                  className="group cursor-pointer border-b border-line/60 last:border-0 hover:bg-accent-soft/40"
                >
                  {/* 1 — Player / Line, pinned */}
                  <td className="sticky left-0 z-10 max-w-[190px] bg-card px-2 py-1 group-hover:bg-[#dcdee1]">
                    <div className="flex items-center gap-1.5">
                      {onToggleWatch ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleWatch(candidate.subjectId, candidate.subjectName);
                          }}
                          aria-pressed={watched}
                          aria-label={watched ? `Unfollow ${candidate.subjectName}` : `Follow ${candidate.subjectName}`}
                          className={`shrink-0 text-[13px] leading-none ${watched ? 'text-masters' : 'text-ink-faint hover:text-ink-muted'}`}
                        >
                          {watched ? '★' : '☆'}
                        </button>
                      ) : null}

                      <SubjectAvatar
                        name={candidate.subjectName}
                        headshotUrl={str(m.headshotUrl)}
                        fallbackUrl={str(m.flagUrl) ?? str(m.teamLogoUrl)}
                        size={22}
                      />

                      <div className="min-w-0 leading-tight">
                        <div className="flex items-baseline gap-1">
                          <span className="truncate text-[12px] font-semibold">{candidate.subjectName}</span>
                          {/* No `abbreviation` passed — the team code already
                              renders as its own text right after, so
                              TeamLogo's built-in text fallback would just
                              duplicate it on a failed image load. */}
                          <TeamLogo logoUrl={str(m.teamLogoUrl)} size={12} />
                          <span className="shrink-0 text-[10px] text-ink-faint">
                            {[str(m.team), str(m.position)].filter(Boolean).join(' ')}
                          </span>
                        </div>
                        {m.isHome === false || str(m.opponent) ? (
                          <div className="flex items-center gap-1 truncate text-[10px] text-ink-faint">
                            {m.isHome ? 'vs' : '@'}
                            <TeamLogo logoUrl={str(m.opponentLogoUrl)} size={12} />
                            {str(m.opponent) ?? ''}
                          </div>
                        ) : null}
                        {/* One phrase — "Under 0.5 Total Bases" — rather than a
                            direction+line chip and a separately-abbreviated
                            market chip that don't visually read as one claim.
                            Full mode, not compact: a compact "3B" is genuinely
                            ambiguous with the fielding position shown above it.
                            Golf-only: skipped — its own Line/Hole columns say
                            the same thing without repeating it under the name. */}
                        {sport !== 'golf' ? (
                          <div className="truncate">
                            <MarketLine
                              sport={candidate.sport}
                              dimension={candidate.dimension}
                              category={candidate.category}
                              line={candidate.line}
                              className="!text-[11px] !text-masters"
                            />
                          </div>
                        ) : null}
                        {/* Round Score rows only — who this golfer is grouped with today (inferred from shared tee time, see adapter.ts's buildGroups). Skipped on Hole Props rows, which are already dense with 18 rows per golfer. */}
                        {sport === 'golf' && candidate.dimension === 'round-score' && Array.isArray(m.groupedWith) && m.groupedWith.length > 0 ? (
                          <div className="truncate text-[10px] text-ink-faint">
                            w/ {(m.groupedWith as Array<{ name: string }>).map((g) => g.name).join(', ')}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>

                  {sport === 'golf' ? (
                    <>
                      {/* Line — which of the 3 categories this row bets, its own column now (was folded into the pinned Player cell's subtitle, duplicating the Hole column below). */}
                      <GolfLineCell candidate={candidate} />

                      {/* Hole — blank for round-score rows, which price the whole round rather than one hole. */}
                      <td className="px-2 py-1 text-center tabular-nums text-[11px] text-ink-muted">
                        {holeNumberOf(candidate.dimension) ?? <span className="text-ink-faint">—</span>}
                      </td>

                      <OddsCell row={row} candidate={candidate} onAdd={onAdd} />

                      {/* Thru — where the golfer actually is live, so the Hole
                          column's target reads as "N holes away" at a glance
                          instead of needing the live board open in another tab.
                          Pulses while thru sits mid-round (1-17): 0 means the
                          round hasn't teed off yet, 18 means today's round is
                          already in the books, neither is "live" right now. */}
                      <td className="px-2 py-1 text-center tabular-nums text-[11px] text-ink-muted">
                        {(() => {
                          const m = meta(candidate);
                          const thru = typeof m.thru === 'number' ? m.thru : null;
                          if (thru != null && thru > 0) {
                            const live = thru < 18;
                            return (
                              <span className="inline-flex items-center justify-center gap-1">
                                {live ? <span className="h-1.5 w-1.5 shrink-0 animate-lb-pulse rounded-full bg-good" /> : null}
                                <span className={live ? 'font-semibold text-good' : undefined}>Thru {thru}</span>
                              </span>
                            );
                          }
                          const teeTime = formatTeeTime(typeof m.teeTime === 'string' ? m.teeTime : null);
                          return teeTime ?? <span className="text-ink-faint">—</span>;
                        })()}
                      </td>

                      {/* Round scores — one cell per round played so far, colour-coded birdie(green)/par(amber)/bogey(red). */}
                      {golfRounds.map((n) => (
                        <GolfRoundCell key={n} entry={candidate.history.find((h) => h.period === n)} />
                      ))}
                      <GradientStreakCell streak={row.windows.streak} />
                      <GradientRateCell stat={row.windows.szn} showFraction />
                    </>
                  ) : (
                    <>
                      <OddsCell row={row} candidate={candidate} onAdd={onAdd} />

                      {/* 3 — Implied probability */}
                      <td className="px-2 py-1 text-center tabular-nums">
                        {row.impliedRaw != null ? (
                          <span
                            className="text-[11px] text-ink-muted"
                            title="Implied by the recorded price. Includes the book's margin — only one side is priced, so it can't be normalised."
                          >
                            {(row.impliedRaw * 100).toFixed(1)}%
                          </span>
                        ) : null}
                      </td>

                      {/* Edge — Phase C.1: model probability vs. de-vigged market price */}
                      <td className="px-2 py-1 text-center tabular-nums">
                        {row.edge != null ? (
                          <span
                            className="rounded px-1 py-0.5 font-semibold"
                            style={{ backgroundColor: compareInk(Math.min(1, Math.max(0, 0.5 + row.edge * 2))) }}
                            title={`Model ${((row.modelProb ?? 0) * 100).toFixed(1)}% vs. market ${((row.marketProb ?? 0) * 100).toFixed(1)}% (de-vigged, ${row.bookmaker ?? 'book unknown'}). Still early — check /diagnostics for how well-calibrated the model actually is before trusting this.`}
                          >
                            {row.edge > 0 ? '+' : ''}
                            {(row.edge * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[10px] text-ink-faint">—</span>
                        )}
                      </td>

                      {/* 4 — DVP */}
                      <td className="px-2 py-1 text-center tabular-nums">
                        {row.dvp != null ? (
                          <span
                            className="text-[11px]"
                            title={`Opponent ranks ${row.dvp} of 30 in ${row.dvpLabel ?? 'this stat'}`}
                          >
                            {row.dvp}
                          </span>
                        ) : (
                          <span className="text-[10px] text-ink-faint">N/A</span>
                        )}
                      </td>

                      {/* 5 — Avg L10 */}
                      <td className="px-2 py-1 text-center">
                        <AverageCell stat={row.avgL10} />
                      </td>

                      {/* 6 — Diff */}
                      <GradientDeltaCell delta={row.diff} />

                      {/* 7–9 — fixed windows; denominator is in the header. Each
                          cell renders its own `<td>` with a full-bleed gradient
                          wash (see GradientRateCell) rather than a ring on top of
                          a plain number, so strength reads at a glance without
                          needing the old "cleared its bar" highlight. */}
                      <GradientRateCell stat={row.windows.l5} />
                      <GradientRateCell stat={row.windows.l10} />
                      <GradientRateCell stat={row.windows.l15} />

                      {/* 10 — H2H: variable denominator, so it is disclosed */}
                      <GradientRateCell stat={row.h2h} showFraction />

                      {/* 11 — Streak */}
                      <GradientStreakCell streak={row.windows.streak} />

                      {/* 12 — Season: also variable */}
                      <GradientRateCell stat={row.windows.szn} showFraction />
                    </>
                  )}

                  {/* Score — Prop Score v1 */}
                  <td className="px-2 py-1 text-center">
                    <PropScoreBadge score={row.propScore} trust={row.trustTier} />
                  </td>

                  {showReasons ? (
                    <td className="px-2 py-1 text-center">
                      <div className="flex flex-wrap justify-center gap-1">
                        {row.reasons.map((reason) => (
                          <span
                            key={reason}
                            title={
                              reason === 'performance'
                                ? (row.performanceDetail ?? undefined)
                                : reason === 'edge' && row.edge != null
                                  ? `+${(row.edge * 100).toFixed(1)}% edge`
                                  : undefined
                            }
                            className={`rounded px-1 py-0.5 text-[10px] font-semibold ${REASON_STYLE[reason].className}`}
                          >
                            {REASON_STYLE[reason].label}
                          </span>
                        ))}
                      </div>
                    </td>
                  ) : null}

                  {onAdd ? (
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAdd(
                            candidate,
                            row.price != null
                              ? { americanOdds: String(row.price), source: row.priceSource ?? 'odds-api', bookmaker: row.bookmaker }
                              : undefined,
                          );
                        }}
                        disabled={added}
                        aria-label={added ? 'Already on slip' : `Add ${candidate.subjectName} to slip`}
                        className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                          added ? 'bg-accent-soft text-masters' : 'bg-masters text-white'
                        }`}
                      >
                        {added ? '✓' : '+'}
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!showAllRows && rows.length > PAGE_SIZE ? (
        <div className="border-t border-line p-2 text-center">
          <button
            type="button"
            onClick={() => setShowAllRows(true)}
            className="text-[12px] font-medium text-masters hover:underline"
          >
            Show {rows.length - PAGE_SIZE} more rows
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SortMark({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-[8px] text-ink-faint/40">↕</span>;
  return (
    <span className="text-[8px] text-masters" aria-hidden>
      {dir === 'asc' ? '▲' : '▼'}
    </span>
  );
}

/** Row-shaped placeholders, so loading doesn't collapse the layout. */
export function ScanTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="lb-card overflow-hidden">
      <div className="space-y-px p-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 py-1.5">
            <div className="h-[22px] w-[22px] shrink-0 animate-pulse rounded-full bg-line/40" />
            <div className="flex-1 space-y-1">
              <div className="h-2 w-1/3 animate-pulse rounded bg-line/40" />
              <div className="h-2 w-1/4 animate-pulse rounded bg-line/30" />
            </div>
            {Array.from({ length: 6 }).map((_, j) => (
              <div key={j} className="h-2 w-8 shrink-0 animate-pulse rounded bg-line/30" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ScanTable;
