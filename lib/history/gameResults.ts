/**
 * The one read path for `game_result` — R2.
 *
 * WHY THIS EXISTS. `game_result` holds 185,161 rows from up to four sources
 * per sport, and they overlap. Every page that counted rows instead of games
 * over-counted: a real NFL team page showed home and away records totalling 13
 * games each under a 0-0 season (F-B2), and the Raiders came back as 69 rows
 * for 52 games.
 *
 * MEASURED FIRST, 2026-09-14, before a line of this was written — because the
 * measurements decided the design and two of them contradicted the obvious
 * approach:
 *
 * 1. **De-duplicate on TEAM IDS, never on names.** Keying duplicate detection
 *    on `home_team_raw`/`away_team_raw` finds 1,829 pairs in MLB and **zero**
 *    in NFL, CFB and NBA. Re-keyed on `home_team_id`/`away_team_id` the same
 *    window yields 285 NFL, 950 CFB and 118 NBA pairs — and in all three
 *    sports **100% of those pairs have different raw names**. Sources spell
 *    the same team differently every single time ("LAC @ LV" against
 *    "Los Angeles Chargers @ Las Vegas Raiders"), so a name-keyed rule finds
 *    nothing precisely where the duplicates are.
 *
 * 2. **±1 day is load-bearing, not a safety margin.** Of the duplicate pairs
 *    since 2023, 568 MLB, 250 MLS, 98 NBA and 60 NFL are dated a day apart —
 *    evening starts recorded against the UTC date by one source and the local
 *    date by another. A date-exact rule misses every one of them.
 *
 * 3. **Team ids are effectively complete for team sports and absent for
 *    tennis.** Fill rate since 2023: MLB/NFL/EPL/MLS 100%, NBA 100%, CFB
 *    99.8%, NHL 98.2% — but `tennis_data` is **0%**, and only tennis's small
 *    `live_capture` slice has ids at all. So tennis cannot use the id path and
 *    falls back to normalized names, which is safe there for the reason it is
 *    unsafe elsewhere: one source supplies almost every tennis row, so there
 *    is little cross-source spelling to reconcile.
 *
 * 4. **NHL has no cross-source duplicates in this window at all** (0 pairs).
 *    Its second source, `sbr`, stops in 2022. The module does no work there
 *    and should not be "fixed" into finding some.
 *
 * The rule reproduces the plan's own fixture exactly: the Raiders go from 71
 * rows to **54 games**, dropping 17 duplicates — the same 17-row gap the audit
 * measured at 69/52, two games further into the season.
 */

import { pgAll } from '@/lib/db/pgClient';
import { applyLineage, lineageOf, refineDeepHistory, type GamePhase } from './deepHistory';

/** One real game, after de-duplication. */
export interface GameResultRow {
  id: number;
  sport: string;
  gameDate: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeTeamRaw: string;
  awayTeamRaw: string;
  homeScore: number;
  awayScore: number;
  venue: string | null;
  source: string;
  eventStart: string | null;
  /** R12a: regular season or playoffs, from the league-season windows; null where a sport has none (soccer). */
  phase?: GamePhase | null;
  /** R12a: this app's season label for the game, where a window placed it. */
  season?: number | null;
}

/**
 * Which source to keep when two rows describe the same game.
 *
 * Deterministic on purpose. "Whichever the database returned first" is how
 * `/api/props/reference-points` ended up non-deterministic (Phase 5), and a
 * record that changes between two loads of the same page is worse than one
 * that is consistently drawn from the same source.
 *
 * `live_capture` ranks last despite being the freshest: it is written during
 * the game, so its score can be a score-in-progress, while the bulk sources
 * write finals. Where both exist the final is the one to keep.
 */
const SOURCE_RANK: Record<string, number> = {
  // R12a: MLB's own finals outrank every other source. Ranked below them, a
  // StatsAPI row lost R2's merge to its `mlb_long_csv` twin, and the season's
  // authority rule then dropped the survivor — whole seasons read as 3 games.
  mlb_statsapi: -1,
  nflverse: 0,
  cfbd: 0,
  mlb_long_csv: 0,
  footballdata: 0,
  tennis_data: 0,
  sbr: 1,
  sbr_mlb: 1,
  espn_core: 2,
  live_capture: 3,
};

function rankOf(source: string): number {
  return SOURCE_RANK[source] ?? 2;
}

/**
 * The identity two rows must share to be the same game: both team ids where
 * they exist, else both normalized names. Scores are compared separately so a
 * genuine doubleheader — same teams, same day, different scores — stays two
 * games.
 */
