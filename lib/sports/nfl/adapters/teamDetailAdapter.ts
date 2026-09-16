/**
 * `TeamDetail.tsx` adapter — NFL half.
 *
 * Converts the real `/api/nfl/team/[teamId]` response (fetched by
 * `useNflTeamDetail`, the extracted hook — see that file's header) plus the
 * UI-selected scope state `TeamDetail.tsx` owns into the shared
 * `TeamDetailData` interface defined in
 * `lib/sports/mlb/adapters/teamDetailAdapter.ts`. Ported field-for-field from
 * the old `NflTeamDetail.tsx` (deleted once this adapter + the generic
 * `TeamDetail.tsx` are verified) — no new behavior invented here.
 */

import type { PickCandidate } from '@/lib/core/types';
import type { FootballTeamResearchPayload } from '@/lib/sports/multiSport/footballTeamResearch';
import type { NflTeamTargets, TeamTargetSide } from '@/lib/sports/nfl/teamTargetShapes';
import { footballTeamSpec } from './teamResearchSpec';
import { buildTeamResearch } from '@/lib/sports/shared/teamResearch';
import type { ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamResearchData, TeamRosterEntry } from '@/lib/sports/shared/teamResearchShapes';
import {
  categoriseByLine,
  entryValue,
  fixedWindow,
  openWindow,
  OVER,
  subsetWindow,
  UNDER,
  type WindowedStat,
} from '@/lib/core/windowedStat';
import { directionMark } from '@/components/MarketLabel';
import { nflTeamLogoUrl } from '@/components/SubjectAvatar';
import { MATCHUP_GROUP_BY_POSITION, playerMatchupRows } from '@/components/NflPlayerVsDefenseCard';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import { toNflUnitGrades } from '@/lib/sports/nfl/nflUnitGrades';
import { findUnit, type UnitGrade } from '@/lib/sports/shared/unitGrades';
import type { NflTeamDetailApiResponse, NflTeamStatLine } from '@/components/useNflTeamDetail';
import type {
  GameRow,
  RosterPlayer,
  TeamDetailData,
  TeamDistributionChartData,
  TeamMatchupData,
  TeamNextGame,
  TeamWindowedForm,
} from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import { standingPhrase } from '@/lib/sports/shared/teamRecord';
import { toRatingHistoryRole } from '@/lib/sports/shared/ratingHistoryRole';
import type { TeamRatingHistory } from '@/lib/sports/shared/teamRatingShapes';
import { buildTeamRoles } from '@/lib/sports/shared/teamRoles';

const NFL_TEAM_COUNT = 32;

/** Matchup group -> the opponent defense grade that group actually measures — ported from `NflTeamDetail.tsx:33-37`. */
const GROUP_TO_GRADE_KEY: Record<string, { key: keyof import('@/lib/sports/nfl/nflTeamGrades').TeamGrades; label: string }> = {
  Passing: { key: 'secondary', label: 'Pass D' },
  Rushing: { key: 'dLine', label: 'Run D' },
  Receiving: { key: 'secondary', label: 'Pass D' },
};

/** Team's own stat group -> its offense grade — ported from `NflTeamDetail.tsx:617-623`. */
const STAT_GROUP_TO_GRADE_KEY: Record<string, keyof import('@/lib/sports/nfl/nflTeamGrades').TeamGrades | null> = {
  Scoring: null,
  Passing: 'passingOffense',
  Rushing: 'rushingOffense',
  Receiving: 'receivingOffense',
  Defense: 'defense',
};

