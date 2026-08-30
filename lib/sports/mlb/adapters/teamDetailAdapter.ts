/**
 * Adapter for MLB's Team Detail page — Phase 1 of the sport-adapter design
 * (docs/sport-adapter-design.md §4). Pure data transform, no JSX: takes the
 * same inputs `components/TeamDetail.tsx` already has available (teamId,
 * snapshot, odds, and its hook results) plus the UI-selected market/scope
 * state that component keeps in its own `useState`, and produces the
 * generic `TeamDetailData` shape that a future genericized `TeamDetail`
 * would render.
 *
 * This file does not touch `TeamDetail.tsx` — Phase 2 wires a genericized
 * component to this adapter's output. Every branch below mirrors real logic
 * currently inline in `TeamDetail.tsx` (cited by line where useful) rather
 * than inventing new behavior.
 *
 * `statGroups` is the one section this adapter intentionally upgrades
 * rather than just mirroring: per the project's locked decision (see
 * docs/sport-adapter-design.md §4b/§8 and the caller's brief), MLB's Team
 * Stats section moves from flat two-column numbers to NFL's grouped ranked
 * `StatRankRow` bars — `{ label, stats: OpposingStarterStat[] }[]` — using
 * the same `teamSeasonStatRows` helper NFL's own stat rows go through.
 */

import type { PickCandidate, SportSnapshot, HistoryEntry } from '@/lib/core/types';
import {
  categoriseByLine,
  entryValue,
  fixedWindow,
  openWindow,
  subsetWindow,
  OVER,
  UNDER,
  type WindowedStat,
} from '@/lib/core/windowedStat';
import { directionMark } from '@/components/MarketLabel';
import type { GameDetailGame, StatKeyDef } from '@/components/GameDetail';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { TeamRosterData, TeamRosterPlayer } from '@/components/useTeamRoster';
import type { TeamStatcastTile } from '@/components/useTeamStatcast';
import type { TeamStandingRow } from '@/components/useAllTeams';
import type { RecentGameResult } from '@/lib/sports/mlb/statsapi';
import type { UnifiedLinesResult } from '@/lib/odds/types';
import { buildSlate } from '@/lib/odds/matching';
import { projectLine } from '@/lib/odds/display';
import { buildMoneylineCandidate, buildGameTotalCandidate } from '@/lib/sports/mlb/teamFormCandidates';
import { teamSeasonStatRows } from './statRowAdapter';
import type { BatterPitcherMatchupProps } from '@/components/BatterPitcherMatchupCard';
import type { PitchingMatchupGame } from '@/components/PitchingMatchupCard';
import type { TeamBullpen } from '@/components/useBullpen';
import type { NflPlayerVsDefenseCardProps } from '@/components/NflPlayerVsDefenseCard';
import { unitGradeFromRanked, type UnitGrade } from '@/lib/sports/shared/unitGrades';

// ---------------------------------------------------------------------------
// Shared sub-shapes (would be hoisted to a sport-agnostic location once an
// NFL counterpart adapter exists — kept local to this file for Phase 1,
// same "additive, one new file" scope the caller specified).
// ---------------------------------------------------------------------------

/** Unifies MLB's `RecentGameResult` (win/runsFor/runsAgainst) with NFL's `RecentResult` (homeScore/awayScore) — see design doc §1b. */
export interface RecentResultRow {
  gameId: string;
  date: string;
  win: boolean | null;
  /** Soccer-only: a real draw, distinct from `win: null`'s existing "result not yet known" meaning — MLB/NFL never set this (no draws), so `win`'s two-state boolean semantics stay unchanged for them. */
  isDraw?: boolean;
  opponentAbbr: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
}

/** The 5-key window shape MLB and NFL already both build identically via `fixedWindow`/`openWindow`/`subsetWindow` (design doc §0, §3). Used for both `windows` (main window boxes) and `form` (context-rail mini summary) — real MLB call sites currently only build this once and would reuse the same value for both, same as NFL's own `TeamDetail` already does for its "Form" panel. */
export interface TeamWindowedForm {
  l5: WindowedStat;
  l10: WindowedStat;
  l15: WindowedStat;
  h2h: WindowedStat;
  szn: WindowedStat;
}

