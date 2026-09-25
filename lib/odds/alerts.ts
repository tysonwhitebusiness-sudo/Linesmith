/**
 * Your lines — alerts (odds build P12 §1). Pure: the route reads, this decides.
 *
 * For one tracked line (a player, a stat, a side and a number — no book and no
 * game on the row) and that player's market in their NEXT game, four alerts:
 *
 *   moved         the consensus main line is no longer the tracked number
 *   better_price  at the tracked line and side, the best book beats the
 *                 reader's book by 5 cents or more (decimal)
 *   pulled        the reader's book has an open pull at the tracked line and side
 *   steam         3+ books moved the same way within 30 minutes, after the
 *                 line was tracked
 *
 * Every alert has a stable id, `<tracked id>:<type>:<event time>`, so the same
 * event read twice is one alert and the viewer's "seen" state survives a poll.
 * Nothing here compares a price with a model (tests/scan-no-edge.test.ts).
 */
import { bookLabel } from './books/registry';
import { bookGroup } from './books/registry';
import { consensusLine } from './section/board';
import { fmtAmerican, fmtLine } from './section/format';
import { detectSteam, lineMoves } from './section/steam';
import { marketSpec, type OddsMarket, type OddsQuote } from './section/types';

export type AlertType = 'moved' | 'better_price' | 'pulled' | 'steam';

export interface TrackedLineInput {
  id: number;
  subjectName: string;
  statLabel: string;
  side: 'over' | 'under';
  line: number;
  createdAt: string;
}

export interface TrackedAlert {
  id: string;
  trackedLineId: number;
  type: AlertType;
  /** ISO: when the event happened (its part of the id). */
  at: string;
  text: string;
}

/** 5 cents, decimal (P12 §1). */
export const BETTER_PRICE_CENTS = 0.05;
/** Steam for an alert: 3+ books the same direction within 30 minutes (P12 §1). */
export const ALERT_STEAM_MS = 30 * 60 * 1000;
export const ALERT_STEAM_BOOKS = 3;

const dec = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const ms = (iso: string) => Date.parse(iso);

/**
 * The alerts for one tracked line. `market` is the player's market in the
 * next game (null: no upcoming game or no market key → no alerts);
 * `userBook` null skips the two "your book" alerts.
 */
export function trackedLineAlerts(t: TrackedLineInput, market: OddsMarket | null, userBook: string | null): TrackedAlert[] {
  if (!market) return [];
  const sp = marketSpec('prop');
  const out: TrackedAlert[] = [];
  const who = `${t.subjectName} ${t.statLabel}`;
  const push = (type: AlertType, at: string, text: string) =>
    out.push({ id: `${t.id}:${type}:${at}`, trackedLineId: t.id, type, at, text });

  // moved — the consensus main line against the tracked number; the first book to move names it.
  const modal = consensusLine(market, sp).modal;
  if (modal != null && modal !== t.line) {
    const moves = market.moves ?? lineMoves(market.hist);
    const first = moves.find(m => m[2] === t.line && m[3] !== t.line) ?? moves[moves.length - 1] ?? null;
    const at = first?.[0] ?? t.createdAt;
    const mover = first ? bookLabel(first[1]) : 'The books';
    push('moved', at, `${who} — your line moved: ${mover} ${fmtLine(first?.[2] ?? t.line)} → ${fmtLine(first?.[3] ?? modal)}`);
  }

  const atLine = (q: OddsQuote) => q.side === t.side && q.line === t.line;
  const quotes = market.cur.filter(q => atLine(q) && bookGroup(q.book) !== 'pickem');
  const mine = userBook ? quotes.find(q => q.book === userBook) ?? null : null;

  // better_price — the best book at the tracked line and side against the reader's book.
  if (mine) {
    const best = quotes.reduce<OddsQuote | null>((b, q) => (!b || dec(q.price) > dec(b.price) ? q : b), null);
    if (best && best.book !== mine.book && dec(best.price) - dec(mine.price) >= BETTER_PRICE_CENTS - 1e-9) {
      push('better_price', best.since,
        `${who} — a better price appeared: ${bookLabel(best.book)} ${fmtAmerican(best.price)} vs your ${bookLabel(mine.book)} ${fmtAmerican(mine.price)}`);
    }
  }

  // pulled — an open pull at the reader's book, at the tracked line and side.
  if (userBook) {
    const pull = (market.pulls ?? []).find(p => p.book === userBook && p.side === t.side && p.line === t.line && !p.returnedAt);
    if (pull) {
      const repost = market.cur.find(q => q.book === userBook && q.side === t.side && q.main && q.line !== t.line);
      push('pulled', pull.pulledAt,
        `${who} — ${bookLabel(userBook)} took ${fmtLine(t.line)} down${repost ? ` and reposted at ${fmtLine(repost.line)}` : ''}`);
    }
  }

  // steam — after the line was tracked, 3+ books within 30 minutes of the first mover.
  for (const s of market.steam ?? detectSteam(market.hist)) {
    if (ms(s.t) <= ms(t.createdAt)) continue;
    const within = s.times.filter(x => ms(x) - ms(s.t) <= ALERT_STEAM_MS);
    if (within.length < ALERT_STEAM_BOOKS) continue;
    const mins = Math.max(1, Math.round((ms(within[within.length - 1]) - ms(s.t)) / 60000));
    push('steam', s.t,
      `Steam on a line you track: ${who} — ${bookLabel(s.books[0])} moved first; ${within.length - 1} books followed within ${mins} min`);
  }
  return out.sort((a, b) => ms(b.at) - ms(a.at));
}

/** localStorage key for one alert's seen state (per viewer; a convenience, P12 §1). */
export const seenKey = (id: string) => `linesmith:alerts:seen:${id}`;
