/**
 * MLB's team page read — R7.1. One `TeamResearchPayload` for the current and
 * previous season, plus MLB's own team Statcast rollup.
 *
 * Every piece is the league's own number or the app's own game logs:
 * - schedule and results: StatsAPI's team schedule, game type kept (R7-C1);
 * - standings: StatsAPI standings, the team's division then its league;
 * - team stats: StatsAPI team season stats for all 30 clubs, ranked in the
 *   builder with a direction per stat (R2) — StatsAPI's own ranks are not read;
 * - roster production: `player_season_production` plus the game logs;
 * - Statcast: `mlb_statcast_team_season` (R5a).
 *
 * Server-only: reads Postgres.
 */

import { easternDate, getPeople, getStandingsRows, getTeamInfo, getTeamSeasonSchedule, getTeamSeasonStatObjects, type MlbStandingRow, type MlbTeamScheduleGame } from './statsapi';
import { readTeamStatcast } from './statcastRollups';
import { teamPrimaryColor } from './teamColors';
import type { TeamStatcastSeason } from './statcastRollupShapes';
import { readRosterProduction } from '@/lib/sports/shared/teamRosterServer';
import { seasonForDate } from '@/lib/sports/shared/season';
import type { ResearchColumn } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamGame, TeamRef, TeamResearchPayload, TeamSeasonData, TeamStandingsTable, TeamStatValue } from '@/lib/sports/shared/teamResearchShapes';

export interface MlbTeamResearchPayload extends TeamResearchPayload {
  /** Team Statcast per season, lineup and staff; `null` where the rollup holds no row. */
  statcast: Record<string, { bat: TeamStatcastSeason | null; pit: TeamStatcastSeason | null; asOf: string | null } | null>;
}

const logo = (id: number | string) => `https://www.mlbstatic.com/team-logos/${id}.svg`;
const headshot = (id: string) =>
  `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,d_people:generic:headshot:67:current.png,q_auto:best,f_auto/v1/people/${id}/headshot/67/current`;

const POSTSEASON_TYPES = new Set(['F', 'D', 'L', 'W']);

function toTeamGame(g: MlbTeamScheduleGame, teamId: number, today: string): TeamGame {
  const home = g.homeId === teamId;
  const extraInnings = g.state === 'final' && g.innings != null && g.innings > g.scheduledInnings ? `F/${g.innings}` : null;
  const postseason = POSTSEASON_TYPES.has(g.gameType);
  return {
    id: String(g.gamePk),
    start: g.gameDate,
    date: g.officialDate,
    home,
    opponent: home
      ? { id: String(g.awayId), name: g.awayName, abbr: g.awayAbbr, logoUrl: logo(g.awayId) }
      : { id: String(g.homeId), name: g.homeName, abbr: g.homeAbbr, logoUrl: logo(g.homeId) },
    us: home ? g.homeScore : g.awayScore,
    them: home ? g.awayScore : g.homeScore,
    state: g.state,
    extra: extraInnings,
    postseason,
    label: postseason
      ? `${g.seriesDescription ?? 'Postseason'}${g.seriesGameNumber ? ` G${g.seriesGameNumber}` : ''}`
      : g.doubleHeader !== 'N'
        ? `Doubleheader G${g.gameNumber}`
        : null,
    venue: g.venue,
    opponentRank: null,
    // Past MLB games have no page until R8 (B5); today's and later games do.
    href: g.officialDate >= today ? `/mlb/game/${g.gamePk}` : null,
  };
}

const STANDING_COLUMNS: ResearchColumn[] = [
  { key: 'w', label: 'W', decimals: 0 },
  { key: 'l', label: 'L', decimals: 0 },
  { key: 'pct', label: 'PCT', decimals: 0 },
  { key: 'gb', label: 'GB', decimals: 0 },
  { key: 'wcgb', label: 'WCGB', decimals: 0, info: 'Games behind the last wild-card place' },
  { key: 'diff', label: 'Diff', decimals: 0 },
  { key: 'home', label: 'Home', decimals: 0 },
  { key: 'away', label: 'Away', decimals: 0 },
  { key: 'l10', label: 'L10', decimals: 0 },
  { key: 'strk', label: 'Strk', decimals: 0 },
];

