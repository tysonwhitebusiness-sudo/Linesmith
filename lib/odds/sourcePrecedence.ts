/**
 * Which copy of a book's price a page believes (P5, audit finding F6).
 *
 * The scraper bridge (P6) brings the same book in more than once: DraftKings
 * read from DraftKings' own site, and DraftKings again relayed by an
 * aggregator. A relay re-confirms a price every few seconds that can be 11+
 * hours old (plan D23), so "the later `fetchedAt` wins" — the rule every
 * reader used before — would let a stale relayed copy beat the book's own
 * current price just by being checked more recently.
 *
 * The rule, in order:
 *   1. a first-hand copy (the book's own site, or the exchange itself) beats a
 *      relayed one;
 *   2. then the later `changedAt` ("since": when the price last changed),
 *      falling back to `fetchedAt` for rows written before P5;
 *   3. then the later `fetchedAt` ("checked").
 */

/** Scraper sources that read a book first-hand, and the books each one IS. */
export const FIRST_HAND_SOURCES: Readonly<Record<string, readonly string[]>> = {
  'scraper:draftkings': ['draftkings'],
  'scraper:fanduel': ['fanduel'],
  'scraper:betmgm': ['betmgm'],
  'scraper:betrivers': ['betrivers'],
  'scraper:pinnacle': ['pinnacle'],
  'scraper:kalshi': ['kalshi'],
  'scraper:polymarket': ['polymarket', 'polymarketus'],
  'scraper:sleeper': ['sleeper'],
  'scraper:underdog': ['underdog'],
  'scraper:vsin': ['circa', 'westgate', 'southpoint', 'wynn', 'stations', 'boomers', 'betmgmnv', 'caesarsnv'],
};

export function isFirstHand(providerId: string, bookmaker: string): boolean {
  const books = FIRST_HAND_SOURCES[providerId];
  return books != null && books.includes(bookmaker.toLowerCase());
}

interface Quote {
  providerId: string;
  bookmaker: string;
  changedAt?: string | Date | null;
  fetchedAt: string | Date;
}

/** `pg` hands timestamps back as Date objects; tests pass ISO strings. Both work. */
function ms(at: string | Date | null | undefined): number {
  if (at == null || at === '') return Number.NEGATIVE_INFINITY;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/** The quote to believe of two for the same book, side and line. Ties keep `a`. */
export function preferQuote<T extends Quote>(a: T, b: T): T {
  const fa = isFirstHand(a.providerId, a.bookmaker);
  const fb = isFirstHand(b.providerId, b.bookmaker);
  if (fa !== fb) return fa ? a : b;
  const ca = ms(a.changedAt ?? a.fetchedAt);
  const cb = ms(b.changedAt ?? b.fetchedAt);
  if (ca !== cb) return cb > ca ? b : a;
  return ms(b.fetchedAt) > ms(a.fetchedAt) ? b : a;
}
