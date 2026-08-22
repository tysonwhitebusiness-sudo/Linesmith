/**
 * Phase C.0.4 — historical model calibration, without waiting for the live
 * season to accumulate day by day.
 *
 * This is deliberately narrower than live candidate generation: it tests
 * "does a plain trailing hit-rate predict the over, honestly" — no matchup
 * adjustment, no Phase A floor, no opponent-rank shift. Those all depend on
 * context that's expensive to reconstruct point-in-time for arbitrary past
 * dates. What this *can* answer today, for free, from data already fetched:
 * is the raw rate itself calibrated, or does it over/under-predict at the
 * extremes? That's real evidence, and it's the foundation Phase C.1's prior
 * gets built on — just not the whole model.
 *
 * No market price data is used or needed here — see the session notes on
 * why historical odds don't exist for player props. This only ever compares
 * a model probability to a real outcome, not to a market price.
 */

import { getPeopleWithGameLogs, type GameLogSplit } from '../../sports/mlb/statsapi';
import { STAT_MARKET_BY_DIMENSION, PITCHER_MARKET_DIMENSIONS } from '../../sports/mlb/adapter';
import { listKnownSubjects, writeBackfill, type BackfillEntry } from '../../db/client';

/** A trailing rate needs this many prior games before it's worth recording — same instinct as Phase A's sample floor. */
const WARMUP = 10;
/** Matches the live app's L15 window, so the backfilled signal is testing the same horizon Scan actually shows. */
const TRAILING_WINDOW = 15;

interface BackfillMarketDef {
  dimension: string;
  marketKey: string | null;
  line: number;
  isPitcher: boolean;
  valueOf: (stat: Record<string, any>) => number;
  eligible: (stat: Record<string, any>) => boolean;
}

const battingEligible = (s: Record<string, any>) => Number(s.atBats ?? 0) > 0 || Number(s.plateAppearances ?? 0) > 0;
const pitchingEligible = (s: Record<string, any>) => Number(s.gamesStarted ?? 0) > 0;

function marketDefs(): BackfillMarketDef[] {
  const defs: BackfillMarketDef[] = [
    { dimension: 'hit-in-game', marketKey: 'hits', line: 0.5, isPitcher: false, valueOf: (s) => Number(s.hits ?? 0), eligible: battingEligible },
  ];
  for (const [dimension, def] of Object.entries(STAT_MARKET_BY_DIMENSION)) {
    const isPitcher = PITCHER_MARKET_DIMENSIONS.has(dimension);
    defs.push({
      dimension,
      marketKey: dimension,
      line: def.line,
      isPitcher,
      valueOf: def.valueOf,
      eligible: isPitcher ? pitchingEligible : battingEligible,
    });
  }
  return defs;
}

/** Walk-forward: predict game i from games strictly before it, then grade against what actually happened at i. */
function backfillOnePlayerMarket(
  subjectId: string,
  subjectName: string,
  gameLog: GameLogSplit[],
  def: BackfillMarketDef,
): BackfillEntry[] {
  const eligible = gameLog.filter((split) => def.eligible(split.stat ?? {}));
  if (eligible.length < WARMUP + 1) return [];

  const out: BackfillEntry[] = [];
  for (let i = WARMUP; i < eligible.length; i++) {
    const windowStart = Math.max(0, i - TRAILING_WINDOW);
    const priorGames = eligible.slice(windowStart, i);
    if (priorGames.length < WARMUP) continue;

    const priorOvers = priorGames.filter((split) => def.valueOf(split.stat ?? {}) > def.line).length;
    const modelProb = priorOvers / priorGames.length;

    const target = eligible[i];
    if (!target.gamePk) continue;
    const actualValue = def.valueOf(target.stat ?? {});
    const won = actualValue > def.line;

    out.push({
      sport: 'mlb',
      subjectId,
      subjectName,
      dimension: def.dimension,
      category: 'over',
      marketKey: def.marketKey,
      line: def.line,
      gameId: String(target.gamePk),
      sampleSize: priorGames.length,
      modelProb,
      outcome: won ? 'win' : 'loss',
      actualValue,
      surfacedAt: target.date ? `${target.date}T00:00:00.000Z` : new Date().toISOString(),
    });
  }
  return out;
}

export interface BackfillSummary {
  subjectsConsidered: number;
  rowsWritten: number;
}

export async function backfillModelCalibration(season: number): Promise<BackfillSummary> {
  const subjectIds = (await listKnownSubjects('mlb'))
    .map(Number)
    .filter((id) => Number.isFinite(id));
  if (subjectIds.length === 0) return { subjectsConsidered: 0, rowsWritten: 0 };

  const [hitting, pitching] = await Promise.all([
    getPeopleWithGameLogs(subjectIds, 'hitting', season),
    getPeopleWithGameLogs(subjectIds, 'pitching', season),
  ]);

  const defs = marketDefs();
  let rowsWritten = 0;

  for (const id of subjectIds) {
    const hittingPerson = hitting.get(id);
    const pitchingPerson = pitching.get(id);

    for (const def of defs) {
      const person = def.isPitcher ? pitchingPerson : hittingPerson;
      if (!person || person.gameLog.length === 0) continue;
      const entries = backfillOnePlayerMarket(String(id), person.fullName, person.gameLog, def);
      if (entries.length > 0) rowsWritten += await writeBackfill(entries);
    }
  }

  return { subjectsConsidered: subjectIds.length, rowsWritten };
}
