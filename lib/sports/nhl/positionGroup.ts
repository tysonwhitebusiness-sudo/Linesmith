/**
 * Pure position classification, no imports — extracted out of
 * teamDefenseAllowed.ts (which re-exports it for its existing callers) so
 * it can be imported from client components without dragging in that
 * file's server-only readSnapshotCache/writeSnapshotCache DB import and
 * nhle.ts fetchers. Needed by the NHL client-side matchupFavorable merge
 * (Phase E of docs/x-signal-remaining-sports-gameplan-2026-08-27.md),
 * which runs in 'use client' files (AppShell.tsx, PlayerDetail.tsx) — same
 * reasoning as lib/core/normalizeName.ts's and lib/sports/nba/
 * positionGroup.ts's own extractions for CFB's/NBA's Phase C/D.
 */

/** NHL boxscore position codes: C/L/R are forwards, D is a defenseman. */
export function isForwardCode(position: string): boolean {
  return position === 'C' || position === 'L' || position === 'R';
}
