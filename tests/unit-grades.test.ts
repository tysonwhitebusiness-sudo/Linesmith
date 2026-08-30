import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  unitGradeFromRanked,
  letterFromPercentile,
  percentileOfRank,
  rankOfPercentile,
  mergeUnitRows,
  findUnit,
  type UnitGrade,
} from '../lib/sports/shared/unitGrades';
import { toNflUnitGrades, NFL_UNITS, type TeamGrades } from '../lib/sports/nfl/nflTeamGrades';

/**
 * Phase 6.1 — `TeamGrades` (nine hardcoded NFL unit names) -> `UnitGrade[]`.
 *
 * WHY THIS TEST EXISTS. The old type was the reason three fields on two shared
 * interfaces sat permanently `null` on six of seven sports, and the reason
 * MLB's own adapter carried the comment "MLB has no grading model" — a claim
 * about the type, not about MLB. Nothing in `tsc` can tell you a type is
 * unfillable by six sports; it compiles perfectly while doing it.
 *
 * So the assertions below come in two halves. The first half tests the
 * functions. The second half tests the WIRING — that the NFL struct has not
 * crept back into the shared components or the shared interfaces — because the
 * failure this phase is guarding against is not "the function is wrong", it is
 * "someone added a tenth NFL-shaped field and six sports quietly lost it".
 * That is the same failure mode `tests/model-source-filter.test.ts` guards, for
 * the same reason: it is invisible unless you read every line of a 100KB file.
 */

// ---------------------------------------------------------------------------
// The functions
// ---------------------------------------------------------------------------

test('percentileOfRank puts rank 1 at 100 and last at 0', () => {
  assert.equal(percentileOfRank(1, 30), 100);
  assert.equal(percentileOfRank(30, 30), 0);
  // Single-item pool can't be ranked against anything — treat as top rather
  // than dividing by zero.
  assert.equal(percentileOfRank(1, 1), 100);
});

test('rankOfPercentile inverts percentileOfRank', () => {
  for (const [rank, pool] of [[1, 30], [15, 30], [30, 30], [7, 32]] as const) {
    assert.equal(rankOfPercentile(percentileOfRank(rank, pool), pool), rank);
  }
});

test('letterFromPercentile buckets the full range without gaps', () => {
  assert.equal(letterFromPercentile(100), 'A+');
  assert.equal(letterFromPercentile(0), 'F');
  // Every integer percentile must map to something — a gap would render an
  // empty chip rather than a grade.
  for (let p = 0; p <= 100; p++) {
    assert.ok(letterFromPercentile(p).length > 0, `no grade at percentile ${p}`);
  }
});

test('unitGradeFromRanked returns null when nothing carries a rank', () => {
  // THE DON'T-FABRICATE CONTRACT (CLAUDE.md sport-adapter §2). A sport calling
  // this for a unit it has no ranked data for must get nothing back, so it
  // omits the unit rather than showing a made-up grade. If this ever returns a
  // UnitGrade, every sport silently gains fake grades for every unit.
  assert.equal(unitGradeFromRanked({ key: 'bullpen', label: 'Bullpen' }, []), null);
  assert.equal(unitGradeFromRanked({ key: 'bullpen', label: 'Bullpen' }, [{ rank: null, poolSize: 30 }]), null);
  assert.equal(unitGradeFromRanked({ key: 'bullpen', label: 'Bullpen' }, [{ rank: 4, poolSize: null }]), null);
  // A pool of one can't rank anything meaningfully.
  assert.equal(unitGradeFromRanked({ key: 'bullpen', label: 'Bullpen' }, [{ rank: 1, poolSize: 1 }]), null);
});

test('unitGradeFromRanked grades a best-in-league unit A+', () => {
  const u = unitGradeFromRanked({ key: 'hitting', label: 'Hitting', short: 'HIT' }, [
    { rank: 1, poolSize: 30 },
    { rank: 1, poolSize: 30 },
  ]);
  assert.ok(u);
  assert.equal(u.grade, 'A+');
  assert.equal(u.composite, 100);
  assert.equal(u.rank, 1);
  assert.equal(u.poolSize, 30);
  assert.equal(u.short, 'HIT');
});

test('unitGradeFromRanked averages PERCENTILES, not ranks, across unequal pools', () => {
  // Rank 1 of 3 and rank 1 of 100 are both "best", but their raw ranks are
  // identical while their meaning is not — and rank 2 of 3 (50th percentile)
  // is nothing like rank 2 of 100 (99th). Averaging raw ranks would collapse
  // that distinction. This is the fault-injection case: swap the mean over
  // percentiles for a mean over ranks in `unitGradeFromRanked` and this test
  // fails by name.
  const mixed = unitGradeFromRanked({ key: 'u', label: 'U' }, [
    { rank: 2, poolSize: 3 }, // 50th percentile
    { rank: 2, poolSize: 100 }, // ~99th percentile
  ]);
  assert.ok(mixed);
  // Mean of percentiles is ~74.7. A mean of raw ranks (2) would score this
  // against the larger pool as ~99th, i.e. an A.
  assert.ok(mixed.composite > 70 && mixed.composite < 80, `composite was ${mixed.composite}`);
  assert.equal(mixed.grade, 'B+');
});

