/**
 * The odds section's payload shapes (odds build P8, 2026-09-25). Sport-agnostic:
 * the player page, the game page, the team page and the Slate all read these,
 * and the pure functions beside this file (board, sharp, hold, …) compute
 * every number the approved mockup shows from them.
 *
 * The shape follows the mockup's own market model (`docs/design/odds-rebuild/
 * om-mock.js`: `cur` quotes, per-book `hist`, `open`, `moves`, `steam`) so the
 * port is line-for-line, with two changes: fields are named, and times are
 * absolute ISO strings (the mockup kept a relative "checked N s ago").
 */
import type { MoneyPayload } from './money';

/** One book's current price on one side at one line. */
export interface OddsQuote {
  book: string;              // canonical bookmaker (lib/odds/books/registry.ts)
  side: string;              // home | away | draw | over | under | yes | no | other
  line: number | null;       // the side's own number (a spread is per side: home -4.5 / away +4.5)
  price: number;             // American
  since: string;             // ISO: when the price last changed at the source ("price since")
  checkedAt: string | null;  // ISO: when a source last confirmed it ("checked")
  source: string;            // who we read it from (scraper source or provider id)
  main: boolean;             // the book's main line for this market
  extra?: Record<string, unknown> | null;  // limit, bid/ask, volume, multiplier, …
}

/** A book's line history: [at, line (side A), price side A, price side B]. */
export type HistPoint = [at: string, line: number | null, priceA: number | null, priceB: number | null];

/** The first price recorded for a book (D21). Side A's line and both prices. */
export interface OpenerRow {
  at: string;
  line: number | null;
  priceA: number | null;
  priceB: number | null;
  source?: string;           // first_seen | vsin_open | an_open | theoddsgap
  flagged?: boolean;         // failed odds_checks.opener_sanity: shown with "⚠ check", never "the opener"
  reason?: string | null;
}

/** A line move by one book: [at, book, from, to] (side A's line, or its price for a moneyline). */
export type MoveRow = [at: string, book: string, from: number | null, to: number | null];

/** Several books moving the same way in a short window, led by the first mover. */
export interface SteamRow {
  t: string;
  dir: number;
  books: string[];
  times: string[];
  from: number | null;
  to: (number | null)[];
}

/** A price a book stopped offering (P5 pulls), and when it came back. */
export interface PullRow {
  book: string;
  side: string;
  line: number | null;
  lastPrice: number | null;
  pulledAt: string;
  returnedAt: string | null;
}

export interface OddsMarket {
  key: string;               // e.g. fg_sp, fg_tot, receptions
  label?: string;
  cur: OddsQuote[];
  hist: Record<string, HistPoint[]>;
  open: Record<string, OpenerRow>;
  moves?: MoveRow[];
  steam?: SteamRow[];
  pulls?: PullRow[];
}

/** How a market's two sides and its line relate. */
export interface MarketSpec {
  kind: 'sp' | 'ml' | 'tot' | 'prop';
  sides: [string, string];
  /** A spread: side B's line is side A's negated. */
  signed?: boolean;
  /** A moneyline: no line at all. */
  noLine?: boolean;
}

export function marketSpec(kind: MarketSpec['kind']): MarketSpec {
  if (kind === 'sp') return { kind, sides: ['home', 'away'], signed: true };
  if (kind === 'ml') return { kind, sides: ['home', 'away'], noLine: true };
  return { kind, sides: ['over', 'under'] };
}

/** One row of the price board: a book's quotes at the selected line, else at its own main line. */
export interface BoardRow {
  book: string;
  group: string;
  qa: OddsQuote | null;      // side A
  qb: OddsQuote | null;      // side B
  /** True when the row is AT the selected line; false shows the book's own line, dimmed. */
  at: boolean;
  line: number | null;       // side A's line of the quotes shown
  checkedAt: string | null;  // the newer of the two checks
  since: string | null;      // the later of the two changes
  source: string;
  extra: Record<string, unknown> | null;
  opener: OpenerRow | null;
  mainLine: number | null;   // the book's main line on side A
  outlierA?: boolean;        // D19: far from every other book — "⚠ check", never best
  outlierB?: boolean;
}

export interface BestPrice {
  book: string;
  quote: OddsQuote;
}

export interface PlayerOddsPayload {
  sport: string;
  gameId: string;
  subjectId: string;
  asOf: string;
  markets: OddsMarket[];
  latency: SourceLatencyRow[];
  /** P10: Sleeper pick counts and Kalshi contracts for this player (the "Where the money is" card). */
  money?: MoneyPayload;
  /** P11: market edges passing every gate (Python, `market_edges`); absent while the kill switch or the self-check hides them. */
  edges?: MarketEdge[];
  /** P11: why edges show or not, and every market line's evaluation for the Edge card. */
  edgeView?: EdgeView;
  /** P12: the game's links to each book's event page (`game_reference` kind `book_link`, via the bridge), by book. */
  links?: Record<string, string>;
}

