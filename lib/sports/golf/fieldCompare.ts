/**
 * A golfer against the field, event by event — R10.4e, G2's golf compare
 * (`docs/design/phase-g2/src/sports/compare.js`, `golfCompare`).
 *
 * GOLF HAS NO OPPONENT, so every other sport's compare control does not apply:
 * no team to pick, no position group to rank, no peer rollup. What a golf reader
 * compares is a round against the people who played the same course the same
 * day. So for each event he played:
 *
 *   the FIELD is everyone who played every round the event has held — a player
 *   who missed the cut or withdrew played fewer rounds, and averaging round 3
 *   over a different set of players than round 1 would make the field look
 *   better as the weak half left (G2's rule: complete every round);
 *   each round's number is to par, his against the field's mean;
 *   the leaderboard is that field by total to par, him marked.
 *
 * NAMES come from ESPN's leaderboard for the event — one call per event, not per
 * golfer, because the round table holds ids only. An event is over, so the
 * names are memoised for the process; a name ESPN does not give is shown as the
 * id rather than dropping the row, because a leaderboard with a gap in it is
 * worse than one with an unfamiliar label.
 *
 * Server-only: reads Postgres and ESPN.
 */

import { pgAll } from '@/lib/db/pgClient';
import type { GolfFieldEvent } from './playerResearchShapes';

const LEADERBOARD = 'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event=';
const nameMemo = new Map<string, Map<string, string>>();

async function eventNames(eventId: string): Promise<Map<string, string>> {
  const hit = nameMemo.get(eventId);
  if (hit) return hit;
  const names = new Map<string, string>();
  try {
    const res = await fetch(`${LEADERBOARD}${encodeURIComponent(eventId)}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const j = (await res.json()) as { events?: Array<{ competitions?: Array<{ competitors?: Array<{ id?: string; athlete?: { displayName?: string } }> }> }> };
      for (const c of j.events?.[0]?.competitions?.[0]?.competitors ?? []) {
        if (c.id && c.athlete?.displayName) names.set(String(c.id), c.athlete.displayName);
      }
    }
  } catch {
    // Names are a label, not the comparison: the rows stay, keyed by id.
  }
  // Only a successful read is kept, so a transient failure is retried next time.
  if (names.size) nameMemo.set(eventId, names);
  return names;
}

const LEADERS_SHOWN = 8;

export async function readGolfField(espnId: string): Promise<GolfFieldEvent[]> {
  const rows = await pgAll<{ event_id: string; espn_id: string; round: number; to_par: number; name: string | null; course: string | null; start_date: string | null }>(
    `SELECT r.event_id::text AS event_id, r.espn_id::text AS espn_id, r.round, r.relative_to_par::float AS to_par,
            t.name, t.course_name AS course, t.start_date::text AS start_date
       FROM golf_round_scores r
       LEFT JOIN golf_tournaments t ON t.event_id = r.event_id
      WHERE r.event_id IN (SELECT event_id FROM golf_round_scores WHERE espn_id::text = ?)`,
    [espnId],
  );
  if (!rows.length) return [];

  const byEvent = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byEvent.get(r.event_id) ?? [];
    list.push(r);
    byEvent.set(r.event_id, list);
  }

  const events = await Promise.all(
    [...byEvent.entries()].map(async ([eventId, list]) => {
      const roundsHeld = Math.max(...list.map((r) => Number(r.round)));
      const byPlayer = new Map<string, Map<number, number>>();
      for (const r of list) {
        const m = byPlayer.get(r.espn_id) ?? new Map<number, number>();
        m.set(Number(r.round), Number(r.to_par));
        byPlayer.set(r.espn_id, m);
      }
      // Everyone who played every round held; see the header for why.
      const field = [...byPlayer.entries()].filter(([, m]) => m.size === roundsHeld);
      const standings = field.map(([id, m]) => ({ id, total: [...m.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => a.total - b.total);
      const mine = byPlayer.get(espnId) ?? new Map<number, number>();
      const rounds = Array.from({ length: roundsHeld }, (_, i) => i + 1).map((round) => {
        const vals = field.map(([, m]) => m.get(round)).filter((v): v is number => v != null);
        return { round, me: mine.get(round) ?? null, field: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
      });
      // Ties share the better place, as a leaderboard prints them.
      const myTotal = standings.find((x) => x.id === espnId)?.total;
      const position = myTotal == null ? null : standings.filter((x) => x.total < myTotal).length + 1;
      // Refereed against G2's dataset: G2 numbered tied golfers by sort order
      // (BMW 2025: 13th), a leaderboard gives them the same place (T12).
      const tied = myTotal != null && standings.filter((x) => x.total === myTotal).length > 1;
      const names = await eventNames(eventId);
      const top = standings.slice(0, LEADERS_SHOWN);
      const meRow = standings.find((x) => x.id === espnId);
      // He is always on the board: added below the top eight when outside it.
      const shown = meRow && !top.includes(meRow) ? [...top, meRow] : top;
      const first = list[0];
      return {
        eventId,
        name: first.name ?? `Event ${eventId}`,
        course: first.course,
        roundsHeld,
        fieldSize: field.length,
        position,
        tied,
        rounds,
        leaders: shown.map((x) => ({ espnId: x.id, name: names.get(x.id) ?? `ESPN ${x.id}`, toPar: x.total, me: x.id === espnId })),
        startDate: first.start_date,
      };
    }),
  );
  // Newest event first, then drop the sort key from the payload.
  return events
    .sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')))
    .map(({ startDate: _startDate, ...e }) => e);
}
