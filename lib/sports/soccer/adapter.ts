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

import type { HistoryEntry, PickCandidate, SportSnapshot, SubjectSummary, SoccerLeague } from '@/lib/core/types';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { soccerTeamLogoByAbbr } from './espn';
import { currentUnderstatSeason, buildUnderstatNameIndex, matchUnderstatIndex, fetchUnderstatPlayerMatches, type UnderstatMatch } from './understat';
import { currentAsaSeason, loadAsaSeasonContext, matchAsaIndex, asaPlayerMatches, type AsaMatchStat } from './americanSocceranalysis';

const LEAGUE_TO_SPORT_KEY: Record<SoccerLeague, 'soccer_epl' | 'soccer_mls'> = {
  epl: 'soccer_epl',
  mls: 'soccer_mls',
};

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
  opponent: string;
  isHome: boolean;
  goals: number;
  shots: number;
  assists: number;
}

function toHistoryEntries(matches: NormalizedMatch[], marketKey: string, startingLine: number): HistoryEntry[] {
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
      periodLabel: `${m.isHome ? 'vs' : '@'} ${m.opponent}`,
      raw: { opponentAbbr: m.opponent, date: m.date },
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
async function attachRealHistory(candidates: PickCandidate[], league: SoccerLeague): Promise<void> {
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

  await mapWithConcurrency([...eligibleSubjects.entries()], 5, async ([subjectId, subjectCandidates]) => {
    const subjectName = subjectCandidates[0].subjectName;
    let matches: NormalizedMatch[] = [];
    try {
      if (league === 'epl' && understatIndex) {
        const resolved = matchUnderstatIndex(understatIndex, subjectName);
        if (resolved) {
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
    if (matches.length === 0) return;

    for (const candidate of subjectCandidates) {
      const startingLine = candidate.line ?? 0.5;
      const entries = toHistoryEntries(matches, candidate.dimension, startingLine);
      if (entries.length === 0) continue;
      candidate.history = entries;
      candidate.sampleSize = entries.length;
      candidate.consistent = entries.every((e) => e.category === entries[0].category);
    }
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

  await attachRealHistory(candidates, league);

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
