/**
 * Strip accents, punctuation and case so "Suárez" and "Suarez" compare
 * equal. Extracted from lib/odds/screenshotImport.ts (which re-exports it
 * for its existing callers) so it can be imported from client components
 * without dragging in that file's Anthropic SDK import — needed by the
 * CFB/NBA/NHL client-side matchupFavorable merge
 * (docs/x-signal-remaining-sports-gameplan-2026-08-27.md Phase C/D/E),
 * which has to run in 'use client' files (AppShell.tsx, PlayerDetail.tsx)
 * where a server-only module would either fail to bundle or silently
 * bloat the client bundle with server-only deps (the DB pool driver,
 * the Anthropic SDK).
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'`’-]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
