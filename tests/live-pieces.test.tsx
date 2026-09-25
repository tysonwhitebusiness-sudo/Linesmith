/**
 * Odds build P9 §3 — the kit's live pieces, rendered. `LiveDot` at 1×, 3× and
 * 7× its source's cadence (green, amber, grey, with the words); a ping ring
 * only when the card changed; `FlashValue`'s trail with its opacity by age
 * and gone after two minutes, its flash only in the first 1.6 s and never
 * under the flash cap; `DataTable`'s row states in words.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataTable, FlashValue, LiveDot } from '../components/ui';
import { cadenceFor, sourceClass } from '../lib/odds/section/cadence';
import { fmtAmerican } from '../lib/odds/section/format';

const NOW = Date.parse('2026-09-25T17:00:00.000Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

test('LiveDot: green inside 2x cadence, amber inside 6x, grey beyond, in words', () => {
  const at1 = html(<LiveDot checkedAt={ago(70)} cadenceS={70} now={NOW} />);
  assert.match(at1, /data-live="live"/);
  assert.match(at1, /lb-live-pulse/);
  assert.match(at1, /updated 1 min ago|updated 70s ago|updated 1m/);
  const at3 = html(<LiveDot checkedAt={ago(210)} cadenceS={70} now={NOW} />);
  assert.match(at3, /data-live="slow"/);
  assert.match(at3, /text-warn-ink/);
  assert.doesNotMatch(at3, /lb-live-pulse/);
  const at7 = html(<LiveDot checkedAt={ago(490)} cadenceS={70} now={NOW} />);
  assert.match(at7, /data-live="off"/);
  assert.match(at7, /no update in/);
});

test('LiveDot pings only when its card changed', () => {
  assert.doesNotMatch(html(<LiveDot checkedAt={ago(5)} cadenceS={70} now={NOW} />), /data-ping/);
  assert.match(html(<LiveDot checkedAt={ago(5)} cadenceS={70} now={NOW} pingAt={NOW - 1000} />), /data-ping[^>]*lb-live-ping|lb-live-ping[^>]*data-ping/);
});

test('FlashValue: the flash and roll in the first 1.6 s, in the fill of its direction', () => {
  const up = html(<FlashValue value={-105} format={fmtAmerican} change={{ dir: 'up', seenAt: NOW - 500 }} now={NOW} />);
  assert.match(up, /lb-flash-up/);
  assert.match(up, /▲ 0s/);
  const down = html(<FlashValue value={-118} format={fmtAmerican} change={{ dir: 'down', seenAt: NOW - 500 }} now={NOW} />);
  assert.match(down, /lb-flash-down/);
  assert.match(down, /text-bad-ink/);
  // After 1.6 s: no flash, the trail stays.
  const later = html(<FlashValue value={-105} format={fmtAmerican} change={{ dir: 'up', seenAt: NOW - 12_000 }} now={NOW} />);
  assert.doesNotMatch(later, /lb-flash/);
  assert.match(later, /▲ 12s/);
  // The flash cap: the trail, never the roll.
  assert.doesNotMatch(html(<FlashValue value={-105} format={fmtAmerican} change={{ dir: 'up', seenAt: NOW - 500 }} now={NOW} quiet />), /lb-flash/);
});

test('FlashValue: the trail fades from 1 to 0.15 over 120 s, then is removed', () => {
  const op = (s: number) => {
    const m = html(<FlashValue value={-105} format={fmtAmerican} change={{ dir: 'up', seenAt: NOW - s * 1000 }} now={NOW} />).match(/data-trail[^>]*opacity:([\d.]+)/);
    return m ? Number(m[1]) : null;
  };
  assert.equal(op(0), 1);
  assert.equal(op(60), 0.5);
  assert.equal(op(110), 0.15);
  assert.equal(op(121), null);
  assert.match(html(<FlashValue value={-105} format={fmtAmerican} change={{ dir: 'up', seenAt: NOW - 90_000 }} now={NOW} />), /▲ 1m/);
});

test('FlashValue marks a value changed since the page opened (the header outline)', () => {
  assert.match(html(<FlashValue value={-105} format={fmtAmerican} recent />), /data-recent=""/);
  assert.doesNotMatch(html(<FlashValue value={-105} format={fmtAmerican} />), /data-recent/);
});

test('DataTable row states render their words; a state from page load does not animate', () => {
  const rows = [
    { b: 'BetRivers', st: 'pulled' as const, at: Date.now() - 1000 },
    { b: 'Caesars', st: 'returned' as const, at: Date.now() - 1000 },
    { b: 'Fanatics', st: 'new' as const, at: Date.now() - 1000 },
    { b: 'ESPN Bet', st: 'pulled' as const, at: null },
  ];
  const out = html(
    <DataTable caption="t" rows={rows} rowKey={r => r.b} rowState={r => r.st} rowStateAt={r => r.at}
      columns={[{ key: 'b', label: 'Book', sortable: false }]} />,
  );
  assert.match(out, /Pulled · \ds ago/);
  assert.match(out, /Back · \ds ago/);
  assert.match(out, /just now/);
  assert.match(out, /lb-row-pulled/);
  assert.match(out, /lb-row-returned/);
  assert.match(out, /lb-row-new/);
  // ESPN Bet was already pulled when the page loaded: struck through, "Pulled", no flash.
  const espn = out.slice(out.indexOf('ESPN Bet') - 400, out.indexOf('ESPN Bet') + 200);
  assert.match(espn, /line-through/);
  assert.equal((out.match(/lb-row-pulled/g) ?? []).length, 1);
});

test('cadence by source class (Revision 4)', () => {
  assert.equal(cadenceFor('scraper:pinnacle'), 70);
  assert.equal(cadenceFor('scraper:kalshi'), 70);
  assert.equal(cadenceFor('scraper:vsin'), 90);
  assert.equal(cadenceFor('parlayapi'), 90);
  assert.equal(cadenceFor('dknetwork'), 480);
  assert.equal(cadenceFor('sleeper', 'pick_counts'), 900);
  assert.equal(sourceClass('scraper:sleeper'), 'direct');
  assert.equal(cadenceFor('covers'), 3600);
});