function standingsTables(rows: MlbStandingRow[], teamId: number): TeamStandingsTable[] {
  const me = rows.find((r) => r.teamId === teamId);
  if (!me) return [];
  const toRow = (r: MlbStandingRow) => ({
    team: { id: String(r.teamId), name: r.name, abbr: r.abbr, logoUrl: logo(r.teamId) },
    href: `/mlb/team/${r.teamId}`,
    values: {
      w: r.wins,
      l: r.losses,
      pct: r.pct,
      gb: r.gamesBack,
      wcgb: r.wildCardGamesBack,
      diff: `${r.runDifferential > 0 ? '+' : ''}${r.runDifferential}`,
      home: r.home,
      away: r.away,
      l10: r.lastTen,
      strk: r.streak,
    },
  });
  const division = rows.filter((r) => r.divisionId === me.divisionId).sort((a, b) => a.divisionRank - b.divisionRank);
  const league = rows.filter((r) => r.leagueId === me.leagueId).sort((a, b) => Number(b.pct) - Number(a.pct) || b.wins - a.wins);
  return [
    { title: me.divisionName, columns: STANDING_COLUMNS.filter((c) => c.key !== 'wcgb'), rows: division.map(toRow) },
    { title: me.leagueName, columns: STANDING_COLUMNS.filter((c) => c.key !== 'gb'), rows: league.map(toRow) },
  ];
}

type StatDef = Omit<TeamStatValue, 'value' | 'league' | 'group'> & { of: (s: Record<string, number>) => number | null };

const per = (a: number | undefined, b: number | undefined, k = 1) => (a != null && b ? (k * a) / b : null);

/**
 * Per game or per plate appearance throughout: clubs have played different
 * numbers of games (151 to 153 on 2026-09-16), so a season total ranks the
 * schedule as much as the team.
 */
const HITTING: StatDef[] = [
  { key: 'rpg', label: 'Runs / game', direction: 'higher', decimals: 2, of: (s) => per(s.runs, s.gamesPlayed) },
  { key: 'avg', label: 'AVG', direction: 'higher', decimals: 3, format: 'rate3', of: (s) => s.avg ?? null },
  { key: 'obp', label: 'OBP', direction: 'higher', decimals: 3, format: 'rate3', of: (s) => s.obp ?? null },
  { key: 'slg', label: 'SLG', direction: 'higher', decimals: 3, format: 'rate3', of: (s) => s.slg ?? null },
  { key: 'ops', label: 'OPS', direction: 'higher', decimals: 3, format: 'rate3', of: (s) => s.ops ?? null },
  { key: 'hrpg', label: 'Home runs / game', direction: 'higher', decimals: 2, of: (s) => per(s.homeRuns, s.gamesPlayed) },
  { key: 'kpct', label: 'Strikeout %', direction: 'lower', decimals: 1, format: 'percent', of: (s) => per(s.strikeOuts, s.plateAppearances, 100) },
  { key: 'bbpct', label: 'Walk %', direction: 'higher', decimals: 1, format: 'percent', of: (s) => per(s.baseOnBalls, s.plateAppearances, 100) },
  { key: 'sbpg', label: 'Stolen bases / game', direction: 'higher', decimals: 2, of: (s) => per(s.stolenBases, s.gamesPlayed) },
];

const PITCHING: StatDef[] = [
  { key: 'rapg', label: 'Runs allowed / game', direction: 'lower', decimals: 2, of: (s) => per(s.runs, s.gamesPlayed) },
  { key: 'era', label: 'ERA', direction: 'lower', decimals: 2, of: (s) => s.era ?? null },
  { key: 'whip', label: 'WHIP', direction: 'lower', decimals: 2, of: (s) => s.whip ?? null },
  { key: 'k9', label: 'Strikeouts / 9', direction: 'higher', decimals: 1, of: (s) => per(s.strikeOuts, s.outs, 27) },
  { key: 'bb9', label: 'Walks / 9', direction: 'lower', decimals: 1, of: (s) => per(s.baseOnBalls, s.outs, 27) },
  { key: 'hr9', label: 'Home runs / 9', direction: 'lower', decimals: 2, of: (s) => per(s.homeRuns, s.outs, 27) },
  { key: 'oavg', label: 'Opponent AVG', direction: 'lower', decimals: 3, format: 'rate3', of: (s) => s.avg ?? null },
];

