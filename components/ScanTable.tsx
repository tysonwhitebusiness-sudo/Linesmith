'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HistoryEntry, PickCandidate, Sport } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';
import { confidenceOf, confidenceLabel, rankWithin, type RankedRow } from '@/lib/sports/propRanking';
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
import { OddsChip, NoOddsCell } from './OddsChip';
import { BookLogo } from './BookLogo';
import { resolveCandidateEdge, type PropOddsRow } from './usePropOdds';
import type { MarketTrust } from '@/lib/odds/props/marketTrust';

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
  | 'r1'
  | 'r2'
  | 'r3'
  | 'r4'
  | 'hole'
  | 'thru'
  | 'line'
  | 'rank'
  | 'proj'
  | 'model'
  | 'conf';

type SortDir = 'asc' | 'desc';

interface Column {
  key: SortColumn;
  label: string;
  /** Long form for the header's accessible name. */
  title: string;
  numeric: boolean;
}

/**
 * Phase 2 — `Avg L10` became `Proj`, and `Diff` changed meaning underneath it.
 *
 * Avg L10 was a ten-game mean: no volume term, no shrinkage, no league
 * baseline, no calibration. `Diff` was that mean minus the line, so it
 * inherited every one of those weaknesses while being the column people
 * actually sort on. The model is all four of those things and was validated on
 * ~31,000 held-out MLB rows, so `Proj` is the projection and `Diff` is
 * projection minus line.
 *
 * `Model %` sits beside `IP` by an explicit operator decision (2026-09-06).
 * Both are shown; NOTHING here computes, names, sorts by or colours the
 * difference between them, because that difference is an edge and no model in
 * this project has earned the right to claim one. The two columns are adjacent
 * and independent, and `tests/scan-no-edge.test.ts` holds that line.
 */
