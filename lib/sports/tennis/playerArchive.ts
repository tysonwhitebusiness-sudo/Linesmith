/**
 * One player's TennisMyLife matches — the read behind "Surface & serve"
 * (R6.4). The pure half is `playerArchiveShapes.ts`; this file value-imports
 * the season loader and is server-only.
 *
 * KEYED BY NAME. The archive is Sackmann's CSVs, which name players and carry
 * no id this app shares; `buildTennisSeasonContext` already indexes them by
 * normalised name, and the snapshot build resolves a candidate the same way.
 *
 * THREE SEASONS, because `player_game_history` starts at 2024-01-06 and the
 * page's other sections show the same span. Each season's rows are cached for
 * six hours by `fetchSeasonRows`, so this costs a parse, not three downloads.
 */

import { loadTennisSeasonContext, matchTennisIndex, type TennisMatch, type TennisTour } from './tennismylife';
import type { TennisArchiveMatch, TennisArchivePayload } from './playerArchiveShapes';

const SEASONS_HELD = 3;

const seasonOf = (iso: string) => Number(iso.slice(0, 4));

function toRow(m: TennisMatch): TennisArchiveMatch {
  return {
    date: m.date,
    season: seasonOf(m.date),
    tournamentName: m.tournamentName,
    surface: m.surface,
    level: m.level,
    round: m.round,
    opponent: m.opponent,
    isWinner: m.isWinner,
    rank: m.rank,
    aces: m.serve?.aces ?? m.aces ?? null,
    serve: m.serve
      ? { points: m.serve.servePoints, firstIn: m.serve.firstIn, firstWon: m.serve.firstWon, secondWon: m.serve.secondWon }
      : null,
    opponentServe: m.opponentServe
      ? { points: m.opponentServe.servePoints, firstWon: m.opponentServe.firstWon, secondWon: m.opponentServe.secondWon }
      : null,
  };
}

export async function getTennisArchive(tour: TennisTour, name: string, now: Date = new Date()): Promise<TennisArchivePayload | null> {
  const newest = now.getUTCFullYear();
  // `loadTennisSeasonContext` fetches a season and the one before it, so two
  // calls two years apart cover three seasons with no wasted download.
  const contexts = await Promise.all([loadTennisSeasonContext(tour, newest), loadTennisSeasonContext(tour, newest - (SEASONS_HELD - 1))]);

  // `matchTennisIndex` is the resolution the snapshot build already uses — the
  // same fuzzy floor, not a second copy of the rule beside it.
  const matches = new Map<string, TennisMatch>();
  let realName: string | null = null;
  let archiveLastDate: string | null = null;
  for (const ctx of contexts) {
    for (const entry of ctx.byName.values()) {
      for (const m of entry.matches) if (archiveLastDate == null || m.date > archiveLastDate) archiveLastDate = m.date;
    }
    const hit = matchTennisIndex(ctx, name);
    if (!hit || hit.length === 0) continue;
    realName = realName ?? nameOf(ctx, hit);
    for (const m of hit) matches.set(m.matchId, m);
  }
  if (!realName) return null;

  const rows = [...matches.values()].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order).map(toRow);

  return {
    name: realName,
    tour,
    seasons: [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b),
    matches: rows,
    archiveLastDate,
    asOf: new Date().toISOString(),
  };
}

/** The archive's own spelling, for the section to name what it matched. */
function nameOf(ctx: Awaited<ReturnType<typeof loadTennisSeasonContext>>, matches: readonly TennisMatch[]): string | null {
  for (const entry of ctx.byName.values()) if (entry.matches === matches) return entry.realName;
  return null;
}
