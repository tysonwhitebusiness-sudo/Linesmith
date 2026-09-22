/**
 * The shared half of every sport's Slate adapter (S1).
 *
 * The same shape as the team page's `buildTeamResearch` (CLAUDE.md, R7): one
 * builder does the work every sport's Games section needs — status, the two
 * team rows, the lines block, the counts, the sort — and each sport's
 * `slateAdapter.ts` supplies a `SlateSpec` for the parts that genuinely differ
 * (MLB's probable starters, CFB's poll rank, soccer's draw price, which id a
 * logo is keyed on). Adding a column here means adding it once.
 *
 * LINE SANITY IS DONE HERE, not per sport (SL-1). Stale and exchange quotes are
 * in the data — a +10000 moneyline and a price of `0` were both live on
 * 2026-09-19 — and every sport reads the same table, so every sport needs the
 * same two rules: a quote under ±100 is not a price, and a quote more than 15
 * implied-probability points from the median of the rest is stale rather than
 * generous.
 */

import type { SlateGame } from '@/lib/odds/matching';
import type { BookmakerOdds, UnifiedGameLine } from '@/lib/odds/types';
import { decimalToAmerican, formatAmerican, formatPoint } from '@/lib/odds/display';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import type { SlateGameCard, SlateGamesSection, SlateLines, SlateMarket, SlateModelRow, SlateStatus, SlateTeam } from './slateShapes';

