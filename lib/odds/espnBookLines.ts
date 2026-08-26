/**
 * Recasts ESPN's single-book pregame line (CFB/NBA/Soccer's real, already-
 * fetched moneyline/total data — lib/sports/{cfb,nba,soccer}/espn.ts's own
 * CfbPregameLine/NbaPregameLine/SoccerPregameLine) into the shared
 * game_odds_book_lines schema every other source already writes into
 * (2026-08-26, odds-architecture rebuild Phase 3) — so the eventual
 * bookmaker-grid read side never needs a sport-specific case for "only has
 * one book," it's just another `source='espn'` row.
 *
 * Spread is deliberately NOT written here: ESPN's summary endpoint only
 * ever returns the spread's point number (see CfbPregameLine.spread), never
 * a real price for it — moneylineHome/Away and overOdds/underOdds are the
 * only fields that carry an actual quoted price. Fabricating a -110
 * placeholder to satisfy game_odds_book_lines.american_odds's NOT NULL
 * constraint would be exactly the kind of invented field this codebase's
 * own sport-adapter convention (CLAUDE.md) forbids — a sport/market
 * combination with no real price simply writes no row for it.
 */
import { writeGameOddsBookLines, type GameOddsBookLineInput } from '../db/client';

export interface EspnPregameLineForBookLines {
  book: string;
  moneylineHome: number | null;
  moneylineAway: number | null;
  moneylineDraw?: number | null;
  overUnder: number | null;
  overOdds: number | null;
  underOdds: number | null;
}

export function espnPregameLineToBookLines(
  sport: string,
  gameId: string,
  line: EspnPregameLineForBookLines | null,
): GameOddsBookLineInput[] {
  if (!line) return [];
  const rows: GameOddsBookLineInput[] = [];
  const bookmaker = line.book || 'Unknown';

  if (line.moneylineHome != null) {
    rows.push({ sport, gameId, market: 'moneyline', side: 'home', bookmaker, source: 'espn', americanOdds: line.moneylineHome });
  }
  if (line.moneylineAway != null) {
    rows.push({ sport, gameId, market: 'moneyline', side: 'away', bookmaker, source: 'espn', americanOdds: line.moneylineAway });
  }
  if (line.moneylineDraw != null) {
    rows.push({ sport, gameId, market: 'moneyline', side: 'draw', bookmaker, source: 'espn', americanOdds: line.moneylineDraw });
  }
  if (line.overOdds != null && line.overUnder != null) {
    rows.push({ sport, gameId, market: 'total', side: 'over', bookmaker, source: 'espn', americanOdds: line.overOdds, point: line.overUnder });
  }
  if (line.underOdds != null && line.overUnder != null) {
    rows.push({ sport, gameId, market: 'total', side: 'under', bookmaker, source: 'espn', americanOdds: line.underOdds, point: line.overUnder });
  }
  return rows;
}

/** Best-effort: a write failure here must never break the page's real
 * response — this is a side write, not the data the caller actually
 * needed. Matches python-odds-service/src/db.py's own non-fatal-write
 * contract for the same reasons (write_job_run_log, write_health_check_
 * results). */
export async function recordEspnPregameLine(
  sport: string,
  gameId: string,
  line: EspnPregameLineForBookLines | null,
): Promise<void> {
  const rows = espnPregameLineToBookLines(sport, gameId, line);
  if (rows.length === 0) return;
  try {
    await writeGameOddsBookLines(rows);
  } catch (error) {
    console.error(`[espnBookLines] write failed for ${sport} game ${gameId} (non-fatal):`, error);
  }
}
