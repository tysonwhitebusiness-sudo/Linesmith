/**
 * `GameDetail.tsx` adapter — NFL half.
 *
 * Converts the real `/api/nfl/game/[gameId]` + two `/api/nfl/team/[teamId]`
 * responses (fetched by `useNflGameDetail`) plus the UI-selected scope state
 * `GameDetail.tsx` owns into the shared `GameDetailData` interface defined
 * in `lib/sports/mlb/adapters/gameDetailAdapter.ts`. Ported field-for-field
 * from the old `NflGameDetail.tsx` (deleted once this adapter + the generic
 * `GameDetail.tsx` are verified) — no new behavior invented here.
 */

import { toNflUnitGrades } from '@/lib/sports/nfl/nflUnitGrades';
import type { PickCandidate } from '@/lib/core/types';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { toVenueForecastFromCandidates } from '@/lib/sports/shared/venueForecast';
import { nflTeamLogoUrl } from '@/components/SubjectAvatar';
import { teamPrimaryColor, withAlpha } from '@/lib/sports/nfl/teamColors';
import { MATCHUP_GROUP_BY_POSITION, playerMatchupRows } from '@/components/NflPlayerVsDefenseCard';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import { NFL_STAT_KEYS, toForRanks } from '@/lib/sports/nfl/statKeys';
import type { NflGameMetaResponse } from '@/components/useNflGameDetail';
import type { NflTeamDetailApiResponse, NflTeamRosterPlayer, NflTeamStatLine } from '@/components/useNflTeamDetail';
import type { GameDetailData, GameMatchupData, RankingsData, StatComparisonData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';
import { toPriceRange } from '@/lib/sports/shared/priceRange';
import { toGameTeamForm } from '@/lib/sports/shared/gameTeamForm';

const NFL_TEAM_COUNT = 32;

function toStat(l: NflTeamStatLine): OpposingStarterStat {
  return { key: l.key, label: l.label, value: l.value, decimals: l.decimals, rank: l.rank, poolSize: NFL_TEAM_COUNT };
}

function recordFrom(games: NflTeamDetailApiResponse['recentResults'], abbr: string): { w: number; l: number } {
  let w = 0;
  let l = 0;
  for (const g of games) {
    const isHome = g.homeTeam === abbr;
    const own = isHome ? g.homeScore : g.awayScore;
    const opp = isHome ? g.awayScore : g.homeScore;
    if (own == null || opp == null) continue;
    if (own > opp) w++;
    else l++;
  }
  return { w, l };
}

function splitRecord(games: NflTeamDetailApiResponse['recentResults'], abbr: string): { home: { w: number; l: number }; away: { w: number; l: number } } {
  return {
    home: recordFrom(games.filter((g) => g.homeTeam === abbr), abbr),
    away: recordFrom(games.filter((g) => g.awayTeam === abbr), abbr),
  };
}

function nflStreak(games: NflTeamDetailApiResponse['recentResults'], abbr: string): number {
  if (games.length === 0) return 0;
  const won = (g: NflTeamDetailApiResponse['recentResults'][number]): boolean | null => {
    const isHome = g.homeTeam === abbr;
    const own = isHome ? g.homeScore : g.awayScore;
    const opp = isHome ? g.awayScore : g.homeScore;
    if (own == null || opp == null) return null;
    return own > opp;
  };
  const first = won(games[0]);
  if (first == null) return 0;
  let n = 0;
  for (const g of games) {
    if (won(g) !== first) break;
    n++;
  }
  return first ? n : -n;
}

function toNflRecentResultRow(g: NflTeamDetailApiResponse['recentResults'][number], abbr: string) {
  const isHome = g.homeTeam === abbr;
  const scoreFor = (isHome ? g.homeScore : g.awayScore) ?? 0;
  const scoreAgainst = (isHome ? g.awayScore : g.homeScore) ?? 0;
  const own = isHome ? g.homeScore : g.awayScore;
  const opp = isHome ? g.awayScore : g.homeScore;
  return {
    gameId: g.gameId,
    date: g.gameday,
    win: own == null || opp == null ? null : own > opp,
    opponentAbbr: isHome ? g.awayTeam : g.homeTeam,
    isHome,
    scoreFor,
    scoreAgainst,
  };
}

function toOptionalRecord(r: { w: number; l: number }) {
  return r.w + r.l > 0 ? { wins: r.w, losses: r.l } : null;
}

export interface NflGameDetailScope {
  matchupPlayerId: string | null;
}

export interface NflGameDetailInput {
  meta: NflGameMetaResponse;
  home: NflTeamDetailApiResponse | null;
  away: NflTeamDetailApiResponse | null;
  gameLine: UnifiedGameLine | null;
  scope: NflGameDetailScope;
  /** Page-filtered player-level candidates for this game. */
  candidates: PickCandidate[];
}

export function toGameDetailData(input: NflGameDetailInput): GameDetailData {
  const { meta, home, away, gameLine, scope, candidates } = input;
  const { game } = meta;

  const homeGroups = (g: string) => (home?.teamStats ?? []).filter((s) => s.group === g);
  const awayGroups = (g: string) => (away?.teamStats ?? []).filter((s) => s.group === g);

  // ---- Hero ----
  const heroAwayColor = withAlpha(teamPrimaryColor(game.awayAbbr), '26');
  const heroHomeColor = withAlpha(teamPrimaryColor(game.homeAbbr), '26');
  const liveState = meta.liveState;
  const heroIsLive = liveState?.state === 'in';
  const heroIsFinal = liveState?.state === 'post';
  const liveExtraText =
    liveState && liveState.down != null && liveState.distance != null
      ? `${liveState.down === 1 ? '1st' : liveState.down === 2 ? '2nd' : liveState.down === 3 ? '3rd' : '4th'} & ${liveState.distance}${
          liveState.yardLine != null ? ` at ${liveState.yardLine}` : ''
        }${liveState.possessionTeamId ? ` · ${liveState.possessionTeamId} ball` : ''}${liveState.isRedZone ? ' · Red zone' : ''}`
      : undefined;

  const hero: GameDetailData['hero'] = {
    away: {
      abbr: game.awayAbbr,
      name: game.awayTeamName,
      href: away?.team.teamId ? `/nfl/team/${away.team.teamId}` : undefined,
      logoUrl: nflTeamLogoUrl(game.awayAbbr),
      record: { wins: away?.team.wins ?? 0, losses: away?.team.losses ?? 0 },
      divisionRank: away?.team.divisionRank ?? null,
      streak: nflStreak(away?.recentResults ?? [], game.awayAbbr),
      tintColor: heroAwayColor,
    },
    home: {
      abbr: game.homeAbbr,
      name: game.homeTeamName,
      href: home?.team.teamId ? `/nfl/team/${home.team.teamId}` : undefined,
      logoUrl: nflTeamLogoUrl(game.homeAbbr),
      record: { wins: home?.team.wins ?? 0, losses: home?.team.losses ?? 0 },
      divisionRank: home?.team.divisionRank ?? null,
      streak: nflStreak(home?.recentResults ?? [], game.homeAbbr),
      tintColor: heroHomeColor,
    },
    isLive: heroIsLive,
    isFinal: heroIsFinal,
    liveScore: liveState ? { away: String(liveState.awayScore ?? 0), home: String(liveState.homeScore ?? 0) } : undefined,
    livePeriodLabel: liveState ? [liveState.period ? `Q${liveState.period}` : '', liveState.displayClock ?? ''].filter(Boolean).join(' ') : undefined,
    startTimeLabel: new Date(game.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    model: null,
    pickLockAt: null,
    pickLoading: false,
    // Phase 6.15. Not a new source: 6.10 already resolves this game's forecast
    // in the snapshot adapter and stamps it on every candidate for the game.
    // `null` for a game with no tracked candidates, and for an indoor venue
    // ESPN did not name.
    venue: toVenueForecastFromCandidates(candidates, meta.game.venue?.fullName),
    liveExtraText,
    awayGrades: toNflUnitGrades(away?.grades),
    homeGrades: toNflUnitGrades(home?.grades),
    pregameLines: gameLine
      ? {
          moneyline: gameLine.moneyline ? { away: gameLine.moneyline.away ?? null, home: gameLine.moneyline.home ?? null } : null,
          spread: gameLine.spread ? { homePoint: gameLine.spread.homePoint ?? null } : null,
          total: gameLine.total?.point != null ? { point: gameLine.total.point } : null,
        }
      : null,
  };

  // ---- Matchup — team offense vs. opponent defense (both directions), or one skill-position player ----
  const teamAway =
    away && meta.homeDefenseAllowed.length > 0
      ? {
          // NAMED BY DIRECTION. Both cards used the identical title, so a game
          // page showed two headings reading "Team matchup — offense vs.
          // defense" and nothing above the fold said which way round either
          // was. The abbreviations are already in scope.
          title: `${game.awayAbbr} offense vs ${game.homeAbbr} defense`,
          subjectName: away.team.displayName,
          subjectHeadshotUrl: away.team.logoUrl ?? nflTeamLogoUrl(game.awayAbbr),
          subjectTeamAbbr: game.awayAbbr,
          subjectTeamLogoUrl: away.team.logoUrl ?? nflTeamLogoUrl(game.awayAbbr),
          subjectStats: [...awayGroups('Passing'), ...awayGroups('Rushing'), ...awayGroups('Receiving')].map(toStat),
          subjectRoleLabel: 'Produces',
          opponentName: `${game.homeAbbr} defense`,
          opponentHeadshotUrl: nflTeamLogoUrl(game.homeAbbr),
          opponentTeamAbbr: game.homeAbbr,
          opponentTeamLogoUrl: nflTeamLogoUrl(game.homeAbbr),
          opponentStats: meta.homeDefenseAllowed.map(toStat),
          opponentRoleLabel: 'Allows',
        }
      : null;
  const teamHome =
    home && meta.awayDefenseAllowed.length > 0
      ? {
          title: `${game.homeAbbr} offense vs ${game.awayAbbr} defense`,
          subjectName: home.team.displayName,
          subjectHeadshotUrl: home.team.logoUrl ?? nflTeamLogoUrl(game.homeAbbr),
          subjectTeamAbbr: game.homeAbbr,
          subjectTeamLogoUrl: home.team.logoUrl ?? nflTeamLogoUrl(game.homeAbbr),
          subjectStats: [...homeGroups('Passing'), ...homeGroups('Rushing'), ...homeGroups('Receiving')].map(toStat),
          subjectRoleLabel: 'Produces',
          opponentName: `${game.awayAbbr} defense`,
          opponentHeadshotUrl: nflTeamLogoUrl(game.awayAbbr),
          opponentTeamAbbr: game.awayAbbr,
          opponentTeamLogoUrl: nflTeamLogoUrl(game.awayAbbr),
          opponentStats: meta.awayDefenseAllowed.map(toStat),
          opponentRoleLabel: 'Allows',
        }
      : null;

  const matchupEligible = (roster: NflTeamRosterPlayer[]) =>
    roster.filter((p) => p.position && MATCHUP_GROUP_BY_POSITION[p.position] && p.seasonStats && p.seasonStats.games > 0);
  const matchupEligibleRoster = [
    ...matchupEligible(away?.roster ?? []).map((p) => ({ ...p, side: 'away' as const })),
    ...matchupEligible(home?.roster ?? []).map((p) => ({ ...p, side: 'home' as const })),
  ];
  const defaultMatchupPlayer =
    matchupEligibleRoster.length === 0
      ? null
      : (matchupEligibleRoster.find((p) => p.position === 'QB') ??
        [...matchupEligibleRoster].sort(
          (a, b) => b.seasonStats!.receivingYards + b.seasonStats!.rushingYards - (a.seasonStats!.receivingYards + a.seasonStats!.rushingYards),
        )[0]);
  const matchupPlayer = matchupEligibleRoster.find((p) => p.subjectId === scope.matchupPlayerId) ?? defaultMatchupPlayer ?? null;
  const matchupPlayerGroups = matchupPlayer?.position ? MATCHUP_GROUP_BY_POSITION[matchupPlayer.position] ?? [] : [];
  const matchupPlayerOpponentDefense = matchupPlayer?.side === 'away' ? meta.homeDefenseAllowed : meta.awayDefenseAllowed;
  const matchupPlayerOpponentStats = matchupPlayerOpponentDefense.filter((s) => s.group && matchupPlayerGroups.includes(s.group)).map(toStat);
  const matchupPlayerOwnRows = matchupPlayer ? playerMatchupRows(matchupPlayer.seasonStats, matchupPlayer.position) : [];
  const matchupPlayerTeamAbbr = matchupPlayer?.side === 'away' ? game.awayAbbr : game.homeAbbr;
  const matchupPlayerOpponentAbbr = matchupPlayer?.side === 'away' ? game.homeAbbr : game.awayAbbr;

  const matchup: GameMatchupData = {
    tabs: [
      { key: 'team', label: 'Team' },
      { key: 'player', label: 'Player' },
    ],
    teamAway,
    teamHome,
    playerOptions: matchupEligibleRoster.map((p) => ({ id: p.subjectId, label: `${p.fullName} (${p.position}, ${p.side === 'away' ? game.awayAbbr : game.homeAbbr})` })),
    selectedPlayerId: matchupPlayer?.subjectId ?? null,
    selectedPlayerCard: matchupPlayer
      ? {
          playerName: matchupPlayer.fullName,
          playerHeadshotUrl: matchupPlayer.headshotUrl ?? undefined,
          playerTeamAbbr: matchupPlayerTeamAbbr,
          playerTeamLogoUrl: nflTeamLogoUrl(matchupPlayerTeamAbbr),
          ownRows: matchupPlayerOwnRows,
          opponentAbbr: matchupPlayerOpponentAbbr,
          opponentLogoUrl: nflTeamLogoUrl(matchupPlayerOpponentAbbr),
          opponentStats: matchupPlayerOpponentStats,
        }
      : null,
  };

  // ---- Records ----
  const homeH2h = (home?.recentResults ?? []).filter((r) => r.homeTeam === game.awayAbbr || r.awayTeam === game.awayAbbr);
  const homeL5 = (home?.recentResults ?? []).slice(0, 5);
  const awayL5 = (away?.recentResults ?? []).slice(0, 5);
  const awaySeasonSplit = splitRecord(away?.recentResults ?? [], game.awayAbbr);
  const homeSeasonSplit = splitRecord(home?.recentResults ?? [], game.homeAbbr);

  const records: { away: RecordsSectionTeam; home: RecordsSectionTeam; loading: boolean } = {
    away: {
      abbr: game.awayAbbr,
      logoUrl: nflTeamLogoUrl(game.awayAbbr),
      divisionRank: away?.team.divisionRank ?? null,
      season: { wins: away?.team.wins ?? 0, losses: away?.team.losses ?? 0 },
      seasonHome: toOptionalRecord(awaySeasonSplit.home),
      seasonAway: toOptionalRecord(awaySeasonSplit.away),
      recent: awayL5.map((g) => toNflRecentResultRow(g, game.awayAbbr)),
      h2h: homeH2h.map((g) => toNflRecentResultRow(g, game.awayAbbr)),
    },
    home: {
      abbr: game.homeAbbr,
      logoUrl: nflTeamLogoUrl(game.homeAbbr),
      divisionRank: home?.team.divisionRank ?? null,
      season: { wins: home?.team.wins ?? 0, losses: home?.team.losses ?? 0 },
      seasonHome: toOptionalRecord(homeSeasonSplit.home),
      seasonAway: toOptionalRecord(homeSeasonSplit.away),
      recent: homeL5.map((g) => toNflRecentResultRow(g, game.homeAbbr)),
      h2h: homeH2h.map((g) => toNflRecentResultRow(g, game.homeAbbr)),
    },
    loading: false,
  };

  // ---- Stat comparison — ranked rows, grouped by box-score category ----
  const statComparison: StatComparisonData = {
    awayAbbr: game.awayAbbr,
    homeAbbr: game.homeAbbr,
    ranked: ['Scoring', 'Passing', 'Rushing', 'Receiving', 'Defense']
      .map((label) => ({ label, awayRows: awayGroups(label), homeRows: homeGroups(label) }))
      .filter((g) => g.awayRows.length > 0 || g.homeRows.length > 0)
      .map((g) => ({
        label: g.label,
        rows: g.homeRows.map((h) => {
          const a = g.awayRows.find((x) => x.key === h.key);
          return { key: h.key, label: h.label, away: a ? toStat(a) : undefined, home: toStat(h) };
        }),
      })),
  };

  // ---- Last five games ----
  const lastFive: { away: LastFiveGamesTeam; home: LastFiveGamesTeam; loading: boolean } = {
    away: { abbr: game.awayAbbr, logoUrl: nflTeamLogoUrl(game.awayAbbr), games: awayL5.map((g) => toNflRecentResultRow(g, game.awayAbbr)) },
    home: { abbr: game.homeAbbr, logoUrl: nflTeamLogoUrl(game.homeAbbr), games: homeL5.map((g) => toNflRecentResultRow(g, game.homeAbbr)) },
    loading: false,
  };

  // ---- Rankings ----
  const awayForRanks = toForRanks(away?.teamStats ?? []);
  const homeForRanks = toForRanks(home?.teamStats ?? []);
  const rankings: RankingsData = {
    away: { forRanks: awayForRanks, againstRanks: homeForRanks },
    home: { forRanks: homeForRanks, againstRanks: awayForRanks },
    statKeys: NFL_STAT_KEYS,
    awayAbbr: game.awayAbbr,
    homeAbbr: game.homeAbbr,
    awayLogoUrl: nflTeamLogoUrl(game.awayAbbr),
    homeLogoUrl: nflTeamLogoUrl(game.homeAbbr),
    poolSize: 32,
  };

  // ---- Injuries ----
  const injuries: GameDetailData['injuries'] = {
    away: { abbr: game.awayAbbr, logoUrl: nflTeamLogoUrl(game.awayAbbr), rows: meta.awayInjuries.map((e) => ({ playerName: e.playerName, status: e.status })) },
    home: { abbr: game.homeAbbr, logoUrl: nflTeamLogoUrl(game.homeAbbr), rows: meta.homeInjuries.map((e) => ({ playerName: e.playerName, status: e.status })) },
    loading: false,
  };

  // ---- Left rail — merge team-level candidates (moneyline/total/team-total
  // come from the per-team fetches, not the game-scoped snapshot) so the
  // rail's team scope actually has something to show. Total taken from
  // home's side only — both teams' own game-total candidates represent the
  // same combined-score line. ----
  const teamLevelCandidates: PickCandidate[] = [];
  if (away?.candidates.moneyline) teamLevelCandidates.push(away.candidates.moneyline);
  if (home?.candidates.moneyline) teamLevelCandidates.push(home.candidates.moneyline);
  if (home?.candidates.total) teamLevelCandidates.push(home.candidates.total);
  if (away?.candidates.teamTotal) teamLevelCandidates.push(away.candidates.teamTotal);
  if (home?.candidates.teamTotal) teamLevelCandidates.push(home.candidates.teamTotal);

  return {
    gameId: game.gameId,
    gameLine,
    hero,
    matchup,
    records,
    statComparison,
    lastFive,
    rankings,
    unitGrades: { away: toNflUnitGrades(away?.grades), home: toNflUnitGrades(home?.grades), awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr },
    injuries,
    // Phase 6.21 -- the home side's form against tonight's number. The
    // spread is signed as a book writes it; `gameTeamForm.ts` turns that
    // into the cover threshold, and falls back to win/loss when no
    // spread is priced.
    homeTeamForm: toGameTeamForm({
      rows: (home?.recentResults ?? []).map((g) => toNflRecentResultRow(g, game.homeAbbr)),
      teamAbbr: game.homeAbbr,
      opponentAbbr: game.awayAbbr,
      spreadPoint: gameLine?.spread?.homePoint ?? null,
    }),
    priceRange: toPriceRange(gameLine, game.homeAbbr),
    picksPanelGame: { id: game.gameId, sport: 'nfl', awayAbbr: game.awayAbbr, homeAbbr: game.homeAbbr, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: {
      candidates: [...candidates, ...teamLevelCandidates],
      goodBetsGated: false,
      nflTeamScope: { gameLine, homeAbbr: game.homeAbbr },
    },
  };
}

