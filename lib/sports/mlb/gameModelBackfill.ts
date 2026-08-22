/**
 * G5 — historical backfill for the game-level (moneyline) model, walking
 * every game of the season in chronological order once, maintaining a
 * running per-team runs-scored/allowed accumulator so each game is predicted
 * using only what happened *before* it — no lookahead.
 *
 * Deliberately simpler than the live model: no starting-pitcher blend. That
 * needs reliable per-game historical starter data at scale, which isn't
 * cheaply available the way team results are — a real, disclosed scoping
 * difference from gameModel.ts's live computation, same spirit as the
 * player backfill skipping matchup-adjustment fitting. Home-field edge is
 * kept, since it costs nothing extra (just knowing which team was home).
 */

import { getScheduleRange, easternDate } from './statsapi';
import { pythagoreanWinPct, log5, poissonOverProbability } from './gameModel';
import { writeBackfill, readParkFactors, getHistoricalOdds, type BackfillEntry } from '../../db/client';

const HOME_FIELD_EDGE = 0.04;
const WARMUP_GAMES = 15;

interface TeamAccumulator {
  runsFor: number;
  runsAgainst: number;
  games: number;
}

function winProb(acc: TeamAccumulator): number {
  return pythagoreanWinPct(acc.runsFor / acc.games, acc.runsAgainst / acc.games);
}

export interface GameBackfillSummary {
  gamesConsidered: number;
  rowsWritten: number;
}

export async function backfillGameModel(season: number): Promise<GameBackfillSummary> {
  const today = easternDate();
  const games = await getScheduleRange(`${season}-03-01`, today);

  // Chronological, finals only, one row per completed game.
  const finals = games
    .filter((g) => g.abstractState === 'Final' && g.teams.home.score != null && g.teams.away.score != null)
    .sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1));

  const accByTeam = new Map<number, TeamAccumulator>();
  const entries: BackfillEntry[] = [];

  for (const game of finals) {
    const homeId = game.teams.home.team.id;
    const awayId = game.teams.away.team.id;
    const homeRuns = game.teams.home.score as number;
    const awayRuns = game.teams.away.score as number;

    const homeAcc = accByTeam.get(homeId);
    const awayAcc = accByTeam.get(awayId);

    if (homeAcc && awayAcc && homeAcc.games >= WARMUP_GAMES && awayAcc.games >= WARMUP_GAMES) {
      const homeWinPct = winProb(homeAcc);
      const awayWinPct = winProb(awayAcc);
      const rawHomeProb = log5(homeWinPct, awayWinPct);
      const homeModelProb = Math.min(0.97, Math.max(0.03, rawHomeProb + HOME_FIELD_EDGE));
      const awayModelProb = 1 - homeModelProb;
      const homeWon = homeRuns > awayRuns;

      entries.push({
        sport: 'mlb',
        subjectId: `team-${homeId}`,
        subjectName: game.teams.home.team.name,
        dimension: 'moneyline',
        category: 'win',
        marketKey: null,
        line: 0, // NOT NULL in the DB's UNIQUE key context — 0 is a harmless placeholder, moneyline has no real line
        gameId: String(game.gamePk),
        sampleSize: Math.min(homeAcc.games, awayAcc.games),
        modelProb: homeModelProb,
        outcome: homeWon ? 'win' : 'loss',
        actualValue: homeWon ? 1 : 0,
        surfacedAt: game.gameDate,
      });
      entries.push({
        sport: 'mlb',
        subjectId: `team-${awayId}`,
        subjectName: game.teams.away.team.name,
        dimension: 'moneyline',
        category: 'win',
        marketKey: null,
        line: 0,
        gameId: String(game.gamePk),
        sampleSize: Math.min(homeAcc.games, awayAcc.games),
        modelProb: awayModelProb,
        outcome: homeWon ? 'loss' : 'win',
        actualValue: homeWon ? 0 : 1,
        surfacedAt: game.gameDate,
      });
    }

    const home = homeAcc ?? { runsFor: 0, runsAgainst: 0, games: 0 };
    home.runsFor += homeRuns;
    home.runsAgainst += awayRuns;
    home.games += 1;
    accByTeam.set(homeId, home);

    const away = awayAcc ?? { runsFor: 0, runsAgainst: 0, games: 0 };
    away.runsFor += awayRuns;
    away.runsAgainst += homeRuns;
    away.games += 1;
    accByTeam.set(awayId, away);
  }

  const rowsWritten = await writeBackfill(entries);
  return { gamesConsidered: finals.length, rowsWritten };
}

