/**
 * The rules deep history adds on top of R2's merge — R12a. Pure: no database,
 * so every rule is tested on its own (`tests/deep-history.test.ts`).
 *
 * WHY R2'S MERGE IS NOT ENOUGH OVER A DEEP WINDOW. Measured 2026-09-19 (see
 * `docs/audit-2026-09-13/r12-deep-history-design.md`, R12a Step 0), diffing
 * every sport against the league's own schedule:
 *
 * - NBA, NFL, CFB, EPL, MLS and NHL match game for game — R2 is right there.
 * - `game_result` has no game-type column, and some sources carry preseason:
 *   MLB 2025 holds 67 spring-training games, NBA 2024-26 preseason games
 *   against overseas clubs. So rows are placed in their league-season window
 *   and anything outside one is dropped (`SEASON_WINDOWS`, generated).
 * - Two sources disagreeing on one game's score survive R2's merge twice. In
 *   the NBA and NHL (no doubleheaders) a same-date, same-pair disagreement is
 *   one game with one wrong score, and ESPN was the right one in every case
 *   checked. In MLB the same pattern is usually a real doubleheader, so MLB is
 *   settled by an authoritative source instead (`mlb_statsapi`, per season).
 * - Franchises moved: the Thrashers' rows are raw "Atlanta" with no id, the
 *   SuperSonics' raw "Seattle", and `game_result` stores Utah as 59 where the
 *   app uses 68. Operator's call (2026-09-19): relocations count toward the
 *   franchise that moved.
 */

import { SEASON_WINDOWS, type SeasonWindow } from './seasonWindows';

