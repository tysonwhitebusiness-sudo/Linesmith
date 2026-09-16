import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { returnPointsWon, tennisSurfaceSection, type TennisArchiveMatch, type TennisArchivePayload } from '../lib/sports/tennis/playerArchiveShapes';

/**
 * R6.4 — tennis's "Surface & serve", built from G2's own Alcaraz archive block
 * (the same TennisMyLife columns `tennismylife.ts` parses: surface, level,
 * round, rank, aces and the serve and return counts).
 *
 * The page's own history cannot build any of this: `player_game_history` holds
 * eight keys for tennis and none of them is surface or serve.
 */
const g2 = JSON.parse(readFileSync('docs/design/phase-g2/data/player-tennis-alcaraz.json', 'utf8')) as {
  matches: { source: string; rows: Array<Record<string, string | number | boolean | null>> };
};

const MATCHES: TennisArchiveMatch[] = g2.matches.rows.map((r) => {
  const iso = `${String(r.date).slice(0, 4)}-${String(r.date).slice(4, 6)}-${String(r.date).slice(6, 8)}`;
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  return {
    date: iso,
    season: Number(iso.slice(0, 4)),
    tournamentName: String(r.tourney ?? ''),
    surface: String(r.surface ?? ''),
    level: r.level == null ? null : String(r.level),
    round: r.round == null ? null : String(r.round),
    opponent: String(r.opp ?? ''),
    isWinner: r.won === true,
    rank: num(r.rank),
    aces: num(r.ace),
    serve: { points: num(r.svpt), firstIn: num(r.firstIn), firstWon: num(r.firstWon), secondWon: num(r.secondWon) },
    opponentServe: { points: num(r.oppSvpt), firstWon: num(r.oppFirstWon), secondWon: num(r.oppSecondWon) },
  };
});
const SEASONS = [...new Set(MATCHES.map((m) => m.season))].sort((a, b) => a - b);
const payload = (over: Partial<TennisArchivePayload> = {}): TennisArchivePayload => ({
  name: 'Carlos Alcaraz',
  tour: 'atp',
  seasons: SEASONS,
  matches: MATCHES,
  archiveLastDate: '2026-08-30',
  asOf: '2026-09-15T06:00:00Z',
  ...over,
});
const input = (over: Partial<Parameters<typeof tennisSurfaceSection>[0]> = {}) => ({ season: null, data: payload(), loading: false, error: null, ...over });

test('the section is four cards: two tables, then the two long series', () => {
  const sec = tennisSurfaceSection(input());
  assert.equal(sec.state.kind, 'ready');
  assert.deepEqual([sec.id, sec.title], ['surface', 'Surface & serve']);
  assert.deepEqual(sec.rows.map((r) => r.map((c) => c.key)), [['surfaces', 'levels'], ['ranking'], ['serveReturn']]);
});

test('by level reads the archives own code, and counts a Masters under either tours spelling (R6-F3)', () => {
  const season = SEASONS[SEASONS.length - 1];
  const card = tennisSurfaceSection(input({ season })).rows[0][1];
  assert.ok(card.kind === 'table');
  const slam = card.rows.find((r) => r.label === 'Slam')!;
  const ms = MATCHES.filter((m) => m.season === season && m.level === 'G');
  assert.equal(slam.values.w, ms.filter((m) => m.isWinner).length);
  // The ATP archive writes `M`, the WTA one writes `1000`; one row covers both.
  const masters = (rows: TennisArchiveMatch[]) => {
    const c = tennisSurfaceSection(input({ season: 2026, data: payload({ matches: rows, seasons: [2026] }) })).rows[0][1];
    assert.ok(c.kind === 'table');
    return c.rows.find((r) => r.label === 'Masters 1000');
  };
  const one = (level: string, round: string, isWinner: boolean): TennisArchiveMatch => ({
    ...MATCHES[0], date: '2026-03-01', season: 2026, level, round, isWinner,
  });
  assert.equal(masters([one('M', 'SF', true)])?.values.w, 1);
  assert.equal(masters([one('1000', 'SF', true)])?.values.w, 1);
  // Deepest round is the furthest reached, and a won final says so.
  assert.equal(masters([one('M', 'R16', true), one('M', 'QF', false)])?.values.best, 'QF');
  assert.equal(masters([one('M', 'F', true)])?.values.best, 'Won');
  assert.equal(masters([one('M', 'F', false)])?.values.best, 'Final');
});

