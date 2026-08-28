/**
 * CFB's real team-defense-allowed leaderboard — the position-group data
 * source the matchup-card rebuild needs (see
 * docs/matchup-card-rebuild-gameplan-2026-08-23.md §6/§8). Same shape as
 * NFL's real `opponentDefenseAllowed`/`positionRank` (nflverse team-week
 * based), built here from CFBD's own per-game box scores instead.
 *
 * Feasible with zero new endpoints: `cfbd.ts`'s `/games/players?year&team`
 * call already returns BOTH teams' full stat lines for every one of a
 * team's games in one response (`RawGamePlayersResponse.teams`, one entry
 * per side). For team X's game, the entry that is NOT X is the opponent —
 * summing that opponent's team-wide passing/rushing/receiving yards across
 * every one of X's games is exactly "yards X's defense allowed."
 */

import { readSnapshotCache, writeSnapshotCache } from '@/lib/db/client';
import { normalizeName } from '@/lib/core/normalizeName';
import { currentCfbdSeason, fetchFbsTeamNames, loadCfbdTeamContext } from './cfbd';
import { cfbTeamLogoByCfbdName } from './espn';
import { fuzzyMatchCfbTeamDefenseAllowed } from './teamDefenseAllowedMatch';

export interface CfbTeamDefenseAllowed {
  teamName: string;
  gamesPlayed: number;
  /** Real, from ESPN via `cfbTeamLogoByCfbdName` — added 2026-08-24 so the matchup card can show a real logo for every real team. */
  logoUrl?: string;
  passingYdsAllowedPerGame: number;
  passingRank: number;
  rushingYdsAllowedPerGame: number;
  rushingRank: number;
  receivingYdsAllowedPerGame: number;
  receivingRank: number;
  poolSize: number;
  /**
   * This team's OWN real yardage produced (not allowed) — same box-score
   * data the "allowed" fields above already aggregate, just keyed to
   * `context.cfbdTeamName`'s own line instead of the opponent's. Added for
   * the Team Detail matchup card (real offense vs. real opponent defense),
   * ranked the same way the allowed fields are — never fabricated.
   */
  passingYdsProducedPerGame: number;
  passingProducedRank: number;
  rushingYdsProducedPerGame: number;
  rushingProducedRank: number;
  receivingYdsProducedPerGame: number;
  receivingProducedRank: number;
}

function categoryTotal(teamBox: { categories: Array<{ name: string; types: Array<{ name: string; athletes: Array<{ stat: string }> }> }> } | undefined, category: string, type: string): number {
  const cat = teamBox?.categories.find((c) => c.name === category);
  const t = cat?.types.find((ty) => ty.name === type);
  if (!t) return 0;
  return t.athletes.reduce((sum, a) => {
    const v = Number(a.stat);
    return sum + (Number.isNaN(v) ? 0 : v);
  }, 0);
}

/**
 * One team's real allowed-yardage totals across a season, from an
 * already-loaded `CfbdTeamContext` (games + box scores, both fetched/cached
 * by `loadCfbdTeamContext`). Pure aggregation, no I/O.
 */
function aggregateAllowed(context: Awaited<ReturnType<typeof loadCfbdTeamContext>>): { games: number; passingYds: number; rushingYds: number; receivingYds: number } {
  let games = 0;
  let passingYds = 0;
  let rushingYds = 0;
  let receivingYds = 0;
  for (const game of context.games) {
    const box = context.boxByGameId.get(game.id);
    if (!box) continue;
    const opponentBox = box.teams.find((t) => t.team !== context.cfbdTeamName);
    if (!opponentBox) continue;
    games += 1;
    passingYds += categoryTotal(opponentBox, 'passing', 'YDS');
    rushingYds += categoryTotal(opponentBox, 'rushing', 'YDS');
    receivingYds += categoryTotal(opponentBox, 'receiving', 'YDS');
  }
  return { games, passingYds, rushingYds, receivingYds };
}

/** Mirror of `aggregateAllowed` — this team's own box-score line instead of the opponent's. */
function aggregateProduced(context: Awaited<ReturnType<typeof loadCfbdTeamContext>>): { games: number; passingYds: number; rushingYds: number; receivingYds: number } {
  let games = 0;
  let passingYds = 0;
  let rushingYds = 0;
  let receivingYds = 0;
  for (const game of context.games) {
    const box = context.boxByGameId.get(game.id);
    if (!box) continue;
    const ownBox = box.teams.find((t) => t.team === context.cfbdTeamName);
    if (!ownBox) continue;
    games += 1;
    passingYds += categoryTotal(ownBox, 'passing', 'YDS');
    rushingYds += categoryTotal(ownBox, 'rushing', 'YDS');
    receivingYds += categoryTotal(ownBox, 'receiving', 'YDS');
  }
  return { games, passingYds, rushingYds, receivingYds };
}

/**
 * League-wide leaderboard, every FBS team ranked, computed once and cached
 * (24h — same grounding as `fetchFbsTeamNames`'s own TTL, since this changes
 * at the same pace: once per completed week of games). Rebuilding requires
 * one `loadCfbdTeamContext` call per FBS team (~130), each of which is
 * itself cached 6h internally, so a warm cache makes this cheap; a cold
 * cache is a real ~130-call rebuild — acceptable for a once-a-day job, not
 * something to trigger per page load (see caller in `cachedRoute`-style
 * usage once wired into the adapter).
 */
