/**
 * NFL team primary brand colors, keyed by abbreviation — same role as
 * `lib/sports/mlb/teamColors.ts`, just keyed by abbreviation instead of a
 * numeric id since that's what every NFL data source in this app already
 * carries (ESPN has no color field on a team either).
 */
export const TEAM_PRIMARY_COLOR: Record<string, string> = {
  ARI: '#97233F',
  ATL: '#A71930',
  BAL: '#241773',
  BUF: '#00338D',
  CAR: '#0085CA',
  CHI: '#0B162A',
  CIN: '#FB4F14',
  CLE: '#311D00',
  DAL: '#003594',
  DEN: '#FB4F14',
  DET: '#0076B6',
  GB: '#203731',
  HOU: '#03202F',
  IND: '#002C5F',
  JAX: '#101820',
  KC: '#E31837',
  LV: '#000000',
  LAC: '#0080C6',
  LAR: '#003594',
  MIA: '#008E97',
  MIN: '#4F2683',
  NE: '#002244',
  NO: '#D3BC8D',
  NYG: '#0B2265',
  NYJ: '#125740',
  PHI: '#004C54',
  PIT: '#FFB612',
  SF: '#AA0000',
  SEA: '#002244',
  TB: '#D50A0A',
  TEN: '#4B92DB',
  WSH: '#5A1414',
};

const FALLBACK_COLOR = '#616366';

export function teamPrimaryColor(abbreviation: string | undefined): string {
  return (abbreviation != null ? TEAM_PRIMARY_COLOR[abbreviation.toUpperCase()] : undefined) ?? FALLBACK_COLOR;
}

/** `hex` with an alpha channel appended — same helper as MLB's teamColors.ts, duplicated rather than imported to keep this file dependency-free like its MLB counterpart. */
export function withAlpha(hex: string, alphaHex: string): string {
  return `${hex}${alphaHex}`;
}
