/**
 * Soccer's team page read — R7.4, EPL and MLS. One `TeamResearchPayload` for
 * the current and previous season.
 *
 * - schedule and results: ESPN's team schedule, played and unplayed fetched
 *   apart and filtered to the season asked for (`fixture=true` returns the
 *   current season whatever season is named); MLS playoff rounds kept apart
 *   from the regular season (R7-C1);
 * - standings: ESPN — the Premier League table, or the club's MLS conference —
 *   by ESPN's own rank;
 * - team stats: the R5b rollup `team_game_production` for and allowed, with
 *   goals and points from the standings, ranked across the league's clubs
 *   (EPL and MLS apart). Fouls, offsides, cards and saves are not ranked: none
 *   has a better direction a count can show (R2);
 * - roster production: `player_season_production` plus the game logs, named
 *   from ESPN.
 *
 * Server-only: reads Postgres.
 */

import { espnAthleteNames, fetchStandingsGroups, fetchTeamSeasonGames, type EspnSeasonGame, type EspnStandingsGroup } from '@/lib/sports/multiSport/teamSportEspn';
import { readLeagueProduction } from '@/lib/sports/shared/teamProduction';
import { readRosterProduction } from '@/lib/sports/shared/teamRosterServer';
import { rankTeamStats, type TeamStatDef } from '@/lib/sports/shared/teamResearch';
import { realTeams, seasonForDate } from '@/lib/sports/shared/season';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import type { ResearchColumn } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamGame, TeamResearchPayload, TeamSeasonData, TeamStandingsTable } from '@/lib/sports/shared/teamResearchShapes';

export type SoccerTeamSport = 'soccer_epl' | 'soccer_mls';

const ESPN_LEAGUE: Record<SoccerTeamSport, string> = { soccer_epl: 'eng.1', soccer_mls: 'usa.1' };
const SLUG: Record<SoccerTeamSport, string> = { soccer_epl: 'epl', soccer_mls: 'mls' };

function toTeamGame(g: EspnSeasonGame, teamId: string, sport: SoccerTeamSport): TeamGame {
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
    href: `/soccer/${SLUG[sport]}/game/${g.id}`,
  };
}

const col = (key: string, label: string): ResearchColumn => ({ key, label, decimals: 0 });

/**
 * ESPN names the group with its season at either end ("English Premier League
 * 2025-2026", "2026-27 English Premier League"); the page already names the
 * season, so the table is just the league.
 */
export const tableTitle = (name: string) => name.replace(/^\s*\d{4}(?:[-/]\d{2,4})?\s+/, '').replace(/\s+\d{4}(?:[-/]\d{2,4})?\s*$/, '').trim();

function standingsTables(groups: EspnStandingsGroup[], teamId: string, sport: SoccerTeamSport): TeamStandingsTable[] {
  const mine = groups.find((g) => g.entries.some((e) => e.team.id === teamId));
  if (!mine) return [];
  const rank = (e: EspnStandingsGroup['entries'][number]) => e.stats.rank?.value ?? 99;
  const keys: Array<[string, string]> = [['p', 'gamesPlayed'], ['w', 'wins'], ['d', 'ties'], ['l', 'losses'], ['gf', 'pointsFor'], ['ga', 'pointsAgainst'], ['gd', 'pointDifferential'], ['pts', 'points']];
  return [
    {
      title: tableTitle(mine.name),
      columns: [col('p', 'P'), col('w', 'W'), col('d', 'D'), col('l', 'L'), col('gf', 'GF'), col('ga', 'GA'), col('gd', 'GD'), col('pts', 'Pts')],
      rows: [...mine.entries]
        .sort((a, b) => rank(a) - rank(b))
        .map((e) => ({ team: e.team, href: `/soccer/${SLUG[sport]}/team/${e.team.id}`, values: Object.fromEntries(keys.map(([k, s]) => [k, e.stats[s]?.display || null])) })),
    },
  ];
}

interface Numbers {
  f: Record<string, number>;
  a: Record<string, number>;
  g: number;
  gp: number;
  gf: number | null;
  ga: number | null;
  pts: number | null;
}

const pg = (v: number | null | undefined, g: number) => (v != null && g ? v / g : null);
const pct = (a: number | undefined, b: number | undefined) => (a != null && b ? (100 * a) / b : null);