export async function buildCfbTeamDefenseAllowedIndex(season: string = currentCfbdSeason()): Promise<Map<string, CfbTeamDefenseAllowed>> {
  // v3: added real logoUrl — bumped so a stale earlier-shaped cache entry never gets read back missing it.
  const cacheKey = `cfb:defenseAllowed:leaderboard:v3:${season}`;
  const cached = await readSnapshotCache(cacheKey);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 60 * 60_000) {
    return new Map(JSON.parse(cached.payload) as Array<[string, CfbTeamDefenseAllowed]>);
  }

  const [teamNames, logoByName] = await Promise.all([fetchFbsTeamNames(), cfbTeamLogoByCfbdName()]);
  const rows: Array<{
    teamName: string;
    gamesPlayed: number;
    passingYdsAllowedPerGame: number;
    rushingYdsAllowedPerGame: number;
    receivingYdsAllowedPerGame: number;
    passingYdsProducedPerGame: number;
    rushingYdsProducedPerGame: number;
    receivingYdsProducedPerGame: number;
  }> = [];

  for (const teamName of teamNames) {
    const context = await loadCfbdTeamContext(teamName, season);
    const allowed = aggregateAllowed(context);
    const produced = aggregateProduced(context);
    if (allowed.games === 0) continue;
    rows.push({
      teamName,
      gamesPlayed: allowed.games,
      passingYdsAllowedPerGame: allowed.passingYds / allowed.games,
      rushingYdsAllowedPerGame: allowed.rushingYds / allowed.games,
      receivingYdsAllowedPerGame: allowed.receivingYds / allowed.games,
      passingYdsProducedPerGame: produced.games > 0 ? produced.passingYds / produced.games : 0,
      rushingYdsProducedPerGame: produced.games > 0 ? produced.rushingYds / produced.games : 0,
      receivingYdsProducedPerGame: produced.games > 0 ? produced.receivingYds / produced.games : 0,
    });
  }

  const rankOf = (key: keyof (typeof rows)[number], ascending: boolean) => {
    const sorted = [...rows].sort((a, b) => (ascending ? (a[key] as number) - (b[key] as number) : (b[key] as number) - (a[key] as number)));
    const rankByTeam = new Map<string, number>();
    sorted.forEach((r, i) => rankByTeam.set(r.teamName, i + 1));
    return rankByTeam;
  };
  // Allowed: fewer yards allowed is a "better" rank (ascending). Produced: more yards produced is a "better" rank (descending).
  const passingRanks = rankOf('passingYdsAllowedPerGame', true);
  const rushingRanks = rankOf('rushingYdsAllowedPerGame', true);
  const receivingRanks = rankOf('receivingYdsAllowedPerGame', true);
  const passingProducedRanks = rankOf('passingYdsProducedPerGame', false);
  const rushingProducedRanks = rankOf('rushingYdsProducedPerGame', false);
  const receivingProducedRanks = rankOf('receivingYdsProducedPerGame', false);

  const index = new Map<string, CfbTeamDefenseAllowed>();
  for (const r of rows) {
    index.set(normalizeName(r.teamName), {
      teamName: r.teamName,
      gamesPlayed: r.gamesPlayed,
      passingYdsAllowedPerGame: r.passingYdsAllowedPerGame,
      passingRank: passingRanks.get(r.teamName) ?? rows.length,
      rushingYdsAllowedPerGame: r.rushingYdsAllowedPerGame,
      rushingRank: rushingRanks.get(r.teamName) ?? rows.length,
      receivingYdsAllowedPerGame: r.receivingYdsAllowedPerGame,
      receivingRank: receivingRanks.get(r.teamName) ?? rows.length,
      poolSize: rows.length,
      passingYdsProducedPerGame: r.passingYdsProducedPerGame,
      passingProducedRank: passingProducedRanks.get(r.teamName) ?? rows.length,
      rushingYdsProducedPerGame: r.rushingYdsProducedPerGame,
      rushingProducedRank: rushingProducedRanks.get(r.teamName) ?? rows.length,
      receivingYdsProducedPerGame: r.receivingYdsProducedPerGame,
      receivingProducedRank: receivingProducedRanks.get(r.teamName) ?? rows.length,
      logoUrl: logoByName.get(r.teamName),
    });
  }

  await writeSnapshotCache(cacheKey, JSON.stringify([...index.entries()]));
  return index;
}

/** Exact lookup when the caller already has CFBD's own school-name spelling (e.g. from `matchCfbdTeamName`). */
export function lookupCfbTeamDefenseAllowed(index: Map<string, CfbTeamDefenseAllowed>, cfbdTeamName: string): CfbTeamDefenseAllowed | null {
  return index.get(normalizeName(cfbdTeamName)) ?? null;
}

/**
 * Fuzzy lookup for a caller that only has ESPN's own display name/abbreviation
 * for the opponent (the `playerDetailAdapter.ts` matchup card's real
 * situation — it never resolved a clean CFBD school name the way
 * `cfb/adapter.ts`'s history join already does). Exact normalized match
 * first, then substring either-direction — same fallback shape
 * `matchUnderstatTeamName` uses for soccer's identical ESPN-vs-third-party
 * naming gap.
 */
export function fuzzyLookupCfbTeamDefenseAllowed(index: Map<string, CfbTeamDefenseAllowed>, espnName: string): CfbTeamDefenseAllowed | null {
  const normalizedEspn = normalizeName(espnName);
  if (!normalizedEspn) return null;
  const exact = index.get(normalizedEspn);
  if (exact) return exact;
  return fuzzyMatchCfbTeamDefenseAllowed([...index.values()], espnName);
}
