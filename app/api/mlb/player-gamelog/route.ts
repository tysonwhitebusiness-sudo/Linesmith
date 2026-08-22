/**
 * GET /api/mlb/player-gamelog?subjectId=X&dimension=Y&date=YYYY-MM-DD
 *
 * On-demand recovery of one candidate's full box-score history, for
 * PlayerDetail's "show all games" action — see lib/sports/mlb/historyTrim.ts
 * for why /api/mlb itself doesn't send this by default (it's the dominant
 * cost of that response, and unread on every load but this one).
 *
 * Reads the untrimmed copy /api/mlb's route stashes on every rebuild rather
 * than recomputing anything — so this is only ever as fresh as the last
 * snapshot rebuild for that date, same as everything else on the page.
 */

import { NextResponse } from 'next/server';
import { readSnapshotCache } from '@/lib/db/client';
import { fullRawCacheKey } from '@/lib/sports/mlb/playerGamelogCache';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import type { PickCandidate } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const subjectId = searchParams.get('subjectId');
  const dimension = searchParams.get('dimension');
  const date = searchParams.get('date') ?? easternDate();

  if (!subjectId || !dimension) {
    return NextResponse.json({ error: 'subjectId and dimension are required' }, { status: 400 });
  }

  const cached = await readSnapshotCache(fullRawCacheKey(date));
  if (!cached) {
    return NextResponse.json({ error: 'No full history cached for this date yet' }, { status: 404 });
  }

  let candidates: PickCandidate[];
  try {
    candidates = JSON.parse(cached.payload) as PickCandidate[];
  } catch {
    return NextResponse.json({ error: 'Cached history was corrupt' }, { status: 500 });
  }

  const match = candidates.find((c) => c.subjectId === subjectId && c.dimension === dimension);
  if (!match) {
    return NextResponse.json({ error: 'No matching candidate for that subject/dimension on this date' }, { status: 404 });
  }

  return NextResponse.json({ history: match.history });
}
