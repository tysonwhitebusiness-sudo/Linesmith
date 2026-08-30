/**
 * Soccer adapter — builds a `SportSnapshot` for one league (EPL or MLS)
 * directly from real `prop_odds` rows, not from a player-history engine
 * like MLB's/NFL's adapters do.
 *
 * Real per-match history (docs/soccer-gameplan-2026-08-22.md §11): EPL
 * uses Understat (`understat.ts`), MLS uses American Soccer Analysis
 * (`americanSocceranalysis.ts`) — both confirmed live sources, wired in
 * below. Only a subset of the 14 real market keys have a matching
 * per-match stat field either source actually carries (goals, shots,
 * assists — see `HISTORY_FIELD` below); markets with no real per-match
 * field (first/last-goalscorer, shots-on-target, tackles,
 * passes/dribbles/crosses-attempted, yellow-cards, saves) still get
 * `history: []`, the same honest "insufficient" state as before — a real,
 * partial improvement matching what the data actually supports, not
 * fabricated coverage.
 */

import type { HistoryEntry, PickCandidate, SplitEvidence, SportSnapshot, SubjectSummary, SoccerLeague } from '@/lib/core/types';
import { subsetWindow, shortDate } from '@/lib/core/windowedStat';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { soccerTeamLogoByAbbr, soccerTeamLogoByName, matchSoccerTeamLogo, ESPN_LEAGUE_SLUG } from './espn';
import { fetchSeasonStatus } from '@/lib/sports/multiSport/teamSportEspn';
import { currentUnderstatSeason, buildUnderstatNameIndex, matchUnderstatIndex, fetchUnderstatPlayerMatches, buildUnderstatTeamDefenseIndex, matchUnderstatTeamName, type UnderstatMatch, type UnderstatSeasonStats, type UnderstatTeamDefense } from './understat';
import { normalizeName } from '@/lib/odds/screenshotImport';
import { currentAsaSeason, loadAsaSeasonContext, matchAsaIndex, asaPlayerMatches, type AsaMatchStat } from './americanSocceranalysis';
import { favorableFromRank } from '@/lib/odds/props/matchupFavorable';

const LEAGUE_TO_SPORT_KEY: Record<SoccerLeague, 'soccer_epl' | 'soccer_mls'> = {
  epl: 'soccer_epl',
  mls: 'soccer_mls',
};

// X-signal (Phase A of docs/x-signal-remaining-sports-gameplan-2026-08-27.
// md) — the three real dimensions Understat's own single defensive signal
// (goals against per game) is actually meaningful for, matching the
// Python-side port's own _SOCCER_X_SIGNAL_DIMENSIONS precedent exactly.
// yellow-cards (a discipline/referee signal) and saves (a GOALKEEPER's own
// stat, where the relevant "matchup" is the OPPONENT's attack strength,
// the inverse relationship) deliberately stay out.
const SOCCER_X_SIGNAL_DIMENSIONS = new Set(['assists', 'shots', 'shots-on-target']);

/** The 14 real soccer market keys (see python-odds-service/src/entity_resolution.py's MARKET_KEY_ALIASES soccer block) — `binary` = a yes/no proposition with no real line (Propline sends `line: null`), `threshold` = a real over/under number. */
const MARKET_META: Record<string, { label: string; kind: 'binary' | 'threshold' }> = {
  'anytime-goalscorer': { label: 'Anytime Goalscorer', kind: 'binary' },
  'first-goalscorer': { label: 'First Goalscorer', kind: 'binary' },
  'last-goalscorer': { label: 'Last Goalscorer', kind: 'binary' },
  'two-plus-goals': { label: '2+ Goals', kind: 'binary' },
  assists: { label: 'Assists', kind: 'threshold' },
  shots: { label: 'Shots', kind: 'threshold' },
  'shots-on-target': { label: 'Shots on Target', kind: 'threshold' },
  'goals-assists': { label: 'Goals + Assists', kind: 'threshold' },
  tackles: { label: 'Tackles', kind: 'threshold' },
  'passes-attempted': { label: 'Passes Attempted', kind: 'threshold' },
  'dribbles-attempted': { label: 'Dribbles Attempted', kind: 'threshold' },
  'crosses-attempted': { label: 'Crosses Attempted', kind: 'threshold' },
  'yellow-cards': { label: 'Yellow Card', kind: 'binary' },
  saves: { label: 'Saves', kind: 'threshold' },
};

