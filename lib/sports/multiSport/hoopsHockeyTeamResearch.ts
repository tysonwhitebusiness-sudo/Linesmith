/**
 * NBA's and NHL's team page reads — R7.3. One `TeamResearchPayload` for the
 * current and previous season, plus each team's shot profile (R5c).
 *
 * - schedule and results: NBA from ESPN's team schedule (regular season,
 *   playoffs and the play-in fetched apart); NHL from api-web's
 *   `club-schedule-season`, where `lastPeriodType` makes an overtime or
 *   shootout loss an OTL (R7-C1);
 * - standings: NBA from ESPN (division, then conference by seed); NHL from
 *   api-web (division, then conference), a finished season read at its own
 *   final date;
 * - team stats: the R5b rollup `team_game_production`, for and allowed, ranked
 *   across the standings' own teams (R2's 30% rule keeps out the All-Star
 *   "teams" the rollup holds);
 * - roster production: `player_season_production` plus the game logs, named
 *   from ESPN (NBA) or the club's season roster and player landings (NHL);
 * - shot profile: `team_shot_profile`, regular season, leagues over teams with
 *   40+ games.
 *
 * Server-only: reads Postgres.
 */

import { espnAthleteNames, fetchStandingsGroups, fetchTeamSeasonGames, type EspnSeasonGame, type EspnStandingsGroup } from './teamSportEspn';
import { abbrevForTeamId, fetchClubSeasonGames, fetchNhlSeasonStandings, nhlPlayerNames, type NhlClubGame, type NhlStandingRow } from '@/lib/sports/nhl/nhle';
import { readLeagueProduction, readTeamShotProfile } from '@/lib/sports/shared/teamProduction';
import { readRosterProduction } from '@/lib/sports/shared/teamRosterServer';
import { rankTeamStats, type TeamStatDef } from '@/lib/sports/shared/teamResearch';
import { realTeams, seasonForDate } from '@/lib/sports/shared/season';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import type { TeamShotProfile, TeamTotals } from '@/lib/sports/shared/teamProductionShapes';
import type { ResearchColumn } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamGame, TeamResearchPayload, TeamSeasonData, TeamStandingsTable, TeamStatValue } from '@/lib/sports/shared/teamResearchShapes';

export interface HoopsHockeyTeamResearchPayload extends TeamResearchPayload {
  /** The team's shot profile per season; `null` where the rollup holds none. */
  shots: Record<string, TeamShotProfile | null>;
}

const col = (key: string, label: string, decimals = 0, info?: string): ResearchColumn => ({ key, label, decimals, ...(info ? { info } : {}) });

interface Numbers {
  f: Record<string, number>;
  a: Record<string, number>;
  g: number;
  ag: number;
}

const pg = (v: number | undefined, g: number) => (v != null && g ? v / g : null);
const pct = (a: number | undefined, b: number | undefined) => (a != null && b ? (100 * a) / b : null);

function numbersFor(production: { for: Record<string, TeamTotals>; allowed: Record<string, TeamTotals> }, ids: string[]): { numbers: Map<string, Numbers>; pool: Set<string> } {
  const numbers = new Map<string, Numbers>();
  for (const id of ids) {
    const f = production.for[id];
    if (!f) continue;
    const a = production.allowed[id];
    numbers.set(id, { f: f.s, a: a?.s ?? {}, g: f.g, ag: a?.g ?? 0 });
  }
  const pool = new Set(realTeams([...numbers].map(([teamId, n]) => ({ teamId, games: n.g }))).map((r) => r.teamId));
  return { numbers, pool };
}

// ---------------------------------------------------------------------------
// NBA
// ---------------------------------------------------------------------------

