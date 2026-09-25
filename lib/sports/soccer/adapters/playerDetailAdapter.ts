/**
 * `PlayerDetail.tsx` adapter — soccer half.
 *
 * Real per-match history now exists for the markets `lib/sports/soccer/adapter.ts`'s
 * `HISTORY_FIELD` covers (anytime-goalscorer, two-plus-goals, shots, assists,
 * goals-assists — see that file's header for why only these), sourced from
 * Understat (EPL) / American Soccer Analysis (MLS). `windows`/`chart`/`gamelog`
 * below are the same windowed-stat engine NFL's adapter uses, scoped the same
 * way (opponent-only + lastN — soccer has no venue filter, matching NFL, since
 * `raw.isHome` isn't surfaced as a UI filter chip here either). A candidate
 * outside `HISTORY_FIELD`'s coverage (first/last-goalscorer, shots-on-target,
 * tackles, passes/dribbles/crosses-attempted, yellow-cards, saves) still
 * arrives with `history: []` — real "no source yet" for that specific market,
 * not fabricated.
 *
 * `nflMatchup`/`nflSeasonStats` (2026-08-23): despite the field names, both
 * are sport-agnostic in shape (`NflPlayerVsDefenseCardProps`/plain ranked
 * rows) — reused directly rather than forking a `soccerMatchup` type, since
 * the UI concept is genuinely the same, just populated with real goals/xG
 * instead of rush yards (CLAUDE.md's sport-adapter rule 4: reuse when
 * genuinely the same shape, branch only when genuinely different). Built
 * from real Understat season aggregates + real per-team goals-against rate
 * (`adapter.ts`'s `attachRealHistory`, which already attaches
 * `subjectMeta.seasonStats`/`.seasonRank`/`.opponentDefense`) — EPL only for
 * now, MLS's equivalent needs ASA's own team-season endpoint wired in.
 * `model`/`hitterStats` stay `null` — no grading/ranking model for soccer yet.
 *
 */

import type { UnifiedGameLine } from '@/lib/odds/types';
import { gamePkOf, gameSideOf, todaysLineFromGameLines } from '@/lib/sports/shared/todaysLine';
import type { PlayerPool } from '@/lib/sports/shared/playerPool';
import type { PlayerBio, PlayerHistory, PlayerResearchData } from '@/lib/sports/shared/playerResearchShapes';
import { buildPlayerResearch } from '@/lib/sports/shared/playerResearch';
import { soccerResearchSpec } from './playerResearchSpec';
import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow, UNDER } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import { repriceAtMainLine } from '@/lib/odds/props/mainLine';
import { soccerChancesSection, soccerKeeperSection, type SoccerChancesInput } from '@/lib/sports/soccer/playerUnderstatShapes';
import type { PropOddsRow } from '@/lib/db/client';
import { marketText } from '@/components/MarketLabel';
import { toVenueBinarySplit } from '@/lib/sports/shared/venueSplit';
import { toRoleStat, type OpponentUnitRole } from '@/lib/sports/shared/playerRoles';
import type { ChipDef, GameStateSlot, PlayerDetailChart, PlayerDetailData, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
import { toCareerH2H } from '@/lib/sports/shared/careerH2H';
import { isTeamNameMatch } from '@/lib/sports/shared/teamNameMatch';
interface SoccerOpponentDefense {
  teamTitle: string;
  gamesPlayed: number;
  goalsAgainstPerGame: number;
  xGAPerGame: number;
  goalsForPerGame: number;
  rank: number;
  poolSize: number;
}

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

export interface SoccerPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
}

export interface SoccerPlayerDetailInput {
  /**
   * `useSoccerLiveGame(...)`'s result — C4's game state (R6.3). Structural, not
   * an import of the hook's type, so this file stays a pure transform.
   */
  live?: { data: import('@/lib/sports/soccer/liveGame').SoccerLiveGameDetail | null; loading: boolean };
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: SoccerPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
  /** `useGameLines(sport)`'s lines: the player's game's line (P1). */
  gameLines?: readonly UnifiedGameLine[] | null;
}

/**
 * C8 (operator decision 4) — which market a soccer player's page opens on.
 *
 * Every other sport's candidate list is already ordered by how much the page
 * has to say about it; soccer's is ordered by the slate, so a striker opened on
 * "Passes Attempted" whenever a book happened to price it first. A keeper's
 * market is saves, a defender's tackles, a midfielder's shots on target and a
 * forward's anytime goalscorer; anything not listed keeps the order it came in.
 */