function bestRow(rows: PropOddsRow[], side: string): PropOddsRow | null {
  const matching = rows.filter((r) => r.side === side);
  if (matching.length === 0) return null;
  return matching.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best), matching[0]);
}

/** Which markets have a real per-match stat field in Understat/ASA, and how to compute it — the rest stay `history: []`, a real data limitation, not an oversight. */
const HISTORY_FIELD: Record<string, (m: { goals: number; shots: number; assists: number }) => number> = {
  'anytime-goalscorer': (m) => m.goals,
  'two-plus-goals': (m) => m.goals,
  shots: (m) => m.shots,
  assists: (m) => m.assists,
  'goals-assists': (m) => m.goals + m.assists,
};

interface NormalizedMatch {
  matchId: string;
  date: string;
  /** `null` when the player's club that season could not be resolved — see `understat.ts`. */
  opponent: string | null;
  /** `null` means NOT DETERMINABLE. It is not `false`, and must never be coerced to it. */
  isHome: boolean | null;
  goals: number;
  shots: number;
  assists: number;
}

function toHistoryEntries(matches: NormalizedMatch[], marketKey: string, startingLine: number, logoByName?: Map<string, string>): HistoryEntry[] {
  const field = HISTORY_FIELD[marketKey];
  if (!field) return [];
  // Most recent last — matches the "ascending = older -> newer" convention
  // every other sport's HistoryEntry.period already follows.
  const chronological = [...matches].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return chronological.map((m, i) => {
    const value = field(m);
    return {
      period: i + 1,
      result: String(value),
      category: value > startingLine ? 'over' : 'under',
      // `isHome` is now three-valued. An unknown venue prints neither "vs" nor
      // "@" rather than defaulting to "@", which is what the old two-valued
      // read did for every match a player played before their latest transfer.
      periodLabel:
        m.opponent == null
          ? shortDate(m.date)
          : `${shortDate(m.date)} ${m.isHome == null ? 'v' : m.isHome ? 'vs' : '@'} ${m.opponent}`,
      // Real regression found while building the matchup/FORM cards
      // (2026-08-23): this is Understat/ASA's own opponent TEAM NAME
      // ("Newcastle United"), never an ESPN abbreviation despite the field's
      // name — `playerDetailAdapter.ts`'s opponent-only filter/H2H window
      // compare it against `subjectMeta.opponentName` (also a real team
      // name, set in `buildSoccerSnapshot`), never `subjectMeta.opponent`
      // (the ESPN abbreviation) — comparing across those two namespaces is
      // exactly the bug that silently broke soccer's H2H window and
      // "vs opponent" filter chip since they were first built: every
      // comparison failed silently, `H2H` was permanently `insufficient`.
      // `opponentLogoUrl` (2026-08-24) — fuzzy-matched the same way, real
      // gap the chart/gamelog never had a logo for before.
      raw: {
        // `undefined`, not `null`: every consumer of `raw.opponentAbbr` already
        // treats a missing opponent as "unknown" (the H2H window's predicate,
        // the opponent-only filter chip, the gamelog's own fallback label), and
        // an unresolved match must miss those filters rather than join a bucket
        // it does not belong to.
        opponentAbbr: m.opponent ?? undefined,
        opponentLogoUrl: logoByName && m.opponent ? matchSoccerTeamLogo(logoByName, m.opponent) : undefined,
        date: m.date,
        isHome: m.isHome,
        goals: m.goals,
        shots: m.shots,
        assists: m.assists,
      },
    } satisfies HistoryEntry;
  });
}