const SOCCER_STATS: Array<TeamStatDef<Numbers>> = [
  { key: 'ppm', group: 'Attack', label: 'Points / match', direction: 'higher', decimals: 2, of: (t) => pg(t.pts, t.gp) },
  { key: 'gfpm', group: 'Attack', label: 'Goals / match', direction: 'higher', decimals: 2, of: (t) => pg(t.gf, t.gp) },
  { key: 'shots', group: 'Attack', label: 'Shots / match', direction: 'higher', decimals: 1, of: (t) => pg(t.f.totalShots, t.g) },
  { key: 'sot', group: 'Attack', label: 'Shots on target / match', direction: 'higher', decimals: 1, of: (t) => pg(t.f.shotsOnTarget, t.g) },
  { key: 'acc', group: 'Attack', label: 'On target %', direction: 'higher', decimals: 1, format: 'percent', of: (t) => pct(t.f.shotsOnTarget, t.f.totalShots) },
  { key: 'conv', group: 'Attack', label: 'Goals per shot', direction: 'higher', decimals: 1, format: 'percent', of: (t) => pct(t.f.totalGoals, t.f.totalShots) },
  { key: 'gapm', group: 'Defense', label: 'Goals conceded / match', direction: 'lower', decimals: 2, of: (t) => pg(t.ga, t.gp) },
  { key: 'shotsA', group: 'Defense', label: 'Shots allowed / match', direction: 'lower', decimals: 1, of: (t) => pg(t.a.totalShots, t.g) },
  { key: 'sotA', group: 'Defense', label: 'On target allowed / match', direction: 'lower', decimals: 1, of: (t) => pg(t.a.shotsOnTarget, t.g) },
  { key: 'convA', group: 'Defense', label: 'Opponent goals per shot', direction: 'lower', decimals: 1, format: 'percent', of: (t) => pct(t.a.totalGoals, t.a.totalShots) },
];

async function seasonData(sport: SoccerTeamSport, teamId: string, season: number, current: number): Promise<{ data: TeamSeasonData; rosterAsOf: string | null }> {
  const league = ESPN_LEAGUE[sport];
  const [games, groups, roster, production] = await Promise.all([
    fetchTeamSeasonGames('soccer', league, teamId, season, season < current),
    fetchStandingsGroups('soccer', league, season),
    readRosterProduction(sport, season, teamId),
    readLeagueProduction(sport, season, null),
  ]);
  const numbers = new Map<string, Numbers>();
  for (const e of groups.flatMap((g) => g.entries)) {
    const f = production.for[e.team.id];
    if (!f) continue;
    numbers.set(e.team.id, {
      f: f.s,
      a: production.allowed[e.team.id]?.s ?? {},
      g: f.g,
      gp: e.stats.gamesPlayed?.value ?? 0,
      gf: e.stats.pointsFor?.value ?? null,
      ga: e.stats.pointsAgainst?.value ?? null,
      pts: e.stats.points?.value ?? null,
    });
  }
  const pool = new Set(realTeams([...numbers].map(([id, n]) => ({ teamId: id, games: n.g }))).map((r) => r.teamId));
  const names = await espnAthleteNames('soccer', league, teamId, roster.rows.map((r) => r.athleteId));
  return {
    rosterAsOf: roster.computedAt,
    data: {
      season,
      games: games.map((g) => toTeamGame(g, teamId, sport)),
      standings: standingsTables(groups, teamId, sport),
      stats: rankTeamStats(SOCCER_STATS, numbers, pool, teamId),
      loggedGames: production.for[teamId]?.g,
      roster: roster.rows.map((r) => {
        const n = names.get(r.athleteId);
        return {
          id: r.athleteId,
          name: n?.name ?? `Player ${r.athleteId}`,
          position: r.position ?? n?.position ?? null,
          headshotUrl: `https://a.espncdn.com/i/headshots/soccer/players/full/${r.athleteId}.png`,
          href: `/soccer/${SLUG[sport]}/player/${r.athleteId}`,
          games: r.games,
          score: r.score,
          stats: r.stats,
        };
      }),
    },
  };
}

export async function readSoccerTeamResearch(sport: SoccerTeamSport, teamId: number, now: Date = new Date()): Promise<TeamResearchPayload | null> {
  const id = String(teamId);
  const current = seasonForDate(sport, now);
  const wanted = [current, current - 1];
  const built = await Promise.all(wanted.map((s) => seasonData(sport, id, s, current)));
  const seasons = built.map((b) => b.data).filter((d) => d.games.length || d.roster.length);
  const raw = (await Promise.all(wanted.map((s) => fetchTeamSeasonGames('soccer', ESPN_LEAGUE[sport], id, s, s < current)))).flat();
  const me = raw.map((g) => (g.home.id === id ? g.home : g.away.id === id ? g.away : null)).find(Boolean);
  if (!me || !seasons.length) return null;
  const fetchedAt = now.toISOString();
  return {
    sport,
    team: { id, name: me.name, abbr: me.abbr, logoUrl: me.logoUrl, venue: raw.find((g) => g.home.id === id && !g.neutral && !g.postseason)?.venue ?? null, color: null },
    currentSeason: current,
    seasons,
    sources: [
      { label: 'Schedule and results', detail: 'ESPN team schedule, played and unplayed matches, each filtered to its own season', asOf: fetchedAt },
      { label: 'Standings', detail: sport === 'soccer_mls' ? 'ESPN MLS standings, by conference' : 'ESPN Premier League table', asOf: fetchedAt },
      { label: 'Team stats', detail: `team_game_production (box scores summed per club and per opponent) with goals and points from the standings, ranked across ${sport === 'soccer_mls' ? 'MLS' : 'Premier League'} clubs here`, asOf: built.map((b) => b.rosterAsOf).find(Boolean) ?? null },
      { label: 'Roster production', detail: 'player_game_history summed per player; ordered by the production score in player_season_production; names from ESPN', asOf: built.map((b) => b.rosterAsOf).find(Boolean) ?? null },
    ],
    fetchedAt,
  };
}
