/**
 * NBA per-game box scores — the position-group data source the matchup-
 * card rebuild needs (see docs/matchup-card-rebuild-gameplan-2026-08-23.md
 * §6/§8). Unlike NHL (`nhle.ts`'s `fetchBoxscore`, official league API,
 * already proven live in this codebase) and CFB (`cfbd.ts`, official
 * vendor API, already proven live), NBA has no existing box-score fetcher
 * to extend — `nba/espn.ts`'s `fetchGameSummary` only ever parsed the same
 * ESPN `summary?event=` response's `header`/`odds` keys, never `boxscore`.
 *
 * Verified live 2026-08-27 (Phase D of docs/x-signal-remaining-sports-
 * gameplan-2026-08-27.md) — the earlier "unverified, sandbox blocks ESPN"
 * caveat no longer applies; ESPN itself is reachable and returns real data.
 * Real bug found and fixed during that same verification, unrelated to
 * network access: fetchNbaBoxscore's own cache key (`nba:boxscore:
 * {gameId}`) collided with a Python-worker job writing its own
 * differently-shaped payload under the identical key in the shared
 * snapshot_cache table, so every TS read silently got an object with no
 * homeAbbr/awayAbbr and every opponent lookup failed — see this function's
 * own comment for the fix. Post-fix, `/api/nba/team-defense-allowed`
 * returns real, sane, non-degenerate per-team ranks (currently 12 teams —
 * ESPN's own `/teams` list is returning a partial ~13-team set right now
 * rather than the full 30, a separate, lower-severity ESPN-data-
 * completeness gap not touched here; ranking logic itself works correctly
 * against whatever real pool size ESPN actually returns).
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';

export { nbaPositionGroup, type NbaPositionGroup } from './positionGroup';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

export interface NbaPlayerGameStat {
  name: string;
  position: string | null;
  points: number;
  rebounds: number;
  assists: number;
}

export interface NbaBoxscore {
  gameId: string;
  homeAbbr: string;
  awayAbbr: string;
  playersByAbbr: Record<string, NbaPlayerGameStat[]>;
}

interface RawBoxscoreAthlete {
  athlete?: { displayName?: string; position?: { abbreviation?: string } | string };
  stats?: string[];
}
interface RawBoxscoreStatGroup {
  labels?: string[];
  athletes?: RawBoxscoreAthlete[];
}
interface RawBoxscoreTeamPlayers {
  team?: { abbreviation?: string };
  statistics?: RawBoxscoreStatGroup[];
}
interface RawSummaryResponse {
  boxscore?: { players?: RawBoxscoreTeamPlayers[] };
  header?: { competitions?: Array<{ competitors?: Array<{ homeAway: 'home' | 'away'; team: { abbreviation: string } }> }> };
}

function statAt(labels: string[], stats: string[], label: string): number {
  const i = labels.findIndex((l) => l.toUpperCase() === label);
  if (i < 0 || i >= stats.length) return 0;
  const v = Number(stats[i]);
  return Number.isNaN(v) ? 0 : v;
}

function positionOf(athlete: RawBoxscoreAthlete['athlete']): string | null {
  if (!athlete) return null;
  const pos = athlete.position;
  if (!pos) return null;
  if (typeof pos === 'string') return pos;
  return pos.abbreviation ?? null;
}

export async function fetchNbaBoxscore(gameId: string): Promise<NbaBoxscore | null> {
  // `:ts:` namespace — real bug found live 2026-08-27 (Phase D of docs/
  // x-signal-remaining-sports-gameplan-2026-08-27.md): the Python worker
  // writes its own `nba:boxscore:{gameId}` entries into this same flat
  // snapshot_cache table for its own matchup-defense job, shaped
  // `{playersByAbbr}` with no `homeAbbr`/`awayAbbr` — this function was
  // silently reading those back (fresher, so preferred by the TTL check),
  // producing an object with no home/away info. Every opponent-abbr
  // resolution in teamDefenseAllowed.ts's aggregateAllowed() then compared
  // against `undefined` and always missed, so `agg.games` was 0 for every
  // team, every rebuild — the whole leaderboard silently empty. Same class
  // of collision as golf's `golf:schedule:${year}` (see CLAUDE.md) — fixed
  // the same way, a distinctly-namespaced key instead of a shared one.
  const cacheKey = `nba:boxscore:ts:${gameId}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 6 * 60 * 60_000) {
    return JSON.parse(cached.payload) as NbaBoxscore;
  }

  let res: Response;
  try {
    res = await fetch(`${ESPN_BASE}/summary?event=${gameId}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    return cached ? (JSON.parse(cached.payload) as NbaBoxscore) : null;
  }
  if (!res.ok) return cached ? (JSON.parse(cached.payload) as NbaBoxscore) : null;

  let json: RawSummaryResponse;
  try {
    json = (await res.json()) as RawSummaryResponse;
  } catch {
    return cached ? (JSON.parse(cached.payload) as NbaBoxscore) : null;
  }

  const teamGroups = json.boxscore?.players ?? [];
  if (teamGroups.length === 0) return cached ? (JSON.parse(cached.payload) as NbaBoxscore) : null;

  const competitors = json.header?.competitions?.[0]?.competitors ?? [];
  const homeAbbr = competitors.find((c) => c.homeAway === 'home')?.team.abbreviation ?? teamGroups[0]?.team?.abbreviation ?? '';
  const awayAbbr = competitors.find((c) => c.homeAway === 'away')?.team.abbreviation ?? teamGroups[1]?.team?.abbreviation ?? '';

  const playersByAbbr: Record<string, NbaPlayerGameStat[]> = {};
  for (const group of teamGroups) {
    const abbr = group.team?.abbreviation;
    if (!abbr) continue;
    const players: NbaPlayerGameStat[] = [];
    for (const statGroup of group.statistics ?? []) {
      const labels = (statGroup.labels ?? []).map((l) => l.toUpperCase());
      for (const a of statGroup.athletes ?? []) {
        const stats = a.stats ?? [];
        players.push({
          name: a.athlete?.displayName ?? 'Unknown',
          position: positionOf(a.athlete),
          points: statAt(labels, stats, 'PTS'),
          rebounds: statAt(labels, stats, 'REB'),
          assists: statAt(labels, stats, 'AST'),
        });
      }
    }
    playersByAbbr[abbr] = players;
  }

  const box: NbaBoxscore = { gameId, homeAbbr, awayAbbr, playersByAbbr };
  await writeSnapshotCache(cacheKey, JSON.stringify(box));
  return box;
}
