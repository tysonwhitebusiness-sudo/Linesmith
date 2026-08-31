/**
 * `TeamDetail.tsx` adapter — soccer half.
 *
 * Real Team Detail, matching MLB/NFL's own shape (2026-08-23): real
 * candidates (`buildSoccerMoneylineCandidate`/`buildSoccerGameTotalCandidate`,
 * built from this team's own real recent match results — same
 * `teamFormCandidates.ts` pattern MLB's adapter uses), real windows/
 * distribution/games table through the same windowedStat engine every other
 * sport's Team Detail runs through, and (EPL only) a real stat-groups card
 * from Understat's team-level goals-for/goals-against rate + league rank
 * (`teamSeasonStats`, fetched by the API route). MLS's stat-groups card
 * stays empty — no team-level ASA source wired yet, honest gap not
 * fabricated coverage. `grades`/`matchup` stay `null` — no grading model or
 * opponent-conditional stat source for soccer, same gap CFB's adapter
 * documents.
 */

import { categoriseByLine, entryValue, fixedWindow, openWindow, subsetWindow, OVER, UNDER, type WindowedStat } from '@/lib/core/windowedStat';
import { directionMark } from '@/components/MarketLabel';
import type { PickCandidate } from '@/lib/core/types';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { GameRow, RecentResultRow, RosterPlayer, TeamDetailData, TeamDistributionChartData, TeamMatchupData, TeamNextGame, TeamWindowedForm } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { SeasonAggregateResult } from '@/lib/sports/shared/seasonAggregateShapes';
import { groupStats } from '@/lib/sports/shared/seasonAggregateShapes';
import { SOCCER_EPL_SEASON_SPEC, SOCCER_MLS_SEASON_SPEC } from '@/lib/sports/shared/seasonAggregateSpecs';
import type { SoccerTeam, SoccerPregameLine } from '@/lib/sports/soccer/espn';
import type { UnderstatTeamDefense } from '@/lib/sports/soccer/understat';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';
import type { SoccerLeague } from '@/lib/core/types';
import { buildSoccerMoneylineCandidate, buildSoccerGameTotalCandidate, buildSoccerGoalsForCandidate } from '@/lib/sports/soccer/teamFormCandidates';
import { toRatingHistoryRole } from '@/lib/sports/shared/ratingHistoryRole';
import type { TeamRatingHistory } from '@/lib/sports/shared/teamRatingShapes';

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

/**
 * Real final scores from ESPN's scoreboard `score`/`status` fields
 * (teamSportEspn.ts) mapped to one team's perspective — `win`/`isDraw` stay
 * `null`/`false` for a game ESPN hasn't posted a completed status for yet.
 * Shared by this file's own `recentResults` and `gameDetailAdapter.ts`'s
 * records/last-five sections, so both read the exact same real derivation.
 */
export function toSoccerRecentResultRows(games: EspnTeamSportGame[], teamId: string): RecentResultRow[] {
  return games.map((g) => {
    const isHome = g.homeTeamId === teamId;
    const scoreFor = isHome ? g.homeScore : g.awayScore;
    const scoreAgainst = isHome ? g.awayScore : g.homeScore;
    const resolved = g.status?.completed === true && scoreFor != null && scoreAgainst != null;
    return {
      gameId: g.gameId,
      date: g.date,
      win: resolved ? scoreFor > scoreAgainst : null,
      isDraw: resolved ? scoreFor === scoreAgainst : false,
      opponentAbbr: isHome ? g.awayAbbr : g.homeAbbr,
      isHome,
      scoreFor: scoreFor ?? 0,
      scoreAgainst: scoreAgainst ?? 0,
    };
  });
}

interface SoccerRosterSeasonStats {
  /** null for MLS — ASA's season aggregate has no real "games played" field, only minutesPlayed. */
  games: number | null;
  goals: number;
  assists: number;
}

function seasonLineText(s: SoccerRosterSeasonStats | null): string {
  if (!s) return 'No stats yet this season';
  return `${s.goals} G · ${s.assists} A`;
}

export interface SoccerTeamDetailApiResponse {
  team: SoccerTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null; seasonStats: SoccerRosterSeasonStats | null }>;
  nextGame: EspnTeamSportGame | null;
  nextGameLine: SoccerPregameLine | null;
  recentGames: EspnTeamSportGame[];
  /** EPL only — real season goals-for/against rate + league rank from Understat. `null` for MLS (no team-level ASA source wired yet) or a team Understat's index doesn't carry (name-match miss). */
  teamSeasonStats: UnderstatTeamDefense | null;
  /** EPL only — the next opponent's own row from the same Understat index. */
  opponentSeasonStats: UnderstatTeamDefense | null;
  opponentAbbr: string | null;
  opponentName: string | null;
  opponentLogoUrl: string | null;
  /** Real logo per real ESPN abbreviation (2026-08-24) — feeds the distribution chart's `logoFor`. */
  logoByAbbr: Record<string, string>;
}

