/**
 * R2 — the season convention, and that both languages still agree on it.
 *
 * The drift half follows `tests/config-drift.test.ts`'s convention: TEXTUAL on
 * both sides. Importing the Python table from node is impossible, and
 * exporting the TypeScript one purely for a test would shape production code
 * around its test. Parsing both files means the test reads what a human reads.
 *
 * The behaviour half pins the cases that were actually wrong: a split season
 * labelled with one year, and NBA's end-year convention, which is the one
 * sport whose label is not the year it starts in and therefore the one every
 * re-derivation gets wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SEASON_CONVENTIONS,
  seasonLabel,
  seasonDateRange,
  seasonStartYear,
  seasonForDate,
  dateInSeason,
  realTeams,
  isSeasonSport,
} from '../lib/sports/shared/season';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test('a split season is never labelled with a single year', () => {
  assert.equal(seasonLabel('nba', 2026), '2025-26');
  assert.equal(seasonLabel('nhl', 2025), '2025-26');
  assert.equal(seasonLabel('nfl', 2025), '2025-26'); // ends Feb of the next year
  assert.equal(seasonLabel('cfb', 2025), '2025-26');
  assert.equal(seasonLabel('soccer_epl', 2025), '2025-26');
});

test('a single-calendar-year season is labelled with one year', () => {
  assert.equal(seasonLabel('mlb', 2026), '2026');
  assert.equal(seasonLabel('soccer_mls', 2026), '2026');
  assert.equal(seasonLabel('tennis_atp', 2026), '2026');
  assert.equal(seasonLabel('tennis_wta', 2026), '2026');
});

test('NBA is the one sport whose label is the year it ENDS in', () => {
  // The rule every re-derivation gets wrong: 2026 is the 2025-26 season, so it
  // starts in 2025.
  assert.equal(seasonStartYear('nba', 2026), 2025);
  // Every other sport's label is the year it starts.
  assert.equal(seasonStartYear('nhl', 2025), 2025);
  assert.equal(seasonStartYear('nfl', 2025), 2025);
  assert.equal(seasonStartYear('mlb', 2025), 2025);
});

test('the decade boundary does not produce "2019-0"', () => {
  assert.equal(seasonLabel('nhl', 2019), '2019-20');
  assert.equal(seasonLabel('nba', 2020), '2019-20');
  assert.equal(seasonLabel('nhl', 2009), '2009-10');
});

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

test("the end offset counts from the season's START year, not its label", () => {
  // Backwards, this puts the 2025-26 NBA season's end in May 2027.
  const nba = seasonDateRange('nba', 2026);
  assert.equal(nba.from, '2025-10-01');
  assert.equal(nba.to, '2026-05-15');
});

test('each sport\'s range matches the backfill script it was lifted from', () => {
  assert.deepEqual(seasonDateRange('nfl', 2025), { from: '2025-09-01', to: '2026-02-20' });
  assert.deepEqual(seasonDateRange('cfb', 2025), { from: '2025-08-15', to: '2026-01-20' });
  assert.deepEqual(seasonDateRange('soccer_epl', 2025), { from: '2025-08-01', to: '2026-06-05' });
  assert.deepEqual(seasonDateRange('soccer_mls', 2025), { from: '2025-02-15', to: '2025-12-15' });
  assert.deepEqual(seasonDateRange('nhl', 2025), { from: '2025-09-01', to: '2026-06-15' });
});

test('a range always ends after it starts', () => {
  for (const sport of Object.keys(SEASON_CONVENTIONS)) {
    const { from, to } = seasonDateRange(sport, 2025);
    assert.ok(to > from, `${sport}: ${from}..${to}`);
  }
});

test('consecutive seasons do not overlap for sports that do not play year-round', () => {
  for (const sport of ['nfl', 'cfb', 'nba', 'soccer_mls']) {
    const a = seasonDateRange(sport, 2025);
    const b = seasonDateRange(sport, 2026);
    assert.ok(b.from > a.to, `${sport}: ${a.to} then ${b.from}`);
  }
});

test('dateInSeason places a real game in the right season', () => {
  // The Raiders' 2025-09-15 game is in the 2025 NFL season, not 2026.
  assert.ok(dateInSeason('nfl', 2025, '2025-09-15'));
  assert.ok(!dateInSeason('nfl', 2026, '2025-09-15'));
  // An NBA All-Star date sits inside the season labelled with the END year.
  assert.ok(dateInSeason('nba', 2026, '2026-02-15'));
  assert.ok(!dateInSeason('nba', 2025, '2026-02-15'));
});

// ---------------------------------------------------------------------------
// Which season is "now"
// ---------------------------------------------------------------------------

test('between seasons, the current season is still the last one played', () => {
  // 14 Sep 2026: the NBA season has not tipped off, so the current season is
  // still 2026 (the 2025-26 one), which is what the page shows.
  assert.equal(seasonForDate('nba', new Date('2026-09-14T12:00:00Z')), 2026);
  // Once October arrives it rolls to 2027 (the 2026-27 season).
  assert.equal(seasonForDate('nba', new Date('2026-10-02T12:00:00Z')), 2027);
});

test('NFL and CFB roll over at their own start dates, not in January', () => {
  assert.equal(seasonForDate('nfl', new Date('2026-08-15T12:00:00Z')), 2025);
  assert.equal(seasonForDate('nfl', new Date('2026-09-02T12:00:00Z')), 2026);
  // A January playoff game still belongs to the previous autumn's season.
  assert.equal(seasonForDate('nfl', new Date('2026-01-10T12:00:00Z')), 2025);
  assert.equal(seasonForDate('cfb', new Date('2026-01-10T12:00:00Z')), 2025);
});

test('calendar sports just use the year', () => {
  assert.equal(seasonForDate('mlb', new Date('2026-03-01T12:00:00Z')), 2026);
  assert.equal(seasonForDate('tennis_atp', new Date('2026-12-31T12:00:00Z')), 2026);
});

test('the season boundary is read on the Eastern date, not UTC', () => {
  // 2026-10-01T02:00Z is still 30 September, 10pm, in New York — so the NBA
  // season has NOT started yet. Every helper this replaces used getUTCMonth()
  // and would have rolled over here.
  assert.equal(seasonForDate('nba', new Date('2026-10-01T02:00:00Z')), 2026);
  assert.equal(seasonForDate('nba', new Date('2026-10-01T16:00:00Z')), 2027);
});

test('an unknown sport throws rather than guessing', () => {
  assert.ok(!isSeasonSport('cricket'));
  assert.throws(() => seasonLabel('cricket', 2026), /No season convention/);
});

// ---------------------------------------------------------------------------
// Real teams
// ---------------------------------------------------------------------------

test('All-Star teams are dropped from a rank pool', () => {
  // The measured shape: 30 real NBA teams at ~244 game days, plus the nine
  // All-Star entries at 1-2.
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => ({ teamId: String(i + 1), games: 240 + (i % 6) })),
    { teamId: '130581', games: 1 },
    { teamId: '130754', games: 1 },
    { teamId: '130580', games: 1 },
    { teamId: '130579', games: 1 },
    { teamId: '111386', games: 1 },
    { teamId: '132375', games: 2 },
    { teamId: '132374', games: 2 },
    { teamId: '31', games: 1 },
    { teamId: '32', games: 1 },
  ];
  const kept = realTeams(rows);
  assert.equal(kept.length, 30);
  assert.ok(!kept.some((r) => r.teamId === '130581'));
  assert.ok(!kept.some((r) => r.teamId === '31'));
});

test('a short but real season is kept — the threshold is not a games-played filter', () => {
  // A team that joined mid-window still played a real schedule.
  const rows = [
    { teamId: 'a', games: 82 },
    { teamId: 'b', games: 82 },
    { teamId: 'c', games: 41 },
  ];
  assert.equal(realTeams(rows).length, 3);
});

test('realTeams survives an empty or all-zero pool without dividing by nothing', () => {
  assert.deepEqual(realTeams([]), []);
  assert.deepEqual(realTeams([{ teamId: 'a', games: 0 }]), []);
});

// ---------------------------------------------------------------------------
// Cross-language drift
// ---------------------------------------------------------------------------

function parseTable(src: string): Record<string, string> {
  const body = src.split('SEASON_CONVENTIONS_START')[1]?.split('SEASON_CONVENTIONS_END')[0];
  assert.ok(body, 'convention table markers missing');
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    // Both languages: `key: { ... }` / `"key": { ... }`, one sport per line.
    const m = /^\s*"?([a-z_]+)"?:\s*[{(](.+)[})],?\s*$/.exec(line);
    if (!m) continue;
    // Normalize away the syntax that genuinely differs: quotes, tuple vs array
    // brackets, and whitespace. What is left is the rule itself.
    out[m[1]] = m[2].replace(/["']/g, '').replace(/[[\]()]/g, '').replace(/\s+/g, '');
  }
  return out;
}

test('the TypeScript and Python season tables are identical', () => {
  const ts = parseTable(fs.readFileSync('lib/sports/shared/season.ts', 'utf8'));
  const py = parseTable(fs.readFileSync('python-odds-service/src/season.py', 'utf8'));

  assert.ok(Object.keys(ts).length >= 9, `parsed only ${Object.keys(ts).length} TS sports`);
  assert.deepEqual(Object.keys(ts).sort(), Object.keys(py).sort(), 'the two tables cover different sports');
  for (const sport of Object.keys(ts)) {
    assert.equal(py[sport], ts[sport], `"${sport}" differs between the two files`);
  }
});

test('the real-team fraction is the same number in both languages', () => {
  const ts = /REAL_TEAM_MIN_GAMES_FRACTION = ([\d.]+)/.exec(fs.readFileSync('lib/sports/shared/season.ts', 'utf8'));
  const py = /REAL_TEAM_MIN_GAMES_FRACTION = ([\d.]+)/.exec(fs.readFileSync('python-odds-service/src/season.py', 'utf8'));
  assert.ok(ts && py, 'fraction not found in one of the two files');
  assert.equal(ts[1], py[1]);
});

test('the TypeScript table covers every sport the app stores history for', () => {
  for (const sport of ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer_epl', 'soccer_mls', 'tennis_atp', 'tennis_wta']) {
    assert.ok(isSeasonSport(sport), `${sport} missing from SEASON_CONVENTIONS`);
  }
});

// ---------------------------------------------------------------------------
// The ranked-block label (R2 ranks + early-season fallback)
// ---------------------------------------------------------------------------

test('rankScopeLabel uses each sport\'s own convention, not the bare number', async () => {
  const { rankScopeLabel } = await import('../lib/sports/shared/seasonAggregateShapes');
  const base = { poolSize: 30, byEntity: {}, throughDate: null, computedAt: '' };
  // NBA's label is the year the season ENDS — `${season} season` printed
  // "2026 season" for the 2025-26 one.
  assert.equal(
    rankScopeLabel({ ...base, sport: 'nba', season: 2026, requestedSeason: 2026, isFallback: false, fallbackReason: null }),
    '2025-26 season',
  );
  assert.equal(
    rankScopeLabel({ ...base, sport: 'tennis_atp', season: 2026, requestedSeason: 2026, isFallback: false, fallbackReason: null }),
    '2026 season',
  );
});

test('rankScopeLabel says so when the ranks are last season\'s', async () => {
  const { rankScopeLabel } = await import('../lib/sports/shared/seasonAggregateShapes');
  const base = { poolSize: 138, byEntity: {}, throughDate: null, computedAt: '' };
  // The measured 2026-09-14 state: CFB serving 2025 ranks three weeks into 2026.
  const label = rankScopeLabel({ ...base, sport: 'cfb', season: 2025, requestedSeason: 2026, isFallback: true, fallbackReason: 'x' });
  assert.ok(label?.startsWith('2025-26 season'), label);
  assert.ok(label?.includes('2026-27'), label);
  assert.ok(label?.includes('too few games'), label);
});

test('rankScopeLabel is undefined when there is no pool to label', async () => {
  const { rankScopeLabel } = await import('../lib/sports/shared/seasonAggregateShapes');
  assert.equal(rankScopeLabel(null), undefined);
  assert.equal(
    rankScopeLabel({ sport: 'nba', season: 0, requestedSeason: 0, isFallback: false, fallbackReason: null, poolSize: 0, byEntity: {}, throughDate: null, computedAt: '' }),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// Page-level early-season fallback
// ---------------------------------------------------------------------------

test('a season too young to open on falls back, and says why', async () => {
  const { seasonScope, SEASON_MIN_GAMES } = await import('../lib/sports/shared/season');
  // Week 2 of an NFL season: 1 game played, 4 needed.
  const s = seasonScope('nfl', 1, new Date('2026-09-14T12:00:00Z'));
  assert.equal(s.isFallback, true);
  assert.equal(s.season, 2025);
  assert.ok(s.reason?.includes('2026-27'), s.reason ?? '');
  assert.ok(s.reason?.includes('1 game'), s.reason ?? '');
  assert.ok(!s.reason?.includes('1 games'), 'singular, not "1 games"');
  assert.equal(SEASON_MIN_GAMES.nfl, 4);
});

test('a season past the threshold opens on itself, with no reason to state', async () => {
  const { seasonScope } = await import('../lib/sports/shared/season');
  const s = seasonScope('nfl', 4, new Date('2026-10-14T12:00:00Z'));
  assert.equal(s.isFallback, false);
  assert.equal(s.season, 2026);
  assert.equal(s.reason, null);
});

test('each sport\'s threshold scales with its season length', async () => {
  const { SEASON_MIN_GAMES } = await import('../lib/sports/shared/season');
  assert.equal(SEASON_MIN_GAMES.cfb, 4);
  assert.equal(SEASON_MIN_GAMES.nba, 15);
  assert.equal(SEASON_MIN_GAMES.nhl, 15);
  assert.equal(SEASON_MIN_GAMES.mlb, 20);
  assert.equal(SEASON_MIN_GAMES.soccer_epl, 6);
  assert.equal(SEASON_MIN_GAMES.soccer_mls, 6);
});

test('tennis never falls back — a calendar year either has matches or does not', async () => {
  const { seasonScope } = await import('../lib/sports/shared/season');
  assert.equal(seasonScope('tennis_atp', 0, new Date('2026-01-02T12:00:00Z')).isFallback, false);
});

// ---------------------------------------------------------------------------
// Neutral stats
// ---------------------------------------------------------------------------

test('direction-less stats are declared neutral, and never also have a direction', async () => {
  const { SEASON_AGGREGATE_SPECS } = await import('../lib/sports/shared/seasonAggregateSpecs');
  const neutral: string[] = [];
  for (const spec of Object.values(SEASON_AGGREGATE_SPECS)) {
    for (const st of spec.stats) {
      if (st.neutral) {
        neutral.push(`${spec.sport}.${st.key}`);
        assert.notEqual(st.lowerIsBetter, true, `${spec.sport}.${st.key} is both neutral and lowerIsBetter`);
      }
    }
  }
  // The audit's complaint was fouls and offsides rendering green; NHL hits had
  // no direction at all and so ranked higher-is-better.
  assert.ok(neutral.includes('nba.fouls'), neutral.join(','));
  assert.ok(neutral.includes('soccer_epl.foulsCommitted'), neutral.join(','));
  assert.ok(neutral.includes('soccer_epl.offsides'), neutral.join(','));
  assert.ok(neutral.includes('nhl.hits'), neutral.join(','));
});

test('a neutral stat is ranked but does not vote in a unit grade', async () => {
  const { rankPool } = await import('../lib/sports/shared/seasonAggregateShapes');
  const spec = {
    sport: 'test',
    groupBy: 'team_id' as const,
    minGames: 1,
    stats: [
      { key: 'good', label: 'Good', statKey: 'good', decimals: 1, perGame: false },
      { key: 'style', label: 'Style', statKey: 'style', decimals: 1, perGame: false, neutral: true },
    ],
    units: [{ key: 'u', label: 'Unit', statKeys: ['good', 'style'] }],
  };
  const out = rankPool(spec as never, [
    { entityId: 'a', games: 10, sums: [100, 1] },
    { entityId: 'b', games: 10, sums: [1, 100] },
  ]);
  // Both stats still rank — "most of X" is a fact either way.
  assert.equal(out.a.stats.length, 2);
  assert.equal(out.a.stats.find((s) => s.key === 'style')?.neutral, true);
  assert.equal(out.a.stats.find((s) => s.key === 'good')?.neutral, undefined);
  // `a` is best at the graded stat and worst at the neutral one. If the
  // neutral stat voted, both grades would land mid-table; with only the
  // graded stat voting they are the extremes.
  assert.equal(out.a.units[0].composite, 100, 'the neutral stat voted in the grade');
  assert.equal(out.b.units[0].composite, 0, 'the neutral stat voted in the grade');
});
