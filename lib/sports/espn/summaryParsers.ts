/**
 * Parsers for ESPN's game summary — R4 step 2.
 *
 * The app already downloaded every one of these fields and threw them away.
 * Each parser is a pure function of the JSON `fetchEspnSummary` returns, so the
 * cards R6–R8 build can be tested against saved real payloads
 * (`tests/fixtures/espn/`) and verified field by field against the G2 datasets,
 * whose Python tools (`docs/design/phase-g2/tools/build_game_data.py`) parsed the
 * same document.
 *
 * Rules every parser here keeps:
 *  - **A missing field is `null` or an empty list, never a guessed value.** A
 *    summary for a game that has not started has no drives, plays or win
 *    probability, and says so by their absence.
 *  - **ESPN's sentinels are rejected.** NBA plays with no location carry
 *    coordinates near -2^31; they become `null`, never a point off the court.
 *  - **Numbers arrive as strings in places** ("+140", "o47.5", "-3"); they are
 *    parsed once, here.
 */

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^[ou]?\s*([+-]?\d+(?:\.\d+)?)$/i);
  if (m) return Number(m[1]);
  return v.trim().toUpperCase() === 'EVEN' ? 100 : null;
};

export interface SummaryTeamRef {
  id: string;
  abbr: string | null;
  name: string | null;
}

const teamRef = (t: J | undefined): SummaryTeamRef | null => (t && t.id != null ? { id: String(t.id), abbr: str(t.abbreviation), name: str(t.displayName) } : null);

/** Home and away team ids from the header, which every other parser keys against. */
export function summaryTeams(json: J | null): { home: SummaryTeamRef | null; away: SummaryTeamRef | null } {
  const comps = arr(json?.header?.competitions?.[0]?.competitors);
  const side = (s: 'home' | 'away') => teamRef(comps.find((c) => c.homeAway === s)?.team);
  return { home: side('home'), away: side('away') };
}

// ---------------------------------------------------------------------------
// win probability (NFL, CFB, NBA)
// ---------------------------------------------------------------------------

export interface WinProbabilityPoint {
  playId: string;
  /** 0-1, the HOME team's chance. */
  home: number;
  tie: number;
  period: number | null;
  clock: string | null;
  text: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

/** Every play the summary carries, from whichever shape the sport uses (flat `plays`, or plays nested in drives). */
function allPlays(json: J | null): J[] {
  const flat = arr(json?.plays);
  if (flat.length > 0) return flat;
  const drives = [...arr(json?.drives?.previous), ...(json?.drives?.current ? [json.drives.current] : [])];
  return drives.flatMap((d) => arr(d.plays));
}

export function parseWinProbability(json: J | null): WinProbabilityPoint[] {
  const byId = new Map(allPlays(json).map((p) => [String(p.id), p]));
  return arr(json?.winprobability)
    .filter((w) => typeof w.homeWinPercentage === 'number' && w.playId != null)
    .map((w) => {
      const p = byId.get(String(w.playId));
      return {
        playId: String(w.playId),
        home: w.homeWinPercentage,
        tie: typeof w.tiePercentage === 'number' ? w.tiePercentage : 0,
        period: num(p?.period?.number),
        clock: str(p?.clock?.displayValue),
        text: str(p?.text),
        homeScore: num(p?.homeScore),
        awayScore: num(p?.awayScore),
      };
    });
}

export interface WinProbabilitySwing extends WinProbabilityPoint {
  /** Change in the home team's chance on this play, -1..1. */
  delta: number;
}

/** The plays that moved win probability most, largest first. */
export function biggestSwings(series: readonly WinProbabilityPoint[], n = 5): WinProbabilitySwing[] {
  const swings: WinProbabilitySwing[] = [];
  for (let i = 1; i < series.length; i++) swings.push({ ...series[i], delta: series[i].home - series[i - 1].home });
  return swings.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, n);
}

// ---------------------------------------------------------------------------
// drives (NFL, CFB)
// ---------------------------------------------------------------------------

