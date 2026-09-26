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

/* ------------------------------------------------------------------ Slate */

/**
 * S6 — the same rule over every section of the Slate. The Slate is where the
 * model, the books and the reader's own lines now sit on one page, so it is
 * the easiest place for a difference to creep back in: a "gap" column, a
 * sort by "value", a green cell where the model beats the price.
 */
const SLATE = [
  'components/slate/GameCard.tsx',
  'components/slate/SlateMarket.tsx',
  'components/slate/SlateModel.tsx',
  'components/slate/SlateSections.tsx',
  'components/slate/SlateSpecials.tsx',
  'components/slate/SlateSpotlights.tsx',
  'components/slate/SlateYourLines.tsx',
  'components/ResearchFlags.tsx',
  'lib/slate/flags.ts',
  'lib/slate/flagsRead.ts',
  'lib/slate/marketMoves.ts',
  'lib/slate/modelPicks.ts',
  'lib/slate/specials.ts',
  'lib/slate/spotlights.ts',
  'lib/slate/yourLines.ts',
  'lib/sports/shared/buildSlate.ts',
  'lib/sports/shared/slateShapes.ts',
  'app/api/slate/route.ts',
  'app/api/slate/market/route.ts',
  'app/api/slate/model/route.ts',
  'app/api/slate/specials/route.ts',
  'app/api/slate/flags/route.ts',
  ...['mlb', 'nfl', 'nba', 'nhl', 'soccer', 'tennis', 'golf'].map((s) => `lib/sports/${s}/adapters/slateAdapter.ts`),
];

/** A Tailwind class list, not copy: every token is a lowercase utility. */
function isClassList(s: string): boolean {
  const tokens = s.trim().split(/\s+/);
  return tokens.every((t) => /^[a-z0-9:!\[\]\/().%#_-]+$/.test(t)) && tokens.some((t) => t.includes('-'));
}

/** Only the strings a reader could see: JSX text and string literals. */
function visibleStrings(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  for (const m of code.matchAll(/'([^'\n]{3,})'|"([^"\n]{3,})"|`([^`]{3,})`/g)) out.push(m[1] ?? m[2] ?? m[3]);
  for (const m of code.matchAll(/>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)) out.push(m[1]);
  return out;
}

test('no Slate section subtracts the market from the model', () => {
  const OPERANDS = ['impliedProb', 'implied', 'marketProb', 'modelProb', 'probability', 'winProb', 'homeWinProb', 'awayWinProb'];
  for (const file of SLATE) {
    const code = stripComments(read(file));
    for (const a of OPERANDS) {
      for (const b of OPERANDS) {
        if (a === b || a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase())) continue;
        assert.ok(!new RegExp(`\b${a}\s*-\s*(\w+\.)?${b}\b`).test(code), `${file} computes ${a} - ${b}`);
      }
    }
  }
});

test('no Slate copy names an edge, value or the model tiers', () => {
  // The model vocabulary is internal (M1): baseline, gated, simple, advanced,
  // "not validated" decide what renders and never appear on a customer surface.
  // P11: the MARKET edge (sharp vs soft, Python's `market_edges`) may be named
  // in the allowlisted edge components (MARKET_EDGE_ALLOWLIST, below) — and
  // nowhere else on the Slate.
  const EDGE_WORDS = [/\bedges?\b/i, /\+EV\b/];
  const BANNED = [...EDGE_WORDS, /\bexpected value\b/i, /\bvalue bets?\b/i, /\bbaseline\b/i, /\bgated\b/i, /\bnot validated\b/i, /\bsharp (play|side|money)\b/i, /\block of the day\b/i];
  for (const file of SLATE) {
    const banned = MARKET_EDGE_ALLOWLIST.includes(file) ? BANNED.filter((re) => !EDGE_WORDS.includes(re)) : BANNED;
    for (const s of visibleStrings(read(file))) {
      // Identifiers and class lists are not copy.
      if (!/\s/.test(s) || isClassList(s)) continue;
      for (const re of banned) {
        // "not a model edge" / "not an edge" is the copy SAYING there is none.
        if (/not (a |an )?(model )?edge/i.test(s)) continue;
        assert.doesNotMatch(s, re, `${file}: "${s.slice(0, 80)}"`);
      }
    }
  }
});

test('no Slate section sorts or tints by a model-vs-price difference', () => {
  for (const file of SLATE) {
    // Identifiers only: string literals are copy, and the copy is checked above.
    const code = stripComments(read(file)).replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, "''");
    assert.doesNotMatch(code, /\b(edge|evPct|expectedValue|valueScore|gapToModel|modelGap)\b/, file);
  }
});

