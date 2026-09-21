import type { TeamColor } from './teamColors';

/**
 * Sample team colours for `/kit` and the tests: ESPN's values, measured
 * 2026-09-21. Kept here rather than on the kit page because pages may not
 * carry colour literals (tests/ui-sweep).
 */
export const TEAM_COLOR_SAMPLES: Array<{ name: string; color: TeamColor | null }> = [
  { name: 'Vikings', color: { primary: '#4f2683', secondary: '#ffc62f' } },
  { name: 'Bengals', color: { primary: '#fb4f14', secondary: '#000000' } },
  { name: 'Saints (falls back)', color: { primary: '#d3bc8d', secondary: null } },
  { name: 'Golf (no team)', color: null },
];

/** The kit's ringed-headshot band. */
export const VIKINGS: TeamColor = { primary: '#4f2683', secondary: '#ffc62f' };