const COLUMNS: Column[] = [
  { key: 'odds', label: 'Odds', title: 'Price', numeric: true },
  { key: 'ip', label: 'IP', title: 'Implied probability, from the book price', numeric: true },
  { key: 'model', label: 'Model %', title: "Our model's probability of going over this line", numeric: true },
  { key: 'dvp', label: 'DVP', title: "Opponent's rank in this row's matchup stat", numeric: true },
  { key: 'proj', label: 'Proj', title: 'What the model projects for this market', numeric: true },
  { key: 'diff', label: 'Diff', title: 'Projection versus the line', numeric: true },
  { key: 'conf', label: 'Conf', title: 'How much history the projection rests on', numeric: true },
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
function OddsCell({
  row,
  candidate,
  onAdd,
  pending,
}: {
  row: Row;
  candidate: PickCandidate;
  onAdd?: ScanTableProps['onAdd'];
  pending: boolean;
}) {
  return (
    <td className="px-2 py-1 text-center">
      {row.price != null ? (
        <span className="inline-flex items-center justify-center gap-1">
          <BookLogo bookId={row.bookmaker} size={11} />
          <OddsChip price={row.price} source={row.priceSource} capturedAt={row.priceCapturedAt} />
        </span>
      ) : (
        // No prop-price feed exists; adding to the slip is where a price can actually be recorded.
        <NoOddsCell pending={pending} onAdd={onAdd ? () => onAdd(candidate) : undefined} />
      )}
    </td>
  );
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
  /** Sharp-reference minus the bettable book's implied price — a price-versus-price quantity from `usePropOdds`, not a model claim. Retained because `OddsCell` reads it for book context; deliberately NOT sortable, so the board cannot be ordered by it. */
  edge: number | null;
  /** Edge-resolution's modelProb — only set when a genuine live two-sided book price exists (see liveEdge.ts's resolveCandidateEdge); null far more often than the model actually having an answer. Kept as-is for the Edge column's own math. */
  modelProb: number | null;
  /** The model's own probability, independent of whether a live price exists to compare it against — straight off subjectMeta, same source computePropScore's `M` component reads. This is what the Model % column and its sort key use. */
  ownModelProb: number | null;
  marketProb: number | null;
  trustTier: MarketTrust | null;
  /**
   * The validated model's row for this (player, market), or null when this
   * sport/market has no fitted model or this player has too little history.
   * Null is why a row can appear on the board with no rank and no projection —
   * it is a real state, not a loading one.
   */
  projection: RankedRow | null;
}

/**
 * Phase 2 — where a row placed, in the leftmost cell.
 *
 * THREE TIERS, and the drop-off between them is the point: #1 has to read
 * instantly on a table of 150 rows without the rest of the list going noisy.
 *   1-3   filled chip, larger numeral, heaviest weight
 *   4-10  outlined chip, solid ink
 *   11+   no chip, muted ink
 *
 * NOT MEDALS. This is a graphite system and gold would fight everything else on
 * the page; the emphasis is carried by weight, fill and size instead of by hue,
 * which also means it survives dark mode and a colourblind reader unchanged.
 *
 * A null rank renders as blank rather than as a dash or a large number. Rows
 * without a projection are genuinely unplaced — the market has no fitted model,
 * or the player has too little history — and inventing a position for them at
 * the bottom of the list would be exactly the "unvalidated number next to a
 * validated one" the plan forbids.
 */
function RankChip({ rank }: { rank: number | null }) {
  if (rank == null) return <span className="w-6 shrink-0" aria-hidden />;
  if (rank <= 3) {
    return (
      <span
        className="inline-flex h-5 w-6 shrink-0 items-center justify-center rounded-md bg-ink text-[12px] font-bold tabular-nums text-paper"
        title={`Ranked #${rank} — by our model's probability against this market's league baseline`}
      >
        {rank}
      </span>
    );
  }
  if (rank <= 10) {
    return (
      <span
        className="inline-flex h-5 w-6 shrink-0 items-center justify-center rounded-md border border-line text-[11px] font-semibold tabular-nums text-ink"
        title={`Ranked #${rank}`}
      >
        {rank}
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-5 w-6 shrink-0 items-center justify-center text-[11px] tabular-nums text-ink-faint"
      title={`Ranked #${rank}`}
    >
      {rank}
    </span>
  );
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
  projection?: RankedRow | null,
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
  // Diff is PROJECTION minus line where the model has a projection, and falls
  // back to the trailing mean only where it does not. Both are labelled the
  // same because they answer the same question; they are not equally good at
  // it, which is why the model wins whenever it has an answer.
  const diffBasis = projection ? projection.projection : averageOrNull(avgL10);
  const diff =
    candidate.line != null && diffBasis != null
      ? {
          absolute: diffBasis - candidate.line,
          percent: candidate.line === 0 ? null : (diffBasis - candidate.line) / Math.abs(candidate.line),
        }
      : null;

  // Real book prices from the five-provider feed, same resolution the Game
  // Detail candidate row uses — `candidate.odds` is only ever populated by a
  // manually-recorded slip price, so without this every stat market's Odds
  // column would sit empty regardless of what books actually have posted.
  const edgeInfo = resolveCandidateEdge(candidate, propRows, userSportsbook);

  const trustTier = trustTiers?.get(candidate.dimension) ?? null;

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
    trustTier,
    projection: projection ?? null,
  };
}

/** Sort key per column. Null sorts last in either direction. */
function sortValue(row: Row, column: SortColumn): number | null {
  switch (column) {
    case 'odds':
      return row.price;
    case 'ip':
      return row.impliedRaw;
    case 'modelProb':
      return row.ownModelProb;
    // A higher rank number means a softer opponent, which is the better matchup,
    // so descending on DVP puts the most exploitable defences on top.
    case 'dvp':
      return row.dvp;
    // Ranking is ascending-best (#1 is the top), so the raw rank is negated:
    // every other numeric column here is "bigger is better" and the table's
    // shared comparator sinks nulls regardless of direction.
    case 'rank':
      // Sorting by delta is equivalent to sorting by rank and does not need the
      // renumbered map, which is derived FROM this sort.
      return row.projection?.delta ?? null;
    case 'proj':
      return row.projection ? row.projection.projection : averageOrNull(row.avgL10);
    case 'model':
      return row.projection?.probability ?? null;
    case 'conf':
      return row.projection ? row.projection.sampleSize : null;
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
  /** Markets whose calibration currently passes isMarketTrusted. Retained for the trust badge; no longer gates a Reason column, which went with Good Bets in Phase 2. */
  trustedMarkets?: ReadonlySet<string>;
  /** Market Trust badge per dimension (lib/odds/props/marketTrust.ts). */
  trustTiers?: ReadonlyMap<string, MarketTrust>;
  /** Overrides the table's default sort, which is the Phase 2 ranking — e.g. the Home Runs board passes 'modelProb' so it opens ranked by who is most likely to go deep. */
  defaultSortColumn?: SortColumn;
  defaultSortDir?: SortDir;
  /**
   * The validated model's row for a candidate, or null/undefined when it has
   * none. Supplied by the caller (`useProjections`) rather than fetched here so
   * the table stays a pure render of what it is handed, and so the seven sports
   * with no fitted model simply pass nothing.
   */
  projectionFor?: (candidate: PickCandidate) => RankedRow | null | undefined;
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
  trustTiers,
  defaultSortColumn,
  defaultSortDir,
  projectionFor,
}: ScanTableProps) {
  const router = useRouter();
  // Good Bets defaults to ranking by which track a row cleared (performance
  // outweighs edge outweighs matchup) rather than by L10, since that
  // priority order is the whole point of sorting this tab in the first place.
  // Golf has no L10 column at all, so it defaults to TRN (tournament-to-date
  // rate) instead. `defaultSortColumn`/`defaultSortDir` (e.g. Home Runs ->
  // 'modelProb') take priority over both when the caller supplies them.
  // Phase 2 — the ranking is the DEFAULT STATE of the table, not a tab and not
  // one sort among many. Golf has no fitted model, so it keeps its own default;
  // an explicit `defaultSortColumn` from the caller still wins.
  const [sortCol, setSortCol] = useState<SortColumn>(
    defaultSortColumn ?? (sport === 'golf' ? 'szn' : 'rank'),
  );
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir ?? 'desc');

  // Row cap — MLB/golf's own slate never gets close to this, but NFL's
  // "All" view can carry 4000+ candidates at once (a 14-day scoreboard
  // window across every roster's every market), and mounting that many real
  // `<tr>`s in one commit — even scrolled off-screen under the table's own
  // max-height — is what was freezing the tab on every NFL page open. Same
  // "Show N more" convention NflTeamDetail's roster already uses.
  const PAGE_SIZE = 150;
  // Rows revealed per click after the first page. The first page stays at
  // PAGE_SIZE for the mount-cost reason above; growing in smaller steps after
  // that keeps each subsequent commit cheap, where a single "show everything"
  // button could mount 694 rows in one go (measured on a real MLB board).
  const STEP = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
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
    const built = candidates.map((c) =>
      buildRow(c, propRows, userSportsbook, trustedMarkets, trustTiers, projectionFor?.(c)));

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
  }, [candidates, sortCol, sortDir, propRows, userSportsbook, trustedMarkets, trustTiers, projectionFor]);

  /**
   * The rank actually shown, renumbered over the rows on screen.
   *
   * `useProjections` ranks the whole served board; this table is a filtered
   * view of it (no posted price, market/team/odds filters, the golf split), so
   * the served numbers do not describe this list. Rendering them directly
   * opened the board at "#117" with no #1 anywhere — the missing rows were real
   * and simply elsewhere, which is not something a reader can be expected to
   * reconstruct. Recomputed here, from the same metric, over exactly what is
   * rendered — which is also what makes filtering to one market produce a 1..N
   * leaderboard for free.
   */
  const displayRank = useMemo(() => {
    const withProjection = rows
      .map((r) => r.projection)
      .filter((p): p is RankedRow => p != null);
    const map = new Map<string, number>();
    for (const r of rankWithin(withProjection)) {
      if (r.globalRank != null) map.set(`${r.subjectId}|${r.marketKey}`, r.globalRank);
    }
    return map;
  }, [rows]);

  // Cheapest real signal for "is the odds refresh for this slate still in
  // flight, or has it already run and this row genuinely has no coverage" —
  // see NoOddsCell's doc comment in OddsChip.tsx. Golf excluded: no book
  // prices hole props at all (a permanent, structural gap, not a transient
  // one — see golfColumns' own comment above), so EVERY golf row always has
  // price == null and the heuristic would misread that as "still loading"
  // forever instead of the real "Check Book" state.
  const oddsPending = useMemo(
    () => sport !== 'golf' && rows.length > 0 && rows.every((r) => r.price == null),
    [rows, sport],
  );

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
    // Soccer/tennis routes are league/tour-scoped (`/soccer/[league]/player/...`,
    // `/tennis/[tour]/player/...`) — every other sport's own player route
    // has no such segment. `subjectMeta.league` carries the real scope both
    // adapters already stamp onto every candidate (soccer's `league` field,
    // tennis's `tour`-mirroring `league` field in lib/sports/tennis/adapter.ts).
    const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
    const league = typeof meta.league === 'string' ? meta.league : undefined;
    const base = (candidate.sport === 'soccer' || candidate.sport === 'tennis') && league ? `/${candidate.sport}/${league}` : `/${candidate.sport}`;
    router.push(`${base}/player/${encodeURIComponent(candidate.subjectId)}?market=${encodeURIComponent(candidate.dimension)}`);
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
              {onAdd ? (
                <th scope="col" className="sticky top-0 z-20 border-b border-line bg-paper px-2 py-1.5">
                  <span className="sr-only">Add to slip</span>
                </th>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {rows.slice(0, visibleCount).map((row) => {
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
                      <RankChip
                        rank={
                          row.projection
                            ? (displayRank.get(`${row.projection.subjectId}|${row.projection.marketKey}`) ?? null)
                            : null
                        }
                      />
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

                      <OddsCell row={row} candidate={candidate} onAdd={onAdd} pending={oddsPending} />

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
                      <OddsCell row={row} candidate={candidate} onAdd={onAdd} pending={oddsPending} />

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

                      {/* 4 — Model %. Sits directly beside IP by operator
                          decision (2026-09-06). Deliberately styled the SAME as
                          IP — same size, same weight, same muted ink — because
                          any visual asymmetry between them would start to read
                          as a recommendation about which one is right, and the
                          difference between them is an edge this project has not
                          earned the right to claim. No colour, no arrow, no
                          delta. */}
                      <td className="px-2 py-1 text-center tabular-nums">
                        {row.projection?.probability != null ? (
                          <span
                            className="text-[11px] text-ink-muted"
                            title={`Our model's probability of going over ${row.projection.line ?? 'the line'}. Calibrated on held-out games; not a comparison to the book's price.`}
                          >
                            {(row.projection.probability * 100).toFixed(1)}%
                          </span>
                        ) : null}
                      </td>

                      {/* 5 — DVP */}
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

                      {/* 6 — Proj. THE HERO NUMBER in this cell: bold and
                          tabular, with its unit muted after it, so the eye lands
                          on the quantity rather than on the word. Falls back to
                          the trailing ten-game mean where the model has nothing
                          for this row, visibly marked so the two are never
                          confused for each other. */}
                      <td className="px-2 py-1 text-center">
                        {row.projection ? (
                          <span className="inline-flex items-baseline gap-1">
                            <span className="text-[13px] font-semibold tabular-nums text-ink">
                              {row.projection.projection.toFixed(2)}
                            </span>
                            <span className="text-[10px] text-ink-faint">{row.projection.unit}</span>
                          </span>
                        ) : (
                          <span title="No model projection for this market yet — showing the trailing 10-game average instead.">
                            <AverageCell stat={row.avgL10} />
                          </span>
                        )}
                      </td>

                      {/* 7 — Diff: projection minus line (see buildRow). */}
                      <GradientDeltaCell delta={row.diff} />

                      {/* 8 — Confidence. Sample size made legible: a nine-game
                          callup must not read like a career regular on a board
                          that ranks them against each other. The real count is
                          in the tooltip, because the bucket is the thing to scan
                          and the number is the thing to check. */}
                      <td className="px-2 py-1 text-center">
                        {row.projection ? (
                          (() => {
                            const c = confidenceOf(row.projection.sampleSize);
                            const tone =
                              c === 'high' ? 'text-ink' : c === 'medium' ? 'text-ink-muted' : 'text-ink-faint';
                            return (
                              <span
                                className={`text-[10px] ${tone}`}
                                title={`${confidenceLabel(c)} — ${row.projection.sampleSize} games behind this projection`}
                              >
                                {confidenceLabel(c)}
                              </span>
                            );
                          })()
                        ) : (
                          <span className="text-[10px] text-ink-faint">—</span>
                        )}
                      </td>

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
      {/* ALWAYS RENDERED WHEN THERE ARE ROWS, even with nothing left to reveal.
          An absent footer is ambiguous: "no button because every row is already
          on screen" and "the button is broken" look identical. Late on a slate
          this matters — Scan drops candidates whose game is `done`, so a board
          that carried 844 rows in the afternoon legitimately falls to 33 at
          midnight, and the count is what makes that legible rather than
          alarming. */}
      {rows.length > 0 ? (
        <div className="flex items-center justify-center gap-3 border-t border-line p-2 text-center">
          <span className="text-[12px] text-ink-muted">
            Showing {Math.min(visibleCount, rows.length).toLocaleString()} of{' '}
            {rows.length.toLocaleString()}
          </span>
          {visibleCount < rows.length ? (
            <>
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + STEP)}
                className="text-[12px] font-medium text-masters hover:underline"
              >
                Show {Math.min(STEP, rows.length - visibleCount)} more
              </button>
              <button
                type="button"
                onClick={() => setVisibleCount(rows.length)}
                className="text-[12px] text-ink-muted hover:text-ink hover:underline"
              >
                Show all {rows.length.toLocaleString()}
              </button>
            </>
          ) : null}
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
