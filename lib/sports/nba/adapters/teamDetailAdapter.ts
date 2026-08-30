/**
 * `TeamDetail.tsx` adapter — NBA half. Mirrors CFB's/soccer's team
 * adapter: no grading model (`grades: null`), no team-level windows/
 * distribution (same deferred gap as CFB/soccer). Real: roster, next
 * fixture with a real single-book pregame line, a recent-fixtures list
 * with real scores, real record/rank from standings.
 */

import { categoriseByLine, entryValue, fixedWindow, openWindow, subsetWindow, OVER, UNDER, type WindowedStat } from '@/lib/core/windowedStat';
import { directionMark } from '@/components/MarketLabel';
import type { PickCandidate } from '@/lib/core/types';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { SeasonAggregateResult } from '@/lib/sports/shared/seasonAggregates';
import { groupStats } from '@/lib/sports/shared/seasonAggregates';
import { NBA_SEASON_SPEC } from '@/lib/sports/shared/seasonAggregateSpecs';
import type { GameRow, RecentResultRow, RosterPlayer, TeamDetailData, TeamDistributionChartData, TeamNextGame, TeamWindowedForm } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { NbaTeam, NbaPregameLine } from '@/lib/sports/nba/espn';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';
import { buildNbaMoneylineCandidate, buildNbaGameTotalCandidate, buildNbaPointsForCandidate } from '@/lib/sports/nba/teamFormCandidates';
import type { EspnInjuryRow } from '@/lib/sports/multiSport/teamSportEspn';

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

interface NbaRosterSeasonStats {
  games: number;
  points: number;
  rebounds: number;
  assists: number;
}

function seasonLineText(s: NbaRosterSeasonStats | null): string {
  if (!s || s.games === 0) return 'No stats yet this season';
  return `${(s.points / s.games).toFixed(1)} pts · ${(s.rebounds / s.games).toFixed(1)} reb · ${(s.assists / s.games).toFixed(1)} ast`;
}

export interface NbaTeamDetailApiResponse {
  team: NbaTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null; seasonStats: NbaRosterSeasonStats | null }>;
  nextGame: EspnTeamSportGame | null;
  nextGameLine: NbaPregameLine | null;
  recentGames: EspnTeamSportGame[];
  /** Real, confirmed live 2026-08-24 against ESPN's NBA injuries feed. */
  injuries: EspnInjuryRow[];
  /** Real logo per real NBA abbreviation (2026-08-24) — feeds the distribution chart's `logoFor`. */
  logoByAbbr: Record<string, string>;
}

function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

/** Real final scores from ESPN's scoreboard `score`/`status` fields — no draws in basketball, so `isDraw` is always false. */
export function toNbaRecentResultRows(games: EspnTeamSportGame[], teamId: string): RecentResultRow[] {
  return games.map((g) => {
    const isHome = g.homeTeamId === teamId;
    const scoreFor = isHome ? g.homeScore : g.awayScore;
    const scoreAgainst = isHome ? g.awayScore : g.homeScore;
    const resolved = g.status?.completed === true && scoreFor != null && scoreAgainst != null;
    return {
      gameId: g.gameId,
      date: g.date,
      win: resolved ? scoreFor > scoreAgainst : null,
      opponentAbbr: isHome ? g.awayAbbr : g.homeAbbr,
      isHome,
      scoreFor: scoreFor ?? 0,
      scoreAgainst: scoreAgainst ?? 0,
    };
  });
}

export interface NbaTeamDetailScope {
  market: string | undefined;
  lineOffset: number;
  opponentOnly: boolean;
  venue: 'all' | 'home' | 'away';
  lastN: number | 'all';
}

export interface NbaTeamDetailInput {
  data: NbaTeamDetailApiResponse;
  scope: NbaTeamDetailScope;
  standingsTeams: TeamStandingRow[];
  /**
   * League-wide season aggregates and ranks (`useSeasonRanks`), Phase 6.1b.
   * Fills `statGroups` (this adapter emitted `[]`, making NBA's team page
   * the thinnest in the app) and `unitGrades`. `null` while loading — both
   * fall back to their empty states.
   */
  seasonRanks: SeasonAggregateResult | null;
}