export interface FootballPlay {
  id: string;
  driveId: string;
  teamId: string | null;
  period: number | null;
  clock: string | null;
  type: string | null;
  text: string | null;
  yards: number | null;
  /** Yards to the end zone at the snap and after the play (the drive chart's axis). */
  startYardsToEndzone: number | null;
  endYardsToEndzone: number | null;
  down: number | null;
  distance: number | null;
  downText: string | null;
  scoring: boolean;
  turnover: boolean;
  penalty: boolean;
  homeScore: number | null;
  awayScore: number | null;
}

export interface Drive {
  id: string;
  teamId: string;
  teamAbbr: string | null;
  description: string | null;
  result: string | null;
  shortResult: string | null;
  yards: number | null;
  offensivePlays: number | null;
  timeElapsed: string | null;
  period: number | null;
  clock: string | null;
  /** 0-100 from the offense's own goal line, as ESPN reports `yardLine`. */
  startYardLine: number | null;
  startText: string | null;
  endYardLine: number | null;
  endText: string | null;
  isScore: boolean;
  /** True only for the drive in progress on a live game. */
  current: boolean;
  plays: FootballPlay[];
}

function toDrive(d: J, current: boolean): Drive {
  const driveId = String(d.id);
  const teamId = d.team?.id != null ? String(d.team.id) : '';
  return {
    id: driveId,
    teamId,
    teamAbbr: str(d.team?.abbreviation),
    description: str(d.description),
    result: str(d.displayResult) ?? str(d.result),
    shortResult: str(d.shortDisplayResult),
    yards: num(d.yards),
    offensivePlays: num(d.offensivePlays),
    timeElapsed: str(d.timeElapsed?.displayValue),
    period: num(d.start?.period?.number),
    clock: str(d.start?.clock?.displayValue),
    startYardLine: num(d.start?.yardLine),
    startText: str(d.start?.text),
    endYardLine: num(d.end?.yardLine),
    endText: str(d.end?.text),
    isScore: d.isScore === true,
    current,
    plays: arr(d.plays).map((p) => ({
      id: String(p.id),
      driveId,
      teamId: p.start?.team?.id != null ? String(p.start.team.id) : teamId || null,
      period: num(p.period?.number),
      clock: str(p.clock?.displayValue),
      type: str(p.type?.text),
      text: str(p.text),
      yards: num(p.statYardage),
      startYardsToEndzone: num(p.start?.yardsToEndzone),
      endYardsToEndzone: num(p.end?.yardsToEndzone),
      down: num(p.start?.down),
      distance: num(p.start?.distance),
      downText: str(p.start?.shortDownDistanceText),
      scoring: p.scoringPlay === true,
      turnover: p.isTurnover === true,
      penalty: p.isPenalty === true,
      homeScore: num(p.homeScore),
      awayScore: num(p.awayScore),
    })),
  };
}

export function parseDrives(json: J | null): Drive[] {
  const previous = arr(json?.drives?.previous).map((d) => toDrive(d, false));
  const cur = json?.drives?.current;
  // ESPN repeats the live drive in `previous` once it has plays; keep one copy, flagged current.
  if (cur && cur.id != null) return [...previous.filter((d) => d.id !== String(cur.id)), toDrive(cur, true)];
  return previous;
}

// ---------------------------------------------------------------------------
// plays with coordinates (NBA, NHL): lead tracker, scoring runs, shot chart
// ---------------------------------------------------------------------------

export interface CourtPlay {
  id: string;
  period: number | null;
  clock: string | null;
  type: string | null;
  text: string | null;
  teamId: string | null;
  athleteId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  scoring: boolean;
  scoreValue: number;
  shooting: boolean;
  pointsAttempted: number | null;
  /** ESPN's own court coordinate, feet for NBA. `null` for a play with no location (ESPN sends a -2^31 sentinel). */
  x: number | null;
  y: number | null;
}