/* ------------------------------------------------------------------ P11: the market edge */

/**
 * P11 lifted D6 for ONE thing: the MARKET edge — a soft book's price against a
 * sharp book's no-vig price, no model — computed in Python
 * (`predict/market_edge.py`, `market_edges`) and shown only where every gate
 * passed. It may appear in these files and nowhere else, and only as fields of
 * a payload: none of them may import a de-vig or probability helper, so the
 * edge is never computed on a page. Model-vs-market stays banned everywhere
 * (every test above still runs over every file it names).
 */
const MARKET_EDGE_ALLOWLIST = [
  'components/odds/EdgeCard.tsx',
  'components/odds/ScanEdgeCell.tsx',
  'components/odds/SlateEdges.tsx',
  'components/slate/GameCard.tsx',
];

test('the allowlisted edge files import no de-vig or probability helper', () => {
  const BANNED_MODULES = /(devig|odds_math|\/sharp'|\/hold'|probab|\/board'|priceResolution|section\/slate'|section\/money')/i;
  const BANNED_NAMES = /\b(devig\w*|noVig\w*|impliedProb\w*|toAmerican|americanTo\w*|decimalTo\w*|fairProb\w*|hold\w*|decimal)\b/;
  for (const file of MARKET_EDGE_ALLOWLIST) {
    for (const m of read(file).matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)'/gm)) {
      if (m[1]) continue; // a type-only import brings no code
      assert.doesNotMatch(`${m[3]}'`, BANNED_MODULES, `${file} imports from ${m[3]}`);
      assert.doesNotMatch(m[2], BANNED_NAMES, `${file} imports ${m[2].trim()}`);
    }
  }
});

test('the allowlisted edge files only READ an edge — they never compute one', () => {
  for (const file of MARKET_EDGE_ALLOWLIST) {
    const code = stripComments(read(file));
    // No edge, EV, fair or implied value is bound from arithmetic…
    assert.doesNotMatch(code, /\b(const|let|var)\s+(ev|edge|edgePts|fair|fairPrice|implied|gap)\s*=/, `${file} binds an edge quantity`);
    // …no price becomes a probability (1 / decimal), and no two probabilities are subtracted.
    assert.doesNotMatch(code, /\b1\s*\/\s*\(?\s*(dec|decimal|price|odds)/i, `${file} converts a price to a probability`);
    assert.doesNotMatch(code, /\b(fair|implied)\s*-\s*\w+\.(implied|fair)\b/, `${file} subtracts probabilities`);
  }
});

test("an edge's numbers are read nowhere outside the allowlist", () => {
  // The sections that MOUNT the card pass the payload through; they never read
  // an edge's EV, gap or fair price themselves.
  const MOUNTS = ['components/odds/PlayerOddsSection.tsx', 'components/odds/GameOddsSection.tsx',
    'components/odds/SlateOddsHub.tsx', 'components/slate/SlateMarket.tsx', 'components/slate/SlateSections.tsx',
    'components/ScanTable.tsx', 'components/AppShell.tsx'];
  for (const file of MOUNTS) {
    const code = stripComments(read(file));
    assert.doesNotMatch(code, /\.(ev|edgePts|fairPrice|implied)\b/, `${file} reads an edge's numbers; only the edge components may`);
  }
});

test('Scan cannot be sorted by the market edge', () => {
  const code = stripComments(read('components/ScanTable.tsx'));
  assert.match(code, /key: 'mkt'[^\n]*sortable: false/, "Scan's Edge column must be declared sortable: false");
  assert.ok(!/case 'mkt':/.test(code), 'ScanTable has a sort case for the edge column');
});

test('edges reach a page only while the kill switch and the self-check allow', () => {
  const code = stripComments(read('lib/db/oddsRead.ts'));
  assert.match(code, /edge_display\?\.enabled !== false && f\.edge_auto_off\?\.on !== true/);
  assert.match(code, /if \(!scope\.gameIds\.length \|\| !\(await edgesVisible\(\)\)\) return null;/);
  // A stopped job's edges never stay on a page (the queue runs it every 2-5 min).
  assert.match(code, /AND computed_at > now\(\) - interval '10 minutes'/);
});