export function toTeamDetailData(input: NbaTeamDetailInput): TeamDetailData {
  const { data, scope, standingsTeams, seasonRanks } = input;
  const { team, roster, nextGame, nextGameLine, recentGames, logoByAbbr } = data;

  const rosterPlayers: RosterPlayer[] = roster.map((p) => {
    const identityParams = new URLSearchParams({
      name: p.fullName,
      team: team.abbreviation,
      teamName: team.name,
      teamLogoUrl: team.logoUrl ?? '',
      ...(p.position ? { pos: p.position } : {}),
      ...(p.headshotUrl ? { headshot: p.headshotUrl } : {}),
    });
    return {
      subjectId: p.subjectId,
      name: p.fullName,
      position: p.position ?? '',
      teamAbbr: team.abbreviation,
      headshotUrl: p.headshotUrl ?? undefined,
      seasonLineText: seasonLineText(p.seasonStats),
      hasStats: p.seasonStats != null && p.seasonStats.games > 0,
      href: `/nba/player/${encodeURIComponent(p.subjectId)}?${identityParams.toString()}`,
    };
  });

  const opponentIsHome = nextGame ? nextGame.homeTeamId === team.teamId : false;
  const opponentAbbr = nextGame ? (opponentIsHome ? nextGame.awayAbbr : nextGame.homeAbbr) : undefined;
  const nextGameData: TeamNextGame | null = nextGame
    ? {
        opponentAbbr: opponentAbbr ?? '',
        opponentTeamId: null,
        opponentLogoUrl: undefined,
        isHome: !opponentIsHome,
        startTime: nextGame.date,
        moneyline: nextGameLine ? { away: nextGameLine.moneylineAway, home: nextGameLine.moneylineHome } : null,
        total: nextGameLine?.overUnder != null ? { point: nextGameLine.overUnder, overPrice: nextGameLine.overOdds } : null,
        gameHref: `/nba/game/${nextGame.gameId}`,
      }
    : null;

  const ownStanding = standingsTeams.find((s) => s.teamId === Number(team.teamId));

  // ---- Real team-level candidates from this team's own recent results ----
  const today = nextGame && opponentAbbr ? { opponentAbbr, isHome: !opponentIsHome, gamePk: nextGame.gameId } : null;
  const moneyline = buildNbaMoneylineCandidate({ teamId: team.teamId, teamName: team.name, teamAbbr: team.abbreviation, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr });
  const total = buildNbaGameTotalCandidate({ teamId: team.teamId, teamName: team.name, teamAbbr: team.abbreviation, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr }, nextGameLine?.overUnder ?? null);
  const pointsFor = buildNbaPointsForCandidate({ teamId: team.teamId, teamName: team.name, teamAbbr: team.abbreviation, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr });
  const candidates = [moneyline, total, pointsFor].filter((c): c is PickCandidate => c != null);

  const active = candidates.find((c) => c.dimension === scope.market) ?? candidates[0] ?? null;
  const wantOver = active ? directionMark(active.category) !== 'U' : true;
  const baseLine = active?.line ?? 0.5;
  const line = Math.max(0, baseLine + scope.lineOffset);
  const isMoneylineMarket = active?.dimension === 'moneyline';

  const scoped: PickCandidate['history'] = (() => {
    if (!active) return [];
    let list = active.history;
    if (scope.opponentOnly && opponentAbbr) {
      list = list.filter((e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr);
    }
    if (scope.venue !== 'all') list = list.filter((e) => rawOf(e).isHome === (scope.venue === 'home'));
    if (scope.lastN !== 'all') list = list.slice(-scope.lastN);
    return list;
  })();

  const measured = categoriseByLine(scoped, line);
  const wanted = wantOver ? OVER : UNDER;

  const windows: TeamWindowedForm | null = active
    ? {
        l5: fixedWindow(measured, wanted, 5),
        l10: fixedWindow(measured, wanted, 10),
        l15: fixedWindow(measured, wanted, 15),
        szn: openWindow(measured, wanted, { minimum: 1 }),
        h2h:
          !opponentAbbr
            ? ({ status: 'insufficient', available: 0, required: 1 } as WindowedStat)
            : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => (rawOf(e).opponentAbbr as string | undefined) === opponentAbbr, { minimum: 1 }),
      }
    : null;

  const gameRows: GameRow[] = scoped.map((entry, index) => {
    const value = entryValue(entry);
    const cleared = value == null ? null : wantOver ? value > line : value <= line;
    const resultText = isMoneylineMarket ? (value === 1 ? 'W' : value === 0 ? 'L' : '—') : value != null ? String(value) : '—';
    return { key: `${entry.period}-${index}`, periodLabel: entry.periodLabel ?? '', opponentTeamId: null, opponentLogoUrl: rawOf(entry).opponentLogoUrl as string | undefined, value, resultText, cleared };
  });

  // Real opponent logo (2026-08-24) — `teamFormCandidates.ts` now embeds
  // `opponentLogoUrl` on every real history entry via `logoByAbbr`.
  const distributionLogoFor = (entry: PickCandidate['history'][number]) => rawOf(entry).opponentLogoUrl as string | undefined;

  const distribution: TeamDistributionChartData | null = active
    ? { history: scoped, line, wantOver, refreshKey: `${active.dimension}|${line}|${scope.opponentOnly}|${scope.venue}|${scope.lastN}|${team.teamId}`, logoFor: distributionLogoFor }
    : null;

  // Season stat groups and unit grades — Phase 6.1b. Both were empty here:
  // `statGroups: []` and `unitGrades: null`, because NBA had no league-wide
  // ranked season aggregate to build them from. One rollup now serves both, so
  // the ranks behind a stat row and the ranks behind a unit's grade cannot
  // disagree.
  const ownAggregate = seasonRanks?.byEntity[String(team.teamId)] ?? null;
  const seasonStatGroups = ownAggregate ? groupStats(NBA_SEASON_SPEC, ownAggregate.stats) : [];
  const ownUnitGrades = ownAggregate && ownAggregate.units.length > 0 ? ownAggregate.units : null;

  return {
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: ownStanding
      ? {
          wins: ownStanding.wins,
          losses: ownStanding.losses,
          divisionRank: ownStanding.divisionRank ? `${ordinal(Number(ownStanding.divisionRank))} seed, ${ownStanding.divisionName}` : '',
        }
      : null,
    // Phase 6.1 — `grades` (nine hardcoded NFL unit names) became `unitGrades`.
    // Still null here: this sport has no league-wide ranked team aggregate to
    // grade from yet. 6.1b adds one for NBA and NHL; see this file's header.
    unitGrades: ownUnitGrades,
    candidates,
    games: gameRows,
    windows,
    distribution,
    matchup: null,
    statGroups: seasonStatGroups,
    roster: rosterPlayers,
    rosterSortByStats: false,
    rosterPageSize: 24,
    standingsTeams,
    nextGame: nextGameData,
    advancedStats: null,
    form: windows,
    recentResults: toNbaRecentResultRows(recentGames, team.teamId),
  };
}
