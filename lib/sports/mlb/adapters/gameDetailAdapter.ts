import type { GameDetailGame, PicksPanelGame, RecordsSectionTeam, LastFiveGamesTeam, StatKeyDef, RankableTeamStats } from '@/components/GameDetail';
import type { RecentGameResult, InjuryEntry } from '@/lib/sports/mlb/statsapi';
import type { GameHeroTeamPanelData, GameHeroModel, VenueForecastData } from '@/components/GameHeroCard';
import type { PitchingMatchupGame } from '@/components/PitchingMatchupCard';
import type { TeamBullpen } from '@/components/useBullpen';
import type { BatterPitcherMatchupProps } from '@/components/BatterPitcherMatchupCard';
import type { NflPlayerVsDefenseCardProps } from '@/components/NflPlayerVsDefenseCard';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import type { UnitGrade } from '@/lib/sports/shared/unitGrades';
import type { PickCandidate } from '@/lib/core/types';
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { GameContextState } from '@/components/useGameContext';
import type { GamePickView } from '@/components/useGamePickRecord';
import { projectLine } from '@/lib/odds/display';
import { toGameHeroModel, toGameHeroTeamPanelData, toVenueForecast } from './gameHeroCardAdapter';

/**
 * MLB → generic transforms for the `GameDetail.tsx` component family
 * (`RecordsSection`, `LastFiveGames`, `Injuries`, `PicksPanel`), per
 * `docs/sport-adapter-design.md` §1. Phase 1 only: these produce the generic
 * shapes the design doc specifies from MLB's real current data — the
 * components themselves stay untouched (and still module-private) until
 * Phase 2/3 wires these adapters in.
 *
 * `TeamGameContext` (GameDetail.tsx:55-68) is not exported by that file — it
 * doesn't need to be. `GameDetailGame['away']` (GameDetailGame itself IS
 * exported, GameDetail.tsx:70) gives the identical structural type via
 * indexed access without requiring an export change, the same technique
 * `lib/sports/mlb/adapters/statRowAdapter.ts` already uses for the same
 * reason (see its `team: GameDetailGame['home']` parameter).
 */
type TeamGameContext = NonNullable<GameDetailGame['away']>;

// ---------------------------------------------------------------------------
// §1a — RecordsSection: TeamRecordsData
// ---------------------------------------------------------------------------

export interface GameRecord {
  wins: number;
  losses: number;
}

export interface TeamRecordsData {
  abbr: string;
  logoUrl: string;
  record: GameRecord | null;
  homeRecord?: GameRecord | null;
  awayRecord?: GameRecord | null;
  lastTen?: GameRecord | null;
  divisionRank?: string | null;
}

/**
 * Season-level records + division rank for one side of the matchup — the
 * data `RecordsSection`'s "Season" tab reads today (GameDetail.tsx:936-946,
 * 988-1008). The "Last 5"/"Head to head" tabs are derived from
 * `RecentGameResult[]` at render time via `recordFrom()`
 * (GameDetail.tsx:99-104), not from `TeamGameContext` — that derivation is
 * unaffected by this adapter and stays exactly as-is until Phase 2.
 */
export function toTeamRecordsData(ctx: TeamGameContext, abbr: string, logoUrl: string): TeamRecordsData {
  return {
    abbr,
    logoUrl,
    record: ctx.record,
    homeRecord: ctx.homeRecord,
    awayRecord: ctx.awayRecord,
    lastTen: ctx.lastTen,
    divisionRank: ctx.divisionRank,
  };
}

// ---------------------------------------------------------------------------
// §1b — LastFiveGames: RecentResultRow + widened computeStreak
// ---------------------------------------------------------------------------

export interface RecentResultRow {
  gameId: string;
  date: string;
  win: boolean | null;
  opponentAbbr: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
}

/** Unifies MLB's `RecentGameResult` (win/runsFor/runsAgainst) into the sport-agnostic `RecentResultRow` shape `LastFiveGames`/`GameTile` will read once genericized. */
export function toRecentResultRow(g: RecentGameResult): RecentResultRow {
  return {
    gameId: String(g.gamePk),
    date: g.date,
    win: g.win,
    opponentAbbr: g.opponentAbbr,
    isHome: g.isHome,
    scoreFor: g.runsFor,
    scoreAgainst: g.runsAgainst,
  };
}