function toStatRow(l: NflTeamStatLine): OpposingStarterStat {
  return { key: l.key, label: l.label, value: l.value, decimals: l.decimals, rank: l.rank, poolSize: NFL_TEAM_COUNT };
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

function seasonLineText(p: NflTeamDetailApiResponse['roster'][number]): string {
  const s = p.seasonStats;
  if (!s || s.games === 0) return 'No stats yet this season';
  switch (p.position) {
    case 'QB':
      return `${s.passingYards} pass yds · ${s.passingTds} pass TD`;
    case 'RB':
    case 'FB':
      return `${s.rushingYards} rush yds · ${s.rushingTds} rush TD`;
    case 'WR':
    case 'TE':
      return `${s.receptions} rec · ${s.receivingYards} rec yds`;
    default:
      return `${s.games} games played`;
  }
}

export interface NflTeamDetailScope {
  market: string | undefined;
  lineOffset: number;
  opponentOnly: boolean;
  venue: 'all' | 'home' | 'away';
  lastN: number | 'all';
  /** `null` defaults to the roster's own QB, or else the highest-yardage skill player — same fallback `defaultMatchupPlayer` (`NflTeamDetail.tsx:259-268`) already computes. */
  matchupPlayerId: string | null;
}

export interface NflTeamDetailInput {
  /**
   * `useTeamRatingHistory(...)`'s result — the rating block (6.14). Structural,
   * not an import of the hook's type. Every team sport takes the identical
   * field; the shared builder does the rest.
   */
  ratingHistory?: { history: TeamRatingHistory | null; loading: boolean };
  data: NflTeamDetailApiResponse;
  scope: NflTeamDetailScope;
  standingsTeams: import('@/components/useAllTeams').TeamStandingRow[];
}

export function toTeamDetailData(input: NflTeamDetailInput): TeamDetailData {
  const { data, scope, standingsTeams } = input;
  const { team, teamStats, nextGame, opponentDefenseAllowed, recentResults, grades, opponentGrades } = data;
  // Phase 6.1 — NFL's own `TeamGrades` struct (unchanged upstream: it is still
  // what the API serves and what `snapshot_cache` holds) converts to the shared
  // ordered `UnitGrade[]` here, at the adapter boundary. That is the layer
  // CLAUDE.md's sport-adapter §2 puts sport-shape -> shared-shape work in.
  const ownUnitGrades = toNflUnitGrades(grades);
  const opponentUnitGrades = toNflUnitGrades(opponentGrades);
  const logoUrl = team.logoUrl ?? nflTeamLogoUrl(team.abbreviation) ?? '';
  const opponentAbbr = data.opponentAbbr;

  const candidates = [data.candidates.moneyline, data.candidates.total, data.candidates.teamTotal].filter(
    (c): c is PickCandidate => c != null,
  );

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
    const oppAbbr = rawOf(entry).opponentAbbr as string | undefined;
    const resultText = isMoneylineMarket ? (value === 1 ? 'W' : value === 0 ? 'L' : '—') : value != null ? String(value) : '—';
    return {
      key: `${entry.period}-${index}`,
      periodLabel: entry.periodLabel ?? '',
      opponentTeamId: null,
      opponentLogoUrl: nflTeamLogoUrl(oppAbbr),
      value,
      resultText,
      cleared,
    };
  });

  const distribution: TeamDistributionChartData | null = active
    ? {
        history: scoped,
        line,
        wantOver,
        refreshKey: `${active.dimension}|${line}|${scope.opponentOnly}|${scope.venue}|${scope.lastN}|${team.teamId}`,
        logoFor: (entry) => nflTeamLogoUrl(rawOf(entry).opponentAbbr as string | undefined),
      }
    : null;

  // Team stats — 5 groups, each with its own optional offense/defense grade (NflTeamDetail.tsx:612-638).
  const statGroups: { label: string; stats: OpposingStarterStat[]; grade?: UnitGrade | null }[] = [
    { label: 'Scoring', rows: teamStats.filter((s) => s.group === 'Scoring') },
    { label: 'Passing', rows: teamStats.filter((s) => s.group === 'Passing') },
    { label: 'Rushing', rows: teamStats.filter((s) => s.group === 'Rushing') },
    { label: 'Receiving', rows: teamStats.filter((s) => s.group === 'Receiving') },
    { label: 'Defense', rows: teamStats.filter((s) => s.group === 'Defense') },
  ]
    .filter((g) => g.rows.length > 0)
    .map((g) => {
      const gradeKey = STAT_GROUP_TO_GRADE_KEY[g.label];
      // Phase 6.1: `grades?.[gradeKey]` (struct field access on `TeamGrades`)
      // -> a keyed lookup on the shared ordered array. Same nine keys, same
      // values; the difference is that the array's keys are strings a sport
      // chooses rather than a union no other sport can name.
      return { label: g.label, stats: g.rows.map(toStatRow), grade: gradeKey ? findUnit(ownUnitGrades, gradeKey) : undefined };
    });

  // Matchup — team offense vs. opponent defense, or one skill-position
  // player's own numbers against the same opponent group (NflTeamDetail.tsx:543-610).
  const opponentPassingAllowed = opponentDefenseAllowed.filter((s) => s.group === 'Passing');
  const opponentRushingAllowed = opponentDefenseAllowed.filter((s) => s.group === 'Rushing');
  const opponentReceivingAllowed = opponentDefenseAllowed.filter((s) => s.group === 'Receiving');

  const teamMatchup =
    opponentAbbr && opponentDefenseAllowed.length > 0
      ? {
          title: 'Team matchup — offense vs. defense',
          subjectName: team.displayName,
          subjectHeadshotUrl: logoUrl,
          subjectTeamAbbr: team.abbreviation,
          subjectTeamLogoUrl: logoUrl,
          subjectStats: [...teamStats.filter((s) => s.group === 'Passing' || s.group === 'Rushing' || s.group === 'Receiving')].map(toStatRow),
          subjectRoleLabel: 'Produces',
          opponentName: `${opponentAbbr} defense`,
          opponentHeadshotUrl: nflTeamLogoUrl(opponentAbbr),
          opponentTeamAbbr: opponentAbbr,
          opponentTeamLogoUrl: nflTeamLogoUrl(opponentAbbr),
          opponentStats: opponentDefenseAllowed.map(toStatRow),
          opponentRoleLabel: 'Allows',
        }
      : null;

  const matchupEligibleRoster = data.roster.filter(
    (p) => p.position && MATCHUP_GROUP_BY_POSITION[p.position] && p.seasonStats && p.seasonStats.games > 0,
  );
  const defaultMatchupPlayer = (() => {
    if (matchupEligibleRoster.length === 0) return null;
    const qb = matchupEligibleRoster.find((p) => p.position === 'QB');
    if (qb) return qb;
    return [...matchupEligibleRoster].sort(
      (a, b) => b.seasonStats!.receivingYards + b.seasonStats!.rushingYards - (a.seasonStats!.receivingYards + a.seasonStats!.rushingYards),
    )[0];
  })();
  const matchupPlayer = matchupEligibleRoster.find((p) => p.subjectId === scope.matchupPlayerId) ?? defaultMatchupPlayer ?? null;
  const matchupPlayerGroups = matchupPlayer?.position ? MATCHUP_GROUP_BY_POSITION[matchupPlayer.position] ?? [] : [];
  const matchupPlayerOpponentStats = [
    ...(matchupPlayerGroups.includes('Passing') ? opponentPassingAllowed : []),
    ...(matchupPlayerGroups.includes('Rushing') ? opponentRushingAllowed : []),
    ...(matchupPlayerGroups.includes('Receiving') ? opponentReceivingAllowed : []),
  ].map(toStatRow);
  const selectedPlayerCard =
    matchupPlayer && opponentAbbr
      ? {
          playerName: matchupPlayer.fullName,
          playerHeadshotUrl: matchupPlayer.headshotUrl ?? undefined,
          playerFallbackUrl: logoUrl,
          playerTeamAbbr: team.abbreviation,
          playerTeamLogoUrl: logoUrl,
          ownRows: playerMatchupRows(matchupPlayer.seasonStats, matchupPlayer.position),
          opponentAbbr,
          opponentLogoUrl: nflTeamLogoUrl(opponentAbbr),
          opponentStats: matchupPlayerOpponentStats,
        }
      : null;
  const selectedPlayerGradeBadges = [
    ...new Map(matchupPlayerGroups.map((g) => GROUP_TO_GRADE_KEY[g]).filter(Boolean).map((g) => [g.key, g])).values(),
  ].map((g) => ({ label: `${opponentAbbr ?? ''} ${g.label}`.trim(), grade: findUnit(opponentUnitGrades, g.key) }));

  const matchup: TeamMatchupData | null = opponentAbbr
    ? {
        tabs: [
          { key: 'team', label: 'Team matchup' },
          { key: 'player', label: 'Player matchup' },
        ],
        team: teamMatchup,
        teamGradeBadges: opponentUnitGrades ? [{ label: `${opponentAbbr} DEF`, grade: findUnit(opponentUnitGrades, 'defense') }] : [],
        playerOptions: matchupEligibleRoster.map((p) => ({ id: p.subjectId, label: `${p.fullName} (${p.position})` })),
        selectedPlayerId: matchupPlayer?.subjectId ?? null,
        selectedPlayerCard,
        selectedPlayerGradeBadges,
      }
    : null;

  const rosterPlayers: RosterPlayer[] = data.roster.map((p) => ({
    subjectId: p.subjectId,
    name: p.fullName,
    position: p.position ?? '',
    teamAbbr: team.abbreviation,
    headshotUrl: p.headshotUrl ?? undefined,
    seasonLineText: seasonLineText(p),
    hasStats: p.seasonStats != null && p.seasonStats.games > 0,
    href: `/nfl/player/${encodeURIComponent(p.subjectId)}`,
    rankBadge:
      p.positionRank != null && p.positionPoolSize != null
        ? { label: `#${p.positionRank}`, title: `${p.positionRank} of ${p.positionPoolSize} ${p.position ?? ''}` }
        : null,
  }));

  const nextGameData: TeamNextGame | null = nextGame
    ? {
        opponentAbbr: opponentAbbr ?? (nextGame.homeTeam === team.abbreviation ? nextGame.awayTeam : nextGame.homeTeam),
        opponentTeamId: null,
        opponentLogoUrl: nflTeamLogoUrl(opponentAbbr ?? (nextGame.homeTeam === team.abbreviation ? nextGame.awayTeam : nextGame.homeTeam)),
        isHome: nextGame.homeTeam === team.abbreviation,
        startTime: nextGame.gameday,
        moneyline: null,
        total: null,
        gameHref: `/nfl/game/${nextGame.gameId}`,
      }
    : null;

  const recentResultRows =
    recentResults.length > 0
      ? recentResults.map((g) => {
          const isHomeGame = g.homeTeam === team.abbreviation;
          const oppAbbr = isHomeGame ? g.awayTeam : g.homeTeam;
          const scoreFor = isHomeGame ? g.homeScore : g.awayScore;
          const scoreAgainst = isHomeGame ? g.awayScore : g.homeScore;
          return {
            gameId: g.gameId,
            date: g.gameday,
            win: scoreFor != null && scoreAgainst != null ? scoreFor > scoreAgainst : null,
            opponentAbbr: oppAbbr,
            isHome: isHomeGame,
            scoreFor: scoreFor ?? 0,
            scoreAgainst: scoreAgainst ?? 0,
          };
        })
      : null;


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
    team: { teamId: Number(team.teamId), name: team.displayName, abbr: team.abbreviation, logoUrl },
    // R1b. `team.divisionRank` is already an ordinal ("2nd") from the route's
    // own `computeDivisionRank`; the division name it was ranked within lives
    // beside it and was being thrown away, which is what left the header
    // saying "in division" instead of "in NFC East".
    record: {
      wins: team.wins,
      losses: team.losses,
      // ESPN splits the name in two — `conference: "AFC"`, `division: "West"`
      // — and "1st in West" names no real division, so rejoin them.
      standing: standingPhrase(
        team.divisionRank ? Number(String(team.divisionRank).replace(/\D/g, '')) : null,
        [team.conference, team.division].filter(Boolean).join(' ') || null,
      ),
    },
    unitGrades: ownUnitGrades,
    candidates,
    games: gameRows,
    windows,
    distribution,
    matchup,
    statGroups,
    roster: rosterPlayers,
    rosterSortByStats: true,
    rosterPageSize: 24,
    standingsTeams,
    nextGame: nextGameData,
    advancedStats: null,
    form: windows,
    recentResults: recentResultRows,
  };
}