const MARKET_BY_POSITION: Record<string, string[]> = {
  G: ['saves'],
  GK: ['saves'],
  D: ['tackles', 'shots'],
  DEF: ['tackles', 'shots'],
  M: ['shots-on-target', 'shots', 'assists'],
  MID: ['shots-on-target', 'shots', 'assists'],
  F: ['anytime-goalscorer', 'shots-on-target', 'shots'],
  FWD: ['anytime-goalscorer', 'shots-on-target', 'shots'],
};

export function preferredSoccerMarket(position: string | null | undefined, dimensions: readonly string[]): string | undefined {
  for (const wanted of MARKET_BY_POSITION[(position ?? '').toUpperCase()] ?? []) {
    if (dimensions.includes(wanted)) return wanted;
  }
  return undefined;
}

export function toPlayerDetailData(input: SoccerPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, scope, propOdds } = input;

  const preferred = preferredSoccerMarket(
    typeof (candidates[0]?.subjectMeta as Record<string, unknown> | undefined)?.position === 'string'
      ? ((candidates[0]!.subjectMeta as Record<string, unknown>).position as string)
      : null,
    candidates.map((c) => c.dimension),
  );
  const active =
    candidates.find((c) => c.dimension === market) ?? (preferred ? candidates.find((c) => c.dimension === preferred) : undefined) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const teamAbbr = typeof meta.team === 'string' ? meta.team : undefined;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  // Real team name (Understat/ASA's own opponent identifier, e.g. "Newcastle
  // United") — history entries' `raw.opponentAbbr` carries this same real
  // name despite its field name (see adapter.ts's comment), never the ESPN
  // abbreviation `opponentAbbr` above holds. Filtering/H2H below must
  // compare against this, or every comparison silently fails.
  const opponentName = typeof meta.opponentName === 'string' ? meta.opponentName : undefined;
  const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;
  const teamLogoUrl = typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined;
  const opponentLogoUrl = typeof meta.opponentLogoUrl === 'string' ? meta.opponentLogoUrl : undefined;

  const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{
    gamePk: string;
    firstPitch?: string;
  }>;
  const todaysGame = games.find((g) => String(g.gamePk) === String(meta.gamePk));

  // ---- The line (R6-F9) ----
  // The candidate's line is the main line as it stood when the snapshot was
  // built; `repriceAtMainLine` is the rule MLB, NFL and CFB already run against
  // the rows the page holds now, so one line is named everywhere on the page.
  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const startIso = todaysGame?.firstPitch ?? null;
  const activeRows =
    activeMarketKey && propOdds ? propOdds.rows.filter((r) => r.subjectId === active.subjectId && r.marketKey === activeMarketKey) : [];
  const { marketLine, priced: priceCandidate } = repriceAtMainLine(active, activeRows, startIso);
  const baseLine = marketLine ?? active.line ?? 0.5;
  const line = Math.max(0, baseLine + scope.lineOffset);
  const wantOver = true; // every soccer market here is "did/will this happen", not a two-sided over/under pick.

  // ---- Scope filters (mirrors NflPlayerDetail's opponent + lastN; no venue filter) ----
  let scoped = active.history;
  if (scope.opponentOnly && opponentName) {
    // NOT `===`. Understat's history says "Leeds"; ESPN's `opponentName` says
    // "Leeds United". Measured on a real page: 0 of 273 entries matched, so
    // this chip, the h2h window and the careerH2H card were all dead. See
    // `teamNameMatch.ts`.
    scoped = scoped.filter((e) => isTeamNameMatch(rawOf(e).opponentAbbr as string | undefined, opponentName));
  }
  if (scope.lastN !== 'all') scoped = scoped.slice(-scope.lastN);

  const measured = categoriseByLine(scoped, line);
  const wanted = wantOver ? OVER : UNDER;

  // Role 2 and 3 | the shot-type mix and the 3x3 shot grid: GONE for soccer
  // (R6.3). Both were built from the same Understat shots "Chances &
  // finishing" now draws in full — every shot at its own place, sized by the
  // chance it was worth, with the body parts as a table beside it. A nine-cell
  // share grid and a slice list said less about the same rows, and the prop
  // block no longer repeats them (the same removal NFL's target grid got in
  // R6.2).
  const usageMix = null;
  const spatialGrid = null;

  const binarySplit = toVenueBinarySplit({
    measured: categoriseByLine(active.history, line),
    wanted,
    statLabel: marketText('soccer', active.dimension),
  });

  const windows: WindowedStat5 = {
    l5: fixedWindow(measured, wanted, 5),
    l10: fixedWindow(measured, wanted, 10),
    l15: fixedWindow(measured, wanted, 15),
    szn: openWindow(measured, wanted, { minimum: 1 }),
    h2h:
      !opponentName
        ? { status: 'insufficient', available: 0, required: 1 }
        : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => isTeamNameMatch(rawOf(e).opponentAbbr as string | undefined, opponentName), { minimum: 1 }),
  };

  // ---- Role 6 | careerH2H (6.13). NOT a second copy of the h2h window box:
  // that reports one rate, this reports the per-MEETING history behind it.
  // "3 of 5" and "3 of 5, all three in one season" are different facts and a
  // single rate cannot tell them apart. Same opponent predicate `windows.h2h`
  // uses above -- deliberately the same expression, so the two can never
  // disagree about who the opponent is.
  const careerH2H = opponentName
    ? toCareerH2H({
        measured: categoriseByLine(active.history, line),
        wanted,
        isVsOpponent: (e) => isTeamNameMatch(rawOf(e).opponentAbbr as string | undefined, opponentName),
        opponentLabel: `vs ${opponentName}`,
        statLabel: marketText('soccer', active.dimension),
      })
    : null;

  const chips: ChipDef[] = [
    ...(opponentAbbr ? [{ key: 'opponent', label: `vs ${opponentAbbr}` }] : []),
    { key: 'lastN:5', label: 'Last 5' },
    { key: 'lastN:10', label: 'Last 10' },
    { key: 'lastN:15', label: 'Last 15' },
    { key: 'lastN:all', label: 'All games' },
  ];

  // Real opponent logo — `toHistoryEntries` (adapter.ts) now embeds
  // `opponentLogoUrl` via `soccerTeamLogoByName`/`matchSoccerTeamLogo`; this
  // just reads it (2026-08-24 fix — soccer's chart/gamelog never had
  // opponent logos before).
  const logoFor = (entry: PickCandidate['history'][number]) => rawOf(entry).opponentLogoUrl as string | undefined;

  const chart: PlayerDetailChart =
    scoped.length > 0
      ? {
          kind: 'distribution',
          title: `${scoped.length} game${scoped.length === 1 ? '' : 's'} in scope`,
          subtitle: `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
          data: scoped,
          line,
          wantOver,
          logoFor,
        }
      : {
          kind: 'distribution',
          title: '0 games in scope',
          subtitle: active.history.length === 0 ? 'No per-match history source yet for this market' : `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
          data: [],
          line,
          wantOver,
          logoFor,
        };

  // ---- C4 game state (R6.3) ----
  // Soccer's live feed carries the score, the clock and the key events, and no
  // per-player stats at all (operator decision 5), so the card's own band says
  // so rather than sitting empty.
  const live = input.live?.data ?? null;
  const gameState: GameStateSlot | null =
    live && live.state === 'in'
      ? {
          status: 'live',
          away: { abbr: live.awayAbbr, logoUrl: live.awayAbbr === opponentAbbr ? opponentLogoUrl : teamLogoUrl, score: live.awayScore },
          home: { abbr: live.homeAbbr, logoUrl: live.homeAbbr === opponentAbbr ? opponentLogoUrl : teamLogoUrl, score: live.homeScore },
          periodLabel: live.clockDisplay ?? live.statusDetail,
          subjectLine: null,
          notHeld: 'Per-player live stats are not held for soccer: the feed carries the score, the clock, goals and cards.',
          lines: [],
          events: [...(live.events ?? [])]
            .slice(-4)
            .reverse()
            .map((e) => ({ clock: e.clockDisplay, text: `${e.typeText}${e.description ? ` — ${e.description}` : ''}` })),
          // The route is `/soccer/{league}/game/{id}`; the league is the one
          // the subject's own candidate carries.
          gameHref: todaysGame?.gamePk && typeof meta.league === 'string' ? `/soccer/${meta.league}/game/${todaysGame.gamePk}` : null,
        }
      : input.live?.loading && startIso != null && Date.now() >= Date.parse(startIso)
        ? { status: 'loading', away: { abbr: 'Away', score: null }, home: { abbr: 'Home', score: null }, periodLabel: null, subjectLine: null, lines: [], events: [], gameHref: null }
        : null;


  // ---- Real season totals + opponent defense (Understat, EPL) ----
  const opponentDefense = meta.opponentDefense as SoccerOpponentDefense | undefined;

  // ---- Role 1 | opponentUnit: the back line and keeper this player faces.
  // `meta.opponentDefense` is already attached by `adapter.ts`'s
  // attachRealHistory from real Understat team-season aggregates -- the same
  // two numbers the matchup card below already draws, reduced to the one
  // opponent and named as a unit.
  //
  // EPL ONLY, and that is a sourcing fact rather than a bug: MLS's equivalent
  // needs ASA's team-season endpoint, which is not wired. An MLS subject gets
  // no `opponentDefense` and this renders nothing.
  //
  // LOWER IS BETTER on both rows -- these are goals and xG ALLOWED, so the
  // heat would read backwards without saying so.
  const opponentUnit: OpponentUnitRole | null =
    opponentDefense && opponentName
      ? {
          title: 'Opposing defense',
          name: `${opponentName} defense`,
          subtitle: 'Allows',
          logoUrl: opponentLogoUrl,
          stats: [
            toRoleStat(
              { key: 'goalsAllowed', label: 'Goals allowed/gm', value: opponentDefense.goalsAgainstPerGame, decimals: 2, rank: opponentDefense.rank, poolSize: opponentDefense.poolSize },
              { lowerIsBetter: true },
            ),
            toRoleStat(
              { key: 'xgAllowed', label: 'xG allowed/gm', value: opponentDefense.xGAPerGame, decimals: 2, rank: opponentDefense.rank, poolSize: opponentDefense.poolSize },
              { lowerIsBetter: true },
            ),
          ],
          emptyMessage: 'No defensive record for this opponent yet.',
        }
      : null;

  return {
    // P1 (odds workstream): the player's game's line, from /api/odds/lines.
    gameLine: todaysLineFromGameLines(input.gameLines, gamePkOf(active), gameSideOf(active)),
    opponentUnit,
    usageMix,
    careerH2H,

    spatialGrid,
    binarySplit,
    subject: {
      subjectId: active.subjectId,
      name: active.subjectName,
      headshotUrl,
      teamAbbr,
      teamLogoUrl,
      position: undefined,
      rankPrefix: '',
      opponentAbbr,
      opponentLogoUrl,
      gameStartTime: todaysGame?.firstPitch ?? null,
      gameStatus: null,
    },
    candidates,
    market: active.dimension,
    chips,
    windows,
    chart,
    formWindows: active.supportingSplits ?? null,
    lineControl: { kind: 'stepper', line, baseLine, wantOver },
    priceCandidate,
    gameState,
    // No player-level live data source — ESPN's soccer summary endpoint
    // carries no `boxscore.players` for this sport (verified live, see
    // lib/sports/soccer/liveGame.ts's header comment), a real data-shape
    // gap, not an oversight. `availableStats: []` (rather than omitting
    // the slot) would still need a live gameId to be honest about "why
    // empty" — simpler and equally honest to leave the whole slot null
    // until soccer gets a real per-player live source.
  };
}

/**
 * The player page's shared research sections (Seasons, Trends, Splits, Game
 * log, the hero's season tiles) — R6.1a. Built from the player's history and
 * bio, never from a candidate, so the page renders with no market at all.
 * The columns are this sport's `playerResearchSpec.ts`; the work is
 * `buildPlayerResearch`, shared by every sport.
 */
export function toPlayerResearchData(input: {
  history: PlayerHistory;
  bio: PlayerBio | null;
  now?: Date;
  pool?: PlayerPool | null;
  understat?: SoccerChancesInput;
}): PlayerResearchData | null {
  const league = input.history.sport === 'soccer_mls' ? 'mls' : 'epl';
  const spec = soccerResearchSpec(league, input.bio, input.history.games);
  const research = buildPlayerResearch({ sport: input.history.sport, history: input.history, spec, now: input.now, pool: input.pool });
  if (!research) return research;
  // A keeper's shot list is his own goals and deflections, not his work
  // (Pickford: one shot, an own goal), so he gets the state G2 gives him.
  if (spec.kind === 'goalkeeper') return { ...research, sections: [soccerKeeperSection()] };
  return input.understat ? { ...research, sections: [soccerChancesSection({ ...input.understat, scopeSeason: research.splits.defaultSeason })] } : research;
}
