/**
 * One soccer player's Understat shots and matches — the read behind "Chances &
 * finishing" (R6.3). The pure half is `playerUnderstatShapes.ts`; this file
 * value-imports the fetchers and is server-only.
 *
 * KEYED BY NAME, BECAUSE UNDERSTAT PUBLISHES NO ID THIS APP CAN JOIN ON. The
 * snapshot build already resolves a candidate's name against the season index
 * (`matchUnderstatIndex`, a 0.85 similarity floor); the page has no candidate
 * to borrow from, so it resolves the same way from the player's own bio name.
 * Measured 2026-09-15: Haaland, Cunha, Salah, Fernandes and Pickford all
 * resolve, out of a 654-player index.
 *
 * THE FETCHES ARE ALREADY CACHED. `fetchUnderstatPlayerMatches` and
 * `fetchUnderstatPlayerShots` read the same `/getPlayerData/{id}` payload from
 * `snapshot_cache`, so a page load costs the index lookup and, at worst, one
 * player fetch.
 */

import {
  buildUnderstatNameIndex,
  currentUnderstatSeason,
  fetchUnderstatPlayerMatches,
  fetchUnderstatPlayerShots,
  matchUnderstatIndex,
} from './understat';
import type { SoccerUnderstatPayload, UnderstatMatchRow, UnderstatShotRow } from './playerUnderstatShapes';

/** Seasons kept, newest back — a career of shots is more than a page draws. */
const SEASONS_HELD = 5;

export async function getSoccerUnderstat(name: string): Promise<SoccerUnderstatPayload | null> {
  const season = currentUnderstatSeason();
  const index = await buildUnderstatNameIndex(season);
  const hit = matchUnderstatIndex(index, name);
  if (!hit) return null;

  const [matches, shots] = await Promise.all([
    fetchUnderstatPlayerMatches(hit.understatId, hit.teamTitle),
    fetchUnderstatPlayerShots(hit.understatId, hit.teamTitle),
  ]);

  const seasonOf = (v: string | number | undefined) => Number(v);
  const newest = Math.max(...matches.map((m) => seasonOf(m.season)).filter(Number.isFinite), Number(season));
  const floor = newest - (SEASONS_HELD - 1);

  const shotRows: UnderstatShotRow[] = shots
    .filter((s) => seasonOf(s.season) >= floor && Number(s.X) >= 0.5)
    .map((s) => [
      seasonOf(s.season),
      Number((s as { minute?: string | number }).minute ?? 0),
      Number(s.X),
      Number(s.Y),
      Number(s.xG),
      String(s.result ?? ''),
      String((s as { situation?: string }).situation ?? 'OpenPlay'),
      String(s.shotType ?? 'Unknown'),
    ]);

  const matchRows: UnderstatMatchRow[] = matches
    .filter((m) => seasonOf(m.season) >= floor)
    .map((m) => ({
      date: m.date,
      season: seasonOf(m.season),
      opponent: m.opponent,
      isHome: m.isHome,
      minutes: m.minutes,
      goals: m.goals,
      shots: m.shots,
      xG: m.xG,
      assists: m.assists,
      xA: m.xA,
      keyPasses: m.keyPasses,
    }));

  return {
    understatId: hit.understatId,
    name: hit.name,
    teamTitle: hit.teamTitle,
    seasons: [...new Set(shotRows.map((s) => s[0]))].sort((a, b) => a - b),
    shots: shotRows,
    matches: matchRows,
    // Understat has no publish stamp; the page's own fetch is the as-of.
    asOf: new Date().toISOString(),
  };
}
