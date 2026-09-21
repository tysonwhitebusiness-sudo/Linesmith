/**
 * Runs S3's spotlights against the real snapshot candidates.
 *
 * Needed because the page itself cannot prove them after the slate finishes:
 * every candidate in a completed game is dropped by the board's own live-state
 * filter, so at 23:00 ET the Spotlights are legitimately empty and an empty
 * render proves nothing either way.
 *
 * Run: npx tsx scripts/probe-spotlights.ts [sport]
 */

import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

import { readSnapshotCache } from '../lib/db/client';
import { buildSpotlights } from '../lib/slate/spotlights';
import type { PickCandidate } from '../lib/core/types';

const SPORT = process.argv[2] ?? 'mlb';
const KEY = SPORT === 'soccer' ? 'soccer:snapshot:epl' : SPORT === 'tennis' ? 'tennis:snapshot:wta' : `${SPORT}:snapshot`;

async function main() {
  const cached = await readSnapshotCache(KEY);
  if (!cached) {
    console.log(`no snapshot at ${KEY}`);
    process.exit(0);
  }
  const snapshot = JSON.parse(cached.payload);
  const candidates = (snapshot?.candidates ?? []) as PickCandidate[];
  console.log(`${KEY}: ${candidates.length} candidates`);

  for (const card of buildSpotlights(candidates, { sport: SPORT })) {
    console.log(`\n=== ${card.title} (${card.scope}) — ${card.rows.length} rows ===`);
    console.log(`columns: ${card.columns.map((c) => c.label).join(' | ')}`);
    for (const r of card.rows.slice(0, 5)) {
      const vals = card.columns.map((c) => `${c.label} ${r.values[c.key]?.text ?? '-'}`).join('  ');
      console.log(`  ${r.subjectName} — ${r.market}\n    ${vals}\n    why: ${r.why}`);
    }
    if (card.rows.length === 0) console.log(`  empty: ${card.empty}`);
  }
  process.exit(0);
}

void main();
