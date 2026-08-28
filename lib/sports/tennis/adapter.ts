/**
 * Tennis adapter — builds a `SportSnapshot` for one tour (ATP or WTA)
 * directly from real `prop_odds` rows, same shape as `lib/sports/soccer/adapter.ts`
 * and `lib/sports/cfb/adapter.ts` (both also read straight from prop_odds
 * rather than a per-sport player-history engine like MLB's).
 *
 * Real per-match history: `lib/sports/tennis/tennismylife.ts`
 * (stats.tennismylife.org), confirmed live per
 * docs/multi-sport-expansion-audit-2026-08-22.md §4. All three of tennis's
 * real market keys (aces, games-won, to-win-a-set — see
 * lib/odds/props/entityResolution.ts's tennis MARKET_KEY_ALIASES block,
 * live-verified against SharpAPI's own stat_category values) have a real
 * per-match field in that source, unlike soccer where most markets had none
 * — so every tennis candidate that resolves a name match gets real history,
 * not a partial subset.
 *
 * No team concept (same honest gap golf already documents) — `subjectMeta`
 * carries the opponent's plain name instead of an abbreviation/logo.
 */

import type { HistoryEntry, PickCandidate, SportSnapshot, SubjectSummary, TennisTour } from '@/lib/core/types';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { shortDate } from '@/lib/core/windowedStat';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { currentTennisSeason, loadTennisSeasonContext, matchTennisIndex, type TennisMatch } from './tennismylife';

const TOUR_TO_SPORT_KEY: Record<TennisTour, 'tennis_atp' | 'tennis_wta'> = {
  atp: 'tennis_atp',
  wta: 'tennis_wta',
};

const MARKET_META: Record<string, { label: string; kind: 'binary' | 'threshold' }> = {
  aces: { label: 'Aces', kind: 'threshold' },
  'games-won': { label: 'Games Won', kind: 'threshold' },
  'to-win-a-set': { label: 'To Win a Set', kind: 'binary' },
};

const HISTORY_FIELD: Record<string, (m: TennisMatch) => number> = {
  aces: (m) => m.aces,
  'games-won': (m) => m.gamesWon,
  'to-win-a-set': (m) => (m.wonAtLeastOneSet ? 1 : 0),
};

function bestRow(rows: PropOddsRow[], side: string): PropOddsRow | null {
  const matching = rows.filter((r) => r.side === side);
  if (matching.length === 0) return null;
  return matching.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best), matching[0]);
}

function toHistoryEntries(matches: TennisMatch[], marketKey: string, startingLine: number): HistoryEntry[] {
  const field = HISTORY_FIELD[marketKey];
  if (!field) return [];
  return matches.map((m, i) => {
    const value = field(m);
    return {
      period: i + 1,
      result: String(value),
      category: value > startingLine ? 'over' : 'under',
      periodLabel: `${shortDate(m.date)} vs ${m.opponent}`,
      raw: { opponentName: m.opponent, date: m.date, tournamentName: m.tournamentName, surface: m.surface, isWinner: m.isWinner, aces: m.aces, gamesWon: m.gamesWon, gamesLost: m.gamesLost, wonAtLeastOneSet: m.wonAtLeastOneSet },
    } satisfies HistoryEntry;
  });
}

/** Runs `fn` over `items` with at most `limit` in flight — same rate-limiting courtesy soccer's adapter.ts extends to Understat/ASA, extended here even though tennismylife's per-player resolution is pure in-memory (loadTennisSeasonContext already did the one real network fetch) — kept for consistency and because a future per-player fetch source wouldn't need this function's shape to change. */
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

async function attachRealHistory(candidates: PickCandidate[], tour: TennisTour, subjectsMap?: Map<string, SubjectSummary>): Promise<void> {
  const eligibleSubjects = new Map<string, PickCandidate[]>();
  for (const c of candidates) {
    const bucket = eligibleSubjects.get(c.subjectId) ?? [];
    bucket.push(c);
    eligibleSubjects.set(c.subjectId, bucket);
  }
  if (eligibleSubjects.size === 0) return;

  const season = currentTennisSeason();
  const context = await loadTennisSeasonContext(tour, season);

  await mapWithConcurrency([...eligibleSubjects.entries()], 5, async ([subjectId, subjectCandidates]) => {
    const subjectName = subjectCandidates[0].subjectName;
    const matches = matchTennisIndex(context, subjectName);
    if (!matches || matches.length === 0) return;

    for (const candidate of subjectCandidates) {
      const startingLine = candidate.line ?? 0.5;
      const entries = toHistoryEntries(matches, candidate.dimension, startingLine);
      if (entries.length === 0) continue;
      candidate.history = entries;
      candidate.sampleSize = entries.length;
      candidate.consistent = entries.every((e) => e.category === entries[0].category);
    }

    // Real per-player season line for the Players-tab sidebar list
    // (2026-08-24) — same role MLB's/NFL's own subjects carry via
    // `statusLine`, just never populated for tennis before.
    const subject = subjectsMap?.get(subjectId);
    if (subject && !subject.statusLine) {
      const wins = matches.filter((m) => m.isWinner).length;
      const avgAces = matches.reduce((s, m) => s + m.aces, 0) / matches.length;
      subject.statusLine = `${wins}-${matches.length - wins} · ${avgAces.toFixed(1)} aces/match`;
    }
  });
}

