/**
 * Pure position-group classification, no imports — extracted out of
 * boxscore.ts (which re-exports it for its existing callers) so it can be
 * imported from client components without dragging in that file's
 * server-only readSnapshotCache/writeSnapshotCache DB import. Needed by
 * the NBA client-side matchupFavorable merge (Phase D of docs/x-signal-
 * remaining-sports-gameplan-2026-08-27.md), which runs in 'use client'
 * files (AppShell.tsx, PlayerDetail.tsx) — same reasoning as
 * lib/core/normalizeName.ts's own extraction for CFB's Phase C.
 */
export type NbaPositionGroup = 'Guards' | 'Forwards' | 'Centers';

export function nbaPositionGroup(positionAbbr: string | null | undefined): NbaPositionGroup | null {
  if (!positionAbbr) return null;
  const p = positionAbbr.toUpperCase();
  if (p === 'PG' || p === 'SG' || p === 'G') return 'Guards';
  if (p === 'SF' || p === 'PF' || p === 'F') return 'Forwards';
  if (p === 'C') return 'Centers';
  return null;
}
