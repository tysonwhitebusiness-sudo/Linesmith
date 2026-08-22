/**
 * Converts a snapshot's candidates into `pick_history` rows — the one place
 * that decides what "the scan surfaced this" means for Phase C's grading and
 * calibration. Shared between the live snapshot route (C.0.2) and the
 * historical backfill job (C.0.4) so both write the exact same shape.
 */

import type { PickCandidate, Sport, SportSnapshot } from '../../core/types';
import { logSurfaced, readPropOddsForGame, liveMarketSkill, type SurfacedEntry, type PropOddsRow } from '../../db/client';
import { candidateDimensionToMarketKey } from './entityResolution';
import { resolveCandidateEdge } from './liveEdge';
import { computePropScore } from './propScore';
import { trustTierFromLiveBSS, type MarketTrust } from './marketTrust';
import { userSportsbook } from './config';

function subjectMeta(candidate: PickCandidate): Record<string, unknown> {
  return (candidate.subjectMeta ?? {}) as Record<string, unknown>;
}

/** Team candidates (team-total-runs) are out of scope for Phase C.1's player-prop model. */
function isPlayerCandidate(candidate: PickCandidate): boolean {
  return subjectMeta(candidate).isTeamCandidate !== true;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Prop Score v1 — per-dimension trust tier, computed once per snapshot
 * (not once per candidate) from `liveMarketSkill`'s live-only Brier Skill
 * Score. `sport` here is always 'mlb' in practice (the only sport with
 * props), matching `liveMarketSkill`'s own scope.
 */
async function trustTierMap(sport: string): Promise<Map<string, MarketTrust>> {
  const map = new Map<string, MarketTrust>();
  for (const m of await liveMarketSkill(sport)) {
    map.set(m.dimension, trustTierFromLiveBSS(m.bss, m.n));
  }
  return map;
}

export function candidateToSurfacedEntry(
  sport: Sport,
  candidate: PickCandidate,
  propRows: PropOddsRow[],
  trustTiers: Map<string, MarketTrust>,
): SurfacedEntry {
  const meta = subjectMeta(candidate);
  const gamePk = meta.gamePk;
  const trustTier = trustTiers.get(candidate.dimension) ?? 'building';

  // Prop Score v1 — locked here, at first-surfaced time, via the same
  // INSERT OR IGNORE that already locks model_prob/edge: whatever the score
  // was the moment this candidate was first surfaced is what the graded
  // record holds forever, not whatever a later refresh recomputes. An
  // `excluded` market gets a trust_tier on the row (useful for audit) but no
  // score — "no score," not a fabricated low one, same rule computePropScore
  // itself follows when there's no model probability to build one from.
  let propScore: number | null = null;
  let scoreGrade: string | null = null;
  if (trustTier !== 'excluded') {
    const edgeInfo = resolveCandidateEdge(candidate, propRows, userSportsbook());
    const score = computePropScore(candidate, edgeInfo);
    if (score) {
      propScore = score.score;
      scoreGrade = score.grade;
    }
  }

  return {
    sport,
    subjectId: candidate.subjectId,
    subjectName: candidate.subjectName,
    dimension: candidate.dimension,
    category: candidate.category,
    marketKey: candidateDimensionToMarketKey(candidate.dimension),
    line: candidate.line ?? null,
    gameId: gamePk != null ? String(gamePk) : null,
    sampleSize: candidate.sampleSize,
    distance: candidate.liveState?.distanceToSubject ?? null,
    eventContext: null,
    // Phase C.1 — logged now so a row graded later already has the model's
    // side of the edge; the market side gets joined in at grading time from
    // prop_odds_history (lib/odds/props/grading.ts).
    modelProb: num(meta.modelProb),
    // Home Run model plan, Phase 6 — set on subjectMeta only when a fitted,
    // versioned model (currently just `home-run`) actually produced
    // modelProb; undefined/null for the shared Beta-Binomial props pipeline,
    // matching pick_history.model_version's own null-for-unversioned intent.
    modelVersion: typeof meta.modelVersion === 'number' ? meta.modelVersion : null,
    propScore,
    scoreGrade,
    trustTier,
  };
}

/**
 * Logs every player-level candidate in a snapshot. Safe to call on every
 * refresh — `INSERT OR IGNORE` dedupes. Includes markets with no odds
 * resolution (vs-LHP/vs-RHP/first-inning) — `market_key` is null for those,
 * so they'll never carry an edge, but they're still real, gradeable
 * predictions worth calibrating the model against.
 *
 * `propRows` is whatever's currently cached for the day's games
 * (`readPropOddsForGame` per game) — best-effort. Prop odds refresh on
 * their own 3-minute TTL via a separate route (`/api/props/lines`), not
 * coupled to this one, so a game surfaced before any client has requested
 * its odds locks with no live edge (same honest-gap handling
 * `grading.ts`'s `joinMarketSide` already has for "no price found"). The
 * live-displayed score (recomputed client-side each render) picks up the
 * edge once odds do arrive even though this locked row's snapshot predates
 * it.
 */
export async function logSnapshotCandidates(sport: Sport, snapshot: SportSnapshot): Promise<void> {
  const candidates = (snapshot.candidates ?? []).filter(isPlayerCandidate);
  const gameIds = new Set(candidates.map((c) => subjectMeta(c).gamePk).filter((id): id is number | string => id != null).map(String));
  const propRows = (await Promise.all([...gameIds].map((gameId) => readPropOddsForGame(gameId)))).flat();
  const trustTiers = await trustTierMap(sport);
  const entries = candidates.map((c) => candidateToSurfacedEntry(sport, c, propRows, trustTiers));
  await logSurfaced(entries);
}

interface SnapshotGame {
  gamePk: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  gameModel: { homeWinProb: number; awayWinProb: number } | null;
}

/**
 * Game-level moneyline predictions (G4) — one row per side, so each team's
 * own win probability gets graded independently. Reuses the `team-<id>`
 * subject convention already established for team-total-runs candidates.
 * Totals aren't logged here: grading them needs the sportsbook's actual
 * total line, which this function has no access to — that gets joined in
 * at grading time once game odds history (C0-7) exists.
 */
export async function logGameModelPredictions(sport: Sport, snapshot: SportSnapshot): Promise<void> {
  const games = ((snapshot.context?.other as Record<string, unknown> | undefined)?.games ?? []) as SnapshotGame[];
  const entries: SurfacedEntry[] = [];
  for (const g of games) {
    if (!g.gameModel) continue;
    entries.push({
      sport,
      subjectId: `team-${g.homeTeamId}`,
      subjectName: g.homeTeamName,
      dimension: 'moneyline',
      category: 'win',
      marketKey: null,
      line: null,
      gameId: String(g.gamePk),
      sampleSize: 0,
      distance: null,
      eventContext: null,
      modelProb: g.gameModel.homeWinProb,
    });
    entries.push({
      sport,
      subjectId: `team-${g.awayTeamId}`,
      subjectName: g.awayTeamName,
      dimension: 'moneyline',
      category: 'win',
      marketKey: null,
      line: null,
      gameId: String(g.gamePk),
      sampleSize: 0,
      distance: null,
      eventContext: null,
      modelProb: g.gameModel.awayWinProb,
    });
  }
  await logSurfaced(entries);
}

export interface GameTotalPrediction {
  gamePk: number | string;
  totalLine: number;
  /** P(actual combined runs > totalLine), from computeTotalModel. */
  overProb: number;
}

/**
 * Total-market predictions (extends G4) — logged from the odds route rather
 * than the snapshot route, since grading a total needs the sportsbook's
 * actual posted line, which the snapshot alone doesn't have. `market_prob`/
 * `edge` are left null here, same honest gap moneyline already has (game
 * odds history isn't joined back to a gamePk yet) — but Brier calibration
 * only needs `model_prob` + `outcome`, so this still gives the total market
 * a real, improving trust signal for the Good Bets engine to key off.
 */
export async function logGameTotalPredictions(sport: Sport, predictions: GameTotalPrediction[]): Promise<void> {
  const entries: SurfacedEntry[] = predictions.map((p) => ({
    sport,
    subjectId: `game-${p.gamePk}`,
    subjectName: 'Total',
    dimension: 'total',
    category: 'over',
    marketKey: null,
    line: p.totalLine,
    gameId: String(p.gamePk),
    sampleSize: 0,
    distance: null,
    eventContext: null,
    modelProb: p.overProb,
  }));
  await logSurfaced(entries);
}
