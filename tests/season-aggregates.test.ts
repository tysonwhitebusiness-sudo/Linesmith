import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupStats, toStatComparisonGroups, type SeasonAggregateSpec, type EntitySeasonAggregate } from '../lib/sports/shared/seasonAggregateShapes';
import {
  SEASON_AGGREGATE_SPECS,
  NHL_SEASON_SPEC,
  NBA_SEASON_SPEC,
  TENNIS_ATP_SEASON_SPEC,
  TENNIS_WTA_SEASON_SPEC,
} from '../lib/sports/shared/seasonAggregateSpecs';
import type { OpposingStarterStat } from '../components/PlayerDetail';

/**
 * Phase 6.1b/6.2b — season aggregates and ranks from `player_game_history`.
 *
 * These tests are all offline. The rollup itself is a real Postgres scan and
 * is verified against live data by running it (measured NHL 11.7s / NBA 3.0s /
 * tennis 37s, real leaders, real pools); what is asserted here is everything
 * that can go silently wrong WITHOUT throwing:
 *
 * - a misspelled `statKey` does not fail — `stats->>'wrongKey'` is NULL, SUM
 *   is 0, and every entity ranks equal-last with a straight face;
 * - a stat in a unit's `statKeys` that no `SeasonStatDef` defines contributes
 *   nothing to the grade, silently lowering it;
 * - a `lowerIsBetter` flag missing from a "fewer is better" stat inverts the
 *   ranking, which reads as a real placing.
 *
 * The measured key sets are pinned here so a spec cannot drift onto a key the
 * table does not have without this failing.
 */

/** Confirmed present in `player_game_history.stats` on 2026-08-30, by counting distinct JSONB keys per sport. */
const MEASURED_KEYS: Record<string, string[]> = {
  nhl: [
    'pim', 'toiMinutes', 'shifts', 'blockedShots', 'giveaways', 'assists', 'plusMinus', 'sog', 'goals',
    'powerPlayGoals', 'takeaways', 'hits', 'points', 'faceoffWinningPctg',
    'goalsAgainst', 'shotsAgainst', 'evenStrengthGoalsAgainst', 'shorthandedGoalsAgainst',
    'powerPlayGoalsAgainst', 'saves', 'isGoalie',
  ],
  nba: [
    'fouls', 'steals', 'blocks', 'points', 'offensiveRebounds', 'fieldGoalsAttempted', 'freeThrowsAttempted',
    'assists', 'plusMinus', 'threePointFieldGoalsAttempted', 'threePointFieldGoalsMade', 'rebounds',
    'defensiveRebounds', 'freeThrowsMade', 'fieldGoalsMade', 'turnovers', 'minutes',
  ],
  tennis_atp: ['is_major', 'games_won', 'tiebreaks_played', 'games_lost', 'sets_lost', 'sets_won', 'match_won', 'is_qualifying'],
  tennis_wta: ['is_major', 'games_won', 'tiebreaks_played', 'games_lost', 'sets_lost', 'sets_won', 'match_won', 'is_qualifying'],
};

test('every spec only sums stat keys the table actually has', () => {
  for (const [sport, spec] of Object.entries(SEASON_AGGREGATE_SPECS)) {
    const known = MEASURED_KEYS[sport];
    assert.ok(known, `no measured key set pinned for ${sport} — add one rather than trusting the spec`);
    for (const s of spec.stats) {
      assert.ok(
        known.includes(s.statKey),
        `${sport}'s spec sums \`${s.statKey}\`, which is not a key player_game_history holds for that sport. ` +
          `This does NOT throw at runtime: the sum is 0 and every entity ranks equal-last.`,
      );
    }
  }
});

test('is_major is never summed — it is 0.0 on every tennis row', () => {
  // Measured 2026-08-30: SUM((stats->>'is_major')::numeric) is exactly 0 across
  // all 129,812 ATP and 142,152 WTA rows, every season. The key exists and is
  // always false. Ranking on it would tie every player at zero and hand each an
  // arbitrary placing.
  for (const spec of [TENNIS_ATP_SEASON_SPEC, TENNIS_WTA_SEASON_SPEC]) {
    assert.ok(
      !spec.stats.some((s) => s.statKey === 'is_major'),
      `${spec.sport} ranks on is_major, which is 0.0 on every row in the table.`,
    );
  }
});