/**
 * Total (O/U) counterpart to backfillGameModel — same walk-forward, no-
 * lookahead discipline, but graded against a REAL historical total line
 * (historical_odds) rather than the current season's own posted lines: the
 * current in-progress season has no historical_odds coverage (that table is
 * built from offline-ingested past-season files, see
 * historicalOddsIngest.ts), so unlike backfillGameModel this only produces
 * rows for seasons that were actually ingested. A game with no matching
 * historical_odds row, or an exact push (total === line), is skipped — there
 * is no real over/under decision to grade. One row per game (not one per
 * side, unlike moneyline) — matches logGameTotalPredictions's live-path
 * convention exactly (category always 'over', subject `game-<gamePk>`) so
 * backfilled and live-graded rows read identically in calibration.
 */
export async function backfillTotalModel(season: number): Promise<GameBackfillSummary> {
  const rangeEnd = `${season}-11-30`;
  const games = await getScheduleRange(`${season}-03-01`, rangeEnd);

  const finals = games
    .filter((g) => g.abstractState === 'Final' && g.teams.home.score != null && g.teams.away.score != null)
    .sort((a, b) => (a.gameDate < b.gameDate ? -1 : 1));

  const parkFactorByVenue = new Map((await readParkFactors(season)).map((r) => [r.venueId, r.factor]));
  const accByTeam = new Map<number, TeamAccumulator>();
  const entries: BackfillEntry[] = [];

  for (const game of finals) {
    const homeId = game.teams.home.team.id;
    const awayId = game.teams.away.team.id;
    const homeRuns = game.teams.home.score as number;
    const awayRuns = game.teams.away.score as number;

    const homeAcc = accByTeam.get(homeId);
    const awayAcc = accByTeam.get(awayId);

    if (homeAcc && awayAcc && homeAcc.games >= WARMUP_GAMES && awayAcc.games >= WARMUP_GAMES) {
      const gameDateEastern = easternDate(new Date(game.gameDate));
      const odds = await getHistoricalOdds(season, gameDateEastern, homeId, awayId);
      const actualTotal = homeRuns + awayRuns;

      if (odds?.totalLine != null && actualTotal !== odds.totalLine) {
        const pf = game.venue?.id != null ? (parkFactorByVenue.get(game.venue.id) ?? 1) : 1;
        const expectedTotalRaw = (homeAcc.runsFor / homeAcc.games + awayAcc.runsFor / awayAcc.games) * pf;
        const overProb = poissonOverProbability(expectedTotalRaw, odds.totalLine);
        const over = actualTotal > odds.totalLine;

        entries.push({
          sport: 'mlb',
          subjectId: `game-${game.gamePk}`,
          subjectName: 'Total',
          dimension: 'total',
          category: 'over',
          marketKey: null,
          line: odds.totalLine,
          gameId: String(game.gamePk),
          sampleSize: Math.min(homeAcc.games, awayAcc.games),
          modelProb: overProb,
          outcome: over ? 'win' : 'loss',
          actualValue: actualTotal,
          surfacedAt: game.gameDate,
        });
      }
    }

    const home = homeAcc ?? { runsFor: 0, runsAgainst: 0, games: 0 };
    home.runsFor += homeRuns;
    home.runsAgainst += awayRuns;
    home.games += 1;
    accByTeam.set(homeId, home);

    const away = awayAcc ?? { runsFor: 0, runsAgainst: 0, games: 0 };
    away.runsFor += awayRuns;
    away.runsAgainst += homeRuns;
    away.games += 1;
    accByTeam.set(awayId, away);
  }

  const rowsWritten = await writeBackfill(entries);
  return { gamesConsidered: finals.length, rowsWritten };
}