/**
 * Real, honestly-priceless candidates for every market this sport tracks —
 * for a player with no real `prop_odds` row on today's slate. Same contract
 * as NHL's/NBA's `buildSyntheticPlayerCandidates`: `odds` stays undefined
 * so PlayerDetail's existing "Add to slip to record a price" empty state
 * renders; only the LINE is synthetic (real-history average for the two
 * threshold markets, real 0.5 split for the binary "to-win-a-set" market —
 * same 0.5-threshold trick `toHistoryEntries` already uses for real
 * binary candidates). `loadTennisSeasonContext` already merges current +
 * prior season on its own, so no extra off-season fallback is needed here.
 */
export async function buildSyntheticPlayerCandidates(subjectId: string, subjectName: string, tour: TennisTour): Promise<PickCandidate[]> {
  const context = await loadTennisSeasonContext(tour, currentTennisSeason());
  // Real full history — `loadTennisSeasonContext` already merges the
  // current + prior real season (see its own doc comment), and there's no
  // reason to throw most of it away before building candidates; every
  // other sport's synthetic-candidate builder uses its full real fetched
  // history the same way (2026-08-24 fix — this used to cap at the last 25
  // matches for no real reason, understating a full season's real sample).
  const matches = matchTennisIndex(context, subjectName) ?? [];

  return Object.entries(MARKET_META).map(([marketKey, meta]) => {
    const field = HISTORY_FIELD[marketKey];
    const values = matches.map(field);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    const defaultLine = meta.kind === 'binary' ? 0.5 : Math.max(0.5, Math.round(avg * 2) / 2);
    const entries = toHistoryEntries(matches, marketKey, defaultLine);
    const category = meta.kind === 'binary' ? 'yes' : 'over';
    const categoryLabel = meta.kind === 'binary' ? 'Yes' : 'Over';

    return {
      sport: 'tennis',
      subjectId,
      subjectName,
      subjectMeta: { tour, league: tour },
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

export async function buildTennisSnapshot(tour: TennisTour): Promise<SportSnapshot> {
  const sportKey = TOUR_TO_SPORT_KEY[tour];
  const games = await loadGameContextsForSport(sportKey);
  const candidates: PickCandidate[] = [];
  const subjectsMap = new Map<string, SubjectSummary>();
  const warnings: string[] = [];

  for (const game of games) {
    // Real players, browsable regardless of whether a sportsbook has
    // posted a real prop for this match yet — a scheduled ATP/WTA match's
    // two real players are already known from `loadGameContextsForSport`'s
    // own real roster, no reason to gate that on `prop_odds` having a row.
    // Real bug found 2026-08-23: subjects only ever populated from inside
    // the prop-rows loop below, so with zero real tennis prop_odds rows
    // (the Python SharpAPI job's first live run hasn't happened yet), the
    // Players tab showed nobody at all despite real live matches existing.
    for (const entry of game.roster) {
      if (subjectsMap.has(entry.subjectId)) continue;
      const opponentEntry = game.roster.find((r) => r.subjectId !== entry.subjectId);
      subjectsMap.set(entry.subjectId, {
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        meta: { opponent: opponentEntry?.subjectName, tour, gamePk: game.gameId, gameDate: game.gameDate },
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
        warnings.push(`Unrecognized tennis market key "${marketKey}" — skipped.`);
        continue;
      }
      const rosterEntry = rosterBySubjectId.get(subjectId);
      const subjectName = rosterEntry?.subjectName ?? marketRows[0].subjectName;
      const opponentEntry = game.roster.find((r) => r.subjectId !== subjectId);
      const opponentName = opponentEntry?.subjectName;

      const best = bestRow(marketRows, 'over') ?? bestRow(marketRows, 'yes') ?? marketRows[0];
      // Binary market ("to-win-a-set") gets `line: undefined`, same
      // real-book-row-matching reasoning soccer's adapter documents — a
      // fabricated 0.5 line would fail propOddsBoard's exact `row.line ===
      // line` match against real book rows.
      const line = meta.kind === 'binary' ? undefined : (best.line ?? undefined);
      const category = meta.kind === 'binary' ? 'yes' : 'over';
      const categoryLabel = meta.kind === 'binary' ? 'Yes' : 'Over';

      candidates.push({
        sport: 'tennis',
        subjectId,
        subjectName,
        subjectMeta: {
          opponent: opponentName,
          gamePk: game.gameId,
          tour,
          league: tour,
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
          meta: { opponent: opponentName, tour },
        });
      }
    }
  }

  await attachRealHistory(candidates, tour, subjectsMap);

  return {
    sport: 'tennis',
    eventName: tour === 'atp' ? 'ATP Tour' : 'WTA Tour',
    eventDetail: null,
    status: 'pre',
    candidates,
    subjects: [...subjectsMap.values()],
    context: {
      other: {
        games: games.map((g) => ({
          gamePk: g.gameId,
          matchup: `${g.awayTeamName} vs ${g.homeTeamName}`,
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
  const start = Date.parse(gameDate);
  const now = Date.now();
  if (!Number.isFinite(start)) {
    return { status: 'unknown' as const, distanceToSubject: null, distanceUnit: 'games' as const, etaMinutes: null, etaConfidence: null };
  }
  if (now < start) {
    const hoursOut = Math.round((start - now) / 3_600_000);
    return { status: 'pre' as const, distanceToSubject: 1, distanceUnit: 'games' as const, etaMinutes: hoursOut * 60, etaConfidence: 'measured' as const };
  }
  return { status: 'done' as const, distanceToSubject: 0, distanceUnit: 'games' as const, etaMinutes: null, etaConfidence: null };
}
