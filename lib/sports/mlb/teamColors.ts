/**
 * MLB team primary brand colors, keyed by the same numeric team ID the Stats
 * API uses everywhere else in this app (`teamLogoUrl`, `TeamGameContext`,
 * etc.) — the Stats API itself doesn't expose color, so this is a small
 * hardcoded table of each team's well-known primary color.
 */
export const TEAM_PRIMARY_COLOR: Record<number, string> = {
  108: '#BA0021', // LAA Angels
  109: '#A71930', // ARI Diamondbacks
  110: '#DF4601', // BAL Orioles
  111: '#BD3039', // BOS Red Sox
  112: '#0E3386', // CHC Cubs
  113: '#C6011F', // CIN Reds
  114: '#0C2340', // CLE Guardians
  115: '#333366', // COL Rockies
  116: '#0C2340', // DET Tigers
  117: '#002D62', // HOU Astros
  118: '#004687', // KC Royals
  119: '#005A9C', // LAD Dodgers
  120: '#AB0003', // WSH Nationals
  121: '#002D72', // NYM Mets
  133: '#003831', // OAK Athletics
  134: '#27251F', // PIT Pirates
  135: '#2F241D', // SD Padres
  136: '#0C2C56', // SEA Mariners
  137: '#FD5A1E', // SF Giants
  138: '#C41E3A', // STL Cardinals
  139: '#092C5C', // TB Rays
  140: '#003278', // TEX Rangers
  141: '#134A8E', // TOR Blue Jays
  142: '#002B5C', // MIN Twins
  143: '#E81828', // PHI Phillies
  144: '#CE1141', // ATL Braves
  145: '#27251F', // CWS White Sox
  146: '#00A3E0', // MIA Marlins
  147: '#0C2340', // NYY Yankees
  158: '#12284B', // MIL Brewers
};

const FALLBACK_COLOR = '#616366';

export function teamPrimaryColor(teamId: number | undefined): string {
  return (teamId != null ? TEAM_PRIMARY_COLOR[teamId] : undefined) ?? FALLBACK_COLOR;
}

/** `hex` with an alpha channel appended (e.g. `withAlpha('#0C2340', '26')` → a soft ~15% wash) — for tinting a white background with a team color without a color-math dependency. */
export function withAlpha(hex: string, alphaHex: string): string {
  return `${hex}${alphaHex}`;
}