/** Shared roster-row shape (design doc §4b "Roster — Universal shape"). */
export interface RosterPlayer {
  subjectId: string;
  name: string;
  position: string;
  teamAbbr: string;
  headshotUrl?: string;
  seasonLineText: string;
  hasStats: boolean;
  /**
   * PHASE 2 ADDITION — precomputed row link. MLB only links a roster row when
   * that player has both a tracked candidate and a `gamePk` for today
   * (`TeamDetail.tsx:604-640`); NFL always links to the player page
   * (`NflTeamDetail.tsx:673`). `null`/omitted renders a plain non-link row.
   */
  href?: string | null;
  /** PHASE 2 ADDITION — the roster row's rank chip. MLB: quality-of-contact overall rank (`useTeamBatterRanks`); NFL: position rank. Different underlying stat, same "#N" badge treatment. */
  rankBadge?: { label: string; title: string } | null;
}

/** One row of the Games table (TeamDetail.tsx:436-492) — this team's own scoped history, formatted for display. */
export interface GameRow {
  key: string;
  periodLabel: string;
  opponentTeamId: number | null;
  opponentLogoUrl?: string;
  value: number | null;
  /** 'W'/'L' for the moneyline market, the raw scoped value otherwise, '—' when unavailable — same formatting TeamDetail.tsx's table cell already does. */
  resultText: string;
  /** null when `value` is unavailable; otherwise whether this game cleared the active line. */
  cleared: boolean | null;
}

export interface TeamDistributionChartData {
  history: PickCandidate['history'];
  line: number;
  wantOver: boolean;
  refreshKey: string;
  /** Resolves a bar's opponent logo URL — same optional override `PlayerDetailChart`'s distribution variant takes. Omitted for MLB (numeric-opponentId default); NFL supplies its own abbreviation-keyed resolver. */
  logoFor?: (entry: PickCandidate['history'][number]) => string | undefined;
}

export interface TeamNextGame {
  opponentAbbr: string;
  opponentTeamId: number | null;
  opponentLogoUrl?: string;
  isHome: boolean;
  startTime: string | null;
  moneyline: { away: number | null; home: number | null } | null;
  total: { point: number | null; overPrice: number | null } | null;
  /** PHASE 2 ADDITION — pre-resolved link to the game page (`/mlb/game/{gamePk}` / `/nfl/game/{gameId}`), so the hero header's "vs/@ opponent →" link never needs a sport check to build its own href. */
  gameHref?: string | null;
}

/**
 * PHASE 2 ADDITION — the Matchup toggle section
 * (`TeamDetail.tsx:501-535`'s Pitching/Contact toggle, `NflTeamDetail.tsx:543-610`'s
 * Team/Player toggle). Genuinely different framings per sport (MLB: today's
 * two starters compared, or this team's hitting vs. the opposing starter;
 * NFL: this team's offense vs. the opponent's defense, or one roster
 * player's own numbers against the same opponent group) — not forced into
 * one shape, just named data slots a sport populates the subset of that
 * apply to it, same convention as `PlayerDetailData`'s `nflMatchup`/
 * `mlbContextMatchup`. `tabs` drives the toggle itself; which concrete field
 * a tab's content comes from is fixed by that tab's own `key`.
 */
export interface TeamMatchupData {
  tabs: Array<{ key: string; label: string }>;
  /** MLB "Pitching matchup" tab. */
  pitching?: { game: PitchingMatchupGame; bullpen: Record<number, TeamBullpen>; bullpenLoading: boolean } | null;
  /** MLB "Contact quality" tab. */
  contact?: BatterPitcherMatchupProps | null;
  /** NFL "Team matchup" tab. */
  team?: BatterPitcherMatchupProps | null;
  teamGradeBadges?: Array<{ label: string; grade: UnitGrade | null }>;
  /** NFL "Player matchup" tab — every skill-position roster player eligible for a matchup card, for the picker; `selectedPlayerId` (adapter input scope) decides which one's `selectedPlayerCard` gets built, same "effective X" pattern golf's round/category selection already uses. */
  playerOptions?: Array<{ id: string; label: string }>;
  selectedPlayerId?: string | null;
  selectedPlayerCard?: NflPlayerVsDefenseCardProps | null;
  selectedPlayerGradeBadges?: Array<{ label: string; grade: UnitGrade | null }>;
}

