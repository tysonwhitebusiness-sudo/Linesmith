/**
 * R6.3 Step 0 — what Understat gives for a player the page asks for BY NAME,
 * and what "Chances & finishing" can therefore be built from.
 *   npx tsx scripts/measure-understat.ts "Erling Haaland" "Matheus Cunha" …
 * Network only (Understat + the snapshot cache); no database writes.
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

async function main() {
  const { buildUnderstatNameIndex, matchUnderstatIndex, currentUnderstatSeason, fetchUnderstatPlayerMatches, fetchUnderstatPlayerShots } = await import('@/lib/sports/soccer/understat');
  const season = currentUnderstatSeason();
  const index = await buildUnderstatNameIndex(season);
  console.log(`season ${season}, index ${index.size} players`);

  const names = process.argv.slice(2).length ? process.argv.slice(2) : ['Erling Haaland', 'Matheus Cunha', 'Mohamed Salah', 'Bruno Fernandes', 'Jordan Pickford'];
  for (const name of names) {
    const hit = matchUnderstatIndex(index, name);
    if (!hit) {
      console.log(`${name.padEnd(20)} NO MATCH`);
      continue;
    }
    const [matches, shots] = await Promise.all([
      fetchUnderstatPlayerMatches(hit.understatId, hit.teamTitle),
      fetchUnderstatPlayerShots(hit.understatId, hit.teamTitle),
    ]);
    const seasons = [...new Set(matches.map((m) => m.season))].sort();
    const shotSeasons = [...new Set(shots.map((s) => String(s.season ?? '')))].filter(Boolean).sort();
    const placed = shots.filter((s) => Number(s.X) > 0 && Number(s.Y) > 0).length;
    console.log(
      `${name.padEnd(20)} -> ${hit.name} (${hit.understatId}, ${hit.teamTitle}) | matches ${matches.length} over ${seasons.join(',')} | shots ${shots.length} (${placed} placed) over ${shotSeasons.join(',')}`,
    );
    const last = matches[matches.length - 1];
    if (last) console.log(`   last match: ${JSON.stringify(last)}`);
    const shot = shots[shots.length - 1];
    if (shot) console.log(`   last shot: ${JSON.stringify(shot)}`);
  }
  process.exit(0);
}
void main();
