/**
 * Golf Phase A predictions — GET /api/golf/predictions?subjectId=X&hole=N
 *
 * Testing/integration endpoint for the three Phase A models (see project
 * memory's golf model gameplan): hole score, round score, tournament
 * winner. Reads the already-cached golf snapshot (same pattern
 * api/golf/field-stats/route.ts uses) rather than re-fetching ESPN — the
 * candidates it already carries have exactly the per-hole/per-round history
 * these models need.
 *
 * The tournament-winner simulation (`predictTournament`, 3000 iterations)
 * and the season strokes-gained fetch it depends on are the expensive part
 * of this route — and, unlike the hole/round sections, neither one actually
 * depends on `subjectId`/`hole` at all: every request runs the exact same
 * simulation over the exact same field regardless of which golfer or hole
 * was asked about. A single cachedRoute()-per-full-request key would have
 * multiplied that cost by the number of distinct subjectId/hole combos
 * queried instead of sharing it, so the expensive, query-independent piece
 * is cached separately (getSharedPredictions below) from the cheap,
 * per-request hole/round math, which stays computed fresh every time.
 */

import { NextResponse } from 'next/server';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { triggerBackgroundRebuild, awaitRebuild } from '@/lib/staleCache';
import { getSeasonStrokesGained } from '@/lib/sports/golf/pgatourStats';
import { predictHoleScore, type HoleFieldObservation } from '@/lib/sports/golf/models/holeScoreModel';
import { predictRoundScore, ROUND_SCORE_SD, type RoundFieldObservation } from '@/lib/sports/golf/models/roundScoreModel';
import { predictTournament, type GolferProjection } from '@/lib/sports/golf/models/tournamentWinModel';
import type { PickCandidate, SportSnapshot, SubjectSummary } from '@/lib/core/types';

const TOTAL_ROUNDS = 4;
const CUT_SIZE = 65;
const CUT_AFTER_ROUND = 2;
const SIM_ITERATIONS = 3000;

export const dynamic = 'force-dynamic';

async function readGolfSnapshot(): Promise<SportSnapshot | null> {
  const cached = await readSnapshotCache('golf:snapshot');
  if (!cached) return null;
  try {
    return JSON.parse(cached.payload) as SportSnapshot;
  } catch {
    return null;
  }
}

interface SharedPredictions {
  fetchedAt: string;
  fieldAvgSgTotal: number | null;
  fieldSgSampleSize: number;
  sgByEspnId: Record<string, number | null>;
  tournament: ReturnType<typeof predictTournament> | null;
}

const SHARED_CACHE_KEY = 'golf:predictions:shared:route';
// Matches golf:snapshot's own 5-min TTL (api/golf/route.ts) — the tournament
// simulation is built from round-in-progress live data carried on that same
// snapshot, so caching this materially longer risks simulating a golfer
// who's already been cut/withdrawn per a newer snapshot.
const SHARED_TTL_MS = 5 * 60 * 1000;

async function buildSharedPredictions(snapshot: SportSnapshot): Promise<SharedPredictions> {
  const subjects: SubjectSummary[] = snapshot.subjects ?? [];
  const sgResult = await getSeasonStrokesGained(subjects);
  const sgByEspnIdMap = new Map(sgResult.golfers.filter((g) => g.espnId !== null).map((g) => [g.espnId as string, g.avgPerRound]));
  const matchedSg = [...sgByEspnIdMap.values()].filter((v): v is number => v != null);
  const fieldAvgSgTotal = matchedSg.length > 0 ? matchedSg.reduce((a, b) => a + b, 0) / matchedSg.length : null;

  const roundCandidates = (snapshot.candidates ?? []).filter((c: PickCandidate) => c.dimension === 'round-score');
  let tournament: ReturnType<typeof predictTournament> | null = null;

  if (roundCandidates.length > 0) {
    const cutOutPattern = /^(cut|wd|dq)$/i;
    const subjectsById = new Map(subjects.map((s) => [s.subjectId, s]));

    const projections: GolferProjection[] = roundCandidates
      .filter((c) => {
        const position = (subjectsById.get(c.subjectId)?.meta as Record<string, unknown> | undefined)?.position;
        return typeof position !== 'string' || !cutOutPattern.test(position.trim());
      })
      .map((c) => {
        const completedRounds = [...c.history]
          .sort((a, b) => a.period - b.period)
          .map((h) => (h.raw as Record<string, unknown> | undefined)?.relativeToPar as number)
          .filter((v) => Number.isFinite(v));

        const golferSgTotal = sgByEspnIdMap.get(c.subjectId) ?? null;
        const fieldObservations: RoundFieldObservation[] = roundCandidates.flatMap((rc) =>
          rc.history.map((h) => ({ relativeToPar: (h.raw as Record<string, unknown> | undefined)?.relativeToPar as number })).filter((o) => Number.isFinite(o.relativeToPar)),
        );
        const golferOwnObservations: RoundFieldObservation[] = completedRounds.map((relativeToPar) => ({ relativeToPar }));
        const windMph = (snapshot.context?.weather as Record<string, unknown> | undefined)?.windMph as number | undefined;

        const { expectedRelativeToPar } = predictRoundScore({
          fieldObservations,
          golferOwnObservations,
          golferSgTotal,
          fieldAvgSgTotal,
          windMph: windMph ?? null,
        });

        return { espnId: c.subjectId, completedRounds, projectedRoundMean: expectedRelativeToPar };
      });

    // The real cut already happened once round 3 is underway — the CUT/WD/DQ
    // filter above already reflects who actually survived, so re-simulating
    // a cut at that point would double-apply it against golfers who cleared
    // it for real. Only model the cut while it's still ahead of the field.
    const roundsInProgress = Math.max(0, ...projections.map((p) => p.completedRounds.length));
    const cutAlreadyDecided = roundsInProgress >= CUT_AFTER_ROUND;

    tournament = predictTournament({
      golfers: projections,
      totalRounds: TOTAL_ROUNDS,
      cutSize: cutAlreadyDecided ? null : CUT_SIZE,
      cutAfterRound: CUT_AFTER_ROUND,
      iterations: SIM_ITERATIONS,
      roundScoreSd: ROUND_SCORE_SD,
    });
  }

  return {
    fetchedAt: snapshot.fetchedAt,
    fieldAvgSgTotal,
    fieldSgSampleSize: matchedSg.length,
    sgByEspnId: Object.fromEntries(sgByEspnIdMap),
    tournament,
  };
}