export interface GameOddsPayload {
  sport: string;
  gameId: string;
  asOf: string;
  /** Keyed `${period}_${market}`: fg_sp, fg_tot, fg_ml, 1h_sp, tt_home, … */
  markets: OddsMarket[];
  latency: SourceLatencyRow[];
  powerRatings: { subject: string; data: Record<string, unknown> }[];
  /** P10: the game's splits by source, DraftKings' split history and its exchange contracts. */
  money?: MoneyPayload;
  /** P11: market edges passing every gate; absent while hidden. */
  edges?: MarketEdge[];
  /** P11: why edges show or not, and every market line's evaluation for the Edge card. */
  edgeView?: EdgeView;
}

/**
 * What the Edge card shows when no edge passes (P11 follow-up, operator
 * 2026-09-26: "never blank"): Python's evaluation of every market line with a
 * sharp price — the best soft price, its fair price and EV (negative
 * included), and each gate's verdict (`market_edge_candidates`). Read only.
 */
export interface EdgeCandidate {
  marketKey: string;
  subjectId: string;
  line: number | null;       // side A's line (a spread's home point)
  reason: string | null;     // no sharp reference at all: why
  sharp: { book: string; prices: Record<string, number>; limit: number | null } | null;
  best: {
    side: string;
    book: string;
    price: number;
    fair: number;
    fairPrice: number;
    implied: number;
    edgePts: number;
    ev: number;
    passed: boolean;
    firstFailure: string | null;
    gates: { gate: string; ok: boolean; detail: string }[];
  } | null;
}

/**
 * One row of the Slate's Edge / EV ranking (slate-polish D, operator-approved
 * 2026-09-26): a market line's best soft price against Pinnacle's no-vig
 * price, as Python stored it in `market_edge_candidates`. Every number is
 * read, never computed on the page (tests/scan-no-edge.test.ts).
 */
export interface EdgeRankRow {
  kind: 'prop' | 'game';
  gameId: string;
  subjectId: string;
  marketKey: string;
  line: number | null;       // side A's line (a spread's home point)
  side: string;
  book: string;
  price: number;
  fair: number;
  fairPrice: number;
  ev: number;
  /** Passes every gate; passes every gate but the self-check is holding edges; or fails a gate. */
  status: 'edge' | 'held' | 'unverified';
  /** The first failed gate, and what it said (`g2_time`, "soft checked 429s ago > 3 min"). */
  gate: string | null;
  detail: string | null;
}

/** The ranking and why it may be short: the same states as `EdgeView`. */
export interface EdgeRanking {
  status: 'on' | 'paused' | 'off' | 'stale';
  reason: string | null;
  asOf?: string;
  rows?: EdgeRankRow[];
}

/** Whether edges show, and why not: the operator's switch, the self-check, or a stopped job. */
export interface EdgeView {
  status: 'on' | 'paused' | 'off' | 'stale';
  reason: string | null;
  /** When the edge check last ran (the candidates' time). */
  asOf?: string;
  /** Absent when `off` or `stale` (no numbers are shown then). */
  candidates?: EdgeCandidate[];
}

/**
 * One market edge (P11, E1): a soft book's price against a sharp reference's
 * fair price, as `predict/market_edge.py` computed and stored it. Every number
 * here is read, never computed on the page (O6, tests/scan-no-edge.test.ts):
 * `implied` and `fairPrice` are the stored fair probability and gap restated.
 */
export interface MarketEdge {
  kind: 'prop' | 'game';
  sport: string;
  gameId: string;
  subjectId: string;
  subjectName: string | null;
  /** The odds section's market key: `${period}_${market}` for a game line, the prop market key for a prop. */
  marketKey: string;
  side: string;
  line: number | null;       // the side's own line
  book: string;
  source: string;
  price: number;             // the soft book's American price
  fair: number;              // fair probability (the minimum across the de-vig methods)
  fairPrice: number;         // the same, as an American price
  implied: number;           // the soft price's implied probability
  edgePts: number;           // fair - implied
  ev: number;                // fair x decimal - 1
  softCheckedAt: string;
  softSince: string;
  sharpCheckedAt: string;
  passingSince: string;
  singleSource: boolean;
  reference: {
    book: string;
    prices: Record<string, number>;
    limit: number | null;
    priceTime: string | null;
    second: { book: string; fair: number } | null;
  };
}

export interface SourceLatencyRow {
  sport: string;
  measure: 'relay_delay' | 'follow_lag' | 'sharp_consistency';
  source: string;
  book: string;
  n: number;
  hitRate: number | null;
  medianS: number | null;
  provenFast: boolean;
}