/** Runs `fn` over `items` with at most `limit` in flight at once — Understat/ASA are free, unauthenticated, real production endpoints; hitting either with 100+ simultaneous requests for one snapshot rebuild is a good way to get rate-limited or blocked, unlike this codebase's own metered providers which already have their own budget gates. */
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
 * Real per-match history, mutating candidates in place. Only fetches for
 * subjects that actually have a HISTORY_FIELD-supported candidate — most
 * of a roster's real props are markets with no per-match source (see the
 * file header), so this is a fraction of every subject, not all of them.
 */
/** Understat's raw `position` field is a space-joined multi-role tag (e.g. "D F M", "GK S") — this reduces it to one real primary bucket for "ranked among {bucket}s", same convention NFL's own position-gated ranking uses. Substitute ("S") is never primary on its own; it's a modifier tag Understat adds alongside a real position. */
function primaryPosition(raw: string): 'GK' | 'D' | 'M' | 'F' | null {
  const tokens = raw.split(' ').filter((t) => t !== 'S');
  if (tokens.includes('GK')) return 'GK';
  if (tokens.includes('F')) return 'F';
  if (tokens.includes('M')) return 'M';
  if (tokens.includes('D')) return 'D';
  return null;
}

interface PositionRank {
  rank: number;
  poolSize: number;
  positionLabel: string;
}

/** Real rank-by-goals within each real primary-position bucket, computed once per rebuild from the same merged current+prior season index `attachRealHistory` already builds — no extra fetch. */
function buildPositionRanks(index: Map<string, UnderstatSeasonStats & { name: string }>): Map<string, PositionRank> {
  const byPosition = new Map<string, Array<UnderstatSeasonStats & { name: string }>>();
  for (const entry of index.values()) {
    const pos = primaryPosition(entry.position);
    if (!pos) continue;
    const bucket = byPosition.get(pos) ?? [];
    bucket.push(entry);
    byPosition.set(pos, bucket);
  }
  const ranks = new Map<string, PositionRank>();
  for (const [pos, entries] of byPosition) {
    const sorted = [...entries].sort((a, b) => b.goals - a.goals);
    sorted.forEach((entry, i) => {
      ranks.set(normalizeName(entry.name), { rank: i + 1, poolSize: sorted.length, positionLabel: pos });
    });
  }
  return ranks;
}

