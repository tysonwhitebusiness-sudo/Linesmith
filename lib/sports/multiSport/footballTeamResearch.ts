/**
 * NFL's and CFB's team page read — R7.2. One `TeamResearchPayload` for the
 * current and previous season.
 *
 * - schedule and results: ESPN's team schedule, regular season and postseason
 *   fetched apart (R7-C1);
 * - standings: ESPN standings — NFL the division then the conference, CFB the
 *   conference — in ESPN's published order;
 * - team stats: the R5b rollup `team_game_production` for what a team produced
 *   AND what it allowed, every team at once, with points from the standings.
 *   Ranked in the builder across the real teams of that standings table (CFB:
 *   FBS only), per game throughout. ESPN's own ranks are never read (R2);
 * - roster production: `player_season_production` plus the game logs, named
 *   from ESPN;
 * - NFL's passing game: `team_target_profile` (R5d).
 *
 * Server-only: reads Postgres.
 */

import { espnAthleteNames, fetchStandingsGroups, fetchTeamSeasonGames, type EspnSeasonGame, type EspnStandingsGroup } from './teamSportEspn';
import { readLeagueProduction } from '@/lib/sports/shared/teamProduction';
import { readRosterProduction } from '@/lib/sports/shared/teamRosterServer';
import { realTeams, seasonForDate } from '@/lib/sports/shared/season';
import { readNflTeamTargets } from '@/lib/sports/nfl/teamTargets';
import { easternDate } from '@/lib/sports/mlb/statsapi';
import type { NflTeamTargets } from '@/lib/sports/nfl/teamTargetShapes';
import type { ResearchColumn } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamGame, TeamResearchPayload, TeamSeasonData, TeamStandingsTable, TeamStatValue } from '@/lib/sports/shared/teamResearchShapes';

export interface FootballTeamResearchPayload extends TeamResearchPayload {
  /** NFL only: where the offense throws and the defense is thrown at, per season. Empty for CFB. */
  targets: Record<string, NflTeamTargets | null>;
}

const ESPN_LEAGUE = { nfl: 'nfl', cfb: 'college-football' } as const;

function toTeamGame(g: EspnSeasonGame, teamId: string, league: 'nfl' | 'cfb', today: string): TeamGame {
  const home = g.home.id === teamId;
  const us = home ? g.home : g.away;
  const them = home ? g.away : g.home;
  return {
    id: g.id,
    start: g.start,
    // ESPN dates by UTC; a night kickoff belongs to the previous Eastern day.
    date: easternDate(new Date(g.start)),
    // A neutral-site game (a bowl, an international game) is nobody's home.
    home: home && !g.neutral,
    neutral: g.neutral,
    opponent: { id: them.id, name: them.name, abbr: them.abbr, logoUrl: them.logoUrl },
    us: g.state === 'final' ? us.score : null,
    them: g.state === 'final' ? them.score : null,
    state: g.state,
    extra: g.extra,
    postseason: g.postseason,
    label: g.postseason ? g.label : g.neutral ? [g.label, 'neutral site'].filter(Boolean).join(' · ') : g.label,
    venue: g.venue,
    opponentRank: them.rank,
    // CFB game pages cover past games; NFL's do not until R8 (B5).
    href: league === 'cfb' || easternDate(new Date(g.start)) >= today ? `/${league}/game/${g.id}` : null,
  };
}

const col = (key: string, label: string, info?: string): ResearchColumn => ({ key, label, decimals: 0, ...(info ? { info } : {}) });

