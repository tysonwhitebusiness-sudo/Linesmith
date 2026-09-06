/**
 * Phase 2 — the cross-market ranking Scan is organised by.
 *
 * THE PROBLEM. Scan shows every prop we can model, from every market, ranked
 * against each other. Raw projections cannot be compared across markets: 1.25
 * hits and 7.5 strikeouts are not the same kind of number. Probabilities alone
 * cannot either — every 0.5 line clears more often than every 4.5 line, so a
 * board sorted on probability is a board sorted on which markets happen to be
 * priced low.
 *
 * THE METRIC. `calibrated P(over) - league baseline for that market`. A 73%
 * chance to clear 0.5 hits is unremarkable when the league clears it 61%; a 52%
 * chance to clear 4.5 strikeouts against a league 11% is not. Both terms are
 * probabilities of the same event for the same market at the same line, which
 * is the only reason subtracting them means anything.
 *
 * THE BASELINE IS NOT `leagueRate`, and this is worth stating where the
 * subtraction happens rather than only in the migration that added it.
 * `prop_model_cache.league_rate` is the count-prop engine's per-CHANCE rate —
 * hits per plate appearance (0.222), strikeouts per out recorded (0.318). It is
 * a model parameter, not a probability. Subtracting it from a calibrated
 * probability is a unit error that yields a plausible-looking number instead of
 * an error, which is exactly the kind of mistake that ships. `leagueBaseline`
 * is P(stat > line), measured by the serving job from the same history it built
 * the projections from.
 *
 * WHAT RANKS GLOBALLY. Only rows carrying both a probability and a baseline.
 * A market whose calibration did not clear its gate has a null probability, and
 * nulls do not get a global position — they still appear, still show a
 * projection, and are still ranked within their own market. Nothing
 * unvalidated is given a number next to something validated.
 *
 * FILTERING RE-RANKS, AND THIS IS NOT OPTIONAL. `rankWithin` recomputes 1..N
 * over whatever subset is passed, so the same table is both the cross-market
 * board and the per-market leaderboard.
 *
 * It has to be applied to what is actually ON SCREEN, not to what was served.
 * Scan's table is not the served board: it drops candidates with no posted
 * price, among other filters. Rendering the served rank against that list
 * opened the board at #117 — the 116 rows above it were real, they were simply
 * somewhere else. A rank is a position in a list, so it has to be a position in
 * THE list the reader is looking at.
 *
 * WHAT IS DELIBERATELY ABSENT. No edge, no market/implied probability, no
 * price, no expected value. This module ranks a model against a league, which
 * is a claim about players. It never compares the model to a price, which would
 * be a claim about a market — see `tests/stats-board-no-edge.test.ts`.
 */
import type { StatsBoardData, StatsBoardRow } from './nhl/adapters/statsBoardAdapter';

/** One row, plus where it placed. */
export interface RankedRow extends StatsBoardRow {
  /** Which market this row belongs to — carried so a cross-market list stays self-describing after flattening. */
  marketKey: string;
  marketLabel: string;
  unit: string;
  volumeLabel: string;
  volumeUnit: string;
  /**
   * `probability - leagueBaseline`. Null whenever either input is null, which
   * is the signal "this row cannot be compared across markets", not a zero.
   */
  delta: number | null;
  /** 1-based position across every market. Null when `delta` is null. */
  globalRank: number | null;
  /** 1-based position within this row's own market. Always present: every row can be ordered against its own kind, on `delta` where there is one and on `projection` otherwise. */
  marketRank: number;
}

/**
 * How much history a projection rests on, bucketed for display.
 *
 * A nine-game callup and a full-career regular must not look alike on a board
 * that ranks them together, and a raw game count is not something a reader can
 * calibrate at a glance. The cuts follow the fits' own `min_prior_games` floor
 * of 5 — below about 20 games a count-prop projection is still mostly the
 * league prior showing through the shrinkage, which is worth saying out loud
 * rather than implying with a number.
 */
export type Confidence = 'low' | 'medium' | 'high';

export function confidenceOf(sampleSize: number): Confidence {
  if (sampleSize < 20) return 'low';
  if (sampleSize < 100) return 'medium';
  return 'high';
}

export function confidenceLabel(c: Confidence): string {
  return c === 'high' ? 'Deep history' : c === 'medium' ? 'Some history' : 'Thin history';
}

/** `probability - leagueBaseline`, or null when the row cannot be compared. */
export function deltaOf(row: StatsBoardRow): number | null {
  if (row.probability == null || row.leagueBaseline == null) return null;
  return row.probability - row.leagueBaseline;
}

/**
 * Flatten every market's rows into one list carrying its market's display
 * metadata, then assign both ranks.
 *
 * Ordering is by `delta` descending. Ties break on `projection` descending and
 * then on name, so the order is total and stable — a board whose rows shuffle
 * between renders reads as broken even when every number on it is right.
 */
export function rankAcrossMarkets(data: StatsBoardData): RankedRow[] {
  const flat: RankedRow[] = [];
  for (const m of data.markets) {
    for (const row of m.rows) {
      flat.push({
        ...row,
        marketKey: m.key,
        marketLabel: m.label,
        unit: m.unit,
        volumeLabel: m.volumeLabel,
        volumeUnit: m.volumeUnit,
        delta: deltaOf(row),
        globalRank: null,
        marketRank: 0,
      });
    }
  }

  const ranked = rankWithin(flat);

  // Per-market position, computed over each market's own rows so it is a real
  // leaderboard position rather than a filtered view of the global one.
  const byMarket = new Map<string, RankedRow[]>();
  for (const r of ranked) {
    const list = byMarket.get(r.marketKey);
    if (list) list.push(r);
    else byMarket.set(r.marketKey, [r]);
  }
  for (const rows of byMarket.values()) {
    [...rows].sort(compareRows).forEach((r, i) => {
      r.marketRank = i + 1;
    });
  }

  return ranked;
}

/**
 * Order rows and assign `globalRank` over exactly the rows given.
 *
 * Called again on every filtered subset — that is the point. Filtering by
 * market must renumber 1..N within that market rather than showing the gaps
 * left by rows that are no longer on screen, because a list whose first row is
 * "#47" is a list the reader has to do arithmetic on.
 *
 * Rows without a `delta` sort last and receive a null `globalRank`. They are
 * still ordered among themselves, by projection, so an uncalibrated market is
 * still a leaderboard rather than an arbitrary pile.
 */
export function rankWithin(rows: RankedRow[]): RankedRow[] {
  // Returns NEW objects rather than renumbering in place. The rows handed in
  // come from `useProjections`'s shared map, and a component that renumbered
  // them would be rewriting every other consumer's ranks as a side effect of
  // its own filtering — including on a re-render, where the numbers would then
  // depend on which component rendered last.
  let position = 0;
  return [...rows].sort(compareRows).map((r) => {
    if (r.delta == null) return { ...r, globalRank: null };
    position += 1;
    return { ...r, globalRank: position };
  });
}

function compareRows(a: RankedRow, b: RankedRow): number {
  // A comparable row always outranks an incomparable one, regardless of how
  // large the incomparable row's projection is.
  if (a.delta == null && b.delta != null) return 1;
  if (a.delta != null && b.delta == null) return -1;
  if (a.delta != null && b.delta != null && a.delta !== b.delta) return b.delta - a.delta;
  if (a.projection !== b.projection) return b.projection - a.projection;
  return a.subjectName.localeCompare(b.subjectName);
}
