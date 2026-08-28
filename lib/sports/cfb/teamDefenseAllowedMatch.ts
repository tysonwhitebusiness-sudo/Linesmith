/**
 * Pure, client-safe matching + X-signal threshold for CFB's team-defense-
 * allowed leaderboard (Phase C of docs/x-signal-remaining-sports-
 * gameplan-2026-08-27.md). Split out of teamDefenseAllowed.ts, which is
 * server-only (imports readSnapshotCache/cfbd.ts fetchers at module
 * scope) — importing anything from it into a 'use client' file (AppShell.
 * tsx, PlayerDetail.tsx) would drag that server-only code into the
 * browser bundle. This file has no such imports, so it's safe to import
 * from both server and client code; teamDefenseAllowed.ts's own
 * `fuzzyLookupCfbTeamDefenseAllowed` delegates here so there's exactly one
 * real implementation of the matching algorithm.
 */

import { normalizeName } from '@/lib/core/normalizeName';
import { favorableFromRank } from '@/lib/odds/props/matchupFavorable';
import type { CfbTeamDefenseAllowed } from './teamDefenseAllowed';

/**
 * Fuzzy lookup for a caller that only has ESPN's own display name for the
 * opponent (`candidate.subjectMeta.opponentName`) — exact normalized match
 * first, then substring either-direction, same fallback shape
 * `matchUnderstatTeamName` uses for soccer's identical ESPN-vs-third-party
 * naming gap.
 */
export function fuzzyMatchCfbTeamDefenseAllowed(teams: CfbTeamDefenseAllowed[], espnName: string): CfbTeamDefenseAllowed | null {
  const normalizedEspn = normalizeName(espnName);
  if (!normalizedEspn) return null;
  for (const entry of teams) {
    if (normalizeName(entry.teamName) === normalizedEspn) return entry;
  }
  for (const entry of teams) {
    const normalizedCfbd = normalizeName(entry.teamName);
    if (normalizedCfbd && (normalizedEspn.includes(normalizedCfbd) || normalizedCfbd.includes(normalizedEspn))) return entry;
  }
  return null;
}

/** Mirrors NFL's DEFENSE_ALLOWED_KEY_BY_MARKET — CFB's own market keys (lib/sports/cfb/adapter.ts's MARKET_META) mapped to the one CfbTeamDefenseAllowed rank field that covers them. Dimensions with no real per-stat rank (longest-*, kicking-points) stay unmapped and resolve to null, same as NFL's own gaps. */
const CFB_DEFENSE_ALLOWED_KEY_BY_MARKET: Record<string, 'passingRank' | 'rushingRank' | 'receivingRank'> = {
  'passing-yards': 'passingRank',
  'rushing-yards': 'rushingRank',
  'receiving-yards': 'receivingRank',
  receptions: 'receivingRank',
};

export function cfbMatchupFavorableFor(marketKey: string, opponentName: string | undefined, teams: CfbTeamDefenseAllowed[]): boolean | null {
  const rankKey = CFB_DEFENSE_ALLOWED_KEY_BY_MARKET[marketKey];
  if (!rankKey || !opponentName || teams.length === 0) return null;
  const defense = fuzzyMatchCfbTeamDefenseAllowed(teams, opponentName);
  if (!defense) return null;
  return favorableFromRank(defense[rankKey], defense.poolSize);
}
