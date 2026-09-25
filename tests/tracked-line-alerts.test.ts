/**
 * P12 §1 — alerts on a reader's tracked lines, on fixtures. The rules are the
 * spec's table: a moved consensus line, a better price than the reader's book
 * by 5 cents, an open pull at the reader's book, steam (3+ books within 30
 * minutes) after the line was tracked. Ids are stable per event.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackedLineAlerts, type TrackedLineInput } from '../lib/odds/alerts';
import type { HistPoint, OddsMarket, OddsQuote } from '../lib/odds/section/types';

const T0 = Date.parse('2026-09-27T12:00:00Z');
const at = (min: number) => new Date(T0 + min * 60e3).toISOString();

const tracked: TrackedLineInput = { id: 7, subjectName: 'Drake London', statLabel: 'Receptions', side: 'over', line: 5.5, createdAt: at(0) };

function q(book: string, side: string, line: number, price: number, main = true): OddsQuote {
  return { book, side, line, price, since: at(10), checkedAt: at(60), source: `scraper:${book}`, main };
}

/** Five books at 5.5, both sides: the tracked number is still the consensus. */
function market(over: Partial<OddsMarket> = {}): OddsMarket {
  const cur: OddsQuote[] = [];
  for (const [b, o, u] of [['draftkings', -110, -110], ['fanduel', -112, -108], ['betmgm', -110, -110], ['caesars', -115, -105], ['fanatics', -110, -110]] as const) {
    cur.push(q(b, 'over', 5.5, o), q(b, 'under', 5.5, u));
  }
  return { key: 'receptions', cur, hist: {}, open: {}, pulls: [], ...over };
}

const types = (m: OddsMarket | null, book: string | null = 'fanatics') => trackedLineAlerts(tracked, m, book).map(a => a.type);

test('a quiet market raises nothing', () => {
  assert.deepEqual(types(market()), []);
});

test('a tracked line with no upcoming game raises nothing', () => {
  assert.deepEqual(types(null), []);
});

test('a moved consensus line raises one "moved" alert naming the first book to move', () => {
  const m = market();
  m.cur = m.cur.map(x => (['draftkings', 'fanduel', 'betmgm'].includes(x.book) ? { ...x, line: 6.5 } : x));
  const hist: Record<string, HistPoint[]> = {
    fanduel: [[at(5), 5.5, -112, -108], [at(20), 6.5, -110, -110]],
    draftkings: [[at(5), 5.5, -110, -110], [at(30), 6.5, -110, -110]],
  };
  const alerts = trackedLineAlerts(tracked, { ...m, hist }, 'fanatics');
  const moved = alerts.filter(a => a.type === 'moved');
  assert.equal(moved.length, 1);
  assert.match(moved[0].text, /FanDuel 5\.5 → 6\.5/);
  // The same event read twice is one id.
  const again = trackedLineAlerts(tracked, { ...m, hist }, 'fanatics').find(a => a.type === 'moved')!;
  assert.equal(again.id, moved[0].id);
  assert.equal(moved[0].id, `7:moved:${at(20)}`);
});

test('a better price: 4 cents is nothing, 6 cents is one alert', () => {
  const four = market();
  four.cur = four.cur.map(x => (x.book === 'draftkings' && x.side === 'over' ? { ...x, price: -106 } : x)); // 1.943 vs 1.909
  assert.deepEqual(types(four).filter(t => t === 'better_price'), []);
  const six = market();
  six.cur = six.cur.map(x => (x.book === 'draftkings' && x.side === 'over' ? { ...x, price: -104 } : x)); // 1.962 vs 1.909
  const a = trackedLineAlerts(tracked, six, 'fanatics').filter(x => x.type === 'better_price');
  assert.equal(a.length, 1);
  assert.match(a[0].text, /DraftKings -104 vs your Fanatics -110/);
});

test("an open pull at the reader's book raises 'pulled', with the repost when there is one", () => {
  const m = market({ pulls: [{ book: 'fanatics', side: 'over', line: 5.5, lastPrice: -110, pulledAt: at(40), returnedAt: null }] });
  m.cur = m.cur.filter(x => x.book !== 'fanatics').concat(q('fanatics', 'over', 6.5, -105), q('fanatics', 'under', 6.5, -115));
  const a = trackedLineAlerts(tracked, m, 'fanatics').filter(x => x.type === 'pulled');
  assert.equal(a.length, 1);
  assert.match(a[0].text, /Fanatics took 5\.5 down and reposted at 6\.5/);
  // Returned: no alert.
  const back = market({ pulls: [{ book: 'fanatics', side: 'over', line: 5.5, lastPrice: -110, pulledAt: at(40), returnedAt: at(50) }] });
  assert.deepEqual(types(back).filter(t => t === 'pulled'), []);
});

test('no user book: no book alerts, the others still fire', () => {
  const m = market({ pulls: [{ book: 'fanatics', side: 'over', line: 5.5, lastPrice: -110, pulledAt: at(40), returnedAt: null }] });
  m.cur = m.cur.map(x => (x.book === 'draftkings' && x.side === 'over' ? { ...x, price: 110 } : x));
  assert.deepEqual(types(m, null), []);
  assert.deepEqual(types(m, 'fanatics').sort(), ['better_price', 'pulled']);
});

test('steam after the line was tracked: 3 books within 30 minutes fire, 2 do not', () => {
  const up = (book: string, t: number): HistPoint[] => [[at(1), 5.5, -110, -110], [at(t), 6.5, -110, -110]];
  const three = market({ hist: { pinnacle: up('pinnacle', 40), draftkings: up('draftkings', 52), fanduel: up('fanduel', 65) } });
  const a = trackedLineAlerts(tracked, three, 'fanatics').filter(x => x.type === 'steam');
  assert.equal(a.length, 1);
  assert.match(a[0].text, /Pinnacle moved first; 2 books followed within 25 min/);
  const two = market({ hist: { pinnacle: up('pinnacle', 40), draftkings: up('draftkings', 52) } });
  assert.deepEqual(types(two).filter(t => t === 'steam'), []);
  // Three books, but spread over 40 minutes: not within 30.
  const slow = market({ hist: { pinnacle: up('pinnacle', 40), draftkings: up('draftkings', 60), fanduel: up('fanduel', 80) } });
  assert.deepEqual(types(slow).filter(t => t === 'steam'), []);
  // Steam before the line was tracked is old news.
  const before = { ...tracked, createdAt: at(45) };
  assert.equal(trackedLineAlerts(before, three, 'fanatics').filter(x => x.type === 'steam').length, 0);
});