test('tennis excludes doubles pairings from the singles ranking pool', () => {
  // 19% of ATP rows are doubles, stored as compound athlete ids ("2725-2434").
  // Measured: the pool is 412 with them and 349 without.
  for (const spec of [TENNIS_ATP_SEASON_SPEC, TENNIS_WTA_SEASON_SPEC]) {
    assert.equal(
      spec.excludeCompoundIds,
      true,
      `${spec.sport} would rank singles players against doubles pairs, which win far more games per match.`,
    );
  }
  // And the filter has to actually be in the query, not just on the spec.
  const src = readFileSync('lib/sports/shared/seasonAggregates.ts', 'utf8');
  assert.match(src, /excludeCompoundIds \? `AND \$\{spec\.groupBy\} NOT LIKE '%-%'`/, 'the spec flag is declared but no longer applied in the SQL');
});

test('every unit grades on stats its own spec defines', () => {
  for (const [sport, spec] of Object.entries(SEASON_AGGREGATE_SPECS)) {
    const defined = new Set(spec.stats.map((s) => s.key));
    for (const u of spec.units) {
      assert.ok(u.statKeys.length > 0, `${sport}'s unit \`${u.key}\` grades on nothing`);
      for (const k of u.statKeys) {
        assert.ok(
          defined.has(k),
          `${sport}'s unit \`${u.key}\` grades on \`${k}\`, which no SeasonStatDef defines. ` +
            `That stat silently contributes nothing and the grade comes out lower than it should.`,
        );
      }
    }
  }
});

test('stats where fewer is better are flagged lowerIsBetter', () => {
  // Getting this wrong does not throw — it inverts the ranking and shows the
  // worst team in the league as first.
  const FEWER_IS_BETTER = [
    'goalsAgainst', 'giveaways', 'pim', 'turnovers', 'fouls', 'setsLost', 'gamesLost', 'qualifying',
  ];
  for (const [sport, spec] of Object.entries(SEASON_AGGREGATE_SPECS)) {
    for (const s of spec.stats) {
      if (FEWER_IS_BETTER.includes(s.key)) {
        assert.equal(s.lowerIsBetter, true, `${sport}'s \`${s.key}\`: fewer is better, but it ranks highest-first.`);
      }
    }
  }
});

test('specs use the tables own sport vocabulary, not the pages', () => {
  // `player_game_history` stores tennis_atp/tennis_wta and soccer_epl/soccer_mls;
  // pick_history and the routes use `tennis`/`soccer`. Mixing them silently
  // returns zero rows.
  for (const [key, spec] of Object.entries(SEASON_AGGREGATE_SPECS)) {
    assert.equal(key, spec.sport, `registry key ${key} does not match its spec's sport ${spec.sport}`);
    assert.ok(spec.sport !== 'tennis' && spec.sport !== 'soccer', `${spec.sport} is the page vocabulary, not the table's`);
  }
});

test('an individual sport groups by athlete and a team sport by team', () => {
  assert.equal(NHL_SEASON_SPEC.groupBy, 'team_id');
  assert.equal(NBA_SEASON_SPEC.groupBy, 'team_id');
  // All 271,964 tennis rows carry a null team_id, so a team rollup returns nothing.
  assert.equal(TENNIS_ATP_SEASON_SPEC.groupBy, 'athlete_id');
});

// ---------------------------------------------------------------------------
// Shaping helpers
// ---------------------------------------------------------------------------

const spec: SeasonAggregateSpec = {
  sport: 'test',
  groupBy: 'team_id',
  minGames: 1,
  stats: [
    { key: 'a', label: 'A', statKey: 'a', decimals: 1, perGame: true, group: 'Offence' },
    { key: 'b', label: 'B', statKey: 'b', decimals: 1, perGame: true, group: 'Offence' },
    { key: 'c', label: 'C', statKey: 'c', decimals: 1, perGame: true, group: 'Defence' },
  ],
  units: [],
};

const stat = (key: string, rank: number): OpposingStarterStat => ({ key, label: key.toUpperCase(), value: 1, decimals: 1, rank, poolSize: 30 });

test('groupStats buckets by each stats declared group, in first-seen order', () => {
  const grouped = groupStats(spec, [stat('a', 1), stat('c', 2), stat('b', 3)]);
  assert.deepEqual(grouped.map((g) => g.label), ['Offence', 'Defence']);
  assert.deepEqual(grouped[0].stats.map((s) => s.key), ['a', 'b']);
  assert.deepEqual(grouped[1].stats.map((s) => s.key), ['c']);
});

