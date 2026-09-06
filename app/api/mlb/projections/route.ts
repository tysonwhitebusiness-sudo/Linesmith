/**
 * GET /api/mlb/projections — what the MLB stats board reads.
 *
 * Pattern 2 (CLAUDE.md): a direct read of `prop_model_cache`, kept fresh
 * out-of-band by `mlbProjectionsJob`. No external fetch, no computation, no
 * per-request refresh — nothing for `cachedRoute()` to stale-serve.
 *
 * This handler does not write. No edge, no market probability, no price and no
 * grade is served: those are claims against someone else's price and are gated
 * on a bar nothing in this project has cleared.
 */
import { NextResponse } from 'next/server';
import {
  readMlbProjections,
  countMlbProjectionsWithoutName,
} from '@/lib/db/client';
import { toMlbStatsBoardData } from '@/lib/sports/mlb/adapters/statsBoardAdapter';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [rows, unnamed] = await Promise.all([
    readMlbProjections(),
    countMlbProjectionsWithoutName(),
  ]);
  // The slate these projections are for. Every row in one serving run shares a
  // `computed_at`, and `LATEST_PROJECTION_BATCH` already narrows the read to a
  // single run, so any row's value is the batch's. Surfaced rather than passed
  // as null: MLB is out of season for part of the year, and a board that
  // cannot say which day it is describing is a board that shows a stale slate
  // as though it were today's.
  const data = toMlbStatsBoardData(rows, rows[0]?.computedAt ?? null);
  return NextResponse.json({ ...data, unnamedOmitted: unnamed });
}
