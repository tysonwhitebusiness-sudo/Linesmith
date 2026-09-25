import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMainLine } from '../lib/odds/props/mainLine';
import type { PropOddsRow } from '../lib/db/client';

/**
 * R2 — the prop main line. The rule replaced six per-adapter copies of "highest
 * over price across every line", which on an alternate ladder always chose the
 * top rung: Ben Shelton's aces (game 182766, 9 lines 8.5–29.5, 2 books) rendered
 * as 24.5 (F-B12). The fixtures below are shaped on that measurement.
 */

const START = '2026-09-14T18:00:00Z';
const PRE = '2026-09-14T17:30:00Z';
let id = 0;

function row(bookmaker: string, line: number | null, side: 'over' | 'under', americanOdds: number, fetchedAt = PRE): PropOddsRow {
  return {
    id: ++id,
    providerId: 'sharpapi',
    gameId: '182766',
    subjectId: 'tennis:shelton',
    subjectName: 'Ben Shelton',
    marketKey: 'aces',
    line,
    side,
    bookmaker,
    americanOdds,
    decimalOdds: null,
    fetchedAt,
    isDelayed: false,
    delaySeconds: null,
  } as unknown as PropOddsRow;
}

/** An aces ladder: one-sided overs climbing to +2500, two-sided only near the middle. */
function sheltonLadder(): PropOddsRow[] {
  const rows: PropOddsRow[] = [];
  const ladder: [number, number][] = [[8.5, -160], [9.5, -115], [10.5, 120], [12.5, 210], [14.5, 380], [17.5, 700], [20.5, 1200], [24.5, 2000], [29.5, 2500]];
  for (const book of ['draftkings', 'fanduel']) for (const [line, price] of ladder) rows.push(row(book, line, 'over', price));
  rows.push(row('draftkings', 9.5, 'under', -105), row('fanduel', 9.5, 'under', -110));
  rows.push(row('draftkings', 10.5, 'under', -150));
  return rows;
}

test('F-B12: an alternate ladder resolves to the two-sided line, not the longest over price', () => {
  const result = pickMainLine(sheltonLadder(), START);
  assert.equal(result.kind, 'main');
  if (result.kind !== 'main') return;
  assert.equal(result.line, 9.5, 'quoted both sides by both books');
  assert.ok(result.line >= 8.5 && result.line <= 10.5, 'the audit expected the 8.5–10.5 end');
  assert.notEqual(result.line, 24.5, 'the old max-price rule picked this');
  assert.equal(result.twoSidedBooks, 2);
  assert.equal(result.over.americanOdds, -115);
  assert.deepEqual(result.availableLines, [8.5, 9.5, 10.5, 12.5, 14.5, 17.5, 20.5, 24.5, 29.5]);
});

test("pick'em books never count, but exchanges do", () => {
  const rows = [
    row('prizepicks', 22.5, 'over', 100), row('prizepicks', 22.5, 'under', 100),
    row('underdog', 22.5, 'over', 100), row('underdog', 22.5, 'under', 100),
    row('novig', 20.5, 'over', -108), row('novig', 20.5, 'under', -102),
  ];
  const result = pickMainLine(rows, START);
  assert.equal(result.kind, 'main');
  if (result.kind === 'main') {
    assert.equal(result.line, 20.5, 'two pick-em books do not outvote one exchange');
    assert.equal(result.over.bookmaker, 'novig');
  }
  assert.equal(pickMainLine(rows.slice(0, 4), START).kind, 'none', "a pick'em-only market has no price");
});

test('quotes captured after the start are ignored', () => {
  const rows = [
    row('draftkings', 6.5, 'over', -110), row('draftkings', 6.5, 'under', -110),
    row('fanduel', 3.5, 'over', -110, '2026-09-14T19:00:00Z'), row('fanduel', 3.5, 'under', -110, '2026-09-14T19:00:00Z'),
    row('caesars', 3.5, 'over', -110, '2026-09-14T19:00:00Z'), row('caesars', 3.5, 'under', -110, '2026-09-14T19:00:00Z'),
  ];
  const result = pickMainLine(rows, START);
  assert.equal(result.kind === 'main' && result.line, 6.5, 'the in-play 3.5 has more books but is not a pre-game line');
});

test('a bare date carries no start time and filters nothing', () => {
  const rows = [row('draftkings', 3.5, 'over', -110, '2026-09-14T19:00:00Z'), row('draftkings', 3.5, 'under', -110, '2026-09-14T19:00:00Z')];
  assert.equal(pickMainLine(rows, '2026-09-14').kind, 'main');
});

test('one book through two providers is one book, and its later quote stands', () => {
  const early = row('draftkings', 5.5, 'over', -150, '2026-09-14T10:00:00Z');
  const late = { ...row('draftkings', 5.5, 'over', -120, '2026-09-14T17:00:00Z'), providerId: 'propline' } as PropOddsRow;
  const result = pickMainLine([early, late, row('draftkings', 5.5, 'under', -105)], START);
  assert.equal(result.kind, 'main');
  if (result.kind === 'main') {
    assert.equal(result.twoSidedBooks, 1);
    assert.equal(result.over.americanOdds, -120);
  }
});

