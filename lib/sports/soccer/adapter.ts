/**
 * Soccer adapter — builds a `SportSnapshot` for one league (EPL or MLS)
 * directly from real `prop_odds` rows, not from a player-history engine
 * like MLB's/NFL's adapters do.
 *
 * Why: MLB/NFL build candidates from real per-game stat history first,
 * with a real book price as an optional overlay. Soccer has no equivalent
 * per-match history source today — Understat (season-aggregate, big-5
 * leagues only) isn't a game-by-game log, and MLS/non-big-5 leagues have
 * no season-stats source confirmed at all (both real, open gaps per
 * docs/soccer-gameplan-2026-08-22.md §5, not something this file invents
 * a fix for). So every soccer candidate starts with `history: []` — an
 * honest "insufficient" state the windowed-stat engine already renders
 * correctly, not a placeholder waiting on code that doesn't exist yet.
 * Once a real per-match history source exists for a league, this is
 * where it plugs in.
 */

import type { PickCandidate, SportSnapshot, SubjectSummary, SoccerLeague } from '@/lib/core/types';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import { soccerTeamLogoByAbbr } from './espn';

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