async function attachRealHistory(candidates: PickCandidate[], league: SoccerLeague, subjectsMap?: Map<string, SubjectSummary>): Promise<void> {
  const eligibleSubjects = new Map<string, PickCandidate[]>();
  for (const c of candidates) {
    if (!HISTORY_FIELD[c.dimension]) continue;
    const bucket = eligibleSubjects.get(c.subjectId) ?? [];
    bucket.push(c);
    eligibleSubjects.set(c.subjectId, bucket);
  }
  if (eligibleSubjects.size === 0) return;

  const season = league === 'epl' ? currentUnderstatSeason() : currentAsaSeason();

  // Season-wide name index (and, for MLS, the season's game/roster context)
  // loaded exactly once per rebuild, not once per subject — each subject
  // resolution below is then pure in-memory matching, no repeated cache
  // round-trips. See understat.ts/americanSocceranalysis.ts's own comments
  // on why per-subject re-fetching of this same season-wide data was a real
  // problem (redundant DB traffic against a pool already shared with every
  // other sport's scheduler jobs).
  const understatIndex = league === 'epl' ? await buildUnderstatNameIndex(season) : null;
  const asaContext = league === 'mls' ? await loadAsaSeasonContext(season) : null;
  // Real opponent logo, once per rebuild — see toHistoryEntries's own comment.
  const logoByName = await soccerTeamLogoByName(league);
  // Real "vs opponent's defense"/"ranked among position" data — EPL only for
  // now (Understat's team `history[]` has real goals-against per match; MLS's
  // equivalent needs ASA's own `/mls/teams/xgoals` season rollup, not yet
  // wired — see americanSocceranalysis.ts's own header for what IS built).
  const teamDefenseIndex = league === 'epl' && understatIndex ? await buildUnderstatTeamDefenseIndex(season) : null;
  const positionRanks = understatIndex ? buildPositionRanks(understatIndex) : null;

  await mapWithConcurrency([...eligibleSubjects.entries()], 5, async ([subjectId, subjectCandidates]) => {
    const subjectName = subjectCandidates[0].subjectName;
    let matches: NormalizedMatch[] = [];
    let seasonStats: (UnderstatSeasonStats & { name: string }) | null = null;
    try {
      if (league === 'epl' && understatIndex) {
        const resolved = matchUnderstatIndex(understatIndex, subjectName);
        if (resolved) {
          seasonStats = resolved;
          const raw = await fetchUnderstatPlayerMatches(resolved.understatId, resolved.teamTitle);
          matches = raw.map((m: UnderstatMatch) => ({
            matchId: m.matchId,
            date: m.date,
            opponent: m.opponent,
            isHome: m.isHome,
            goals: m.goals,
            shots: m.shots,
            assists: m.assists,
          }));
        }
      } else if (asaContext) {
        const resolved = matchAsaIndex(asaContext.nameIndex, subjectName);
        if (resolved) {
          const raw = asaPlayerMatches(asaContext, resolved.asaPlayerId, resolved.teamId);
          matches = raw.map((m: AsaMatchStat) => ({
            matchId: m.gameId,
            date: m.date,
            opponent: m.opponent,
            isHome: m.isHome,
            goals: m.goals,
            shots: m.shots,
            assists: m.assists,
          }));
        }
      }
    } catch {
      // Real-world Understat hiccup (timeout, format change) fetching this
      // one player's match log — this subject's candidates simply keep
      // their existing `history: []` rather than taking the whole snapshot
      // rebuild down over one player's data. (ASA's path is pure/no I/O
      // once `asaContext` is loaded, so this only meaningfully guards the
      // Understat per-player fetch above.)
      return;
    }

    for (const candidate of subjectCandidates) {
      const meta = (candidate.subjectMeta ?? {}) as Record<string, unknown>;
      if (seasonStats) {
        meta.seasonStats = { games: seasonStats.games, goals: seasonStats.goals, xG: seasonStats.xG, assists: seasonStats.assists, xA: seasonStats.xA, shots: seasonStats.shots, keyPasses: seasonStats.keyPasses };
        const posRank = positionRanks?.get(normalizeName(seasonStats.name));
        if (posRank) meta.seasonRank = posRank;
      }
      const opponentName = typeof meta.opponentName === 'string' ? meta.opponentName : undefined;
      if (opponentName && teamDefenseIndex) {
        const defense = matchUnderstatTeamName(teamDefenseIndex, opponentName);
        if (defense) {
          meta.opponentDefense = defense;
          // X-signal (Phase A of docs/x-signal-remaining-sports-gameplan-
          // 2026-08-27.md) — real attacking-output dimensions only,
          // matching the Python side's own _SOCCER_X_SIGNAL_DIMENSIONS
          // precedent (a team's overall goals-against rate isn't a
          // meaningful signal for yellow-cards/saves the way it is for a
          // player's own attacking output).
          if (SOCCER_X_SIGNAL_DIMENSIONS.has(candidate.dimension)) {
            meta.matchupFavorable = favorableFromRank(defense.rank, defense.poolSize);
          }
        }
      }
      candidate.subjectMeta = meta;
    }

    // Real per-player season line for the Players-tab sidebar list
    // (2026-08-24) — same role MLB's/NFL's own subjects carry via
    // `statusLine`, just never populated for soccer before. EPL uses the
    // real Understat season aggregate already resolved above; MLS has no
    // such aggregate wired (see this function's own header), so it sums
    // real match-level goals/assists instead — same real data, no fewer
    // real games than a proper season total would use.
    const subject = subjectsMap?.get(subjectId);
    if (subject && !subject.statusLine) {
      if (seasonStats) {
        subject.statusLine = `${seasonStats.goals} G · ${seasonStats.assists} A`;
      } else if (matches.length > 0) {
        const goals = matches.reduce((s, m) => s + m.goals, 0);
        const assists = matches.reduce((s, m) => s + m.assists, 0);
        subject.statusLine = `${goals} G · ${assists} A`;
      }
    }

    if (matches.length === 0) return;
    for (const candidate of subjectCandidates) {
      const startingLine = candidate.line ?? 0.5;
      const entries = toHistoryEntries(matches, candidate.dimension, startingLine, logoByName);
      if (entries.length === 0) continue;
      candidate.history = entries;
      candidate.sampleSize = entries.length;
      candidate.consistent = entries.every((e) => e.category === entries[0].category);

      // Real "Form" H2H split — how this exact market has gone the real
      // times this player has faced this exact real opponent, same shape
      // NFL's own vsOpponentSplit uses. Almost always thin (these two teams
      // meet 2x/season at most), so an honest `insufficient` is a real
      // result, not a reason to fabricate one.
      const candidateMeta = candidate.subjectMeta as Record<string, unknown> | undefined;
      const opponentAbbrLabel = candidateMeta?.opponent as string | undefined;
      const opponentName = candidateMeta?.opponentName as string | undefined;
      if (opponentAbbrLabel && opponentName) {
        const vsOpponentSplit: SplitEvidence = {
          kind: 'head-to-head',
          label: `vs ${opponentAbbrLabel}`,
          stat: subsetWindow(entries, 'over', (e) => (e.raw as Record<string, unknown> | undefined)?.opponentAbbr === opponentName, { minimum: 1 }),
        };
        candidate.supportingSplits = [vsOpponentSplit];
      }
    }
  });
}

