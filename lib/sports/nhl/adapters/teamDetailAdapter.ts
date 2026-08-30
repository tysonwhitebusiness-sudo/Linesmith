/**
 * `TeamDetail.tsx` adapter — NHL half.
 *
 * Real Team Detail, matching MLB/NFL/soccer/CFB/NBA's shape (2026-08-23):
 * real candidates (`buildNhlMoneylineCandidate`/`buildNhlGameTotalCandidate`,
 * built from this team's own real recent results — nhle.ts's own real
 * schedule/score data), real windows/distribution/games table through the
 * same windowedStat engine every other sport runs through. `grades`/
 * `matchup`/`statGroups` stay null/empty — no grading model or league-wide
 * season-stats index for NHL yet. Real: roster (every real NHL player,
 * identity carried via the roster link's own query params so a player with
 * zero active props still gets an honest page), next fixture (no real
 * pregame-line source for NHL — see nhle.ts's header), real record from
 * standings.
 */

import { categoriseByLine, entryValue, fixedWindow, openWindow, subsetWindow, OVER, UNDER, type WindowedStat } from '@/lib/core/windowedStat';
import { directionMark } from '@/components/MarketLabel';
import type { PickCandidate } from '@/lib/core/types';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { SeasonAggregateResult } from '@/lib/sports/shared/seasonAggregates';
import { groupStats } from '@/lib/sports/shared/seasonAggregates';
import { NHL_SEASON_SPEC } from '@/lib/sports/shared/seasonAggregateSpecs';
import type { GameRow, RecentResultRow, RosterPlayer, TeamDetailData, TeamDistributionChartData, TeamNextGame, TeamWindowedForm } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { NhlTeam, NhlGame } from '@/lib/sports/nhl/nhle';
import { buildNhlMoneylineCandidate, buildNhlGameTotalCandidate, buildNhlGoalsForCandidate } from '@/lib/sports/nhl/teamFormCandidates';
import type { EspnInjuryRow } from '@/lib/sports/multiSport/teamSportEspn';

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

interface NhlRosterSeasonStats {
  games: number;
  goals: number;
  assists: number;
  points: number;
}

function seasonLineText(s: NhlRosterSeasonStats | null): string {
  if (!s || s.games === 0) return 'No stats yet this season';
  return `${s.goals} G · ${s.assists} A · ${s.points} P`;
}

export interface NhlTeamDetailApiResponse {
  team: NhlTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null; seasonStats: NhlRosterSeasonStats | null }>;
  nextGame: NhlGame | null;
  nextGameLine: null;
  recentGames: NhlGame[];
  /** Real, confirmed live 2026-08-24 against ESPN's NHL injuries feed — matched by team name, see the route's own comment. */
  injuries: EspnInjuryRow[];
  /** Real logo per real NHL abbreviation (2026-08-24) — feeds the distribution chart's `logoFor`. */
  logoByAbbr: Record<string, string>;
}

export function toNhlRecentResultRows(games: NhlGame[], teamAbbr: string): RecentResultRow[] {
  return games.map((g) => {
    const isHome = g.homeAbbr === teamAbbr;
    const scoreFor = isHome ? g.homeScore : g.awayScore;
    const scoreAgainst = isHome ? g.awayScore : g.homeScore;
    const resolved = scoreFor != null && scoreAgainst != null;
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

export interface NhlTeamDetailScope {
  market: string | undefined;
  lineOffset: number;
  opponentOnly: boolean;
  venue: 'all' | 'home' | 'away';
  lastN: number | 'all';
}

export interface NhlTeamDetailInput {
  data: NhlTeamDetailApiResponse;
  scope: NhlTeamDetailScope;
  standingsTeams: TeamStandingRow[];
  /**
   * League-wide season aggregates and ranks (`useSeasonRanks`), Phase 6.1b.
   * Fills `statGroups` (this adapter emitted `[]`, making NHL's team page
   * the thinnest in the app) and `unitGrades`. `null` while loading — both
   * fall back to their empty states.
   */
  seasonRanks: SeasonAggregateResult | null;
}

export function toTeamDetailData(input: NhlTeamDetailInput): TeamDetailData {
  const { data, scope, standingsTeams, seasonRanks } = input;
  const { team, roster, nextGame, recentGames, logoByAbbr } = data;

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
      href: `/nhl/player/${encodeURIComponent(p.subjectId)}?${identityParams.toString()}`,
    };
  });

  const opponentIsHome = nextGame ? nextGame.homeAbbr === team.abbreviation : false;
  const opponentAbbr = nextGame ? (opponentIsHome ? nextGame.awayAbbr : nextGame.homeAbbr) : undefined;
  const nextGameData: TeamNextGame | null = nextGame
    ? {
        opponentAbbr: opponentAbbr ?? '',
        opponentTeamId: null,
        opponentLogoUrl: undefined,
        isHome: !opponentIsHome,
        startTime: nextGame.date,
        moneyline: null,
        total: null,
        gameHref: `/nhl/game/${nextGame.gameId}`,
      }
    : null;

  const ownStanding = standingsTeams.find((s) => s.teamId === Number(team.teamId));

  // ---- Real team-level candidates from this team's own recent results ----
  const today = nextGame && opponentAbbr ? { opponentAbbr, isHome: !opponentIsHome, gamePk: nextGame.gameId } : null;
  const moneyline = buildNhlMoneylineCandidate({ teamAbbr: team.abbreviation, teamName: team.name, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr });
  const total = buildNhlGameTotalCandidate({ teamAbbr: team.abbreviation, teamName: team.name, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr });
  const goalsFor = buildNhlGoalsForCandidate({ teamAbbr: team.abbreviation, teamName: team.name, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr });
  const candidates = [moneyline, total, goalsFor].filter((c): c is PickCandidate => c != null);

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
  // `statGroups: []` and `unitGrades: null`, because NHL had no league-wide
  // ranked season aggregate to build them from. One rollup now serves both, so
  // the ranks behind a stat row and the ranks behind a unit's grade cannot
  // disagree.
  const ownAggregate = seasonRanks?.byEntity[String(team.teamId)] ?? null;
  const seasonStatGroups = ownAggregate ? groupStats(NHL_SEASON_SPEC, ownAggregate.stats) : [];
  const ownUnitGrades = ownAggregate && ownAggregate.units.length > 0 ? ownAggregate.units : null;

  return {
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: ownStanding
      ? {
          wins: ownStanding.wins,
          losses: ownStanding.losses,
          divisionRank: team.conference ? `${team.conference}` : '',
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
    recentResults: toNhlRecentResultRows(recentGames, team.abbreviation),
  };
}
