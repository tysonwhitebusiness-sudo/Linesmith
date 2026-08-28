/**
 * `TeamDetail.tsx` adapter — CFB half.
 *
 * Real Team Detail, matching MLB/NFL/soccer's shape (2026-08-23, matchup +
 * roster season-stats added 2026-08-24): real candidates
 * (`buildCfbMoneylineCandidate`/`buildCfbGameTotalCandidate`, built from
 * this team's own real recent results), real windows/distribution/games
 * table through the same windowedStat engine every other sport runs
 * through. `grades` stays null — no grading model exists for CFB.
 * `matchup`/`statGroups` are now real, from `teamDefenseAllowed.ts`'s
 * league-wide index (same source `playerDetailAdapter.ts`'s matchup card
 * already used — the team route just never called it before). Real:
 * roster (every FBS player, identity carried via the roster link's own
 * query params so a player with zero active props still gets an honest
 * page — see `app/cfb/player/[playerId]/page.tsx`; real per-player season
 * stats via CFBD's own box-score pipeline), next fixture with a real
 * single-book pregame line, real record/rank from standings.
 */

import { categoriseByLine, entryValue, fixedWindow, openWindow, subsetWindow, OVER, UNDER, type WindowedStat } from '@/lib/core/windowedStat';
import { directionMark } from '@/components/MarketLabel';
import type { PickCandidate } from '@/lib/core/types';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { GameRow, RecentResultRow, RosterPlayer, TeamDetailData, TeamDistributionChartData, TeamMatchupData, TeamNextGame, TeamWindowedForm } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { CfbTeam, CfbPregameLine } from '@/lib/sports/cfb/espn';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';
import type { CfbTeamDefenseAllowed } from '@/lib/sports/cfb/teamDefenseAllowed';
import type { EspnInjuryRow } from '@/lib/sports/multiSport/teamSportEspn';
import { buildCfbMoneylineCandidate, buildCfbGameTotalCandidate, buildCfbPointsForCandidate } from '@/lib/sports/cfb/teamFormCandidates';

interface CfbRosterSeasonStats {
  games: number;
  passingYards: number;
  rushingYards: number;
  receivingYards: number;
  receptions: number;
}

function seasonLineText(p: { position: string | null; seasonStats: CfbRosterSeasonStats | null }): string {
  const s = p.seasonStats;
  if (!s || s.games === 0) return 'No stats yet this season';
  switch (p.position) {
    case 'QB':
      return `${s.passingYards} pass yds`;
    case 'RB':
    case 'FB':
      return `${s.rushingYards} rush yds`;
    case 'WR':
    case 'TE':
      return `${s.receptions} rec · ${s.receivingYards} rec yds`;
    default:
      return `${s.games} games played`;
  }
}

const CFB_TEAM_COUNT = 134;

function toStatRow(key: string, label: string, value: number, rank: number): OpposingStarterStat {
  return { key, label, value, decimals: 0, rank, poolSize: CFB_TEAM_COUNT };
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

/** Local copy of `screenshotImport.ts`'s `normalizeName` — that module also pulls in the Anthropic SDK (server-only), which breaks the client bundle when imported from a client-rendered adapter (`TeamDetail.tsx`). Same normalization, no SDK import. */
function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'`'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same substring match `playerDetailAdapter.ts`'s H2H split uses — real names, differently conventioned between ESPN/CFBD. */
function isOpponentMatch(rawOpponent: string | undefined, opponentAbbr: string | undefined): boolean {
  if (!rawOpponent || !opponentAbbr) return false;
  const a = normalizeTeamName(rawOpponent);
  const b = normalizeTeamName(opponentAbbr);
  return a !== '' && b !== '' && (a === b || a.includes(b) || b.includes(a));
}

export interface CfbTeamDetailApiResponse {
  team: CfbTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null; seasonStats: CfbRosterSeasonStats | null }>;
  nextGame: EspnTeamSportGame | null;
  nextGameLine: CfbPregameLine | null;
  recentGames: EspnTeamSportGame[];
  /** This team's own real yards-produced-per-game, ranked — from the same league-wide index `opponentDefenseAllowed` comes from. */
  teamOffense: CfbTeamDefenseAllowed | null;
  /** The next opponent's real yards-allowed-per-game, ranked. */
  opponentDefenseAllowed: CfbTeamDefenseAllowed | null;
  opponentAbbr: string | null;
  opponentName: string | null;
  opponentLogoUrl: string | null;
  /** Real, confirmed live 2026-08-24 against ESPN's college-football injuries feed. */
  injuries: EspnInjuryRow[];
  /** Real logo per real FBS abbreviation (2026-08-24) — feeds the distribution chart's `logoFor`. */
  logoByAbbr: Record<string, string>;
}

