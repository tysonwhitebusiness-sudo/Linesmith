/**
 * Football (NFL + CFB) live in-game detail — shared parser, same
 * "one ESPN shape, two leagues" principle as `teamSportEspn.ts`'s own
 * header comment (which already established NFL and CFB share the exact
 * scoreboard/roster shape). Verified live against a real completed 2026
 * bowl game (CFB event 401769072) before building: `boxscore.players[]` is
 * grouped by category (`name: 'passing'|'rushing'|'receiving'|...`, each
 * with its own `labels`/`athletes` — a different shape from NBA's flat
 * `names`/`athletes`, not reused from `nba/liveGame.ts`), `scoringPlays[]`
 * gives the real scoring timeline directly (type/team/period/clock/score),
 * and `competitors[].linescores[]` gives real per-quarter score. NFL's
 * `lib/sports/nfl/liveGameState.ts` already parses this same summary
 * endpoint's `situation` (down/distance/redzone) for the hero card's inline
 * live strip — this module is the deeper Live-tab read of the same
 * response, not a replacement for that file. Deliberately uncached — same
 * live-data contract as `app/api/mlb/game/[gameId]/live/route.ts`.
 */

export interface FootballScoringPlay {
  period: number;
  clockDisplay: string;
  typeText: string;
  description: string;
  teamAbbr: 'away' | 'home' | null;
  awayScore: number;
  homeScore: number;
}

export interface FootballLeaderLine {
  name: string;
  statLine: string;
}

/** One player's merged stat line across whichever of passing/rushing/receiving they appeared in — a RB can carry both rushing and receiving numbers at once, so this is accumulated per athlete name, not one row per category. Used by the player-detail line tracker (Part 2) to look up an arbitrary tracked player, not just each team's single top passer, and by `FootballLiveTab`'s full box-score tables (2026-08-24 unified-card redesign) — `passingCompAtt`/`passingInts`/`rushingCarries` were added then, additively, purely for that table depth. */
export interface FootballPlayerLine {
  name: string;
  passingCompAtt: string | null;
  passingYards: number | null;
  passingTds: number | null;
  passingInts: number | null;
  rushingCarries: number | null;
  rushingYards: number | null;
  rushingTds: number | null;
  receivingYards: number | null;
  receivingTds: number | null;
  receptions: number | null;
}

export interface FootballTeamStatLine {
  label: string;
  displayValue: string;
}

export interface FootballLiveGameDetail {
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
  awayTopPasser: FootballLeaderLine | null;
  homeTopPasser: FootballLeaderLine | null;
  scoringPlays: FootballScoringPlay[];
  teamStats: { away: FootballTeamStatLine[]; home: FootballTeamStatLine[] };
  playersByTeam: Record<string, FootballPlayerLine[]>;
}

interface RawAthleteStat {
  athlete: { displayName: string };
  stats: string[];
}
interface RawStatGroup {
  name: string;
  labels: string[];
  athletes: RawAthleteStat[];
}
interface RawPlayerGroup {
  team: { id: string };
  statistics: RawStatGroup[];
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
  boxscore?: { players?: RawPlayerGroup[]; teams?: Array<{ team: { id: string }; statistics: Array<{ label: string; displayValue: string }> }> };
  scoringPlays?: Array<{
    type: { text: string };
    text: string;
    awayScore: number;
    homeScore: number;
    period: { number: number };
    clock: { displayValue: string };
    team?: { id: string };
  }>;
}

function statNum(labels: string[], stats: string[], label: string): number | null {
  const idx = labels.indexOf(label);
  if (idx < 0) return null;
  const n = Number(stats[idx]);
  return Number.isFinite(n) ? n : null;
}

function statStr(labels: string[], stats: string[], label: string): string | null {
  const idx = labels.indexOf(label);
  return idx < 0 ? null : stats[idx] ?? null;
}

