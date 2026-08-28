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
import { subsetWindow, shortDate } from '@/lib/core/windowedStat';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { fetchSeasonStatus } from '@/lib/sports/multiSport/teamSportEspn';
import {
  currentNhlSeason,
  fetchAllTeams,
  fetchTeamRoster,
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

export interface NhlMatchStat {
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

function toHistoryEntries(
  matches: NhlMatchStat[],
  marketKey: string,
  startingLine: number,
  teamLogoUrl?: (abbr: string) => string | undefined,
): HistoryEntry[] {
  const field = HISTORY_FIELD[marketKey];
  if (!field) return [];
  return matches.map((m, i) => {
    const value = field(m);
    return {
      period: i + 1,
      result: String(value),
      category: value > startingLine ? 'over' : 'under',
      periodLabel: `${shortDate(m.date)} ${m.isHome ? 'vs' : '@'} ${m.opponent}`,
      raw: { opponentAbbr: m.opponent, opponentLogoUrl: teamLogoUrl?.(m.opponent), ...m },
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

/**
 * Real per-game history for one player, resolved by real player id within
 * one team's completed games — pure, no fuzzy matching (see file header).
 * Exported so the Team Detail route can reuse it for real roster
 * season-stats, the same pipeline `attachRealHistory` below already runs
 * per-candidate.
 */
export function matchesForPlayer(games: Array<{ gameId: string; date: string; homeAbbr: string; awayAbbr: string }>, boxscores: Map<string, NhlBoxscore>, playerId: number, teamAbbr: string): NhlMatchStat[] {
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
async function attachRealHistory(candidates: PickCandidate[], teamLogoUrl: (abbr: string | undefined) => string | undefined): Promise<void> {
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

      const seasonStats = {
        games: matches.length,
        goals: matches.reduce((s, m) => s + m.goals, 0),
        assists: matches.reduce((s, m) => s + m.assists, 0),
        points: matches.reduce((s, m) => s + m.points, 0),
        shots: matches.reduce((s, m) => s + m.shots, 0),
        hits: matches.reduce((s, m) => s + m.hits, 0),
        blockedShots: matches.reduce((s, m) => s + m.blockedShots, 0),
        saves: matches.reduce((s, m) => s + m.saves, 0),
        goalsAgainst: matches.reduce((s, m) => s + m.goalsAgainst, 0),
      };

      for (const candidate of subjectCandidates) {
        const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
        meta.seasonStats = seasonStats;
        candidate.subjectMeta = meta;

        const startingLine = candidate.line ?? 0.5;
        const entries = toHistoryEntries(matches, candidate.dimension, startingLine, (abbr) => teamLogoUrl(abbr));
        if (entries.length === 0) continue;
        candidate.history = entries;
        candidate.sampleSize = entries.length;
        candidate.consistent = entries.every((e) => e.category === entries[0].category);

        const opponentAbbr = meta.opponent as string | undefined;
        if (opponentAbbr) {
          candidate.supportingSplits = [
            {
              kind: 'head-to-head',
              label: `vs ${opponentAbbr}`,
              stat: subsetWindow(entries, 'over', (e) => (e.raw as Record<string, unknown> | undefined)?.opponentAbbr === opponentAbbr, { minimum: 1 }),
            },
          ];
        }
      }
    }
  });
}

/**
 * Real fallback for deep off-season — same reasoning as NBA's identical
 * function: `loadGameContextsForSport`'s near-term schedule window finds
 * nothing when the real season is 40+ days out (confirmed live 2026-08-23
 * — NHL preseason doesn't start until Sept 19), so fetch every real
 * team's real roster directly instead of leaving the Players tab empty.
 */
async function attachFullRosterSubjects(subjectsMap: Map<string, SubjectSummary>, teamLogoUrl: (abbr: string | undefined) => string | undefined): Promise<void> {
  const teams = await fetchAllTeams();
  const season = currentNhlSeason();
  // Team-level concurrency capped at 4 (on top of the existing 6-way
  // per-team boxscore cap below) — this path only runs in the real
  // deep-off-season case (see this function's own header), where it now
  // also resolves a real statusLine for every real roster player
  // (2026-08-24), not just identity. Firing all 32 teams' real schedule+
  // boxscore fetches at once would multiply into hundreds of simultaneous
  // NHL API calls — the same real rate-limit failure mode already found
  // and fixed once for a single team (see `fetchPlayerMatchesWithFallback`'s
  // own comment); capping team-level concurrency too keeps this safe.
  await mapWithConcurrency(teams, 4, async (team) => {
    let roster;
    try {
      roster = await fetchTeamRoster(team.abbreviation);
    } catch {
      return;
    }
    for (const p of roster) {
      if (subjectsMap.has(p.subjectId)) continue;
      subjectsMap.set(p.subjectId, {
        subjectId: p.subjectId,
        subjectName: p.fullName,
        meta: { headshotUrl: p.headshotUrl ?? undefined, teamLogoUrl: teamLogoUrl(team.abbreviation), position: p.position ?? undefined, team: team.abbreviation },
      });
    }

    try {
      const completedGames = (await fetchTeamSeasonSchedule(team.abbreviation, season)).filter((g) => isNhlGameCompleted(g.gameState));
      if (completedGames.length === 0) return;
      const boxscores = new Map<string, NhlBoxscore>();
      await mapWithConcurrency(completedGames, 6, async (game) => {
        const box = await fetchBoxscore(game.gameId);
        if (box) boxscores.set(game.gameId, box);
      });
      for (const p of roster) {
        const subject = subjectsMap.get(p.subjectId);
        if (!subject || subject.statusLine) continue;
        const playerId = Number(p.subjectId.split(':')[1]);
        if (!Number.isFinite(playerId)) continue;
        const matches = matchesForPlayer(completedGames, boxscores, playerId, team.abbreviation);
        if (matches.length === 0) continue;
        const goals = matches.reduce((s, m) => s + m.goals, 0);
        const assists = matches.reduce((s, m) => s + m.assists, 0);
        const points = matches.reduce((s, m) => s + m.points, 0);
        const saves = matches.reduce((s, m) => s + m.saves, 0);
        const goalsAgainst = matches.reduce((s, m) => s + m.goalsAgainst, 0);
        subject.statusLine = saves > 0 ? `${saves} SV · ${goalsAgainst} GA` : `${goals} G · ${assists} A · ${points} P`;
      }
    } catch {
      // Real NHL schedule/boxscore hiccup for this one team — its roster
      // subjects keep real identity, just no stat line for this load.
    }
  });
}

const GOALIE_MARKETS = ['saves', 'goals-against'];
const SKATER_MARKETS = ['goals', 'assists', 'points', 'shots-on-goal', 'hits', 'blocked-shots'];

/**
 * Real per-player match history for the synthetic-candidate builder below —
 * falls back to last season's real games when the current NHL season has
 * fewer than 5 completed games (same "no data yet" gap CFB's/soccer's
 * history sources already fall back around via `loadCfbdTeamContext`), so
 * L5/L10/L15 stay real and viewable through the off-season instead of
 * sitting empty until October. Caps at the most recent 25 completed games —
 * plenty for L15/gamelog/chart without paying for a full 82-game boxscore
 * fetch on an on-demand click.
 */
async function fetchPlayerMatchesWithFallback(teamAbbr: string, playerId: number): Promise<NhlMatchStat[]> {
  const season = currentNhlSeason();
  let games = (await fetchTeamSeasonSchedule(teamAbbr, season)).filter((g) => isNhlGameCompleted(g.gameState));
  if (games.length < 5) {
    const startYear = Number(season.slice(0, 4)) - 1;
    const priorSeason = `${startYear}${startYear + 1}`;
    const priorGames = (await fetchTeamSeasonSchedule(teamAbbr, priorSeason)).filter((g) => isNhlGameCompleted(g.gameState));
    if (priorGames.length > games.length) games = priorGames;
  }
  // Real full season — no cap (2026-08-24 fix; this used to throw away
  // everything past the last 25 games for no real reason, understating a
  // full real season's sample the way NBA's/tennis's synthetic builders
  // also did until the same fix). Every game's boxscore is individually
  // cached (`nhl:boxscore:${gameId}`), so this cost is paid once per team
  // per cache window, not once per player viewed.
  const boxscores = new Map<string, NhlBoxscore>();
  // Concurrency-limited — firing every boxscore fetch at once against
  // NHL's real API silently dropped ~60% of them to timeouts/rate-limiting
  // when this was a flat Promise.all (caught live: Auston Matthews' full
  // 82-game 2025-26 season only produced 9 real matches until this fix).
  await mapWithConcurrency(games, 6, async (game) => {
    const box = await fetchBoxscore(game.gameId);
    if (box) boxscores.set(game.gameId, box);
  });
  return matchesForPlayer(games, boxscores, playerId, teamAbbr);
}

/**
 * Real, honestly-priceless candidates for every market this sport tracks —
 * for a player with no real `prop_odds` row (every NHL player right now,
 * pre-season; a depth player any season). `odds` stays undefined so
 * PlayerDetail's existing "Add to slip to record a price" empty state
 * renders (components/PlayerDetail.tsx, the `lineOffset === 0 && !active.odds
 * && onAdd` branch) — the same honest treatment a real market with no
 * current book price already gets. Only the LINE is synthetic (real-history
 * average, user-adjustable via the existing lineOffset stepper); the
 * history/windows/chart underneath are 100% real per-game data.
 */
export async function buildSyntheticPlayerCandidates(
  subjectId: string,
  subjectName: string,
  teamAbbr: string,
  position: string | null,
  headshotUrl: string | undefined,
  teamLogoUrl: string | undefined,
): Promise<PickCandidate[]> {
  const playerId = Number(subjectId.split(':')[1]);
  if (!Number.isFinite(playerId)) return [];
  const [matches, teams] = await Promise.all([fetchPlayerMatchesWithFallback(teamAbbr, playerId), fetchAllTeams()]);
  const opponentLogoByAbbr = new Map(teams.filter((t) => t.logoUrl).map((t) => [t.abbreviation, t.logoUrl as string]));
  const opponentLogoUrl = (abbr: string) => opponentLogoByAbbr.get(abbr);
  const markets = position === 'G' ? GOALIE_MARKETS : SKATER_MARKETS;

  const seasonStats = matches.length
    ? {
        games: matches.length,
        goals: matches.reduce((s, m) => s + m.goals, 0),
        assists: matches.reduce((s, m) => s + m.assists, 0),
        points: matches.reduce((s, m) => s + m.points, 0),
        shots: matches.reduce((s, m) => s + m.shots, 0),
        hits: matches.reduce((s, m) => s + m.hits, 0),
        blockedShots: matches.reduce((s, m) => s + m.blockedShots, 0),
        saves: matches.reduce((s, m) => s + m.saves, 0),
        goalsAgainst: matches.reduce((s, m) => s + m.goalsAgainst, 0),
      }
    : undefined;

  return markets.map((marketKey) => {
    const meta = MARKET_META[marketKey];
    const field = HISTORY_FIELD[marketKey];
    const values = matches.map(field);
    // Real-history average, rounded to the nearest half — a real book never
    // posts a whole-number line (pushes); 0 real history falls back to the
    // same 0.5 floor every genuinely-tracked-but-quiet market already uses.
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const defaultLine = Math.max(0.5, Math.round(avg * 2) / 2);
    const entries = toHistoryEntries(matches, marketKey, defaultLine, opponentLogoUrl);

    return {
      sport: 'nhl',
      subjectId,
      subjectName,
      subjectMeta: { team: teamAbbr, headshotUrl, teamLogoUrl, position: position ?? undefined, seasonStats },
      dimension: marketKey,
      dimensionLabel: meta.label,
      category: 'over',
      categoryLabel: 'Over',
      line: defaultLine,
      history: entries,
      consistent: entries.length > 0 && entries.every((e) => e.category === entries[0].category),
      sampleSize: entries.length,
      liveState: { status: 'unknown', distanceToSubject: null, distanceUnit: 'games', etaMinutes: null, etaConfidence: null },
      odds: undefined,
    } satisfies PickCandidate;
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
    // Real players, browsable regardless of whether a sportsbook has
    // posted a real prop for this game yet — see tennis/adapter.ts's
    // identical fix for the full story on this bug.
    for (const entry of game.roster) {
      if (subjectsMap.has(entry.subjectId)) continue;
      subjectsMap.set(entry.subjectId, {
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        meta: { headshotUrl: entry.headshotUrl, teamLogoUrl: teamLogoUrl(entry.teamAbbr), position: entry.position, team: entry.teamAbbr },
      });
    }

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

  if (subjectsMap.size === 0) {
    await attachFullRosterSubjects(subjectsMap, teamLogoUrl);
  }

  await attachRealHistory(candidates, teamLogoUrl);

  // Real per-player season line for the Players-tab sidebar list
  // (2026-08-24) — same role MLB's/NFL's own subjects carry via
  // `statusLine`, just never populated for NHL before.
  for (const candidate of candidates) {
    const subject = subjectsMap.get(candidate.subjectId);
    if (!subject || subject.statusLine) continue;
    const seasonStats = (candidate.subjectMeta as Record<string, unknown> | undefined)?.seasonStats as
      | { games: number; goals: number; assists: number; points: number; saves: number; goalsAgainst: number }
      | undefined;
    if (!seasonStats || seasonStats.games === 0) continue;
    subject.statusLine =
      seasonStats.saves > 0
        ? `${seasonStats.saves} SV · ${seasonStats.goalsAgainst} GA`
        : `${seasonStats.goals} G · ${seasonStats.assists} A · ${seasonStats.points} P`;
  }

  const seasonStatus = await fetchSeasonStatus('hockey', 'nhl');

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
    seasonStatus: {
      started: seasonStatus.started,
      nextGameDate: seasonStatus.nextGameDate,
      label: seasonStatus.started ? undefined : 'The 2026-27 NHL season hasn’t dropped the puck yet',
    },
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
