/**
 * NBA adapter — builds a `SportSnapshot` directly from real `prop_odds`
 * rows, same architecture as CFB's/soccer's adapter (no rich season-stats
 * source wired for candidate construction yet).
 *
 * Real market keys are NOT yet confirmed against a live `prop_odds` row
 * the way CFB's were (CFB already had a running Python job with real data
 * in the table before this session started; NBA's job was built THIS
 * session — see the Python backend commit — and needs a Render deploy
 * before it ever writes a real row). `MARKET_META` below uses the
 * standard kebab-case convention every other sport's real market keys
 * follow (points, rebounds, assists, three-pointers-made, steals, blocks,
 * turnovers, and the real combo props books actually offer: points-
 * rebounds-assists, points-rebounds, points-assists, rebounds-assists) —
 * a reasoned guess, not verified live. Real per-game history (`HISTORY_FIELD`)
 * covers all of these from sportsdataverse.ts's real, confirmed-live box
 * score data, so once real market_key values are observed in production,
 * fixing this map (if any guess was wrong) doesn't touch the history layer
 * at all.
 */

import type { HistoryEntry, PickCandidate, SportSnapshot, SubjectSummary } from '@/lib/core/types';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { nbaTeamLogoByAbbr } from './espn';
import { currentNbaSeason, loadNbaSeasonContext, matchNbaPlayer, nbaPlayerMatches, type NbaMatchStat } from './sportsdataverse';

const MARKET_META: Record<string, { label: string }> = {
  points: { label: 'Points' },
  rebounds: { label: 'Rebounds' },
  assists: { label: 'Assists' },
  'three-pointers-made': { label: '3-Pointers Made' },
  steals: { label: 'Steals' },
  blocks: { label: 'Blocks' },
  turnovers: { label: 'Turnovers' },
  'points-rebounds-assists': { label: 'Pts + Reb + Ast' },
  'points-rebounds': { label: 'Pts + Reb' },
  'points-assists': { label: 'Pts + Ast' },
  'rebounds-assists': { label: 'Reb + Ast' },
};

function bestRow(rows: PropOddsRow[], side: string): PropOddsRow | null {
  const matching = rows.filter((r) => r.side === side);
  if (matching.length === 0) return null;
  return matching.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best), matching[0]);
}

const HISTORY_FIELD: Record<string, (m: NbaMatchStat) => number> = {
  points: (m) => m.points,
  rebounds: (m) => m.rebounds,
  assists: (m) => m.assists,
  'three-pointers-made': (m) => m.threesMade,
  steals: (m) => m.steals,
  blocks: (m) => m.blocks,
  turnovers: (m) => m.turnovers,
  'points-rebounds-assists': (m) => m.points + m.rebounds + m.assists,
  'points-rebounds': (m) => m.points + m.rebounds,
  'points-assists': (m) => m.points + m.assists,
  'rebounds-assists': (m) => m.rebounds + m.assists,
};

function toHistoryEntries(matches: NbaMatchStat[], marketKey: string, startingLine: number): HistoryEntry[] {
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

/**
 * Real per-game history, mutating candidates in place. The whole season's
 * box scores are loaded ONCE (sportsdataverse.ts's `loadNbaSeasonContext`
 * is a single league-wide file, not per-team like CFB) — every subject's
 * resolution below is then pure in-memory matching, no per-subject I/O
 * at all, an even simpler shape than CFB's per-team batching needed.
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

  let context;
  try {
    context = await loadNbaSeasonContext(currentNbaSeason());
  } catch {
    return;
  }
  if (context.rowsByAthleteId.size === 0) return;

  for (const [, subjectCandidates] of eligibleSubjects) {
    const subjectName = subjectCandidates[0].subjectName;
    const athleteId = matchNbaPlayer(context, subjectName);
    if (!athleteId) continue;
    const matches = nbaPlayerMatches(context, athleteId);
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
}

export async function buildNbaSnapshot(): Promise<SportSnapshot> {
  const [games, logoByAbbr] = await Promise.all([loadGameContextsForSport('nba'), nbaTeamLogoByAbbr()]);
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
        warnings.push(`Unrecognized NBA market key "${marketKey}" — skipped.`);
        continue;
      }
      const rosterEntry = rosterBySubjectId.get(subjectId);
      const subjectName = rosterEntry?.subjectName ?? marketRows[0].subjectName;
      const teamAbbr = rosterEntry?.teamAbbr;
      const isHome = teamAbbr === game.homeAbbr;
      const opponentAbbr = teamAbbr ? (isHome ? game.awayAbbr : game.homeAbbr) : undefined;

      const best = bestRow(marketRows, 'over') ?? marketRows[0];

      candidates.push({
        sport: 'nba',
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
    sport: 'nba',
    eventName: 'NBA',
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