test('unitGradeFromRanked reports the largest contributing pool', () => {
  // A displayed "rank N of M" must not understate the field it was measured
  // against, or the chip's tooltip claims a stronger placing than it earned.
  const u = unitGradeFromRanked({ key: 'u', label: 'U' }, [
    { rank: 1, poolSize: 12 },
    { rank: 1, poolSize: 30 },
  ]);
  assert.ok(u);
  assert.equal(u.poolSize, 30);
});

test('findUnit looks up by key and tolerates a null unit list', () => {
  const units: UnitGrade[] = [
    { key: 'offense', label: 'Offense', grade: 'A', composite: 90, rank: 4, poolSize: 32 },
  ];
  assert.equal(findUnit(units, 'offense')?.grade, 'A');
  assert.equal(findUnit(units, 'defense'), null);
  assert.equal(findUnit(null, 'offense'), null);
});

// ---------------------------------------------------------------------------
// The type is genuinely generic — the whole point of 6.1
// ---------------------------------------------------------------------------

test('a non-NFL unit set round-trips, which TeamGrades could not express', () => {
  // THE PROOF. None of these keys exist on `TeamGrades`, so none of them could
  // be represented at all before 6.1 — NHL's four in particular were the case
  // named in the plan as structurally impossible.
  const nhl: UnitGrade[] = [
    { key: 'offence', label: 'Offence', short: 'OFF', grade: 'B+', composite: 68, rank: 11, poolSize: 32 },
    { key: 'defence', label: 'Defence', short: 'DEF', grade: 'A-', composite: 77, rank: 8, poolSize: 32 },
    { key: 'powerPlay', label: 'Power play', grade: 'C', composite: 28, rank: 23, poolSize: 32 },
    { key: 'penaltyKill', label: 'Penalty kill', grade: 'B', composite: 58, rank: 14, poolSize: 32 },
  ];
  const mlb: UnitGrade[] = [
    { key: 'hitting', label: 'Hitting', short: 'HIT', grade: 'A', composite: 88, rank: 4, poolSize: 30 },
    { key: 'pitching', label: 'Pitching', short: 'PIT', grade: 'C+', composite: 38, rank: 19, poolSize: 30 },
  ];

  assert.equal(findUnit(nhl, 'penaltyKill')?.label, 'Penalty kill');
  // Header chip row is driven by `short` presence, not by a fixed count — NHL
  // shows two, MLB shows two, NFL shows three.
  assert.equal(nhl.filter((u) => u.short).length, 2);
  assert.equal(mlb.filter((u) => u.short).length, 2);
});

test('mergeUnitRows unions both sides in the away side order', () => {
  const away: UnitGrade[] = [
    { key: 'hitting', label: 'Hitting', grade: 'A', composite: 90, rank: 3, poolSize: 30 },
    { key: 'pitching', label: 'Pitching', grade: 'B', composite: 60, rank: 12, poolSize: 30 },
  ];
  const home: UnitGrade[] = [
    { key: 'pitching', label: 'Pitching', grade: 'C', composite: 30, rank: 21, poolSize: 30 },
    { key: 'bullpen', label: 'Bullpen', grade: 'A-', composite: 78, rank: 7, poolSize: 30 },
  ];
  assert.deepEqual(mergeUnitRows(away, home).map((r) => r.key), ['hitting', 'pitching', 'bullpen']);
  // One side missing entirely still renders the other's rows, rather than
  // collapsing the table to nothing.
  assert.deepEqual(mergeUnitRows(null, home).map((r) => r.key), ['pitching', 'bullpen']);
  assert.deepEqual(mergeUnitRows(null, null), []);
});

// ---------------------------------------------------------------------------
// NFL keeps exactly what it had
// ---------------------------------------------------------------------------

const FULL_NFL_GRADES: TeamGrades = {
  offense: { grade: 'A', composite: 88, rank: 4, poolSize: 32 },
  defense: { grade: 'B', composite: 58, rank: 14, poolSize: 32 },
  specialTeams: { grade: 'C', composite: 28, rank: 23, poolSize: 32 },
  secondary: { grade: 'B+', composite: 68, rank: 11, poolSize: 32 },
  linebackers: { grade: 'A-', composite: 77, rank: 8, poolSize: 32 },
  dLine: { grade: 'D', composite: 8, rank: 30, poolSize: 32 },
  passingOffense: { grade: 'A+', composite: 97, rank: 1, poolSize: 32 },
  rushingOffense: { grade: 'C-', composite: 18, rank: 27, poolSize: 32 },
  receivingOffense: { grade: 'B-', composite: 48, rank: 17, poolSize: 32 },
};

