/**
 * One golfer's record for the player page (R6.6): the recent rounds and holes
 * by ESPN id, and the 2020-2022 shot seed by name, summarised here so a
 * golfer's ~4,000 shot rows never cross the wire.
 *
 * The pure half (types, the summary, the sections) is
 * `playerResearchShapes.ts`; this file value-imports `pgAll` and is server-only
 * (`tests/client-bundle-boundary.test.ts`).
 *
 * TWO ID SPACES, and the split is the data's, not a choice: the round and hole
 * tables key on ESPN's athlete id — the page's own — while `golf_shot_events`
 * keys on PGA TOUR's id with no crosswalk, so the shots are found by name. Both
 * are five-digit numbers, which is why an id lookup on the shots compiles, runs
 * and returns nothing (measured in 6.13: 0 of 30 slate golfers by id, 21 by
 * name). The golfers who miss by name reached the Tour after the seed ends.
 */

import { pgAll } from '@/lib/db/pgClient';
import { summariseGolfShots, type GolfResearchPayload } from './playerResearchShapes';

const num = (v: string | number | null) => (v == null ? null : Number(v));

export async function getGolfPlayerResearch(espnId: string, name: string | null): Promise<GolfResearchPayload> {
  const [rounds, holes, shots] = await Promise.all([
    pgAll<{
      event_id: string;
      name: string | null;
      season: number | null;
      round: number;
      total_strokes: number;
      relative_to_par: number;
      wind_mph: string | null;
      temp_f: string | null;
      ingested_at: string | null;
    }>(
      `SELECT r.event_id::text AS event_id, t.name, t.season, r.round, r.total_strokes, r.relative_to_par, r.wind_mph, r.temp_f,
              r.ingested_at::text AS ingested_at
         FROM golf_round_scores r
         LEFT JOIN golf_tournaments t ON t.event_id = r.event_id
        WHERE r.espn_id::text = ?
        ORDER BY r.event_id, r.round`,
      [espnId],
    ),
    pgAll<{ event_id: string; round: number; hole: number; par: number; strokes: number; relative_to_par: number }>(
      `SELECT event_id::text AS event_id, round, hole, par, strokes, relative_to_par
         FROM golf_hole_scores WHERE espn_id::text = ? ORDER BY event_id, round, hole`,
      [espnId],
    ),
    name
      ? pgAll<{
          season: number;
          tournament_id: string;
          round_number: number;
          hole_number: number;
          shot_number: number;
          distance_yds: string | null;
          left_yds: string | null;
          from_lie: string | null;
          is_putt: boolean;
        }>(
          `SELECT season, tournament_id, round_number, hole_number, shot_number, distance_yds, left_yds, from_lie, is_putt
             FROM golf_shot_events WHERE lower(player_name) = lower(?)`,
          [name],
        )
      : Promise.resolve([]),
  ]);

  const events = new Map<string, { eventId: string; name: string; season: number | null }>();
  for (const r of rounds) {
    events.set(r.event_id, { eventId: r.event_id, name: r.name ?? `Event ${r.event_id}`, season: r.season == null ? null : Number(r.season) });
  }

  return {
    espnId,
    name,
    events: [...events.values()],
    rounds: rounds.map((r) => ({
      eventId: r.event_id,
      round: Number(r.round),
      strokes: Number(r.total_strokes),
      toPar: Number(r.relative_to_par),
      windMph: num(r.wind_mph),
      tempF: num(r.temp_f),
    })),
    holes: holes.map((h) => ({
      eventId: h.event_id,
      round: Number(h.round),
      hole: Number(h.hole),
      par: Number(h.par),
      strokes: Number(h.strokes),
      toPar: Number(h.relative_to_par),
    })),
    shots: summariseGolfShots(
      shots.map((s) => ({
        season: Number(s.season),
        tournamentId: String(s.tournament_id),
        round: Number(s.round_number),
        hole: Number(s.hole_number),
        shot: Number(s.shot_number),
        distanceYds: num(s.distance_yds),
        leftYds: num(s.left_yds),
        fromLie: s.from_lie,
        isPutt: Boolean(s.is_putt),
      })),
    ),
    asOf: rounds.reduce<string | null>((a, r) => (r.ingested_at && (!a || r.ingested_at > a) ? r.ingested_at : a), null),
  };
}
