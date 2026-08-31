/**
 * The four analytics cards the design boards draw on every Player tab, built
 * from data every sport already carries — Phase 6.16, the Player Detail pass.
 *
 * ================== WHY THESE FOUR ARE ONE SHARED FILE ==================
 *
 * The board-vs-build audit (2026-08-31) found Player Detail at 13 of 20 cards.
 * Four of the seven missing ones — rolling form, the situational splits grid,
 * "where this sits", and game context — need NO new sourcing and NO per-sport
 * knowledge. Every one of them is a function of a candidate's own
 * `history: HistoryEntry[]` and its `line`, which is the single shape every
 * sport in this app already produces.
 *
 * So they are built once, here, and every sport's `playerDetailAdapter` gets
 * all four by calling `buildAnalyticsRoles` and spreading the result. That is
 * the same reasoning `CLAUDE.md`'s sport-adapter convention gives for the
 * shared components themselves: a block that does not differ by sport must not
 * be re-implemented per sport, or it drifts.
 *
 * `entryValue` (lib/core/windowedStat.ts) is what makes this possible. It
 * already turns every sport's result token into a number — golf's `E`/`-1`,
 * MLB's `2-4`, a plain count — and it is the same function the distribution
 * chart has always used. Nothing here re-parses a result string.
 *
 * ================ WHAT IS DELIBERATELY NOT HERE ================
 *
 * The other three missing Player cards are NOT in this file because they are
 * genuinely MLB-only and would be dishonest as "universal":
 *
 *  - **Advanced / Statcast** — a ball-tracking rollup. No other sport in this
 *    app has an equivalent feed.
 *  - **Quality of contact** — same feed.
 *  - **Why the model likes it** — needs per-factor model contributions, and
 *    `model_weights`/`model_calibration` hold 21 and 7 rows, every one `mlb`.
 *
 * A sport that cannot fill one of those leaves it null and the card does not
 * render, per the sport-adapter rule. Faking a universal version would put a
 * number on the page that nothing measured.
 */

import type { HistoryEntry } from '@/lib/core/types';
import { entryValue } from '@/lib/core/windowedStat';
import { MIDDOT, fmt } from '@/components/charts/tokens';

// ---------------------------------------------------------------------------
// Role shapes
// ---------------------------------------------------------------------------

/** ROLE 7 · Rolling form — the run of play, not the individual results. */
export interface RollingFormRole {
  title: string;
  subtitle?: string;
  /** Per-period values, oldest first. `NaN` where a period has no usable number. */
  values: number[];
  /** Trailing mean over `window` periods, positionally aligned to `values`. */
  mean: number[];
  /** The line being bet, drawn as a reference. `null` omits it. */
  line: number | null;
  labels: string[];
  window: number;
  decimals: number;
  emptyMessage: string;
}

/** ROLE 8 · Situational splits — cover rate by situation, as a heat grid. */
export interface SituationalSplitsRole {
  title: string;
  /** Row-major, matching `rowLabels` x `columnLabels`. */
  cells: Array<Array<{ key: string; value: number | null; sampleSize: number }>>;
  rowLabels: string[];
  columnLabels: string[];
  caption: string;
  emptyMessage: string;
}

/** ROLE 9 · Where this sits — the subject against its own peer pool. */
export interface WhereThisSitsRole {
  title: string;
  /** Every peer's value for the same market, the subject included. */
  population: number[];
  value: number | null;
  rank: number | null;
  poolSize: number;
  decimals: number;
  label: string;
  emptyMessage: string;
}

/** ROLE 10 · Game context — the handful of numbers that frame the bet. */
export interface GameContextRole {
  title: string;
  rows: Array<{ key: string; label: string; value: string }>;
  emptyMessage: string;
}

export interface AnalyticsRoles {
  rollingForm?: RollingFormRole | null;
  situationalSplits?: SituationalSplitsRole | null;
  whereThisSits?: WhereThisSitsRole | null;
  gameContext?: GameContextRole | null;
}

