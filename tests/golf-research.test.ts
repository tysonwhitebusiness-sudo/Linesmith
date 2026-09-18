import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseGolfShots, toGolfResearch, type GolfResearchPayload, type GolfShotEvent } from '../lib/sports/golf/playerResearchShapes';

/**
 * R6.6 — golf's research, from the golf tables rather than a per-game history.
 * The fixtures follow what `scripts/measure-golf.ts` found: rounds and holes
 * keyed by event, `start_date` null, `relative_to_par` the only honest hole
 * score, and a shot seed whose `tournament_id` repeats every year.
 */
const shot = (over: Partial<GolfShotEvent> = {}): GolfShotEvent => ({
  season: 2021,
  tournamentId: '023',
  round: 1,
  hole: 1,
  shot: 1,
  distanceYds: 300,
  leftYds: 150,
  fromLie: 'OTB',
  isPutt: false,
  ...over,
});

/** A par 4 in four strokes: drive, approach to `leftFt` feet, then `putts` putts. */
const hole = (at: Partial<GolfShotEvent>, leftFt: number, putts: number): GolfShotEvent[] => [
  shot({ ...at, shot: 1, distanceYds: 300, leftYds: 150, fromLie: 'OTB' }),
  shot({ ...at, shot: 2, distanceYds: 148, leftYds: leftFt / 3, fromLie: 'OFW' }),
  ...Array.from({ length: putts }, (_, k) =>
    shot({ ...at, shot: 3 + k, distanceYds: k === putts - 1 ? 1 : leftFt / 3, leftYds: k === putts - 1 ? 0 : 1, fromLie: 'OGR', isPutt: true }),
  ),
];

test('a hole is keyed by season too: the same event number in two years is two holes', () => {
  const rows = [...hole({ season: 2020 }, 12, 2), ...hole({ season: 2021 }, 12, 2)];
  const s = summariseGolfShots(rows)!;
  assert.equal(s.holes, 2, 'G2 grouped without the season and merged these into one hole');
  assert.equal(s.events, 2);
  assert.equal(s.putting.puttsPerHole, 2);
});

test('a putt is measured from where it was struck — the previous shot’s distance left', () => {
  // The first putt rolls 12 ft of a 12 ft putt but stops short: travel and start differ.
  const rows = hole({}, 12, 2);
  rows[2] = { ...rows[2], distanceYds: 3.5 };
  const s = summariseGolfShots(rows)!;
  assert.equal(s.firstPuttFt.median, 12);
  const band = s.makeByDistance.find((b) => b.key === '10-15')!;
  assert.deepEqual([band.putts, band.made], [1, 0]);
});

test('one- and three-putt rates are over holes that reached the green', () => {
  const rows = [...hole({ hole: 1 }, 5, 1), ...hole({ hole: 2 }, 30, 3), ...hole({ hole: 3 }, 10, 2), shot({ hole: 4, shot: 1, leftYds: 0 })];
  const s = summariseGolfShots(rows)!;
  assert.equal(s.holes, 4);
  assert.equal(Math.round(s.putting.onePutt!), 33);
  assert.equal(Math.round(s.putting.threePutt!), 33);
  assert.equal(s.putting.puttsPerHole, 6 / 4, 'putts per hole counts the hole-out too');
});

test('drives are tee shots of 200+ yards, binned by ten', () => {
  const s = summariseGolfShots([shot({ distanceYds: 305 }), shot({ hole: 2, distanceYds: 312 }), shot({ hole: 3, distanceYds: 180 })])!;
  assert.equal(s.drives.n, 2);
  assert.equal(s.drives.longest, 312);
  assert.deepEqual(s.drives.bins.map((b) => [b.lo, b.count]), [[300, 1], [310, 1]]);
});

test('an unknown lie is folded into Other, never dropped', () => {
  const s = summariseGolfShots([shot(), shot({ hole: 2, fromLie: 'ZZZ' }), shot({ hole: 3, fromLie: null })])!;
  assert.deepEqual(s.byLie.map((l) => [l.key, l.shots]), [['OTB', 1], ['other', 1], ['none', 1]]);
});

const payload = (over: Partial<GolfResearchPayload> = {}): GolfResearchPayload => ({
  espnId: '9478',
  name: 'Scottie Scheffler',
  events: [
    { eventId: '401811962', name: 'FedEx St. Jude Championship', season: 2026 },
    { eventId: '401811963', name: 'BMW Championship', season: 2026 },
  ],
  rounds: [
    { eventId: '401811963', round: 1, strokes: 67, toPar: -3, windMph: 8, tempF: 81 },
    { eventId: '401811962', round: 2, strokes: 72, toPar: 2, windMph: null, tempF: null },
    { eventId: '401811962', round: 1, strokes: 65, toPar: -5, windMph: 5, tempF: 88 },
  ],
  holes: [
    { eventId: '401811962', round: 1, hole: 1, par: 5, strokes: 3, toPar: -2 },
    { eventId: '401811962', round: 1, hole: 2, par: 4, strokes: 6, toPar: 2 },
    { eventId: '401811962', round: 1, hole: 3, par: 3, strokes: 2, toPar: -1 },
    { eventId: '401811962', round: 1, hole: 4, par: 4, strokes: 5, toPar: 1 },
  ],
  shots: summariseGolfShots(hole({}, 12, 2)),
  asOf: '2026-08-31T00:00:00Z',
  ...over,
});
const ready = (over: Partial<GolfResearchPayload> = {}) => toGolfResearch({ bio: null, golf: { data: payload(over), loading: false, error: null } })!;

