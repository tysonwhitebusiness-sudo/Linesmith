/**
 * `GameDetail.tsx` adapter — CFB half. Mirrors soccer's game adapter (see
 * that file's header for the full reasoning): hero (real score, real
 * pregame moneyline/spread/total), records + last-five (from each team's
 * `recentResults`, real scores), left-rail props. `matchup`/`statComparison`
 * are now real (2026-08-24), from `teamDefenseAllowed.ts`'s league-wide
 * index via `home`/`away`'s own `teamOffense` field. `injuries` is now real
 * too (2026-08-24, confirmed live against ESPN's college-football injuries
 * feed — see `teamSportEspn.ts`'s `fetchEspnInjuries`). `rankings`/
 * `unitGrades` stay `null` — no grading model for CFB. `propsForGame` also
 * stays `null`: same `playerHref` league-segment reasoning doesn't apply
 * to CFB (no league segment needed — `/${sport}/player/{id}` already
 * resolves correctly to `/cfb/player/{id}`), but there's no per-player
 * season-stats source to make that list meaningfully richer than
 * `leftRail` already is, so it stays unset for the same reason MLB skips it.
 */

import type { PickCandidate } from '@/lib/core/types';
import type { CfbGameSummary } from '@/lib/sports/cfb/espn';
import type { CfbTeamDetailApiResponse } from './teamDetailAdapter';
import { toCfbRecentResultRows } from './teamDetailAdapter';
import type { GameDetailData, GameMatchupData, StatComparisonData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';
import type { UnifiedGameLine } from '@/lib/odds/types';

const CFB_TEAM_COUNT = 134;

function toStatRow(key: string, label: string, value: number, rank: number): OpposingStarterStat {
  return { key, label, value, decimals: 0, rank, poolSize: CFB_TEAM_COUNT };
}

/**
 * `team.teamOffense` (from `teamDefenseAllowed.ts`'s league-wide index)
 * carries BOTH this team's own real produced yardage AND its own real
 * allowed yardage in one record — opponent-independent, so it's safe to
 * reuse regardless of whether `team` here is the same opponent that team's
 * own Team Detail "next game" matchup card is built around.
 */
function producedRows(t: CfbTeamDetailApiResponse | null): OpposingStarterStat[] {
  if (!t?.teamOffense) return [];
  const o = t.teamOffense;
  return [
    toStatRow('passingYdsProduced', 'Pass Yds/Gm', o.passingYdsProducedPerGame, o.passingProducedRank),
    toStatRow('rushingYdsProduced', 'Rush Yds/Gm', o.rushingYdsProducedPerGame, o.rushingProducedRank),
    toStatRow('receivingYdsProduced', 'Rec Yds/Gm', o.receivingYdsProducedPerGame, o.receivingProducedRank),
  ];
}

function allowedRows(t: CfbTeamDetailApiResponse | null): OpposingStarterStat[] {
  if (!t?.teamOffense) return [];
  const o = t.teamOffense;
  return [
    toStatRow('passingYdsAllowed', 'Pass Yds/Gm', o.passingYdsAllowedPerGame, o.passingRank),
    toStatRow('rushingYdsAllowed', 'Rush Yds/Gm', o.rushingYdsAllowedPerGame, o.rushingRank),
    toStatRow('receivingYdsAllowed', 'Rec Yds/Gm', o.receivingYdsAllowedPerGame, o.receivingRank),
  ];
}

function toOptionalRecord(games: ReturnType<typeof toCfbRecentResultRows>): { wins: number; losses: number } | null {
  if (games.length === 0) return null;
  const wins = games.filter((g) => g.win === true).length;
  const losses = games.filter((g) => g.win === false).length;
  return { wins, losses };
}

export interface CfbGameDetailInput {
  meta: CfbGameSummary;
  home: CfbTeamDetailApiResponse | null;
  away: CfbTeamDetailApiResponse | null;
  candidates: PickCandidate[];
  /** The real per-game bookmaker grid (odds-architecture rebuild Phase 6)
   * — `GameDetail.tsx` fetches this once via useGameOddsBookLines and
   * threads it into every sport's adapter call, same as MLB/NFL. `null`
   * when nothing's been recovered for this game yet. */
  gameLine: UnifiedGameLine | null;
}

export function toGameDetailData(input: CfbGameDetailInput): GameDetailData {
  const { meta, home, away, candidates, gameLine } = input;
  const game = meta.game;
  if (!game) throw new Error('toGameDetailData called without a resolved game — caller must gate on meta.game first');

  const homeRecent = home ? toCfbRecentResultRows(home.recentGames, home.team.teamId) : [];
  const awayRecent = away ? toCfbRecentResultRows(away.recentGames, away.team.teamId) : [];
  const homeH2h = homeRecent.filter((r) => r.opponentAbbr === game.awayAbbr);
  const awayH2h = awayRecent.filter((r) => r.opponentAbbr === game.homeAbbr);

  const isLive = game.status?.state === 'in';
  const isFinal = game.status?.state === 'post';

  const hero: GameDetailData['hero'] = {
    away: {
      abbr: game.awayAbbr,
      name: game.awayTeamName,
      href: away ? `/cfb/team/${away.team.teamId}` : undefined,
      logoUrl: game.awayLogoUrl,
      record: toOptionalRecord(awayRecent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    home: {
      abbr: game.homeAbbr,
      name: game.homeTeamName,
      href: home ? `/cfb/team/${home.team.teamId}` : undefined,
      logoUrl: game.homeLogoUrl,
      record: toOptionalRecord(homeRecent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    isLive,
    isFinal,
    liveScore: isLive || isFinal ? { away: String(game.awayScore ?? 0), home: String(game.homeScore ?? 0) } : undefined,
    livePeriodLabel: isLive ? game.status?.shortDetail : undefined,
    startTimeLabel: new Date(game.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    model: null,
    pickLockAt: null,
    pickLoading: false,
    venue: null,
    // Prefers the merged, multi-source gameLine (real per-book comparison,
    // may include books ESPN's own single-source line never covers) over
    // ESPN's own pregameLine — falls back to ESPN only when nothing's been
    // recovered into game_odds_book_lines yet for this game, so the hero
    // strip never regresses to showing nothing where ESPN alone already had
    // real data.
    pregameLines: gameLine
      ? {
          moneyline: gameLine.moneyline ? { away: gameLine.moneyline.away ?? null, home: gameLine.moneyline.home ?? null } : null,
          spread: gameLine.spread ? { homePoint: gameLine.spread.homePoint ?? null } : null,
          total: gameLine.total?.point != null ? { point: gameLine.total.point } : null,
        }
      : meta.pregameLine
        ? {
            moneyline: { away: meta.pregameLine.moneylineAway, home: meta.pregameLine.moneylineHome },
            spread: meta.pregameLine.spread != null ? { homePoint: meta.pregameLine.spread } : null,
            total: meta.pregameLine.overUnder != null ? { point: meta.pregameLine.overUnder } : null,
          }
        : null,
  };

  const records: { away: RecordsSectionTeam; home: RecordsSectionTeam; loading: boolean } = {
    away: {
      abbr: game.awayAbbr,
      logoUrl: game.awayLogoUrl,
      divisionRank: null,
      season: toOptionalRecord(awayRecent),
      seasonHome: null,
      seasonAway: null,
      recent: awayRecent.slice(0, 5),
      h2h: awayH2h,
    },
    home: {
      abbr: game.homeAbbr,
      logoUrl: game.homeLogoUrl,
      divisionRank: null,
      season: toOptionalRecord(homeRecent),
      seasonHome: null,
      seasonAway: null,
      recent: homeRecent.slice(0, 5),
      h2h: homeH2h,
    },
    loading: false,
  };

  const lastFive: { away: LastFiveGamesTeam; home: LastFiveGamesTeam; loading: boolean } = {
    away: { abbr: game.awayAbbr, logoUrl: game.awayLogoUrl, games: awayRecent.slice(0, 5) },
    home: { abbr: game.homeAbbr, logoUrl: game.homeLogoUrl, games: homeRecent.slice(0, 5) },
    loading: false,
  };

  // ---- Real team matchup + stat comparison, from teamDefenseAllowed.ts's league-wide index (already fetched by the team route for `home`/`away`) ----
  const awayProduced = producedRows(away);
  const homeProduced = producedRows(home);
  const teamAway =
    away && homeProduced.length > 0 && awayProduced.length > 0
      ? {
          // NAMED BY DIRECTION. Both cards used the identical title, so a game
          // page showed two headings reading "Team matchup — offense vs.
          // defense" and nothing above the fold said which way round either
          // was. The abbreviations are already in scope.
          title: `${game.awayAbbr} offense vs ${game.homeAbbr} defense`,
          subjectName: away.team.name,
          subjectHeadshotUrl: away.team.logoUrl ?? undefined,
          subjectTeamAbbr: game.awayAbbr,
          subjectTeamLogoUrl: away.team.logoUrl ?? undefined,
          subjectStats: awayProduced,
          subjectRoleLabel: 'Produces',
          opponentName: `${game.homeAbbr} defense`,
          opponentHeadshotUrl: game.homeLogoUrl,
          opponentTeamAbbr: game.homeAbbr,
          opponentTeamLogoUrl: game.homeLogoUrl,
          opponentStats: allowedRows(home),
          opponentRoleLabel: 'Allows',
        }
      : null;
  const teamHome =
    home && awayProduced.length > 0 && homeProduced.length > 0
      ? {
          title: `${game.homeAbbr} offense vs ${game.awayAbbr} defense`,
          subjectName: home.team.name,
          subjectHeadshotUrl: home.team.logoUrl ?? undefined,
          subjectTeamAbbr: game.homeAbbr,
          subjectTeamLogoUrl: home.team.logoUrl ?? undefined,
          subjectStats: homeProduced,
          subjectRoleLabel: 'Produces',
          opponentName: `${game.awayAbbr} defense`,
          opponentHeadshotUrl: game.awayLogoUrl,
          opponentTeamAbbr: game.awayAbbr,
          opponentTeamLogoUrl: game.awayLogoUrl,
          opponentStats: allowedRows(away),
          opponentRoleLabel: 'Allows',
        }
      : null;
  const matchup: GameMatchupData | null =
    teamAway || teamHome ? { tabs: [{ key: 'team', label: 'Team' }], teamAway, teamHome } : null;

  const statComparison: StatComparisonData | null =
    awayProduced.length > 0 && homeProduced.length > 0
      ? {
          awayAbbr: game.awayAbbr,
          homeAbbr: game.homeAbbr,
          ranked: [
            {
              label: 'Offense (per game)',
              rows: awayProduced.map((awayStat, i) => ({ key: awayStat.key, label: awayStat.label, away: awayStat, home: homeProduced[i] })),
            },
          ],
        }
      : null;

  return {
    gameId: game.gameId,
    gameLine,
    hero,
    matchup,
    records,
    statComparison,
    lastFive,
    rankings: null,
    unitGrades: null,
    injuries: {
      away: { abbr: game.awayAbbr, logoUrl: game.awayLogoUrl, rows: away?.injuries.map((i) => ({ playerName: i.playerName, status: i.status, position: i.position, note: i.note })) ?? [] },
      home: { abbr: game.homeAbbr, logoUrl: game.homeLogoUrl, rows: home?.injuries.map((i) => ({ playerName: i.playerName, status: i.status, position: i.position, note: i.note })) ?? [] },
      loading: false,
    },
    propsForGame: null,
    picksPanelGame: { id: game.gameId, sport: 'cfb', awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: { candidates, goodBetsGated: false },
  };
}
