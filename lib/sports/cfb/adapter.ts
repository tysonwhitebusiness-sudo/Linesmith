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
import { subsetWindow, shortDate } from '@/lib/core/windowedStat';
import { normalizeName } from '@/lib/odds/screenshotImport';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { cfbTeamLogoByAbbr, fetchAllTeams } from './espn';
import { currentCfbdSeason, matchCfbdTeamName, fetchFbsTeamNames, loadCfbdTeamContext, cfbdPlayerMatchesFromContext, fetchSeasonStatus, type CfbdMatchStat } from './cfbd';

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

function toHistoryEntries(matches: CfbdMatchStat[], marketKey: string, startingLine: number, logoByName?: Map<string, string>): HistoryEntry[] {
  const field = HISTORY_FIELD[marketKey];
  if (!field) return [];
  return matches.map((m, i) => {
    const value = field(m);
    return {
      period: i + 1,
      result: String(value),
      category: value > startingLine ? 'over' : 'under',
      periodLabel: `${shortDate(m.date)} ${m.isHome ? 'vs' : '@'} ${m.opponent}`,
      // Real opponent logo (2026-08-24) — `m.opponent` is CFBD's own real
      // school name (e.g. "Alabama"), the exact key `cfbTeamLogoByCfbdName`
      // is built for.
      raw: { opponentAbbr: m.opponent, opponentLogoUrl: logoByName?.get(m.opponent), ...m },
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
  // Real opponent logo, keyed by CFBD's own school name — same real ESPN
  // team objects already being iterated here, just also capturing
  // `logoUrl` (2026-08-24, no extra fetch).
  const logoByCfbdName = new Map<string, string>();
  for (const t of teams) {
    const cfbdName = matchCfbdTeamName(t.location, fbsNames);
    if (cfbdName) {
      cfbdNameByAbbr.set(t.abbreviation, cfbdName);
      if (t.logoUrl) logoByCfbdName.set(cfbdName, t.logoUrl);
    }
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

      // Real season totals (sum across every real game CFBD returned for
      // this player — the same `matches` the per-market history above
      // slices per market) — the CFB equivalent of NFL's `seasonStats` card.
      // `longestRush`/`longestReception` are real per-game maxima, not
      // summable totals, so those two report the season's own real max
      // instead of a sum.
      const seasonStats = {
        games: matches.length,
        passingYards: matches.reduce((s, m) => s + m.passingYards, 0),
        rushingYards: matches.reduce((s, m) => s + m.rushingYards, 0),
        receivingYards: matches.reduce((s, m) => s + m.receivingYards, 0),
        receptions: matches.reduce((s, m) => s + m.receptions, 0),
        longestRush: Math.max(0, ...matches.map((m) => m.longestRush)),
        longestReception: Math.max(0, ...matches.map((m) => m.longestReception)),
        kickingPoints: matches.reduce((s, m) => s + m.kickingPoints, 0),
      };

      for (const candidate of subjectCandidates) {
        const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
        meta.seasonStats = seasonStats;
        candidate.subjectMeta = meta;

        const startingLine = candidate.line ?? 0.5;
        const entries = toHistoryEntries(matches, candidate.dimension, startingLine, logoByCfbdName);
        if (entries.length === 0) continue;
        candidate.history = entries;
        candidate.sampleSize = entries.length;
        candidate.consistent = entries.every((e) => e.category === entries[0].category);

        // Real "Form" H2H split — same shape soccer's/NFL's own adapters use.
        // CFBD's own opponent name ("Alabama") and ESPN's full display name
        // ("Alabama Crimson Tide") are real but differently-conventioned —
        // substring match rather than exact equality, same reasoning
        // `matchUnderstatTeamName` documents for soccer's identical gap (a
        // small, known set of ~130 FBS names has no real collision risk).
        const opponentAbbr = meta.opponent as string | undefined;
        const opponentNameForMatch = normalizeName((meta.opponentName as string | undefined) ?? '');
        if (opponentAbbr && opponentNameForMatch) {
          candidate.supportingSplits = [
            {
              kind: 'head-to-head',
              label: `vs ${opponentAbbr}`,
              stat: subsetWindow(
                entries,
                'over',
                (e) => {
                  const raw = normalizeName(((e.raw as Record<string, unknown> | undefined)?.opponentAbbr as string | undefined) ?? '');
                  return raw !== '' && (opponentNameForMatch.includes(raw) || raw.includes(opponentNameForMatch));
                },
                { minimum: 1 },
              ),
            },
          ];
        }
      }
    }
  });
}

/**
 * Real, honestly-priceless candidates for every market this sport tracks —
 * for a player with no real `prop_odds` row on today's slate. Same
 * contract as tennis's/NHL's/NBA's `buildSyntheticPlayerCandidates`: `odds`
 * stays undefined so PlayerDetail's existing "Add to slip to record a
 * price" empty state renders; only the LINE is synthetic (real-history
 * average). Built off the exact same `loadCfbdTeamContext`/
 * `cfbdPlayerMatchesFromContext` pipeline `attachRealHistory` above already
 * uses per-candidate — `teamAbbr` (ESPN abbreviation, already carried by
 * the roster link's own query params) resolves the one CFBD team context
 * this player's real games live in.
 */
export async function buildSyntheticPlayerCandidates(subjectId: string, subjectName: string, teamAbbr: string): Promise<PickCandidate[]> {
  const [teams, fbsNames] = await Promise.all([fetchAllTeams(), fetchFbsTeamNames()]);
  const team = teams.find((t) => t.abbreviation === teamAbbr);
  const cfbdTeamName = team ? matchCfbdTeamName(team.location, fbsNames) : null;
  if (!cfbdTeamName) return [];

  // Real opponent logo — same real ESPN team objects already fetched above.
  const logoByCfbdName = new Map<string, string>();
  for (const t of teams) {
    const name = matchCfbdTeamName(t.location, fbsNames);
    if (name && t.logoUrl) logoByCfbdName.set(name, t.logoUrl);
  }

  const season = currentCfbdSeason();
  let context;
  try {
    context = await loadCfbdTeamContext(cfbdTeamName, season);
  } catch {
    return [];
  }
  if (context.games.length === 0) return [];

  const matches = cfbdPlayerMatchesFromContext(context, subjectName);
  if (matches.length === 0) return [];

  return Object.entries(MARKET_META).map(([marketKey, meta]) => {
    const field = HISTORY_FIELD[marketKey];
    const values = matches.map((m) => (field ? field(m) : 0));
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const defaultLine = Math.max(0.5, Math.round(avg * 2) / 2);
    const entries = toHistoryEntries(matches, marketKey, defaultLine, logoByCfbdName);

    return {
      sport: 'cfb',
      subjectId,
      subjectName,
      subjectMeta: { team: teamAbbr },
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

export async function buildCfbSnapshot(): Promise<SportSnapshot> {
  const [games, logoByAbbr] = await Promise.all([loadGameContextsForSport('cfb'), cfbTeamLogoByAbbr()]);
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
        warnings.push(`Unrecognized CFB market key "${marketKey}" — skipped.`);
        continue;
      }
      const rosterEntry = rosterBySubjectId.get(subjectId);
      const subjectName = rosterEntry?.subjectName ?? marketRows[0].subjectName;
      const teamAbbr = rosterEntry?.teamAbbr;
      const isHome = teamAbbr === game.homeAbbr;
      const opponentAbbr = teamAbbr ? (isHome ? game.awayAbbr : game.homeAbbr) : undefined;
      const opponentName = teamAbbr ? (isHome ? game.awayTeamName : game.homeTeamName) : undefined;

      const best = bestRow(marketRows, 'over') ?? marketRows[0];

      candidates.push({
        sport: 'cfb',
        subjectId,
        subjectName,
        subjectMeta: {
          team: teamAbbr,
          opponent: opponentAbbr,
          // CFBD's own history entries carry the opponent's CFBD team name
          // (`raw.opponentAbbr`, despite the field name — see toHistoryEntries
          // below), not the ESPN abbreviation `opponent` holds. Real bug
          // found while building the matchup/H2H card (2026-08-23, same
          // class as soccer's identical fix): comparing across those two
          // namespaces silently failed every H2H/vs-opponent lookup.
          opponentName,
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

  // Real per-player season line for the Players-tab sidebar list
  // (2026-08-24) — same role MLB's/NFL's own subjects carry via
  // `statusLine`, just never populated for CFB before. No real position
  // field reliably available at this point (unlike NFL, which resolves
  // this from the roster loop, not post-hoc) — picks whichever of
  // passing/rushing/receiving yards is this player's real largest total,
  // same "let the real numbers pick the framing" approach kicking points
  // falls back to when none of the three apply.
  for (const candidate of candidates) {
    const subject = subjectsMap.get(candidate.subjectId);
    if (!subject || subject.statusLine) continue;
    const s = (candidate.subjectMeta as Record<string, unknown> | undefined)?.seasonStats as
      | { games: number; passingYards: number; rushingYards: number; receivingYards: number; receptions: number; kickingPoints: number }
      | undefined;
    if (!s || s.games === 0) continue;
    if (s.passingYards >= s.rushingYards && s.passingYards >= s.receivingYards && s.passingYards > 0) {
      subject.statusLine = `${s.passingYards} pass yds`;
    } else if (s.rushingYards >= s.receivingYards && s.rushingYards > 0) {
      subject.statusLine = `${s.rushingYards} rush yds`;
    } else if (s.receivingYards > 0) {
      subject.statusLine = `${s.receptions} rec · ${s.receivingYards} rec yds`;
    } else if (s.kickingPoints > 0) {
      subject.statusLine = `${s.kickingPoints} kicking pts`;
    }
  }

  const seasonStatus = await fetchSeasonStatus(currentCfbdSeason());

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
    seasonStatus: {
      started: seasonStatus.started,
      nextGameDate: seasonStatus.nextGameDate,
      label: seasonStatus.started ? undefined : 'The 2026 CFB season hasn’t kicked off yet',
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
