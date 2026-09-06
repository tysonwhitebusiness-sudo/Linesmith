/**
 * Phase 2 — the guard Phase 1 handed forward, aimed at the surface that now
 * carries both numbers.
 *
 * `tests/stats-board-no-edge.test.ts` used to assert that no edge or profit
 * language reached the stats board's rendered copy. Phase 1.3 deleted that
 * component, and the assertion was deliberately NOT re-pointed at Scan on the
 * day, because Phase 2 had not been built yet and the operator had just decided
 * (2026-09-06) that Scan may show a model probability beside an implied one.
 * This file is the replacement that decision obliged.
 *
 * THE DECISION, AND THE CONSTRAINT IT CREATED. Both columns ship. The concern
 * that prompted the question did not go away: anyone can subtract IP from
 * Model % and read an edge, and no model in this project has beaten a closing
 * line. So the rule is not "hide a number" — it is that the PAGE must never do
 * that subtraction on the reader's behalf. Two independent numbers, presented
 * identically, with nothing computing, naming, sorting by, or colouring their
 * difference.
 *
 * That is a real distinction rather than a verbal one. Showing two facts is
 * reporting. Showing their difference, or ordering the board by it, is a claim
 * that our number is better than the market's — which is exactly the claim
 * measurement has repeatedly refused (tennis t=+20.68, soccer t=+3.05, NHL
 * props t=+3.03).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** The files that make up Scan's ranked board. */
const SURFACE = [
  'components/ScanTable.tsx',
  'components/useProjections.ts',
  'lib/sports/propRanking.ts',
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('nothing on the ranked surface subtracts the market from the model', () => {
  // The specific arithmetic that would turn two reported numbers into a claim.
  // Written as patterns over identifier pairs rather than as a word ban,
  // because the doc comments in these files necessarily DISCUSS the edge in
  // order to explain why it is absent.
  const OPERANDS = ['impliedRaw', 'marketProb', 'probability', 'ownModelProb', 'modelProb'];
  for (const file of SURFACE) {
    const code = stripComments(read(file));
    for (const a of OPERANDS) {
      for (const b of OPERANDS) {
        if (a === b) continue;
        const subtraction = new RegExp(`${a}\\s*[-]\\s*(row\\.|r\\.)?${b}\\b`);
        assert.ok(
          !subtraction.test(code),
          `${file} computes \`${a} - ${b}\` — that difference is an edge, and the ` +
            `operator's 2026-09-06 decision was that both numbers may be SHOWN, ` +
            `not that the page may do the subtraction for the reader.`,
        );
      }
    }
  }
});

test('no edge identifier is reintroduced on the ranked surface', () => {
  const FORBIDDEN = ['EdgeBadge', 'propScore', 'scoreGrade', 'expectedValue', 'edgeSource'];
  for (const file of SURFACE) {
    const code = stripComments(read(file));
    for (const token of FORBIDDEN) {
      assert.ok(
        !code.includes(token),
        `${file} references \`${token}\` — a claim against someone else's price, on a ` +
          `board that has not passed a betting board's gate.`,
      );
    }
  }
});

test('the ranking module never reads a price', () => {
  // The metric is model-versus-league. The moment it can see a price it can be
  // quietly changed into model-versus-market, which is the failure this whole
  // phase is ordered around.
  const code = stripComments(read('lib/sports/propRanking.ts'));
  for (const token of ['price', 'american', 'bookmaker', 'implied', 'devig', 'vig']) {
    assert.ok(
      !code.toLowerCase().includes(token),
      `propRanking.ts mentions "${token}" in code — the ranking ranks a model against a ` +
        `league baseline and must not be able to see a market price at all.`,
    );
  }
});

test('the board cannot be sorted by anything derived from a price and the model together', () => {
  // Sorting is a claim too: a column the reader can order the whole board by is
  // the board's opinion about what matters.
  const code = stripComments(read('components/ScanTable.tsx'));
  const sortKeys = [...code.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1]);
  for (const banned of ['edge', 'value', 'ev']) {
    assert.ok(
      !sortKeys.includes(banned),
      `ScanTable can sort by '${banned}' — ordering the board by a model-versus-price ` +
        `quantity is the claim, not the display.`,
    );
  }
});

test('Model % and IP are presented identically, so neither reads as the recommended one', () => {
  // Asymmetry is an argument. If one of the two carries colour, weight or a
  // direction arrow that the other does not, the page has taken a side on
  // which number is right without saying so.
  const code = read('components/ScanTable.tsx');
  const ipCell = /Implied by the recorded price[\s\S]{0,400}?<\/td>/.exec(code)?.[0] ?? '';
  const modelCell = /Our model's probability of going over[\s\S]{0,400}?<\/td>/.exec(code)?.[0] ?? '';
  assert.ok(ipCell.length > 0, 'the IP cell should still be present');
  assert.ok(modelCell.length > 0, 'the Model % cell should still be present');

  const classesOf = (s: string) => (s.match(/className="([^"]*)"/g) ?? []).join(' ');
  for (const tone of ['text-good', 'text-bad', 'text-warn', 'font-bold', 'font-semibold']) {
    assert.equal(
      classesOf(modelCell).includes(tone),
      classesOf(ipCell).includes(tone),
      `Model % and IP differ on "${tone}" — presenting one more loudly than the other is a ` +
        `recommendation about which to believe.`,
    );
  }
});