function standingsTables(groups: EspnStandingsGroup[], teamId: string, league: 'nfl' | 'cfb'): TeamStandingsTable[] {
  const mine = groups.find((g) => g.entries.some((e) => e.team.id === teamId));
  if (!mine) return [];
  const d = (e: EspnStandingsGroup['entries'][number], name: string) => e.stats[name]?.display || null;
  const row = (e: EspnStandingsGroup['entries'][number], keys: Array<[string, string]>) => ({
    team: e.team,
    href: `/${league}/team/${e.team.id}`,
    values: Object.fromEntries(keys.map(([k, stat]) => [k, d(e, stat)])),
  });
  if (league === 'cfb') {
    const keys: Array<[string, string]> = [['overall', 'overall'], ['conf', 'vs. Conf.'], ['pf', 'pointsFor'], ['pa', 'pointsAgainst'], ['diff', 'pointDifferential'], ['home', 'Home'], ['away', 'Away'], ['top25', 'vs AP Top 25'], ['strk', 'streak']];
    return [
      {
        title: mine.name,
        columns: [col('overall', 'Overall', 'Includes bowl and playoff games'), col('conf', 'Conf'), col('pf', 'PF'), col('pa', 'PA'), col('diff', 'Diff'), col('home', 'Home'), col('away', 'Away'), col('top25', 'vs Top 25'), col('strk', 'Strk')],
        rows: mine.entries.map((e) => row(e, keys)),
      },
    ];
  }
  // A division's order is its tiebreaks. ESPN's entry order is not reliably
  // that, but conference seeds are: a division winner is seeded above the rest
  // of its division, and the rest keep their conference order. Before seeds
  // exist (week 1) the published order stands.
  const seeded = (entries: EspnStandingsGroup['entries']) =>
    entries.every((e) => (e.stats.playoffSeed?.value ?? 0) > 0) ? [...entries].sort((a, b) => (a.stats.playoffSeed!.value ?? 0) - (b.stats.playoffSeed!.value ?? 0)) : entries;
  const conference = mine.parents[mine.parents.length - 1] ?? '';
  const confEntries = groups.filter((g) => g.parents[g.parents.length - 1] === conference).flatMap((g) => g.entries);
  const divKeys: Array<[string, string]> = [['w', 'wins'], ['l', 'losses'], ['t', 'ties'], ['pct', 'winPercent'], ['pf', 'pointsFor'], ['pa', 'pointsAgainst'], ['diff', 'pointDifferential'], ['home', 'Home'], ['road', 'Road'], ['div', 'vs. Div.'], ['conf', 'vs. Conf.'], ['strk', 'streak']];
  const ties = confEntries.some((e) => (e.stats.ties?.value ?? 0) > 0);
  const divCols = [col('w', 'W'), col('l', 'L'), ...(ties ? [col('t', 'T')] : []), col('pct', 'PCT'), col('pf', 'PF'), col('pa', 'PA'), col('diff', 'Diff'), col('home', 'Home'), col('road', 'Road'), col('div', 'Div'), col('conf', 'Conf'), col('strk', 'Strk')];
  return [
    { title: mine.name, columns: divCols, rows: seeded(mine.entries).map((e) => row(e, divKeys)) },
    {
      title: conference,
      // Ordered by seed, so the table's own # is the seed; a Seed column repeated it.
      columns: divCols.filter((c) => !['home', 'road', 'pf', 'pa'].includes(c.key)),
      rows: seeded(confEntries).map((e) => row(e, divKeys)),
    },
  ];
}

type StatDef = Omit<TeamStatValue, 'value' | 'league' | 'group'> & { group: 'Offense' | 'Defense'; of: (t: TeamNumbers) => number | null };

interface TeamNumbers {
  games: number;
  pf: number | null;
  pa: number | null;
  standingsGames: number;
  f: Record<string, number>;
  a: Record<string, number>;
  aGames: number;
}

const perGame = (v: number | undefined, g: number) => (v != null && g ? v / g : null);
const per = (a: number | undefined, b: number | undefined) => (a != null && b ? a / b : null);

