/**
 * Logs the merged game-lines result into game_odds_history — the durable
 * archive odds_cache never had, since it's a pure upsert. Called from
 * /api/odds/lines on every request; the write function itself dedupes
 * (log-on-change only), so calling this on a cache-hit response is harmless.
 */

import type { UnifiedGameLine } from './types';
import { decimalToAmerican } from './display';
import { writeGameOddsHistory, type GameOddsHistoryInput } from '../db/client';

export function logGameOddsHistory(lines: UnifiedGameLine[]): void {
  const rows: GameOddsHistoryInput[] = [];

  for (const line of lines) {
    // Best-available fields are populated straight from the-odds-api alone,
    // real book attribution and all — `bookmakers[]` below only fills in
    // when the OddsHarvester sidecar is actually running, which isn't
    // guaranteed, so this is the reliable source, not a fallback.
    if (line.moneyline?.home != null && line.moneyline.book) {
      rows.push({ eventId: line.eventId, market: 'moneyline', side: 'home', bookmaker: line.moneyline.book, americanOdds: line.moneyline.home, point: null });
    }
    if (line.moneyline?.away != null && line.moneyline.book) {
      rows.push({ eventId: line.eventId, market: 'moneyline', side: 'away', bookmaker: line.moneyline.book, americanOdds: line.moneyline.away, point: null });
    }
    if (line.total?.overPrice != null && line.total.point != null && line.total.book) {
      rows.push({ eventId: line.eventId, market: 'total', side: 'over', bookmaker: line.total.book, americanOdds: line.total.overPrice, point: line.total.point });
    }
    if (line.total?.underPrice != null && line.total.point != null && line.total.book) {
      rows.push({ eventId: line.eventId, market: 'total', side: 'under', bookmaker: line.total.book, americanOdds: line.total.underPrice, point: line.total.point });
    }

    for (const book of line.bookmakers ?? []) {
      const homeAmerican = decimalToAmerican(book.homeOdds);
      const awayAmerican = decimalToAmerican(book.awayOdds);
      if (homeAmerican != null) {
        rows.push({ eventId: line.eventId, market: 'moneyline', side: 'home', bookmaker: book.bookmaker, americanOdds: homeAmerican, point: null });
      }
      if (awayAmerican != null) {
        rows.push({ eventId: line.eventId, market: 'moneyline', side: 'away', bookmaker: book.bookmaker, americanOdds: awayAmerican, point: null });
      }

      const overAmerican = decimalToAmerican(book.overPrice);
      const underAmerican = decimalToAmerican(book.underPrice);
      if (overAmerican != null && book.point != null) {
        rows.push({ eventId: line.eventId, market: 'total', side: 'over', bookmaker: book.bookmaker, americanOdds: overAmerican, point: book.point });
      }
      if (underAmerican != null && book.point != null) {
        rows.push({ eventId: line.eventId, market: 'total', side: 'under', bookmaker: book.bookmaker, americanOdds: underAmerican, point: book.point });
      }
    }
  }

  writeGameOddsHistory(rows);
}
