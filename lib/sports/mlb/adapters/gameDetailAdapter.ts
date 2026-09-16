import type { GameDetailGame, PicksPanelGame, RecordsSectionTeam, LastFiveGamesTeam, StatKeyDef, RankableTeamStats } from '@/components/GameDetail';
import type { MlbGameResearchPayload } from '@/lib/sports/mlb/gameResearch';
import { pitchMix, type AtBat, type MlbWinProbabilityPoint } from '@/lib/sports/mlb/liveFeedParsers';
import { buildGameHero, gameStates, resolveState, stateNote } from '@/lib/sports/shared/gameResearch';
import type { GameResearchData, GameState } from '@/lib/sports/shared/gameResearchShapes';
import type { ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';
import { toStartsAt } from '@/lib/sports/shared/startsAt';
import type { RecentGameResult, InjuryEntry } from '@/lib/sports/mlb/statsapi';
import type { GameHeroTeamPanelData, GameHeroModel, VenueForecastData } from '@/components/GameHeroCard';
import type { PitchingMatchupGame } from '@/components/PitchingMatchupCard';
import type { TeamBullpen } from '@/components/useBullpen';
import type { BatterPitcherMatchupProps } from '@/components/BatterPitcherMatchupCard';
import type { NflPlayerVsDefenseCardProps } from '@/components/NflPlayerVsDefenseCard';
import type { OpposingStarterStat } from '@/components/PlayerDetail';
import { teamSeasonStatRows } from './statRowAdapter';
import type { UnitGrade } from '@/lib/sports/shared/unitGrades';
import type { PickCandidate } from '@/lib/core/types';
import type { UnifiedGameLine } from '@/lib/odds/types';
import type { GameContextState } from '@/components/useGameContext';
import type { GamePickView } from '@/components/useGamePickRecord';
import { projectLine } from '@/lib/odds/display';
import { toGameHeroModel, toGameHeroTeamPanelData, toVenueForecast } from './gameHeroCardAdapter';
import { unitGradeFromRanked } from '@/lib/sports/shared/unitGrades';
import type { TeamStatcastState } from '@/components/useTeamStatcast';
import { toPriceRange } from '@/lib/sports/shared/priceRange';
import { toGameTeamForm } from '@/lib/sports/shared/gameTeamForm';

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
 * The team stat comparison — one shape, ranked rows.
 *
 * PHASE 6.2 COLLAPSED THIS. It used to carry two mutually exclusive arrays,
 * `bars` (MLB's away/home magnitude bars) and `ranked` (NFL's rows with each
 * side's league rank attached), and `CLAUDE.md` §4 cited the pair as its model
 * case for "genuinely different UI gets named mutually-exclusive fields".
 *
 * Measured, it was not a genuine difference — it was the "leftover placement
 * accident from the port" that same §4 warns about two paragraphs later. MLB
 * was ported first and got bars; NFL came second and added a second shape
 * rather than adopting the first. **MLB was the only sport that ever filled
 * `bars`**, and MLB's own `forRanks` already carried the ranks the other shape
 * needs — the data to render ranked rows was sitting right beside the bars the
 * whole time.
 *
 * A magnitude bar also says less: it shows the two teams' gap against each
 * other but not whether either is any good. "4.6 runs/game, 3rd of 30" is a
 * strictly stronger read than a bar that is 8% longer than the other bar.
 *
 * §4's replacement example is `pregameLines.moneyline.draw` — soccer's real
 * third outcome, which is genuinely earned.
 */
/** The 30 MLB clubs — the pool both the stat comparison and the rankings section rank against. One constant so the two cannot disagree about the size of the league. */
const MLB_TEAM_COUNT = 30;

export interface StatComparisonData {
  awayAbbr: string;
  homeAbbr: string;
  /**
   * Which season these ranks are FROM, e.g. `2025`. Rendered beside the
   * heading when present.
   *
   * NOT COSMETIC. `computeSeasonAggregates` falls back a season when the
   * newest one has no pool yet, which is the normal state of CFB and soccer in
   * August -- so a page can legitimately show last season's ranks beside this
   * season's odds. Unlabelled, that reads as a claim about today. Omitted by a
   * sport whose ranks come from a live in-season index instead.
   */
  seasonLabel?: string;
  /** Grouped by the sport's own categories: MLB's Batting/Rate, NFL's Scoring/Passing/Rushing/Receiving/Defense. `away` is optional — a stat one side has no ranked value for renders one-sided rather than dropping the row. */
  ranked: Array<{ label: string; rows: Array<{ key: string; label: string; away?: OpposingStarterStat; home: OpposingStarterStat }> }>;
}

export interface RankingsData {
  away: RankableTeamStats;
  home: RankableTeamStats;
  /** Which season these ranks are from -- see `StatComparisonData.seasonLabel`. */
  seasonLabel?: string;
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
    /** The start as ISO with a time, or `null` when unknown. Splits pre-game from in-game odds history (R2). */
    startsAt: string | null;
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
  /**
   * PHASE 6.20 -- book price dispersion for this game, the board's price card.
   * Built by every sport from the SAME `gameLine` each adapter already
   * receives, so it costs no new fetch. `null` under three priced books, which
   * is NBA and NHL always (zero rows in `game_odds_book_lines`) and NFL, CFB
   * and tennis on most games.
   */
  /**
   * PHASE 6.21 -- the HOME team's form against tonight's number, for the
   * board's situational grid and key-numbers rail.
   *
   * Home rather than both, because the board draws one ("NYY run line - cover
   * form", and NYY is the home side of its mockup). Built from
   * `RecentResultRow`, which every game adapter already produces for the
   * last-five block, so all seven sports use ONE builder instead of five
   * differently-named team-candidate functions -- see `gameTeamForm.ts`.
   */
  homeTeamForm?: import('@/lib/sports/shared/teamRoles').TeamRoles;
  priceRange?: import('@/lib/sports/shared/priceRange').PriceRangeData | null;
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
  /**
   * Both teams' season-wide Statcast rollups (`useTeamStatcast`), Phase 6.15 —
   * the same per-team payload MLB's TEAM page has graded HIT/PIT from since
   * 6.1. The game page nulled `unitGrades` purely because nothing fetched the
   * second team's copy, so one page graded a team and the other said it could
   * not.
   */
  awayStatcast: TeamStatcastState;
  homeStatcast: TeamStatcastState;
}

/** One side's HIT/PIT grades — the same two units MLB's team page composites, from the same rollup. */
function mlbSideGrades(statcast: TeamStatcastState): UnitGrade[] | null {
  const units = [
    unitGradeFromRanked({ key: 'hitting', label: 'Hitting', short: 'HIT' }, statcast.hitting),
    unitGradeFromRanked({ key: 'pitching', label: 'Pitching', short: 'PIT' }, statcast.pitching),
  ].filter((u): u is UnitGrade => u != null);
  return units.length > 0 ? units : null;
}


export function toGameDetailData(input: MlbGameDetailInput): GameDetailData {
  const { game, statKeys, gameContext, bullpen, gameLine, trustedMarkets, gamePick, pickLoading, candidates, awayStatcast, homeStatcast } = input;
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
    startsAt: toStartsAt(game.firstPitch),
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

  // Stat comparison — Phase 6.2. Was `bars` (magnitude bars, MLB the only
  // sport that ever filled them); now ranked rows, the one shape. The ranks
  // are not new data: `game.away.forRanks` is the same map the `rankings`
  // section below already renders from, and it sat beside `forStats` here the
  // whole time. MLB's pool is the 30 teams.
  //
  // A key with a value but no rank is dropped rather than shown with a made-up
  // rank — `OpposingStarterStat` has no "unranked" state, and a fabricated one
  // would read as a real placing.
  // `teamSeasonStatRows` is the existing canonical `forStats`/`forRanks` ->
  // `OpposingStarterStat[]` converter (it already parses `forRanks`' ordinal
  // strings -- "28th" -> 28 -- and drops any key without both a value and a
  // rank). Reused here rather than rewritten: it was written to kill exactly
  // this duplication once already, when TeamDetail and PlayerDetail each had
  // their own byte-identical copy.
  const battingKeys = statKeys.filter((k) => k.decimals !== 3);
  const rateKeys = statKeys.filter((k) => k.decimals === 3);
  const awayRowsByKey = new Map(teamSeasonStatRows(game.away, statKeys, MLB_TEAM_COUNT).map((r) => [r.key, r]));
  const homeRowsByKey = new Map(teamSeasonStatRows(game.home, statKeys, MLB_TEAM_COUNT).map((r) => [r.key, r]));
  const toRankedGroup = (keys: StatKeyDef[], label: string) => {
    const rows = keys
      .map((k) => {
        const home = homeRowsByKey.get(k.key);
        if (!home) return null;
        return { key: k.key, label: k.label, away: awayRowsByKey.get(k.key), home };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
    return rows.length > 0 ? { label, rows } : null;
  };
  const statComparison: StatComparisonData = {
    awayAbbr,
    homeAbbr,
    ranked: [toRankedGroup(battingKeys, 'Batting'), toRankedGroup(rateKeys, 'Rate')].filter(
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
    poolSize: MLB_TEAM_COUNT,
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
    // Phase 6.15 — HIT/PIT per side, from the identical `unitGradeFromRanked`
    // call MLB's team page makes. `null` per side while that side's rollup is
    // still loading or has no ranked tiles, so the table renders one side or
    // an empty state rather than a half-graded row.
    unitGrades: {
      away: mlbSideGrades(awayStatcast),
      home: mlbSideGrades(homeStatcast),
      awayAbbr,
      homeAbbr,
    },
    injuries,
    // Phase 6.21 -- the home side's form against tonight's number. The
    // spread is signed as a book writes it; `gameTeamForm.ts` turns that
    // into the cover threshold, and falls back to win/loss when no
    // spread is priced.
    homeTeamForm: toGameTeamForm({
      rows: (homeRecent?.recent ?? []).map(toRecentResultRow),
      teamAbbr: homeAbbr,
      opponentAbbr: awayAbbr,
      spreadPoint: gameLine?.spread?.homePoint ?? null,
    }),
    priceRange: toPriceRange(gameLine, homeAbbr),
    picksPanelGame: toPicksPanelGame(game),
    leftRail: { candidates, goodBetsGated: true, nflTeamScope: null },
  };
}

// ---------------------------------------------------------------------------
// R8.1 — the game research page
// ---------------------------------------------------------------------------

const MLB_MARKET_LABELS: Record<string, string> = {
  hits: 'Hits',
  'total-bases': 'Total bases',
  'home-runs': 'Home runs',
  rbis: 'RBIs',
  runs: 'Runs',
  walks: 'Walks',
  'batter-strikeouts': 'Strikeouts (batter)',
  doubles: 'Doubles',
  triples: 'Triples',
  'stolen-bases': 'Stolen bases',
  singles: 'Singles',
  'hits-runs-rbis': 'Hits + runs + RBIs',
  'pitcher-strikeouts': 'Strikeouts (pitcher)',
  'pitcher-outs': 'Outs recorded',
  'earned-runs': 'Earned runs',
  'pitcher-hits-allowed': 'Hits allowed',
  'pitcher-walks': 'Walks allowed',
};

const HIT_EVENTS = new Set(['single', 'double', 'triple', 'home_run']);
const am = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
const halfLabel = (ab: AtBat) => `${ab.half === 'top' ? 'Top' : 'Bot'} ${ab.inning ?? ''}`.trim();
const mlbHeadshot = (id: number | string) => `https://img.mlbstatic.com/mlb-photos/image/upload/w_80,q_auto:best/v1/people/${id}/headshot/67/current`;

/**
 * MLB's game page for one state — R8.1. `requestedState` is the `?state=`
 * review override; the payload's own state is used unless the game can show
 * the one asked for (`resolveState`).
 */
export function toGameResearchData(input: { payload: MlbGameResearchPayload; requestedState?: string | null }): GameResearchData {
  const { payload } = input;
  const state = resolveState(payload, input.requestedState);
  const chips = mlbLineChips(payload, state);
  const sections: ResearchSection[] =
    state === 'pre' || state === 'postponed'
      ? mlbPreSections(payload, state)
      : [
          mlbFlowSection(payload),
          mlbContactSection(payload),
          mlbAtBatSection(payload),
          mlbPitchingSection(payload),
          mlbBoxSection(payload),
          mlbLinesSection(payload, state),
          mlbPlaysSection(payload),
        ].filter((s): s is ResearchSection => s !== null);
  return {
    state,
    states: gameStates(payload.state),
    hero: buildGameHero(payload, state, chips),
    stateNote: stateNote(state, payload.state),
    sections,
    sources: payload.sources,
  };
}

function closeOf(payload: MlbGameResearchPayload, market: 'moneyline' | 'spread' | 'total') {
  return payload.mlb.lines.find((l) => l.market === market)?.close ?? null;
}

/** Closing lines, and once final what the game did against them: "KC +1.5 covered", "Total 8.5 · under". */
export function mlbLineChips(payload: MlbGameResearchPayload, state: GameState): GameResearchData['hero']['chips'] {
  const out: GameResearchData['hero']['chips'] = [];
  const final = state === 'final' && payload.away.score != null && payload.home.score != null;
  const a = payload.away.score ?? 0;
  const h = payload.home.score ?? 0;
  const ml = closeOf(payload, 'moneyline');
  if (ml) {
    const pa = ml.sides.find((s) => s.side === 'away')?.americanOdds;
    const ph = ml.sides.find((s) => s.side === 'home')?.americanOdds;
    out.push({ label: `ML ${payload.away.abbr} ${am(pa)} · ${payload.home.abbr} ${am(ph)}` });
  }
  const rl = closeOf(payload, 'spread');
  const awayRl = rl?.sides.find((s) => s.side === 'away');
  if (awayRl?.point != null) {
    const margin = a - h + awayRl.point;
    const who = `${payload.away.abbr} ${awayRl.point > 0 ? '+' : ''}${awayRl.point}`;
    out.push({ label: final ? `${who} ${margin > 0 ? 'covered' : margin < 0 ? 'did not cover' : 'push'}` : who });
  }
  const tot = closeOf(payload, 'total');
  const point = tot?.sides[0]?.point;
  if (point != null) {
    const sum = a + h;
    out.push({ label: final ? `Total ${point} · ${sum > point ? 'over' : sum < point ? 'under' : 'push'} (${sum})` : `Total ${point}` });
  }
  return out;
}

function mlbFlowSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const m = payload.mlb;
  const byIndex = new Map(m.atBats.map((ab) => [ab.index, ab]));
  const points = m.winProbability.map((w) => ({ w, ab: byIndex.get(w.atBatIndex) })).filter((x): x is { w: MlbWinProbabilityPoint; ab: AtBat } => x.ab != null);
  const base = { id: 'flow', navLabel: 'Game flow', title: 'Game flow', sub: 'win probability after every plate appearance' };
  if (points.length < 2) {
    return { ...base, rows: [], state: { kind: 'empty', title: 'No win probability for this game', reason: 'MLB Stats API publishes it once the game has plate appearances.' } };
  }
  const xLabels = points.map(({ ab }, i) => (i === 0 || ab.inning !== points[i - 1].ab.inning ? String(ab.inning ?? '') : ''));
  const card: ResearchCard = {
    kind: 'series',
    key: 'wp',
    title: `${payload.home.abbr} win probability`,
    scope: `${points.length} plate appearances · x-axis is innings`,
    values: points.map(({ w }) => Math.round(w.home * 1000) / 10),
    xLabels,
    reference: { value: 50, label: 'even' },
    zeroBased: true,
    min: 0,
    max: 100,
    decimals: 0,
    unit: '%',
    tips: points.map(({ w, ab }) => [
      `${payload.home.abbr} ${(w.home * 100).toFixed(0)}%`,
      `${halfLabel(ab)} · ${payload.away.abbr} ${ab.awayScore ?? '—'}–${ab.homeScore ?? '—'} ${payload.home.abbr}`,
      `${ab.batter ?? ''}: ${ab.description ?? ab.event ?? ''}`,
    ]),
    caption: `Above 50 favours ${payload.home.name}, below it ${payload.away.name}. MLB Stats API win probability.`,
  };
  return { ...base, rows: [[card]], state: { kind: 'ready' } };
}

function battedBalls(payload: MlbGameResearchPayload) {
  return payload.mlb.atBats
    .filter((ab) => ab.battedBall?.coordX != null && ab.battedBall?.coordY != null)
    .map((ab) => ({
      ab,
      team: ab.half === 'top' ? payload.away.abbr : payload.home.abbr,
      x: (ab.battedBall!.coordX! - 125.42) * 2.5,
      y: (198.27 - ab.battedBall!.coordY!) * 2.5,
      hit: HIT_EVENTS.has(ab.eventType ?? ''),
    }));
}

function mlbContactSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const balls = battedBalls(payload);
  const base = { id: 'contact', navLabel: 'Batted balls', title: 'Batted balls', sub: 'every ball in play, with exit velocity and distance' };
  if (!balls.length) return { ...base, rows: [], state: { kind: 'empty', title: 'No batted balls located yet', reason: 'The live feed places a ball in play once it is recorded.' } };
  const spray: ResearchCard = {
    kind: 'scatter',
    key: 'spray',
    title: 'Spray chart',
    scope: 'filled = hit · ring = out · size = exit velocity',
    surface: 'spray',
    points: balls.map((b) => [b.team, b.x, b.y]),
    weights: balls.map((b) => b.ab.battedBall?.exitVelocity ?? 70),
    emphasis: balls.map((b) => b.hit),
    tips: balls.map((b) => [
      `${b.ab.event ?? ''} · ${b.ab.batter ?? ''}`,
      halfLabel(b.ab),
      `${b.ab.battedBall?.exitVelocity ?? '—'} mph · ${b.ab.battedBall?.launchAngle ?? '—'}° · ${b.ab.battedBall?.distance ?? '—'} ft`,
      `off ${b.ab.pitcher ?? ''}`,
    ]),
    groups: [payload.away.abbr, payload.home.abbr].map((t) => ({ key: t, label: t, count: balls.filter((b) => b.team === t).length })),
    defaultVisible: [payload.away.abbr, payload.home.abbr],
    caption: 'A generic park outline, not this park’s walls.',
  };
  const longest: ResearchCard = {
    kind: 'table',
    key: 'longest',
    title: 'Longest batted balls',
    scope: 'projected distance',
    labelHeader: 'Batter',
    sortKey: 'dist',
    columns: [
      { key: 'result', label: 'Result', decimals: 0 },
      { key: 'dist', label: 'Ft', decimals: 0 },
      { key: 'ev', label: 'EV', decimals: 1 },
      { key: 'la', label: 'LA', decimals: 0 },
    ],
    rows: balls
      .filter((b) => b.ab.battedBall?.distance != null)
      .sort((x, y) => (y.ab.battedBall!.distance ?? 0) - (x.ab.battedBall!.distance ?? 0))
      .slice(0, 12)
      .map((b) => ({
        key: String(b.ab.index),
        label: b.ab.batter ?? '',
        labelNote: b.team,
        href: b.ab.batterId ? `/mlb/player/${b.ab.batterId}` : null,
        values: { result: b.ab.event, dist: b.ab.battedBall!.distance, ev: b.ab.battedBall!.exitVelocity, la: b.ab.battedBall!.launchAngle },
      })),
  };
  return { ...base, rows: [[spray, longest]], state: { kind: 'ready' } };
}

function mlbAtBatSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const abs = payload.mlb.atBats.filter((ab) => ab.batter);
  const base = { id: 'atbats', navLabel: 'At-bats', title: 'At-bat explorer', sub: 'every pitch, located' };
  if (!abs.length) return { ...base, rows: [], state: { kind: 'empty', title: 'No plate appearances yet', reason: 'The feed lists each plate appearance as it happens.' } };
  const opening = abs.find((ab) => ab.eventType === 'home_run') ?? abs.find((ab) => ab.scoring) ?? abs[0];
  const drill: ResearchCard = {
    kind: 'drilldown',
    key: 'explorer',
    title: 'Plate appearances',
    scope: `${abs.length} · pick one`,
    defaultKey: String(opening.index),
    items: abs.map((ab) => {
      const types = [...new Set(ab.pitches.map((p) => p.type ?? 'unknown'))];
      const bb = ab.battedBall;
      const located = ab.pitches.map((p, i) => ({ p, i })).filter(({ p }) => p.pX != null && p.pZ != null);
      const plot: ResearchCard = {
        kind: 'scatter',
        key: 'zone',
        title: `${ab.batter} vs ${ab.pitcher}`,
        scope: `${halfLabel(ab)} · ${ab.outs ?? 0} out · bats ${ab.bats ?? '—'} / throws ${ab.throws ?? '—'}`,
        surface: 'zone',
        points: located.map(({ p }) => [p.type ?? 'unknown', p.pX!, p.pZ!]),
        labels: located.map(({ i }) => String(i + 1)),
        tips: located.map(({ p, i }) => [`${i + 1}. ${p.typeName ?? p.type ?? 'Pitch'} ${p.speed ?? '—'} mph`, `${p.call ?? ''} · count ${p.balls ?? 0}-${p.strikes ?? 0}`]),
        groups: types.map((t) => ({ key: t, label: ab.pitches.find((p) => (p.type ?? 'unknown') === t)?.typeName ?? t, count: ab.pitches.filter((p) => (p.type ?? 'unknown') === t).length })),
        defaultVisible: types,
        caption: `${ab.event ?? ''} — ${ab.description ?? ''}`,
      };
      const table: ResearchCard = {
        kind: 'table',
        key: 'pitches',
        title: 'Pitches',
        scope: bb ? `${bb.exitVelocity ?? '—'} mph · ${bb.launchAngle ?? '—'}° · ${bb.distance ?? '—'} ft` : undefined,
        labelHeader: '#',
        fixedOrder: true,
        columns: [
          { key: 'type', label: 'Pitch', decimals: 0 },
          { key: 'mph', label: 'mph', decimals: 1 },
          { key: 'call', label: 'Result', decimals: 0 },
          { key: 'count', label: 'Count', decimals: 0 },
        ],
        rows: ab.pitches.map((p, i) => ({ key: String(i), label: String(i + 1), values: { type: p.typeName ?? p.type, mph: p.speed, call: p.call, count: `${p.balls ?? 0}-${p.strikes ?? 0}` } })),
      };
      return {
        key: String(ab.index),
        group: halfLabel(ab),
        label: ab.batter ?? '',
        sub: `${ab.event ?? '…'} · vs ${ab.pitcher ?? ''}`,
        badge: ab.scoring ? `${ab.awayScore}–${ab.homeScore}` : `${ab.pitches.length}p`,
        imageUrl: ab.batterId ? mlbHeadshot(ab.batterId) : null,
        cards: [plot, table],
      };
    }),
  };
  return { ...base, rows: [[drill]], state: { kind: 'ready' } };
}

function mlbPitchingSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const box = payload.mlb.box;
  const base = { id: 'pitching', navLabel: 'Pitching', title: 'Pitching' };
  if (!box) return null;
  const all = [
    ...box.away.pitching.map((p) => ({ p, team: payload.away.abbr })),
    ...box.home.pitching.map((p) => ({ p, team: payload.home.abbr })),
  ];
  const lines: ResearchCard = {
    kind: 'table',
    key: 'lines',
    title: 'Pitching lines',
    scope: 'in the order they pitched',
    labelHeader: 'Pitcher',
    fixedOrder: true,
    columns: [
      { key: 'ip', label: 'IP', decimals: 0 },
      { key: 'h', label: 'H', decimals: 0 },
      { key: 'er', label: 'ER', decimals: 0 },
      { key: 'bb', label: 'BB', decimals: 0 },
      { key: 'k', label: 'K', decimals: 0 },
      { key: 'hr', label: 'HR', decimals: 0 },
      { key: 'ps', label: 'P-S', decimals: 0 },
      { key: 'era', label: 'ERA', decimals: 0, info: 'Season ERA through this game' },
    ],
    rows: all.map(({ p, team }) => ({
      key: `${team}-${p.id}`,
      label: p.name,
      labelNote: [team, p.note].filter(Boolean).join(' '),
      href: `/mlb/player/${p.id}`,
      imageUrl: mlbHeadshot(p.id),
      imageKind: 'player' as const,
      values: { ip: p.s.ip, h: p.s.h, er: p.s.er, bb: p.s.bb, k: p.s.k, hr: p.s.hr, ps: `${p.s.pitches}-${p.s.strikes}`, era: p.season.era },
    })),
  };
  const mixViews = all
    .map(({ p, team }) => ({ p, team, mix: pitchMix(payload.mlb.atBats, p.id) }))
    .filter((v) => v.mix.length)
    .map(({ p, team, mix }) => ({
      key: String(p.id),
      label: `${team} · ${p.name.split(' ').slice(-1)[0]}`,
      labelHeader: 'Pitch',
      columns: [
        { key: 'n', label: 'Thrown', decimals: 0 },
        { key: 'share', label: 'Share', decimals: 0, format: 'percent' as const },
        { key: 'mph', label: 'Avg mph', decimals: 1 },
        { key: 'strike', label: 'Strike %', decimals: 0, format: 'percent' as const, info: 'Called, swinging and foul strikes and balls in play, over pitches' },
      ],
      rows: mix.map((r) => ({ key: r.type, label: r.typeName ?? r.type, values: { n: r.count, share: r.share, mph: r.avgSpeed, strike: 100 * r.strikeRate } })),
    }));
  const rows: ResearchCard[][] = [[lines]];
  if (mixViews.length) {
    rows.push([
      {
        kind: 'table',
        key: 'mix',
        title: 'Pitch mix',
        scope: 'this game, from the pitch feed',
        labelHeader: mixViews[0].labelHeader,
        columns: mixViews[0].columns,
        rows: mixViews[0].rows,
        views: mixViews,
        fixedOrder: true,
      },
    ]);
  }
  return { ...base, rows, state: { kind: 'ready' } };
}

function mlbBoxSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const box = payload.mlb.box;
  if (!box) return null;
  const maxEv = new Map<number, number>();
  for (const ab of payload.mlb.atBats) {
    const ev = ab.battedBall?.exitVelocity;
    if (ab.batterId != null && ev != null) maxEv.set(ab.batterId, Math.max(maxEv.get(ab.batterId) ?? 0, ev));
  }
  const view = (team: typeof box.away, abbr: string) => ({
    key: abbr,
    label: abbr,
    labelHeader: 'Batter',
    columns: [
      { key: 'ab', label: 'AB', decimals: 0 },
      { key: 'r', label: 'R', decimals: 0 },
      { key: 'h', label: 'H', decimals: 0 },
      { key: 'rbi', label: 'RBI', decimals: 0 },
      { key: 'hr', label: 'HR', decimals: 0 },
      { key: 'bb', label: 'BB', decimals: 0 },
      { key: 'k', label: 'K', decimals: 0 },
      { key: 'lob', label: 'LOB', decimals: 0 },
      { key: 'avg', label: 'AVG', decimals: 0, info: 'Season, through this game' },
      { key: 'ops', label: 'OPS', decimals: 0, info: 'Season, through this game' },
      { key: 'ev', label: 'Max EV', decimals: 1 },
    ],
    rows: team.batting.map((b) => ({
      key: String(b.id),
      label: b.name,
      labelNote: `${b.sub ? '↳ ' : ''}${b.pos ?? ''}`,
      href: `/mlb/player/${b.id}`,
      values: { ab: b.s.ab, r: b.s.r, h: b.s.h, rbi: b.s.rbi, hr: b.s.hr, bb: b.s.bb, k: b.s.k, lob: b.s.lob, avg: b.season.avg, ops: b.season.ops, ev: maxEv.get(b.id) ?? null },
    })),
  });
  const views = [view(box.away, payload.away.abbr), view(box.home, payload.home.abbr)];
  return {
    id: 'box',
    navLabel: 'Box score',
    title: 'Box score',
    rows: [[{ kind: 'table', key: 'batting', title: 'Batting', scope: '↳ entered as a substitute', labelHeader: 'Batter', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

function mlbLinesSection(payload: MlbGameResearchPayload, state: GameState): ResearchSection {
  const final = state === 'final';
  const quote = (market: string, s: { point: number | null; americanOdds: number | null } | undefined) =>
    s ? `${s.point != null ? `${market === 'spread' && s.point > 0 ? '+' : ''}${s.point} ` : ''}${am(s.americanOdds)}` : '—';
  const label = (market: string, side: string) =>
    market === 'moneyline' ? `Moneyline · ${side === 'away' ? payload.away.abbr : payload.home.abbr}` : market === 'spread' ? `Run line · ${side === 'away' ? payload.away.abbr : payload.home.abbr}` : `Total · ${side}`;
  const lineRows = payload.mlb.lines.flatMap((l) =>
    (l.close ?? l.open)!.sides.map((s) => ({
      key: `${l.market}-${s.side}`,
      label: label(l.market, s.side),
      values: { open: quote(l.market, l.open?.sides.find((x) => x.side === s.side)), close: quote(l.market, l.close?.sides.find((x) => x.side === s.side)), books: l.close?.books ?? l.open?.books ?? null },
    })),
  );
  const lines: ResearchCard = {
    kind: 'table',
    key: 'game-lines',
    title: 'Game lines',
    scope: 'open to the last quote before the start',
    labelHeader: 'Market',
    fixedOrder: true,
    emptyText: 'No game lines held for this game',
    columns: [
      { key: 'open', label: 'Open', decimals: 0 },
      { key: 'close', label: 'Close', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
    ],
    rows: lineRows,
    caption: 'The main line: nearest even for a total, the most books for the run line, the median price across books.',
  };
  // One book quoting both sides is a price, not a market (+4000 / -20000 on a triple).
  const props = payload.mlb.props.filter((p) => p.books >= 2 && (!final || p.result != null));
  const propsCard: ResearchCard = {
    kind: 'table',
    key: 'props',
    title: final ? 'Props against results' : 'Player props',
    scope: final ? 'main line at the start against the box score' : 'main line, both sides quoted',
    labelHeader: 'Player',
    emptyText: 'No player props held for this game',
    sortKey: final ? undefined : 'books',
    columns: [
      { key: 'market', label: 'Market', decimals: 0, text: true },
      { key: 'line', label: 'Line', decimals: 1 },
      { key: 'over', label: 'Best over', decimals: 0 },
      { key: 'under', label: 'Best under', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
      ...(final ? [{ key: 'result', label: 'Result', decimals: 0 }, { key: 'side', label: 'Went', decimals: 0 }] : []),
    ],
    rows: props.map((p) => ({
      key: `${p.playerId}-${p.market}`,
      label: p.name,
      labelNote: p.side === 'away' ? payload.away.abbr : p.side === 'home' ? payload.home.abbr : null,
      href: `/mlb/player/${p.playerId}`,
      values: {
        market: MLB_MARKET_LABELS[p.market] ?? p.market,
        line: p.line,
        over: p.over ? `${am(p.over.price)} ${p.over.book}` : '—',
        under: p.under ? `${am(p.under.price)} ${p.under.book}` : '—',
        books: p.books,
        result: p.result,
        side: p.result == null ? null : p.result > p.line ? 'Over' : p.result < p.line ? 'Under' : 'Push',
      },
    })),
    caption: [
      payload.mlb.propsAltOnly ? `${payload.mlb.propsAltOnly} markets had only alternate lines quoted` : null,
      'markets with one book quoting both sides',
    ]
      .filter(Boolean)
      .join(' and ')
      .replace(/^./, (c) => c.toUpperCase()) + ' are left out.',
  };
  return { id: 'lines', navLabel: final ? 'Lines & props' : 'Lines', title: final ? 'Lines & props' : 'Lines', rows: [[lines], [propsCard]], state: { kind: 'ready' } };
}

function mlbPlaysSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const abs = payload.mlb.atBats.filter((ab) => ab.event);
  if (!abs.length) return null;
  const row = (ab: AtBat) => ({
    key: String(ab.index),
    label: ab.batter ?? '',
    labelNote: halfLabel(ab),
    values: { event: ab.event, detail: ab.description, score: `${ab.awayScore ?? '—'}–${ab.homeScore ?? '—'}` },
  });
  const columns = [
    { key: 'event', label: 'Result', decimals: 0, text: true },
    { key: 'detail', label: 'Play', decimals: 0, text: true },
    { key: 'score', label: `${payload.away.abbr}–${payload.home.abbr}`, decimals: 0 },
  ];
  const views = [
    { key: 'all', label: `Every plate appearance · ${abs.length}`, labelHeader: 'Batter', columns, rows: abs.map(row) },
    { key: 'scoring', label: `Scoring · ${abs.filter((a) => a.scoring).length}`, labelHeader: 'Batter', columns, rows: abs.filter((a) => a.scoring).map(row) },
  ];
  return {
    id: 'plays',
    navLabel: 'Play-by-play',
    title: 'Play-by-play',
    rows: [[{ kind: 'table', key: 'plays', title: 'Plays', labelHeader: 'Batter', columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

/** Before the start (R8.1b builds the research; until then, the lines and props). */
function mlbPreSections(payload: MlbGameResearchPayload, state: GameState): ResearchSection[] {
  return [mlbLinesSection(payload, state)];
}
