/**
 * Proactive background refresh for `/api/mlb`, `/api/props/lines`, and
 * `/api/props/calibration` — keeps each cache warm on a timer instead of
 * relying on a real request to be the one that triggers a rebuild.
 * Combined with each route's own stale-serve logic (serve cached, refresh
 * in the background), a real request almost never has to wait on anything.
 *
 * This is *not* `instrumentation.ts` — that's Next's official run-once
 * startup hook, and it looked like the natural home for this, but its
 * dev-mode bundling doesn't code-split a dynamic `import()` the way a
 * normal route does: `better-sqlite3` (a native module, needs `fs`) got
 * pulled into the same edge-compatible bundle instrumentation.ts is built
 * against and failed to resolve, taking every request down with a 500.
 * Confirmed by trying it — this file exists because that one didn't work.
 *
 * Instead, `ensureSchedulerStarted()` is called once from a module-level
 * side effect in a route file that's guaranteed to load early. In `next
 * start` (this app's real deployment — one persistent process, not
 * serverless), Next loads every route module before serving the first
 * request, so this genuinely starts at boot. In `next dev`, route modules
 * compile lazily on first hit, so it starts on whichever request happens to
 * load first instead — the ongoing warm-cache benefit is identical either
 * way; only the very-first-request timing differs between dev and prod.
 */

import { rebuildMlbSnapshot, TODAY_CACHE_KEY } from '@/lib/sports/mlb/snapshotRebuild';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import { triggerFreshen } from '@/lib/odds/props/tier1RefreshScheduler';
import { refreshSportsGameOdds } from '@/lib/odds/props/sportsGameOddsRefresh';
import { refreshNfl, refreshCfb, refreshSoccerEpl } from '@/lib/odds/props/multiSportRefresh';
import { computeCalibrationPayload, calibrationCacheKey } from '@/lib/odds/props/calibrationSnapshot';
import { writeSnapshotCache, checkpointWal } from '@/lib/db/client';
import { awaitRebuild } from '@/lib/staleCache';

const MLB_INTERVAL_MS = 4 * 60_000;
const TIER1_INTERVAL_MS = 2.5 * 60_000;
const CALIBRATION_INTERVAL_MS = 2 * 60_000;
// Deliberately far slower than Tier 1 — SportsGameOdds's 11 exclusive markets
// (walks, both strikeout types, triples, singles, stolen bases, pitcher
// hits-allowed/outs/win/walks-allowed, first HR) don't need live-tick
// freshness, and this cadence keeps a full 15-game slate's spend well under
// the 2,000 monthly soft cap even run continuously across a season.
const SPORTSGAMEODDS_INTERVAL_MS = 90 * 60_000;
// NFL/CFB via ParlayAPI + SportsGameOdds: 3h cadence per the odds-stack plan's
// budget math (game-day-aware would be better but this is the safe default —
// both games/week are naturally low-volume enough not to need finer-grained
// scheduling, and ParlayAPI's 1,000/month credit budget doesn't support a
// faster cadence run continuously). NFL specifically has a known live issue
// as of this session — ParlayAPI's NFL board didn't match any of ESPN's real
// scheduled games (a provider-side data mismatch, not a bug here) — this job
// runs regardless so it self-heals once that resolves, rather than needing a
// code change.
const MULTI_SPORT_TEAM_INTERVAL_MS = 3 * 60 * 60_000;
// Soccer/EPL via Propline (proven live) — smaller slate (~10 games/matchday,
// not daily), safe well inside its 1,000/day budget at this cadence.
const SOCCER_EPL_INTERVAL_MS = 45 * 60_000;
/** The scope defaults real traffic actually asks for without a `dimension` param — the Model Health page's per-dimension split view is rarer and still served correctly by the reactive stale-serve path, just without proactive pre-warming. */
const CALIBRATION_SCOPES = ['all', 'player', 'game'] as const;

let started = false;

// Both routed through the same dedup pool their route handlers use — a
// request landing at the exact moment one of these ticks is rebuilding the
// same key joins that rebuild instead of racing it with a second one.
async function refreshMlb() {
  try {
    await awaitRebuild(TODAY_CACHE_KEY, () => rebuildMlbSnapshot(easternDate(), TODAY_CACHE_KEY, true));
  } catch (error) {
    console.error('[scheduler] proactive MLB refresh failed', error);
  }
  // Anchored here, not on its own timer: refreshMlb's snapshot_cache write
  // (mlb:full-raw:{date} + mlb:snapshot, up to ~66MB each) is the single
  // biggest writer in the app by a wide margin, so checkpointing right after
  // it completes each 4-minute tick reclaims the WAL file promptly without
  // adding a second interval to track. Runs even if the rebuild above threw,
  // since other jobs (Tier 1, calibration) may still have outstanding WAL
  // content worth flushing.
  try {
    checkpointWal();
  } catch (error) {
    console.error('[scheduler] wal checkpoint failed', error);
  }
}

async function refreshTier1() {
  try {
    await triggerFreshen();
  } catch (error) {
    console.error('[scheduler] proactive tier1 refresh failed', error);
  }
}

async function refreshSportsGameOddsJob() {
  try {
    await refreshSportsGameOdds();
  } catch (error) {
    console.error('[scheduler] proactive SportsGameOdds refresh failed', error);
  }
}

async function refreshNflJob() {
  try {
    await refreshNfl();
  } catch (error) {
    console.error('[scheduler] proactive NFL refresh failed', error);
  }
}

async function refreshCfbJob() {
  try {
    await refreshCfb();
  } catch (error) {
    console.error('[scheduler] proactive CFB refresh failed', error);
  }
}

async function refreshSoccerEplJob() {
  try {
    await refreshSoccerEpl();
  } catch (error) {
    console.error('[scheduler] proactive Soccer/EPL refresh failed', error);
  }
}

async function refreshCalibration() {
  try {
    for (const scope of CALIBRATION_SCOPES) {
      const key = calibrationCacheKey(scope, null);
      await awaitRebuild(key, async () => {
        const payload = await computeCalibrationPayload(scope, null);
        writeSnapshotCache(key, JSON.stringify(payload));
        return payload;
      });
    }
  } catch (error) {
    console.error('[scheduler] proactive calibration refresh failed', error);
  }
}

/** Idempotent — safe to call from more than one route's module scope; only the first call actually starts anything. */
export function ensureSchedulerStarted(): void {
  if (started) return;
  started = true;

  // Fire once immediately — not waiting a full interval — so the window
  // where a real request could still land on a truly empty cache is
  // seconds, not minutes. Then repeat on each job's own cadence.
  void refreshMlb();
  void refreshTier1();
  void refreshSportsGameOddsJob();
  void refreshNflJob();
  void refreshCfbJob();
  void refreshSoccerEplJob();
  void refreshCalibration();
  setInterval(() => void refreshMlb(), MLB_INTERVAL_MS);
  setInterval(() => void refreshTier1(), TIER1_INTERVAL_MS);
  setInterval(() => void refreshSportsGameOddsJob(), SPORTSGAMEODDS_INTERVAL_MS);
  setInterval(() => void refreshNflJob(), MULTI_SPORT_TEAM_INTERVAL_MS);
  setInterval(() => void refreshCfbJob(), MULTI_SPORT_TEAM_INTERVAL_MS);
  setInterval(() => void refreshSoccerEplJob(), SOCCER_EPL_INTERVAL_MS);
  setInterval(() => void refreshCalibration(), CALIBRATION_INTERVAL_MS);
}