/** ESPN's missing-location sentinel is near -2^31. Real NBA coordinates sit within the court (x 0-50, y -5..94). */
const plausible = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && v > lo && v < hi ? v : null);

export function parseCourtPlays(json: J | null): CourtPlay[] {
  return arr(json?.plays).map((p) => {
    const x = plausible(p.coordinate?.x, -10, 110);
    const y = plausible(p.coordinate?.y, -50, 110);
    return {
      id: String(p.id),
      period: num(p.period?.number),
      clock: str(p.clock?.displayValue),
      type: str(p.type?.text),
      text: str(p.text),
      teamId: p.team?.id != null ? String(p.team.id) : null,
      athleteId: p.participants?.[0]?.athlete?.id != null ? String(p.participants[0].athlete.id) : null,
      homeScore: num(p.homeScore),
      awayScore: num(p.awayScore),
      scoring: p.scoringPlay === true,
      scoreValue: num(p.scoreValue) ?? 0,
      shooting: p.shootingPlay === true,
      pointsAttempted: num(p.pointsAttempted),
      // Both or neither: a point with one real axis is not a location.
      x: x != null && y != null ? x : null,
      y: x != null && y != null ? y : null,
    };
  });
}

export interface LeadPoint {
  playId: string;
  period: number | null;
  clock: string | null;
  /** Home score minus away score after this play. */
  margin: number;
}

/** The lead after every scoring play, with a 0-0 start. */
export function leadTracker(plays: readonly CourtPlay[]): LeadPoint[] {
  const out: LeadPoint[] = [{ playId: 'start', period: 1, clock: null, margin: 0 }];
  for (const p of plays) {
    if (!p.scoring || p.homeScore == null || p.awayScore == null) continue;
    out.push({ playId: p.id, period: p.period, clock: p.clock, margin: p.homeScore - p.awayScore });
  }
  return out;
}

export interface ScoringRun {
  teamId: string;
  points: number;
  startPlayId: string;
  endPlayId: string;
  period: number | null;
  clock: string | null;
}

/** Unanswered scoring runs of at least `min` points, largest first. */
export function scoringRuns(plays: readonly CourtPlay[], min = 8): ScoringRun[] {
  const runs: ScoringRun[] = [];
  let cur: ScoringRun | null = null;
  for (const p of plays) {
    if (!p.scoring || !p.teamId || p.scoreValue <= 0) continue;
    if (cur && cur.teamId === p.teamId) {
      cur.points += p.scoreValue;
      cur.endPlayId = p.id;
    } else {
      if (cur && cur.points >= min) runs.push(cur);
      cur = { teamId: p.teamId, points: p.scoreValue, startPlayId: p.id, endPlayId: p.id, period: p.period, clock: p.clock };
    }
  }
  if (cur && cur.points >= min) runs.push(cur);
  return runs.sort((a, b) => b.points - a.points);
}

// ---------------------------------------------------------------------------
// pickcenter: lines open -> close
// ---------------------------------------------------------------------------

export interface PriceOpenClose {
  open: number | null;
  close: number | null;
}
export interface LineOpenClose {
  line: PriceOpenClose;
  odds: PriceOpenClose;
}

export interface GameLines {
  provider: string | null;
  details: string | null;
  moneyline: { home: PriceOpenClose; away: PriceOpenClose; draw: PriceOpenClose | null };
  spread: { home: LineOpenClose; away: LineOpenClose };
  total: { over: LineOpenClose; under: LineOpenClose };
  /** The favourite at the open, by ESPN's own flag — how a line "flipped". */
  favoriteAtOpen: 'home' | 'away' | null;
}

const oc = (v: J | undefined, key: 'odds' | 'line'): PriceOpenClose => ({ open: num(v?.open?.[key]), close: num(v?.close?.[key]) });
const loc = (v: J | undefined): LineOpenClose => ({ line: oc(v, 'line'), odds: oc(v, 'odds') });

