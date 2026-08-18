import { NextResponse } from 'next/server';
import { getGolfSnapshot } from '@/lib/sports/golf/adapter';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { jsonPassthrough } from '@/lib/db/jsonPassthrough';
import { triggerBackgroundRebuild, awaitRebuild } from '@/lib/staleCache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_KEY = 'golf:snapshot';
const CACHE_TTL_MS = 5 * 60 * 1000;

async function rebuild() {
  const snapshot = await getGolfSnapshot();
  try { writeSnapshotCache(CACHE_KEY, JSON.stringify(snapshot)); } catch { /* ok */ }
  return snapshot;
}

export async function GET() {
  try {
    const cached = readSnapshotCache(CACHE_KEY);
    const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

    if (cached && age < CACHE_TTL_MS) {
      // Already JSON — see the note in the MLB route. Golf's snapshot is the
      // larger of the two (~3 MB), so the round trip costs more here.
      return jsonPassthrough(cached.payload, 'hit');
    }
    if (cached) {
      // Same stale-serve-then-refresh-in-background pattern as /api/mlb and
      // /api/nfl — a stale cache used to still block the response on a full
      // ESPN+weather+PGA-Tour rebuild (measured 14.3s on a cold cache).
      triggerBackgroundRebuild(CACHE_KEY, rebuild);
      return jsonPassthrough(cached.payload, 'stale');
    }

    const started = Date.now();
    const snapshot = await awaitRebuild(CACHE_KEY, rebuild);
    return NextResponse.json(snapshot, {
      headers: { 'cache-control': 'no-store', 'x-cache': 'miss', 'x-elapsed-ms': String(Date.now() - started) },
    });
  } catch (error) {
    console.error('[api/golf]', error);
    const stale = readSnapshotCache(CACHE_KEY);
    if (stale) return jsonPassthrough(stale.payload, 'stale');
    return NextResponse.json(
      { error: 'Golf snapshot failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
