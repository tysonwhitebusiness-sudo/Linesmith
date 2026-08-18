/**
 * Builds `GameLookupContext` (what a provider adapter needs to find "this
 * game" and resolve its players) straight from the already-cached MLB
 * snapshot — never a fresh fetch. The snapshot's `subjects` list is the
 * canonical roster update-09 § 6 requires provider names to resolve against.
 */

import { readSnapshotCache } from '@/lib/db/client';
import type { SportSnapshot } from '@/lib/core/types';
import type { GameLookupContext, RosterEntry } from './types';

const SNAPSHOT_CACHE_KEY = 'mlb:snapshot';

interface SlateGameLike {
  gamePk: number | string;
  matchup?: string;
  awayTeamName?: string;
  homeTeamName?: string;
  firstPitch?: string;
}

function readCachedSnapshot(): SportSnapshot | null {
  const cached = readSnapshotCache(SNAPSHOT_CACHE_KEY);
  if (!cached) return null;
  try {
    return JSON.parse(cached.payload) as SportSnapshot;
  } catch {
    return null;
  }
}

function buildContextForGame(snapshot: SportSnapshot, game: SlateGameLike): GameLookupContext | null {
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
  if (!game.awayTeamName || !game.homeTeamName || !awayAbbr || !homeAbbr) return null;

  const gameId = String(game.gamePk);
  const roster: RosterEntry[] = snapshot.subjects
    .filter((s) => (s.meta as Record<string, unknown> | undefined)?.gamePk === game.gamePk)
    .map((s) => ({
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      teamAbbr: typeof (s.meta as Record<string, unknown> | undefined)?.team === 'string'
        ? ((s.meta as Record<string, unknown>).team as string)
        : undefined,
    }));

  return {
    sport: 'mlb',
    gameId,
    awayTeamName: game.awayTeamName,
    homeTeamName: game.homeTeamName,
    awayAbbr,
    homeAbbr,
    gameDate: game.firstPitch ?? new Date().toISOString(),
    roster,
  };
}

/** Every game on today's cached slate, ready for a provider fetch. Empty if the snapshot hasn't loaded yet. */
export function loadAllGameContexts(): GameLookupContext[] {
  const snapshot = readCachedSnapshot();
  if (!snapshot) return [];
  const games = ((snapshot.context?.other as Record<string, unknown> | undefined)?.games ?? []) as SlateGameLike[];
  return games.map((g) => buildContextForGame(snapshot, g)).filter((c): c is GameLookupContext => c !== null);
}

export function loadGameContext(gameId: string): GameLookupContext | null {
  const snapshot = readCachedSnapshot();
  if (!snapshot) return null;
  const games = ((snapshot.context?.other as Record<string, unknown> | undefined)?.games ?? []) as SlateGameLike[];
  const game = games.find((g) => String(g.gamePk) === gameId);
  if (!game) return null;
  return buildContextForGame(snapshot, game);
}
