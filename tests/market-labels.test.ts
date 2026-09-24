// P1 (odds workstream, 2026-09-24): one market-label registry. Raw keys
// (`longest-rush`, `kicking-points`) reached the game page because each
// sport's adapter kept its own map and fell back to the key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANONICAL_MARKET_KEYS } from '../lib/odds/props/entityResolution';
import { MARKET_LABELS, marketLabel, marketLabelTitle } from '../lib/odds/props/marketLabels';

test('every canonical market key has a label, and the label is not the key', () => {
  assert.equal(CANONICAL_MARKET_KEYS.size, 72);
  for (const key of CANONICAL_MARKET_KEYS) {
    assert.ok(MARKET_LABELS[key], `no registry label for ${key}`);
    for (const sport of ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'tennis', 'golf'] as const) {
      const l = marketLabel(key, sport);
      assert.notEqual(l, key, `${sport} ${key} rendered as its raw key`);
      assert.ok(!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(l), `${sport} ${key} rendered as a slug: ${l}`);
    }
  }
  assert.deepEqual(Object.keys(MARKET_LABELS).sort(), [...CANONICAL_MARKET_KEYS].sort(), 'the table is exactly the canonical set');
});

test('the fills the game page was missing', () => {
  assert.equal(marketLabel('longest-rush', 'nfl'), 'Longest rush');
  assert.equal(marketLabel('kicking-points', 'cfb'), 'Kicking points');
  assert.equal(marketLabel('interceptions-thrown', 'nfl'), 'Interceptions thrown');
});

test('sport overrides keep each sport\'s current wording', () => {
  assert.equal(marketLabel('assists', 'nfl'), 'Tackle assists');
  assert.equal(marketLabel('assists', 'cfb'), 'Tackle assists');
  assert.equal(marketLabel('assists', 'nba'), 'Assists');
  assert.equal(marketLabel('assists', 'nhl'), 'Assists');
  assert.equal(marketLabel('pitcher-strikeouts', 'mlb'), 'Strikeouts (pitcher)');
  assert.equal(marketLabel('points-rebounds-assists', 'nba'), 'Pts + reb + ast');
  assert.equal(marketLabel('anytime-goalscorer', 'nhl'), 'Anytime scorer');
  assert.equal(marketLabel('first-goalscorer', 'soccer'), 'First scorer');
});

test('the four legacy keys map', () => {
  assert.equal(marketLabel('completions'), 'Completions');
  assert.equal(marketLabel('passing-attempts'), 'Pass attempts');
  assert.equal(marketLabel('interceptions'), 'Interceptions thrown');
  assert.equal(marketLabel('pass-rush-yards'), 'Pass + rush yards');
});

test('an unknown new key reads as words, never as a slug', () => {
  assert.equal(marketLabel('first-inning-runs'), 'First inning runs');
});

test('candidate labels (Title Case) are unchanged from the NFL/CFB maps they replaced', () => {
  const before: Record<string, string> = {
    'passing-yards': 'Passing Yards', 'passing-tds': 'Passing TDs', 'rushing-yards': 'Rushing Yards', 'rushing-tds': 'Rushing TDs',
    'receiving-yards': 'Receiving Yards', receptions: 'Receptions', 'receiving-tds': 'Receiving TDs', 'interceptions-thrown': 'Interceptions Thrown',
    'longest-rush': 'Longest Rush', 'longest-reception': 'Longest Reception', 'longest-completion': 'Longest Completion', 'kicking-points': 'Kicking Points',
  };
  for (const [k, v] of Object.entries(before)) {
    assert.equal(marketLabelTitle(k, 'nfl'), v);
    assert.equal(marketLabelTitle(k, 'cfb'), v);
  }
});

test('guard: no label lookup falls back to the raw market key', () => {
  const files: string[] = ['lib/sports/nfl/adapter.ts', 'lib/sports/cfb/adapter.ts'];
  for (const sport of readdirSync('lib/sports')) {
    let names: string[] = [];
    try { names = readdirSync(join('lib/sports', sport, 'adapters')); } catch { continue; }
    for (const n of names) if (/GameResearch\.ts$/.test(n)) files.push(join('lib/sports', sport, 'adapters', n));
  }
  assert.ok(files.length >= 8, `expected the game-research adapters, found ${files.length}`);
  const bad = /(LABELS?\w*\[[^\]]+\]|[Ll]abel\w*\([^)]*\))\s*\?\?\s*(p\.market|marketKey|key)\b/;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => assert.ok(!bad.test(line), `${f}:${i + 1} falls back to a raw key: ${line.trim()}`));
  }
});
