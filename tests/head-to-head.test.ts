import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareHeadToHeadCard, deepHeadToHeadCard, headToHeadSeam, withDeepHeadToHead } from '../lib/history/headToHeadCards';
import type { HeadToHead, Meeting } from '../lib/history/teamHistoryShapes';
import type { ResearchCard, ResearchSection } from '../lib/sports/shared/playerResearchShapes';

/** R12c — deep head to head on the game page and in team Compare. */

const PHI = { id: '21', abbr: 'PHI', logoUrl: 'phi.png' };
const DAL = { id: '6', abbr: 'DAL', logoUrl: 'dal.png' };

const meeting = (date: string, a: number, b: number, home: 'a' | 'b', playoff = false): Meeting => ({ date, season: Number(date.slice(0, 4)), playoff, home, aScore: a, bScore: b });

const h2h = (meetings: Meeting[]): HeadToHead => ({ sport: 'nfl', a: '21', b: '6', meetings, record: { w: 0, l: 0, d: 0 }, atHome: { w: 0, l: 0, d: 0 }, away: { w: 0, l: 0, d: 0 }, playoffs: { w: 0, l: 0, d: 0 }, firstSeason: null });

/** The card the sport's own read builds: this season and last, from the away side. */
const recentCard = (won: string[]): ResearchCard => ({
  kind: 'table',
  key: 'h2h',
  title: 'Head to head',
  scope: 'since last season',
  labelHeader: 'Date',
  fixedOrder: true,
  columns: [
    { key: 'park', label: 'At', decimals: 0 },
    { key: 'score', label: 'PHI–DAL', decimals: 0 },
    { key: 'won', label: 'Won', decimals: 0 },
  ],
  rows: won.map((w, i) => ({ key: `r${i}`, label: `Recent ${i}`, values: { park: 'PHI', score: '1–0', won: w } })),
  caption: 'Regular season and postseason, newest first.',
});

test('the seam is the first day of last season, so the archive never repeats the page\'s own rows', () => {
  // An NFL game in Nov 2026 is season 2026; its own list covers 2025 and 2026.
  assert.equal(headToHeadSeam('nfl', '2026-11-23T21:25:00Z'), '2025-09-01');
  const history = h2h([meeting('2025-11-23', 21, 24, 'b'), meeting('2024-12-29', 41, 7, 'a'), meeting('2023-12-10', 13, 33, 'b')]);
  const card = deepHeadToHeadCard({ recent: recentCard(['DAL']), history, away: PHI, home: DAL, seam: '2025-09-01' });
  assert.ok(card.kind === 'table');
  const all = card.views!.find((v) => v.key === 'all')!;
  assert.equal(all.rows.length, 3, 'one recent row plus the two BEFORE the seam — the 2025 archive row is the recent one, not repeated');
  assert.equal(card.views![0].label, 'Since last season', 'opens on the recent list');
  // Total = recent (0-1) + archive before the seam (1-1).
  assert.match(card.scope ?? '', /^PHI 1-2 against DAL since 2023 · 1-0 at home before last season · 0-1 since$/);
  assert.match(card.caption ?? '', /results archive \(2023 onward\) and are not linked/);
});

test('no history before the seam leaves the card exactly as the sport built it', () => {
  const recent = recentCard(['PHI']);
  assert.equal(deepHeadToHeadCard({ recent, history: h2h([meeting('2025-11-23', 30, 3, 'a')]), away: PHI, home: DAL, seam: '2025-09-01' }), recent);
});

test('a postseason meeting is marked, and only the h2h card is touched — before or after the start', () => {
  // After the start the section is re-keyed `pre-matchup` ("at the start"): the
  // first version matched on 'matchup' and missed every final.
  const sections: ResearchSection[] = [
    { id: 'pre-matchup', navLabel: 'Matchup', title: 'Matchup · at the start', rows: [[recentCard([])], [{ ...recentCard([]), key: 'other' }]], state: { kind: 'ready' } },
    { id: 'box', navLabel: 'Box', title: 'Box', rows: [[{ ...recentCard([]), key: 'box' }]], state: { kind: 'ready' } },
  ];
  const out = withDeepHeadToHead(sections, { history: h2h([meeting('2023-01-21', 38, 7, 'a', true)]), away: PHI, home: DAL, seam: '2025-09-01' });
  const deep = out[0].rows[0][0];
  assert.ok(deep.kind === 'table');
  assert.equal(deep.rows[0].labelNote, 'postseason');
  assert.equal(deep.views!.length, 1, 'no recent meetings: only the all-meetings view');
  assert.equal(out[0].rows[1][0], sections[0].rows[1][0], 'another card in the section is untouched');
  assert.equal(out[1], sections[1], 'another section is untouched');
});

test('Compare\'s all-time card: the record from this team\'s side, split by venue, last 10 by default', () => {
  const ms = Array.from({ length: 12 }, (_, i) => meeting(`20${String(24 - i).padStart(2, '0')}-10-01`, i % 3 === 0 ? 10 : 20, 14, i % 2 ? 'a' : 'b'));
  const history = { ...h2h(ms), playoffs: { w: 1, l: 0, d: 0 } };
  const card = compareHeadToHeadCard({ history, team: PHI, other: DAL });
  assert.ok(card.kind === 'table');
  assert.equal(card.rows.length, 10);
  assert.deepEqual(card.views?.map((v) => v.label), ['Last 10', 'All 12']);
  assert.match(card.scope ?? '', /^PHI 8-4 against DAL since 2013 · 4-2 at home, 4-2 away · postseason 1-0$/);
  const none = compareHeadToHeadCard({ history: h2h([]), team: PHI, other: DAL });
  assert.ok(none.kind === 'table');
  assert.equal(none.scope, 'no meetings in the results held');
});
