/**
 * `GameLookupContext[]` for the four non-MLB sports, built directly from
 * ESPN (lib/sports/multiSport/*) rather than a per-sport StatsAPI-equivalent
 * — mirrors gameContext.ts's job for MLB. Each call still fetches fresh from
 * ESPN for this module's own (TypeScript) caller (ESPN's own roster cache
 * inside teamSportEspn.ts keeps repeat calls cheap within an hour) — nothing
 * about that read path changes here.
 *
 * What's new: for the three team sports whose odds refresh already runs on
 * a real proactive cadence (`multiSportRefresh.ts`, driven by
 * `refreshNflJob`/`refreshCfbJob`/`refreshSoccerEplJob` in lib/scheduler.ts),
 * the result of that already-happening ESPN fetch is now also persisted to
 * Postgres — see PHASE2_ODDS_CONTEXT_SNAPSHOT_CONTRACT below. This is Phase
 * 2 prerequisite work: a future Python worker needs *something* to read for
 * "which games exist today" instead of calling ESPN itself, the same way
 * `gameContext.ts` reads MLB's `snapshot_cache['mlb:snapshot']` today. No
 * new job, no new cadence, no extra ESPN calls — this only writes what
 * `loadGameContextsForSport` was already computing on every refresh cycle.
 *
 * Tennis is deliberately excluded: it has no proactive scheduler job at all
 * today (SharpAPI's tennis coverage rides the on-demand path, per
 * lib/scheduler.ts's job inventory), so there is no "existing cadence" to
 * piggyback a write onto, and none of Phase 2's six in-scope scheduler jobs
 * touch tennis — so a tennis snapshot isn't needed for the Python cutover.
 */

import type { GameLookupContext, SportKey } from './types';
import { fetchScoreboard, fetchTeamRoster } from '@/lib/sports/multiSport/teamSportEspn';
import { fetchTennisMatches } from '@/lib/sports/multiSport/espnTennis';
import { fetchWeekSchedule, fetchTeamRoster as fetchNhlTeamRoster } from '@/lib/sports/nhl/nhle';
import { writeSnapshotCache } from '@/lib/db/client';

/**
 * PHASE 2 CONTRACT — `snapshot_cache['odds-context:{sport}']`
 *
 * One row per in-scope team sport (`nfl`, `cfb`, `soccer_epl`), payload =
 * `JSON.stringify(OddsContextSnapshotV1)`. Written best-effort, non-blocking,
 * every time `loadGameContextsForSport` runs for that sport (see
 * `multiSportRefresh.ts`'s cadence: NFL/CFB every 3h, Soccer/EPL every 45m —
 * `MULTI_SPORT_TEAM_INTERVAL_MS`/`SOCCER_EPL_INTERVAL_MS` in lib/scheduler.ts).
 * A write failure never breaks the odds-refresh cycle it rides along with —
 * see the try/catch below — the same "cache write is never load-bearing"
 * contract `writeSnapshotCache`'s other callers already follow throughout
 * this codebase (e.g. lib/sports/mlb/snapshotRebuild.ts).
 *
 * Deliberately a distinct key namespace (`odds-context:*`), NOT a reuse of
 * `{sport}:snapshot` (e.g. `nfl:snapshot`, written by `buildNflSnapshot` for
 * NFL's own page rendering) — that key already holds a much larger,
 * differently-shaped payload (candidates, model output, etc.) unrelated to
 * odds-context resolution. Reusing it would repeat exactly the cache-key
 * collision this codebase has already been bitten by once (see CLAUDE.md's
 * golf/schedule example) — writing `GameLookupContext[]` under `nfl:snapshot`
 * would silently corrupt whatever the NFL page's own cache expects to find
 * there, or vice versa.
 *
 * SCHEMA — `OddsContextSnapshotV1`:
 *   {
 *     schemaVersion: 1,
 *     sport: 'nfl' | 'cfb' | 'soccer_epl',
 *     generatedAt: string,          // ISO timestamp, set at write time
 *     games: GameLookupContext[],   // exact shape below — this codebase's
 *                                   // own canonical odds-context type,
 *                                   // reused verbatim rather than inventing
 *                                   // a parallel wire shape
 *   }
 *   GameLookupContext = {
 *     sport: SportKey;
 *     gameId: string;               // Linesmith's own id, stringified
 *     awayTeamName: string; homeTeamName: string;
 *     awayAbbr: string; homeAbbr: string;
 *     gameDate: string;             // ISO date
 *     roster: RosterEntry[];        // { subjectId, subjectName, teamAbbr?, position?, headshotUrl? }
 *   }
 *
 * READER GUIDANCE (for whoever builds the Python side in Step 5 — nothing
 * reads this key yet, this snapshot has no consumer today): treat a missing
 * row, a `schemaVersion` you don't recognize, or a JSON-parse failure as
 * "skip this sport's proactive refresh for this cycle and log it" — never
 * crash the whole worker process over one sport's stale/absent snapshot.
 * Fail loud in logs/metrics, fail soft in control flow.
 */
interface OddsContextSnapshotV1 {
  schemaVersion: 1;
  sport: 'nfl' | 'cfb' | 'nba' | 'soccer_epl' | 'soccer_mls';
  generatedAt: string;
  games: GameLookupContext[];
}

async function writeOddsContextSnapshot(sport: 'nfl' | 'cfb' | 'nba' | 'soccer_epl' | 'soccer_mls', games: GameLookupContext[]): Promise<void> {
  try {
    const snapshot: OddsContextSnapshotV1 = { schemaVersion: 1, sport, generatedAt: new Date().toISOString(), games };
    await writeSnapshotCache(`odds-context:${sport}`, JSON.stringify(snapshot));
  } catch (error) {
    console.error(`[multiSportGameContext] failed to write odds-context snapshot for ${sport}`, error);
  }
}

