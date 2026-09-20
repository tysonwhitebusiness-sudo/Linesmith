/**
 * The shared out-of-scope list for every UI-system guard (U spec §0b).
 *
 * Scan and the sport landing (slate) pages are not redesigned in the U track
 * (operator, 2026-09-19). Their files keep the old kit — `components/Skeleton`,
 * the glider `SegmentedToggle`, `.lb-chip` — for as long as they use it, so a
 * guard that swept them would be permanently red for a reason nobody intends to
 * fix. Every guard reads THIS list rather than growing its own copy, which is
 * also what makes the list easy to shorten when S1 rebuilds Scan's controls.
 *
 * U0 is the one phase that still reaches these files: the whole app runs on one
 * Tailwind, so the 3.4 → 4 conversion converted their classes mechanically.
 * They must render exactly as before, and that is the only change they get.
 *
 * `AppShell.tsx` is a split case — its chrome (TopBar, slip, footer) is in
 * scope because research pages render inside it, while its slate/Scan body is
 * not. It is listed here because a file-level guard cannot tell the two apart;
 * S1 replaces the body with `SlatePage` and this entry goes with it.
 */
export const OUT_OF_SCOPE: readonly string[] = [
  'components/ScanTable.tsx',
  'components/ScanCard.tsx',
  'components/FilterBar.tsx',
  'components/FilterSidebar.tsx',
  'components/PlayerFilterDrawer.tsx',
  'components/DateGameStrip.tsx',
  'components/GameLinesView.tsx',
  'components/GameLine.tsx',
  'components/TodaysPicksModal.tsx',
  'components/useFilters.ts',
  'components/AppShell.tsx',
];

/** True when a repo-relative path (either slash flavour) is out of scope. */
export function outOfScope(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return OUT_OF_SCOPE.some((f) => p === f || p.endsWith('/' + f));
}

/**
 * Strips block and line comments, so a guard that counts `<button` or `<table`
 * does not count the word in a comment explaining why one is gone. Found the
 * hard way twice: the kit page NAMES the renamed utilities in prose, and
 * `GameResearchPage`'s migration note says "it was a hand-rolled `<table>`".
 */
export function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
