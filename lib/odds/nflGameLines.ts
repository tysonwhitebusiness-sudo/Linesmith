/**
 * NFL game-level lines (moneyline/spread/total) — merges SharpAPI (unmetered
 * board, primary) and TheRundown (today's date, supplemental depth) into the
 * same `UnifiedGameLine[]` shape MLB's `mergeLines` produces, so `GameDetail`-
 * style consumers (`buildSlate`, `useGameLines`) work unmodified for NFL.
 *
 * SportsGameOdds deliberately isn't folded in here: its game-level odds ride
 * the same per-event, per-team-pair call already billed per "1 object per
 * event" (see `getSportsGameOddsGameLine` in
 * `props/providers/sportsGameOdds.ts`), and this module is called by the
 * slate-wide, 3-minute-polling `useGameLines` hook — pulling SGO here would
 * bill it on every poll for every game, breaking the "Tier 2, user-triggered
 * only" budget discipline already established for that provider's player
 * props. SportsGameOdds is instead called once, on-demand, by
 * `app/api/nfl/game/[gameId]/route.ts` for the one game a Game Detail page
 * actually shows.
 */

import { getSharpApiGameLines } from './props/providers/sharpapi';
import { getRundownGameLines, toGameLine } from './rundown';
import type { UnifiedGameLine } from './types';

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

function matchupKey(away: string, home: string): string {
  return `${norm(away)}@${norm(home)}`;
}

export interface NflGameLinesResult {
  enabled: boolean;
  lines: UnifiedGameLine[];
  fetchedAt: string | null;
  fromCache: boolean;
  sources: {
    sharpapi: { enabled: boolean; count: number };
    rundown: { enabled: boolean; count: number };
  };
  nextRefreshAt: string | null;
  warnings: string[];
}

// Every NFL page mounts `useGameLines`, which hits this on load and again
// whenever the snapshot refreshes — with no cache here, that meant a live,
// throttled (1 req/sec) TheRundown network call on every single one of
// those, on top of whatever SharpAPI's own 90s board cache already saves.
// Matches the same short-TTL in-process cache pattern SharpAPI's board uses.
const CACHE_TTL_MS = 60_000;
let cached: { fetchedAt: number; result: NflGameLinesResult } | null = null;

export async function getNflGameLines(): Promise<NflGameLinesResult> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { ...cached.result, fromCache: true };
  }

  const today = new Date().toISOString().slice(0, 10);

  const [sharp, rundown] = await Promise.all([
    getSharpApiGameLines('nfl'),
    getRundownGameLines('nfl', today),
  ]);

  const byMatchup = new Map<string, UnifiedGameLine>();

  // Pass 1: SharpAPI seeds the board — it's the only source here that
  // returns every game on the slate in one unmetered call.
  for (const line of sharp.lines) {
    byMatchup.set(matchupKey(line.awayTeam, line.homeTeam), {
      eventId: line.eventId,
      commenceTime: line.commenceTime,
      homeTeam: line.homeTeam,
      awayTeam: line.awayTeam,
      moneyline: line.moneyline,
      spread: line.spread,
      total: line.total,
      bookmakers: [],
      bookCount: line.bookCount,
      source: 'sharpapi',
    });
  }

  // Pass 2: TheRundown fills gaps for today's games only (its own endpoint
  // is date-scoped, not slate-wide) and bumps bookCount where both agree.
  for (const rundownLine of rundown.lines) {
    const gameLine = toGameLine(rundownLine);
    const key = matchupKey(gameLine.awayTeam, gameLine.homeTeam);
    const existing = byMatchup.get(key);

    if (existing) {
      if (!existing.moneyline && gameLine.moneyline) existing.moneyline = gameLine.moneyline;
      if (!existing.spread && gameLine.spread) existing.spread = gameLine.spread;
      if (!existing.total && gameLine.total) existing.total = gameLine.total;
      existing.bookCount = Math.max(existing.bookCount, gameLine.bookCount);
      existing.source = 'multiple';
    } else {
      byMatchup.set(key, {
        eventId: gameLine.eventId,
        commenceTime: gameLine.commenceTime,
        homeTeam: gameLine.homeTeam,
        awayTeam: gameLine.awayTeam,
        moneyline: gameLine.moneyline,
        spread: gameLine.spread,
        total: gameLine.total,
        bookmakers: [],
        bookCount: gameLine.bookCount,
        source: 'rundown',
      });
    }
  }

  const lines = [...byMatchup.values()];
  const warnings = [...sharp.warnings, ...rundown.warnings];

  const result: NflGameLinesResult = {
    enabled: true,
    lines,
    fetchedAt: sharp.fetchedAt ?? new Date().toISOString(),
    fromCache: false,
    sources: {
      sharpapi: { enabled: sharp.warnings.length === 0, count: sharp.lines.length },
      rundown: { enabled: rundown.warnings.length === 0, count: rundown.lines.length },
    },
    nextRefreshAt: null,
    warnings,
  };
  cached = { fetchedAt: Date.now(), result };
  return result;
}