test('toNflUnitGrades emits all nine units in NFL_UNITS order', () => {
  const units = toNflUnitGrades(FULL_NFL_GRADES);
  assert.ok(units);
  assert.equal(units.length, 9);
  assert.deepEqual(units.map((u) => u.key), NFL_UNITS.map((u) => u.key));
  // Values pass through untouched — 6.1 was a reshape, not a recomputation.
  assert.equal(findUnit(units, 'passingOffense')?.grade, 'A+');
  assert.equal(findUnit(units, 'dLine')?.rank, 30);
});

test('toNflUnitGrades gives exactly OFF/DEF/ST a short form', () => {
  // These three are what `TeamDetail.tsx` and the game hero card used to
  // hardcode. The header row now filters on `short`, so if this set changes
  // the header row silently changes with it.
  const units = toNflUnitGrades(FULL_NFL_GRADES);
  assert.ok(units);
  assert.deepEqual(
    units.filter((u) => u.short).map((u) => u.short),
    ['OFF', 'DEF', 'ST'],
  );
});

test('toNflUnitGrades drops units NFL computed as null, and returns null for none', () => {
  const partial: TeamGrades = { ...FULL_NFL_GRADES, dLine: null, linebackers: null };
  const units = toNflUnitGrades(partial);
  assert.ok(units);
  assert.equal(units.length, 7);
  assert.equal(findUnit(units, 'dLine'), null);

  assert.equal(toNflUnitGrades(null), null);
  assert.equal(toNflUnitGrades(undefined), null);
  const empty = Object.fromEntries(NFL_UNITS.map((u) => [u.key, null])) as unknown as TeamGrades;
  assert.equal(toNflUnitGrades(empty), null, 'all-null grades must read as "no grading model", not an empty table');
});

// ---------------------------------------------------------------------------
// The wiring — this half is what actually protects Phase 6.1
// ---------------------------------------------------------------------------

const TEAM_DETAIL_ADAPTERS = ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer'] as const;

test('every team adapter returns unitGrades, and none returns the old grades field', () => {
  for (const sport of TEAM_DETAIL_ADAPTERS) {
    const src = readFileSync(`lib/sports/${sport}/adapters/teamDetailAdapter.ts`, 'utf8');
    assert.match(
      src,
      /\n\s*unitGrades:/,
      `${sport}'s teamDetailAdapter does not return \`unitGrades\`. Every sport must, ` +
        `even as null — an omitted field means the sport silently lost its grade section.`,
    );
    assert.doesNotMatch(
      src,
      /\n\s*grades: (null|grades|TeamGrades)/,
      `${sport}'s teamDetailAdapter still returns the pre-6.1 \`grades\` field, whose ` +
        `nine hardcoded NFL unit names no other sport can fill.`,
    );
  }
});

test('the shared components hold no fixed list of NFL unit names', () => {
  // `GRADE_ROWS` was a hardcoded nine-entry array typed `keyof TeamGrades`, and
  // `TeamDetail.tsx` hardcoded three `<GradeChip label="OFF"|"DEF"|"ST">`
  // calls. Both are the same bug: a shared component naming one sport's units.
  for (const file of ['components/GameDetail.tsx', 'components/TeamDetail.tsx', 'components/GradeChip.tsx']) {
    const src = readFileSync(file, 'utf8')
      // Comments legitimately describe what was removed and why.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(
      src,
      /keyof TeamGrades/,
      `${file} types something as \`keyof TeamGrades\`, which restricts it to NFL's nine units.`,
    );
    for (const nflOnly of ['specialTeams', 'passingOffense', 'rushingOffense', 'receivingOffense', 'linebackers', 'dLine']) {
      assert.doesNotMatch(
        src,
        new RegExp(`\\b${nflOnly}\\b`),
        `${file} names the NFL-only unit \`${nflOnly}\`. A shared component must not know ` +
          `any sport's unit names — they arrive as data on \`UnitGrade[]\`.`,
      );
    }
  }
});

test('the shared data interfaces do not import the NFL grade struct', () => {
  for (const file of [
    'lib/sports/mlb/adapters/teamDetailAdapter.ts',
    'lib/sports/mlb/adapters/gameDetailAdapter.ts',
  ]) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      src,
      /^import .*\bTeamGrades?\b.*from '@\/lib\/sports\/nfl\/nflTeamGrades'/m,
      `${file} imports NFL's grade struct. These files declare the SHARED ` +
        `TeamDetailData/GameDetailData interfaces every sport fills; importing one ` +
        `sport's struct into them is exactly what 6.1 removed.`,
    );
  }
});

test('MLB grades its units from ranked Statcast rather than declaring it has no model', () => {
  const src = readFileSync('lib/sports/mlb/adapters/teamDetailAdapter.ts', 'utf8');
  assert.match(
    src,
    /unitGradeFromRanked\(/,
    'MLB no longer builds unit grades. Its ranked team Statcast tiles are the input; ' +
      'reverting to a hardcoded null restores the "MLB has no grading model" claim 6.1 disproved.',
  );
});