export const ANALYTICS_ROLE_KEYS = ['rollingForm', 'situationalSplits', 'whereThisSits', 'gameContext'] as const;
export type AnalyticsRoleKey = (typeof ANALYTICS_ROLE_KEYS)[number];

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

/** `raw` is `unknown` on `HistoryEntry` by design; this is the one place that narrows it. */
function rawOf(entry: HistoryEntry): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

/**
 * Home/away for one entry, or `null` when the sport does not record it.
 *
 * ============= "vs" IS NOT EVIDENCE OF HOME. I SHIPPED THAT BUG. ===========
 *
 * The first version read `raw.isHome`, then fell back to the period label:
 * `@` meant away and `vs` meant home. On the real NFL page that produced a
 * "Home" row IDENTICAL to "All games" and an EMPTY "Away" row, because **every
 * NFL label says "vs"** -- "25-Wk1 vs SF" is the format whether the game was
 * home or away. The heuristic classified twenty of twenty games as home and
 * stated it as a percentage.
 *
 * Measured across the real snapshots: **no sport carries `isHome` on the wire
 * payload at all.** NFL's `raw` holds `opponentAbbr`/`season`/`week`; golf's
 * holds `strokes`/`relativeToPar` and has no venue concept; MLB's is trimmed
 * out by `historyTrim.ts` and rehydrated client-side, which is why MLB alone
 * produces a real split -- the adapter runs after rehydration.
 *
 * So the rule is asymmetric on purpose: `raw.isHome` is definitive, an `@` in
 * the label proves AWAY, and nothing proves HOME. Absence of a marker is
 * unknown, never home.
 */
function isHomeOf(entry: HistoryEntry): boolean | null {
  const raw = rawOf(entry);
  if (typeof raw.isHome === 'boolean') return raw.isHome;
  if ((entry.periodLabel ?? '').includes('@')) return false;
  return null;
}

/** Minimum entries in a cell before a rate is shown at all. Below this a rate is noise wearing a percentage sign. */
const MIN_CELL_SAMPLE = 3;

// ---------------------------------------------------------------------------
// ROLE 7 · Rolling form
// ---------------------------------------------------------------------------

/**
 * A trailing mean over the value series, with the line drawn through it.
 *
 * WHY A MEAN AND NOT THE RAW SERIES. The distribution chart beside this one
 * already shows every individual result; drawing them again as a line adds
 * nothing. What it cannot show is the TREND — a player at 1.4 over his last
 * five against a season mean of 0.9 is the thing a reader is looking for, and
 * a bar chart of alternating 0s and 2s hides it completely.
 *
 * `window` defaults to 5, clamped so a short history still produces a curve
 * rather than an empty chart: with 6 games a 5-game trailing mean has exactly
 * two points, which is a line but not an informative one.
 *
 * `NaN` FOR AN UNPARSEABLE PERIOD, never 0. `entryValue` returns null for a
 * result token it cannot read, and substituting 0 would drag the mean toward
 * zero and read as a genuinely bad game. `SeriesChart` already treats `NaN` as
 * a gap — that contract is why this is safe.
 */
export function toRollingForm(
  history: readonly HistoryEntry[],
  opts: { title: string; line?: number | null; window?: number; decimals?: number; subtitle?: string },
): RollingFormRole | null {
  const values = history.map((e) => {
    const v = entryValue(e);
    return v == null || !Number.isFinite(v) ? NaN : v;
  });
  const usable = values.filter((v) => Number.isFinite(v));
  // Two real points is the floor for a line. One is a dot, and zero is an
  // empty axis with a heading over it.
  if (usable.length < 2) return null;

  const window = Math.max(2, Math.min(opts.window ?? 5, Math.max(2, Math.floor(values.length / 2))));
  const mean = values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1).filter((v) => Number.isFinite(v));
    if (slice.length === 0) return NaN;
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });

  return {
    title: opts.title,
    ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
    values,
    mean,
    line: opts.line ?? null,
    labels: history.map((e) => e.periodLabel ?? String(e.period)),
    window,
    decimals: opts.decimals ?? 1,
    emptyMessage: 'Not enough games to draw a trend yet.',
  };
}