/** The fields these rules read; `GameResultRow` satisfies it. */
export interface DeepRow {
  sport: string;
  gameDate: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamRaw: string;
  awayTeamRaw: string;
  homeScore: number;
  awayScore: number;
  source: string;
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

interface Lineage {
  /** The id the app uses for the franchise today. */
  teamId: string;
  /** Other ids `game_result` stores it under. */
  aliasIds: string[];
  /** Raw names `game_result` left unresolved for it. */
  raws: string[];
}

export const LINEAGE: Record<string, Lineage[]> = {
  nhl: [
    // Atlanta Thrashers (1999-2011) -> Winnipeg Jets.
    { teamId: '52', aliasIds: [], raws: ['Atlanta', 'Atlanta Thrashers'] },
    // Utah Hockey Club (2024-25) and Utah Mammoth: `game_result` has 59; the app, 68.
    // Arizona (53) is NOT here: the NHL treats Utah as a new franchise.
    { teamId: '68', aliasIds: ['59'], raws: ['Utah Hockey Club', 'Utah Mammoth'] },
  ],
  nba: [
    // Seattle SuperSonics (to 2008) -> Oklahoma City Thunder.
    { teamId: '25', aliasIds: [], raws: ['Seattle', 'Seattle SuperSonics'] },
  ],
};

/** Every id and unresolved raw name one franchise appears under, for the SQL filter. */
export function lineageOf(sport: string, teamId: string): { ids: string[]; raws: string[] } {
  const l = (LINEAGE[sport] ?? []).find((x) => x.teamId === teamId || x.aliasIds.includes(teamId));
  return l ? { ids: [l.teamId, ...l.aliasIds], raws: l.raws } : { ids: [teamId], raws: [] };
}

function resolveSide(sport: string, id: string | null, raw: string): string | null {
  for (const l of LINEAGE[sport] ?? []) {
    if (id != null && l.aliasIds.includes(id)) return l.teamId;
    if (id == null && l.raws.includes(raw)) return l.teamId;
  }
  return id;
}

/** Rows with their franchise ids filled in and aliases folded — BEFORE the merge, whose key is the ids. */
export function applyLineage<T extends DeepRow>(rows: T[]): T[] {
  return rows.map((r) => {
    const home = resolveSide(r.sport, r.homeTeamId, r.homeTeamRaw);
    const away = resolveSide(r.sport, r.awayTeamId, r.awayTeamRaw);
    return home === r.homeTeamId && away === r.awayTeamId ? r : { ...r, homeTeamId: home, awayTeamId: away };
  });
}

// ---------------------------------------------------------------------------
// Game type
// ---------------------------------------------------------------------------

export type GamePhase = 'regular' | 'post';

const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Which league-season window a date falls in, and which part of it. One day of
 * slack after each end: ESPN dates a late game by UTC, so a finals game at
 * 8:30pm Eastern lands on the next day.
 *
 * `teams` (MLB, NHL): a game is preseason until BOTH teams have played their
 * own first regular-season game — the leagues open abroad days before everyone
 * else, so the league window alone let Winnipeg's and Utah's Oct 5 2024
 * preseason games in (83 games each). A team the window does not list is not
 * held back.
 */
export function phaseOf(sport: string, date: string, windows: Record<string, Record<number, SeasonWindow>> = SEASON_WINDOWS, teams: Array<string | null> = []): { season: number; phase: GamePhase } | null {
  const bySeason = windows[sport];
  if (!bySeason) return null;
  for (const [label, w] of Object.entries(bySeason)) {
    if (date < w.regularStart) continue;
    if (w.teamStart && teams.some((t) => t != null && w.teamStart![t] != null && date < w.teamStart![t]) && date <= dayAfter(w.regularEnd)) return null;
    if (date <= dayAfter(w.regularEnd)) return { season: Number(label), phase: 'regular' };
    if (w.postEnd && date <= dayAfter(w.postEnd)) return { season: Number(label), phase: 'post' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Exhibitions
// ---------------------------------------------------------------------------

/**
 * Pro leagues, where every real opponent has an id: after lineage, a side with
 * no id is an exhibition (All-Star teams, the 4 Nations' USA/Canada/Sweden/
 * Finland). NOT college football, whose unresolved rows are real games (South
 * Alabama's 12).
 */
const PRO = new Set(['mlb', 'nfl', 'nba', 'nhl']);

/** All-Star games that DO carry ids (ESPN's East/West All-Stars 31/32, "Team Chuck" 130579). */
const ALL_STAR = /all-?stars?\b|^team [a-z]+$/i;

export function isExhibition(r: DeepRow): boolean {
  if (ALL_STAR.test(r.homeTeamRaw) || ALL_STAR.test(r.awayTeamRaw)) return true;
  return PRO.has(r.sport) && (r.homeTeamId == null || r.awayTeamId == null);
}

/** Does this sport have windows at all? A sport without them (soccer) keeps every row. */
export const hasWindows = (sport: string, windows: Record<string, Record<number, SeasonWindow>> = SEASON_WINDOWS) => Boolean(windows[sport]);

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

/** Sports with no doubleheaders: two rows for one pair on one date are one game. */
const ONE_GAME_A_DAY = new Set(['nba', 'nhl']);

/** Who wins a score disagreement: ESPN matched the official score in every NBA case checked; `sbr` did not. */
const CONFLICT_RANK: Record<string, number> = { espn_core: 0, sbr: 1 };

/** The source that settles a whole MLB season, once the StatsAPI backfill has written it. */
export const MLB_AUTHORITY = 'mlb_statsapi';

const pairKey = (r: DeepRow) => [r.homeTeamId ?? `~${r.homeTeamRaw}`, r.awayTeamId ?? `~${r.awayTeamRaw}`].sort().join('|');

/**
 * After R2's merge: drop preseason and exhibition rows (outside every window,
 * for sports that have windows), settle same-date score disagreements where a
 * sport cannot play twice in a day, and let MLB's authoritative source stand
 * alone for any season it covers. Returns each kept row with its phase.
 */
export function refineDeepHistory<T extends DeepRow>(sport: string, rows: T[], windows: Record<string, Record<number, SeasonWindow>> = SEASON_WINDOWS): Array<T & { phase: GamePhase | null; season: number | null }> {
  const windowed = hasWindows(sport, windows);
  let kept: Array<T & { phase: GamePhase | null; season: number | null }> = [];
  for (const r of rows) {
    if (isExhibition(r)) continue;
    const p = phaseOf(sport, r.gameDate, windows, [r.homeTeamId, r.awayTeamId]);
    if (windowed && !p) continue;
    kept.push({ ...r, phase: p?.phase ?? null, season: p?.season ?? null });
  }

  if (ONE_GAME_A_DAY.has(sport)) {
    const groups = new Map<string, typeof kept>();
    for (const r of kept) {
      const k = `${r.gameDate}|${pairKey(r)}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    kept = [...groups.values()].flatMap((g) => {
      if (g.length < 2 || new Set(g.map((r) => r.source)).size < 2) return g;
      const best = [...g].sort((a, b) => (CONFLICT_RANK[a.source] ?? 9) - (CONFLICT_RANK[b.source] ?? 9))[0];
      return [best];
    });
  }

  if (sport === 'mlb') {
    const settled = new Set(kept.filter((r) => r.source === MLB_AUTHORITY && r.season != null).map((r) => r.season));
    if (settled.size) kept = kept.filter((r) => r.season == null || !settled.has(r.season) || r.source === MLB_AUTHORITY);
  }

  return kept.sort((a, b) => a.gameDate.localeCompare(b.gameDate));
}
