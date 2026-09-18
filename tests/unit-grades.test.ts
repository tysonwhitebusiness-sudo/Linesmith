import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Unit grades are gone, and these guards keep them gone.
 *
 * Phase 6.1 turned NFL's nine hardcoded unit names (`TeamGrades`) into a shared
 * `UnitGrade[]` so every sport could fill it. R7.4 then removed grades from the
 * team page, and R11a deleted the old `GameDetail` page, the last thing that
 * drew them, together with `unitGrades.ts`, `nflUnitGrades.ts` and
 * `nflTeamGrades.ts`. What is left to guard is the WIRING: a shared page must
 * not grow them back, and must not name one sport's units.
 *
 * The second half keeps CLAUDE.md section 4's worked examples honest, because
 * nothing else checks a markdown file against the code it describes.
 */

// ---------------------------------------------------------------------------
// The pages do not bring grades back
// ---------------------------------------------------------------------------

const TEAM_DETAIL_ADAPTERS = ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer'] as const;

/**
 * R7.4 removed unit grades from the team page (the plan's delete list: "Unit
 * grades where Phase F said remove"), together with `TeamDetail.tsx` and every
 * sport's `toTeamDetailData`. R11a deleted the game page that still drew them.
 */
test('the team page does not bring unit grades back', () => {
  for (const sport of TEAM_DETAIL_ADAPTERS) {
    const src = readFileSync(`lib/sports/${sport}/adapters/teamDetailAdapter.ts`, 'utf8');
    assert.doesNotMatch(src, /\n\s*unitGrades:/, `${sport}'s team adapter returns unitGrades again`);
    assert.doesNotMatch(src, /\n\s*grades: (null|grades|TeamGrades)/, `${sport}'s team adapter returns the pre-6.1 grades field`);
  }
  for (const page of ['components/TeamResearchPage.tsx', 'components/GameResearchPage.tsx']) {
    assert.doesNotMatch(readFileSync(page, 'utf8'), /GradeChip|unitGrades/, `${page} renders unit grades again`);
  }
  assert.ok(!existsSync('lib/sports/shared/unitGrades.ts'), 'unitGrades.ts is back — R11a deleted it with the last page that drew grades');
});

test('the shared components hold no fixed list of NFL unit names', () => {
  // `GRADE_ROWS` was a hardcoded nine-entry array typed `keyof TeamGrades`, and
  // `TeamDetail.tsx` hardcoded three `<GradeChip label="OFF"|"DEF"|"ST">`
  // calls. Both are the same bug: a shared component naming one sport's units.
  for (const file of ['components/GameResearchPage.tsx', 'components/TeamResearchPage.tsx', 'components/PlayerDetail.tsx']) {
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
          `any sport's unit names — they arrive as data.`,
      );
    }
  }
});

test("MLB's team page ranks its team Statcast rather than declaring it has no data", () => {
  // Was: MLB graded Hitting and Pitching units from ranked Statcast (6.1). The
  // rebuilt team page (R7.1) shows the same ranked Statcast directly, as
  // league percentiles, in "Contact & pitch quality".
  const src = readFileSync('lib/sports/mlb/adapters/teamDetailAdapter.ts', 'utf8');
  assert.match(src, /function mlbTeamStatcastSection\(/, "MLB's team page lost its Statcast section");
  assert.match(src, /percentiles\[metric\]/, "MLB's Statcast section no longer reads the rollup's percentiles");
});

// ---------------------------------------------------------------------------
// CLAUDE.md section 4's examples — kept honest by the compiler's absence
// ---------------------------------------------------------------------------

/**
 * CLAUDE.md section 4 names concrete fields as its worked examples, and they
 * keep going stale: `statComparison.bars` was collapsed in Phase 6.2,
 * `mlbContextMatchup`/`.nflMatchup` were replaced by `matchupExplorer`, which
 * R10 deleted, and the surviving `GameDetailData.pregameLines.moneyline.draw`
 * went with the old game page in R11a. Assert that every field the section
 * cites exists, and that the removed ones stay out of the rule's example list.
 */
test('CLAUDE.md section 4 only cites fields that still exist', () => {
  const doc = readFileSync('CLAUDE.md', 'utf8');
  const section = doc.slice(doc.indexOf('4. **Genuinely different UI'), doc.indexOf('**Before adding a new field'));
  assert.ok(section.length > 0, 'section 4 not found — was CLAUDE.md restructured?');

  const shapes = readFileSync('lib/sports/shared/playerResearchShapes.ts', 'utf8');
  const playerAdapter = readFileSync('lib/sports/mlb/adapters/playerDetailAdapter.ts', 'utf8');

  // The model example: the scatter card's `surface`, which the adapter sets and
  // the renderer switches on, never the sport.
  assert.match(section, /`surface`/, 'section 4 no longer cites the scatter card surface');
  assert.match(shapes, /surface: 'zone' \| 'field' \| 'pitch' \| 'court' \| 'rink'/, 'section 4 cites the scatter card surface, which no longer exists');
  assert.ok(existsSync('components/charts/SpatialSurface.tsx'), 'section 4 cites SpatialSurface, which no longer exists');

  // Deleted types must not be cited as live examples.
  const ruleParagraph = section.slice(0, section.indexOf('**Two of this rule'));
  for (const gone of [/TeamDetailData/, /GameDetailData/, /statComparison\.bars/, /mlbContextMatchup/]) {
    assert.doesNotMatch(ruleParagraph, gone, `section 4 cites ${gone.source} as a live example, and it was deleted`);
  }
  assert.doesNotMatch(playerAdapter, /\n\s+mlbContextMatchup\??:/, 'PlayerDetailData declares mlbContextMatchup again');
  // R10: compare replaced the universal matchup card, and both were deleted.
  assert.doesNotMatch(playerAdapter, /\n\s+matchupExplorer\??:/, 'PlayerDetailData declares matchupExplorer again — R10 compare replaced it');
  assert.ok(!existsSync('components/MatchupExplorerCard.tsx'), 'MatchupExplorerCard is back — R10 compare replaced it');
  // R11a: the old game page and its type are gone.
  assert.ok(!existsSync('components/GameDetail.tsx'), 'GameDetail.tsx is back — R11a deleted it; the game page is GameResearchPage');
});