test('the hero counts rounds, in event order, with each round to par', () => {
  const r = ready();
  assert.equal(r.hero.games, 3);
  assert.deepEqual(r.hero.unit, { one: 'round', many: 'rounds' });
  assert.equal(r.hero.record, null, 'golf has no win-loss record');
  // event ids rise with the calendar, and start_date is null on every event
  assert.deepEqual(r.hero.lastFive.map((g) => g.mark), ['-5', '+2', '-3']);
  assert.deepEqual(r.hero.lastFive.map((g) => g.tone), ['good', 'bad', 'good']);
  assert.equal(r.hero.tiles.find((t) => t.label === 'Best round')?.value, '-5');
});

// By id, not position: R10.4e put "Against the field" first on the golf page.
const byId = (r: NonNullable<ReturnType<typeof ready>>, id: string) => r.sections.find((s) => s.id === id)!;

test('against the field: each round beside the field average, strokes gained toned, him marked on the board', () => {
  const r = ready({
    field: [
      {
        eventId: '1',
        name: 'Test Championship',
        course: 'Test Course',
        roundsHeld: 2,
        fieldSize: 3,
        position: 2,
        tied: true,
        rounds: [
          { round: 1, me: -3, field: -1 },
          { round: 2, me: 1, field: -0.5 },
        ],
        leaders: [
          { espnId: '9', name: 'Leader', toPar: -4, me: false },
          { espnId: '1', name: 'Him', toPar: -2, me: true },
        ],
      },
    ],
  });
  const sec = byId(r, 'field');
  assert.equal(sec.state.kind, 'ready');
  const [rounds, board] = sec.rows[0];
  assert.ok(rounds.kind === 'table' && board.kind === 'table');
  assert.match(rounds.scope ?? '', /T2nd of 3 who played every round/);
  assert.match(rounds.scope ?? '', /2 of 4 rounds held/);
  assert.deepEqual(rounds.rows.map((x) => x.values.gain), ['+2.00', '-1.50'], 'field minus him: beating the field is positive');
  assert.deepEqual(rounds.rows.map((x) => x.tones?.gain), ['good', 'bad']);
  assert.equal(board.rows.find((x) => x.label === 'Him')?.highlight, true);
});

test('a golfer with no event held gets a reason, not an empty field', () => {
  const sec = byId(ready({ field: [] }), 'field');
  assert.equal(sec.state.kind, 'empty');
});

test('scoring by par reads the score against par, not the source’s category', () => {
  const card = byId(ready(), 'scoring').rows[0][1];
  assert.ok(card.kind === 'table');
  const par5 = card.rows.find((x) => x.key === 'par5')!;
  assert.equal(par5.values.eagle, 1, 'an eagle the category column would have called a birdie');
  const par4 = card.rows.find((x) => x.key === 'par4')!;
  assert.deepEqual([par4.values.bogey, par4.values.double], [1, 1]);
});

test('the rounds table is newest first and says when weather was not recorded', () => {
  const card = byId(ready(), 'scoring').rows[0][0];
  assert.ok(card.kind === 'table');
  assert.deepEqual(card.rows.map((x) => x.values.toPar), ['-3', '+2', '-5']);
  assert.equal(card.rows[1].values.wind, null);
});

test('the shot section says which seasons it draws on, every time', () => {
  const sec = byId(ready(), 'shots');
  assert.equal(sec.state.kind, 'ready');
  assert.match(sec.sub ?? '', /2021/);
  assert.match(sec.note ?? '', /2021 PGA TOUR shot seed/);
  assert.deepEqual(sec.rows.map((row) => row.map((c) => c.key)), [['drives', 'proximity'], ['putting', 'make'], ['lies']]);
});

test('a golfer the seed does not hold gets a reason, not an empty chart', () => {
  const sec = byId(ready({ shots: null }), 'shots');
  assert.equal(sec.state.kind, 'empty');
  assert.match(sec.state.kind === 'empty' ? sec.state.reason : '', /2020–2022/);
});

test('loading returns nothing yet; an error still names both sections', () => {
  assert.equal(toGolfResearch({ bio: null, golf: { data: null, loading: true, error: null } }), null);
  const r = toGolfResearch({ bio: null, golf: { data: null, loading: false, error: 'nope' } })!;
  assert.deepEqual(r.sections.map((s) => [s.id, s.state.kind]), [['scoring', 'error'], ['shots', 'error']]);
});
