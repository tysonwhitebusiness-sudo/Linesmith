/**
 * Persists this poll's completed hole/round/tournament-result data into the
 * golf_* history tables (see lib/db/schema.ts for the full rationale — golf
 * had zero accumulated history before this; every golf page re-fetched
 * ESPN's current-week feed live and kept nothing). Called once per
 * `getGolfSnapshot()` build in adapter.ts.
 *
 * Forward accumulation only, starting from whenever this first ships — the
 * same position MLB's own prop-price history was in before it had a season
 * of its own data behind it. Idempotent (INSERT OR IGNORE on the natural
 * key), so handing it every completed hole on every poll — not just newly
 * completed ones — is correct and cheap; SQLite silently no-ops the rows
 * already stored.
 *
 * Deliberately fire-and-forget from the caller's side: a DB write failure
 * here must never take down the live snapshot the rest of the app depends
 * on. Errors are logged, not thrown.
 */

import type { EspnGolfEvent } from './espn';
import type { WeatherContext } from '../../core/types';
import { logSystemEvent } from '../../db/client';
import {
  writeGolfTournament,
  writeGolfHoleScores,
  writeGolfRoundScores,
  writeGolfTournamentResults,
  type GolfHoleScoreInput,
  type GolfRoundScoreInput,
  type GolfTournamentResultInput,
} from '../../db/client';

type GolfCategory = 'birdie' | 'par' | 'bogey';

/** Same parse adapter.ts's `parseRelativeToPar` does — duplicated locally rather than imported to avoid a circular import (adapter.ts calls into this file), matching this codebase's existing convention of duplicating small pure helpers per file. */
function parseRelative(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-') return null;
  if (trimmed.toUpperCase() === 'E') return 0;
  const parsed = Number(trimmed.replace('+', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function categoryFor(relativeToPar: number): GolfCategory {
  if (relativeToPar < 0) return 'birdie';
  if (relativeToPar === 0) return 'par';
  return 'bogey';
}

/** ESPN's leaderboard convention: a cut/withdrawn/disqualified golfer's position displayName becomes the status word itself instead of a rank. A disclosed heuristic, not a dedicated status field — this feed doesn't expose one (see readPosition in adapter.ts, which doesn't track cut status either). */
function madeCutFrom(positionDisplayName: string | undefined): boolean {
  if (!positionDisplayName) return true;
  return !/^(cut|wd|dq)$/i.test(positionDisplayName.trim());
}

export async function ingestGolfHistory(event: EspnGolfEvent, weather: WeatherContext | undefined, now: Date): Promise<void> {
  try {
    const course = event.course;

    await writeGolfTournament({
      eventId: event.id,
      name: event.name,
      courseName: course?.name ?? null,
      season: now.getFullYear(),
      // ESPN's leaderboard/scoreboard objects merged here (see espn.ts's file
      // header) never carry the event's own start date, only per-round tee
      // times — left null rather than guessed from today's date.
      startDate: null,
      holesJson: course ? JSON.stringify(course.holes) : null,
      fieldSize: event.golfers.length,
    });

    const holeRows: GolfHoleScoreInput[] = [];
    const roundRows: GolfRoundScoreInput[] = [];
    const resultRows: GolfTournamentResultInput[] = [];

    for (const golfer of event.golfers) {
      for (const round of golfer.rounds) {
        // ESPN sends total:0 (not null) for a round that hasn't started yet —
        // same guard adapter.ts's roundScoreCandidate uses.
        const roundStarted = round.total != null && round.total > 0 && round.holes.length > 0;
        if (!roundStarted) continue;

        let holesScored = 0;
        for (const h of round.holes) {
          const relative = parseRelative(h.relativeToPar);
          if (relative === null || h.strokes == null) continue;
          const par = course?.holes.find((ch) => ch.number === h.hole)?.shotsToPar ?? null;
          holeRows.push({
            eventId: event.id,
            espnId: golfer.id,
            round: round.period,
            hole: h.hole,
            par,
            strokes: h.strokes,
            relativeToPar: relative,
            category: categoryFor(relative),
          });
          holesScored += 1;
        }

        // Only a fully-played round gets a round_scores row — storing a
        // still-live round's partial total now would understate its actual
        // relative-to-par, and it's re-ingested (idempotently skipped) once
        // finished anyway on a later poll.
        if (holesScored === 18 && round.total != null) {
          const par = course?.shotsToPar ?? null;
          roundRows.push({
            eventId: event.id,
            espnId: golfer.id,
            round: round.period,
            totalStrokes: round.total,
            relativeToPar: par != null ? round.total - par : holesScored,
            // True AM/PM wave needs the course's own local timezone, which
            // this app doesn't have a source for yet (venues.ts stores
            // coordinates, not a UTC offset) — left unset rather than
            // bucketing a UTC hour and silently mislabeling half the field.
            teeWave: null,
            windMph: weather?.windMph ?? null,
            tempF: weather?.tempF ?? null,
            precipProb: weather?.rainPct ?? null,
          });
        }
      }
    }

    // Results are only meaningful once the whole tournament (not just one
    // golfer's week) is over — gating per-golfer on a "did THIS golfer
    // finish" heuristic risks false positives on a mid-round leaderboard
    // glitch; `event.completed` is the one field ESPN commits to for this.
    if (event.completed) {
      for (const golfer of event.golfers) {
        const positionDisplay = golfer.status?.position?.displayName;
        resultRows.push({
          eventId: event.id,
          espnId: golfer.id,
          position: positionDisplay ?? null,
          madeCut: madeCutFrom(positionDisplay),
          totalScore: golfer.rounds.reduce((sum, r) => (r.total != null && r.total > 0 ? sum + r.total : sum), 0) || null,
        });
      }
    }

    await writeGolfHoleScores(holeRows);
    await writeGolfRoundScores(roundRows);
    if (resultRows.length > 0) await writeGolfTournamentResults(resultRows);
  } catch (err) {
    // Never let a history-write failure break the live snapshot this runs
    // alongside — same non-fatal contract as every other best-effort side
    // path in this app (see logSystemEvent's own call sites). Everything
    // above is now properly awaited specifically so this catch can actually
    // catch a failed write — an unawaited rejection inside a sync function
    // would have skipped straight past this block as an unhandled rejection.
    await logSystemEvent({
      level: 'error',
      source: 'golf/historyIngest',
      message: 'Failed to persist golf history for this poll',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
