/**
 * The prop main line — which of a market's quoted lines is "the line" (R2).
 *
 * One rule, read by every adapter that turns `prop_odds` rows into a candidate.
 * Before it, six adapters each carried their own `bestRow`/`bestOverPrice`: take
 * every over row for a subject+market ACROSS ALL LINES and keep the highest
 * American price. On an alternate ladder the longest over price always sits on
 * the top rung, so that rule reliably chose the least likely line on the board —
 * Ben Shelton's aces (game 182766, 9 lines from 8.5 to 29.5 across 2 books)
 * rendered as 24.5 (F-B12). A pick'em payout of +100 won the same way.
 *
 * THE RULE (research-pages master plan §R2):
 *  1. Only pre-game quotes, and only the last one per book, side and line.
 *  2. Pick'em books never count as a price. Exchanges (novig, prophetx, kalshi,
 *     smarkets) post real two-sided prices and DO count.
 *  3. The main line is the one quoted on BOTH sides by the most books; ties go
 *     to the line whose prices sit nearest even.
 *  4. A yes/no market (no handicap, `line` null) keeps its null line when 2+
 *     books quote the yes side (stored as `over` or `other`).
 *  5. A market with only one-sided quotes is "alternates only" and gets no line.
 *
 * Measured 2026-09-14 against production: overs outnumber unders 2:1
 * (357,296 vs 168,036), so rule 3 disqualifying one-sided rungs is the rule
 * working, not a data gap.
 *
 * Pure: no database, and no clock unless a caller passes `now` (see `MainLineOptions`). `readPreGamePropOddsForGame` in
 * `lib/db/client.ts` supplies the pre-game rows; this module still filters on
 * the start time so a caller that passes current rows cannot leak an in-play
 * price into the answer.
 */

import type { OddsInfo, PickCandidate } from '@/lib/core/types';
import type { PropOddsRow } from '@/lib/db/client';
import { candidateCategoryToSide } from './entityResolution';

/**
 * Pick'em / DFS operators. Their "price" is a fixed payout multiplier, not odds
 * on the outcome. Only prizepicks (47,725 rows), underdog (25,498) and sleeper
 * (17,954) appeared in production on 2026-09-14; the rest are listed because
 * they can return. `pick6` is DraftKings' pick'em product, already a canonical
 * id in `entityResolution.ts`'s bookmaker aliases.
 */
export const PICKEM_BOOKS: ReadonlySet<string> = new Set([
  'prizepicks',
  'underdog',
  'sleeper',
  'dabble',
  'parlayplay',
  'betr',
  'chalkboard',
  'pick6',
]);

export function isPickemBook(bookmaker: string): boolean {
  return PICKEM_BOOKS.has(bookmaker.toLowerCase());
}

export type MainLineResult =
  | {
      kind: 'main';
      line: number;
      /** Books quoting both sides of `line`. */
      twoSidedBooks: number;
      /** Highest over price at `line`, among counted books. */
      over: PropOddsRow;
      under: PropOddsRow | null;
      /** Every line counted books quoted, ascending. */
      availableLines: number[];
    }
  | { kind: 'yes-no'; books: number; over: PropOddsRow }
  | { kind: 'alternates-only'; availableLines: number[] }
  /** Nothing countable: only pick'em quotes, only post-start quotes, or a yes/no market with fewer than 2 books. */
  | { kind: 'none' };

function impliedFromAmerican(american: number): number {
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}

/** `pg` hands `timestamptz` back as a `Date` despite the row type's string; `Date.parse` on one would drop the milliseconds. */
function timeOf(at: string | Date): number {
  return new Date(at).getTime();
}

function parseStart(startIso: string | null | undefined): number | null {
  // A bare date ("2026-09-14") has no start time; parsing it as UTC midnight
  // would discard every same-day quote. No time, no filter.
  if (!startIso || !startIso.includes('T')) return null;
  const t = Date.parse(startIso);
  return Number.isFinite(t) ? t : null;
}

/**
 * A rung this much older than its book's newest quote for the same market is
 * one the book has stopped offering. One NFL/CFB refresh cycle is 20 minutes;
 * every row one fetch writes shares a single `fetched_at`.
 */
export const SUPERSEDED_AFTER_MS = 30 * 60_000;

export interface MainLineOptions {
  /**
   * The clock, for deciding whether the game has started. Superseded rungs are
   * only dropped BEFORE the start: a started game's rows come from
   * `prop_odds_history`, which records a price when it changes, so a stable,
   * still-quoted rung carries an old timestamp there and would be dropped
   * wrongly. Omit to skip the check (the pure default).
   */
  now?: number;
}

