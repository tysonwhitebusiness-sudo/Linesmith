/**
 * NBA live in-game detail — hero card's Live tab data source, built on
 * ESPN's public summary endpoint (`nba/espn.ts`'s `fetchGameSummary` already
 * calls this same endpoint for pregame odds; this is a second, richer read
 * of the same response). Verified live against a real completed 2026 NBA
 * Finals game (event 401859963) before building: `boxscore.players[]`
 * carries every athlete's full stat line (`statistics[0].names` is the
 * column header order, `athletes[].stats` the matching values — mapped by
 * name lookup here rather than hardcoded index, since ESPN doesn't
 * guarantee column order is stable across responses), `header.competitions[
 * 0].competitors[].linescores[]` gives real per-quarter score directly (no
 * need to derive it from `plays[]`), and `leaders[]` gives each team's real
 * top scorer with headshot. Deliberately uncached — same live-data contract
 * as `app/api/mlb/game/[gameId]/live/route.ts`.
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

export interface NbaBoxPlayer {
  id: string;
  name: string;
  headshotUrl?: string;
  min: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  to: number;
}

export interface NbaTopScorer {
  name: string;
  headshotUrl?: string;
  points: number;
}

export interface NbaTeamStatLine {
  label: string;
  displayValue: string;
}

export interface NbaLiveGameDetail {
  gameId: string;
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  period: number | null;
  displayClock: string | null;
  awayTeamId: string;
  awayAbbr: string;
  awayScore: number;
  awayLinescores: number[];
  homeTeamId: string;
  homeAbbr: string;
  homeScore: number;
  homeLinescores: number[];
  awayTopScorer: NbaTopScorer | null;
  homeTopScorer: NbaTopScorer | null;
  teamStats: { away: NbaTeamStatLine[]; home: NbaTeamStatLine[] };
  boxByTeam: Record<string, NbaBoxPlayer[]>;
}

interface RawAthleteStat {
  active?: boolean;
  athlete: { displayName: string; headshot?: { href?: string } };
  didNotPlay?: boolean;
  stats: string[];
}
interface RawPlayerGroup {
  team: { id: string; abbreviation: string };
  statistics: Array<{ names: string[]; athletes: RawAthleteStat[] }>;
}
interface RawTeamStatGroup {
  team: { id: string; abbreviation: string; homeAway?: string };
  statistics: Array<{ label: string; displayValue: string }>;
  homeAway?: 'home' | 'away';
}
interface RawLeaderEntry {
  athlete: { displayName: string; headshot?: { href?: string } };
  value: number;
}
interface RawLeaderCategory {
  name: string;
  leaders: RawLeaderEntry[];
}
interface RawTeamLeaders {
  team: { id: string };
  leaders?: RawLeaderCategory[];
}
interface RawSummary {
  header?: {
    competitions?: Array<{
      status?: { type?: { state?: 'pre' | 'in' | 'post'; shortDetail?: string; detail?: string }; period?: number; displayClock?: string };
      competitors?: Array<{
        id: string;
        homeAway: 'home' | 'away';
        team: { id: string; abbreviation: string };
        score?: string;
        linescores?: Array<{ displayValue: string }>;
      }>;
    }>;
  };
  boxscore?: { players?: RawPlayerGroup[]; teams?: RawTeamStatGroup[] };
  leaders?: RawTeamLeaders[];
}

function statValue(names: string[], stats: string[], label: string): number {
  const idx = names.indexOf(label);
  if (idx < 0) return 0;
  const raw = stats[idx];
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchNbaLiveGame(eventId: string): Promise<NbaLiveGameDetail | null> {
  let res: Response;
  try {
    res = await fetch(`${ESPN_BASE}/summary?event=${eventId}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as RawSummary;

  const comp = json.header?.competitions?.[0];
  const away = comp?.competitors?.find((c) => c.homeAway === 'away');
  const home = comp?.competitors?.find((c) => c.homeAway === 'home');
  if (!comp || !away || !home) return null;

  const boxByTeam: Record<string, NbaBoxPlayer[]> = {};
  for (const group of json.boxscore?.players ?? []) {
    const stat = group.statistics[0];
    if (!stat) continue;
    boxByTeam[group.team.abbreviation] = stat.athletes
      .filter((a) => !a.didNotPlay)
      .map((a) => ({
        id: a.athlete.displayName,
        name: a.athlete.displayName,
        headshotUrl: a.athlete.headshot?.href,
        min: stat.names.includes('MIN') ? a.stats[stat.names.indexOf('MIN')] : '0',
        pts: statValue(stat.names, a.stats, 'PTS'),
        reb: statValue(stat.names, a.stats, 'REB'),
        ast: statValue(stat.names, a.stats, 'AST'),
        stl: statValue(stat.names, a.stats, 'STL'),
        blk: statValue(stat.names, a.stats, 'BLK'),
        to: statValue(stat.names, a.stats, 'TO'),
      }));
  }

  const teamStatsFor = (teamId: string): NbaTeamStatLine[] => {
    const group = json.boxscore?.teams?.find((t) => t.team.id === teamId);
    return (group?.statistics ?? []).map((s) => ({ label: s.label, displayValue: s.displayValue }));
  };

  const topScorerFor = (teamId: string): NbaTopScorer | null => {
    const teamLeaders = json.leaders?.find((l) => l.team.id === teamId);
    const pointsLeader = teamLeaders?.leaders?.find((l) => l.name === 'points')?.leaders?.[0];
    if (!pointsLeader) return null;
    return { name: pointsLeader.athlete.displayName, headshotUrl: pointsLeader.athlete.headshot?.href, points: pointsLeader.value };
  };

  return {
    gameId: eventId,
    state: comp.status?.type?.state ?? 'pre',
    statusDetail: comp.status?.type?.shortDetail ?? comp.status?.type?.detail ?? '',
    period: comp.status?.period ?? null,
    displayClock: comp.status?.displayClock ?? null,
    awayTeamId: away.team.id,
    awayAbbr: away.team.abbreviation,
    awayScore: away.score != null ? Number(away.score) : 0,
    awayLinescores: (away.linescores ?? []).map((l) => Number(l.displayValue)),
    homeTeamId: home.team.id,
    homeAbbr: home.team.abbreviation,
    homeScore: home.score != null ? Number(home.score) : 0,
    homeLinescores: (home.linescores ?? []).map((l) => Number(l.displayValue)),
    awayTopScorer: topScorerFor(away.team.id),
    homeTopScorer: topScorerFor(home.team.id),
    teamStats: { away: teamStatsFor(away.team.id), home: teamStatsFor(home.team.id) },
    boxByTeam,
  };
}
