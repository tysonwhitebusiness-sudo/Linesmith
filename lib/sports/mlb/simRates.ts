/**
 * Outcome-rate vector builders for the sim engine — the data-fetching half
 * of simEngine.ts's split (mirrors homeRunModel.ts / homeRunModelFit.ts's
 * pure-vs-fetching separation). Phase 1 needs only the league-wide average;
 * later phases add per-batter, per-pitcher, and bullpen builders here.
 */

import { getLeagueBatterSeasonRows, getPeopleWithGameLogs, getActiveRoster, type GameLogSplit } from './statsapi';
import { makeOutcomeVector, dirichletShrunkVector, type OutcomeVector } from './simEngine';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface LeagueOutcomeRates {
  vector: OutcomeVector;
  totalPA: number;
}

/**
 * League-wide per-PA outcome rates for one season, aggregated straight from
 * real batter game logs (same getLeagueBatterSeasonRows/getPeopleWithGameLogs
 * pull already proven for the Home Run model). BB folds in HBP (both put the
 * batter on first with no risk of an out, the same simplification the plan's
 * 7-category outcome set already makes). 1B is derived (hits minus the
 * extra-base hit types) rather than fetched directly — Statcast/StatsAPI
 * doesn't report singles as their own counting stat. OUT is everything left
 * over (PA minus BB/hits/K) — groundouts, flyouts, sac flies/bunts, and
 * reached-on-error all collapse into one bucket in v1, consistent with the
 * plan's disclosed 7-category simplification.
 */
export async function computeLeagueOutcomeRates(season: number): Promise<LeagueOutcomeRates> {
  const batterPool = await getLeagueBatterSeasonRows(season);
  const batterIds = batterPool.map((b) => b.personId);
  const logsById = await getPeopleWithGameLogs(batterIds, 'hitting', season);

  let pa = 0;
  let bb = 0;
  let k = 0;
  let hits = 0;
  let doubles = 0;
  let triples = 0;
  let hr = 0;

  for (const [, person] of logsById) {
    for (const g of person.gameLog) {
      const gamePa = num(g.stat.plateAppearances);
      if (gamePa <= 0) continue;
      pa += gamePa;
      bb += num(g.stat.baseOnBalls) + num(g.stat.hitByPitch);
      k += num(g.stat.strikeOuts);
      hits += num(g.stat.hits);
      doubles += num(g.stat.doubles);
      triples += num(g.stat.triples);
      hr += num(g.stat.homeRuns);
    }
  }

  if (pa === 0) {
    throw new Error(`computeLeagueOutcomeRates: no usable plate appearances found for season ${season}`);
  }

  const singles = Math.max(0, hits - doubles - triples - hr);
  const outs = Math.max(0, pa - bb - hits - k);

  const vector = makeOutcomeVector({
    BB: bb / pa,
    K: k / pa,
    '1B': singles / pa,
    '2B': doubles / pa,
    '3B': triples / pa,
    HR: hr / pa,
    OUT: outs / pa,
  });

  return { vector, totalPA: pa };
}

// ---------------------------------------------------------------------------
// Phase 2 — per-batter outcome vectors
// ---------------------------------------------------------------------------

/** Raw per-category PA counts from one batter's game log — same field extraction as computeLeagueOutcomeRates, just not summed across the whole league. */
export function batterOutcomeCounts(gameLog: GameLogSplit[]): OutcomeVector {
  let pa = 0;
  let bb = 0;
  let k = 0;
  let hits = 0;
  let doubles = 0;
  let triples = 0;
  let hr = 0;

  for (const g of gameLog) {
    const gamePa = num(g.stat.plateAppearances);
    if (gamePa <= 0) continue;
    pa += gamePa;
    bb += num(g.stat.baseOnBalls) + num(g.stat.hitByPitch);
    k += num(g.stat.strikeOuts);
    hits += num(g.stat.hits);
    doubles += num(g.stat.doubles);
    triples += num(g.stat.triples);
    hr += num(g.stat.homeRuns);
  }

  const singles = Math.max(0, hits - doubles - triples - hr);
  const outs = Math.max(0, pa - bb - hits - k);

  return makeOutcomeVector({ BB: bb, K: k, '1B': singles, '2B': doubles, '3B': triples, HR: hr, OUT: outs });
}

