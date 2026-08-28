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
import { subsetWindow, shortDate } from '@/lib/core/windowedStat';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { fetchSeasonStatus, fetchTeamRoster } from '@/lib/sports/multiSport/teamSportEspn';
import { nbaTeamLogoByAbbr, fetchAllTeams } from './espn';
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

// ESPN's team-logo CDN follows this exact predictable pattern for every
// league it covers — confirmed live both here (sportsdataverse's own CSV
// carries `opponent_team_logo` values matching this exact URL shape) and
// independently in NFL's adapter.ts, which already uses the identical
// template for its own sport segment.
export function nbaTeamLogoUrl(abbreviation: string | undefined): string | undefined {
  return abbreviation ? `https://a.espncdn.com/i/teamlogos/nba/500/${abbreviation.toLowerCase()}.png` : undefined;
}

function toHistoryEntries(matches: NbaMatchStat[], marketKey: string, startingLine: number): HistoryEntry[] {
  const field = HISTORY_FIELD[marketKey];
  if (!field) return [];
  return matches.map((m, i) => {
    const value = field(m);
    return {
      period: i + 1,
      result: String(value),
      category: value > startingLine ? 'over' : 'under',
      periodLabel: `${shortDate(m.date)} ${m.isHome ? 'vs' : '@'} ${m.opponent}`,
      raw: { opponentAbbr: m.opponent, opponentLogoUrl: nbaTeamLogoUrl(m.opponent), ...m },
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

    // Real season totals — same "seasonStats on subjectMeta" convention
    // soccer's/CFB's adapters use.
    const seasonStats = {
      games: matches.length,
      points: matches.reduce((s, m) => s + m.points, 0),
      rebounds: matches.reduce((s, m) => s + m.rebounds, 0),
      assists: matches.reduce((s, m) => s + m.assists, 0),
      steals: matches.reduce((s, m) => s + m.steals, 0),
      blocks: matches.reduce((s, m) => s + m.blocks, 0),
      turnovers: matches.reduce((s, m) => s + m.turnovers, 0),
      threesMade: matches.reduce((s, m) => s + m.threesMade, 0),
    };

    for (const candidate of subjectCandidates) {
      const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
      meta.seasonStats = seasonStats;
      candidate.subjectMeta = meta;

      const startingLine = candidate.line ?? 0.5;
      const entries = toHistoryEntries(matches, candidate.dimension, startingLine);
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
}

/**
 * Real fallback for deep off-season: `loadGameContextsForSport`'s own
 * schedule window (14 days ahead) finds nothing when the real regular
 * season is 40+ days out (confirmed live 2026-08-23 — NBA preseason
 * doesn't start until Oct 3), so the per-game roster loop above never
 * runs at all and the Players tab shows nobody, despite every real NBA
 * roster being knowable right now. Fetches all 30 real teams' real
 * rosters directly — cheap and already 1h-cached per team
 * (teamSportEspn.ts's `fetchTeamRoster`), 30 real teams total.
 */
async function attachFullRosterSubjects(subjectsMap: Map<string, SubjectSummary>, teamLogoUrl: (abbr: string | undefined) => string | undefined): Promise<void> {
  const teams = await fetchAllTeams();
  await Promise.all(
    teams.map(async (team) => {
      let roster;
      try {
        roster = await fetchTeamRoster('basketball', 'nba', team.teamId);
      } catch {
        return;
      }
      for (const p of roster) {
        if (subjectsMap.has(p.subjectId)) continue;
        subjectsMap.set(p.subjectId, {
          subjectId: p.subjectId,
          subjectName: p.fullName,
          meta: { headshotUrl: p.headshotUrl, teamLogoUrl: teamLogoUrl(team.abbreviation), position: p.positionAbbr, team: team.abbreviation },
        });
      }
    }),
  );
}

const MARKET_KEYS = Object.keys(MARKET_META);

/**
 * Real, honestly-priceless candidates for every market this sport tracks —
 * for a player with no real `prop_odds` row. Same contract as NHL's
 * `buildSyntheticPlayerCandidates` (lib/sports/nhl/adapter.ts): `odds`
 * stays undefined so PlayerDetail's existing "Add to slip to record a
 * price" empty state renders — only the LINE is synthetic (real-history
 * average, user-adjustable via the existing lineOffset stepper).
 *
 * No prior-season fallback needed here the way NHL's needed one:
 * `currentNbaSeason()` already resolves to the most recently *completed*
 * season file once the new season hasn't tipped off yet (sportsdataverse.ts's
 * own doc comment), so the off-season case is handled for free.
 */
export async function buildSyntheticPlayerCandidates(subjectId: string, subjectName: string, teamAbbr: string | undefined, headshotUrl: string | undefined, teamLogoUrl: string | undefined): Promise<PickCandidate[]> {
  let context;
  try {
    context = await loadNbaSeasonContext(currentNbaSeason());
  } catch {
    return [];
  }
  const athleteId = matchNbaPlayer(context, subjectName);
  // Real full season — `attachRealHistory` above (the real-candidate path)
  // already uses `nbaPlayerMatches` uncapped; this synthetic path used to
  // throw away everything past the last 25 games for no real reason
  // (2026-08-24 fix), understating a full real season's sample.
  const matches = athleteId ? nbaPlayerMatches(context, athleteId) : [];

  const seasonStats = matches.length
    ? {
        games: matches.length,
        points: matches.reduce((s, m) => s + m.points, 0),
        rebounds: matches.reduce((s, m) => s + m.rebounds, 0),
        assists: matches.reduce((s, m) => s + m.assists, 0),
        steals: matches.reduce((s, m) => s + m.steals, 0),
        blocks: matches.reduce((s, m) => s + m.blocks, 0),
        turnovers: matches.reduce((s, m) => s + m.turnovers, 0),
        threesMade: matches.reduce((s, m) => s + m.threesMade, 0),
      }
    : undefined;

  return MARKET_KEYS.map((marketKey) => {
    const meta = MARKET_META[marketKey];
    const field = HISTORY_FIELD[marketKey];
    const values = matches.map(field);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const defaultLine = Math.max(0.5, Math.round(avg * 2) / 2);
    const entries = toHistoryEntries(matches, marketKey, defaultLine);

    return {
      sport: 'nba',
      subjectId,
      subjectName,
      subjectMeta: { team: teamAbbr, headshotUrl, teamLogoUrl, seasonStats },
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

export async function buildNbaSnapshot(): Promise<SportSnapshot> {
  const [games, logoByAbbr] = await Promise.all([loadGameContextsForSport('nba'), nbaTeamLogoByAbbr()]);
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

  // Deep off-season (see attachFullRosterSubjects's own comment): the
  // near-term schedule window found no real games at all, so nobody got
  // added to subjectsMap above — fetch every real roster directly instead
  // of leaving the Players tab empty for the ~2 months before tip-off.
  if (subjectsMap.size === 0) {
    await attachFullRosterSubjects(subjectsMap, teamLogoUrl);
  }

  await attachRealHistory(candidates);

  // Real per-player season line for the Players-tab sidebar list
  // (2026-08-24) — same role MLB's/NFL's own subjects carry via
  // `statusLine`, just never populated for NBA before. Real bug found
  // while verifying this: a candidate-only backfill (matching `meta.
  // seasonStats` already resolved by `attachRealHistory`) misses every
  // subject added by `attachFullRosterSubjects` above (the deep-off-season
  // case — zero real candidates exist at all then, so a candidate-keyed
  // pass touches nothing). Resolves every real subject directly against
  // the same season context instead, one shared fetch, pure in-memory
  // matching per subject after that.
  try {
    const context = await loadNbaSeasonContext(currentNbaSeason());
    for (const subject of subjectsMap.values()) {
      if (subject.statusLine) continue;
      const athleteId = matchNbaPlayer(context, subject.subjectName);
      if (!athleteId) continue;
      const matches = nbaPlayerMatches(context, athleteId);
      if (matches.length === 0) continue;
      const points = matches.reduce((s, m) => s + m.points, 0) / matches.length;
      const rebounds = matches.reduce((s, m) => s + m.rebounds, 0) / matches.length;
      const assists = matches.reduce((s, m) => s + m.assists, 0) / matches.length;
      subject.statusLine = `${points.toFixed(1)} pts · ${rebounds.toFixed(1)} reb · ${assists.toFixed(1)} ast`;
    }
  } catch {
    // Real sportsdataverse hiccup — Players tab just shows no stat lines for this load.
  }

  const seasonStatus = await fetchSeasonStatus('basketball', 'nba');

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
    seasonStatus: {
      started: seasonStatus.started,
      nextGameDate: seasonStatus.nextGameDate,
      label: seasonStatus.started ? undefined : 'The 2026-27 NBA season hasn’t tipped off yet',
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