/**
 * Last counted, pre-start quote per (book, side, line). `prop_odds` is keyed on
 * provider too, so one book arriving through two providers is two rows; the
 * later one stands for the book.
 *
 * SUPERSEDED RUNGS ARE DROPPED. `prop_odds` is an upsert that never deletes, so
 * a line a book pulled hours ago still reads as current. Measured 2026-09-14,
 * Mahomes passing yards (DEN @ KC): DraftKings moved 223.5 -> 220.5 -> 222.5
 * -> 225.5 -> 226.5 -> 221.5 during the day, every rung stayed, and its dead
 * 00:05 quote at 223.5 plus FanDuel's live 223.5 made 223.5 "the main line",
 * shown as "19h ago" on game day. The writer should delete them (plan R5e);
 * until it does, a rung older than its book's newest quote for the market by
 * more than `SUPERSEDED_AFTER_MS` does not count.
 */
export function lastPreGameQuotes(rows: PropOddsRow[], startIso?: string | null, options: MainLineOptions = {}): PropOddsRow[] {
  const start = parseStart(startIso);
  const counted = rows.filter((r) => !isPickemBook(r.bookmaker) && (start == null || timeOf(r.fetchedAt) <= start));

  const dropSuperseded = options.now != null && (start == null || options.now < start);
  const newestByBook = new Map<string, number>();
  if (dropSuperseded) {
    for (const r of counted) {
      const book = r.bookmaker.toLowerCase();
      newestByBook.set(book, Math.max(newestByBook.get(book) ?? 0, timeOf(r.fetchedAt)));
    }
  }

  const latest = new Map<string, PropOddsRow>();
  for (const r of counted) {
    const book = r.bookmaker.toLowerCase();
    if (dropSuperseded && timeOf(r.fetchedAt) < newestByBook.get(book)! - SUPERSEDED_AFTER_MS) continue;
    const key = `${book}|${r.side}|${r.line ?? 'null'}`;
    const prev = latest.get(key);
    if (!prev || timeOf(r.fetchedAt) > timeOf(prev.fetchedAt)) latest.set(key, r);
  }
  return [...latest.values()];
}

function highest(rows: PropOddsRow[]): PropOddsRow | null {
  return rows.length ? rows.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best)) : null;
}

/** Rows for ONE subject + market. */
export function pickMainLine(rows: PropOddsRow[], startIso?: string | null, options: MainLineOptions = {}): MainLineResult {
  const quotes = lastPreGameQuotes(rows, startIso, options);
  if (quotes.length === 0) return { kind: 'none' };

  const withLine = quotes.filter((q) => q.line != null);
  if (withLine.length === 0) {
    // The yes side arrives as `over` from some providers and as `other` from
    // SharpAPI, whose no-line selections the shared writer keeps under that name
    // (`db.write_prop_odds`). Measured on WTA to-win-a-set: every row is `other`.
    const overs = quotes.filter((q) => q.side === 'over' || q.side === 'other');
    const books = new Set(overs.map((q) => q.bookmaker.toLowerCase())).size;
    return books >= 2 ? { kind: 'yes-no', books, over: highest(overs)! } : { kind: 'none' };
  }

  const byLine = new Map<number, PropOddsRow[]>();
  for (const q of withLine) {
    const bucket = byLine.get(q.line!) ?? [];
    bucket.push(q);
    byLine.set(q.line!, bucket);
  }
  const availableLines = [...byLine.keys()].sort((a, b) => a - b);

  let best: { line: number; books: number; imbalance: number; lineRows: PropOddsRow[] } | null = null;
  for (const line of availableLines) {
    const lineRows = byLine.get(line)!;
    const overByBook = new Map<string, PropOddsRow>();
    const underByBook = new Map<string, PropOddsRow>();
    for (const r of lineRows) {
      const book = r.bookmaker.toLowerCase();
      if (r.side === 'over') overByBook.set(book, r);
      else if (r.side === 'under') underByBook.set(book, r);
    }
    const twoSided = [...overByBook.keys()].filter((b) => underByBook.has(b));
    if (twoSided.length === 0) continue;
    // Nearest even: how far the over and under implied probabilities sit apart,
    // averaged over the books quoting both. 0 is a coin flip.
    const imbalance =
      twoSided.reduce(
        (sum, b) => sum + Math.abs(impliedFromAmerican(overByBook.get(b)!.americanOdds) - impliedFromAmerican(underByBook.get(b)!.americanOdds)),
        0,
      ) / twoSided.length;
    if (!best || twoSided.length > best.books || (twoSided.length === best.books && imbalance < best.imbalance)) {
      best = { line, books: twoSided.length, imbalance, lineRows };
    }
  }

  if (!best) return { kind: 'alternates-only', availableLines };
  const over = highest(best.lineRows.filter((r) => r.side === 'over'))!;
  const under = highest(best.lineRows.filter((r) => r.side === 'under'));
  return { kind: 'main', line: best.line, twoSidedBooks: best.books, over, under, availableLines };
}