/**
 * Widened copy of `computeStreak` (GameDetail.tsx:1092-1101) — algorithm is
 * byte-identical, only the declared parameter type changes from the
 * MLB-typed `RecentGameResult[]` to the generic `RecentResultRow[]`, per the
 * design doc's explicit instruction (§1b). GameDetail.tsx's own exported
 * `computeStreak` is left untouched; this is a separate function, not a
 * replacement, so existing MLB call sites (GameDetail.tsx, GameHeroCard.tsx)
 * are unaffected until Phase 2 switches them over.
 *
 * Most recent first; a positive run = current win streak, negative = current
 * losing streak.
 */
export function computeStreak(games: RecentResultRow[]): number {
  if (games.length === 0) return 0;
  const first = games[0].win;
  let n = 0;
  for (const g of games) {
    if (g.win !== first) break;
    n++;
  }
  return first ? n : -n;
}

// ---------------------------------------------------------------------------
// §1c — Injuries: InjuryRow
// ---------------------------------------------------------------------------

export interface InjuryRow {
  playerName: string;
  status: string;
  position?: string;
  note?: string;
}

/**
 * MLB's `InjuryEntry` (lib/sports/mlb/statsapi.ts:929-946) also carries
 * `teamId`/`playerId` (used today only for the React `key` and for keying
 * `gameContext.injuries` by team, GameDetail.tsx:1472-1473 — irrelevant to
 * the row's own display). `position` (GameDetail.tsx:1459 shows
 * `"{position} · {injury}"`) was initially missing from `InjuryRow` — a real
 * gap this adapter's first draft surfaced rather than silently dropping;
 * design doc §1c has since been corrected to include it.
 */
