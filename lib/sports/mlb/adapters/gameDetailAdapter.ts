import type { GameDetailGame, PicksPanelGame, RecordsSectionTeam, LastFiveGamesTeam, StatKeyDef, RankableTeamStats } from '@/components/GameDetail';
import type { MlbGameResearchPayload } from '@/lib/sports/mlb/gameResearch';
import { pitchMix, type AtBat, type MlbWinProbabilityPoint } from '@/lib/sports/mlb/liveFeedParsers';
import { buildGameHero, gameStates, resolveState, stateNote } from '@/lib/sports/shared/gameResearch';
import type { GameResearchData, GameState } from '@/lib/sports/shared/gameResearchShapes';
import type { ResearchCard, ResearchColumn, ResearchSection, ResearchTableRow } from '@/lib/sports/shared/playerResearchShapes';
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
import type { FormGame } from '@/lib/sports/mlb/gamePregame';
import type { PregameStarter } from '@/lib/sports/mlb/statcastRollupShapes';
import { pitchTypeLabel } from '@/lib/sports/mlb/pitchProfileShapes';
import { TEAM_ABBR_BY_ID } from '@/lib/sports/mlb/teamAliases';
import { ordinal } from '@/lib/sports/shared/teamResearch';
import { liveLineHit } from '@/lib/sports/shared/liveLine';

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
  const wpNow = payload.mlb.winProbability[payload.mlb.winProbability.length - 1];
  if (state === 'live' && wpNow) chips.unshift({ label: `Win probability ${payload.home.abbr} ${Math.round(wpNow.home * 100)}%` });
  const sections: ResearchSection[] =
    state === 'pre' || state === 'postponed'
      ? mlbPreSections(payload, state)
      : state === 'live'
        ? [
            mlbNowSection(payload),
            mlbFlowSection(payload),
            mlbContactSection(payload),
            mlbAtBatSection(payload),
            mlbPitchingSection(payload),
            mlbBoxSection(payload),
            mlbPlaysSection(payload),
            // Lines & props waits for the final: in play, the props tracker and in-game odds say it.
            ...mlbComingInSections(payload, state),
          ].filter((s): s is ResearchSection => s !== null)
      : [
          mlbFlowSection(payload),
          mlbContactSection(payload),
          mlbAtBatSection(payload),
          mlbPitchingSection(payload),
          mlbBoxSection(payload),
          mlbLinesSection(payload, state),
          mlbPlaysSection(payload),
          // The research as it read at the start stays below the recap.
          ...mlbComingInSections(payload, state),
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

// ---------------------------------------------------------------------------
// R8.1b — the research as of the start
// ---------------------------------------------------------------------------

// StatsAPI has called the Athletics ATH since 2025; the shared alias map keeps OAK for older odds feeds.
const teamAbbr = (id: string | number) => (Number(id) === 133 ? 'ATH' : TEAM_ABBR_BY_ID[Number(id)] ?? String(id));
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const lastName = (name: string | null, id: number) => (name ?? '').split(' ').slice(-1)[0] || String(id);

function formRecord(games: FormGame[]) {
  const w = games.filter((g) => g.us > g.them).length;
  return { w, l: games.length - w, diff: games.reduce((a, g) => a + g.us - g.them, 0) };
}

/** Before the start: the matchup, the starters, the players, injuries, the lines. */
function mlbPreSections(payload: MlbGameResearchPayload, state: GameState): ResearchSection[] {
  return [mlbMatchupSection(payload, state), mlbStartersSection(payload), mlbPlayersSection(payload, state), payload.state === 'pre' || payload.state === 'postponed' ? mlbInjuriesSection(payload) : null, mlbLinesSection(payload, state)].filter(
    (s): s is ResearchSection => s !== null,
  );
}

/** Below a live or final game: the same research as it read at the start, under its own ids. Injuries read as rosters stand now, so they stay off. */
function mlbComingInSections(payload: MlbGameResearchPayload, state: GameState): ResearchSection[] {
  return [mlbMatchupSection(payload, state), mlbStartersSection(payload), mlbPlayersSection(payload, state)]
    .filter((s): s is ResearchSection => s !== null)
    .map((s) => ({ ...s, id: `pre-${s.id}`, title: `${s.title} · at the start` }));
}

type Side = MlbGameResearchPayload['away'];

function mlbMatchupSection(payload: MlbGameResearchPayload, state: GameState): ResearchSection {
  const pre = payload.mlb.pregame;
  const { away, home } = payload;
  const rows: ResearchCard[][] = [];

  if (pre.strength.length) {
    const tone = (r: { rank: number; of: number } | null): 'good' | 'bad' | undefined => (!r ? undefined : r.rank <= 10 ? 'good' : r.rank > r.of - 10 ? 'bad' : undefined);
    const view = (bat: Side, arm: Side) => ({
      key: `${bat.abbr}-bats`,
      label: `${bat.abbr} bats vs ${arm.abbr} arms`,
      labelHeader: 'Per game',
      columns: [
        { key: 'prod', label: `${bat.abbr} produce`, decimals: 0 },
        { key: 'prodRank', label: 'Rank', decimals: 0 },
        { key: 'allow', label: `${arm.abbr} allow`, decimals: 0 },
        { key: 'allowRank', label: 'Rank', decimals: 0 },
      ],
      rows: pre.strength.map((r) => {
        const p = r.teams[bat.id]?.produced ?? null;
        const a = r.teams[arm.id]?.allowed ?? null;
        const fmt = (v: number | undefined) => (v == null ? null : `${v.toFixed(r.decimals)}${r.percent ? '%' : ''}`);
        const tones: Record<string, 'good' | 'bad'> = {};
        const pt = tone(p);
        const at = tone(a);
        if (pt) tones.prodRank = pt;
        if (at) tones.allowRank = at;
        return { key: r.key, label: r.label, values: { prod: fmt(p?.value), prodRank: p ? ordinal(p.rank) : null, allow: fmt(a?.value), allowRank: a ? ordinal(a.rank) : null }, tones };
      }),
    });
    const views = [view(away, home), view(home, away)];
    rows.push([
      {
        kind: 'table',
        key: 'strength',
        title: 'Strength vs strength',
        scope: pre.strengthNote ? `${pre.strengthSeason} season` : `${pre.strengthSeason} season, ${state === 'pre' ? 'before today' : 'before this game'}`,
        info: 'Each offense against the pitching and defense it faces. Ranks are across all 30 teams, 1st best for that side: most produced, fewest allowed. Top ten and bottom ten are coloured.',
        caption: pre.strengthNote ?? undefined,
        labelHeader: views[0].labelHeader,
        columns: views[0].columns,
        rows: views[0].rows,
        views,
        fixedOrder: true,
      },
    ]);
  }

  const formCard = (team: Side): ResearchCard => {
    const last = (pre.form[team.id]?.games ?? []).slice(-10);
    const r = formRecord(last);
    return {
      kind: 'histogram',
      key: `form-${team.abbr}`,
      title: `${team.abbr} coming in`,
      scope: last.length ? `last ${last.length}: ${r.w}-${r.l}, run differential ${signed(r.diff)}` : 'no games yet this season',
      bars: last.map((g) => ({
        key: String(g.pk),
        axisLabel: `${g.home ? '' : '@'}${g.opponentAbbr}`,
        value: Math.abs(g.us - g.them) || 0.25,
        highlight: false,
        tone: g.us > g.them ? 'good' : 'bad',
        tip: `${g.us > g.them ? 'W' : 'L'} ${g.us}-${g.them} ${g.home ? 'vs' : '@'} ${g.opponentAbbr} · ${shortDay(g.date)}`,
      })),
      toneLegend: { good: 'won', bad: 'lost' },
      caption: 'Bar height is the margin, oldest on the left.',
    };
  };
  rows.push([formCard(away), formCard(home)]);

  const h = formRecord(pre.h2h);
  rows.push([
    {
      kind: 'table',
      key: 'h2h',
      title: 'Head to head',
      scope: pre.h2h.length ? `${away.abbr} ${h.w}-${h.l} against ${home.abbr} since last season, runs ${signed(h.diff)}` : 'since last season',
      labelHeader: 'Date',
      fixedOrder: true,
      emptyText: `${away.abbr} and ${home.abbr} have not met since last season`,
      columns: [
        { key: 'park', label: 'At', decimals: 0 },
        { key: 'score', label: `${away.abbr}–${home.abbr}`, decimals: 0 },
        { key: 'won', label: 'Won', decimals: 0 },
      ],
      rows: [...pre.h2h].reverse().map((g) => ({
        key: String(g.pk),
        label: new Date(`${g.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
        href: `/mlb/game/${g.pk}`,
        values: { park: g.home ? away.abbr : home.abbr, score: `${g.us}–${g.them}`, won: g.us > g.them ? away.abbr : home.abbr },
      })),
      caption: 'Regular season, newest first.',
    },
  ]);

  return { id: 'matchup', navLabel: 'Matchup', title: 'Matchup', sub: 'strength, form and head to head', rows, state: { kind: 'ready' } };
}

function mlbStartersSection(payload: MlbGameResearchPayload): ResearchSection {
  const base = { id: 'starters', navLabel: 'Starters', title: 'Starters & lineups' };
  const held = payload.mlb.pregame.starters;
  if (!held) {
    return {
      ...base,
      rows: [],
      state: {
        kind: 'empty',
        title: 'No starter research kept for this game',
        reason: 'The Statcast starters card is kept on the morning of a game. It began with games on 2026-09-11 and some days since are missing; this game has none, so its starters and their matchups are not shown.',
      },
    };
  }
  const sides = (['away', 'home'] as const).flatMap((side) => {
    const sp = held.payload.starters[side];
    return sp ? [{ team: payload[side], opp: payload[side === 'away' ? 'home' : 'away'], sp }] : [];
  });
  if (!sides.length) {
    return { ...base, rows: [], state: { kind: 'empty', title: 'No probable starters listed', reason: `Neither team had named a starter when the research was kept (Statcast through ${shortDay(held.asOf)}).` } };
  }
  const asOf = `Statcast through ${shortDay(held.asOf)}`;
  const who = (team: Side, sp: PregameStarter) => `${team.abbr} · ${lastName(sp.name, sp.id)}`;
  const withViews = (card: { key: string; title: string; scope: string; emptyText: string }, views: Array<{ key: string; label: string; labelHeader: string; columns: ResearchColumn[]; rows: ResearchTableRow[]; sortKey?: string }>, fixedOrder = true): ResearchCard => ({
    kind: 'table',
    ...card,
    labelHeader: views[0].labelHeader,
    columns: views[0].columns,
    rows: views[0].rows,
    sortKey: views[0].sortKey,
    views,
    fixedOrder,
  });

  const lineCard: ResearchCard = {
    kind: 'table',
    key: 'starters',
    title: 'Probable starters',
    scope: `${held.season} season · ${asOf}`,
    labelHeader: 'Pitcher',
    fixedOrder: true,
    columns: [
      { key: 'gs', label: 'GS', decimals: 0 },
      { key: 'ip', label: 'IP', decimals: 0 },
      { key: 'era', label: 'ERA', decimals: 2 },
      { key: 'whip', label: 'WHIP', decimals: 2 },
      { key: 'k', label: 'K', decimals: 0 },
      { key: 'bb', label: 'BB', decimals: 0 },
      { key: 'hr', label: 'HR', decimals: 0 },
      { key: 'kbb', label: 'K/BB', decimals: 2 },
    ],
    rows: sides.map(({ team, sp }) => ({
      key: String(sp.id),
      label: sp.name ?? String(sp.id),
      labelNote: [team.abbr, sp.hand ? `${sp.hand}HP` : null].filter(Boolean).join(' · '),
      href: `/mlb/player/${sp.id}`,
      imageUrl: mlbHeadshot(sp.id),
      imageKind: 'player' as const,
      values: { gs: sp.season.gs, ip: sp.season.ip, era: sp.season.era, whip: sp.season.whip, k: sp.season.k, bb: sp.season.bb, hr: sp.season.hr, kbb: sp.season.bb ? sp.season.k / sp.season.bb : null },
    })),
  };

  const logViews = sides.map(({ team, sp }) => ({
    key: String(sp.id),
    label: who(team, sp),
    labelHeader: 'Date',
    columns: [
      { key: 'opp', label: 'Opp', decimals: 0 },
      { key: 'ip', label: 'IP', decimals: 0 },
      { key: 'h', label: 'H', decimals: 0 },
      { key: 'er', label: 'ER', decimals: 0 },
      { key: 'bb', label: 'BB', decimals: 0 },
      { key: 'k', label: 'K', decimals: 0 },
    ],
    rows: [...sp.log].reverse().map(([date, opp, ip, hits, er, bb, k]) => ({ key: date, label: shortDay(date), values: { opp: teamAbbr(opp), ip: ip.toFixed(1), h: hits, er, bb, k } })),
  }));
  const mixViews = sides.map(({ team, sp }) => ({
    key: String(sp.id),
    label: who(team, sp),
    labelHeader: 'Pitch',
    columns: [
      { key: 'share', label: 'Share', decimals: 1, format: 'percent' as const },
      { key: 'velo', label: 'Avg mph', decimals: 1 },
      { key: 'whiff', label: 'Whiff', decimals: 1, format: 'percent' as const, info: 'Swinging strikes over swings' },
      { key: 'n', label: 'Thrown', decimals: 0 },
    ],
    // A pitch the feed left unclassified has no type code; it is not a pitch in the mix.
    rows: sp.mix.filter((x) => x.type && x.type !== '?').map((x) => ({ key: x.type, label: pitchTypeLabel(x.type), values: { share: x.share, velo: x.velo, whiff: x.whiff, n: x.n } })),
  }));
  const vsViews = sides.map(({ opp, sp }) => {
    const hand = sp.hand === 'L' ? 'left' : 'right';
    return {
      key: String(sp.id),
      label: `${opp.abbr} hitters vs ${lastName(sp.name, sp.id)}`,
      labelHeader: 'Hitter',
      sortKey: 'pa',
      columns: [
        { key: 'pa', label: 'PA', decimals: 0, info: 'Season plate appearances' },
        { key: 'avg', label: 'AVG', decimals: 3, format: 'rate3' as const },
        { key: 'obp', label: 'OBP', decimals: 3, format: 'rate3' as const },
        { key: 'slg', label: 'SLG', decimals: 3, format: 'rate3' as const },
        { key: 'hr', label: 'HR', decimals: 0 },
        { key: 'handAvg', label: `AVG v ${sp.hand ?? ''}HP`, decimals: 3, format: 'rate3' as const, info: `Season, against ${hand}-handed pitching` },
        { key: 'handK', label: `K% v ${sp.hand ?? ''}HP`, decimals: 1, format: 'percent' as const, info: `Season strikeout rate against ${hand}-handed pitching` },
        { key: 'xwobacon', label: 'xwOBAcon', decimals: 3, format: 'rate3' as const, info: `Expected wOBA on contact against ${hand}-handers` },
        { key: 'vsSp', label: 'vs him', decimals: 0, info: 'Against this pitcher in the Statcast corpus: hits-at-bats, then home runs and strikeouts' },
      ],
      rows: sp.vsLineup.map((x) => ({
        key: String(x.id),
        label: x.name ?? String(x.id),
        labelNote: [x.pos, x.bats ? `bats ${x.bats}` : null].filter(Boolean).join(' · '),
        href: `/mlb/player/${x.id}`,
        values: {
          pa: x.season.pa,
          avg: x.season.avg,
          obp: x.season.obp,
          slg: x.season.slg,
          hr: x.season.hr,
          handAvg: x.vsHand.pa ? x.vsHand.avg : null,
          handK: x.vsHand.pa ? x.vsHand.k : null,
          xwobacon: x.vsHand.xwobacon,
          vsSp: x.vsPitcher.pa ? [`${x.vsPitcher.h}-${x.vsPitcher.ab}`, x.vsPitcher.hr ? `${x.vsPitcher.hr} HR` : null, x.vsPitcher.k ? `${x.vsPitcher.k} K` : null].filter(Boolean).join(', ') : '—',
        },
      })),
    };
  });

  return {
    ...base,
    rows: [
      [lineCard],
      [
        withViews({ key: 'log', title: 'Recent starts', scope: 'last six appearances, newest first', emptyText: 'No appearances this season' }, logViews),
        withViews({ key: 'mix', title: 'Pitch mix', scope: `season · ${asOf}`, emptyText: 'No pitches in the Statcast corpus' }, mixViews),
      ],
      [withViews({ key: 'vs', title: 'Hitters against the starter', scope: 'the active roster, not the posted lineup', emptyText: 'No hitters on record' }, vsViews, false)],
    ],
    note: sides.length < 2 ? `Only ${sides[0].team.abbr} had named a starter when the research was kept.` : undefined,
    state: { kind: 'ready' },
  };
}

function mlbPlayersSection(payload: MlbGameResearchPayload, state: GameState): ResearchSection | null {
  const m = payload.mlb;
  // One book quoting both sides is a price, not a market (as in Lines & props).
  const props = m.props.filter((p) => p.books >= 2);
  if (!props.length) return null;
  // A player's team: the box once there is one, else the starters card's rosters.
  const sideById = new Map<string, 'away' | 'home'>();
  const probable = m.pregame.starters?.payload.starters;
  for (const side of ['away', 'home'] as const) {
    const sp = probable?.[side];
    if (!sp) continue;
    sideById.set(String(sp.id), side);
    for (const x of sp.vsLineup) sideById.set(String(x.id), side === 'away' ? 'home' : 'away');
  }
  const avg = (gs: Array<[string, number, string]>) => (gs.length ? gs.reduce((a, g) => a + g[1], 0) / gs.length : null);
  const rows: ResearchTableRow[] = props.map((p) => {
    const side = p.side ?? sideById.get(p.playerId) ?? null;
    const opp = side ? payload[side === 'away' ? 'home' : 'away'] : null;
    const games = m.pregame.propHistory[`${p.playerId}|${p.market}`] ?? [];
    const last10 = games.slice(-10);
    const vs = opp ? games.filter((g) => g[2] === opp.id) : [];
    const over = (gs: typeof games) => `${gs.filter((g) => g[1] > p.line).length} of ${gs.length}`;
    return {
      key: `${p.playerId}-${p.market}`,
      label: p.name,
      labelNote: side ? payload[side].abbr : null,
      href: `/mlb/player/${p.playerId}`,
      values: {
        market: MLB_MARKET_LABELS[p.market] ?? p.market,
        line: p.line,
        l10: avg(last10),
        l10Over: last10.length ? over(last10) : '—',
        recent: last10.length ? last10.slice(-5).map((g) => g[1]).join(' ') : '—',
        vs: vs.length ? over(vs) : '—',
        vsAvg: avg(vs),
        books: p.books,
      },
    };
  });
  return {
    id: 'players',
    navLabel: 'Players',
    title: 'Players',
    sub: 'each prop’s main line against the player’s own games',
    rows: [
      [
        {
          kind: 'table',
          key: 'prop-history',
          title: 'Prop lines and history',
          scope: state === 'pre' ? 'games before today' : 'the line at the start, games before this one',
          info: 'Over means above the line. Games are this season and last; the last five read oldest to newest. Against the opponent counts games against the other team here.',
          labelHeader: 'Player',
          sortKey: 'books',
          columns: [
            { key: 'market', label: 'Market', decimals: 0, text: true },
            { key: 'line', label: 'Line', decimals: 1 },
            { key: 'l10', label: 'L10 avg', decimals: 2 },
            { key: 'l10Over', label: 'L10 over', decimals: 0 },
            { key: 'recent', label: 'Last 5', decimals: 0 },
            { key: 'vs', label: 'Over vs opp', decimals: 0 },
            { key: 'vsAvg', label: 'Avg vs opp', decimals: 2 },
            { key: 'books', label: 'Books', decimals: 0 },
          ],
          rows,
          caption: 'Markets with one book quoting both sides are left out.',
        },
      ],
    ],
    state: { kind: 'ready' },
  };
}

/** Injuries read as the rosters stand now, so they show only while the game is still to come — not on a finished game reviewed as ?state=pre. */
function mlbInjuriesSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const inj = payload.mlb.pregame.injuries;
  // StatsAPI's rosters name the list, rarely the injury; the column shows only when one does.
  const described = Object.values(inj).some((list) => list.some((e) => e.injury));
  const view = (team: Side) => ({
    key: team.abbr,
    label: `${team.abbr} · ${(inj[team.id] ?? []).length}`,
    labelHeader: 'Player',
    columns: [
      { key: 'pos', label: 'Pos', decimals: 0 },
      { key: 'status', label: 'Status', decimals: 0, text: true },
      ...(described ? [{ key: 'injury', label: 'Injury', decimals: 0, text: true }] : []),
    ],
    rows: (inj[team.id] ?? []).map((e) => ({ key: String(e.playerId), label: e.playerName, href: `/mlb/player/${e.playerId}`, values: { pos: e.position, status: e.status, injury: e.injury ?? '—' } })),
  });
  const views = [view(payload.away), view(payload.home)];
  if (!views.some((v) => v.rows.length)) return null;
  return {
    id: 'injuries',
    navLabel: 'Injuries',
    title: 'Injuries',
    rows: [[{ kind: 'table', key: 'injuries', title: 'Injured list and day-to-day', scope: 'as the rosters read now', labelHeader: 'Player', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

// ---------------------------------------------------------------------------
// R8.1c — while the game is on
// ---------------------------------------------------------------------------

const etTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

function runners(b: { first: boolean; second: boolean; third: boolean }): string {
  const on = [b.first && '1st', b.second && '2nd', b.third && '3rd'].filter(Boolean) as string[];
  if (!on.length) return 'Bases empty';
  if (on.length === 3) return 'Bases loaded';
  return `${on.length === 1 ? 'Runner' : 'Runners'} on ${on.join(' and ')}`;
}

/** Where the game stands, the at-bat under way, each prop so far, and the books now. */
function mlbNowSection(payload: MlbGameResearchPayload): ResearchSection {
  const m = payload.mlb;
  const live = m.live;
  const rows: ResearchCard[][] = [];

  if (live) {
    const wp = m.winProbability[m.winProbability.length - 1];
    const text = (key: string, label: string, value: string, href?: string | null) => ({ key, label, href: href ?? null, values: { value } });
    const situation: ResearchCard = {
      kind: 'table',
      key: 'situation',
      title: 'The game now',
      scope: `${live.inning.half === 'top' ? 'Top' : 'Bottom'} of the ${live.inning.ordinal}`,
      labelHeader: '',
      fixedOrder: true,
      columns: [{ key: 'value', label: '', decimals: 0, text: true }],
      rows: [
        text('outs', 'Outs', String(live.outs)),
        text('count', 'Count', `${live.count.balls}-${live.count.strikes}`),
        text('bases', 'On base', runners(live.bases)),
        ...(live.batter ? [text('batter', 'At bat', `${live.batter.name} · ${live.batter.todayLine}`, `/mlb/player/${live.batter.id}`)] : []),
        ...(live.pitcher
          ? [text('pitcher', 'Pitching', `${live.pitcher.name} · ${live.pitcher.ip} IP, ${live.pitcher.h} H, ${live.pitcher.r} R, ${live.pitcher.k} K, ${live.pitcher.pitches} pitches`, `/mlb/player/${live.pitcher.id}`)]
          : []),
        ...(live.onDeck ? [text('deck', 'On deck', `${live.onDeck.name} · ${live.onDeck.todayLine}`, `/mlb/player/${live.onDeck.id}`)] : []),
        ...(wp ? [text('wp', 'Win probability', `${payload.home.abbr} ${(wp.home * 100).toFixed(1)}% · ${payload.away.abbr} ${(100 - wp.home * 100).toFixed(1)}%`)] : []),
      ],
    };
    // The plate appearance under way is the feed's last; between batters it is the one just finished.
    const ab = m.atBats[m.atBats.length - 1];
    const located = ab ? ab.pitches.map((p, i) => ({ p, i })).filter(({ p }) => p.pX != null && p.pZ != null) : [];
    const types = ab ? [...new Set(ab.pitches.map((p) => p.type ?? 'unknown'))] : [];
    const last = ab?.pitches[ab.pitches.length - 1];
    const atBat: ResearchCard | null =
      ab && located.length
        ? {
            kind: 'scatter',
            key: 'at-bat',
            title: `${ab.event ? 'Last' : 'Now'}: ${ab.batter} vs ${ab.pitcher}`,
            scope: last ? `last pitch ${last.typeName ?? last.type ?? ''} ${last.speed ?? '—'} mph, ${(last.call ?? '').toLowerCase()}` : undefined,
            surface: 'zone',
            points: located.map(({ p }) => [p.type ?? 'unknown', p.pX!, p.pZ!]),
            labels: located.map(({ i }) => String(i + 1)),
            tips: located.map(({ p, i }) => [`${i + 1}. ${p.typeName ?? p.type ?? 'Pitch'} ${p.speed ?? '—'} mph`, `${p.call ?? ''} · count ${p.balls ?? 0}-${p.strikes ?? 0}`]),
            groups: types.map((t) => ({ key: t, label: ab.pitches.find((p) => (p.type ?? 'unknown') === t)?.typeName ?? t, count: ab.pitches.filter((p) => (p.type ?? 'unknown') === t).length })),
            defaultVisible: types,
            caption: ab.event ? `${ab.event}: ${ab.description ?? ''}` : 'Catcher’s view. Numbers are the pitch order.',
          }
        : null;
    rows.push(atBat ? [situation, atBat] : [situation]);
  }

  // Props tracker: each main line at the start against the player's number so far.
  const held = m.props.filter((p) => p.books >= 2);
  const tracked = held
    .filter((p) => p.result != null)
    .map((p) => ({ p, so: p.result!, share: p.result! / Math.max(p.line, 0.5) }))
    .sort((a, b) => b.share - a.share || a.p.name.localeCompare(b.p.name));
  rows.push([
    {
      kind: 'table',
      key: 'props-tracker',
      title: 'Props tracker',
      scope: held.length ? `${tracked.length} of ${held.length} markets have played` : undefined,
      info: 'The main line at the start against the box score so far. An over is marked once the number passes the line; an under cannot be settled until the game ends.',
      labelHeader: 'Player',
      fixedOrder: true,
      emptyText: held.length ? 'No player with a prop has appeared yet' : 'No player props held for this game',
      columns: [
        { key: 'market', label: 'Market', decimals: 0, text: true },
        { key: 'line', label: 'Line', decimals: 1 },
        { key: 'so', label: 'So far', decimals: 0 },
        { key: 'status', label: 'Status', decimals: 0, text: true },
      ],
      rows: tracked.map(({ p, so }) => {
        const over = liveLineHit('O', so, p.line);
        const row: ResearchTableRow = {
          key: `${p.playerId}-${p.market}`,
          label: p.name,
          labelNote: p.side ? payload[p.side].abbr : null,
          href: `/mlb/player/${p.playerId}`,
          values: { market: MLB_MARKET_LABELS[p.market] ?? p.market, line: p.line, so, status: over ? 'Over already' : `${Math.floor(p.line - so) + 1} more to go over` },
        };
        if (over) row.tones = { status: 'good' };
        return row;
      }),
    },
  ]);

  // In-game odds.
  const inGame = live?.inGame;
  if (inGame) {
    const close = (market: string) => m.lines.find((l) => l.market === market)?.close ?? null;
    const quote = (market: string, s: { point: number | null; americanOdds: number | null } | undefined) =>
      s ? `${s.point != null ? `${market === 'spread' && s.point > 0 ? '+' : ''}${s.point} ` : ''}${am(s.americanOdds)}` : '—';
    const sideLabel = (market: string, side: string) =>
      market === 'moneyline' ? `Moneyline · ${payload[side as 'away' | 'home'].abbr}` : market === 'spread' ? `Run line · ${payload[side as 'away' | 'home'].abbr}` : `Total · ${side}`;
    const lineRows = inGame.now.flatMap((n) =>
      (n.line?.sides ?? []).map((s) => ({
        key: `${n.market}-${s.side}`,
        label: sideLabel(n.market, s.side),
        values: { close: quote(n.market, close(n.market)?.sides.find((x) => x.side === s.side)), now: quote(n.market, s), books: n.line?.books ?? null, at: etTime(n.asOf) },
      })),
    );
    const asOf = inGame.now.map((n) => n.asOf).sort().pop();
    // Captures land about every fifteen minutes; say how much of the game has happened since.
    // A plate appearance's score counts once the next one has begun: the feed stamps starts, not ends, and
    // 822763's run at 4:21 came in an at-bat that began before the 4:20 capture.
    let scoreThen = 0;
    m.atBats.forEach((ab, i) => {
      const ended = m.atBats[i + 1]?.startTime;
      if (asOf && ended && ended <= asOf && ab.awayScore != null && ab.homeScore != null) scoreThen = ab.awayScore + ab.homeScore;
    });
    const runsSince = asOf ? (payload.away.score ?? 0) + (payload.home.score ?? 0) - scoreThen : 0;
    const linesNow: ResearchCard = {
      kind: 'table',
      key: 'lines-now',
      title: 'Lines now',
      scope: asOf ? `latest capture ${etTime(asOf)} ET${runsSince > 0 ? ` · ${runsSince} ${runsSince === 1 ? 'run has' : 'runs have'} scored since` : ''}` : 'since the first pitch',
      labelHeader: 'Market',
      fixedOrder: true,
      emptyText: 'No prices captured since the first pitch',
      columns: [
        { key: 'close', label: 'At the start', decimals: 0 },
        { key: 'now', label: 'Now', decimals: 0 },
        { key: 'books', label: 'Books', decimals: 0 },
        { key: 'at', label: 'Captured', decimals: 0 },
      ],
      rows: lineRows,
      caption: 'Each market from its latest capture only, however few books it holds: prices are captured about every fifteen minutes during a game, not pitch by pitch, and an older price from another book is not current.',
    };
    const ml = inGame.moneyline;
    const trend: ResearchCard =
      ml.length >= 2
        ? {
            kind: 'series',
            key: 'ml-trend',
            title: `${payload.home.abbr} moneyline chance`,
            scope: `${ml.length} captures since the first pitch`,
            values: ml.map((x) => Math.round(x.homePct * 10) / 10),
            xLabels: ml.map((x, i) => (i === 0 || i === ml.length - 1 ? etTime(x.t) : '')),
            reference: { value: 50, label: 'even' },
            zeroBased: true,
            min: 0,
            max: 100,
            decimals: 0,
            unit: '%',
            tips: ml.map((x) => [`${payload.home.abbr} ${x.homePct.toFixed(1)}%`, `${etTime(x.t)} ET · ${x.books === 1 ? 'one book' : `${x.books} books, median`}, vig removed`]),
            caption: 'Each book’s two moneyline prices with the vig taken out, then the median across books.',
          }
        : {
            kind: 'status',
            key: 'ml-trend',
            title: `${payload.home.abbr} moneyline chance`,
            headline: ml.length ? 'One capture so far' : 'No captures yet',
            reason: 'Prices are captured about every fifteen minutes; the trend draws from the second capture.',
          };
    rows.push([linesNow, trend]);
  }

  return { id: 'now', navLabel: 'Right now', title: 'Right now', sub: 'refreshed every 15 seconds', rows, state: { kind: 'ready' } };
}
