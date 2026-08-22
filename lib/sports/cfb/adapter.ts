/**
 * CFB adapter — builds a `SportSnapshot` directly from real `prop_odds`
 * rows, same shape as soccer's adapter (see that file's header) rather
 * than MLB's/NFL's history-engine pattern: CFB has no nflverse-equivalent
 * rich season-stats source wired yet, only real per-game box scores via
 * CollegeFootballData.com (cfbd.ts).
 *
 * Real market keys confirmed live in `prop_odds` (2026-08-22): kicking-
 * points, longest-completion, longest-reception, longest-rush, passing-
 * yards, receiving-yards, receptions, rushing-yards — all real yardage/
 * counting markets (unlike soccer, CFB has no binary yes/no markets).
 * CFBD's real per-game box score covers 7 of these 8 (`HISTORY_FIELD`);
 * `longest-completion` has no CFBD field (passing category has no LONG
 * type — confirmed live) and stays `history: []`, the same honest gap
 * soccer's unsupported markets have.
 */

import type { HistoryEntry, PickCandidate, SportSnapshot, SubjectSummary } from '@/lib/core/types';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { cfbTeamLogoByAbbr, fetchAllTeams } from './espn';
import { currentCfbdSeason, matchCfbdTeamName, fetchFbsTeamNames, loadCfbdTeamContext, cfbdPlayerMatchesFromContext, type CfbdMatchStat } from './cfbd';

const MARKET_META: Record<string, { label: string }> = {
  'passing-yards': { label: 'Passing Yards' },
  'rushing-yards': { label: 'Rushing Yards' },
  'receiving-yards': { label: 'Receiving Yards' },
  receptions: { label: 'Receptions' },
  'longest-rush': { label: 'Longest Rush' },
  'longest-reception': { label: 'Longest Reception' },
  'longest-completion': { label: 'Longest Completion' },
  'kicking-points': { label: 'Kicking Points' },
};

function bestRow(rows: PropOddsRow[], side: string): PropOddsRow | null {
  const matching = rows.filter((r) => r.side === side);
  if (matching.length === 0) return null;
  return matching.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best), matching[0]);
}

/** Which markets have a real per-game field in CFBD's box score, and how to read it — `longest-completion` has none (see file header) and stays out of this map. */
const HISTORY_FIELD: Record<string, (m: CfbdMatchStat) => number> = {
  'passing-yards': (m) => m.passingYards,
  'rushing-yards': (m) => m.rushingYards,
  'receiving-yards': (m) => m.receivingYards,
  receptions: (m) => m.receptions,
  'longest-rush': (m) => m.longestRush,
  'longest-reception': (m) => m.longestReception,
  'kicking-points': (m) => m.kickingPoints,
};

function toHistoryEntries(matches: CfbdMatchStat[], marketKey: string, startingLine: number): HistoryEntry[] {
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

/** Same fixed-concurrency guard soccer's adapter uses — CFBD is a free, real, rate-sensitive API. */
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

/**
 * Real per-game history, mutating candidates in place. Grouped by real
 * TEAM (not by subject) so each of a team's ~15-25 rostered skill players
 * shares one `loadCfbdTeamContext` call instead of each re-resolving the
 * team name and re-fetching that team's games/box-scores — same lesson
 * ASA's per-subject-vs-per-team rebuild already taught this codebase (see
 * americanSocceranalysis.ts's `loadAsaSeasonContext` comment).
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

  const season = currentCfbdSeason();
  const [teams, fbsNames] = await Promise.all([fetchAllTeams(), fetchFbsTeamNames()]);
  const cfbdNameByAbbr = new Map<string, string>();
  for (const t of teams) {
    const cfbdName = matchCfbdTeamName(t.location, fbsNames);
    if (cfbdName) cfbdNameByAbbr.set(t.abbreviation, cfbdName);
  }

  const subjectsByTeam = new Map<string, Array<[string, PickCandidate[]]>>();
  for (const entry of eligibleSubjects) {
    const [, subjectCandidates] = entry;
    const teamAbbr = (subjectCandidates[0].subjectMeta as Record<string, unknown> | undefined)?.team as string | undefined;
    if (!teamAbbr) continue;
    const bucket = subjectsByTeam.get(teamAbbr) ?? [];
    bucket.push(entry);
    subjectsByTeam.set(teamAbbr, bucket);
  }

  await mapWithConcurrency([...subjectsByTeam.entries()], 6, async ([teamAbbr, teamSubjects]) => {
    const cfbdTeamName = cfbdNameByAbbr.get(teamAbbr);
    if (!cfbdTeamName) return;
    let context;
    try {
      context = await loadCfbdTeamContext(cfbdTeamName, season);
    } catch {
      // Real-world CFBD hiccup for this one team — its subjects simply keep
      // `history: []` rather than taking the whole rebuild down.
      return;
    }
    if (context.games.length === 0) return;

    for (const [, subjectCandidates] of teamSubjects) {
      const subjectName = subjectCandidates[0].subjectName;
      const matches = cfbdPlayerMatchesFromContext(context, subjectName);
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

export async function buildCfbSnapshot(): Promise<SportSnapshot> {
  const [games, logoByAbbr] = await Promise.all([loadGameContextsForSport('cfb'), cfbTeamLogoByAbbr()]);
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
        warnings.push(`Unrecognized CFB market key "${marketKey}" — skipped.`);
        continue;
      }
      const rosterEntry = rosterBySubjectId.get(subjectId);
      const subjectName = rosterEntry?.subjectName ?? marketRows[0].subjectName;
      const teamAbbr = rosterEntry?.teamAbbr;
      const isHome = teamAbbr === game.homeAbbr;
      const opponentAbbr = teamAbbr ? (isHome ? game.awayAbbr : game.homeAbbr) : undefined;

      const best = bestRow(marketRows, 'over') ?? marketRows[0];

      candidates.push({
        sport: 'cfb',
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
    sport: 'cfb',
    eventName: 'College Football',
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