export function parseGameLines(json: J | null): GameLines | null {
  const pc = arr(json?.pickcenter)[0];
  if (!pc) return null;
  const ml = pc.moneyline ?? {};
  return {
    provider: str(pc.provider?.name),
    details: str(pc.details),
    moneyline: { home: oc(ml.home, 'odds'), away: oc(ml.away, 'odds'), draw: ml.draw ? oc(ml.draw, 'odds') : null },
    spread: { home: loc(pc.pointSpread?.home), away: loc(pc.pointSpread?.away) },
    total: { over: loc(pc.total?.over), under: loc(pc.total?.under) },
    favoriteAtOpen: pc.homeTeamOdds?.favoriteAtOpen === true ? 'home' : pc.awayTeamOdds?.favoriteAtOpen === true ? 'away' : null,
  };
}

export interface ResultVsLine {
  /** Home margin minus the home closing spread's implied margin: positive = home covered. */
  homeCoverMargin: number | null;
  covered: 'home' | 'away' | 'push' | null;
  /** Combined score minus the closing total. */
  totalMargin: number | null;
  total: 'over' | 'under' | 'push' | null;
}

/** How the final result landed against the closing line. `null` fields when a closing number or a score is missing. */
export function resultVsLine(lines: GameLines | null, homeScore: number | null, awayScore: number | null): ResultVsLine {
  const empty: ResultVsLine = { homeCoverMargin: null, covered: null, totalMargin: null, total: null };
  if (!lines || homeScore == null || awayScore == null) return empty;
  const spread = lines.spread.home.line.close;
  const totalLine = lines.total.over.line.close;
  const cover = spread == null ? null : homeScore - awayScore + spread;
  const over = totalLine == null ? null : homeScore + awayScore - totalLine;
  const side = (v: number | null, pos: string, neg: string) => (v == null ? null : v > 0 ? pos : v < 0 ? neg : 'push');
  return { homeCoverMargin: cover, covered: side(cover, 'home', 'away') as ResultVsLine['covered'], totalMargin: over, total: side(over, 'over', 'under') as ResultVsLine['total'] };
}

// ---------------------------------------------------------------------------
// season series / head-to-head (NBA, NHL, soccer)
// ---------------------------------------------------------------------------

export interface SeriesGame {
  id: string;
  date: string | null;
  completed: boolean;
  home: { teamId: string; abbr: string | null; score: number | null; winner: boolean };
  away: { teamId: string; abbr: string | null; score: number | null; winner: boolean };
}

export interface SeasonSeries {
  type: string | null;
  title: string | null;
  summary: string | null;
  seriesScore: string | null;
  completed: boolean;
  games: SeriesGame[];
}

export function parseSeasonSeries(json: J | null): SeasonSeries[] {
  return arr(json?.seasonseries).map((s) => ({
    type: str(s.type),
    title: str(s.title),
    summary: str(s.summary),
    seriesScore: str(s.seriesScore),
    completed: s.completed === true,
    games: arr(s.events).map((e) => {
      const side = (h: 'home' | 'away') => {
        const c = arr(e.competitors).find((x) => x.homeAway === h) ?? {};
        return { teamId: String(c.team?.id ?? ''), abbr: str(c.team?.abbreviation), score: num(c.score), winner: c.winner === true };
      };
      return { id: String(e.id), date: str(e.date), completed: e.statusType?.completed === true, home: side('home'), away: side('away') };
    }),
  }));
}

// ---------------------------------------------------------------------------
// injuries
// ---------------------------------------------------------------------------

export interface InjuryItem {
  athleteId: string | null;
  name: string | null;
  position: string | null;
  status: string | null;
  type: string | null;
  detail: string | null;
  date: string | null;
}

export interface TeamInjuries {
  teamId: string;
  abbr: string | null;
  items: InjuryItem[];
}

export interface InjuryReport {
  teams: TeamInjuries[];
  /**
   * When THIS app fetched the report. ESPN keeps no pre-kickoff snapshot, so a
   * report shown on a final game is the current one, and must say so (plan §1,
   * difference 7).
   */
  fetchedAt: string;
}

