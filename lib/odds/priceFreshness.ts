/**
 * How current a set of prices is — Phase 6.17.
 *
 * `OddsChip` has carried a `priceAge` helper and a 30-minute stale threshold
 * since before this task existed. **The board never passed it a `capturedAt`**,
 * so every relative timestamp and every stale marker on the price grid was
 * dead code: the machinery worked and nothing reached it. That is the same
 * dead-consumer shape this repo has been bitten by repeatedly, in the other
 * direction — a producer with no caller rather than a caller with no producer.
 *
 * This module adds the part `OddsChip` cannot: a per-chip age says how old ONE
 * price is, and says nothing about whether the board as a whole is trustworthy.
 * "22 books, updated 3 min ago, 4 stale" is the sentence a reader actually
 * needs, and it takes the whole set to compute.
 *
 * THE THRESHOLD IS SHARED, NOT REDECLARED. `OddsChip.STALE_AFTER_MS` and this
 * must agree or a chip will show a stale marker while the summary above it
 * reports everything fresh — two numbers on one screen disagreeing about the
 * same fact. It lives here and `OddsChip` imports it.
 */

/**
 * Past this, a price is stale.
 *
 * 30 minutes, matching what `OddsChip` already used. Grounded in the writer:
 * the Python worker's Tier 1 refresh runs about every 2.5 minutes, so a price
 * older than half an hour has missed roughly a dozen chances to update and is
 * far more likely to mean "this book stopped quoting" than "nothing changed".
 */
export const STALE_AFTER_MS = 30 * 60_000;

export interface PriceCoverage {
  /** Distinct bookmakers with at least one price. */
  books: number;
  /** Books whose most recent price is older than `STALE_AFTER_MS`. */
  stale: number;
  /** Most recent capture across every row, ISO. `null` when nothing carried one. */
  newestAt: string | null;
  /** Oldest capture among the books being counted, ISO. */
  oldestAt: string | null;
}

/**
 * Coverage for one market's rows.
 *
 * Staleness is computed PER BOOK on that book's newest price, not per row. A
 * book quoting both sides has two rows and one freshness; counting rows would
 * report a two-sided book as twice as stale as a one-sided one, which is a
 * statement about how many prices it posts rather than about how current it is.
 */
export function priceCoverage(
  rows: ReadonlyArray<{ bookmaker: string; fetchedAt: string }>,
  now: number = Date.now(),
): PriceCoverage {
  const newestByBook = new Map<string, number>();
  for (const r of rows) {
    const t = Date.parse(r.fetchedAt);
    if (!Number.isFinite(t)) continue;
    const prev = newestByBook.get(r.bookmaker);
    if (prev == null || t > prev) newestByBook.set(r.bookmaker, t);
  }

  if (newestByBook.size === 0) {
    // Rows with no parseable timestamp are not "fresh" and not "stale" — they
    // are unmeasured, and the caller renders no coverage line at all rather
    // than a confident zero.
    return { books: new Set(rows.map((r) => r.bookmaker)).size, stale: 0, newestAt: null, oldestAt: null };
  }

  const times = [...newestByBook.values()];
  return {
    books: newestByBook.size,
    stale: times.filter((t) => now - t > STALE_AFTER_MS).length,
    newestAt: new Date(Math.max(...times)).toISOString(),
    oldestAt: new Date(Math.min(...times)).toISOString(),
  };
}

/** "just now", "3m ago", "2h ago", "4d ago". `null` for an unparseable input. */
export function relativeAge(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.floor((now - ms) / 60_000);
  // A price stamped in the future is a clock problem, not a fresh price. Saying
  // "just now" would hide it; saying nothing lets the absence be noticed.
  if (minutes < 0) return null;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * The one-line summary: "22 books · updated 3 min ago · 4 stale".
 *
 * `null` when nothing is measurable — a coverage line that cannot say how old
 * the prices are is worse than none, because it implies they were checked.
 */
export function coverageLine(coverage: PriceCoverage, now: number = Date.now()): string | null {
  const age = relativeAge(coverage.newestAt, now);
  if (age == null) return null;
  const parts = [`${coverage.books} book${coverage.books === 1 ? '' : 's'}`, `updated ${age}`];
  if (coverage.stale > 0) parts.push(`${coverage.stale} stale`);
  return parts.join(' · ');
}