function rankedStats(group: string, defs: StatDef[], all: Map<number, Record<string, number>>, teamId: number): TeamStatValue[] {
  const mine = all.get(teamId);
  if (!mine) return [];
  const out: TeamStatValue[] = [];
  for (const { of, ...d } of defs) {
    const value = of(mine);
    const league = [...all.values()].map(of).filter((v): v is number => v != null && Number.isFinite(v));
    if (value == null || league.length < 2) continue;
    out.push({ ...d, group, value, league });
  }
  return out;
}

async function seasonData(teamId: number, season: number, today: string): Promise<{ data: TeamSeasonData; rosterAsOf: string | null }> {
  const [schedule, standings, hitting, pitching, roster] = await Promise.all([
    getTeamSeasonSchedule(teamId, season),
    getStandingsRows(season),
    getTeamSeasonStatObjects(season, 'hitting'),
    getTeamSeasonStatObjects(season, 'pitching'),
    readRosterProduction('mlb', season, String(teamId)),
  ]);
  const people = await getPeople(roster.rows.map((r) => Number(r.athleteId)).filter(Number.isFinite));
  return {
    rosterAsOf: roster.computedAt,
    data: {
      season,
      games: schedule.map((g) => toTeamGame(g, teamId, today)),
      standings: standingsTables(standings, teamId),
      stats: [...rankedStats('Hitting', HITTING, hitting, teamId), ...rankedStats('Pitching', PITCHING, pitching, teamId)],
      roster: roster.rows.map((r) => {
        const p = people.get(Number(r.athleteId));
        return {
          id: r.athleteId,
          name: p?.name || `Player ${r.athleteId}`,
          position: p?.position ?? r.position,
          headshotUrl: headshot(r.athleteId),
          href: `/mlb/player/${r.athleteId}`,
          games: r.games,
          score: r.score,
          stats: r.stats,
        };
      }),
    },
  };
}

export async function readMlbTeamResearch(teamId: number, now: Date = new Date()): Promise<MlbTeamResearchPayload | null> {
  const info = await getTeamInfo(teamId);
  if (!info) return null;
  const today = easternDate(now);
  const current = seasonForDate('mlb', now);
  const seasonsWanted = [current, current - 1];
  const built = await Promise.all(seasonsWanted.map((s) => seasonData(teamId, s, today)));
  const statcastRows = await Promise.all(seasonsWanted.map((s) => readTeamStatcast(String(teamId), s).catch(() => [])));

  const seasons = built.map((b) => b.data).filter((d) => d.games.length || d.roster.length);
  const venue = seasons.flatMap((s) => s.games).find((g) => g.home && !g.postseason)?.venue ?? null;
  const statcast: MlbTeamResearchPayload['statcast'] = {};
  seasonsWanted.forEach((s, i) => {
    const rows = statcastRows[i];
    statcast[String(s)] = rows.length
      ? { bat: rows.find((r) => r.side === 'bat')?.payload ?? null, pit: rows.find((r) => r.side === 'pit')?.payload ?? null, asOf: rows[0].asOf }
      : null;
  });
  const fetchedAt = now.toISOString();
  const statcastAsOf = seasonsWanted.map((x) => statcast[String(x)]?.asOf).find(Boolean) ?? null;
  const team: TeamRef = { id: String(teamId), name: info.name, abbr: info.abbreviation, logoUrl: logo(teamId) };
  return {
    sport: 'mlb',
    team: { ...team, venue, color: teamPrimaryColor(teamId) },
    currentSeason: current,
    seasons,
    statcast,
    sources: [
      { label: 'Schedule and results', detail: 'MLB Stats API team schedule, regular season and postseason apart', asOf: fetchedAt },
      { label: 'Standings', detail: 'MLB Stats API standings', asOf: fetchedAt },
      { label: 'Team stats', detail: 'MLB Stats API team season stats for all 30 clubs, ranked here', asOf: fetchedAt },
      { label: 'Roster production', detail: "player_game_history summed per player; ordered by the production score in player_season_production", asOf: built.map((b) => b.rosterAsOf).find(Boolean) ?? null },
      { label: 'Contact & pitch quality', detail: 'Statcast corpus team rollup (mlb_statcast_team_season), regular season, pitch-weighted', asOf: statcastAsOf },
    ],
    fetchedAt,
  };
}