/**
 * Real, honestly-priceless candidates for every real per-match-supported
 * market (see `HISTORY_FIELD`) — for a player with no real `prop_odds` row
 * on today's slate. Same contract as CFB's/tennis's/NHL's/NBA's
 * `buildSyntheticPlayerCandidates`: `odds` stays undefined so
 * `PlayerDetail`'s existing "Add to slip to record a price" empty state
 * renders; only the LINE is synthetic (real-history average, or a real 0.5
 * split for a binary market). Reuses the exact same Understat(EPL)/ASA(MLS)
 * resolution `attachRealHistory` above already runs per-candidate.
 */
export async function buildSyntheticPlayerCandidates(subjectId: string, subjectName: string, league: SoccerLeague): Promise<PickCandidate[]> {
  const season = league === 'epl' ? currentUnderstatSeason() : currentAsaSeason();

  let matches: NormalizedMatch[] = [];
  try {
    if (league === 'epl') {
      const understatIndex = await buildUnderstatNameIndex(season);
      const resolved = matchUnderstatIndex(understatIndex, subjectName);
      if (resolved) {
        const raw = await fetchUnderstatPlayerMatches(resolved.understatId, resolved.teamTitle);
        matches = raw.map((m: UnderstatMatch) => ({ matchId: m.matchId, date: m.date, opponent: m.opponent, isHome: m.isHome, goals: m.goals, shots: m.shots, assists: m.assists }));
      }
    } else {
      const asaContext = await loadAsaSeasonContext(season);
      const resolved = matchAsaIndex(asaContext.nameIndex, subjectName);
      if (resolved) {
        const raw = asaPlayerMatches(asaContext, resolved.asaPlayerId, resolved.teamId);
        matches = raw.map((m: AsaMatchStat) => ({ matchId: m.gameId, date: m.date, opponent: m.opponent, isHome: m.isHome, goals: m.goals, shots: m.shots, assists: m.assists }));
      }
    }
  } catch {
    return [];
  }
  if (matches.length === 0) return [];
  const logoByName = await soccerTeamLogoByName(league);

  return Object.entries(MARKET_META)
    .filter(([marketKey]) => HISTORY_FIELD[marketKey])
    .map(([marketKey, meta]) => {
      const field = HISTORY_FIELD[marketKey];
      const values = matches.map(field);
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      const defaultLine = meta.kind === 'binary' ? 0.5 : Math.max(0.5, Math.round(avg * 2) / 2);
      const entries = toHistoryEntries(matches, marketKey, defaultLine, logoByName);
      const category = meta.kind === 'binary' ? 'yes' : 'over';
      const categoryLabel = meta.kind === 'binary' ? 'Yes' : 'Over';

      return {
        sport: 'soccer',
        subjectId,
        subjectName,
        subjectMeta: { league },
        dimension: marketKey,
        dimensionLabel: meta.label,
        category,
        categoryLabel,
        line: meta.kind === 'binary' ? undefined : defaultLine,
        history: entries,
        consistent: entries.length > 0 && entries.every((e) => e.category === entries[0].category),
        sampleSize: entries.length,
        liveState: { status: 'unknown', distanceToSubject: null, distanceUnit: 'games', etaMinutes: null, etaConfidence: null },
        odds: undefined,
      } satisfies PickCandidate;
    });
}