// ---------------------------------------------------------------------------
// ROLE 8 · Situational splits
// ---------------------------------------------------------------------------

/**
 * Cover rate by situation x recency — the board's heat grid.
 *
 * ROWS ARE SITUATIONS, COLUMNS ARE WINDOWS, and both are chosen so that every
 * cell answers the same question: "in this situation, over this many games,
 * how often did it go over the line?" That is one quantity in one unit, which
 * is what a heat grid needs; a grid whose cells mean different things is a
 * table wearing colour.
 *
 * A CELL BELOW `MIN_CELL_SAMPLE` RENDERS AS NULL, not as a percentage. Two
 * games at 100% is not a 100% cover rate, and the grid's own null handling
 * already draws an empty cell — this is the same floor `windowBox` applies for
 * the same reason.
 *
 * THE VENUE ROWS ARE OMITTED ENTIRELY when the sport records no home/away,
 * rather than collapsing every game into "Home". See `isHomeOf`.
 */
export function toSituationalSplits(
  history: readonly HistoryEntry[],
  line: number,
  opts: { title: string; wantOver?: boolean },
): SituationalSplitsRole | null {
  const wantOver = opts.wantOver !== false;
  const cleared = (e: HistoryEntry): boolean | null => {
    const v = entryValue(e);
    if (v == null || !Number.isFinite(v)) return null;
    return wantOver ? v > line : v < line;
  };

  // Newest first for the recency windows; `history` arrives oldest-first.
  const newestFirst = [...history].reverse();
  const windows: Array<{ key: string; label: string; n: number }> = [
    { key: 'l5', label: 'Last 5', n: 5 },
    { key: 'l10', label: 'Last 10', n: 10 },
    { key: 'l20', label: 'Last 20', n: 20 },
    { key: 'all', label: 'Season', n: newestFirst.length },
  ].filter((w, i, arr) => w.n > 0 && (i === 0 || w.n !== arr[i - 1].n));

  // BOTH SIDES OR NEITHER. A venue split needs a real sample on each side --
  // with only one populated, "Home 55%" beside an empty "Away" reads as a
  // finding about venue when it is a finding about the feed.
  const homeN = newestFirst.filter((e) => isHomeOf(e) === true).length;
  const awayN = newestFirst.filter((e) => isHomeOf(e) === false).length;
  const anyVenue = homeN >= MIN_CELL_SAMPLE && awayN >= MIN_CELL_SAMPLE;
  const rows: Array<{ key: string; label: string; match: (e: HistoryEntry) => boolean }> = [
    { key: 'all', label: 'All games', match: () => true },
    ...(anyVenue
      ? [
          { key: 'home', label: 'Home', match: (e: HistoryEntry) => isHomeOf(e) === true },
          { key: 'away', label: 'Away', match: (e: HistoryEntry) => isHomeOf(e) === false },
        ]
      : []),
  ];

  // A ONE-ROW GRID IS NOT A GRID, and worse, it is a DUPLICATE. The Form card
  // higher in the same column already shows this market's hit rate by L5/L10/
  // L15 window; a single "All games" row against the same windows restates it
  // with a colour ramp. The card earns its place only once there is a second
  // dimension to cross the windows with -- the same reasoning that keeps
  // `propsForGame` null on MLB because `LeftRail` already renders that list.
  if (rows.length < 2) return null;

  const cells = rows.map((r) =>
    windows.map((w) => {
      const scope = newestFirst.filter(r.match).slice(0, w.n);
      const graded = scope.map(cleared).filter((c): c is boolean => c !== null);
      const hit = graded.filter(Boolean).length;
      return {
        key: `${r.key}-${w.key}`,
        value: graded.length >= MIN_CELL_SAMPLE ? (hit / graded.length) * 100 : null,
        sampleSize: graded.length,
      };
    }),
  );

  // Every cell null means there is nothing to colour — a grid of empty squares
  // under a heading is worse than no card.
  if (!cells.some((row) => row.some((c) => c.value != null))) return null;

  return {
    title: opts.title,
    cells,
    rowLabels: rows.map((r) => r.label),
    columnLabels: windows.map((w) => w.label),
    caption: `share of games ${wantOver ? 'over' : 'under'} ${line}${MIN_CELL_SAMPLE > 1 ? ` · cells under ${MIN_CELL_SAMPLE} games left blank` : ''}`,
    emptyMessage: 'Not enough graded games to split yet.',
  };
}

