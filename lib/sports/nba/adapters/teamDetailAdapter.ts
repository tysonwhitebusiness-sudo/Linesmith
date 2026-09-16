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
import type { HoopsHockeyTeamResearchPayload } from '@/lib/sports/multiSport/hoopsHockeyTeamResearch';
import type { ShotCell, TeamShotProfile } from '@/lib/sports/shared/teamProductionShapes';
import { buildTeamResearch, leagueRank, ordinal } from '@/lib/sports/shared/teamResearch';
import { seasonLabel } from '@/lib/sports/shared/season';
import type { ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamResearchData } from '@/lib/sports/shared/teamResearchShapes';
import { NBA_TEAM_SPEC } from './teamResearchSpec';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { SeasonAggregateResult } from '@/lib/sports/shared/seasonAggregateShapes';
import { groupStats } from '@/lib/sports/shared/seasonAggregateShapes';
import { NBA_SEASON_SPEC } from '@/lib/sports/shared/seasonAggregateSpecs';
import type { GameRow, RecentResultRow, RosterPlayer, TeamDetailData, TeamDistributionChartData, TeamNextGame, TeamWindowedForm } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { NbaTeam, NbaPregameLine } from '@/lib/sports/nba/espn';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';
import { buildNbaMoneylineCandidate, buildNbaGameTotalCandidate, buildNbaPointsForCandidate } from '@/lib/sports/nba/teamFormCandidates';
import type { EspnInjuryRow } from '@/lib/sports/multiSport/teamSportEspn';
import { standingPhrase } from '@/lib/sports/shared/teamRecord';
import { toRatingHistoryRole } from '@/lib/sports/shared/ratingHistoryRole';
import type { TeamRatingHistory } from '@/lib/sports/shared/teamRatingShapes';
import { buildTeamRoles } from '@/lib/sports/shared/teamRoles';

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
  /**
   * `useTeamRatingHistory(...)`'s result — the rating block (6.14). Structural,
   * not an import of the hook's type. Every team sport takes the identical
   * field; the shared builder does the rest.
   */
  ratingHistory?: { history: TeamRatingHistory | null; loading: boolean };
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
  /**
   * The sport snapshot's season state (B6). Out of season the standings feed
   * still serves the last completed season, so the header needs to know both
   * that the new season hasn't started and what to say instead of `0-0`.
   */
  seasonStatus?: { started: boolean; nextGameDate: string | null; label?: string } | null;
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

  // F-B9. This flag tested whether THIS team is the home team while being
  // named for the opponent, and was then negated — so a team's own home
  // fixture was reported as away. The prices were never wrong; the labels
  // beside them were, which is why a real page read "Man City ML 800" at
  // "Sunderland ML -340" for a match Manchester City hosted as a -340
  // favourite (measured: homeTeamId 382 = MNC, moneylineHome -340,
  // moneylineAway 800).
  const subjectIsHome = nextGame ? nextGame.homeTeamId === team.teamId : false;
  const opponentAbbr = nextGame ? (subjectIsHome ? nextGame.awayAbbr : nextGame.homeAbbr) : undefined;
  const nextGameData: TeamNextGame | null = nextGame
    ? {
        opponentAbbr: opponentAbbr ?? '',
        opponentTeamId: null,
        opponentLogoUrl: undefined,
        isHome: subjectIsHome,
        startTime: nextGame.date,
        moneyline: nextGameLine ? { away: nextGameLine.moneylineAway, home: nextGameLine.moneylineHome } : null,
        total: nextGameLine?.overUnder != null ? { point: nextGameLine.overUnder, overPrice: nextGameLine.overOdds } : null,
        gameHref: `/nba/game/${nextGame.gameId}`,
      }
    : null;

  const ownStanding = standingsTeams.find((s) => s.teamId === Number(team.teamId));

  // ---- Real team-level candidates from this team's own recent results ----
  const today = nextGame && opponentAbbr ? { opponentAbbr, isHome: subjectIsHome, gamePk: nextGame.gameId } : null;
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


  // ---- Phase 6.19: the shared Team Detail roles ----
  // One call for all five, identical in every sport's adapter. Which ones fill
  // depends on what this sport's team history carries -- `teamRoles.ts` has
  // the measurement.
  const teamRoles = buildTeamRoles({
    active,
    line,
    wantOver,
    statLabel: active?.dimensionLabel ?? active?.dimension ?? 'Market',
    opponentAbbr: nextGameData?.opponentAbbr ?? null,
  });

  return {
    teamRoles,
    ratingHistory: toRatingHistoryRole({ state: input.ratingHistory }),
    team: { teamId: Number(team.teamId), name: team.name, abbr: team.abbreviation, logoUrl: team.logoUrl ?? '' },
    record: ownStanding
      ? {
          wins: ownStanding.wins,
          losses: ownStanding.losses,
          standing: standingPhrase(ownStanding.divisionRank, ownStanding.divisionName),
        }
      : null,
    // Phase 6.1 — `grades` (nine hardcoded NFL unit names) became `unitGrades`.
    // Still null here: this sport has no league-wide ranked team aggregate to
    // grade from yet. 6.1b adds one for NBA and NHL; see this file's header.
    seasonStatus: input.seasonStatus ?? null,
    // Out of season every source still returns last season's standings. The
    // page has no season helper yet (that is R2's season-convention rule), but
    // "not the current one" is exactly what `started: false` means.
    recordSeasonLabel: input.seasonStatus && !input.seasonStatus.started ? 'Last season' : null,
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

// ---------------------------------------------------------------------------
// R7.3 — the team research page
// ---------------------------------------------------------------------------

/**
 * NBA's team page: the shared team research read through NBA's spec, plus
 * NBA's own section, "Shot profile" — where the team shoots and is shot
 * against by zone, and how well, against the league (R5c `team_shot_profile`).
 */
export function toTeamResearchData(input: { payload: HoopsHockeyTeamResearchPayload; season: number | null; now?: Date }): TeamResearchData {
  const data = buildTeamResearch({ payload: input.payload, spec: NBA_TEAM_SPEC, season: input.season, teamHref: (id) => `/nba/team/${encodeURIComponent(id)}`, now: input.now });
  const season = data.scope.season;
  return { ...data, sections: [...data.sections, nbaShotProfileSection(input.payload.shots[String(season)] ?? null, season)] };
}

const NBA_ZONES = ['Restricted area', 'Paint (non-RA)', 'Mid-range', 'Corner 3', 'Above-break 3'] as const;

function zoneTotals(zones: Record<string, ShotCell> | undefined) {
  const total = NBA_ZONES.reduce((a, z) => a + (zones?.[z]?.[0] ?? 0), 0);
  return NBA_ZONES.map((z) => {
    const [att = 0, made = 0, pts = 0] = zones?.[z] ?? [];
    return { zone: z, att, share: total ? (100 * att) / total : null, fg: att ? (100 * made) / att : null, pps: att ? pts / att : null };
  });
}

export function nbaShotProfileSection(shots: TeamShotProfile | null, season: number): ResearchSection {
  const base = { id: 'shots', navLabel: 'Shot profile', title: 'Shot profile', sub: `${seasonLabel('nba', season)} regular season · nba_shot_events` };
  if (!shots?.for?.zones) {
    return { ...base, rows: [], state: { kind: 'empty', title: `No shot locations for ${seasonLabel('nba', season)}`, reason: 'team_shot_profile holds no row for this team and season.' } };
  }
  const mine = zoneTotals(shots.for.zones);
  const allowed = zoneTotals(shots.allowed?.zones);
  const league = Object.values(shots.league).map((t) => zoneTotals(t.zones));
  const games = shots.for.games;
  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const leagueShare = NBA_ZONES.map((_, i) => avg(league.map((l) => l[i].share)));
  const rankOf = (value: number | null, values: Array<number | null>, direction: 'higher' | 'lower') => {
    const pool = values.filter((v): v is number => v != null);
    return value == null || pool.length < 2 ? null : leagueRank({ value, league: pool, direction });
  };
  // The court surface has four rows (rim, paint, mid-range, three); the two three-point zones share the last.
  const courtRows = (values: Array<number | null>) =>
    [values[0], values[1], values[2], values[3] == null && values[4] == null ? null : (values[3] ?? 0) + (values[4] ?? 0)].map((value, r) => [{ key: `z${r}`, value }]);
  const role = (key: string, label: string, values: Array<number | null>, caption: string) => ({
    key,
    label,
    role: {
      title: label,
      surface: 'halfCourt' as const,
      measure: 'share' as const,
      cells: courtRows(values),
      rowLabels: ['Restricted area', 'Paint', 'Mid-range', 'Three'],
      domain: { lo: 0, hi: 45 },
      format: (v: number) => `${v.toFixed(0)}%`,
      unit: '% of attempts',
      caption,
    },
  });
  const map: ResearchCard = {
    kind: 'surface',
    key: 'court',
    title: 'Where the shots come from',
    scope: 'share of field-goal attempts',
    views: [
      role('for', 'This team', mine.map((z) => z.share), `${mine.reduce((a, z) => a + z.att, 0).toLocaleString('en-US')} attempts in ${games} games`),
      role('allowed', 'Opponents', allowed.map((z) => z.share), `${allowed.reduce((a, z) => a + z.att, 0).toLocaleString('en-US')} attempts against`),
      role('league', 'League average', leagueShare, `Mean of ${league.length} teams with 40+ games`),
    ],
  };
  const table: ResearchCard = {
    kind: 'table',
    key: 'zones',
    title: 'By zone',
    scope: `ranks among ${league.length} teams`,
    labelHeader: 'Zone',
    fixedOrder: true,
    columns: [
      { key: 'fga', label: 'FGA/G', decimals: 1 },
      { key: 'share', label: 'Share', decimals: 1, format: 'percent' },
      { key: 'lgShare', label: 'Lg share', decimals: 1, format: 'percent' },
      { key: 'fg', label: 'FG%', decimals: 1, format: 'percent' },
      { key: 'fgRank', label: 'Rank', decimals: 0 },
      { key: 'pps', label: 'Pts/shot', decimals: 2 },
      { key: 'ofg', label: 'Opp FG%', decimals: 1, format: 'percent', info: 'What opponents shot from this zone' },
    ],
    rows: mine.map((z, i) => {
      const r = rankOf(z.fg, league.map((l) => l[i].fg), 'higher');
      return {
        key: z.zone,
        label: z.zone,
        values: { fga: games ? z.att / games : null, share: z.share, lgShare: leagueShare[i], fg: z.fg, fgRank: r ? ordinal(r.rank) : null, pps: z.pps, ofg: allowed[i].fg },
      };
    }),
    caption: 'Points per shot counts a made three as three and a make at the rim as two; free throws are not shots here.',
  };
  const shooting: ResearchCard = {
    kind: 'percentiles',
    key: 'zone-fg',
    title: 'Shooting by zone',
    scope: `FG% · dot strip is every team`,
    rows: mine
      .map((z, i) => {
        const pool = league.map((l) => l[i].fg).filter((v): v is number => v != null);
        const r = rankOf(z.fg, pool, 'higher');
        if (z.fg == null || !r) return null;
        return { key: z.zone, label: z.zone, valueText: `${z.fg.toFixed(1)}%`, percentile: Math.round(100 * (1 - (r.rank - 1) / Math.max(1, r.of - 1))), direction: 'higher' as const, rank: r, strip: { league: pool, value: z.fg } };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
  };
  return { ...base, sub: `${base.sub} · ${games} games`, rows: [[map, table], [shooting]], state: { kind: 'ready' } };
}