type NbaDef = TeamStatDef<Numbers>;
const NBA_STATS: NbaDef[] = [
  { key: 'ppg', group: 'Offense', label: 'Points / game', direction: 'higher', decimals: 1, of: (t) => pg(t.f.points, t.g) },
  { key: 'fg', group: 'Offense', label: 'FG %', direction: 'higher', decimals: 1, format: 'percent', of: (t) => pct(t.f.fieldGoalsMade, t.f.fieldGoalsAttempted) },
  { key: 'tp', group: 'Offense', label: '3P %', direction: 'higher', decimals: 1, format: 'percent', of: (t) => pct(t.f.threePointFieldGoalsMade, t.f.threePointFieldGoalsAttempted) },
  { key: 'ft', group: 'Offense', label: 'FT %', direction: 'higher', decimals: 1, format: 'percent', of: (t) => pct(t.f.freeThrowsMade, t.f.freeThrowsAttempted) },
  { key: 'tpm', group: 'Offense', label: 'Threes made / game', direction: 'higher', decimals: 1, of: (t) => pg(t.f.threePointFieldGoalsMade, t.g) },
  { key: 'reb', group: 'Offense', label: 'Rebounds / game', direction: 'higher', decimals: 1, of: (t) => pg(t.f.rebounds, t.g) },
  { key: 'oreb', group: 'Offense', label: 'Offensive rebounds / game', direction: 'higher', decimals: 1, of: (t) => pg(t.f.offensiveRebounds, t.g) },
  { key: 'ast', group: 'Offense', label: 'Assists / game', direction: 'higher', decimals: 1, of: (t) => pg(t.f.assists, t.g) },
  { key: 'tov', group: 'Offense', label: 'Turnovers / game', direction: 'lower', decimals: 1, of: (t) => pg(t.f.turnovers, t.g) },
  { key: 'oppg', group: 'Defense', label: 'Points allowed / game', direction: 'lower', decimals: 1, of: (t) => pg(t.a.points, t.ag) },
  { key: 'ofg', group: 'Defense', label: 'Opponent FG %', direction: 'lower', decimals: 1, format: 'percent', of: (t) => pct(t.a.fieldGoalsMade, t.a.fieldGoalsAttempted) },
  { key: 'otp', group: 'Defense', label: 'Opponent 3P %', direction: 'lower', decimals: 1, format: 'percent', of: (t) => pct(t.a.threePointFieldGoalsMade, t.a.threePointFieldGoalsAttempted) },
  { key: 'oreb2', group: 'Defense', label: 'Opponent rebounds / game', direction: 'lower', decimals: 1, of: (t) => pg(t.a.rebounds, t.ag) },
  { key: 'stl', group: 'Defense', label: 'Steals / game', direction: 'higher', decimals: 1, of: (t) => pg(t.f.steals, t.g) },
  { key: 'blk', group: 'Defense', label: 'Blocks / game', direction: 'higher', decimals: 1, of: (t) => pg(t.f.blocks, t.g) },
  { key: 'otov', group: 'Defense', label: 'Turnovers forced / game', direction: 'higher', decimals: 1, of: (t) => pg(t.a.turnovers, t.ag) },
];

function espnGame(g: EspnSeasonGame, teamId: string, sport: 'nba', today: string): TeamGame {
  const home = g.home.id === teamId;
  const us = home ? g.home : g.away;
  const them = home ? g.away : g.home;
  return {
    id: g.id,
    start: g.start,
    date: easternDate(new Date(g.start)),
    home: home && !g.neutral,
    neutral: g.neutral,
    opponent: { id: them.id, name: them.name, abbr: them.abbr, logoUrl: them.logoUrl },
    us: g.state === 'final' ? us.score : null,
    them: g.state === 'final' ? them.score : null,
    state: g.state,
    extra: g.extra,
    postseason: g.postseason,
    label: g.label,
    venue: g.venue,
    opponentRank: null,
    href: `/${sport}/game/${g.id}`,
  };
}

/**
 * A division in its tiebreak order and the conference by seed. ESPN's entry
 * order within a group is not the standings order; its playoff seed is, and a
 * division keeps its conference order. Before seeds exist the published order
 * stands.
 */
function espnDivisionAndConference(groups: EspnStandingsGroup[], teamId: string, sport: string, divCols: ResearchColumn[], confCols: ResearchColumn[], keys: Array<[string, string]>): TeamStandingsTable[] {
  const mine = groups.find((g) => g.entries.some((e) => e.team.id === teamId));
  if (!mine) return [];
  const seeded = (entries: EspnStandingsGroup['entries']) =>
    entries.every((e) => (e.stats.playoffSeed?.value ?? 0) > 0) ? [...entries].sort((a, b) => (a.stats.playoffSeed!.value ?? 0) - (b.stats.playoffSeed!.value ?? 0)) : entries;
  const row = (e: EspnStandingsGroup['entries'][number]) => ({
    team: e.team,
    href: `/${sport}/team/${e.team.id}`,
    values: Object.fromEntries(keys.map(([k, stat]) => [k, e.stats[stat]?.display || null])),
  });
  const conference = mine.parents[mine.parents.length - 1] ?? '';
  const confEntries = groups.filter((g) => g.parents[g.parents.length - 1] === conference).flatMap((g) => g.entries);
  return [
    { title: mine.name, columns: divCols, rows: seeded(mine.entries).map(row) },
    ...(conference ? [{ title: conference, columns: confCols, rows: seeded(confEntries).map(row) }] : []),
  ];
}

