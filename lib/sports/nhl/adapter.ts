/**
 * NHL adapter — builds a `SportSnapshot` directly from real `prop_odds`
 * rows, same architecture as CFB's/NBA's/soccer's adapter.
 *
 * Real market keys are NOT yet confirmed against a live `prop_odds` row
 * (same "needs a Render deploy first" situation as NBA — see the Python
 * backend commit). `MARKET_META` uses the standard kebab-case convention:
 * goals, assists, points, shots-on-goal, hits, blocked-shots (skaters),
 * saves, goals-against (goalies) — a reasoned guess, not verified live.
 *
 * Real per-game history (`HISTORY_FIELD`) is genuinely more reliable here
 * than CFB's/NBA's: NHL's own roster and boxscore APIs share the exact
 * same real numeric player id space (confirmed live — nhle.ts's header),
 * so resolution is a direct id lookup, no fuzzy name matching needed at
 * all — subjectId is `nhl:{playerId}` end to end.
 */

import type { HistoryEntry, PickCandidate, SportSnapshot, SubjectSummary } from '@/lib/core/types';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import {
  currentNhlSeason,
  fetchAllTeams,
  fetchTeamSeasonSchedule,
  fetchBoxscore,
  isNhlGameCompleted,
  type NhlBoxscore,
} from './nhle';

const MARKET_META: Record<string, { label: string }> = {
  goals: { label: 'Goals' },
  assists: { label: 'Assists' },
  points: { label: 'Points' },
  'shots-on-goal': { label: 'Shots on Goal' },
  hits: { label: 'Hits' },
  'blocked-shots': { label: 'Blocked Shots' },
  saves: { label: 'Saves' },
  'goals-against': { label: 'Goals Against' },
};

function bestRow(rows: PropOddsRow[], side: string): PropOddsRow | null {
  const matching = rows.filter((r) => r.side === side);
  if (matching.length === 0) return null;
  return matching.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best), matching[0]);
}

interface NhlMatchStat {
  gameId: string;
  date: string;
  opponent: string;
  isHome: boolean;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  hits: number;
  blockedShots: number;
  saves: number;
  goalsAgainst: number;
}

const HISTORY_FIELD: Record<string, (m: NhlMatchStat) => number> = {
  goals: (m) => m.goals,
  assists: (m) => m.assists,
  points: (m) => m.points,
  'shots-on-goal': (m) => m.shots,
  hits: (m) => m.hits,
  'blocked-shots': (m) => m.blockedShots,
  saves: (m) => m.saves,
  'goals-against': (m) => m.goalsAgainst,
};