/**
 * What an adapter puts on a candidate for one subject+market: the line, the
 * price at it, and whether the market is only alternates.
 *
 * A `binary` market keeps `line: undefined` whatever the rule returns — its book
 * rows carry a null line, and `rowsFor`'s exact line match only finds them that
 * way. A `threshold` market with no main line also comes back with no line; the
 * adapter's history step then measures against `historyAverageLine`, the same
 * contract the priceless no-market candidates already use, rather than a 0.5
 * that means nothing for aces or passing yards.
 */
export function candidateLine(
  rows: PropOddsRow[],
  startIso: string | null | undefined,
  kind: 'threshold' | 'binary' = 'threshold',
  now: number = Date.now(),
): Pick<PickCandidate, 'line' | 'odds' | 'lineStatus'> {
  const result = pickMainLine(rows, startIso, { now });
  const odds = (row: PropOddsRow): OddsInfo => ({ americanOdds: String(row.americanOdds), source: 'odds-api', capturedAt: row.fetchedAt });
  if (kind === 'binary') {
    if (result.kind === 'yes-no' || result.kind === 'main') return { line: undefined, odds: odds(result.over) };
    return { line: undefined, odds: undefined };
  }
  if (result.kind === 'main') return { line: result.line, odds: odds(result.over) };
  if (result.kind === 'alternates-only') return { line: undefined, odds: undefined, lineStatus: 'alternates-only' };
  return { line: undefined, odds: undefined };
}

/** Model fields computed for a candidate's own line; they do not describe another line. */
const MODEL_FIELDS = ['modelProb', 'modelStdDev', 'modelSampleSize', 'modelVersion'];

/**
 * A candidate re-priced at the main line its rows show now (R6.1d). `rows` are
 * one subject's rows for the candidate's market.
 *
 * Two reasons a candidate's own line is not the page's line: MLB builds its
 * candidates on fixed board lines, and every other sport computes the main line
 * when the slate snapshot is built, which can be hours older than the rows the
 * page holds (measured 2026-09-15: Josh Allen's passing yards candidate at 249.5
 * while FanDuel's current main line was 248.5).
 *
 * `marketLine` is the line to open the stepper on (`null`: none, keep the
 * candidate's own). `priced` is the candidate to price, chart and slip at that
 * line, `null` when the candidate already is it; re-lined, it drops the model
 * fields, which were computed at the old line. An alternates-only market keeps
 * the candidate's line with the status and no price.
 */
export function repriceAtMainLine(
  candidate: PickCandidate,
  rows: PropOddsRow[],
  startIso: string | null | undefined,
  now: number = Date.now(),
): { marketLine: number | null; priced: PickCandidate | null } {
  if (rows.length === 0) return { marketLine: null, priced: null };
  const posted = candidateLine(rows, startIso, 'threshold', now);
  if (posted.lineStatus === 'alternates-only') return { marketLine: null, priced: { ...candidate, odds: undefined, lineStatus: 'alternates-only' } };
  if (posted.line == null || posted.line === candidate.line) return { marketLine: posted.line ?? null, priced: null };
  const meta = { ...(candidate.subjectMeta ?? {}) };
  for (const k of MODEL_FIELDS) delete meta[k];
  // THE CANDIDATE'S OWN SIDE. `candidateLine` prices the over, which is right
  // for the snapshot builders that call it (every candidate they make is an
  // over) but not here: MLB re-prices every candidate, and MLB makes unders,
  // no-hits and no-runs. Found in the R6 audit — an under re-lined from 4.5 to
  // 6.5 carried the best over price (-120) instead of the best under (+105).
  const main = pickMainLine(rows, startIso, { now });
  const underSide = candidateCategoryToSide(candidate.category) === 'under';
  const sideRow = main.kind === 'main' ? (underSide ? main.under : main.over) : null;
  const odds: OddsInfo | undefined = sideRow
    ? { americanOdds: String(sideRow.americanOdds), source: 'odds-api', capturedAt: sideRow.fetchedAt }
    : underSide
      ? undefined
      : posted.odds;
  return { marketLine: posted.line, priced: { ...candidate, line: posted.line, odds, lineStatus: undefined, subjectMeta: meta } };
}

/** A line from a player's own history: the average, rounded to the half, never below 0.5. `undefined` with no history. */
export function historyAverageLine(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.max(0.5, Math.round(avg * 2) / 2);
}