async function nbaSeason(teamId: string, season: number, current: number, today: string) {
  const [games, groups, roster, production, shots] = await Promise.all([
    fetchTeamSeasonGames('basketball', 'nba', teamId, season, season < current),
    fetchStandingsGroups('basketball', 'nba', season, 3),
    readRosterProduction('nba', season, teamId),
    readLeagueProduction('nba', season, null),
    readTeamShotProfile('nba', season, teamId).catch(() => null),
  ]);
  const { numbers, pool } = numbersFor(production, groups.flatMap((g) => g.entries.map((e) => e.team.id)));
  const names = await espnAthleteNames('basketball', 'nba', teamId, roster.rows.map((r) => r.athleteId));
  const keys: Array<[string, string]> = [['w', 'wins'], ['l', 'losses'], ['pct', 'winPercent'], ['gb', 'gamesBehind'], ['ppg', 'avgPointsFor'], ['opp', 'avgPointsAgainst'], ['diff', 'differential'], ['home', 'Home'], ['road', 'Road'], ['div', 'vs. Div.'], ['conf', 'vs. Conf.'], ['l10', 'Last Ten Games'], ['strk', 'streak']];
  const divCols = [col('w', 'W'), col('l', 'L'), col('pct', 'PCT'), col('gb', 'GB'), col('ppg', 'PPG'), col('opp', 'OPP'), col('diff', 'Diff'), col('home', 'Home'), col('road', 'Road'), col('l10', 'L10'), col('strk', 'Strk')];
  const confCols = [col('w', 'W'), col('l', 'L'), col('pct', 'PCT'), col('gb', 'GB'), col('diff', 'Diff'), col('div', 'Div'), col('conf', 'Conf'), col('l10', 'L10'), col('strk', 'Strk')];
  const data: TeamSeasonData = {
    season,
    games: games.map((g) => espnGame(g, teamId, 'nba', today)),
    standings: espnDivisionAndConference(groups, teamId, 'nba', divCols, confCols, keys),
    stats: rankTeamStats(NBA_STATS, numbers, pool, teamId),
    roster: roster.rows.map((r) => {
      const n = names.get(r.athleteId);
      return {
        id: r.athleteId,
        name: n?.name ?? `Player ${r.athleteId}`,
        position: r.position ?? n?.position ?? null,
        headshotUrl: `https://a.espncdn.com/i/headshots/nba/players/full/${r.athleteId}.png`,
        href: `/nba/player/${r.athleteId}`,
        games: r.games,
        score: r.score,
        stats: r.stats,
      };
    }),
  };
  return { data, shots, rosterAsOf: roster.computedAt };
}

