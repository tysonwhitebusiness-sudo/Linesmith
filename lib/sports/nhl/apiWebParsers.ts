/**
 * NHL api-web parsers — R4 step 4, two endpoints new to this app.
 *
 *  - `/v1/player/{id}/landing` — OFFICIAL season and career totals, skater and
 *    goalie. Until now the app derived NHL season numbers from its own game
 *    logs; the league publishes them.
 *  - `/v1/gamecenter/{id}/play-by-play` — every event with rink coordinates,
 *    shooter, goalie and game situation, for a live or not-yet-stored game (the
 *    shot-attempt flow and full-rink map). Stored games come from
 *    `nhl_shot_events`. ESPN's summary also carries NHL coordinates, but not the
 *    shooter, goalie or strength situation, which the cards need.
 *
 * Pure functions of the raw JSON, verified against the G2 datasets built from
 * the same endpoints (MacKinnon, Vasilevskiy; FLA @ TOR).
 */

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** api-web wraps localised strings as `{ default: "…" }`. */
const loc = (v: unknown): string | null => (typeof v === 'string' ? str(v) : str((v as J | null)?.default));

// ---------------------------------------------------------------------------
// player landing
// ---------------------------------------------------------------------------

export interface NhlSeasonLine {
  /** 20252026 */
  season: number;
  team: string | null;
  gamesPlayed: number | null;
  // skaters
  goals: number | null;
  assists: number | null;
  points: number | null;
  plusMinus: number | null;
  pim: number | null;
  shots: number | null;
  shootingPct: number | null;
  powerPlayGoals: number | null;
  powerPlayPoints: number | null;
  gameWinningGoals: number | null;
  avgToi: string | null;
  faceoffPct: number | null;
  // goalies
  gamesStarted: number | null;
  wins: number | null;
  losses: number | null;
  otLosses: number | null;
  goalsAgainstAvg: number | null;
  savePct: number | null;
  shutouts: number | null;
  shotsAgainst: number | null;
}

export interface NhlPlayerLanding {
  playerId: number | null;
  name: string | null;
  position: string | null;
  isGoalie: boolean;
  teamAbbr: string | null;
  sweater: number | null;
  shootsCatches: string | null;
  birthDate: string | null;
  headshot: string | null;
  /** R6.1a: the player page hero. NHL API team ids, the same space `player_game_history` uses for NHL. */
  teamId: number | null;
  teamName: string | null;
  teamLogo: string | null;
  heightInches: number | null;
  weightPounds: number | null;
  birthPlace: string | null;
  draft: { year: number | null; teamAbbrev: string | null; round: number | null; pickInRound: number | null; overallPick: number | null } | null;
  /** NHL regular seasons only, oldest first. */
  seasons: NhlSeasonLine[];
  careerRegularSeason: NhlSeasonLine | null;
}

function line(s: J, season: number): NhlSeasonLine {
  return {
    season,
    team: loc(s.teamName),
    gamesPlayed: num(s.gamesPlayed),
    goals: num(s.goals),
    assists: num(s.assists),
    points: num(s.points),
    plusMinus: num(s.plusMinus),
    pim: num(s.pim),
    shots: num(s.shots),
    shootingPct: num(s.shootingPctg),
    powerPlayGoals: num(s.powerPlayGoals),
    powerPlayPoints: num(s.powerPlayPoints),
    gameWinningGoals: num(s.gameWinningGoals),
    avgToi: str(s.avgToi),
    faceoffPct: num(s.faceoffWinningPctg),
    gamesStarted: num(s.gamesStarted),
    wins: num(s.wins),
    losses: num(s.losses),
    otLosses: num(s.otLosses),
    goalsAgainstAvg: num(s.goalsAgainstAvg),
    savePct: num(s.savePctg),
    shutouts: num(s.shutouts),
    shotsAgainst: num(s.shotsAgainst),
  };
}