/**
 * Same shape as batterOutcomeCounts, for a PITCHER's own game log — the
 * `pitching` group's stat object has no `plateAppearances` field (that's a
 * batting-only stat; GAME_LOG_FIELDS in statsapi.ts never requested it for
 * pitchers because it doesn't exist there), so every row was silently
 * skipped and every pitcher came back as an empty, all-zero vector — the
 * real cause of Phase 3's ace and replacement-level starter coming back
 * identical. Batters-faced is approximated here as atBats + baseOnBalls +
 * hitByPitch (misses sac flies/bunts and catcher's interference, a small
 * undercount that lands in the OUT bucket the same as everything else v1's
 * 7-category scheme doesn't itemize — consistent with, not worse than, the
 * existing disclosed simplification).
 */
export function pitcherOutcomeCounts(gameLog: GameLogSplit[]): OutcomeVector {
  let battersFaced = 0;
  let bb = 0;
  let k = 0;
  let hits = 0;
  let doubles = 0;
  let triples = 0;
  let hr = 0;

  for (const g of gameLog) {
    const walksAndHbp = num(g.stat.baseOnBalls) + num(g.stat.hitByPitch);
    const gameFaced = num(g.stat.atBats) + walksAndHbp;
    if (gameFaced <= 0) continue;
    battersFaced += gameFaced;
    bb += walksAndHbp;
    k += num(g.stat.strikeOuts);
    hits += num(g.stat.hits);
    doubles += num(g.stat.doubles);
    triples += num(g.stat.triples);
    hr += num(g.stat.homeRuns);
  }

  const singles = Math.max(0, hits - doubles - triples - hr);
  const outs = Math.max(0, battersFaced - bb - hits - k);

  return makeOutcomeVector({ BB: bb, K: k, '1B': singles, '2B': doubles, '3B': triples, HR: hr, OUT: outs });
}

export interface LineupOutcomeVectors {
  leagueRates: OutcomeVector;
  /** personId -> Dirichlet-shrunk outcome vector. */
  byBatter: Map<number, OutcomeVector>;
}

export interface RankedBatterRow {
  personId: number;
  fullName: string;
  pa: number;
  hrRate: number;
}

export interface RankedPitcherRow {
  personId: number;
  fullName: string;
  era: number;
}

// ---------------------------------------------------------------------------
// Phase 7 — team-level vectors for the historical backfill
// ---------------------------------------------------------------------------

/**
 * A whole team's batting staff (every non-pitcher on the active roster,
 * pooled) as one shrunk outcome vector — the historical-backfill counterpart
 * to Phase 2's per-batter lineup vectors. Real per-game historical lineups
 * (who actually batted on a specific past date) aren't cheaply available at
 * scale from the endpoints this app already uses — the SAME gap
 * modelFit.ts's own header comment already discloses for starter-specific
 * ERA blending ("no cheap historical per-game starter data at scale"). This
 * mirrors that exact, already-accepted simplification: team-season
 * aggregate for training, the real Phase 6 per-lineup orchestrator for live
 * prediction where the actual day's lineup IS known.
 */
export async function computeTeamBattingVector(teamId: number, season: number, leagueRates: OutcomeVector): Promise<OutcomeVector> {
  const roster = await getActiveRoster(teamId, season);
  const batterIds = roster.filter((p) => p.position !== 'P').map((p) => p.id);
  if (batterIds.length === 0) return leagueRates;
  const logsById = await getPeopleWithGameLogs(batterIds, 'hitting', season);
  let pooled = makeOutcomeVector({});
  for (const [, person] of logsById) {
    const counts = batterOutcomeCounts(person.gameLog);
    for (const key of Object.keys(pooled) as (keyof OutcomeVector)[]) pooled[key] += counts[key];
  }
  return dirichletShrunkVector(pooled, leagueRates);
}

/**
 * A whole team's pitching staff (starters + relievers combined, pooled) as
 * one shrunk outcome vector — same team-only simplification as
 * computeTeamBattingVector, and the same role computeBullpenOutcomeVector
 * plays for just the bullpen slice; this is the full staff, used only for
 * the historical backfill where a specific day's starter isn't cheaply
 * knowable.
 */
export async function computeTeamPitchingVector(teamId: number, season: number, leagueRates: OutcomeVector): Promise<OutcomeVector> {
  const roster = await getActiveRoster(teamId, season);
  const pitcherIds = roster.filter((p) => p.position === 'P').map((p) => p.id);
  if (pitcherIds.length === 0) return leagueRates;
  const logsById = await getPeopleWithGameLogs(pitcherIds, 'pitching', season);
  let pooled = makeOutcomeVector({});
  for (const [, person] of logsById) {
    const counts = pitcherOutcomeCounts(person.gameLog);
    for (const key of Object.keys(pooled) as (keyof OutcomeVector)[]) pooled[key] += counts[key];
  }
  return dirichletShrunkVector(pooled, leagueRates);
}
