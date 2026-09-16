/**
 * One NFL player's located passes — the read behind "Usage & depth" and
 * "Where he throws" (R6.2). The pure half is `targetShapes.ts`; this file
 * value-imports `pgAll` and is server-only.
 *
 * KEYED BY THE PAGE'S OWN SUBJECT, NOT BY A CANDIDATE. `nfl_target_events`
 * names players by nflverse GSIS id while every page and route in this app
 * carries an ESPN athlete id, so the crosswalk runs here (`getEspnToGsisMap`,
 * already cached 24h). Phase 6.8's route took the GSIS id from
 * `subjectMeta.gsisId`, which only a player with a market today has — the
 * player is the page now (R6.1a), so the resolution cannot depend on one.
 *
 * A receiver's rows are the passes thrown TO him (`receiver_id`); a
 * quarterback's are the ones he threw (`passer_id`). Same table, same columns,
 * one flag apart — see `targetShapes.ts` for why a quarterback must never be
 * shown his `receiver_id` rows.
 */

import { pgAll } from '@/lib/db/pgClient';
import { getEspnToGsisMap } from './nflverse';
import type { NflTarget, NflTargetsPayload } from './targetShapes';

/** Seasons back from the newest held, so a page never asks for a decade of rows. */
const SEASONS_HELD = 3;

export async function getNflTargets(athleteId: string, role: 'receiver' | 'passer'): Promise<NflTargetsPayload | null> {
  const gsisId = (await getEspnToGsisMap()).get(athleteId);
  if (!gsisId) return null;

  const column = role === 'receiver' ? 'receiver_id' : 'passer_id';
  const rows = await pgAll<{
    season: number;
    week: number;
    air_yards: number | null;
    pass_location: string | null;
    pass_length: string | null;
    yards_after_catch: number | null;
    complete_pass: boolean | null;
    touchdown: boolean | null;
    fetched_at: string | Date | null;
  }>(
    `SELECT season, week, air_yards, pass_location, pass_length, yards_after_catch, complete_pass, touchdown, fetched_at
       FROM nfl_target_events
      WHERE ${column} = ?
        AND season >= (SELECT COALESCE(max(season), 0) - ${SEASONS_HELD - 1} FROM nfl_target_events)
      ORDER BY season, week, play_id`,
    [gsisId],
  );
  if (rows.length === 0) return { gsisId, role, seasons: [], targets: [], asOf: null };

  const targets: NflTarget[] = rows.map((r) => [
    Number(r.season),
    Number(r.week),
    r.air_yards == null ? null : Number(r.air_yards),
    r.pass_location,
    r.pass_length,
    r.yards_after_catch == null ? null : Number(r.yards_after_catch),
    r.complete_pass === true,
    r.touchdown === true,
  ]);
  const asOf = rows.reduce<string | null>((m, r) => {
    if (!r.fetched_at) return m;
    const iso = new Date(r.fetched_at).toISOString();
    return m == null || iso > m ? iso : m;
  }, null);
  return { gsisId, role, seasons: [...new Set(targets.map((t) => t[0]))].sort((a, b) => a - b), targets, asOf };
}