export async function buildSoccerSnapshot(league: SoccerLeague): Promise<SportSnapshot> {
  const sportKey = LEAGUE_TO_SPORT_KEY[league];
  const [games, logoByAbbr] = await Promise.all([loadGameContextsForSport(sportKey), soccerTeamLogoByAbbr(league)]);
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
        meta: { headshotUrl: entry.headshotUrl, teamLogoUrl: teamLogoUrl(entry.teamAbbr), position: entry.position, league },
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
        warnings.push(`Unrecognized soccer market key "${marketKey}" — skipped.`);
        continue;
      }
      const rosterEntry = rosterBySubjectId.get(subjectId);
      const subjectName = rosterEntry?.subjectName ?? marketRows[0].subjectName;
      const teamAbbr = rosterEntry?.teamAbbr;
      const isHome = teamAbbr === game.homeAbbr;
      const opponentAbbr = teamAbbr ? (isHome ? game.awayAbbr : game.homeAbbr) : undefined;
      const opponentName = teamAbbr ? (isHome ? game.awayTeamName : game.homeTeamName) : undefined;

      const best = bestRow(marketRows, 'over') ?? bestRow(marketRows, 'yes') ?? marketRows[0];
      // Binary markets deliberately get `line: undefined` here, matching
      // Propline's real `line: null` rows — the UI's own `active.line ?? 0.5`
      // fallback (PlayerDetail.tsx, NFL's adapter's identical pattern) still
      // displays a stepper as "O 0.5" for these, but propOddsBoard's
      // `rowsFor()` filter does an exact `row.line === line` match against
      // the *real* prop_odds rows — inventing 0.5 here made every real book
      // row fail that match and the board render permanently empty.
      const line = meta.kind === 'binary' ? undefined : (best.line ?? undefined);
      const category = meta.kind === 'binary' ? 'yes' : 'over';
      const categoryLabel = meta.kind === 'binary' ? 'Yes' : 'Over';

      candidates.push({
        sport: 'soccer',
        subjectId,
        subjectName,
        subjectMeta: {
          team: teamAbbr,
          opponent: opponentAbbr,
          opponentName,
          isHome,
          headshotUrl: rosterEntry?.headshotUrl,
          teamLogoUrl: teamLogoUrl(teamAbbr),
          opponentLogoUrl: teamLogoUrl(opponentAbbr),
          gamePk: game.gameId,
          league,
        },
        dimension: marketKey,
        dimensionLabel: meta.label,
        category,
        categoryLabel,
        line,
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
            league,
          },
        });
      }
    }
  }

  await attachRealHistory(candidates, league, subjectsMap);
  // Real "has this league's season actually started" signal (2026-08-24) —
  // MLS's real off-season (~Dec-Feb) and EPL's real summer break (~May-Aug)
  // used to leave Scan silently empty with zero explanation, unlike every
  // other seasonal sport (CFB/NBA/NHL) which already tells the user why.
  const seasonStatus = await fetchSeasonStatus('soccer', ESPN_LEAGUE_SLUG[league]);
  const leagueLabel = league === 'epl' ? 'Premier League' : 'MLS';

  return {
    sport: 'soccer',
    eventName: league === 'epl' ? 'Premier League' : 'MLS',
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
      label: seasonStatus.started ? undefined : `The ${leagueLabel} season is between seasons right now`,
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
  // No live play-by-play state wired into candidate-building yet (Game
  // Detail's own hero card reads ESPN's live feed directly — see
  // gameDetailAdapter.ts — this is only the Scan-level candidate list).
  return { status: 'done' as const, distanceToSubject: 0, distanceUnit: 'games' as const, etaMinutes: null, etaConfidence: null };
}