// ---------------------------------------------------------------------------
// R7.2 — the team research page
// ---------------------------------------------------------------------------

/**
 * NFL's team page: the shared team research read through the football spec,
 * plus NFL's own section, "Passing game" — who the targets go to and where the
 * offense throws and the defense is thrown at, against the league (R5d).
 */
export function toTeamResearchData(input: { payload: FootballTeamResearchPayload; season: number | null; now?: Date }): TeamResearchData {
  const data = buildTeamResearch({
    payload: input.payload,
    spec: footballTeamSpec('nfl'),
    season: input.season,
    teamHref: (id) => `/nfl/team/${encodeURIComponent(id)}`,
    now: input.now,
  });
  const season = data.scope.season;
  const roster = input.payload.seasons.find((s) => s.season === season)?.roster ?? [];
  return { ...data, sections: [...data.sections, nflPassingGameSection(input.payload.targets[String(season)] ?? null, roster, season)] };
}

const CELL_ROWS = ['deep', 'short'] as const;
const CELL_COLS = ['left', 'middle', 'right'] as const;
const pctFmt = (v: number) => `${v.toFixed(0)}%`;

function shareGrid(side: TeamTargetSide): { cells: Array<Array<{ key: string; value: number | null; sampleSize: number | null }>>; total: number } {
  const total = Object.values(side.cells).reduce((a, c) => a + c[0], 0);
  return {
    total,
    cells: CELL_ROWS.map((r) =>
      CELL_COLS.map((c) => {
        const cell = side.cells[`${r}|${c}`];
        return { key: `${r}|${c}`, value: cell && total ? (100 * cell[0]) / total : null, sampleSize: cell?.[0] ?? null };
      }),
    ),
  };
}