export function parsePlayerLanding(json: J | null): NhlPlayerLanding | null {
  if (!json || json.playerId == null) return null;
  const position = str(json.position);
  return {
    playerId: num(json.playerId),
    name: [loc(json.firstName), loc(json.lastName)].filter(Boolean).join(' ') || null,
    position,
    isGoalie: position === 'G',
    teamAbbr: str(json.currentTeamAbbrev),
    sweater: num(json.sweaterNumber),
    shootsCatches: str(json.shootsCatches),
    birthDate: str(json.birthDate),
    headshot: str(json.headshot),
    teamId: num(json.currentTeamId),
    teamName: loc(json.fullTeamName),
    teamLogo: str(json.teamLogo),
    heightInches: num(json.heightInInches),
    weightPounds: num(json.weightInPounds),
    birthPlace: [loc(json.birthCity), loc(json.birthStateProvince), str(json.birthCountry)].filter(Boolean).join(', ') || null,
    draft: json.draftDetails
      ? {
          year: num(json.draftDetails.year),
          teamAbbrev: str(json.draftDetails.teamAbbrev),
          round: num(json.draftDetails.round),
          pickInRound: num(json.draftDetails.pickInRound),
          overallPick: num(json.draftDetails.overallPick),
        }
      : null,
    // gameTypeId 2 is the regular season; a traded player has one row per team.
    seasons: arr(json.seasonTotals)
      .filter((s) => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2)
      .map((s) => line(s, s.season)),
    careerRegularSeason: json.careerTotals?.regularSeason ? line(json.careerTotals.regularSeason, 0) : null,
  };
}

// ---------------------------------------------------------------------------
// play-by-play
// ---------------------------------------------------------------------------

export type NhlEventType = 'goal' | 'shot-on-goal' | 'missed-shot' | 'blocked-shot' | 'penalty' | 'hit' | 'faceoff' | 'takeaway' | 'giveaway' | 'period-start' | 'period-end';
const KEPT = new Set<NhlEventType>(['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot', 'penalty', 'hit', 'faceoff', 'takeaway', 'giveaway', 'period-start', 'period-end']);

export interface NhlEvent {
  period: number | null;
  periodType: string | null;
  timeInPeriod: string | null;
  type: NhlEventType;
  teamId: number | null;
  /** True when the event belongs to the home team; `null` when it belongs to neither. */
  isHome: boolean | null;
  /** Rink feet: x -100..100 along the ice, y -42.5..42.5 across. */
  x: number | null;
  y: number | null;
  zone: string | null;
  shotType: string | null;
  shooterId: number | null;
  goalieId: number | null;
  assist1Id: number | null;
  assist2Id: number | null;
  homeDefendingSide: string | null;
  /** api-web's four-digit situation code: away goalie, away skaters, home skaters, home goalie. */
  situation: string | null;
  penalty: string | null;
  penaltyMinutes: number | null;
  homeScore: number | null;
  awayScore: number | null;
}

export interface NhlPlayByPlay {
  gameId: number | null;
  homeTeamId: number | null;
  awayTeamId: number | null;
  roster: Record<string, { name: string; sweater: number | null; position: string | null; teamId: number | null }>;
  events: NhlEvent[];
}

export function parsePlayByPlay(json: J | null): NhlPlayByPlay | null {
  if (!json || !Array.isArray(json.plays)) return null;
  const homeId = num(json.homeTeam?.id);
  const roster: NhlPlayByPlay['roster'] = {};
  for (const r of arr(json.rosterSpots)) {
    if (r.playerId == null) continue;
    roster[String(r.playerId)] = { name: [loc(r.firstName), loc(r.lastName)].filter(Boolean).join(' '), sweater: num(r.sweaterNumber), position: str(r.positionCode), teamId: num(r.teamId) };
  }
  const events: NhlEvent[] = [];
  for (const p of arr(json.plays)) {
    const type = p.typeDescKey as NhlEventType;
    if (!KEPT.has(type)) continue;
    const d = p.details ?? {};
    const owner = num(d.eventOwnerTeamId);
    events.push({
      period: num(p.periodDescriptor?.number),
      periodType: str(p.periodDescriptor?.periodType),
      timeInPeriod: str(p.timeInPeriod),
      type,
      teamId: owner,
      isHome: owner == null ? null : owner === homeId,
      x: num(d.xCoord),
      y: num(d.yCoord),
      zone: str(d.zoneCode),
      shotType: str(d.shotType),
      shooterId: num(d.shootingPlayerId) ?? num(d.scoringPlayerId),
      goalieId: num(d.goalieInNetId),
      assist1Id: num(d.assist1PlayerId),
      assist2Id: num(d.assist2PlayerId),
      homeDefendingSide: str(p.homeTeamDefendingSide),
      situation: str(p.situationCode),
      penalty: str(d.descKey),
      penaltyMinutes: num(d.duration),
      homeScore: num(d.homeScore),
      awayScore: num(d.awayScore),
    });
  }
  return { gameId: num(json.id), homeTeamId: homeId, awayTeamId: num(json.awayTeam?.id), roster, events };
}