export function toInjuryRow(e: InjuryEntry): InjuryRow {
  return {
    playerName: e.playerName,
    status: e.status,
    position: e.position ?? undefined,
    note: e.injury ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// §1d — PicksPanel: PicksPanelGame
// ---------------------------------------------------------------------------

/**
 * Narrows `GameDetailGame` to exactly what `PicksPanelProps.game` needs per
 * the design doc (§1d, corrected during Phase 2 — the first draft was too
 * narrow, missing `homeTeamId`/`awayTeamId`/`gameModel`/`sport`, all of
 * which the real `PicksPanel` body actually reads) — the same narrowing
 * precedent `RankableTeamStats` already established for the Rankings views
 * (GameDetail.tsx:86-89).
 *
 * `id` falls back to `'unknown'` when `gamePk` is absent, matching the
 * fallback `PicksPanel`'s own `addLeg()` already uses today
 * (`game.gamePk ?? 'unknown'`, GameDetail.tsx:1537) so behavior doesn't
 * change once this narrowed shape is wired in.
 */
export function toPicksPanelGame(game: GameDetailGame): PicksPanelGame {
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
  return {
    id: game.gamePk != null ? String(game.gamePk) : 'unknown',
    sport: 'mlb',
    awayAbbr: awayAbbr ?? '',
    homeAbbr: homeAbbr ?? '',
    homeTeamId: game.homeTeamId ?? null,
    awayTeamId: game.awayTeamId ?? null,
    gameModel: game.gameModel ?? null,
  };
}

// ---------------------------------------------------------------------------
// Phase 2 (GameDetail root unification) — the full page's data, one call per
// sport. Everything above this point (records/last-five/injuries/picks) was
// already Phase 1; this section widens the same file to also cover the root
// `GameDetail` component's remaining sections (hero, matchup, stat
// comparison, rankings, unit grades, props-for-game list, left rail) so
// `components/GameDetail.tsx` itself can become the one shared page for both
// sports, the same way `PlayerDetail.tsx`/`TeamDetail.tsx` already did.
// ---------------------------------------------------------------------------

/**
 * The Matchup section. MLB: a single `PitchingMatchupCard` (today's two
 * starters). NFL: a Team/Player toggle (`BatterPitcherMatchupCard` for
 * either direction, or one skill player vs. the real opponent-defense group
 * their position measures). Genuinely different framings — same "named
 * per-sport slots, not one forced shape" convention `PlayerDetailData`'s
 * `nflMatchup`/`mlbContextMatchup` and `TeamDetailData`'s `matchup` already
 * use; which concrete field renders is decided by the active tab's key.
 */
export interface GameMatchupData {
  tabs: Array<{ key: string; label: string }>;
  /** MLB "Pitching" tab (also MLB's only tab — `tabs` is a single entry, no toggle actually shows). */
  pitching?: { game: PitchingMatchupGame; bullpen: Record<number, TeamBullpen>; bullpenLoading: boolean } | null;
  /** NFL "Team" tab — both directions shown at once (away's offense vs. home's defense, and vice versa). */
  teamAway?: BatterPitcherMatchupProps | null;
  teamHome?: BatterPitcherMatchupProps | null;
  /** NFL "Player" tab. */
  playerOptions?: Array<{ id: string; label: string }>;
  selectedPlayerId?: string | null;
  selectedPlayerCard?: NflPlayerVsDefenseCardProps | null;
}

/**
 * The Stat comparison section. MLB: away/home magnitude bars, grouped
 * Batting/Rate (`StatComparisonRow`). NFL: ranked rows with a real
 * league-wide rank per side (`TwoSidedStatRankRow`), grouped by box-score
 * category. Different visual language, not just different data — kept as
 * two distinct optional shapes (`bars`/`ranked`) rather than one forced
 * shape, same reasoning as `GameMatchupData`.
 */
export interface StatComparisonData {
  awayAbbr: string;
  homeAbbr: string;
  bars?: Array<{ label: string; rows: Array<{ key: string; label: string; away: number | null; home: number | null; decimals: number }> }>;
  ranked?: Array<{ label: string; rows: Array<{ key: string; label: string; away?: OpposingStarterStat; home: OpposingStarterStat }> }>;
}

export interface RankingsData {
  away: RankableTeamStats;
  home: RankableTeamStats;
  statKeys: StatKeyDef[];
  awayAbbr: string;
  homeAbbr: string;
  awayLogoUrl?: string;
  homeLogoUrl?: string;
  poolSize: number;
}

export interface GameDetailData {
  gameId: string;
  /**
   * The real per-game bookmaker grid — every real book from every real
   * source, merged (readGameOddsBookLines, lib/db/client.ts — odds-
   * architecture rebuild Phase 6). Populated by every sport's own adapter
   * from the SAME unified read (GameDetail.tsx fetches it once via
   * useGameOddsBookLines and threads it into every sport's adapter call),
   * not a sport-specific derivation — this is what BookmakerBreakdown/
   * PicksPanel actually render, replacing the old `mlbGameLine`/
   * `nflGameLine` ad hoc local-state approach that only ever existed for
   * those two sports. `null` when nothing's been recovered for this game
   * yet. Distinct from `hero.pregameLines` below (a narrow, compact
   * best-price-only summary for the hero strip) and `leftRail.
   * nflTeamScope` (NFL's own specific left-rail panel override) — both of
   * those are real, separate UI slots this field doesn't replace.
   */
  gameLine: UnifiedGameLine | null;
  hero: {
    away: GameHeroTeamPanelData;
    home: GameHeroTeamPanelData;
    isLive: boolean;
    isFinal: boolean;
    liveScore?: { home: string; away: string };
    livePeriodLabel?: string;
    startTimeLabel: string;
    startTimeCaption?: string;
    model: GameHeroModel | null;
    pickLockAt: Date | null;
    pickLoading: boolean;
    venue: VenueForecastData | null;
    /** NFL's down/distance sub-line, already formatted — component wraps it in the live-extra slot. */
    liveExtraText?: string;
    /**
     * NFL's pregame ML/spread/total price strip. `undefined` (MLB) means the
     * slot doesn't apply at all — MLB's pregame odds live in the pick-lock
     * panel below, not inline center. `null` (NFL, no line posted yet) still
     * renders the slot, with its own "No game line yet" fallback text.
     */
    pregameLines?: {
      /** `draw` is soccer-only (its real third moneyline outcome) — every
       * other sport's derivation simply never sets it. */
      moneyline?: { away: number | null; home: number | null; draw?: number | null } | null;
      spread?: { homePoint: number | null } | null;
      total?: { point: number | null } | null;
    } | null;
    /** MLB-only escape hatch for `LiveTab`, which needs the full raw `GameDetailGame` (bases/box score/bullpen) — genuinely not reducible to plain cross-sport data. `null`/omitted disables the expanded live tab (NFL has none today). */
    mlbLiveGame?: GameDetailGame | null;
    mlbGamePk?: string | number | null;
    /**
     * The hero card's grade chips (`GameHeroTeamPanelData.renderBadges`) —
     * kept as plain data here rather than a `() => ReactNode` closure inside
     * the adapter, so the component (not the adapter) builds the actual JSX,
     * per this file family's "no render props from an adapter" rule.
     *
     * Phase 6.1 retyped these from `TeamGrades` to `UnitGrade[]`. The chip row
     * renders the units carrying a `short`, so it is NFL's OFF/DEF/ST or MLB's
     * HIT/PIT with no sport check and no fixed count. `null`/omitted renders
     * no badges.
     */
    awayGrades?: UnitGrade[] | null;
    homeGrades?: UnitGrade[] | null;
  };
  matchup: GameMatchupData | null;
  records: { away: RecordsSectionTeam; home: RecordsSectionTeam; loading: boolean };
  statComparison: StatComparisonData | null;
  lastFive: { away: LastFiveGamesTeam; home: LastFiveGamesTeam; loading: boolean };
  rankings: RankingsData | null;
  /**
   * The unit grade table (`GradesTable`, `NflGameDetail.tsx:189-216`).
   *
   * Phase 6.1: was `TeamGrades`, whose nine hardcoded NFL unit names made this
   * field structurally unfillable by any other sport — its own comment said
   * "MLB has no grading model", which described the type. Now an ordered
   * `UnitGrade[]` per side; the table derives its rows from whatever units the
   * two sides actually declare (`mergeUnitRows`), so it renders four MLB rows
   * or nine NFL ones without knowing which sport it is looking at.
   */
  unitGrades: { away: UnitGrade[] | null; home: UnitGrade[] | null; awayAbbr: string; homeAbbr: string } | null;
  injuries: { away: InjuriesTeam; home: InjuriesTeam; loading: boolean };
  /** NFL-only flat "every candidate for this game" list (`NflGameDetail.tsx:700-728`) — MLB's `LeftRail` already covers this ground for MLB, so this stays `null` there rather than showing the same list twice. */
  propsForGame: { candidates: PickCandidate[] } | null;
  picksPanelGame: PicksPanelGame;
  leftRail: {
    candidates: PickCandidate[];
    /** Default true (MLB). NFL has no graded pick history to gate against — see `LeftRail`'s own `goodBetsGated` doc comment. */
    goodBetsGated: boolean;
    /** NFL's `NflTeamScopePanel` override for `LeftRail`'s team-scope slot — `null` (MLB) uses `LeftRail`'s own default panel. */
    nflTeamScope?: { gameLine: UnifiedGameLine | null; homeAbbr: string } | null;
  };
}

// Local copies of `Injuries`'/`InjuriesTeam`'s shape reference (already
// imported as a type further up via `InjuryRow`) — `InjuriesTeam` itself
// isn't exported from GameDetail.tsx under that exact name for import here,
// so it's inlined structurally in `GameDetailData` above instead.
interface InjuriesTeam {
  abbr: string;
  logoUrl?: string;
  rows: InjuryRow[];
}

// ---------------------------------------------------------------------------
// MLB adapter
// ---------------------------------------------------------------------------

function teamLogoUrl(teamId?: number): string | undefined {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : undefined;
}

export interface MlbGameDetailInput {
  game: GameDetailGame;
  statKeys: StatKeyDef[];
  gameContext: GameContextState;
  bullpen: { byTeam: Record<number, TeamBullpen>; loading: boolean };
  gameLine: UnifiedGameLine | null;
  trustedMarkets: ReadonlySet<string>;
  gamePick: GamePickView | null;
  pickLoading: boolean;
  /** Page-filtered player-level candidates for this game — the page still owns snapshot filtering (and, for MLB, the global filter sidebar), same as today. */
  candidates: PickCandidate[];
}

export function toGameDetailData(input: MlbGameDetailInput): GameDetailData {
  const { game, statKeys, gameContext, bullpen, gameLine, trustedMarkets, gamePick, pickLoading, candidates } = input;
  const [awayAbbr, homeAbbr] = (game.matchup ?? '').split('@').map((s) => s.trim());
  const isLive = /live|in progress/i.test(game.state ?? '');
  const isFinal = /final/i.test(game.state ?? '');
  const awayRecent = game.awayTeamId != null ? gameContext.recent[game.awayTeamId] : undefined;
  const homeRecent = game.homeTeamId != null ? gameContext.recent[game.homeTeamId] : undefined;
  const matchupProjected = gameLine ? projectLine(gameLine) : null;

  const hero: GameDetailData['hero'] = {
    away: toGameHeroTeamPanelData(game.away, game.awayTeamId, awayAbbr, game.awayTeamName ?? awayAbbr, (awayRecent?.recent ?? []).slice(0, 5)),
    home: toGameHeroTeamPanelData(game.home, game.homeTeamId, homeAbbr, game.homeTeamName ?? homeAbbr, (homeRecent?.recent ?? []).slice(0, 5)),
    isLive,
    isFinal,
    liveScore: game.liveScore,
    livePeriodLabel: game.livePeriod,
    startTimeLabel: game.firstPitch ? new Date(game.firstPitch).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'TBD',
    startTimeCaption: 'FIRST PITCH',
    model: toGameHeroModel(game.gameModel, matchupProjected?.moneyline, matchupProjected?.total, trustedMarkets, gamePick),
    pickLockAt: game.firstPitch ? new Date(new Date(game.firstPitch).getTime() - 3 * 60 * 60 * 1000) : null,
    pickLoading,
    venue: toVenueForecast(game),
    mlbLiveGame: game,
    mlbGamePk: game.gamePk ?? null,
  };

  const matchup: GameMatchupData = {
    tabs: [{ key: 'pitching', label: 'Pitching matchup' }],
    pitching: { game: game as PitchingMatchupGame, bullpen: bullpen.byTeam, bullpenLoading: bullpen.loading },
  };

  const records: GameDetailData['records'] = {
    away: {
      abbr: awayAbbr,
      logoUrl: teamLogoUrl(game.awayTeamId),
      divisionRank: game.away?.divisionRank ?? null,
      season: game.away?.record ?? null,
      seasonHome: game.away?.homeRecord ?? null,
      seasonAway: game.away?.awayRecord ?? null,
      recent: (awayRecent?.recent ?? []).slice(0, 5).map(toRecentResultRow),
      h2h: (awayRecent?.h2h ?? []).map(toRecentResultRow),
    },
    home: {
      abbr: homeAbbr,
      logoUrl: teamLogoUrl(game.homeTeamId),
      divisionRank: game.home?.divisionRank ?? null,
      season: game.home?.record ?? null,
      seasonHome: game.home?.homeRecord ?? null,
      seasonAway: game.home?.awayRecord ?? null,
      recent: (homeRecent?.recent ?? []).slice(0, 5).map(toRecentResultRow),
      h2h: (homeRecent?.h2h ?? []).map(toRecentResultRow),
    },
    loading: gameContext.loading,
  };

  const battingKeys = statKeys.filter((k) => k.decimals !== 3);
  const rateKeys = statKeys.filter((k) => k.decimals === 3);
  const toBarsGroup = (keys: StatKeyDef[], label: string) =>
    keys.length === 0
      ? null
      : {
          label,
          rows: keys.map((k) => ({
            key: k.key,
            label: k.label,
            away: game.away?.forStats[k.key] ?? null,
            home: game.home?.forStats[k.key] ?? null,
            decimals: k.decimals,
          })),
        };
  const statComparison: StatComparisonData = {
    awayAbbr,
    homeAbbr,
    bars: [toBarsGroup(battingKeys, 'Batting'), toBarsGroup(rateKeys, 'Rate')].filter(
      (g): g is NonNullable<typeof g> => g != null,
    ),
  };

  const lastFive: GameDetailData['lastFive'] = {
    away: { abbr: awayAbbr, logoUrl: teamLogoUrl(game.awayTeamId), games: (awayRecent?.recent ?? []).slice(0, 5).map(toRecentResultRow) },
    home: { abbr: homeAbbr, logoUrl: teamLogoUrl(game.homeTeamId), games: (homeRecent?.recent ?? []).slice(0, 5).map(toRecentResultRow) },
    loading: gameContext.loading,
  };

  const rankings: RankingsData = {
    away: { forRanks: game.away?.forRanks ?? {}, againstRanks: game.away?.againstRanks ?? {} },
    home: { forRanks: game.home?.forRanks ?? {}, againstRanks: game.home?.againstRanks ?? {} },
    statKeys,
    awayAbbr,
    homeAbbr,
    awayLogoUrl: teamLogoUrl(game.awayTeamId),
    homeLogoUrl: teamLogoUrl(game.homeTeamId),
    poolSize: 30,
  };

  const injuries: GameDetailData['injuries'] = {
    away: {
      abbr: awayAbbr,
      logoUrl: teamLogoUrl(game.awayTeamId),
      rows: ((game.awayTeamId != null ? gameContext.injuries[game.awayTeamId] : undefined) ?? []).map(toInjuryRow),
    },
    home: {
      abbr: homeAbbr,
      logoUrl: teamLogoUrl(game.homeTeamId),
      rows: ((game.homeTeamId != null ? gameContext.injuries[game.homeTeamId] : undefined) ?? []).map(toInjuryRow),
    },
    loading: gameContext.loading,
  };

  return {
    gameId: game.gamePk != null ? String(game.gamePk) : 'unknown',
    gameLine,
    hero,
    matchup,
    records,
    statComparison,
    lastFive,
    rankings,
    unitGrades: null,
    injuries,
    propsForGame: null,
    picksPanelGame: toPicksPanelGame(game),
    leftRail: { candidates, goodBetsGated: true, nflTeamScope: null },
  };
}
