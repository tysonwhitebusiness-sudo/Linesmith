// P1 (odds workstream, 2026-09-24): one book registry. BookLogo knew 15 books
// and printed any other id raw ("bet365", "fanatics"), and callers that printed
// the label beside a logo-less mark showed it twice ("parx parx").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CANONICAL_BOOKMAKERS } from '../lib/odds/props/entityResolution';
import { BOOKS, BOOK_GROUP_ORDER, bookGroup, bookLabel, bookLogoUrl } from '../lib/odds/books/registry';

test('every canonical bookmaker has a registry entry with a label', () => {
  assert.ok(CANONICAL_BOOKMAKERS.size >= 40);
  for (const id of CANONICAL_BOOKMAKERS) {
    assert.ok(BOOKS[id]?.label, `no registry entry for canonical book ${id}`);
    assert.notEqual(bookLabel(id), '', id);
  }
});

test('90 entries; no two books share a display name except Caesars and its the-odds-api key', () => {
  assert.equal(Object.keys(BOOKS).length, 90, "P1's 87 + P2's westgate, skybet, betfair");
  const byLabel = new Map<string, string[]>();
  for (const [id, e] of Object.entries(BOOKS)) byLabel.set(e.label, [...(byLabel.get(e.label) ?? []), id]);
  const dupes = [...byLabel.entries()].filter(([, ids]) => ids.length > 1);
  assert.deepEqual(dupes, [['Caesars', ['caesars', 'williamhill_us']]]);
});

test('every entry has a known group, a label and a domain or a monogram', () => {
  for (const [id, e] of Object.entries(BOOKS)) {
    assert.ok(BOOK_GROUP_ORDER.includes(e.group), `${id}: group ${e.group}`);
    assert.ok(e.label.trim(), id);
    assert.ok(e.domain === null || /^[a-z0-9.-]+\.[a-z]{2,}$/.test(e.domain), `${id}: domain ${e.domain}`);
  }
  assert.equal(bookGroup('pinnacle'), 'sharp');
  assert.equal(bookGroup('not-a-book'), 'intl');
  assert.equal(bookLabel('parx'), 'Parx');
  assert.equal(bookLabel('bet365'), 'bet365');
  assert.equal(bookLabel('fanatics'), 'Fanatics');
  assert.match(bookLogoUrl('draftkings') ?? '', /domain=draftkings\.com/);
  assert.equal(bookLogoUrl('rebet'), undefined, 'no domain -> the monogram tile');
});

test('guard: no page prints a book label right after a <BookLogo> for the same book', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); } else if (p.endsWith('.tsx')) files.push(p);
    }
  };
  walk('components');
  walk('app');
  const re = /<BookLogo\s+bookId=\{([^}]+)\}[^>]*\/>\s*(?:<span[^>]*>)?\s*\{bookLabel\(\s*([^)]+)\)\}/g;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(re)) {
      assert.notEqual(m[1]!.trim(), m[2]!.trim(), `${f}: <BookLogo> then bookLabel(${m[2]}) prints the name twice; use withLabel`);
    }
  }
});

test('P2: every scraper book added to the alias maps has a registry entry', () => {
  const P2_BOOKS = ['sugarhouse', 'ladbrokes', 'bookmaker', 'polymarketus', 'courtside', 'everygame', 'betmgmnv', 'caesarsnv',
    'wynn', 'stations', 'boomers', 'southpoint', 'westgate', 'coolbet', 'betanysports', 'playup', 'nordicbet', 'tabtouch',
    'riverscasino', 'betfairexchange', 'betfairsportsbook', 'betfair', 'leovegas', 'grosvenor', 'betsson', 'gtbets', 'casumo',
    'marathonbet', 'tab', 'betvictor', 'sportsbet', 'virginbet', 'livescorebet', 'coral', 'betway', 'bet105', 'neds', 'skybet',
    'betrsportsbook', 'betano', 'betanything', 'boylesports', 'tipico', 'heritage', '888sport', 'paddypower', 'aceshigh',
    'justbet', 'williamhill'];
  for (const id of P2_BOOKS) {
    assert.ok(CANONICAL_BOOKMAKERS.has(id), `${id} is not a canonical bookmaker`);
    assert.ok(BOOKS[id]?.label, `${id} has no registry entry`);
  }
});
