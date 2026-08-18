/**
 * Outcome-rate vector builders for the sim engine — the data-fetching half
 * of simEngine.ts's split (mirrors homeRunModel.ts / homeRunModelFit.ts's
 * pure-vs-fetching separation). Phase 1 needs only the league-wide average;
 * later phases add per-batter, per-pitcher, and bullpen builders here.
 */

import { getLeagueBatterSeasonRows, getPeopleWithGameLogs, getLeagueStartingPitcherStats, getLeaguePitcherRolePools, getActiveRoster, type GameLogSplit } from './statsapi';
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

/**
 * Real, shrunk outcome vectors for a specific list of batters (a lineup) —
 * fetches each batter's own season game log, aggregates raw counts, and
 * shrinks toward the league rate via dirichletShrunkVector. `leagueRates` is
 * a required input rather than recomputed here so a caller building a full
 * game (both lineups) only pays for the expensive league-wide aggregation
 * once, not once per lineup.
 */
export async function computeLineupOutcomeVectors(personIds: number[], season: number, leagueRates: OutcomeVector): Promise<LineupOutcomeVectors> {
  const logsById = await getPeopleWithGameLogs(personIds, 'hitting', season);
  const byBatter = new Map<number, OutcomeVector>();
  for (const id of personIds) {
    const person = logsById.get(id);
    const counts = person ? batterOutcomeCounts(person.gameLog) : makeOutcomeVector({});
    byBatter.set(id, dirichletShrunkVector(counts, leagueRates));
  }
  return { leagueRates, byBatter };
}

export interface RankedBatterRow {
  personId: number;
  fullName: string;
  pa: number;
  hrRate: number;
}

/**
 * Whole qualified-batter pool ranked by raw HR rate — Phase 2's own
 * validation tool (an elite vs. replacement-level lineup test doesn't need
 * hardcoded player IDs that go stale season to season) and a reasonable
 * general-purpose "who's actually hit for power this year" helper.
 * `minPA` guards against a 3-PA September call-up's one lucky homer looking
 * like a real 33% HR rate.
 */
export async function rankBattersByHrRate(season: number, minPA = 200): Promise<RankedBatterRow[]> {
  const batterPool = await getLeagueBatterSeasonRows(season);
  const logsById = await getPeopleWithGameLogs(batterPool.map((b) => b.personId), 'hitting', season);
  const rows: RankedBatterRow[] = [];
  for (const b of batterPool) {
    const person = logsById.get(b.personId);
    if (!person) continue;
    const counts = batterOutcomeCounts(person.gameLog);
    const pa = Object.values(counts).reduce((s, v) => s + v, 0);
    if (pa < minPA) continue;
    rows.push({ personId: b.personId, fullName: b.fullName, pa, hrRate: counts.HR / pa });
  }
  return rows.sort((a, b) => b.hrRate - a.hrRate);
}

// ---------------------------------------------------------------------------
// Phase 3 — per-pitcher outcome vectors (allowed rates, not achieved)
// ---------------------------------------------------------------------------

/**
 * A pitcher's own allowed-rate vector, shrunk the same way a batter's is —
 * uses pitcherOutcomeCounts (not batterOutcomeCounts), since the pitching
 * group's game log has no plateAppearances field to key off of.
 */
export async function computePitcherOutcomeVectors(personIds: number[], season: number, leagueRates: OutcomeVector): Promise<Map<number, OutcomeVector>> {
  const logsById = await getPeopleWithGameLogs(personIds, 'pitching', season);
  const byPitcher = new Map<number, OutcomeVector>();
  for (const id of personIds) {
    const person = logsById.get(id);
    const counts = person ? pitcherOutcomeCounts(person.gameLog) : makeOutcomeVector({});
    byPitcher.set(id, dirichletShrunkVector(counts, leagueRates));
  }
  return byPitcher;
}

export interface RankedPitcherRow {
  personId: number;
  fullName: string;
  era: number;
}

/** Qualified starters ranked by ERA (lowest first) — same "don't hardcode a name that goes stale" reasoning as rankBattersByHrRate, using the same era-ranked pool getLeagueStartingPitcherStats already builds for the app's own pitcher-ranking pages. */
export async function rankStartersByEra(season: number, minGamesStarted = 10): Promise<RankedPitcherRow[]> {
  const stats = await getLeagueStartingPitcherStats(season);
  return stats
    .filter((p) => p.gamesStarted >= minGamesStarted && typeof p.values.era === 'number')
    .map((p) => ({ personId: p.personId, fullName: p.fullName, era: p.values.era as number }))
    .sort((a, b) => a.era - b.era);
}

// ---------------------------------------------------------------------------
// Phase 4 — bullpen (single blended vector) + starter handoff trigger
// ---------------------------------------------------------------------------

/**
 * A team's whole bullpen (relievers + closers, role-classified the same way
 * pitcherRankings.ts already does via getLeaguePitcherRolePools) as ONE
 * pooled, shrunk outcome vector — v1's deliberate "who's actually on the
 * mound doesn't matter, just what environment the bullpen creates" scope
 * (see docs/mlb-sim-engine-plan.md §4; per-reliever modeling is a disclosed
 * v2, not attempted here). Counts are pooled across every reliever on the
 * roster before shrinking, not averaged per-pitcher-then-combined — a
 * team's 400 relief innings are one bigger, more trustworthy sample than
 * nine separate small ones.
 */
export async function computeBullpenOutcomeVector(teamId: number, season: number, leagueRates: OutcomeVector): Promise<OutcomeVector> {
  const pools = await getLeaguePitcherRolePools(season);
  const relievers = [...pools.relievers, ...pools.closers].filter((p) => p.raw.teamId === teamId);
  if (relievers.length === 0) return leagueRates;

  const logsById = await getPeopleWithGameLogs(relievers.map((p) => p.raw.personId), 'pitching', season);
  let pooled = makeOutcomeVector({});
  for (const p of relievers) {
    const person = logsById.get(p.raw.personId);
    if (!person) continue;
    const counts = pitcherOutcomeCounts(person.gameLog);
    for (const key of Object.keys(pooled) as (keyof OutcomeVector)[]) pooled[key] += counts[key];
  }
  return dirichletShrunkVector(pooled, leagueRates);
}

/**
 * A starter's own average innings/start this season — the bullpen handoff
 * trigger (see simEngine.ts's makeStarterBullpenStream). Falls back to a
 * neutral 5.0 (a reasonable modern-era average) when the pitcher isn't found
 * in the role pool at all (e.g. a rookie with too few starts to classify) —
 * same graceful-default convention used throughout this codebase.
 */
export async function getStarterInningsPerStart(personId: number, season: number): Promise<number> {
  const pools = await getLeaguePitcherRolePools(season);
  const starter = pools.starters.find((p) => p.raw.personId === personId);
  if (!starter || starter.raw.gamesStarted <= 0) return 5.0;
  return starter.raw.inningsPitched / starter.raw.gamesStarted;
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
