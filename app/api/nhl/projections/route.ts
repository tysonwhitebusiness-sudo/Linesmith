/**
 * GET /api/nhl/projections — what the NHL stats board reads.
 *
 * CACHING: pattern 2 from CLAUDE.md. `prop_model_cache` is a real table kept
 * fresh out-of-band by `nhlProjectionsJob` (python-odds-service JOB_REGISTRY,
 * hourly). This handler does a direct read and nothing else — no external
 * fetch, no computation, no per-request refresh trigger. There is no work for
 * `cachedRoute()` to stale-serve or dedup, which is the condition pattern 2
 * exists for.
 *
 * A GET HANDLER MUST NOT WRITE, and this one does not. Worth stating because
 * the audit found `/api/odds/lines` writing to the model's own track record on
 * an unauthenticated GET; the projection pipe's single writer is the Python
 * job.
 *
 * NO EDGE FIELDS ARE SERVED HERE. The response carries projections, sample
 * sizes and — only for the two markets whose calibration earned it — a model
 * probability. It carries no market probability, no edge, no price and no
 * grade, because those are claims against someone else's price and are gated
 * on 4.7, which failed at t=+3.03.
 */
import { NextResponse } from 'next/server';
import {
  readNhlProjections,
  countNhlProjectionsWithoutName,
} from '@/lib/db/client';
import { toNhlStatsBoardData } from '@/lib/sports/nhl/adapters/statsBoardAdapter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [rows, unnamed] = await Promise.all([
    readNhlProjections(),
    countNhlProjectionsWithoutName(),
  ]);

  // The slate these projections are for. Every row in one serving run shares a
  // `computed_at`, and `LATEST_PROJECTION_BATCH` already narrows the read to a
  // single run, so any row's value is the batch's. Surfaced rather than passed
  // as null: NHL is out of season for part of the year, and a board that
  // cannot say which day it is describing is a board that shows a stale slate
  // as though it were today's.
  const data = toNhlStatsBoardData(rows, rows[0]?.computedAt ?? null);

  return NextResponse.json({
    ...data,
    // Reported rather than swallowed: a ranking silently missing rows is a
    // distorted ranking, and the reader deserves to know the field is partial.
    unnamedOmitted: unnamed,
  });
}