export async function readNbaTeamResearch(teamId: number, now: Date = new Date()): Promise<HoopsHockeyTeamResearchPayload | null> {
  const id = String(teamId);
  const today = easternDate(now);
  const current = seasonForDate('nba', now);
  const wanted = [current, current - 1];
  const built = await Promise.all(wanted.map((s) => nbaSeason(id, s, current, today)));
  const seasons = built.map((b) => b.data).filter((d) => d.games.length || d.roster.length);
  const raw = seasons.length ? await fetchTeamSeasonGames('basketball', 'nba', id, seasons[0].season, seasons[0].season < current) : [];
  const me = raw.map((g) => (g.home.id === id ? g.home : g.away.id === id ? g.away : null)).find(Boolean);
  if (!me) return null;
  const fetchedAt = now.toISOString();
  const shots: HoopsHockeyTeamResearchPayload['shots'] = {};
  wanted.forEach((s, i) => (shots[String(s)] = built[i].shots));
  return {
    sport: 'nba',
    team: { id, name: me.name, abbr: me.abbr, logoUrl: me.logoUrl, venue: raw.find((g) => g.home.id === id && !g.neutral && !g.postseason)?.venue ?? null, color: null },
    currentSeason: current,
    seasons,
    shots,
    sources: [
      { label: 'Schedule and results', detail: 'ESPN team schedule; regular season, playoffs and the play-in fetched apart', asOf: fetchedAt },
      { label: 'Standings', detail: 'ESPN standings, divisions and conferences by seed', asOf: fetchedAt },
      { label: 'Team stats', detail: 'team_game_production (box scores summed per team and per opponent), ranked across the NBA’s 30 teams here', asOf: built[0].rosterAsOf },
      { label: 'Roster production', detail: 'player_game_history summed per player; ordered by the production score in player_season_production; names from ESPN', asOf: built[0].rosterAsOf },
      { label: 'Shot profile', detail: 'team_shot_profile from nba_shot_events, regular season, league over teams with 40+ games', asOf: built[0].rosterAsOf },
    ],
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// NHL
// ---------------------------------------------------------------------------

/**
 * Hits, blocked shots and penalty minutes are left out: none has a better
 * direction (R2 — "hits in hockey" is the plan's own neutral example). Goals
 * for and against come from the standings, which count a shootout winner as a
 * goal where box scores do not.
 */
type NhlNumbers = Numbers & { gf: number | null; ga: number | null; gp: number };
const NHL_STATS: Array<TeamStatDef<NhlNumbers>> = [
  { key: 'gfpg', group: 'Offense', label: 'Goals / game', direction: 'higher', decimals: 2, of: (t) => pg(t.gf ?? undefined, t.gp) },
  { key: 'sog', group: 'Offense', label: 'Shots / game', direction: 'higher', decimals: 1, of: (t) => pg(t.f.sog, t.g) },
  { key: 'shpct', group: 'Offense', label: 'Shooting %', direction: 'higher', decimals: 1, format: 'percent', of: (t) => pct(t.f.goals, t.f.sog) },
  { key: 'ppg', group: 'Offense', label: 'Power-play goals / game', direction: 'higher', decimals: 2, of: (t) => pg(t.f.powerPlayGoals, t.g) },
  { key: 'take', group: 'Offense', label: 'Takeaways / game', direction: 'higher', decimals: 1, of: (t) => pg(t.f.takeaways, t.g) },
  { key: 'give', group: 'Offense', label: 'Giveaways / game', direction: 'lower', decimals: 1, of: (t) => pg(t.f.giveaways, t.g) },
  { key: 'gapg', group: 'Defense', label: 'Goals against / game', direction: 'lower', decimals: 2, of: (t) => pg(t.ga ?? undefined, t.gp) },
  { key: 'sa', group: 'Defense', label: 'Shots against / game', direction: 'lower', decimals: 1, of: (t) => pg(t.f.shotsAgainst, t.g) },
  { key: 'svpct', group: 'Defense', label: 'Save %', direction: 'higher', decimals: 1, format: 'percent', of: (t) => pct(t.f.saves, t.f.shotsAgainst) },
  { key: 'ppga', group: 'Defense', label: 'Opponent power-play goals / game', direction: 'lower', decimals: 2, of: (t) => pg(t.a.powerPlayGoals, t.ag) },
];

const nhlSeasonKey = (season: number) => `${season}${season + 1}`;

function nhlGame(g: NhlClubGame, teamId: string): TeamGame {
  const home = g.home.id === teamId;
  const us = home ? g.home : g.away;
  const them = home ? g.away : g.home;
  return {
    id: g.id,
    start: g.start,
    date: g.date,
    home: home && !g.neutral,
    neutral: g.neutral,
    opponent: { id: them.id, name: them.name, abbr: them.abbr, logoUrl: them.logoUrl },
    us: g.state === 'final' ? us.score : null,
    them: g.state === 'final' ? them.score : null,
    state: g.state,
    extra: g.extra,
    postseason: g.postseason,
    label: g.label ?? (g.neutral ? 'neutral site' : null),
    venue: g.venue,
    opponentRank: null,
    href: `/nhl/game/${g.id}`,
  };
}

function nhlStandingsTables(rows: NhlStandingRow[], teamId: string): TeamStandingsTable[] {
  const me = rows.find((r) => r.teamId === teamId);
  if (!me) return [];
  const toRow = (r: NhlStandingRow) => ({
    team: { id: r.teamId, name: r.name, abbr: r.abbr, logoUrl: r.logoUrl },
    href: `/nhl/team/${r.teamId}`,
    values: { gp: r.gp, w: r.w, l: r.l, otl: r.otl, pts: r.pts, ppct: r.pointPctg ? r.pointPctg.toFixed(3).replace(/^0/, '') : null, rw: r.rw, gf: r.gf, ga: r.ga, diff: `${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}`, home: r.home, road: r.road, l10: r.l10, strk: r.streak },
  });
  const cols = [col('gp', 'GP'), col('w', 'W'), col('l', 'L'), col('otl', 'OTL'), col('pts', 'PTS'), col('ppct', 'P%'), col('rw', 'RW', 0, 'Regulation wins'), col('gf', 'GF'), col('ga', 'GA'), col('diff', 'Diff'), col('home', 'Home'), col('road', 'Road'), col('l10', 'L10'), col('strk', 'Strk')];
  return [
    { title: `${me.division} Division`, columns: cols, rows: rows.filter((r) => r.division === me.division).sort((a, b) => a.divisionSequence - b.divisionSequence).map(toRow) },
    { title: `${me.conference} Conference`, columns: cols.filter((c) => !['home', 'road', 'gf', 'ga'].includes(c.key)), rows: rows.filter((r) => r.conference === me.conference).sort((a, b) => a.conferenceSequence - b.conferenceSequence).map(toRow) },
  ];
}

async function nhlSeason(teamId: string, abbrev: string, season: number, current: number) {
  const key = nhlSeasonKey(season);
  const [games, standings, roster, production, shots] = await Promise.all([
    fetchClubSeasonGames(abbrev, key, season < current),
    fetchNhlSeasonStandings(key),
    readRosterProduction('nhl', season, teamId),
    readLeagueProduction('nhl', season, null),
    readTeamShotProfile('nhl', season, teamId).catch(() => null),
  ]);
  const base = numbersFor(production, standings.length ? standings.map((r) => r.teamId) : Object.keys(production.for));
  const numbers = new Map<string, NhlNumbers>();
  for (const [id, n] of base.numbers) {
    const st = standings.find((r) => r.teamId === id);
    numbers.set(id, { ...n, gf: st?.gf ?? null, ga: st?.ga ?? null, gp: st?.gp ?? 0 });
  }
  const names = await nhlPlayerNames(abbrev, key, roster.rows.map((r) => r.athleteId));
  const data: TeamSeasonData = {
    season,
    games: games.map((g) => nhlGame(g, teamId)),
    standings: nhlStandingsTables(standings, teamId),
    stats: rankTeamStats(NHL_STATS, numbers, base.pool, teamId),
    roster: roster.rows.map((r) => {
      const n = names.get(r.athleteId);
      return {
        id: r.athleteId,
        name: n?.name ?? `Player ${r.athleteId}`,
        position: r.position ?? n?.position ?? null,
        headshotUrl: n?.headshotUrl ?? null,
        href: `/nhl/player/${r.athleteId}`,
        games: r.games,
        score: r.score,
        stats: r.stats,
      };
    }),
  };
  return { data, shots, rosterAsOf: roster.computedAt };
}

export async function readNhlTeamResearch(teamId: number, now: Date = new Date()): Promise<HoopsHockeyTeamResearchPayload | null> {
  const id = String(teamId);
  const abbrev = await abbrevForTeamId(id);
  if (!abbrev) return null;
  const current = seasonForDate('nhl', now);
  const wanted = [current, current - 1];
  const built = await Promise.all(wanted.map((s) => nhlSeason(id, abbrev, s, current)));
  const seasons = built.map((b) => b.data).filter((d) => d.games.length || d.roster.length);
  const raw = (await Promise.all(wanted.map((s) => fetchClubSeasonGames(abbrev, nhlSeasonKey(s), s < current)))).flat();
  const me = raw.map((g) => (g.home.id === id ? g.home : g.away.id === id ? g.away : null)).find(Boolean);
  if (!me || !seasons.length) return null;
  const fetchedAt = now.toISOString();
  const shots: HoopsHockeyTeamResearchPayload['shots'] = {};
  wanted.forEach((s, i) => (shots[String(s)] = built[i].shots));
  return {
    sport: 'nhl',
    team: { id, name: me.name, abbr: me.abbr, logoUrl: me.logoUrl, venue: raw.find((g) => g.home.id === id && !g.neutral && !g.postseason)?.venue ?? null, color: null },
    currentSeason: current,
    seasons,
    shots,
    sources: [
      { label: 'Schedule and results', detail: 'NHL api-web club schedule; regular season and playoffs apart, overtime and shootout from each game’s last period', asOf: fetchedAt },
      { label: 'Standings', detail: 'NHL api-web standings; a finished season at its final date', asOf: fetchedAt },
      { label: 'Team stats', detail: 'team_game_production (box scores summed per team and per opponent) with goals from the standings, ranked across the NHL’s 32 teams here', asOf: built[0].rosterAsOf },
      { label: 'Roster production', detail: 'player_game_history summed per player; ordered by the production score in player_season_production; names from the NHL', asOf: built[0].rosterAsOf },
      { label: 'Shot map', detail: 'team_shot_profile from nhl_shot_events, regular season, 5-ft bins', asOf: built[0].rosterAsOf },
    ],
    fetchedAt,
  };
}