test('toStatComparisonGroups pairs both sides and tolerates a one-sided stat', () => {
  const home: EntitySeasonAggregate = { entityId: 'h', games: 40, stats: [stat('a', 1), stat('c', 4)], units: [] };
  const away: EntitySeasonAggregate = { entityId: 'a', games: 40, stats: [stat('a', 9)], units: [] };
  const groups = toStatComparisonGroups(spec, away, home);
  assert.deepEqual(groups.map((g) => g.label), ['Offence', 'Defence']);
  assert.equal(groups[0].rows[0].away?.rank, 9);
  assert.equal(groups[0].rows[0].home.rank, 1);
  // `c` is home-only — the row still renders, one-sided, rather than vanishing.
  assert.equal(groups[1].rows[0].away, undefined);
  assert.equal(groups[1].rows[0].home.key, 'c');
});

test('toStatComparisonGroups returns nothing when the home side has no aggregate', () => {
  assert.deepEqual(toStatComparisonGroups(spec, null, null), []);
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

test('the season-ranks route caches, and validates its sport before keying', () => {
  const src = readFileSync('app/api/season-ranks/route.ts', 'utf8');
  // The rollup is an 11-37s scan. Serving it uncached makes every visitor pay
  // that -- the exact failure CLAUDE.md's caching convention exists to stop.
  assert.match(src, /cachedRoute\(/, 'season-ranks must go through cachedRoute — its build is a multi-second table scan');
  // An unvalidated sport mints a permanent snapshot_cache row per value.
  assert.match(src, /SEASON_AGGREGATE_SPECS\[sport\]/, 'sport must be validated against the spec registry before it reaches a cache key');
  assert.match(src, /cacheKey: `season-ranks:/, 'cache key must stay namespaced — snapshot_cache is one flat table');
});

// ---------------------------------------------------------------------------
// Adapter wiring — the half that protects against a silent regression
// ---------------------------------------------------------------------------

/**
 * Verified live on 2026-08-30 by resolving each app-side team list against a
 * real rollup: **NHL 32/32 and NBA 30/30 team ids joined**, and tennis 60/60
 * sampled `prop_odds` subject ids resolved once the `espn:tennis:` prefix was
 * stripped. That join is the whole feature — if the id spaces ever diverge,
 * every lookup returns `undefined`, all three blocks go back to their empty
 * states, and nothing throws.
 */
test('the sports that had no ranks now consume the season rollup', () => {
  const GAME_ADAPTERS = ['nba', 'nhl', 'tennis'] as const;
  for (const sport of GAME_ADAPTERS) {
    const src = readFileSync(`lib/sports/${sport}/adapters/gameDetailAdapter.ts`, 'utf8');
    assert.match(src, /seasonRanks/, `${sport}'s game adapter no longer reads seasonRanks`);
    assert.match(
      src,
      /toStatComparisonGroups\(/,
      `${sport}'s game adapter no longer builds statComparison from the rollup — the block goes blank again.`,
    );
    assert.doesNotMatch(
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
      /statComparison: null/,
      `${sport}'s game adapter hardcodes statComparison back to null.`,
    );
  }
  for (const sport of ['nba', 'nhl'] as const) {
    const src = readFileSync(`lib/sports/${sport}/adapters/teamDetailAdapter.ts`, 'utf8');
    assert.match(src, /groupStats\(/, `${sport}'s team adapter no longer builds statGroups from the rollup`);
    assert.doesNotMatch(
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
      /statGroups: \[\]/,
      `${sport}'s team adapter emits an empty statGroups again — this is what made its team page the thinnest in the app.`,
    );
  }
});

test('tennis strips the espn prefix before looking an athlete up', () => {
  // `meta.playerN.subjectId` is `espn:tennis:{competitorId}`; the table stores
  // the bare id. Without the strip every lookup misses and the block is blank —
  // silently, since a miss is just `undefined`.
  const src = readFileSync('lib/sports/tennis/adapters/gameDetailAdapter.ts', 'utf8');
  assert.match(src, /replace\(\/\^espn:tennis:\/, ''\)/, 'tennis no longer strips the espn:tennis: prefix before the aggregate lookup');
});

test('both shared components fetch season ranks unconditionally', () => {
  // Rules of hooks, and CLAUDE.md's sport-adapter section 3: every sport's
  // hooks run on every render; the adapter receives their results as data.
  for (const file of ['components/GameDetail.tsx', 'components/TeamDetail.tsx']) {
    const src = readFileSync(file, 'utf8');
    assert.match(src, /useSeasonRanks\(seasonRankSport\(/, `${file} does not call useSeasonRanks`);
    assert.doesNotMatch(
      src,
      /sport === '\w+' \? useSeasonRanks/,
      `${file} calls useSeasonRanks conditionally, which breaks the rules of hooks.`,
    );
  }
});