const FOOTBALL_STATS: StatDef[] = [
  { key: 'ppg', group: 'Offense', label: 'Points / game', direction: 'higher', decimals: 1, of: (t) => perGame(t.pf ?? undefined, t.standingsGames) },
  { key: 'passYpg', group: 'Offense', label: 'Passing yards / game', direction: 'higher', decimals: 1, of: (t) => perGame(t.f['passing.passingYards'], t.games) },
  { key: 'rushYpg', group: 'Offense', label: 'Rushing yards / game', direction: 'higher', decimals: 1, of: (t) => perGame(t.f['rushing.rushingYards'], t.games) },
  { key: 'ypa', group: 'Offense', label: 'Yards / pass attempt', direction: 'higher', decimals: 2, of: (t) => per(t.f['passing.passingYards'], t.f['passing.passingAttempts']) },
  { key: 'ypc', group: 'Offense', label: 'Yards / rush', direction: 'higher', decimals: 2, of: (t) => per(t.f['rushing.rushingYards'], t.f['rushing.rushingAttempts']) },
  { key: 'passTd', group: 'Offense', label: 'Passing TD / game', direction: 'higher', decimals: 2, of: (t) => perGame(t.f['passing.passingTouchdowns'], t.games) },
  { key: 'rushTd', group: 'Offense', label: 'Rushing TD / game', direction: 'higher', decimals: 2, of: (t) => perGame(t.f['rushing.rushingTouchdowns'], t.games) },
  { key: 'sacked', group: 'Offense', label: 'Sacks taken / game', direction: 'lower', decimals: 2, of: (t) => perGame(t.f['passing.sacks'], t.games) },
  { key: 'intThrown', group: 'Offense', label: 'Interceptions thrown / game', direction: 'lower', decimals: 2, of: (t) => perGame(t.f['passing.interceptions'] ?? 0, t.games) },
  { key: 'fumLost', group: 'Offense', label: 'Fumbles lost / game', direction: 'lower', decimals: 2, of: (t) => perGame(t.f['fumbles.fumblesLost'], t.games) },
  { key: 'papg', group: 'Defense', label: 'Points allowed / game', direction: 'lower', decimals: 1, of: (t) => perGame(t.pa ?? undefined, t.standingsGames) },
  { key: 'passYa', group: 'Defense', label: 'Passing yards allowed / game', direction: 'lower', decimals: 1, of: (t) => perGame(t.a['passing.passingYards'], t.aGames) },
  { key: 'rushYa', group: 'Defense', label: 'Rushing yards allowed / game', direction: 'lower', decimals: 1, of: (t) => perGame(t.a['rushing.rushingYards'], t.aGames) },
  { key: 'ypaA', group: 'Defense', label: 'Yards / pass allowed', direction: 'lower', decimals: 2, of: (t) => per(t.a['passing.passingYards'], t.a['passing.passingAttempts']) },
  { key: 'ypcA', group: 'Defense', label: 'Yards / rush allowed', direction: 'lower', decimals: 2, of: (t) => per(t.a['rushing.rushingYards'], t.a['rushing.rushingAttempts']) },
  { key: 'sacks', group: 'Defense', label: 'Sacks / game', direction: 'higher', decimals: 2, of: (t) => perGame(t.f['defensive.sacks'], t.games) },
  { key: 'tfl', group: 'Defense', label: 'Tackles for loss / game', direction: 'higher', decimals: 2, of: (t) => perGame(t.f['defensive.tacklesForLoss'], t.games) },
  { key: 'defInt', group: 'Defense', label: 'Interceptions / game', direction: 'higher', decimals: 2, of: (t) => perGame(t.f['interceptions.interceptions'] ?? 0, t.games) },
];

/** Keys a sport's rollup holds at all; a stat built on an absent key is dropped, not ranked at zero. */
const ROLLUP_KEYS_NEEDED: Partial<Record<string, string>> = { sacked: 'passing.sacks', fumLost: 'fumbles.fumblesLost', tfl: 'defensive.tacklesForLoss' };

async function rankedStats(league: 'nfl' | 'cfb', season: number, teamId: string, groups: EspnStandingsGroup[]): Promise<TeamStatValue[]> {
  const production = await readLeagueProduction(league, season, null);
  const entries = groups.flatMap((g) => g.entries);
  const numbers = new Map<string, TeamNumbers>();
  for (const e of entries) {
    const f = production.for[e.team.id];
    if (!f) continue;
    const a = production.allowed[e.team.id];
    // Games from the overall record ("12-2"): ESPN's CFB standings carry `wins`
    // but no `losses`, and wins alone put Ohio State's 468 points over 12
    // games (39.0) instead of 14 (33.4) — caught refereeing R7.2.
    const overall = (e.stats.overall?.display ?? '').split('-').map(Number);
    const standingsGames = overall.length >= 2 && overall.every(Number.isFinite) ? overall.reduce((x, y) => x + y, 0) : (e.stats.wins?.value ?? 0) + (e.stats.losses?.value ?? 0) + (e.stats.ties?.value ?? 0);
    numbers.set(e.team.id, { games: f.g, pf: e.stats.pointsFor?.value ?? null, pa: e.stats.pointsAgainst?.value ?? null, standingsGames, f: f.s, a: a?.s ?? {}, aGames: a?.g ?? 0 });
  }
  // The rank pool is the standings' own teams that really played (R2's 30% rule).
  const pool = new Set(realTeams([...numbers].map(([id, n]) => ({ teamId: id, games: n.games }))).map((r) => r.teamId));
  const mine = numbers.get(teamId);
  if (!mine || !pool.has(teamId)) return [];
  const heldKeys = new Set(Object.values(production.for).flatMap((x) => Object.keys(x.s)));
  const out: TeamStatValue[] = [];
  for (const { of, ...d } of FOOTBALL_STATS) {
    const needs = ROLLUP_KEYS_NEEDED[d.key];
    if (needs && !heldKeys.has(needs)) continue;
    const value = of(mine);
    const leagueValues = [...pool].map((id) => of(numbers.get(id)!)).filter((v): v is number => v != null && Number.isFinite(v));
    if (value == null || leagueValues.length < 2) continue;
    out.push({ ...d, value, league: leagueValues });
  }
  return out;
}

