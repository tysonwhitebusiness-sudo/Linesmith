/**
 * GET /api/nfl/projections — what Scan's NFL model column reads.
 *
 * CACHING: pattern 2 from CLAUDE.md. `prop_model_cache` is a real table kept
 * fresh out-of-band by `nflProjectionsJob` (python-odds-service JOB_REGISTRY,
 * hourly). This handler does a direct read and nothing else — no external
 * fetch, no computation, no per-request refresh trigger. There is no work for
 * `cachedRoute()` to stale-serve or dedup, which is the condition pattern 2
 * exists for.
 *
 * A GET HANDLER MUST NOT WRITE, and this one does not. Worth restating because
 * the audit found `/api/odds/lines` writing to the model's own track record on
 * an unauthenticated GET; this pipe's single writer is the Python job.
 *
 * NO PROBABILITY IS SERVED HERE, AND NONE MAY BE UNTIL PHASE 4.5. Every NFL
 * calibration is persisted `probability_ok = false`, so the serving pipe writes
 * `model_prob`, `line` and `league_baseline` NULL on every row and asserts it.
 * NFL's whole prop archive is one season, dense only Sept-Nov 2025 — at MLB's
 * cutoff its largest market has 42 held-out rows — so there is nothing to gate
 * a probability on until the 2026 season produces held-out rows.
 *
 * NO EDGE FIELDS EITHER: no market probability, no edge, no price, no grade.
 * Those are claims against someone else's price and are gated on a bar nothing
 * in this project has cleared.
 *
 * Unlike the MLB and NHL routes there is no `unnamedOmitted` count, because
 * there is no name join to omit anything: `athlete_crosswalk` holds zero NFL
 * rows with a name, so `readNflProjections` skips the join entirely rather than
 * dropping rows for a name it would not get. Scan takes the player's name from
 * the candidate.
 */
import { NextResponse } from 'next/server';
import { readNflProjections } from '@/lib/db/client';
import { toNflStatsBoardData } from '@/lib/sports/nfl/adapters/statsBoardAdapter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await readNflProjections();

  // The slate these projections are for. Every row in one serving run shares a
  // `computed_at` — `write_prop_model_cache` writes in a single transaction and
  // Postgres's `now()` is the transaction timestamp — and
  // `LATEST_PROJECTION_BATCH` already narrows the read to one run, so any row's
  // value is the batch's. Surfaced rather than passed as null so a stale board
  // can say which day it is describing.
  const data = toNflStatsBoardData(rows, rows[0]?.computedAt ?? null);

  return NextResponse.json(data);
}