interface TeamSportConfig {
  kind: 'team';
  espnSport: string;
  espnLeague: string;
}
interface TennisConfig {
  kind: 'tennis';
  tour: 'atp' | 'wta';
}
/** NHL has no ESPN dependency at all — real official api-web.nhle.com data (nhle.ts). Its own `kind`, not shoehorned into TeamSportConfig, since roster/schedule resolution is genuinely different (team-abbrev-keyed, not ESPN's numeric-id scheme). */
interface NhlConfig {
  kind: 'nhl';
}

const SPORT_CONFIG: Record<Exclude<SportKey, 'mlb'>, TeamSportConfig | TennisConfig | NhlConfig> = {
  nfl: { kind: 'team', espnSport: 'football', espnLeague: 'nfl' },
  cfb: { kind: 'team', espnSport: 'football', espnLeague: 'college-football' },
  soccer_epl: { kind: 'team', espnSport: 'soccer', espnLeague: 'eng.1' },
  soccer_mls: { kind: 'team', espnSport: 'soccer', espnLeague: 'usa.1' },
  nba: { kind: 'team', espnSport: 'basketball', espnLeague: 'nba' },
  nhl: { kind: 'nhl' },
  tennis_atp: { kind: 'tennis', tour: 'atp' },
  tennis_wta: { kind: 'tennis', tour: 'wta' },
};

export async function loadGameContextsForSport(sport: Exclude<SportKey, 'mlb'>): Promise<GameLookupContext[]> {
  const config = SPORT_CONFIG[sport];

  if (config.kind === 'tennis') {
    const matches = await fetchTennisMatches(config.tour);
    return matches
      .filter((m) => !m.completed)
      .map((m) => ({
        sport,
        gameId: m.matchId,
        awayTeamName: m.player2Name,
        homeTeamName: m.player1Name,
        // Tennis has no team concept — resolvePlayer's primary path is an
        // exact normalized-name match, which is all a 2-entry roster needs;
        // the team-scoped fallback simply never fires here.
        awayAbbr: m.player2Name,
        homeAbbr: m.player1Name,
        gameDate: m.date,
        roster: [
          { subjectId: m.player1SubjectId, subjectName: m.player1Name },
          { subjectId: m.player2SubjectId, subjectName: m.player2Name },
        ],
      }));
  }

  if (config.kind === 'nhl') {
    const games = await fetchWeekSchedule();
    const contexts: GameLookupContext[] = [];
    for (const g of games) {
      const [homeRoster, awayRoster] = await Promise.all([fetchNhlTeamRoster(g.homeAbbr), fetchNhlTeamRoster(g.awayAbbr)]);
      contexts.push({
        sport,
        gameId: g.gameId,
        awayTeamName: g.awayTeamName,
        homeTeamName: g.homeTeamName,
        awayAbbr: g.awayAbbr,
        homeAbbr: g.homeAbbr,
        gameDate: g.date,
        roster: [
          ...homeRoster.map((p) => ({ subjectId: p.subjectId, subjectName: p.fullName, teamAbbr: g.homeAbbr, position: p.position ?? undefined, headshotUrl: p.headshotUrl ?? undefined })),
          ...awayRoster.map((p) => ({ subjectId: p.subjectId, subjectName: p.fullName, teamAbbr: g.awayAbbr, position: p.position ?? undefined, headshotUrl: p.headshotUrl ?? undefined })),
        ],
      });
    }
    // No odds-context snapshot write for NHL — same reasoning tennis is
    // excluded for (see this module's own header comment): no proactive
    // Python scheduler job reads it yet, so there's no "existing cadence"
    // to piggyback the write onto.
    return contexts;
  }

  const games = await fetchScoreboard(config.espnSport, config.espnLeague, sport === 'soccer_epl' || sport === 'soccer_mls' ? 7 : 14);
  const contexts: GameLookupContext[] = [];
  for (const g of games) {
    const [homeRoster, awayRoster] = await Promise.all([
      fetchTeamRoster(config.espnSport, config.espnLeague, g.homeTeamId),
      fetchTeamRoster(config.espnSport, config.espnLeague, g.awayTeamId),
    ]);
    contexts.push({
      sport,
      gameId: g.gameId,
      awayTeamName: g.awayTeamName,
      homeTeamName: g.homeTeamName,
      awayAbbr: g.awayAbbr,
      homeAbbr: g.homeAbbr,
      gameDate: g.date,
      roster: [
        ...homeRoster.map((a) => ({ subjectId: a.subjectId, subjectName: a.fullName, teamAbbr: g.homeAbbr, position: a.positionAbbr, headshotUrl: a.headshotUrl })),
        ...awayRoster.map((a) => ({ subjectId: a.subjectId, subjectName: a.fullName, teamAbbr: g.awayAbbr, position: a.positionAbbr, headshotUrl: a.headshotUrl })),
      ],
    });
  }

  // Phase 2 prerequisite — see PHASE 2 CONTRACT above. Best-effort,
  // non-blocking: this module's own TS caller already has `contexts` in
  // hand regardless of whether the write below succeeds. The cast is safe:
  // `config.kind === 'team'` (we're past the tennis branch's early return)
  // means `sport` can only be one of SPORT_CONFIG's three team-sport keys.
  void writeOddsContextSnapshot(sport as 'nfl' | 'cfb' | 'nba' | 'soccer_epl' | 'soccer_mls', contexts);

  return contexts;
}
