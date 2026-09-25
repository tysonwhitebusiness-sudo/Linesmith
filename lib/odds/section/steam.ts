/**
 * Line moves, steam and the first mover (odds build P8, O4; the mockup's
 * `steam` / `moves`, F12: computed at read time from the books' main-line
 * history). Pure.
 *
 * A MOVE is one book changing its main line (side A). STEAM is three or more
 * books moving the same way within 45 minutes; its first mover is the book that
 * moved first. A book counts once per steam, and a move belongs to one steam.
 */
import type { HistPoint, MoveRow, SteamRow } from './types';

export const STEAM_WINDOW_MS = 45 * 60 * 1000;
export const STEAM_MIN_BOOKS = 3;

interface Ev { t: number; at: string; book: string; from: number; to: number; dir: number }

/** Every main-line move per book, oldest first. */
export function lineMoves(hist: Record<string, HistPoint[]>): MoveRow[] {
  return events(hist).map(e => [e.at, e.book, e.from, e.to]);
}

function events(hist: Record<string, HistPoint[]>): Ev[] {
  const out: Ev[] = [];
  for (const [book, pts] of Object.entries(hist)) {
    let prev: number | null = null;
    for (const p of pts) {
      const line = p[1];
      if (line == null) continue;
      if (prev != null && line !== prev) out.push({ t: Date.parse(p[0]), at: p[0], book, from: prev, to: line, dir: Math.sign(line - prev) });
      prev = line;
    }
  }
  return out.sort((a, b) => a.t - b.t || a.book.localeCompare(b.book));
}

/** Steam runs in one market's history, oldest first. */
export function detectSteam(hist: Record<string, HistPoint[]>): SteamRow[] {
  const evs = events(hist);
  const used = new Set<number>();
  const out: SteamRow[] = [];
  for (let i = 0; i < evs.length; i++) {
    if (used.has(i)) continue;
    const lead = evs[i];
    const idx = [i];
    const books = new Set([lead.book]);
    for (let j = i + 1; j < evs.length && evs[j].t - lead.t <= STEAM_WINDOW_MS; j++) {
      const e = evs[j];
      if (used.has(j) || e.dir !== lead.dir || books.has(e.book)) continue;
      books.add(e.book);
      idx.push(j);
    }
    if (books.size < STEAM_MIN_BOOKS) continue;
    for (const k of idx) used.add(k);
    const run = idx.map(k => evs[k]);
    out.push({ t: lead.at, dir: lead.dir, books: run.map(e => e.book), times: run.map(e => e.at), from: lead.from, to: run.map(e => e.to) });
  }
  return out;
}