// ---------------------------------------------------------------------------
// ROLE 9 · Where this sits
// ---------------------------------------------------------------------------

/**
 * The subject's season average against every peer's, as a distribution.
 *
 * WHY THIS IS NOT A PERCENTILE NUMBER. `DensityCurve`'s own header makes the
 * argument and it is the reason the block exists: 83rd percentile in a tightly
 * bunched field is a fraction better than average, and the same percentile in
 * a spread field is a real edge. The curve shows which; "83rd" cannot.
 *
 * THE POOL IS EVERY PEER ON THE SAME MARKET, which the page already holds —
 * the caller passes the slate's candidates for this dimension. That means the
 * pool is "players with a tracked line in this market tonight", not "the
 * league", and the label says so rather than implying a league-wide ranking we
 * did not compute.
 */
export function toWhereThisSits(
  subjectHistory: readonly HistoryEntry[],
  peers: ReadonlyArray<{ history: readonly HistoryEntry[] }>,
  opts: { title: string; label: string; decimals?: number; minGames?: number },
): WhereThisSitsRole | null {
  const minGames = opts.minGames ?? 3;
  const meanOf = (h: readonly HistoryEntry[]): number | null => {
    const vs = h.map(entryValue).filter((v): v is number => v != null && Number.isFinite(v));
    return vs.length >= minGames ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
  };

  const value = meanOf(subjectHistory);
  const population = peers.map((p) => meanOf(p.history)).filter((v): v is number => v != null);
  // A distribution needs a distribution. Below this the curve is a spike and
  // says less than the number already on the page.
  if (population.length < 8) return null;

  const rank = value == null ? null : population.filter((v) => v > value).length + 1;

  return {
    title: opts.title,
    population,
    value,
    rank,
    poolSize: population.length,
    decimals: opts.decimals ?? 2,
    label: opts.label,
    emptyMessage: 'Not enough players on this market to compare against.',
  };
}

// ---------------------------------------------------------------------------
// ROLE 10 · Game context
// ---------------------------------------------------------------------------

/**
 * The short list of numbers that frame the bet, as label/value rows.
 *
 * DERIVED, NEVER FETCHED. Every row here is computed from what the page
 * already has; this card exists so a reader does not have to reconstruct the
 * sample size and the season rate by eye from the chart above it.
 *
 * A row whose value is genuinely unknown is OMITTED rather than rendered as a
 * dash — a rail of dashes reads as a broken card, and the honest empty state
 * is the card not being there.
 */