export interface TeamDetailData {
  team: { teamId: number; name: string; abbr: string; logoUrl: string };
  record: { wins: number; losses: number; divisionRank: string } | null;
  /**
   * This team's graded units, in render order — Phase 6.1.
   *
   * REPLACES `grades: TeamGrades | null`, whose nine hardcoded NFL unit names
   * meant its own doc comment here read "NFL-only — MLB has no grading model,
   * always null." That was a statement about the *type*, not about MLB: MLB
   * has league-ranked team Statcast metrics and now grades Hitting and
   * Pitching off them (see this file's `unitGrades` construction).
   *
   * A sport with no ranked team data emits `null` and the chips don't render.
   * Units carrying a `short` also appear in the header chip row.
   */
  unitGrades: UnitGrade[] | null;
  candidates: PickCandidate[];
  games: GameRow[];
  windows: TeamWindowedForm | null;
  distribution: TeamDistributionChartData | null;
  matchup?: TeamMatchupData | null;
  statGroups: { label: string; stats: OpposingStarterStat[]; grade?: UnitGrade | null }[];
  roster: RosterPlayer[];
  /** PHASE 2 ADDITION — NFL sorts has-stats roster players first and paginates at 24 (`NflTeamDetail.tsx:239-248`); MLB shows every player in API order, unpaginated. Data-driven so the shared roster list needs no sport check. */
  rosterSortByStats: boolean;
  rosterPageSize: number | null;
  standingsTeams: TeamStandingRow[];
  nextGame?: TeamNextGame | null;
  /**
   * PHASE 2 CORRECTION: Phase 1 typed this as a flat `OpposingStarterStat[]`,
   * losing the "Hitting"/"Pitching" subheadings the real rail card renders
   * (`TeamDetail.tsx:700-719`) — flagged as a fidelity gap in that same
   * comment. Grouped here instead, same shape as `statGroups`, to preserve
   * MLB's exact section headers.
   */
  advancedStats?: { label: string; stats: OpposingStarterStat[] }[] | null;
  form?: TeamWindowedForm | null;
  recentResults?: RecentResultRow[] | null;
}

export interface ToTeamDetailDataInput {
  teamId: number;
  snapshot: SportSnapshot | null;
  odds: UnifiedLinesResult | null;
  /** `useTeamRoster(teamId).data`, non-null — caller gates on loading/error the same way TeamDetail.tsx does today before ever reaching render. */
  roster: TeamRosterData;
  /** `useTeamForm(teamId).results`. */
  formResults: RecentGameResult[];
  /** `useTeamStatcast(teamId)` — `{ hitting, pitching }`. */
  teamStatcast: { hitting: TeamStatcastTile[]; pitching: TeamStatcastTile[] };
  /** `useTeamBatterRanks(teamId).byPersonId` — quality-of-contact overall rank, roster row badges (non-pitchers only). */
  batterRanksByPersonId: Map<number, import('@/components/useTeamBatterRanks').TeamBatterRank>;
  /** `useBullpen(awayTeamId, homeTeamId)` — only meaningful when this team is playing today. */
  bullpen: { byTeam: Record<number, TeamBullpen>; loading: boolean };
  standingsTeams: TeamStandingRow[];
  /** UI-selected market/scope state — same fields TeamDetail.tsx's own `useState` hooks hold (TeamDetail.tsx:96-103). Kept as inputs rather than baked into the adapter so a Phase 2 component can recompute this shape on every state change, same as the component does today via `useMemo`. */
  market: string | undefined;
  lineOffset: number;
  opponentOnly: boolean;
  venue: 'all' | 'home' | 'away';
  lastN: number | 'all';
}