/** Local copy of the same small ordinal helper every other adapter in this family carries — avoids a circular value-import. */
function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

export interface SoccerTeamDetailScope {
  market: string | undefined;
  lineOffset: number;
  opponentOnly: boolean;
  venue: 'all' | 'home' | 'away';
  lastN: number | 'all';
}

export interface SoccerTeamDetailInput {
  /**
   * `useTeamRatingHistory(...)`'s result — the rating block (6.14). Structural,
   * not an import of the hook's type. Every team sport takes the identical
   * field; the shared builder does the rest.
   */
  ratingHistory?: { history: TeamRatingHistory | null; loading: boolean };
  league: SoccerLeague;
  data: SoccerTeamDetailApiResponse;
  scope: SoccerTeamDetailScope;
  standingsTeams: TeamStandingRow[];
  /**
   * League-wide season aggregates and ranks (`useSeasonRanks`), Phase 6.15.
   * Fills `statGroups` and `unitGrades`, neither of which this sport had a
   * league-wide ranked aggregate to build from before. `null` while loading.
   */
  seasonRanks: SeasonAggregateResult | null;
}

export function toTeamDetailData(input: SoccerTeamDetailInput): TeamDetailData {
  const { league, data, scope, standingsTeams, seasonRanks } = input;
  const { team, roster, nextGame, nextGameLine, recentGames, teamSeasonStats, opponentSeasonStats, opponentAbbr: nextOpponentAbbr, opponentName, opponentLogoUrl, logoByAbbr } = data;

  const rosterPlayers: RosterPlayer[] = roster.map((p) => {
    // Real identity carried in the URL, not fetched again — same pattern
    // CFB's/NBA's/NHL's roster adapters already use, so a soccer player
    // with zero active props still gets an honest identity card instead of
    // the bare "No tracked markets" dead end (2026-08-24 fix — this used to
    // carry zero query params, the one sport whose fallback showed nothing
    // at all, not even a name).
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
      hasStats: p.seasonStats != null,
      href: `/soccer/${league}/player/${encodeURIComponent(p.subjectId)}?${identityParams.toString()}`,
    };
  });

  const opponentIsHome = nextGame ? nextGame.homeTeamId === team.teamId : false;
  const opponentAbbr = nextGame ? (opponentIsHome ? nextGame.awayAbbr : nextGame.homeAbbr) : undefined;
  // Moneyline here is the *this team's* side of a real 3-way (home/away/draw)
  // market — `TeamNextGame.moneyline` only has away/home slots (built for
  // MLB/NFL's 2-way markets), so the draw price has nowhere to go yet; not
  // lost, just not surfaced by this shared shape. `away`/`home` map to
  // which side of the real match this team actually is, not to this team
  // specifically vs. "the other one" — same convention MLB/NFL already use.
  const nextGameData: TeamNextGame | null = nextGame
    ? {
        opponentAbbr: opponentAbbr ?? '',
        opponentTeamId: null,
        opponentLogoUrl: undefined,
        isHome: !opponentIsHome,
        startTime: nextGame.date,
        moneyline: nextGameLine
          ? { away: nextGameLine.moneylineAway, home: nextGameLine.moneylineHome }
          : null,
        total: nextGameLine?.overUnder != null ? { point: nextGameLine.overUnder, overPrice: nextGameLine.overOdds } : null,
        gameHref: `/soccer/${league}/game/${nextGame.gameId}`,
      }
    : null;

  const ownStanding = standingsTeams.find((s) => s.teamId === Number(team.teamId));

  // ---- Real team-level candidates from this team's own recent results ----
  const today = nextGame && opponentAbbr ? { opponentAbbr, isHome: !opponentIsHome, gamePk: nextGame.gameId } : null;
  const moneyline = buildSoccerMoneylineCandidate({ teamId: team.teamId, teamName: team.name, teamAbbr: team.abbreviation, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr });
  const total = buildSoccerGameTotalCandidate({ teamId: team.teamId, teamName: team.name, teamAbbr: team.abbreviation, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr }, nextGameLine?.overUnder ?? null);
  const goalsFor = buildSoccerGoalsForCandidate({ teamId: team.teamId, teamName: team.name, teamAbbr: team.abbreviation, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr });
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
    return {
      key: `${entry.period}-${index}`,
      periodLabel: entry.periodLabel ?? '',
      opponentTeamId: null,
      opponentLogoUrl: rawOf(entry).opponentLogoUrl as string | undefined,
      value,
      resultText,
      cleared,
    };
  });

  // Real opponent logo (2026-08-24) — `teamFormCandidates.ts` now embeds
  // `opponentLogoUrl` on every real history entry via `logoByAbbr`.
  const distributionLogoFor = (entry: PickCandidate['history'][number]) => rawOf(entry).opponentLogoUrl as string | undefined;

  const distribution: TeamDistributionChartData | null = active
    ? { history: scoped, line, wantOver, refreshKey: `${active.dimension}|${line}|${scope.opponentOnly}|${scope.venue}|${scope.lastN}|${team.teamId}`, logoFor: distributionLogoFor }
    : null;

  // ---- Season stat groups and unit grades -- Phase 6.15 ----
  //
  // The rollup replaces the three-row "Scoring" group: nine ranked stats
  // across Attack, Defence and Discipline, from `player_game_history` rather
  // than Understat, which means MLS gets them too (Understat is EPL-only, so
  // MLS's team page carried no stat group at all).
  //
  // xGA IS KEPT, because the rollup has no expected-goals equivalent and
  // nothing else in the app does either. It now carries `xgaRank`, its own
  // ordering -- it used to render the GOALS-allowed rank under an xG label,
  // which is wrong exactly where the two disagree.
  const spec = league === 'mls' ? SOCCER_MLS_SEASON_SPEC : SOCCER_EPL_SEASON_SPEC;
  const ownAggregate = seasonRanks?.byEntity[String(team.teamId)] ?? null;
  const statGroups: { label: string; stats: OpposingStarterStat[] }[] = [
    ...(ownAggregate ? groupStats(spec, ownAggregate.stats) : []),
    ...(teamSeasonStats
      ? [
          {
            label: 'Expected goals',
            stats: [
              { key: 'xGA', label: 'xG Allowed/Gm', value: teamSeasonStats.xGAPerGame, decimals: 2, rank: teamSeasonStats.xgaRank, poolSize: teamSeasonStats.poolSize },
            ],
          },
        ]
      : []),
  ];
  const ownUnitGrades = ownAggregate && ownAggregate.units.length > 0 ? ownAggregate.units : null;

  // ---- Real team-vs-opponent matchup (EPL only — MLS has no Understat source, stays null) ----
  const teamMatchup =
    nextOpponentAbbr && teamSeasonStats && opponentSeasonStats
      ? {
          subjectName: team.name,
          subjectHeadshotUrl: team.logoUrl ?? undefined,
          subjectTeamAbbr: team.abbreviation,
          subjectTeamLogoUrl: team.logoUrl ?? undefined,
          subjectStats: [
            { key: 'goalsFor', label: 'Goals Scored/Gm', value: teamSeasonStats.goalsForPerGame, decimals: 2, rank: teamSeasonStats.offenseRank, poolSize: teamSeasonStats.poolSize },
          ],
          subjectRoleLabel: 'Produces',
          opponentName: `${opponentName ?? nextOpponentAbbr} defense`,
          opponentHeadshotUrl: opponentLogoUrl ?? undefined,
          opponentTeamAbbr: nextOpponentAbbr,
          opponentTeamLogoUrl: opponentLogoUrl ?? undefined,
          opponentStats: [
            { key: 'goalsAgainst', label: 'Goals Allowed/Gm', value: opponentSeasonStats.goalsAgainstPerGame, decimals: 2, rank: opponentSeasonStats.rank, poolSize: opponentSeasonStats.poolSize },
            { key: 'xGA', label: 'xG Allowed/Gm', value: opponentSeasonStats.xGAPerGame, decimals: 2, rank: opponentSeasonStats.rank, poolSize: opponentSeasonStats.poolSize },
          ],
          opponentRoleLabel: 'Allows',
        }
      : null;
  const matchup: TeamMatchupData | null = teamMatchup ? { tabs: [{ key: 'team', label: 'Team matchup' }], team: teamMatchup } : null;

  return {
    ratingHistory: toRatingHistoryRole({ state: input.ratingHistory }),
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: ownStanding
      ? {
          wins: ownStanding.wins,
          losses: ownStanding.losses,
          divisionRank: ownStanding.divisionRank ? `${ordinal(Number(ownStanding.divisionRank))}, ${ownStanding.points ?? 0} pts` : '',
        }
      : null,
    // Phase 6.1 — `grades` (nine hardcoded NFL unit names) became `unitGrades`.
    // Phase 6.15 fills it from the same rollup behind `statGroups` above.
    unitGrades: ownUnitGrades,
    candidates,
    games: gameRows,
    windows,
    distribution,
    matchup,
    statGroups,
    roster: rosterPlayers,
    rosterSortByStats: false,
    rosterPageSize: 24,
    standingsTeams,
    nextGame: nextGameData,
    advancedStats: null,
    form: windows,
    recentResults: toSoccerRecentResultRows(recentGames, team.teamId),
  };
}