test('equal book counts break toward the price nearest even', () => {
  const rows = [
    row('draftkings', 4.5, 'over', -180), row('draftkings', 4.5, 'under', 145),
    row('draftkings', 5.5, 'over', -105), row('draftkings', 5.5, 'under', -115),
  ];
  const result = pickMainLine(rows, START);
  assert.equal(result.kind === 'main' && result.line, 5.5);
});

test('yes/no markets keep their null line with 2+ books on the over', () => {
  const two = [row('draftkings', null, 'over', 150), row('fanduel', null, 'over', 160)];
  const result = pickMainLine(two, START);
  assert.equal(result.kind, 'yes-no');
  if (result.kind === 'yes-no') assert.equal(result.over.americanOdds, 160);
  assert.equal(pickMainLine(two.slice(0, 1), START).kind, 'none', 'one book is not enough');
});

test("SharpAPI's yes side is stored as `other` and still counts (WTA to-win-a-set, 2026-09-14)", () => {
  const rows = [
    { ...row('draftkings', null, 'over', -450), side: 'other' },
    { ...row('fanduel', null, 'over', -460), side: 'other' },
  ] as PropOddsRow[];
  const result = pickMainLine(rows, START);
  assert.equal(result.kind, 'yes-no');
  if (result.kind === 'yes-no') assert.equal(result.books, 2);
});

test('a market quoted on one side only is alternates-only, with no line', () => {
  const rows = [row('draftkings', 249.5, 'over', -110), row('fanduel', 274.5, 'over', 150)];
  assert.deepEqual(pickMainLine(rows, START), { kind: 'alternates-only', availableLines: [249.5, 274.5] });
});

test('a rung its book stopped quoting does not count (Mahomes passing yards, DEN @ KC, 2026-09-14)', () => {
  // DraftKings moved off 223.5 at 00:05 and last quoted 221.5 at 20:57; FanDuel
  // still quoted 223.5 at 20:57. Counting the dead DraftKings row made 223.5
  // the main line with a 19-hour-old price.
  const kickoff = '2026-09-14T23:15:00Z';
  const rows = [
    row('draftkings', 223.5, 'over', -112, '2026-09-14T00:05:57Z'), row('draftkings', 223.5, 'under', -112, '2026-09-14T00:05:57Z'),
    row('draftkings', 221.5, 'over', -111, '2026-09-14T20:57:12Z'), row('draftkings', 221.5, 'under', -113, '2026-09-14T20:57:12Z'),
    row('fanduel', 223.5, 'over', -113, '2026-09-14T20:57:12Z'), row('fanduel', 223.5, 'under', -113, '2026-09-14T20:57:12Z'),
  ];
  const now = Date.parse('2026-09-14T21:00:00Z');
  const withClock = pickMainLine(rows, kickoff, { now });
  assert.equal(withClock.kind, 'main');
  if (withClock.kind === 'main') {
    assert.equal(withClock.twoSidedBooks, 1, 'DraftKings no longer quotes 223.5');
    assert.ok(![withClock.over, withClock.under].some((r) => r && String(r.fetchedAt).startsWith('2026-09-14T00:05')), 'the dead quote is gone');
  }
  const noClock = pickMainLine(rows, kickoff);
  assert.equal(noClock.kind === 'main' && noClock.line, 223.5, 'without a clock the old behaviour stands (the pure default)');
});

test('after the start, history timestamps are not read as superseded', () => {
  // prop_odds_history records a price when it CHANGES, so a stable rung that was
  // quoted right up to kickoff can carry a morning timestamp.
  const kickoff = '2026-09-14T23:15:00Z';
  const rows = [
    row('draftkings', 5.5, 'over', -110, '2026-09-14T09:00:00Z'), row('draftkings', 5.5, 'under', -110, '2026-09-14T09:00:00Z'),
    row('draftkings', 6.5, 'over', 150, '2026-09-14T22:50:00Z'),
  ];
  const result = pickMainLine(rows, kickoff, { now: Date.parse('2026-09-15T01:00:00Z') });
  assert.equal(result.kind === 'main' && result.line, 5.5);
});

test('F6 (P5): a stale relayed price never beats the book read first-hand', () => {
  // DraftKings via comparenbet, re-confirmed at 17:55 but unchanged since 09:00,
  // against DraftKings read from its own site at 17:40 at a different price.
  const relay = { ...row('draftkings', 5.5, 'over', -140, '2026-09-14T17:55:00Z'), providerId: 'scraper:comparenbet', changedAt: '2026-09-14T09:00:00Z' };
  const own = { ...row('draftkings', 5.5, 'over', -110, '2026-09-14T17:40:00Z'), providerId: 'scraper:draftkings', changedAt: '2026-09-14T17:40:00Z' };
  const under = row('draftkings', 5.5, 'under', -110, '2026-09-14T17:40:00Z');
  const fd = [row('fanduel', 5.5, 'over', -112), row('fanduel', 5.5, 'under', -108)];
  for (const rows of [[relay, own, under, ...fd], [own, relay, under, ...fd]]) {
    const result = pickMainLine(rows as PropOddsRow[], START);
    assert.equal(result.kind, 'main');
    if (result.kind !== 'main') continue;
    const dkOver = [result.over, result.under].filter((r) => r && r.bookmaker === 'draftkings' && r.side === 'over');
    assert.ok(result.over && result.over.americanOdds !== -140, 'the relayed -140 is not the over');
    assert.ok(dkOver.every((r) => r!.providerId === 'scraper:draftkings'), 'DraftKings stands for itself');
  }
});
