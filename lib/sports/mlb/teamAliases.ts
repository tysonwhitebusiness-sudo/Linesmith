/**
 * Team abbreviation -> MLB team ID, covering both the current codes this
 * app already uses everywhere and the historical variants that show up in
 * odds data spanning 2010-2025: the Marlins' FLA -> MIA rename (2012) and
 * the Athletics' OAK -> current Sacramento home (2025). The Guardians'
 * 2022 rename from Indians didn't change their abbreviation (still CLE),
 * so no entry is needed for that one. Team IDs match what the rest of this
 * app already uses (verified against real snapshot/pick data this season).
 *
 * SBR's own xlsx files (2010-2020) use a third, inconsistent-even-within-a-
 * single-file set of codes on top of the two above (confirmed by scanning
 * the raw Team column: CUB/KAN/LOS/SDG/SFO/TAM/WAS/BRS all appear, some
 * alongside their standard equivalent in the same season's file).
 */
const TEAM_ID_BY_ABBR: Record<string, number> = {
  LAA: 108, ANA: 108,
  ARI: 109, AZ: 109,
  BAL: 110,
  BOS: 111, BRS: 111,
  CHC: 112, CUB: 112,
  CIN: 113,
  CLE: 114,
  COL: 115,
  DET: 116,
  HOU: 117,
  KC: 118, KCR: 118, KAN: 118,
  LAD: 119, LOS: 119,
  WSH: 120, WSN: 120, WAS: 120,
  NYM: 121,
  OAK: 133, ATH: 133,
  PIT: 134,
  SD: 135, SDP: 135, SDG: 135,
  SEA: 136,
  SF: 137, SFG: 137, SFO: 137,
  STL: 138,
  TB: 139, TBD: 139, TBR: 139, TAM: 139,
  TEX: 140,
  TOR: 141,
  MIN: 142,
  PHI: 143,
  ATL: 144,
  CWS: 145, CHW: 145,
  FLA: 146, MIA: 146,
  NYY: 147,
  MIL: 158,
};

/** Resolves an abbreviation to a team ID, tolerant of case and surrounding whitespace. Returns null (not a guess) for anything unrecognized — an ingestion pass counts and reports these rather than silently dropping or mis-mapping them. */
export function resolveTeamAbbr(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase();
  return TEAM_ID_BY_ABBR[key] ?? null;
}

/** This app's own current abbreviation for each team ID — the first (canonical) key listed above per team, not a historical alias. */
export const TEAM_ABBR_BY_ID: Record<number, string> = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC', 113: 'CIN', 114: 'CLE', 115: 'COL',
  116: 'DET', 117: 'HOU', 118: 'KC', 119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK', 134: 'PIT',
  135: 'SD', 136: 'SEA', 137: 'SF', 138: 'STL', 139: 'TB', 140: 'TEX', 141: 'TOR', 142: 'MIN',
  143: 'PHI', 144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL',
};

/** The reverse of `resolveTeamAbbr` — a team ID's current, canonical abbreviation. */
export function teamAbbrFor(teamId: number | null | undefined): string | undefined {
  return teamId != null ? TEAM_ABBR_BY_ID[teamId] : undefined;
}

/**
 * The 30 real MLB team ids, derived from the map above rather than typed out a
 * second time — task 3.5.
 *
 * Used to reject ids that are *shaped* like a team id but are not one.
 * `?teamId=888801` passes any digit/range check and, before this, minted a
 * permanent `snapshot_cache` row and fired a real MLB API call. A finite
 * allowlist is the only thing that stops that, and MLB team ids are a fixed
 * set of 30 that changes when a franchise is added — roughly once a decade —
 * so a static set costs nothing and needs no upstream call to validate one
 * parameter.
 */
export const MLB_TEAM_IDS: ReadonlySet<number> = new Set(Object.keys(TEAM_ABBR_BY_ID).map(Number));
