/**
 * Tying a slate of games to the lines fetched for them.
 *
 * The snapshot speaks in abbreviations ("BOS @ NYY") because that's what fits
 * on a phone; the odds feeds key on full team names. Both mappings are built
 * once here so the Context tab, the dense views and the player side panel all
 * agree about which line belongs to which game.
 */

import type { UnifiedGameLine } from './types';
import type { MoneylineResult } from '../sports/mlb/gameModel';

/** Same shape PlayerDetail's own OpposingStarterStat uses — declared independently (not imported) to avoid a components → lib → components import cycle; TypeScript's structural typing treats them as interchangeable. */
export interface StarterRankStat {
  key: string;
  label: string;
  value: number;
  decimals: number;
  rank: number;
  poolSize: number;
}

export interface SlateGame {
  gamePk?: number | string;
  matchup?: string;
  awayTeamName?: string;
  homeTeamName?: string;
  /** MLB team IDs for logo URLs. */
  awayTeamId?: number;
  homeTeamId?: number;
  state?: string;
  venue?: string;
  firstPitch?: string;
  awayStarter?: string;
  homeStarter?: string;
  /** P3 — each starter's own ERA/WHIP/K/BB/H/HR line with league rank, for the Probable Pitchers card. */
  awayStarterStats?: StarterRankStat[];
  homeStarterStats?: StarterRankStat[];
  /** Overall composite rank among all 250+ starters (see pitcherRankings.ts) — the "#N" shown next to a starter's name, same number as /diagnostics and the Bullpen card. Undefined until the Statcast-backed rankings have been computed at least once this season. */
  awayStarterOverallRank?: { rank: number | null; poolSize: number };
  homeStarterOverallRank?: { rank: number | null; poolSize: number };
  weather?: { tempF?: number; windMph?: number; windDir?: string; rainPct?: number };
  /** From the league feed, when the game is in progress. */
  liveScore?: { home: string; away: string };
  livePeriod?: string;
  /** G3 — Pythagorean + log5 moneyline model, computed server-side in adapter.ts. Null when either team lacks enough season data. */
  gameModel?: MoneylineResult | null;
}

/**
 * The score to show for a game.
 *
 * The league's own feed wins over the scraper's copy: it's the authority, it
 * updates on the snapshot cycle, and it's there whether or not the sidecar is
 * running. The scraper's score is the fallback for sports the snapshot doesn't
 * carry scores for.
 */
export function liveFor(entry: SlateEntry | undefined): {
  liveScore?: { home: string; away: string };
  livePeriod?: string;
} {
  if (!entry) return {};
  if (entry.game.liveScore) {
    return { liveScore: entry.game.liveScore, livePeriod: entry.game.livePeriod };
  }
  return { liveScore: entry.line?.liveScore, livePeriod: entry.line?.livePeriod };
}

export interface SlateEntry {
  game: SlateGame;
  line?: UnifiedGameLine;
  awayAbbrev?: string;
  homeAbbrev?: string;
}

export const teamKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/** Split "BOS @ NYY" without assuming the separator survived intact. */
function splitMatchup(matchup: string | undefined): [away?: string, home?: string] {
  if (!matchup) return [undefined, undefined];
  const parts = matchup.split('@').map((p) => p.trim());
  return parts.length === 2 ? [parts[0], parts[1]] : [undefined, undefined];
}

export interface Slate {
  entries: SlateEntry[];
  /** Team abbreviation → its game, so a player's team finds its own line. */
  byAbbrev: Map<string, SlateEntry>;
}

export function buildSlate(games: SlateGame[], lines: UnifiedGameLine[]): Slate {
  const byMatchup = new Map<string, UnifiedGameLine>();
  for (const line of lines) {
    byMatchup.set(`${teamKey(line.awayTeam)}@${teamKey(line.homeTeam)}`, line);
  }

  const entries: SlateEntry[] = [];
  const byAbbrev = new Map<string, SlateEntry>();

  for (const game of games) {
    const [awayAbbrev, homeAbbrev] = splitMatchup(game.matchup);
    const line =
      game.awayTeamName && game.homeTeamName
        ? byMatchup.get(`${teamKey(game.awayTeamName)}@${teamKey(game.homeTeamName)}`)
        : undefined;

    const entry: SlateEntry = { game, line, awayAbbrev, homeAbbrev };
    entries.push(entry);
    if (awayAbbrev) byAbbrev.set(awayAbbrev.toUpperCase(), entry);
    if (homeAbbrev) byAbbrev.set(homeAbbrev.toUpperCase(), entry);
  }

  return { entries, byAbbrev };
}

/** "3–5 B7"-style condensed live score for dense rows. */
export function abbreviateLive(entry: SlateEntry | undefined): string | null {
  const { liveScore, livePeriod } = liveFor(entry);
  if (!liveScore) return null;
  const period = livePeriod ?? '';
  // Only the common baseball form compresses safely; anything else is passed
  // through untouched, per the "render the period verbatim" rule.
  const inning = period.match(/^(top|bottom)\s+(\d+)/i);
  const short = inning ? `${inning[1][0].toUpperCase()}${inning[2]}` : period;
  return `${liveScore.away}–${liveScore.home}${short ? ` ${short}` : ''}`;
}
