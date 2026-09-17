/**
 * A game's player props at their main line as they stood at the start — R8.
 * Every sport's game page reads its props through here (MLB since R8.1,
 * football since R8.2), then resolves each against its own box score.
 *
 * The rule is R2's `pickMainLine`, per player and market. A market quoted only
 * at alternate lines is counted, not shown. A yes/no market (anytime scorer) has
 * no line; it comes back in `yesNo` with its best yes price (R8.3: soccer's
 * props are mostly these).
 *
 * Pure: takes rows already read (`readPreGamePropOddsForGame`).
 */

import type { PropOddsRow } from '@/lib/db/client';
import { pickMainLine } from './mainLine';

export interface GameMainLine {
  playerId: string;
  name: string;
  market: string;
  line: number;
  over: { price: number; book: string };
  under: { price: number; book: string } | null;
  /** Books quoting both sides of the line. One is a price, not a market; pages show two or more. */
  books: number;
}

export interface GameYesNo {
  playerId: string;
  name: string;
  market: string;
  /** The best "yes" price among counted books. */
  yes: { price: number; book: string };
  books: number;
}

export function gameMainLines(rows: PropOddsRow[], startIso: string, now: number = Date.now()): { lines: GameMainLine[]; yesNo: GameYesNo[]; altOnly: number } {
  const groups = new Map<string, PropOddsRow[]>();
  for (const r of rows) {
    const k = `${r.subjectId}|${r.marketKey}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const lines: GameMainLine[] = [];
  const yesNo: GameYesNo[] = [];
  let altOnly = 0;
  for (const g of groups.values()) {
    const main = pickMainLine(g, startIso, { now });
    if (main.kind === 'alternates-only') altOnly++;
    if (main.kind === 'yes-no') {
      yesNo.push({ playerId: g[0].subjectId, name: g[0].subjectName, market: g[0].marketKey, yes: { price: main.over.americanOdds, book: main.over.bookmaker }, books: main.books });
      continue;
    }
    if (main.kind !== 'main') continue;
    lines.push({
      playerId: g[0].subjectId,
      name: g[0].subjectName,
      market: g[0].marketKey,
      line: main.line,
      over: { price: main.over.americanOdds, book: main.over.bookmaker },
      under: main.under ? { price: main.under.americanOdds, book: main.under.bookmaker } : null,
      books: main.twoSidedBooks,
    });
  }
  lines.sort((a, b) => a.name.localeCompare(b.name) || a.market.localeCompare(b.market));
  yesNo.sort((a, b) => a.name.localeCompare(b.name) || a.market.localeCompare(b.market));
  return { lines, yesNo, altOnly };
}