export function nflPassingGameSection(targets: NflTeamTargets | null, roster: TeamRosterEntry[], season: number): ResearchSection {
  const base = { id: 'passing', navLabel: 'Passing game', title: 'Passing game', sub: `${season} · targets and where the ball goes, nflverse play-by-play` };
  const receivers = roster.filter((e) => (e.stats['receiving.receivingTargets'] ?? 0) > 0);
  const teamTargets = receivers.reduce((a, e) => a + (e.stats['receiving.receivingTargets'] ?? 0), 0);
  if (!targets?.offense && !receivers.length) {
    return { ...base, rows: [], state: { kind: 'empty', title: `No passing data for ${season}`, reason: 'Neither the target rollup nor the game logs hold targets for this team and season yet.' } };
  }

  const share: ResearchCard = {
    kind: 'table',
    key: 'target-share',
    title: 'Target share',
    scope: `${teamTargets} targets from the box scores`,
    labelHeader: 'Receiver',
    sortKey: 'share',
    columns: [
      { key: 'tgt', label: 'Tgt', decimals: 0 },
      { key: 'share', label: 'Share', decimals: 1, format: 'percent' },
      { key: 'rec', label: 'Rec', decimals: 0 },
      { key: 'catch', label: 'Catch%', decimals: 1, format: 'percent' },
      { key: 'yds', label: 'Yds', decimals: 0 },
      { key: 'td', label: 'TD', decimals: 0 },
    ],
    rows: receivers.map((e) => {
      const tgt = e.stats['receiving.receivingTargets'] ?? 0;
      const rec = e.stats['receiving.receptions'] ?? 0;
      return {
        key: e.id,
        label: e.name,
        labelNote: e.position,
        imageUrl: e.headshotUrl,
        imageKind: 'player' as const,
        href: e.href,
        values: { tgt, share: teamTargets ? (100 * tgt) / teamTargets : null, rec, catch: tgt ? (100 * rec) / tgt : null, yds: e.stats['receiving.receivingYards'] ?? 0, td: e.stats['receiving.receivingTouchdowns'] ?? 0 },
      };
    }),
  };

  const sides: Array<{ key: 'offense' | 'defense' | 'league'; label: string; side: TeamTargetSide | null | undefined }> = [
    { key: 'offense', label: 'Where they throw', side: targets?.offense },
    { key: 'defense', label: 'Where they are thrown at', side: targets?.defense },
    { key: 'league', label: 'League', side: targets?.league },
  ];
  const views = sides
    .flatMap((v) => (v.side ? [{ key: v.key, label: v.label, side: v.side }] : []))
    .map(({ key, label, side }) => {
      const g = shareGrid(side);
      return {
        key,
        label,
        role: {
          title: label,
          surface: 'field' as const,
          measure: 'share' as const,
          cells: g.cells,
          rowLabels: ['Deep', 'Short'],
          columnLabels: ['left', 'middle', 'right'],
          domain: { lo: 0, hi: 40 },
          format: pctFmt,
          unit: '% of targets',
          caption: `${g.total.toLocaleString('en-US')} located targets${key === 'league' ? ', every team' : ` in ${side.games} games`} · deep is 15+ air yards`,
        },
      };
    });

  const rows: ResearchCard[][] = [];
  if (views.length) {
    const map: ResearchCard = { kind: 'surface', key: 'throw-map', title: 'Throw map', scope: 'share of targets by area', views };
    const lg = targets?.league ? shareGrid(targets.league) : null;
    const off = targets?.offense ? shareGrid(targets.offense) : null;
    const def = targets?.defense ? shareGrid(targets.defense) : null;
    const comp = (side: TeamTargetSide | null | undefined, key: string) => {
      const c = side?.cells[key];
      return c && c[0] ? (100 * c[1]) / c[0] : null;
    };
    const areas: ResearchCard = {
      kind: 'table',
      key: 'areas',
      title: 'By area, against the league',
      scope: 'share of targets and completion %',
      labelHeader: 'Area',
      fixedOrder: true,
      columns: [
        { key: 'off', label: 'Off share', decimals: 1, format: 'percent' },
        { key: 'lg', label: 'League', decimals: 1, format: 'percent' },
        { key: 'offCmp', label: 'Off cmp%', decimals: 1, format: 'percent' },
        { key: 'lgCmp', label: 'Lg cmp%', decimals: 1, format: 'percent' },
        { key: 'def', label: 'Def share', decimals: 1, format: 'percent' },
        { key: 'defCmp', label: 'Def cmp%', decimals: 1, format: 'percent', info: 'Completion % allowed' },
      ],
      rows: CELL_ROWS.flatMap((r, ri) =>
        CELL_COLS.map((c, ci) => {
          const key = `${r}|${c}`;
          return {
            key,
            label: `${r === 'deep' ? 'Deep' : 'Short'} ${c}`,
            values: {
              off: off?.cells[ri][ci].value ?? null,
              lg: lg?.cells[ri][ci].value ?? null,
              offCmp: comp(targets?.offense, key),
              lgCmp: comp(targets?.league, key),
              def: def?.cells[ri][ci].value ?? null,
              defCmp: comp(targets?.defense, key),
            },
          };
        }),
      ),
      caption: 'Interceptions are not held: nflverse’s interception flag is false on every stored target (R6-F11).',
    };
    rows.push([map, areas]);
  } else {
    rows.push([{ kind: 'status', key: 'throw-map', title: 'Throw map', headline: `No target rollup for ${season}`, reason: 'team_target_profile holds no row for this team and season yet.' }]);
  }
  if (receivers.length) rows.push([share]);
  return { ...base, rows, state: { kind: 'ready' } };
}