export function toGameContext(
  history: readonly HistoryEntry[],
  /**
   * `null` for a market with no number to clear -- a moneyline, an anytime
   * scorer, a match winner. The line-dependent rows are then OMITTED and the
   * card still renders the rows that do not need one.
   *
   * IT USED TO RETURN NULL WITHOUT A LINE, and that was wrong: soccer's
   * "Anytime Goalscorer" page lost the whole card, even though games in scope,
   * season average and median are all perfectly well defined without a
   * threshold. Caught by walking the soccer page, not by a type.
   */
  line: number | null,
  opts: { title: string; wantOver?: boolean; extraRows?: Array<{ key: string; label: string; value: string }> },
): GameContextRole | null {
  const wantOver = opts.wantOver !== false;
  const values = history.map(entryValue).filter((v): v is number => v != null && Number.isFinite(v));
  const rows: Array<{ key: string; label: string; value: string }> = [];

  if (values.length > 0) {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    rows.push({ key: 'games', label: 'Games in scope', value: String(values.length) });
    rows.push({ key: 'mean', label: 'Season average', value: fmt.two(mean) });
    rows.push({ key: 'median', label: 'Median', value: fmt.two(median) });

    if (line != null && Number.isFinite(line)) {
      const cleared = values.filter((v) => (wantOver ? v > line : v < line)).length;
      rows.push({ key: 'line', label: 'Line', value: String(line) });
      rows.push({
        key: 'rate',
        label: `Cleared ${wantOver ? 'over' : 'under'}`,
        value: `${cleared} of ${values.length} ${MIDDOT} ${Math.round((cleared / values.length) * 100)}%`,
      });
      // The gap between the season average and the line, which is the single
      // number most readers are actually estimating in their head.
      rows.push({
        key: 'edge',
        label: 'Average vs line',
        value: `${mean - line >= 0 ? '+' : ''}${fmt.two(mean - line)}`,
      });
    }
  }

  for (const r of opts.extraRows ?? []) rows.push(r);
  if (rows.length === 0) return null;

  return { title: opts.title, rows, emptyMessage: 'No context available for this market.' };
}

// ---------------------------------------------------------------------------
// The one call every sport's adapter makes
// ---------------------------------------------------------------------------

/**
 * All four analytics roles for one candidate.
 *
 * ONE CALL, NOT FOUR, so a sport cannot wire three of them and quietly forget
 * the fourth — which is exactly how Player Detail arrived at 13 of 20 cards
 * with nobody noticing. Adding a fifth analytics card later means changing
 * this function, and every sport gets it in the same commit.
 *
 * `peers` is optional: a sport whose page does not hold a comparable pool
 * passes nothing and `whereThisSits` stays null, rather than the caller having
 * to know which of the four it can support.
 */
export function buildAnalyticsRoles(input: {
  history: readonly HistoryEntry[];
  /**
   * The line being bet. **Optional, because not every candidate has one** --
   * `PickCandidate.line` is `number | undefined` on several sports, and a
   * moneyline or match-winner market has no number at all.
   *
   * Without it, `rollingForm`, `whereThisSits` and `gameContext` still build
   * -- none of them needs a threshold for its core rows -- and
   * `situationalSplits` returns null rather than grading every game against a
   * fabricated 0.5. A cover rate against a line that does not exist is a wrong
   * number, not a missing one.
   */
  line?: number | null;
  /** Direction of the bet. Defaults to over. */
  wantOver?: boolean;
  /** What the stat is called on this sport's page, e.g. "Hits", "Receiving yards". */
  statLabel: string;
  /** Every other candidate on the same market, for the population curve. */
  peers?: ReadonlyArray<{ history: readonly HistoryEntry[] }>;
  extraContextRows?: Array<{ key: string; label: string; value: string }>;
}): AnalyticsRoles {
  const { history, line, wantOver, statLabel, peers, extraContextRows } = input;
  const hasLine = line != null && Number.isFinite(line);
  return {
    rollingForm: toRollingForm(history, {
      title: 'Rolling form',
      subtitle: statLabel,
      line: hasLine ? line : null,
    }),
    situationalSplits: hasLine
      ? toSituationalSplits(history, line, {
          title: 'Situational splits',
          ...(wantOver != null ? { wantOver } : {}),
        })
      : null,
    whereThisSits: peers
      ? toWhereThisSits(history, peers, {
          title: 'Where this sits',
          label: `${statLabel} per game · players on this market`,
        })
      : null,
    gameContext: toGameContext(history, hasLine ? line : null, {
      title: 'Game context',
      ...(wantOver != null ? { wantOver } : {}),
      ...(extraContextRows ? { extraRows: extraContextRows } : {}),
    }),
  };
}