function toHistoryEntries(matches: NhlMatchStat[], marketKey: string, startingLine: number): HistoryEntry[] {
  const field = HISTORY_FIELD[marketKey];
  if (!field) return [];
  return matches.map((m, i) => {
    const value = field(m);
    return {
      period: i + 1,
      result: String(value),
      category: value > startingLine ? 'over' : 'under',
      periodLabel: `${m.isHome ? 'vs' : '@'} ${m.opponent}`,
      raw: { opponentAbbr: m.opponent, ...m },
    } satisfies HistoryEntry;
  });
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Real per-game history for one player, resolved by real player id within one team's completed games — pure, no fuzzy matching (see file header). */
function matchesForPlayer(games: Array<{ gameId: string; date: string; homeAbbr: string; awayAbbr: string }>, boxscores: Map<string, NhlBoxscore>, playerId: number, teamAbbr: string): NhlMatchStat[] {
  const matches: NhlMatchStat[] = [];
  for (const game of games) {
    const box = boxscores.get(game.gameId);
    if (!box) continue;
    const isHome = box.homeAbbr === teamAbbr;
    const opponent = isHome ? box.awayAbbr : box.homeAbbr;
    const skater = box.skatersByTeam[teamAbbr]?.find((s) => s.playerId === playerId);
    const goalie = box.goaliesByTeam[teamAbbr]?.find((g) => g.playerId === playerId);
    if (!skater && !goalie) continue;
    matches.push({
      gameId: game.gameId,
      date: game.date,
      opponent,
      isHome,
      goals: skater?.goals ?? 0,
      assists: skater?.assists ?? 0,
      points: skater?.points ?? 0,
      shots: skater?.shots ?? 0,
      hits: skater?.hits ?? 0,
      blockedShots: skater?.blockedShots ?? 0,
      saves: goalie?.saves ?? 0,
      goalsAgainst: goalie?.goalsAgainst ?? 0,
    });
  }
  return matches;
}

/**
 * Real per-game history, mutating candidates in place. Grouped by real
 * team (subjectMeta.team) so each team's real season schedule + box
 * scores are fetched once, shared across every one of that team's
 * subjects — same batching lesson as CFB's/ASA's rebuild.
 */
async function attachRealHistory(candidates: PickCandidate[]): Promise<void> {
  const eligibleSubjects = new Map<string, PickCandidate[]>();
  for (const c of candidates) {
    if (!HISTORY_FIELD[c.dimension]) continue;
    const bucket = eligibleSubjects.get(c.subjectId) ?? [];
    bucket.push(c);
    eligibleSubjects.set(c.subjectId, bucket);
  }
  if (eligibleSubjects.size === 0) return;

  const subjectsByTeam = new Map<string, Array<[string, PickCandidate[]]>>();
  for (const entry of eligibleSubjects) {
    const [, subjectCandidates] = entry;
    const teamAbbr = (subjectCandidates[0].subjectMeta as Record<string, unknown> | undefined)?.team as string | undefined;
    if (!teamAbbr) continue;
    const bucket = subjectsByTeam.get(teamAbbr) ?? [];
    bucket.push(entry);
    subjectsByTeam.set(teamAbbr, bucket);
  }

  const season = currentNhlSeason();

  await mapWithConcurrency([...subjectsByTeam.entries()], 6, async ([teamAbbr, teamSubjects]) => {
    let games;
    try {
      games = (await fetchTeamSeasonSchedule(teamAbbr, season)).filter((g) => isNhlGameCompleted(g.gameState));
    } catch {
      return;
    }
    if (games.length === 0) return;

    const boxscores = new Map<string, NhlBoxscore>();
    await Promise.all(
      games.map(async (game) => {
        const box = await fetchBoxscore(game.gameId);
        if (box) boxscores.set(game.gameId, box);
      }),
    );

    for (const [subjectId, subjectCandidates] of teamSubjects) {
      const playerId = Number(subjectId.split(':')[1]);
      if (!Number.isFinite(playerId)) continue;
      const matches = matchesForPlayer(games, boxscores, playerId, teamAbbr);
      if (matches.length === 0) continue;

      for (const candidate of subjectCandidates) {
        const startingLine = candidate.line ?? 0.5;
        const entries = toHistoryEntries(matches, candidate.dimension, startingLine);
        if (entries.length === 0) continue;
        candidate.history = entries;
        candidate.sampleSize = entries.length;
        candidate.consistent = entries.every((e) => e.category === entries[0].category);
      }
    }
  });
}

export async function buildNhlSnapshot(): Promise<SportSnapshot> {
  const [games, teams] = await Promise.all([loadGameContextsForSport('nhl'), fetchAllTeams()]);
  const logoByAbbr = new Map(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));
  const teamLogoUrl = (abbr: string | undefined): string | undefined => (abbr ? logoByAbbr.get(abbr) : undefined);
  const candidates: PickCandidate[] = [];
  const subjectsMap = new Map<string, SubjectSummary>();
  const warnings: string[] = [];

  for (const game of games) {
    const rows = await readPropOddsForGame(game.gameId);
    if (rows.length === 0) continue;

    const rowsBySubjectMarket = new Map<string, PropOddsRow[]>();
    for (const row of rows) {
      const key = `${row.subjectId}|${row.marketKey}`;
      const bucket = rowsBySubjectMarket.get(key) ?? [];
      bucket.push(row);
      rowsBySubjectMarket.set(key, bucket);
    }

    const rosterBySubjectId = new Map(game.roster.map((r) => [r.subjectId, r]));

    for (const [key, marketRows] of rowsBySubjectMarket) {
      const [subjectId, marketKey] = key.split('|');
      const meta = MARKET_META[marketKey];
      if (!meta) {
        warnings.push(`Unrecognized NHL market key "${marketKey}" — skipped.`);
        continue;
      }
      const rosterEntry = rosterBySubjectId.get(subjectId);
      const subjectName = rosterEntry?.subjectName ?? marketRows[0].subjectName;
      const teamAbbr = rosterEntry?.teamAbbr;
      const isHome = teamAbbr === game.homeAbbr;
      const opponentAbbr = teamAbbr ? (isHome ? game.awayAbbr : game.homeAbbr) : undefined;

      const best = bestRow(marketRows, 'over') ?? marketRows[0];

      candidates.push({
        sport: 'nhl',
        subjectId,
        subjectName,
        subjectMeta: {
          team: teamAbbr,
          opponent: opponentAbbr,
          isHome,
          headshotUrl: rosterEntry?.headshotUrl,
          teamLogoUrl: teamLogoUrl(teamAbbr),
          opponentLogoUrl: teamLogoUrl(opponentAbbr),
          gamePk: game.gameId,
        },
        dimension: marketKey,
        dimensionLabel: meta.label,
        category: 'over',
        categoryLabel: 'Over',
        line: best.line ?? undefined,
        history: [],
        consistent: false,
        sampleSize: 0,
        liveState: liveStateFor(game.gameDate),
        odds: { americanOdds: String(best.americanOdds), source: 'odds-api', capturedAt: best.fetchedAt },
      });

      if (!subjectsMap.has(subjectId)) {
        subjectsMap.set(subjectId, {
          subjectId,
          subjectName,
          meta: {
            headshotUrl: rosterEntry?.headshotUrl,
            teamLogoUrl: teamLogoUrl(teamAbbr),
            opponentLogoUrl: teamLogoUrl(opponentAbbr),
            position: rosterEntry?.position,
          },
        });
      }
    }
  }

  await attachRealHistory(candidates);

  return {
    sport: 'nhl',
    eventName: 'NHL',
    eventDetail: null,
    status: 'pre',
    candidates,
    subjects: [...subjectsMap.values()],
    context: {
      other: {
        games: games.map((g) => ({
          gamePk: g.gameId,
          matchup: `${g.awayAbbr} @ ${g.homeAbbr}`,
          awayTeamName: g.awayTeamName,
          homeTeamName: g.homeTeamName,
          firstPitch: g.gameDate,
        })),
      },
    },
    warnings: [...new Set(warnings)],
    fetchedAt: new Date().toISOString(),
  };
}

function liveStateFor(gameDate: string) {
  const kickoff = Date.parse(gameDate);
  const now = Date.now();
  if (!Number.isFinite(kickoff)) {
    return { status: 'unknown' as const, distanceToSubject: null, distanceUnit: 'games' as const, etaMinutes: null, etaConfidence: null };
  }
  if (now < kickoff) {
    const hoursOut = Math.round((kickoff - now) / 3_600_000);
    return { status: 'pre' as const, distanceToSubject: 1, distanceUnit: 'games' as const, etaMinutes: hoursOut * 60, etaConfidence: 'measured' as const };
  }
  return { status: 'done' as const, distanceToSubject: 0, distanceUnit: 'games' as const, etaMinutes: null, etaConfidence: null };
}
