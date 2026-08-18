import { NextResponse } from 'next/server';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { jsonPassthrough } from '@/lib/db/jsonPassthrough';
import { triggerBackgroundRebuild, awaitRebuild } from '@/lib/staleCache';
import { buildNflSnapshot } from '@/lib/sports/nfl/adapter';
import { ensureSchedulerStarted } from '@/lib/scheduler';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

ensureSchedulerStarted();

const CACHE_KEY = 'nfl:snapshot';
const TTL_MS = 4 * 60_000; // matches Tier 1's own refresh cadence for MLB — no point rebuilding faster than the underlying prop_odds rows change

async function rebuild() {
  const snapshot = await buildNflSnapshot();
  writeSnapshotCache(CACHE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export async function GET() {
  try {
    const cached = readSnapshotCache(CACHE_KEY);
    const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

    if (cached && age < TTL_MS) {
      return jsonPassthrough(cached.payload, 'hit');
    }
    if (cached) {
      triggerBackgroundRebuild(CACHE_KEY, rebuild);
      return jsonPassthrough(cached.payload, 'stale');
    }

    const started = Date.now();
    const snapshot = await awaitRebuild(CACHE_KEY, rebuild);
    return NextResponse.json(snapshot, {
      headers: { 'cache-control': 'no-store', 'x-cache': 'miss', 'x-elapsed-ms': String(Date.now() - started) },
    });
  } catch (error) {
    console.error('[api/nfl]', error);
    const stale = readSnapshotCache(CACHE_KEY);
    if (stale) return jsonPassthrough(stale.payload, 'stale');
    return NextResponse.json(
      { error: 'NFL snapshot failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