/** Local copy of `PlayerDetail.tsx`'s exported `ordinal` — avoids a circular value-import (same reasoning as `playerDetailAdapter.ts`'s identical copy). */
function ordinal(rank: number): string {
  const suffix = rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th');
  return `${rank}${suffix}`;
}

function rawOf(entry: HistoryEntry): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

function teamLogoUrl(teamId: number | null | undefined): string | undefined {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : undefined;
}

/**
 * `forRanks` are pre-formatted ordinal strings ("28th") — pulls the raw int
 * back out. Duplicated from `TeamDetail.tsx`'s own local helper (and from
 * `statRowAdapter.ts`'s private copy, which isn't exported) — same small,
 * already-established duplication convention documented at
 * `lib/sports/mlb/adapters/statRowAdapter.ts:4`.
 */
function parseRank(s: string | null | undefined): number | null {
  const m = /^(\d+)/.exec(s ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * `teamSeasonStatRows` (statRowAdapter.ts) always reads `team.forStats` (the
 * per-game rate). The Season stat group needs the same stat keys read from
 * `team.forStatsSeason` (undivided totals) instead, ranked against the same
 * `forRanks` — real MLB data only has one rank set per team (computed in
 * `lib/sports/mlb/adapter.ts` off season-total `TeamStatLine`s, not
 * re-derived from the per-game division), so both groups legitimately share
 * it rather than needing a second, fabricated rank.
 */
function statRowsFromSeasonTotals(
  team: GameDetailGame['home'],
  statKeys: StatKeyDef[],
  poolSize = 30,
): OpposingStarterStat[] {
  if (!team) return [];
  return statKeys
    .map((k): OpposingStarterStat | null => {
      const value = team.forStatsSeason[k.key];
      const rank = parseRank(team.forRanks[k.key]);
      if (value == null || rank == null) return null;
      return { key: k.key, label: k.label, value, decimals: k.decimals, rank, poolSize };
    })
    .filter((s): s is OpposingStarterStat => s != null);
}

/** Same formatting `TeamDetail.tsx:68-77`'s local `seasonLineText` already produces — reused verbatim rather than reinvented, per the caller's brief. */
function seasonLineText(player: TeamRosterPlayer): string {
  const s = player.seasonLine;
  if (!s) return 'No stats yet this season';
  if (player.isPitcher) {
    const era = s.era != null ? s.era.toFixed(2) : '—';
    return `${era} ERA · ${s.wins ?? 0}-${s.losses ?? 0} · ${s.strikeOuts ?? 0} K`;
  }
  const avg = s.avg != null ? s.avg.toFixed(3) : '—';
  return `${avg} AVG · ${s.homeRuns ?? 0} HR · ${s.rbi ?? 0} RBI`;
}

export function toTeamDetailData(input: ToTeamDetailDataInput): TeamDetailData {
  const {
    teamId,
    snapshot,
    odds,
    roster,
    formResults,
    teamStatcast,
    batterRanksByPersonId,
    bullpen,
    standingsTeams,
    market,
    lineOffset,
    opponentOnly,
    venue,
    lastN,
  } = input;

  // Today's slate + this team's TeamGameContext, when it's playing today —
  // same lookup as TeamDetail.tsx:118-135.
  const other = snapshot?.context?.other as Record<string, unknown> | undefined;
  const games = (other?.games ?? []) as GameDetailGame[];
  const statKeys = (other?.statKeys ?? []) as StatKeyDef[];
  const todaysGame = games.find((g) => g.awayTeamId === teamId || g.homeTeamId === teamId);
  const isHome = todaysGame?.homeTeamId === teamId;
  const own = isHome ? todaysGame?.home : todaysGame?.away;
  const opponentId = todaysGame ? (isHome ? todaysGame.awayTeamId : todaysGame.homeTeamId) : undefined;
  const opponentAbbr = todaysGame
    ? (isHome ? todaysGame.matchup?.split('@')[0] : todaysGame.matchup?.split('@')[1])?.trim()
    : undefined;
  // Opposing starter — same fields PitchingMatchupCard/BatterPitcherMatchupCard
  // already read off the side of `todaysGame` that isn't this team (TeamDetail.tsx:139-145).
  const opponentStarterName = todaysGame ? (isHome ? todaysGame.awayStarter : todaysGame.homeStarter) : undefined;
  const opponentStarterStats = todaysGame ? (isHome ? todaysGame.awayStarterStats : todaysGame.homeStarterStats) : undefined;

  // Today's line + model edge — same as TeamDetail.tsx:147-158.
  const gameLine = (() => {
    if (!todaysGame) return null;
    const slate = buildSlate(games, odds?.lines ?? []);
    return slate.entries.find((e) => Number(e.game.gamePk) === Number(todaysGame.gamePk))?.line ?? null;
  })();
  // Note: TeamDetail.tsx also derives `moneylineEdge`/`totalEdge` here (via
  // computeMoneylineEdge/computeTotalEdge) to feed the line stepper's
  // `EdgeBadge`. That's line-stepper *rendering* state, not part of the
  // `TeamDetailData` field list this adapter builds (no `model` field was
  // specified) — Phase 2's component can compute it the same way from
  // `todaysGame.gameModel` + `projected`, both of which remain reachable
  // through `candidates`/`nextGame` below. Flagged in the verification report.
  const projected = gameLine ? projectLine(gameLine) : null;
  const myMoneylinePrice = isHome ? projected?.moneyline?.home : projected?.moneyline?.away;

  // Real PickCandidates built from this team's own results — same as
  // TeamDetail.tsx:163-199.
  const today =
    todaysGame && opponentId != null && opponentAbbr
      ? { opponentId, opponentAbbr, isHome, gamePk: todaysGame.gamePk ?? 'unknown' }
      : null;

  const moneyline = buildMoneylineCandidate({
    teamId,
    teamName: roster.teamName,
    teamAbbr: roster.abbreviation,
    results: formResults,
    today,
  });
  if (moneyline && myMoneylinePrice != null) {
    moneyline.odds = { americanOdds: String(myMoneylinePrice), source: 'odds-api', capturedAt: new Date().toISOString() };
  }

  const total = buildGameTotalCandidate({
    teamId,
    teamName: roster.teamName,
    teamAbbr: roster.abbreviation,
    results: formResults,
    today,
    todaysTotalLine: projected?.total?.point ?? null,
  });
  const myTotalPrice = projected?.total?.overPrice;
  if (total && myTotalPrice != null) {
    total.odds = { americanOdds: String(myTotalPrice), source: 'odds-api', capturedAt: new Date().toISOString() };
  }

  const teamProps = (snapshot?.candidates ?? []).filter(
    (c) => c.subjectId === `team-${teamId}` && (c.subjectMeta as Record<string, unknown> | undefined)?.isTeamCandidate === true,
  );

  const candidates = [moneyline, total, ...teamProps].filter((c): c is PickCandidate => c != null);

  // Resolve the active candidate + line for this render, same as
  // TeamDetail.tsx:201-239.
  const active = candidates.find((c) => c.dimension === market) ?? candidates[0] ?? null;
  const wantOver = active ? directionMark(active.category) !== 'U' : true;
  const baseLine = active?.line ?? 0.5;
  const line = Math.max(0, baseLine + lineOffset);
  const isMoneylineMarket = active?.dimension === 'moneyline';

  const scoped: PickCandidate['history'] = (() => {
    if (!active) return [];
    let list = active.history;
    if (opponentOnly && opponentId != null) {
      list = list.filter((e) => (rawOf(e).opponentId as number | undefined) === opponentId);
    }
    if (venue !== 'all') list = list.filter((e) => rawOf(e).isHome === (venue === 'home'));
    if (lastN !== 'all') list = list.slice(-lastN);
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
          opponentId == null
            ? ({ status: 'insufficient', available: 0, required: 1 } as WindowedStat)
            : subsetWindow(
                categoriseByLine(active.history, line),
                wanted,
                (e) => (rawOf(e).opponentId as number | undefined) === opponentId,
                { minimum: 1 },
              ),
      }
    : null;

  // Games table rows — same source (`scoped`) and per-row math as
  // TeamDetail.tsx:463-487, just formatted into data instead of JSX.
  const gameRows: GameRow[] = scoped.map((entry, index) => {
    const value = entryValue(entry);
    const cleared = value == null ? null : wantOver ? value > line : value <= line;
    const opponentTeamId = (rawOf(entry).opponentId as number | undefined) ?? null;
    const resultText = isMoneylineMarket ? (value === 1 ? 'W' : value === 0 ? 'L' : '—') : value != null ? String(value) : '—';
    return {
      key: `${entry.period}-${index}`,
      periodLabel: entry.periodLabel ?? '',
      opponentTeamId,
      opponentLogoUrl: teamLogoUrl(opponentTeamId),
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
        refreshKey: `${active.dimension}|${line}|${opponentOnly}|${venue}|${lastN}|${teamId}`,
      }
    : null;

  // Team stats — upgraded to grouped ranked-bar rows per the locked design
  // decision (docs/sport-adapter-design.md §4b/§8). Only real for a team
  // playing today: `own` (TeamGameContext) is only computed for the two
  // teams in today's slate (see TeamDetail.tsx:538 `todaysGame && own`),
  // so a team with no game today has no `forStats`/`forRanks` to rank from —
  // real gap, not a bug, same as TeamDetail.tsx's own current gating.
  const statGroups: { label: string; stats: OpposingStarterStat[] }[] =
    todaysGame && own
      ? [
          { label: 'Per game', stats: teamSeasonStatRows(own, statKeys) },
          { label: 'Season', stats: statRowsFromSeasonTotals(own, statKeys) },
        ]
      : [];

  // Matchup toggle — Pitching (today's two starters) / Contact quality (this
  // team's hitting rollup vs. the opposing starter), TeamDetail.tsx:496-535.
  const matchup: TeamMatchupData | null = todaysGame
    ? {
        tabs: [
          { key: 'pitching', label: 'Pitching matchup' },
          { key: 'contact', label: 'Contact quality' },
        ],
        pitching: { game: todaysGame as PitchingMatchupGame, bullpen: bullpen.byTeam, bullpenLoading: bullpen.loading },
        contact: {
          title: 'Contact quality matchup',
          subjectName: roster.teamName,
          subjectHeadshotUrl: roster.logoUrl,
          subjectTeamAbbr: roster.abbreviation,
          subjectTeamLogoUrl: roster.logoUrl,
          subjectStats: [...teamStatcast.hitting, ...teamSeasonStatRows(own, statKeys)],
          opponentName: opponentStarterName ?? 'Opposing starter',
          opponentHeadshotUrl: opponentId != null ? teamLogoUrl(opponentId) : undefined,
          opponentRoleLabel: 'Allows',
          opponentTeamAbbr: opponentAbbr,
          opponentTeamLogoUrl: opponentId != null ? teamLogoUrl(opponentId) : undefined,
          opponentStats: opponentStarterStats ?? [],
        },
      }
    : null;

  // Roster row link + rank badge — TeamDetail.tsx:604-640. Only a player
  // with both a tracked candidate and a `gamePk` for today is linkable;
  // quality-of-contact rank only exists for non-pitchers.
  const playerCandidateByPersonId = new Map<number, PickCandidate>();
  for (const c of snapshot?.candidates ?? []) {
    const id = Number(c.subjectId);
    if (Number.isFinite(id) && !playerCandidateByPersonId.has(id)) playerCandidateByPersonId.set(id, c);
  }

  const rosterPlayers: RosterPlayer[] = roster.roster.map((p) => {
    const candidate = playerCandidateByPersonId.get(p.id);
    const gamePk = (candidate?.subjectMeta as Record<string, unknown> | undefined)?.gamePk as string | number | undefined;
    const rank = !p.isPitcher ? batterRanksByPersonId.get(p.id) : undefined;
    return {
      subjectId: String(p.id),
      name: p.fullName,
      position: p.position,
      teamAbbr: roster.abbreviation,
      headshotUrl: p.headshotUrl,
      seasonLineText: seasonLineText(p),
      hasStats: p.seasonLine != null,
      href: candidate && gamePk != null ? `/mlb/game/${gamePk}?player=${p.id}&market=${candidate.dimension}` : null,
      rankBadge:
        rank?.overallRank != null
          ? {
              label: `#${rank.overallRank}`,
              title: `Quality of contact: ${ordinal(rank.overallRank)} of ${rank.poolSize} overall, ${
                rank.positionRank != null ? `${ordinal(rank.positionRank)} of ${rank.positionPoolSize} at ${rank.position}` : 'position rank unavailable'
              }`,
            }
          : null,
    };
  });

  const nextGame: TeamNextGame | null = todaysGame
    ? {
        opponentAbbr: opponentAbbr ?? '',
        opponentTeamId: opponentId ?? null,
        opponentLogoUrl: teamLogoUrl(opponentId),
        isHome,
        startTime: todaysGame.firstPitch ?? null,
        moneyline: projected?.moneyline
          ? { away: projected.moneyline.away ?? null, home: projected.moneyline.home ?? null }
          : null,
        total:
          projected?.total?.point != null
            ? { point: projected.total.point, overPrice: projected.total.overPrice ?? null }
            : null,
        gameHref: `/mlb/game/${todaysGame.gamePk}`,
      }
    : null;

  // Advanced stats (Statcast) — MLB-only, grouped Hitting/Pitching same as
  // the real rail card's subheadings (TeamDetail.tsx:700-719).
  const advancedStatsGroups = [
    { label: 'Hitting', stats: teamStatcast.hitting },
    { label: 'Pitching', stats: teamStatcast.pitching },
  ].filter((g) => g.stats.length > 0);
  const advancedStats: { label: string; stats: OpposingStarterStat[] }[] | null = advancedStatsGroups.length > 0 ? advancedStatsGroups : null;

  const recentResults: RecentResultRow[] | null =
    formResults.length > 0
      ? formResults.map((r) => ({
          gameId: String(r.gamePk),
          date: r.date,
          win: r.win,
          opponentAbbr: r.opponentAbbr,
          isHome: r.isHome,
          scoreFor: r.runsFor,
          scoreAgainst: r.runsAgainst,
        }))
      : null;

  // Unit grades — Phase 6.1. This was `grades: null` with the comment "MLB has
  // no grading model", which was a fact about the old NFL-shaped type rather
  // than about MLB. `teamStatcast.hitting`/`.pitching` are already ranked
  // league-wide (every `TeamStatcastTile` carries a real `rank`/`poolSize`,
  // and `StatRankRow` renders those same ranks on this page today), so
  // compositing each group's percentiles gives two genuinely earned units on
  // exactly the input NFL's own grades use.
  //
  // Two units, not a padded four: there is no league-wide ranked fielding or
  // bullpen aggregate to grade from, and inventing one to fill a slot is what
  // CLAUDE.md's sport-adapter §2 forbids. Those arrive with 6.1b's team-season
  // aggregate, alongside NBA's and NHL's.
  //
  // Unlike `statGroups`, this is NOT gated on a game today — `teamStatcast` is
  // season-wide, so a team on an off day still shows its grades.
  const mlbUnitGrades: UnitGrade[] = [
    unitGradeFromRanked({ key: 'hitting', label: 'Hitting', short: 'HIT' }, teamStatcast.hitting),
    unitGradeFromRanked({ key: 'pitching', label: 'Pitching', short: 'PIT' }, teamStatcast.pitching),
  ].filter((u): u is UnitGrade => u != null);

  return {
    team: { teamId, name: roster.teamName, abbr: roster.abbreviation, logoUrl: roster.logoUrl },
    record: roster.record,
    unitGrades: mlbUnitGrades.length > 0 ? mlbUnitGrades : null,
    candidates,
    games: gameRows,
    windows,
    distribution,
    matchup,
    statGroups,
    roster: rosterPlayers,
    rosterSortByStats: false,
    rosterPageSize: null,
    standingsTeams,
    nextGame,
    advancedStats,
    // Same computed `windows` value, reused for the context-rail "Form"
    // summary — real behavior NFL's own TeamDetail already exhibits (its
    // "Form" panel renders the identical `windows` object a second time in
    // the rail), not a new computation.
    form: windows,
    recentResults,
  };
}