/** Local copy of the same small ordinal helper every other adapter in this family carries — avoids a circular value-import. */
function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

/** Real final scores from ESPN's scoreboard `score`/`status` fields — no draws in football, so `isDraw` is always false (the field exists on `RecentResultRow` for soccer; harmless/unused here). */
export function toCfbRecentResultRows(games: EspnTeamSportGame[], teamId: string): RecentResultRow[] {
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

export interface CfbTeamDetailScope {
  market: string | undefined;
  lineOffset: number;
  opponentOnly: boolean;
  venue: 'all' | 'home' | 'away';
  lastN: number | 'all';
}

export interface CfbTeamDetailInput {
  data: CfbTeamDetailApiResponse;
  scope: CfbTeamDetailScope;
  standingsTeams: TeamStandingRow[];
}

export function toTeamDetailData(input: CfbTeamDetailInput): TeamDetailData {
  const { data, scope, standingsTeams } = input;
  const { team, roster, nextGame, nextGameLine, recentGames, teamOffense, opponentDefenseAllowed, opponentAbbr: nextOpponentAbbr, opponentName, opponentLogoUrl, logoByAbbr } = data;

  const rosterPlayers: RosterPlayer[] = roster.map((p) => {
    // Real identity carried in the URL, not fetched again — lets the player
    // page render honestly even for a player with zero active props right
    // now (every FBS roster player is real; not every one has a tracked
    // market). See app/cfb/player/[playerId]/page.tsx's own fallback.
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
      seasonLineText: seasonLineText(p),
      hasStats: p.seasonStats != null && p.seasonStats.games > 0,
      href: `/cfb/player/${encodeURIComponent(p.subjectId)}?${identityParams.toString()}`,
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
        gameHref: `/cfb/game/${nextGame.gameId}`,
      }
    : null;

  const ownStanding = standingsTeams.find((s) => s.teamId === Number(team.teamId));

  // ---- Real team-level candidates from this team's own recent results ----
  const today = nextGame && opponentAbbr ? { opponentAbbr, isHome: !opponentIsHome, gamePk: nextGame.gameId } : null;
  const moneyline = buildCfbMoneylineCandidate({ teamId: team.teamId, teamName: team.name, teamAbbr: team.abbreviation, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr });
  const total = buildCfbGameTotalCandidate({ teamId: team.teamId, teamName: team.name, teamAbbr: team.abbreviation, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr }, nextGameLine?.overUnder ?? null);
  const pointsFor = buildCfbPointsForCandidate({ teamId: team.teamId, teamName: team.name, teamAbbr: team.abbreviation, teamLogoUrl: team.logoUrl ?? undefined, games: recentGames, today, logoByAbbr });
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
      list = list.filter((e) => isOpponentMatch(rawOf(e).opponentAbbr as string | undefined, opponentAbbr));
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
            : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => isOpponentMatch(rawOf(e).opponentAbbr as string | undefined, opponentAbbr), { minimum: 1 }),
      }
    : null;

  const gameRows: GameRow[] = scoped.map((entry, index) => {
    const value = entryValue(entry);
    const cleared = value == null ? null : wantOver ? value > line : value <= line;
    const resultText = isMoneylineMarket ? (value === 1 ? 'W' : value === 0 ? 'L' : '—') : value != null ? String(value) : '—';
    return { key: `${entry.period}-${index}`, periodLabel: entry.periodLabel ?? '', opponentTeamId: null, opponentLogoUrl: rawOf(entry).opponentLogoUrl as string | undefined, value, resultText, cleared };
  });

  // Real opponent logo (2026-08-24) — `teamFormCandidates.ts` now embeds
  // `opponentLogoUrl` on every real history entry via `logoByAbbr`; this
  // just reads it, same as the player-level chart's own `logoFor`.
  const distributionLogoFor = (entry: PickCandidate['history'][number]) => rawOf(entry).opponentLogoUrl as string | undefined;

  const distribution: TeamDistributionChartData | null = active
    ? {
        history: scoped,
        line,
        wantOver,
        refreshKey: `${active.dimension}|${line}|${scope.opponentOnly}|${scope.venue}|${scope.lastN}|${team.teamId}`,
        logoFor: distributionLogoFor,
      }
    : null;

  // ---- Real team-vs-opponent matchup, from CFBD's own box scores (teamDefenseAllowed.ts) ----
  const statGroups: { label: string; stats: OpposingStarterStat[] }[] = teamOffense
    ? [
        {
          label: 'Offense',
          stats: [
            toStatRow('passingYdsProduced', 'Pass Yds/Gm', teamOffense.passingYdsProducedPerGame, teamOffense.passingProducedRank),
            toStatRow('rushingYdsProduced', 'Rush Yds/Gm', teamOffense.rushingYdsProducedPerGame, teamOffense.rushingProducedRank),
            toStatRow('receivingYdsProduced', 'Rec Yds/Gm', teamOffense.receivingYdsProducedPerGame, teamOffense.receivingProducedRank),
          ],
        },
      ]
    : [];

  const teamMatchup =
    nextOpponentAbbr && teamOffense && opponentDefenseAllowed
      ? {
          subjectName: team.name,
          subjectHeadshotUrl: team.logoUrl ?? undefined,
          subjectTeamAbbr: team.abbreviation,
          subjectTeamLogoUrl: team.logoUrl ?? undefined,
          subjectStats: [
            toStatRow('passingYdsProduced', 'Pass Yds/Gm', teamOffense.passingYdsProducedPerGame, teamOffense.passingProducedRank),
            toStatRow('rushingYdsProduced', 'Rush Yds/Gm', teamOffense.rushingYdsProducedPerGame, teamOffense.rushingProducedRank),
            toStatRow('receivingYdsProduced', 'Rec Yds/Gm', teamOffense.receivingYdsProducedPerGame, teamOffense.receivingProducedRank),
          ],
          subjectRoleLabel: 'Produces',
          opponentName: `${opponentName ?? nextOpponentAbbr} defense`,
          opponentHeadshotUrl: opponentLogoUrl ?? undefined,
          opponentTeamAbbr: nextOpponentAbbr,
          opponentTeamLogoUrl: opponentLogoUrl ?? undefined,
          opponentStats: [
            toStatRow('passingYdsAllowed', 'Pass Yds/Gm', opponentDefenseAllowed.passingYdsAllowedPerGame, opponentDefenseAllowed.passingRank),
            toStatRow('rushingYdsAllowed', 'Rush Yds/Gm', opponentDefenseAllowed.rushingYdsAllowedPerGame, opponentDefenseAllowed.rushingRank),
            toStatRow('receivingYdsAllowed', 'Rec Yds/Gm', opponentDefenseAllowed.receivingYdsAllowedPerGame, opponentDefenseAllowed.receivingRank),
          ],
          opponentRoleLabel: 'Allows',
        }
      : null;

  const matchup: TeamMatchupData | null = teamMatchup
    ? { tabs: [{ key: 'team', label: 'Team matchup' }], team: teamMatchup }
    : null;

  return {
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: ownStanding
      ? {
          wins: ownStanding.wins,
          losses: ownStanding.losses,
          divisionRank: ownStanding.divisionRank ? `${ordinal(Number(ownStanding.divisionRank))} in ${ownStanding.divisionName}` : '',
        }
      : null,
    grades: null,
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
    recentResults: toCfbRecentResultRows(recentGames, team.teamId),
  };
}