const headshot = (league: 'nfl' | 'cfb', id: string) => `https://a.espncdn.com/i/headshots/${league === 'nfl' ? 'nfl' : 'college-football'}/players/full/${id}.png`;

/** A player the roster tables can show: linemen and specialists with nothing in any group are not looked up. */
const PRODUCED = ['passing.passingAttempts', 'rushing.rushingAttempts', 'receiving.receptions', 'receiving.receivingTargets', 'defensive.totalTackles'];

async function seasonData(league: 'nfl' | 'cfb', teamId: string, season: number, current: number, today: string): Promise<{ data: TeamSeasonData; rosterAsOf: string | null; targets: NflTeamTargets | null }> {
  const espnLeague = ESPN_LEAGUE[league];
  const [games, groups, roster, targets] = await Promise.all([
    fetchTeamSeasonGames('football', espnLeague, teamId, season, season < current),
    fetchStandingsGroups('football', espnLeague, season, league === 'nfl' ? 3 : undefined),
    readRosterProduction(league, season, teamId),
    league === 'nfl' ? readNflTeamTargets(season, teamId).catch(() => null) : Promise.resolve(null),
  ]);
  const shown = roster.rows.filter((r) => PRODUCED.some((k) => (r.stats[k] ?? 0) > 0));
  const [names, stats] = await Promise.all([espnAthleteNames('football', espnLeague, teamId, shown.map((r) => r.athleteId)), rankedStats(league, season, teamId, groups)]);
  return {
    rosterAsOf: roster.computedAt,
    targets,
    data: {
      season,
      games: games.map((g) => toTeamGame(g, teamId, league, today)),
      standings: standingsTables(groups, teamId, league),
      stats,
      roster: shown.map((r) => {
        const n = names.get(r.athleteId);
        return {
          id: r.athleteId,
          name: n?.name ?? `Player ${r.athleteId}`,
          position: r.position ?? n?.position ?? null,
          headshotUrl: headshot(league, r.athleteId),
          href: `/${league}/player/${r.athleteId}`,
          games: r.games,
          score: r.score,
          stats: r.stats,
        };
      }),
    },
  };
}

export async function readFootballTeamResearch(league: 'nfl' | 'cfb', teamId: number, now: Date = new Date()): Promise<FootballTeamResearchPayload | null> {
  const id = String(teamId);
  const today = easternDate(now);
  const current = seasonForDate(league, now);
  const wanted = [current, current - 1];
  const built = await Promise.all(wanted.map((s) => seasonData(league, id, s, current, today)));
  const seasons = built.map((b) => b.data).filter((d) => d.games.length || d.roster.length);
  if (!seasons.length) return null;

  // The team's own name and logo, from its own games.
  const anyGame = seasons.flatMap((s) => s.games)[0];
  const raw = await fetchTeamSeasonGames('football', ESPN_LEAGUE[league], id, seasons[0].season, seasons[0].season < current);
  const sideOf = raw.map((g) => (g.home.id === id ? g.home : g.away.id === id ? g.away : null)).find(Boolean);
  if (!sideOf || !anyGame) return null;
  const venue = raw.find((g) => g.home.id === id && !g.neutral && !g.postseason)?.venue ?? null;
  const fetchedAt = now.toISOString();
  const targets: FootballTeamResearchPayload['targets'] = {};
  wanted.forEach((s, i) => (targets[String(s)] = built[i].targets));
  return {
    sport: league,
    team: { id, name: sideOf.name, abbr: sideOf.abbr, logoUrl: sideOf.logoUrl, venue, color: null },
    currentSeason: current,
    seasons,
    targets,
    sources: [
      { label: 'Schedule and results', detail: 'ESPN team schedule, regular season and postseason fetched apart', asOf: fetchedAt },
      { label: 'Standings', detail: 'ESPN standings, in ESPN’s published order', asOf: fetchedAt },
      {
        label: 'Team stats',
        detail: `team_game_production (players’ box scores summed per team and per opponent) with points from ESPN standings, ranked across ${league === 'cfb' ? 'FBS' : 'NFL'} teams here`,
        asOf: built[0].rosterAsOf,
      },
      { label: 'Roster production', detail: 'player_game_history summed per player; ordered by the production score in player_season_production; names from ESPN', asOf: built[0].rosterAsOf },
      ...(league === 'nfl' ? [{ label: 'Passing game', detail: 'team_target_profile, from nflverse play-by-play', asOf: built[0].rosterAsOf }] : []),
    ],
    fetchedAt,
  };
}
