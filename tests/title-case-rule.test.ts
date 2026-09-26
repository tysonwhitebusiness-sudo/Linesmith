import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceStart, titleCase } from '../lib/text/titleCase';

/**
 * T0 of docs/design/title-case-plan.md — the rule itself. Every example the
 * plan (and the operator's ask, 2026-09-26) names is pinned here, with the
 * cases that would go wrong with a naive capitaliser.
 */

const cases: Array<[string, string]> = [
  // the operator's examples
  ['Hit rate', 'Hit Rate'],
  ['Total bases', 'Total Bases'],
  ['Last 10', 'Last 10'],
  ['Batter strikeouts', 'Batter Strikeouts'],
  ['Pitcher hits allowed', 'Pitcher Hits Allowed'],
  ['HR-friendly parks today', 'HR-Friendly Parks Today'],
  ['Where the money is', 'Where the Money Is'],
  ['Best price', 'Best Price'],
  ['No edge', 'No Edge'],
  ['Pitcher to hit a home run', 'Pitcher to Hit a Home Run'],
  ['HOU vs ATH', 'HOU vs ATH'],
  // small words: lowercase inside, capital at either end
  ['Head to head', 'Head to Head'],
  ['the game now', 'The Game Now'],
  ['What it is for', 'What It Is For'],
  ['Hitters vs the starter', 'Hitters vs the Starter'],
  ['Rest and travel', 'Rest and Travel'],
  // abbreviations and mixed case are never touched
  ['HR/PA', 'HR/PA'],
  ['K/9', 'K/9'],
  ['aDOT by route', 'aDOT by Route'],
  ['xwOBA allowed', 'xwOBA Allowed'],
  ['Staff HR%', 'Staff HR%'],
  ['+EV plays', '+EV Plays'],
  ['L10 hit rate', 'L10 Hit Rate'],
  ['3-point attempts', '3-Point Attempts'],
  ['Hits + runs + RBIs', 'Hits + Runs + RBIs'],
  ['Anytime TD', 'Anytime TD'],
  ['First TD scorer', 'First TD Scorer'],
  // "vs", "v" and units stay lowercase, even first
  ['vs LHP', 'vs LHP'],
  ['vs the league', 'vs the League'],
  ['Selekhmeteva v Grabher', 'Selekhmeteva v Grabher'],
  ['Hardest hit, mph', 'Hardest Hit, mph'],
  ['Distance ft', 'Distance ft'],
  // hyphens and apostrophes
  ['Pick-3 anytime TD', 'Pick-3 Anytime TD'],
  ['two-way players', 'Two-Way Players'],
  ["The day's longest home run", "The Day's Longest Home Run"],
  // separators start a new run
  ['Matchup · at the start', 'Matchup · At the Start'],
  ['Odds: at a glance', 'Odds: At a Glance'],
  ['Total: opening → close', 'Total: Opening → Close'],
  // names already capitalised stay as they are
  ['Eugenio Suárez vs José Soriano', 'Eugenio Suárez vs José Soriano'],
  ['CIN coming in', 'CIN Coming In'],
  // idempotent
  ['Where the Money Is', 'Where the Money Is'],
  ['', ''],
];

test('titleCase: the plan’s rule, case by case', () => {
  for (const [input, want] of cases) assert.equal(titleCase(input), want, JSON.stringify(input));
});

test('titleCase is idempotent', () => {
  for (const [input] of cases) assert.equal(titleCase(titleCase(input)), titleCase(input), JSON.stringify(input));
});

test('titleCase keeps whitespace and wrapping punctuation', () => {
  assert.equal(titleCase('  shot map  '), '  Shot Map  ');
  assert.equal(titleCase('(last 5 games)'), '(Last 5 Games)');
});

test('sentenceStart capitalises only the first letter', () => {
  assert.equal(sentenceStart('win probability after every plate appearance'), 'Win probability after every plate appearance');
  assert.equal(sentenceStart('every ball in play, with exit velocity and distance'), 'Every ball in play, with exit velocity and distance');
  assert.equal(sentenceStart('Already capitalised'), 'Already capitalised');
  assert.equal(sentenceStart('aDOT leaders'), 'aDOT leaders');
  assert.equal(sentenceStart('xwOBA allowed'), 'xwOBA allowed');
});