test('by surface counts wins, aces per match and both serve rates from the archive', () => {
  const season = SEASONS[SEASONS.length - 1];
  const card = tennisSurfaceSection(input({ season })).rows[0][0];
  assert.ok(card.kind === 'table');
  const hard = card.rows.find((r) => r.label.startsWith('Hard'))!;
  const ms = MATCHES.filter((m) => m.season === season && m.surface === 'Hard');
  const won = ms.filter((m) => m.isWinner).length;
  assert.equal(hard.values.w, won);
  assert.equal(hard.values.l, ms.length - won);
  assert.equal(Math.round(hard.values.ace as number), Math.round(ms.reduce((a, m) => a + (m.aces ?? 0), 0) / ms.length));
  const firstWon = ms.reduce((a, m) => a + (m.serve?.firstWon ?? 0), 0);
  const firstIn = ms.reduce((a, m) => a + (m.serve?.firstIn ?? 0), 0);
  assert.equal(Math.round((hard.values.fw as number) * 10), Math.round(((100 * firstWon) / firstIn) * 10));
  // Return points won: every point the opponent served, less what they won on it.
  const r = returnPointsWon(ms);
  assert.equal(Math.round((hard.values.rpw as number) * 10), Math.round(((100 * r.won) / r.of) * 10));
  // A surface not played this season is not a row of zeroes.
  assert.ok(card.rows.every((row) => (row.values.w as number) + (row.values.l as number) > 0));
});

test("today's court is marked, and only that one (C7)", () => {
  const card = tennisSurfaceSection(input({ todaySurface: 'clay' })).rows[0][0];
  assert.ok(card.kind === 'table');
  const marked = card.rows.filter((r) => r.label.includes('today'));
  assert.deepEqual(marked.map((r) => r.key), ['Clay']);
  const none = tennisSurfaceSection(input()).rows[0][0];
  assert.ok(none.kind === 'table' && none.rows.every((r) => !r.label.includes('today')));
});

test('ranking is every ranked match, drawn so that better is higher, with the real number in the tip', () => {
  const card = tennisSurfaceSection(input()).rows[1][0];
  assert.ok(card.kind === 'series');
  const ranked = MATCHES.filter((m) => m.rank != null);
  assert.equal(card.values.length, ranked.length);
  assert.equal(card.values[0], -(ranked[0].rank as number));
  assert.match(card.tips![0][0], /^No\. \d+$/);
  // The axis prints the rank back, and never pads past No. 1 into a rank that cannot exist.
  assert.deepEqual(card.axisFormat, { negate: true, prefix: 'No. ' });
  assert.equal(card.max, -1);
  const worst = Math.max(...ranked.map((m) => m.rank as number));
  assert.ok(card.min! <= -worst, 'the worst rank still fits under the axis');
  // Four even gaps over whole ranks, so no tick prints the same rank twice.
  assert.equal((card.max! - card.min!) % 4, 0);
});

test('serve and return is a 10-match rolling pair, and skips a match the archive left blank', () => {
  const card = tennisSurfaceSection(input()).rows[2][0];
  assert.ok(card.kind === 'series');
  assert.ok(Number.isNaN(card.values[0]), 'no average before ten matches');
  assert.ok(Number.isFinite(card.values[9]));
  assert.equal(card.context?.length, card.values.length);
  assert.deepEqual(card.legend?.map((l) => l.label), ['First-serve points won', 'Return points won']);
});

test('the section says how far the archive reaches, and where this player stops inside it', () => {
  const sec = tennisSurfaceSection(input());
  assert.match(sec.note ?? '', /archive runs to/);
  const last = MATCHES[MATCHES.length - 1].date;
  const behind = tennisSurfaceSection(input({ data: payload({ archiveLastDate: '2026-08-30' }) }));
  if (last.slice(0, 10) < '2026-08-30') assert.match(behind.note ?? '', /last match in it is/);
});

test('loading, error and a name the archive does not carry each say which they are', () => {
  assert.equal(tennisSurfaceSection(input({ loading: true })).state.kind, 'loading');
  assert.equal(tennisSurfaceSection(input({ error: 'nope' })).state.kind, 'error');
  const missing = tennisSurfaceSection(input({ data: null, emptyReason: 'no rows under this name' }));
  assert.equal(missing.state.kind === 'empty' ? missing.state.reason : '', 'no rows under this name');
});