export interface SlateSpec {
  /** What the cards are: "games", "matches". */
  noun?: string;
  logoUrl?: (game: SlateGame, side: 'home' | 'away') => string | null | undefined;
  /** One line under a team's name — MLB's probable starter with his ERA and K. */
  teamNote?: (game: SlateGame, side: 'home' | 'away') => string | null | undefined;
  record?: (game: SlateGame, side: 'home' | 'away') => string | null | undefined;
  rank?: (game: SlateGame, side: 'home' | 'away') => number | null | undefined;
  /** Already-finished phrases: "Park −4% runs", "71° · wind 5 mph N · rain 0%". */
  context?: (game: SlateGame) => string[];
  href?: (game: SlateGame) => string | null;
  /** Under M1's display rule. A sport with no gated model returns null. */
  model?: (game: SlateGame) => SlateModelRow | null;
  /** Soccer's third outcome. */
  hasDraw?: boolean;
  /**
   * Draw no lines block at all, and say why.
   *
   * Set for soccer and tennis, and MEASURED rather than assumed: one EPL match
   * carried totals of 0.5, 1.5, 2.5, 3, 3.25, 3.5, 5.5, 6.5, 7.5 and 8.5
   * across twenty-one books, because `game_odds_book_lines` holds alternative
   * and derivative markets beside the main one and the per-book merge keeps one
   * row per book without recording WHICH market it was. Grouping on the modal
   * point fixes the football and baseball cases, where the pollution is mild;
   * it does not rescue soccer, where a "moneyline" can be a goal line and the
   * answer comes out confidently wrong.
   *
   * A blank block that says so is better than a number nobody can trust. S2
   * reads the history table in anger and is the place to sort the markets out.
   */
  hideLines?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Line sanity (SL-1)                                                         */
/* -------------------------------------------------------------------------- */

/** Below this a number is not an American price at all — `0` is the real case. */
const MIN_ABS_ODDS = 100;
/**
 * Below this many quoting books there is no CONSENSUS to report — one book's
 * number is that book's number. Rendering NFL caught it: a card printed a
 * +30.5 spread as the consensus off a single book. The cell still shows the
 * best price and says how many books there are; it just stops calling one
 * book a consensus.
 */
const MIN_BOOKS_FOR_CONSENSUS = 3;
/** Further than this from the median and the quote is stale, not generous. */
const MAX_IMPLIED_GAP_PTS = 15;
/**
 * And an absolute ceiling, because the median rule needs three books to work
 * and a thin market is exactly where a bad quote survives. Measured: a
 * +10000 NFL moneyline at one of two quoting books, 2026-09-20. Nothing
 * two-sided prices a game that far out; a number beyond this is a mis-keyed
 * row or a different market, not a long shot.
 */
const MAX_ABS_ODDS = 5000;

function impliedFromAmerican(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

/** The inverse, for turning a median PROBABILITY back into a price. */
function americanFromImplied(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return p > 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Every usable American price for one side, across books.
 *
 * Both rules apply in order and for a reason: the first drops a number that is
 * not a price, the second drops a price that is real but no longer live. They
 * are separate because a `0` has no median to be far from.
 */
export function sanePrices(raw: Array<number | undefined>): number[] {
  const prices = raw.filter(
    (p): p is number => typeof p === 'number' && Number.isFinite(p) && Math.abs(p) >= MIN_ABS_ODDS && Math.abs(p) <= MAX_ABS_ODDS,
  );
  if (prices.length < 3) return prices;
  const implied = prices.map(impliedFromAmerican);
  const mid = median(implied);
  if (mid == null) return prices;
  return prices.filter((_, i) => Math.abs(implied[i] - mid) * 100 <= MAX_IMPLIED_GAP_PTS);
}

/** The best (highest payout) of a set of sane American prices. */
function bestOf(prices: number[], books: string[]): { price: number; book: string } | null {
  let best: { price: number; book: string } | null = null;
  prices.forEach((p, i) => {
    if (!best || p > best.price) best = { price: p, book: books[i] };
  });
  return best;
}

interface SidedQuote {
  book: string;
  price?: number;
  point?: number;
}

/**
 * EVERY price on a `BookmakerOdds` is DECIMAL, not just the moneyline.
 *
 * Found by rendering: spreads and totals vanished from every MLB card while
 * the moneyline drew fine. `overPrice: 1.81` is not an American price under
 * ±100, so the sanity filter dropped all 24 books quoting a total — the only
 * survivors were the exchanges, whose decimal odds happen to exceed 100. The
 * type's own comment marks `homeOdds` as decimal and says nothing about the
 * rest, which is how the asymmetry survived being read twice.
 */
function quotesFor(books: BookmakerOdds[], market: 'moneyline' | 'spread' | 'total', side: 'home' | 'away' | 'over' | 'under' | 'draw'): SidedQuote[] {
  return books.map((b) => {
    if (market === 'moneyline') {
      const dec = side === 'home' ? b.homeOdds : side === 'away' ? b.awayOdds : b.drawOdds;
      return { book: b.bookmaker, price: decimalToAmerican(dec) };
    }
    if (market === 'spread') {
      return side === 'home'
        ? { book: b.bookmaker, price: decimalToAmerican(b.spreadHomePrice), point: b.spreadHome }
        : { book: b.bookmaker, price: decimalToAmerican(b.spreadAwayPrice), point: b.spreadAway };
    }
    return side === 'over'
      ? { book: b.bookmaker, price: decimalToAmerican(b.overPrice), point: b.point }
      : { book: b.bookmaker, price: decimalToAmerican(b.underPrice), point: b.point };
  });
}

/**
 * The point the most books are actually hanging, or null.
 *
 * NOT the median — measured on one EPL match, twenty-one books quoted totals
 * of 0.5, 1.5, 2.5, 3, 3.25, 3.5, 5.5, 6.5, 7.5 and 8.5, because the table
 * carries alternative and derivative lines beside the main one. The median of
 * that is 3.25, a number no book is offering. The MODE is 2.5, quoted six
 * times, which is the real line. Ties go to the lower number, which is the
 * conventional main line.
 */
function modalPoint(points: number[]): number | null {
  if (points.length === 0) return null;
  const counts = new Map<number, number>();
  for (const p of points) counts.set(p, (counts.get(p) ?? 0) + 1);
  let best: number | null = null;
  let bestN = 0;
  for (const [p, n] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return best;
}

/**
 * One market's three numbers.
 *
 * The consensus LINE is the modal point and the consensus PRICE is the median
 * of the prices AT that point — two different questions, answered separately,
 * because a book hanging a different number is not disagreeing about the price
 * of this one.
 */
function marketFor(line: UnifiedGameLine | undefined, market: 'moneyline' | 'spread' | 'total', side: 'home' | 'away' | 'over' | 'draw'): SlateMarket | null {
  if (!line) return null;
  const quotes = quotesFor(line.bookmakers ?? [], market, side === 'over' ? 'over' : side);
  let withPrice = quotes.filter((q) => typeof q.price === 'number');

  // For a spread or a total, first agree on WHICH line is being priced.
  // Everything after this compares like with like.
  let point: number | null = null;
  if (market !== 'moneyline') {
    point = modalPoint(withPrice.map((q) => q.point).filter((p): p is number => typeof p === 'number'));
    if (point != null) withPrice = withPrice.filter((q) => q.point === point);
  }

  const sane = sanePrices(withPrice.map((q) => q.price));
  const saneQuotes = withPrice.filter((q) => sane.includes(q.price as number));
  const books = saneQuotes.length;

  const best = bestOf(
    saneQuotes.map((q) => q.price as number),
    saneQuotes.map((q) => q.book),
  );

  let consensus: string | null = null;
  if (books < MIN_BOOKS_FOR_CONSENSUS) {
    consensus = null;
  } else if (market === 'moneyline') {
    // The median of AMERICAN odds is not a price: the middle of -150 and +130
    // is -10, which means nothing. Prices are medianed as implied
    // PROBABILITIES and converted back, which is the only operation the scale
    // supports. Found by rendering — one card's consensus read "0".
    const mid = median(sane.map(impliedFromAmerican));
    consensus = mid == null ? null : formatAmerican(americanFromImplied(mid));
  } else {
    // A spread is signed and a total is not: "O/U +8.5" is not a thing.
    consensus = point == null ? null : market === 'total' ? `O/U ${point}` : formatPoint(point);
  }

  if (consensus == null && best == null) return null;
  return {
    consensus,
    best: best ? { price: formatAmerican(best.price), book: best.book } : null,
    books: books || null,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * `state` is not one vocabulary: the sports' feeds spell a live game
 * "Live", "in", "In Progress", "Manager challenge" and "Delayed", which is why
 * `DateGameStrip` already matches it with a regex rather than an equality.
 * Matching on equality here put nine live MLB games in the "Final" bucket and
 * left the Live filter reading 0 with games plainly in progress on the strip
 * above it.
 */
const DONE_RE = /final|completed|game over|post|^done$/i;
const LIVE_RE = /live|in progress|manager challenge|delayed|^in$/i;

function statusOf(game: SlateGame): SlateStatus {
  const s = game.state ?? '';
  if (DONE_RE.test(s)) return 'done';
  if (LIVE_RE.test(s)) return 'live';
  return 'pre';
}

function timeText(iso: string | undefined): string {
  if (!iso) return 'Scheduled';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Scheduled';
  return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function statusText(game: SlateGame, status: SlateStatus): string {
  if (status === 'live') return game.livePeriod?.trim() || 'Live';
  if (status === 'done') return 'Final';
  return timeText(game.firstPitch);
}

function teamOf(game: SlateGame, side: 'home' | 'away', spec: SlateSpec): SlateTeam {
  const name = (side === 'home' ? game.homeTeamName : game.awayTeamName) ?? '';
  const score = side === 'home' ? game.liveScore?.home : game.liveScore?.away;
  return {
    name,
    logoUrl: spec.logoUrl?.(game, side) ?? null,
    record: spec.record?.(game, side) ?? null,
    rank: spec.rank?.(game, side) ?? null,
    note: spec.teamNote?.(game, side) ?? null,
    score: score ?? null,
  };
}

export interface BuildSlateInput {
  games: SlateGame[];
  /**
   * The slate's day. A SLATE IS A DAY: MLB's snapshot is already scoped to one,
   * but NFL's holds the week (46 games) and CFB's the whole Saturday board plus
   * the rest (201), and a page that shows all of them is a schedule, not a
   * slate. Days are Eastern, which is what a US sports day means — a 10pm ET
   * game belongs to the day it started, not to tomorrow in UTC.
   */
  date?: string;
  /** From `/api/odds/lines`' own reader; keyed by the sport's game id. */
  lines: UnifiedGameLine[];
  /** How many props the slate holds per game id. */
  propCounts?: Map<string, number>;
  spec: SlateSpec;
}

/**
 * The Games section, for any sport.
 *
 * It never asks which sport it is. Everything sport-shaped arrives through
 * `spec`, and a sport that does not answer a question leaves that part of the
 * card unset — which the card reads as "don't draw this", not as missing data.
 */
export function buildSlateGames({ games, lines, propCounts, spec, date }: BuildSlateInput): SlateGamesSection {
  const byId = new Map<string, UnifiedGameLine>();
  for (const l of lines) byId.set(String(l.eventId), l);

  const onDay = date ? games.filter((g) => !g.firstPitch || easternDate(new Date(g.firstPitch)) === date) : games;

  const cards: SlateGameCard[] = onDay.map((game) => {
    const id = String(game.gamePk ?? game.matchup ?? '');
    const status = statusOf(game);
    const line = spec.hideLines ? undefined : byId.get(id);
    const lineBlock: SlateLines = {
      spread: marketFor(line, 'spread', 'home'),
      total: marketFor(line, 'total', 'over'),
      moneyline: marketFor(line, 'moneyline', 'home'),
      draw: spec.hasDraw ? marketFor(line, 'moneyline', 'draw') : null,
    };
    const anyLine = Boolean(lineBlock.spread || lineBlock.total || lineBlock.moneyline || lineBlock.draw);
    const props = propCounts?.get(id) ?? null;
    return {
      id,
      status,
      statusText: statusText(game, status),
      startsAt: game.firstPitch ?? null,
      venue: game.venue ?? null,
      away: teamOf(game, 'away', spec),
      home: teamOf(game, 'home', spec),
      lines: anyLine ? lineBlock : null,
      model: spec.model?.(game) ?? null,
      context: spec.context?.(game) ?? [],
      href: spec.href?.(game) ?? null,
      propCount: props,
    };
  });

  cards.sort((a, b) => {
    const ta = a.startsAt ? Date.parse(a.startsAt) : Number.MAX_SAFE_INTEGER;
    const tb = b.startsAt ? Date.parse(b.startsAt) : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });

  // An empty day with a non-empty schedule is a real answer, and the reader
  // deserves the next date that has something rather than a bare "none".
  let note: string | null = null;
  if (date && cards.length === 0 && games.length > 0) {
    const later = games
      .map((g) => (g.firstPitch ? easternDate(new Date(g.firstPitch)) : null))
      .filter((d): d is string => d != null && d > date)
      .sort();
    note = later.length ? `Nothing on ${date}. The next ${spec.noun ?? 'games'} are on ${later[0]}.` : `Nothing on ${date}.`;
  }

  return {
    cards,
    counts: {
      all: cards.length,
      pre: cards.filter((c) => c.status === 'pre').length,
      live: cards.filter((c) => c.status === 'live').length,
      done: cards.filter((c) => c.status === 'done').length,
    },
    noun: spec.noun ?? 'games',
    note,
  };
}

/* -------------------------------------------------------------------------- */
/* The generic-Elo model row (D9)                                             */
/* -------------------------------------------------------------------------- */

/** One row of what `game_picks` holds, reduced to what a Slate card can use. */
export interface EloPick {
  gameId: string;
  side: 'home' | 'away';
  prob: number | null;
}

/** D9's threshold: below this the pick is not worth marking at all. */
const RING_MIN_PROB = 0.65;

/**
 * The ring, for the sports on the generic Elo (NFL, CFB, NBA, NHL).
 *
 * Two rules, and both matter. The pick must be at least 65% — below that the
 * model is not saying much — AND it must go AGAINST the market favourite.
 * Measured: the Elo picks the favourite on 95-100% of games, so ringing every
 * pick would put a green mark on the favourite almost always, which is
 * decoration that reads as a recommendation (queue Q1). `againstFavourite` is
 * one boolean on the row, so ringing everything later is a one-line change.
 *
 * It carries NO probability. These models are baselines, and M1's display rule
 * says a baseline may show its pick and nothing beside a price.
 */
export function eloModelRow(
  game: SlateGame,
  picks: Map<string, EloPick>,
  line: UnifiedGameLine | undefined,
  abbrevs: [string, string],
): SlateModelRow | null {
  const id = String(game.gamePk ?? '');
  const pick = picks.get(id);
  if (!pick || pick.prob == null || pick.prob < RING_MIN_PROB) return null;

  const [awayAbbr, homeAbbr] = abbrevs;
  const label = pick.side === 'home' ? homeAbbr || (game.homeTeamName ?? '') : awayAbbr || (game.awayTeamName ?? '');
  if (!label) return null;

  // The market favourite is whichever side's median price implies more. With
  // no usable prices there is no favourite to differ from, so the card says
  // nothing rather than guessing.
  const homePrices = sanePrices((line?.bookmakers ?? []).map((b) => decimalToAmerican(b.homeOdds)));
  const awayPrices = sanePrices((line?.bookmakers ?? []).map((b) => decimalToAmerican(b.awayOdds)));
  if (homePrices.length === 0 || awayPrices.length === 0) return null;
  const homeImplied = median(homePrices.map(impliedFromAmerican));
  const awayImplied = median(awayPrices.map(impliedFromAmerican));
  if (homeImplied == null || awayImplied == null) return null;
  const favourite: 'home' | 'away' = homeImplied >= awayImplied ? 'home' : 'away';

  return {
    pick: label,
    detail: null,
    note: 'A simple rating of the two teams. It is not a price and it is not compared to one.',
    againstFavourite: pick.side !== favourite,
  };
}
