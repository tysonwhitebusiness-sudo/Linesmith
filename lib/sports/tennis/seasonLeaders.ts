/**
 * Tennis's replacement for golf's "Season SG leaders in this field" card —
 * same idea (season-long form, not tournament-specific), different real
 * source: `tennismylife.ts`'s already-fetched season match archive
 * (currently only read per-player) aggregated across every player in it,
 * plus a "how this tournament is playing" read straight off the draw data
 * the schedule page already fetches for the bracket card.
 */

import type { TennisSeasonContext } from './tennismylife';
import type { DrawMatch } from './schedule';

export type LeaderStat = 'aces' | 'gamesWon';

export interface SeasonLeaderRow {
  name: string;
  total: number;
  matchesPlayed: number;
  perMatch: number;
}

/** Ranks every player in an already-loaded season context by a season total/per-match average — no new fetch, `loadTennisSeasonContext` already pulled the full season. */
export function buildSeasonLeaders(context: TennisSeasonContext, stat: LeaderStat, limit = 10): SeasonLeaderRow[] {
  const rows: SeasonLeaderRow[] = [];
  for (const entry of context.byName.values()) {
    if (entry.matches.length === 0) continue;
    const total = entry.matches.reduce((sum, m) => sum + (stat === 'aces' ? m.aces : m.gamesWon), 0);
    rows.push({ name: entry.realName, total, matchesPlayed: entry.matches.length, perMatch: total / entry.matches.length });
  }
  return rows.sort((a, b) => b.total - a.total).slice(0, limit);
}

export interface TournamentConditions {
  completedCount: number;
  straightSetsCount: number;
  straightSetsPct: number;
  /**
   * Best-effort: ESPN gives no explicit retirement flag, so this counts a
   * completed match as a probable retirement only when its result text
   * contains "ret."/"w/o"/"walkover" — the common broadcast-style
   * abbreviations. Not verified live against a real retired match (none
   * happened to be live during this build), so treat the count as
   * indicative rather than exact until spot-checked against a real one.
   */
  probableRetirements: number;
}

export function computeTournamentConditions(matches: DrawMatch[]): TournamentConditions {
  const completed = matches.filter((m) => m.completed);
  let straightSets = 0;
  let retirements = 0;

  for (const m of completed) {
    const loser = m.home.winner ? m.away : m.home;
    const loserSetsWon = loser.sets.filter((s) => s.winner).length;
    if (loserSetsWon === 0 && loser.sets.length > 0) straightSets += 1;
    if (m.resultNote && /\b(ret\.?|w\/o|walkover)\b/i.test(m.resultNote)) retirements += 1;
  }

  return {
    completedCount: completed.length,
    straightSetsCount: straightSets,
    straightSetsPct: completed.length > 0 ? (straightSets / completed.length) * 100 : 0,
    probableRetirements: retirements,
  };
}