function identityKey(r: GameResultRow): string {
  if (r.homeTeamId && r.awayTeamId) return `id:${r.homeTeamId}|${r.awayTeamId}`;
  return `nm:${normalize(r.homeTeamRaw)}|${normalize(r.awayTeamRaw)}`;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function daysApart(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Math.round(ms / 86_400_000);
}

/**
 * Collapses rows describing the same game.
 *
 * Exported so tests can run it over real rows without a database, and so a
 * caller that already has rows in hand (a backfill, a diagnostic) uses the
 * same rule rather than a second copy of it.
 *
 * Two rows are the same game when they share an identity key, both scores,
 * and fall within one day of each other. Within a group the
 * lowest-`SOURCE_RANK` row wins, ties broken by the lower id, so the answer
 * does not depend on the order rows arrive in.
 */
export function dedupeGameResults(rows: GameResultRow[]): GameResultRow[] {
  const sorted = [...rows].sort(
    (a, b) => a.gameDate.localeCompare(b.gameDate) || rankOf(a.source) - rankOf(b.source) || a.id - b.id,
  );
  const kept: GameResultRow[] = [];
  for (const row of sorted) {
    const key = identityKey(row);
    const existing = kept.find(
      (k) =>
        // R12a: two rows from ONE source are two games. The ±1-day window
        // otherwise merged back-to-back games of a series that ended with the
        // same score (measured over MLB's official finals: 2010 read 2,442 of
        // 2,462).
        k.source !== row.source &&
        identityKey(k) === key &&
        k.homeScore === row.homeScore &&
        k.awayScore === row.awayScore &&
        daysApart(k.gameDate, row.gameDate) <= 1,
    );
    if (!existing) {
      kept.push(row);
      continue;
    }
    // A better-ranked row for a game already kept replaces it in place, so the
    // result is the same whatever order the rows came in.
    const better = rankOf(row.source) < rankOf(existing.source) || (rankOf(row.source) === rankOf(existing.source) && row.id < existing.id);
    if (better) kept[kept.indexOf(existing)] = row;
  }
  return kept.sort((a, b) => a.gameDate.localeCompare(b.gameDate) || a.id - b.id);
}

export interface ReadGameResultsOptions {
  sport: string;
  /** Either side. Omit to read the whole sport for the date range. */
  teamId?: string;
  /** Inclusive ISO dates. `from` defaults to the start of the 2023 season. */
  from?: string;
  to?: string;
}

/**
 * Real, de-duplicated results for one sport (and optionally one team).
 *
 * Filtering happens in Postgres and de-duplication in memory, deliberately:
 * the ±1-day rule is a self-join in SQL and a linear pass here, and a team's
 * whole result history since 2023 is tens of rows, not thousands. The widest
 * real call — a full sport, all seasons in range — is a few thousand.
 */
export async function readGameResults(opts: ReadGameResultsOptions): Promise<GameResultRow[]> {
  const { sport, teamId, from = '2023-01-01', to } = opts;
  const params: unknown[] = [sport, from];
  let sql = `
    SELECT id, sport, game_date, home_team_id, away_team_id, home_team_raw, away_team_raw,
           home_score, away_score, venue, source, event_start
      FROM game_result
     WHERE sport = $1
       AND game_date >= $2
       AND home_score IS NOT NULL AND away_score IS NOT NULL`;
  if (to) {
    params.push(to);
    sql += ` AND game_date <= $${params.length}`;
  }
  if (teamId) {
    // Every id and unresolved name the franchise is stored under (R12a lineage:
    // the Thrashers' rows are raw "Atlanta" with no id; Utah is 59 in the table).
    const { ids, raws } = lineageOf(sport, teamId);
    params.push(ids);
    const idsAt = params.length;
    sql += ` AND (home_team_id = ANY($${idsAt}) OR away_team_id = ANY($${idsAt})`;
    if (raws.length) {
      params.push(raws);
      sql += ` OR (home_team_id IS NULL AND home_team_raw = ANY($${params.length})) OR (away_team_id IS NULL AND away_team_raw = ANY($${params.length}))`;
    }
    sql += ')';
  }
  sql += ' ORDER BY game_date, id';

  const raw = await pgAll<{
    id: number;
    sport: string;
    game_date: Date | string;
    home_team_id: string | null;
    away_team_id: string | null;
    home_team_raw: string;
    away_team_raw: string;
    home_score: number;
    away_score: number;
    venue: string | null;
    source: string;
    event_start: Date | string | null;
  }>(sql, params);

  const merged = dedupeGameResults(
    applyLineage(raw.map((r) => ({
      id: r.id,
      sport: r.sport,
      gameDate: typeof r.game_date === 'string' ? r.game_date.slice(0, 10) : r.game_date.toISOString().slice(0, 10),
      homeTeamId: r.home_team_id,
      awayTeamId: r.away_team_id,
      homeTeamRaw: r.home_team_raw,
      awayTeamRaw: r.away_team_raw,
      homeScore: r.home_score,
      awayScore: r.away_score,
      venue: r.venue,
      source: r.source,
      eventStart: r.event_start == null ? null : typeof r.event_start === 'string' ? r.event_start : r.event_start.toISOString(),
    }))),
  );
  // R12a: preseason out, playoffs marked, same-date conflicts settled, MLB's
  // authoritative source standing alone where it covers a season.
  return refineDeepHistory(sport, merged);
}

/**
 * A team's W-L record over de-duplicated results.
 *
 * Draws are counted, never folded into losses (F-B8) — `formatTeamRecord` in
 * `lib/sports/shared/teamRecord.ts` renders whichever shape the sport has.
 */
export function recordFromResults(rows: GameResultRow[], teamId: string): { wins: number; losses: number; draws: number } {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const r of rows) {
    const isHome = r.homeTeamId === teamId;
    const isAway = r.awayTeamId === teamId;
    if (!isHome && !isAway) continue;
    const forScore = isHome ? r.homeScore : r.awayScore;
    const againstScore = isHome ? r.awayScore : r.homeScore;
    if (forScore > againstScore) wins += 1;
    else if (forScore < againstScore) losses += 1;
    else draws += 1;
  }
  return { wins, losses, draws };
}