export function parseInjuries(json: J | null, fetchedAt: string): InjuryReport {
  return {
    fetchedAt,
    teams: arr(json?.injuries).map((t) => ({
      teamId: String(t.team?.id ?? ''),
      abbr: str(t.team?.abbreviation),
      items: arr(t.injuries).map((i) => ({
        athleteId: i.athlete?.id != null ? String(i.athlete.id) : null,
        name: str(i.athlete?.displayName),
        position: str(i.athlete?.position?.abbreviation),
        status: str(i.status),
        type: str(i.type?.description) ?? str(i.details?.type),
        detail: str(i.details?.detail) ?? str(i.details?.returnDate),
        date: str(i.date),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// soccer: lineups, commentary (with pitch positions), form
// ---------------------------------------------------------------------------

export interface LineupPlayer {
  id: string;
  name: string | null;
  jersey: string | null;
  position: string | null;
  starter: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
  /** ESPN's slot in the formation, 1 = goalkeeper. `null` for a substitute. */
  formationPlace: number | null;
}

export interface Lineup {
  teamId: string;
  homeAway: 'home' | 'away' | null;
  formation: string | null;
  players: LineupPlayer[];
}

export function parseLineups(json: J | null): Lineup[] {
  return arr(json?.rosters).map((r) => ({
    teamId: String(r.team?.id ?? ''),
    homeAway: r.homeAway === 'home' || r.homeAway === 'away' ? r.homeAway : null,
    formation: str(r.formation),
    players: arr(r.roster).map((p) => ({
      id: String(p.athlete?.id ?? ''),
      name: str(p.athlete?.displayName),
      jersey: str(p.jersey),
      position: str(p.position?.abbreviation),
      starter: p.starter === true,
      subbedIn: p.subbedIn === true,
      subbedOut: p.subbedOut === true,
      formationPlace: num(p.formationPlace) || null,
    })),
  }));
}

export interface CommentaryEvent {
  sequence: number | null;
  minute: string | null;
  seconds: number | null;
  text: string | null;
  type: string | null;
  teamName: string | null;
  athletes: string[];
  /**
   * Pitch position, 0-100, as ESPN's commentary feed carries it for some events
   * (shots mostly). A CURATED subset of a match's events, not every shot.
   */
  x: number | null;
  y: number | null;
  x2: number | null;
  y2: number | null;
  goalY: number | null;
}

export function parseCommentary(json: J | null): CommentaryEvent[] {
  return arr(json?.commentary).map((c) => {
    const p = c.play ?? {};
    return {
      sequence: num(c.sequence),
      minute: str(c.time?.displayValue),
      seconds: num(c.time?.value),
      text: str(c.text),
      type: str(p.type?.text),
      teamName: str(p.team?.displayName),
      athletes: arr(p.participants).map((q) => str(q.athlete?.displayName)).filter((n): n is string => n != null),
      x: num(p.fieldPositionX),
      y: num(p.fieldPositionY),
      x2: num(p.fieldPosition2X),
      y2: num(p.fieldPosition2Y),
      goalY: num(p.goalPositionY),
    };
  });
}

export interface FormGame {
  id: string;
  date: string | null;
  atVs: string | null;
  score: string | null;
  result: string | null;
  opponentAbbr: string | null;
  competition: string | null;
}

export function parseLastFive(json: J | null): Array<{ teamId: string; games: FormGame[] }> {
  return arr(json?.lastFiveGames).map((t) => ({
    teamId: String(t.team?.id ?? ''),
    games: arr(t.events).map((e) => ({
      id: String(e.id),
      date: str(e.gameDate),
      atVs: str(e.atVs),
      score: str(e.score),
      result: str(e.gameResult),
      opponentAbbr: str(e.opponent?.abbreviation),
      competition: str(e.competitionName),
    })),
  }));
}