/** Merges a team's passing/rushing/receiving groups into one row per athlete name — the same athlete can legitimately appear in more than one group (a RB with both rushing and receiving lines), so later groups fill in additional fields on an existing row rather than creating a duplicate. */
function playersFor(playerGroups: RawPlayerGroup[] | undefined, teamId: string): FootballPlayerLine[] {
  const group = playerGroups?.find((g) => g.team.id === teamId);
  const byName = new Map<string, FootballPlayerLine>();
  const blank = (name: string): FootballPlayerLine => ({
    name,
    passingCompAtt: null,
    passingYards: null,
    passingTds: null,
    passingInts: null,
    rushingCarries: null,
    rushingYards: null,
    rushingTds: null,
    receivingYards: null,
    receivingTds: null,
    receptions: null,
  });

  for (const stat of group?.statistics ?? []) {
    if (stat.name !== 'passing' && stat.name !== 'rushing' && stat.name !== 'receiving') continue;
    for (const a of stat.athletes) {
      const row = byName.get(a.athlete.displayName) ?? blank(a.athlete.displayName);
      if (stat.name === 'passing') {
        row.passingCompAtt = statStr(stat.labels, a.stats, 'C/ATT');
        row.passingYards = statNum(stat.labels, a.stats, 'YDS');
        row.passingTds = statNum(stat.labels, a.stats, 'TD');
        row.passingInts = statNum(stat.labels, a.stats, 'INT');
      } else if (stat.name === 'rushing') {
        row.rushingCarries = statNum(stat.labels, a.stats, 'CAR');
        row.rushingYards = statNum(stat.labels, a.stats, 'YDS');
        row.rushingTds = statNum(stat.labels, a.stats, 'TD');
      } else {
        row.receivingYards = statNum(stat.labels, a.stats, 'YDS');
        row.receivingTds = statNum(stat.labels, a.stats, 'TD');
        row.receptions = statNum(stat.labels, a.stats, 'REC');
      }
      byName.set(a.athlete.displayName, row);
    }
  }
  return [...byName.values()];
}

function topPasserFor(playerGroups: RawPlayerGroup[] | undefined, teamId: string): FootballLeaderLine | null {
  const group = playerGroups?.find((g) => g.team.id === teamId);
  const passing = group?.statistics.find((s) => s.name === 'passing');
  const top = passing?.athletes[0];
  if (!top) return null;
  const ydIdx = passing!.labels.indexOf('YDS');
  const tdIdx = passing!.labels.indexOf('TD');
  const cAttIdx = passing!.labels.indexOf('C/ATT');
  const parts = [
    cAttIdx >= 0 ? top.stats[cAttIdx] : null,
    ydIdx >= 0 ? `${top.stats[ydIdx]} YDS` : null,
    tdIdx >= 0 ? `${top.stats[tdIdx]} TD` : null,
  ].filter(Boolean);
  return { name: top.athlete.displayName, statLine: parts.join(' · ') };
}

export async function fetchFootballLiveGame(espnLeague: 'nfl' | 'college-football', eventId: string): Promise<FootballLiveGameDetail | null> {
  let res: Response;
  try {
    res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/${espnLeague}/summary?event=${eventId}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json()) as RawSummary;

  const comp = json.header?.competitions?.[0];
  const away = comp?.competitors?.find((c) => c.homeAway === 'away');
  const home = comp?.competitors?.find((c) => c.homeAway === 'home');
  if (!comp || !away || !home) return null;

  const teamSide = (teamId: string | undefined): 'away' | 'home' | null =>
    teamId === away.team.id ? 'away' : teamId === home.team.id ? 'home' : null;

  const scoringPlays: FootballScoringPlay[] = (json.scoringPlays ?? []).map((p) => ({
    period: p.period.number,
    clockDisplay: p.clock.displayValue,
    typeText: p.type.text,
    description: p.text,
    teamAbbr: teamSide(p.team?.id),
    awayScore: p.awayScore,
    homeScore: p.homeScore,
  }));

  const statsFor = (teamId: string): FootballTeamStatLine[] => json.boxscore?.teams?.find((t) => t.team.id === teamId)?.statistics ?? [];

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
    awayTopPasser: topPasserFor(json.boxscore?.players, away.team.id),
    homeTopPasser: topPasserFor(json.boxscore?.players, home.team.id),
    scoringPlays,
    teamStats: { away: statsFor(away.team.id), home: statsFor(home.team.id) },
    playersByTeam: {
      [away.team.abbreviation]: playersFor(json.boxscore?.players, away.team.id),
      [home.team.abbreviation]: playersFor(json.boxscore?.players, home.team.id),
    },
  };
}