async function getSharedPredictions(snapshot: SportSnapshot): Promise<SharedPredictions> {
  async function rebuild() {
    const result = await buildSharedPredictions(snapshot);
    try { await writeSnapshotCache(SHARED_CACHE_KEY, JSON.stringify(result)); } catch { /* ok */ }
    return result;
  }

  const cached = await readSnapshotCache(SHARED_CACHE_KEY);
  const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;

  if (cached && age < SHARED_TTL_MS) {
    return JSON.parse(cached.payload) as SharedPredictions;
  }
  if (cached) {
    triggerBackgroundRebuild(SHARED_CACHE_KEY, rebuild);
    return JSON.parse(cached.payload) as SharedPredictions;
  }
  return awaitRebuild(SHARED_CACHE_KEY, rebuild);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const subjectId = url.searchParams.get('subjectId');
  const holeParam = url.searchParams.get('hole');

  const snapshot = await readGolfSnapshot();
  if (!snapshot) {
    return NextResponse.json({ error: 'No golf snapshot cached yet — load /golf at least once first.' }, { status: 503 });
  }

  const shared = await getSharedPredictions(snapshot);
  const sgByEspnId = new Map(Object.entries(shared.sgByEspnId));

  const response: Record<string, unknown> = {
    fetchedAt: shared.fetchedAt,
    fieldAvgSgTotal: shared.fieldAvgSgTotal,
    fieldSgSampleSize: shared.fieldSgSampleSize,
  };

  if (holeParam) {
    const hole = Number(holeParam);
    const par = ((snapshot.context?.other as Record<string, unknown> | undefined)?.holes as Array<{ number: number; shotsToPar: number }> | undefined)?.find(
      (h) => h.number === hole,
    )?.shotsToPar ?? null;

    const holeCandidates = (snapshot.candidates ?? []).filter((c: PickCandidate) => c.dimension === `hole-${hole}`);
    const fieldObservations: HoleFieldObservation[] = holeCandidates.flatMap((c) =>
      c.history.map((h) => ({ relativeToPar: (h.raw as Record<string, unknown> | undefined)?.relativeToPar as number })).filter((o) => Number.isFinite(o.relativeToPar)),
    );

    const subjectCandidate = subjectId ? holeCandidates.find((c) => c.subjectId === subjectId) : undefined;
    const golferOwnObservations: HoleFieldObservation[] = subjectCandidate
      ? subjectCandidate.history
          .map((h) => ({ relativeToPar: (h.raw as Record<string, unknown> | undefined)?.relativeToPar as number }))
          .filter((o) => Number.isFinite(o.relativeToPar))
      : [];

    const golferSgTotal = subjectId ? (sgByEspnId.get(subjectId) ?? null) : null;

    response.hole = {
      hole,
      par,
      subjectId: subjectId ?? null,
      subjectName: subjectCandidate?.subjectName ?? null,
      prediction: predictHoleScore({
        par,
        fieldObservations,
        golferOwnObservations,
        golferSgTotal,
        fieldAvgSgTotal: shared.fieldAvgSgTotal,
      }),
    };
  }

  // Round-score candidates' history includes the round currently in
  // progress at its partial total (see adapter.ts's roundScoreCandidate) —
  // the same live-so-far data ScanTable's Round Score market already shows,
  // treated here as one more observation rather than filtered out.
  const roundCandidates = (snapshot.candidates ?? []).filter((c: PickCandidate) => c.dimension === 'round-score');
  if (roundCandidates.length > 0) {
    const fieldObservations: RoundFieldObservation[] = roundCandidates.flatMap((c) =>
      c.history.map((h) => ({ relativeToPar: (h.raw as Record<string, unknown> | undefined)?.relativeToPar as number })).filter((o) => Number.isFinite(o.relativeToPar)),
    );
    const subjectCandidate = subjectId ? roundCandidates.find((c) => c.subjectId === subjectId) : undefined;
    const golferOwnObservations: RoundFieldObservation[] = subjectCandidate
      ? subjectCandidate.history
          .map((h) => ({ relativeToPar: (h.raw as Record<string, unknown> | undefined)?.relativeToPar as number }))
          .filter((o) => Number.isFinite(o.relativeToPar))
      : [];
    const golferSgTotal = subjectId ? (sgByEspnId.get(subjectId) ?? null) : null;
    const windMph = (snapshot.context?.weather as Record<string, unknown> | undefined)?.windMph as number | undefined;

    response.round = {
      subjectId: subjectId ?? null,
      subjectName: subjectCandidate?.subjectName ?? null,
      prediction: predictRoundScore({
        fieldObservations,
        golferOwnObservations,
        golferSgTotal,
        fieldAvgSgTotal: shared.fieldAvgSgTotal,
        windMph: windMph ?? null,
      }),
    };
  }

  if (shared.tournament) {
    response.tournament = shared.tournament;
  }

  return NextResponse.json(response, { headers: { 'cache-control': 'no-store' } });
}
