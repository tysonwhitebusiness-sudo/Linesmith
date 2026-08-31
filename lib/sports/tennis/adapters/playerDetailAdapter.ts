/**
 * `PlayerDetail.tsx` adapter — tennis half.
 *
 * Real per-match history for all three tennis markets (aces, games-won,
 * to-win-a-set — see `lib/sports/tennis/adapter.ts`'s header), sourced from
 * stats.tennismylife.org. `windows`/`chart`/`gamelog` reuse the same
 * windowed-stat engine soccer's/NFL's adapters use, scoped by opponent +
 * lastN — no venue filter (tennis has no home/away).
 *
 * No team concept: `teamAbbr`/`teamLogoUrl` stay `undefined` (same honest
 * gap golf's adapter documents); `opponentAbbr` below actually holds the
 * opposing player's full name, not an abbreviation — same convention
 * `multiSportGameContext.ts`'s tennis branch already uses for
 * `awayAbbr`/`homeAbbr`.
 */

import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import { buildAnalyticsRoles } from '@/lib/sports/shared/analyticsRoles';
import { directionMark } from '@/components/MarketLabel';
import { categoriseByLine, fixedWindow, openWindow, OVER, subsetWindow } from '@/lib/core/windowedStat';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import type { ChipDef, GamelogRow, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps, WindowedStat5 } from '@/lib/sports/mlb/adapters/playerDetailAdapter';
import { toCareerH2H } from '@/lib/sports/shared/careerH2H';
import { toPredicateBinarySplit } from '@/lib/sports/shared/predicateSplit';
import type { OpponentUnitRole } from '@/lib/sports/shared/playerRoles';

function rawOf(entry: PickCandidate['history'][number]): Record<string, unknown> {
  return (entry.raw ?? {}) as Record<string, unknown>;
}

const GAMELOG_COLUMNS = [
  { key: 'aces', label: 'Aces' },
  { key: 'gamesWon', label: 'Gms W' },
  { key: 'gamesLost', label: 'Gms L' },
];

export interface TennisPlayerDetailScope {
  lineOffset: number;
  opponentOnly: boolean;
  lastN: number | 'all';
  showAllGames: boolean;
  kpiScope: 'season' | 'l15';
}

export interface TennisPlayerDetailInput {
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  scope: TennisPlayerDetailScope;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
}

export function toPlayerDetailData(input: TennisPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, scope, propOdds } = input;

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;

  const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{
    gamePk: string;
    firstPitch?: string;
  }>;
  const todaysGame = games.find((g) => String(g.gamePk) === String(meta.gamePk));

  // Every tennis candidate is built with `category: 'over' | 'yes'` (see
  // adapter.ts) — there's no real signal driving an 'under'-favored pick the
  // way MLB/NFL's history-derived direction can, so this is always "over"/
  // "did happen", same as soccer's adapter.
  const wantOver = true;
  const baseLine = active.line ?? 0.5;
  const line = Math.max(0, baseLine + scope.lineOffset);

  let scoped = active.history;
  if (scope.opponentOnly && opponentAbbr) {
    scoped = scoped.filter((e) => (rawOf(e).opponentName as string | undefined) === opponentAbbr);
  }
  if (scope.lastN !== 'all') scoped = scoped.slice(-scope.lastN);

  const measured = categoriseByLine(scoped, line);
  const wanted = OVER;

  const windows: WindowedStat5 = {
    l5: fixedWindow(measured, wanted, 5),
    l10: fixedWindow(measured, wanted, 10),
    l15: fixedWindow(measured, wanted, 15),
    szn: openWindow(measured, wanted, { minimum: 1 }),
    h2h:
      !opponentAbbr
        ? { status: 'insufficient', available: 0, required: 1 }
        : subsetWindow(categoriseByLine(active.history, line), wanted, (e) => (rawOf(e).opponentName as string | undefined) === opponentAbbr, { minimum: 1 }),
  };

  // ---- Role 1 | opponentUnit: the player across the net.
  // Tennis has no defensive UNIT, so the role's own table calls this "opponent
  // profile" -- and the opponent is themselves a subject on the same slate,
  // with their own candidates and their own real history. So this reads THEIR
  // history through the same windowed-stat machinery, rather than parsing the
  // formatted `statusLine` the snapshot also carries ("42-41 · 4.8
  // aces/match"). A display string reparsed into numbers is a silent break
  // waiting for someone to change the format.
  //
  // READ FROM `snapshot.candidates`, NOT the `candidates` input. That input is
  // scoped to THIS player -- `app/tennis/[tour]/player/[playerId]/page.tsx`
  // passes `effectiveCandidates`, which is `mine` or a synthetic fallback --
  // so filtering it for the opponent can never match anything. Written that
  // way first, and it rendered nothing on a real page for a match whose
  // opponent demonstrably had two candidates with history. The snapshot
  // carries the whole slate (395 candidates on the tour today).
  const slate = (snapshot?.candidates ?? []) as PickCandidate[];
  const opponentCandidates = opponentAbbr
    ? slate.filter((c) => c.subjectName === opponentAbbr && c.subjectId !== active.subjectId)
    : [];
  const opponentStats = opponentCandidates
    .filter((c) => c.history.length > 0)
    .map((c) => {
      const values = c.history.map((e) => Number(e.result)).filter((v) => Number.isFinite(v));
      return values.length > 0
        ? {
            key: c.dimension,
            label: c.dimensionLabel ?? c.dimension,
            value: values.reduce((a, b) => a + b, 0) / values.length,
            decimals: 1,
            // Per-match average, so the sample is the matches behind it.
            sub: `n=${values.length}`,
          }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const opponentUnit: OpponentUnitRole | null =
    opponentAbbr && opponentStats.length > 0
      ? {
          title: 'Opponent',
          name: opponentAbbr,
          subtitle: 'Averages',
          stats: opponentStats,
          emptyMessage: 'No match history on record for this opponent.',
        }
      : null;

  // ---- Role 4 | binarySplit: hard vs clay.
  // `raw.surface` comes from `lib/sports/tennis/surfaces.ts`, a hand-curated
  // table -- ESPN's tennis feeds carry no surface field anywhere. That table
  // covers all 60 real 2026 ATP events; its WTA half is unfinished, so WTA
  // subjects fall through to null here rather than to a guess.
  //
  // NOT `toVenueBinarySplit`: a tennis season is mostly hard court, so the
  // 25% share floor that guards a balanced league schedule would reject a
  // clay specialist's perfectly real split. See `predicateSplit.ts`.
  const surfaceOf = (e: Parameters<typeof rawOf>[0]) => String(rawOf(e).surface ?? '').toLowerCase();
  const binarySplit = toPredicateBinarySplit({
    measured: categoriseByLine(active.history, line),
    wanted,
    title: 'Surface',
    aLabel: 'Hard',
    bLabel: 'Clay',
    isA: (e) => surfaceOf(e).includes('hard'),
    isB: (e) => surfaceOf(e).includes('clay'),
    statLabel: active.dimensionLabel ?? active.dimension,
  });

  // ---- Role 5 | conditions: NOT BUILT, and deliberately not stubbed.
  // Today's surface is the fact worth showing, and it is not reachable here:
  // `buildSyntheticPlayerCandidates(subjectId, subjectName, tour)` never sees
  // the event, so `subjectMeta` is `{ tour, league }` and nothing carries the
  // tournament. A `meta.surface` read would compile, render nothing forever,
  // and look finished -- which is the exact failure this phase keeps finding.
  // The PAST surfaces are on `raw.surface` and drive `binarySplit` above;
  // reusing the last match's surface as "today's" would be a different match's
  // fact under today's heading. Needs the event plumbed onto subjectMeta.

  // ---- Role 6 | careerH2H (6.13). NOT a second copy of the h2h window box:
  // that reports one rate, this reports the per-MEETING history behind it.
  // "3 of 5" and "3 of 5, all three in one season" are different facts and a
  // single rate cannot tell them apart. Same opponent predicate `windows.h2h`
  // uses above -- deliberately the same expression, so the two can never
  // disagree about who the opponent is.
  const careerH2H = opponentAbbr
    ? toCareerH2H({
        measured: categoriseByLine(active.history, line),
        wanted,
        isVsOpponent: (e) => (rawOf(e).opponentName as string | undefined) === opponentAbbr,
        opponentLabel: `vs ${opponentAbbr}`,
        // Tennis does not import MarketLabel; the candidate already carries its own label.
        statLabel: active.dimensionLabel ?? active.dimension,
      })
    : null;

  const chips: ChipDef[] = [
    ...(opponentAbbr ? [{ key: 'opponent', label: `vs ${opponentAbbr}` }] : []),
    { key: 'lastN:5', label: 'Last 5' },
    { key: 'lastN:10', label: 'Last 10' },
    { key: 'lastN:15', label: 'Last 15' },
    { key: 'lastN:all', label: 'All matches' },
  ];

  const chart: PlayerDetailChart =
    scoped.length > 0
      ? { kind: 'distribution', title: `${scoped.length} match${scoped.length === 1 ? '' : 'es'} in scope`, subtitle: `green cleared ${wantOver ? 'over' : 'under'} ${line}`, data: scoped, line, wantOver }
      : {
          kind: 'distribution',
          title: '0 matches in scope',
          subtitle: active.history.length === 0 ? 'No name match found in stats.tennismylife.org yet' : `green cleared ${wantOver ? 'over' : 'under'} ${line}`,
          data: [],
          line,
          wantOver,
        };

  const columns = GAMELOG_COLUMNS.filter((c) => scoped.some((e) => rawOf(e)[c.key] != null));
  const gamelogSource = [...scoped].reverse().slice(0, scope.showAllGames ? undefined : 15);
  const rows: GamelogRow[] = gamelogSource.map((entry, index) => {
    const raw = rawOf(entry);
    const opponent = raw.opponentName as string | undefined;
    const values: Record<string, number | string | null | undefined> = {};
    for (const col of columns) {
      const v = raw[col.key];
      values[col.key] = v == null ? null : (v as number);
    }
    return {
      key: `${entry.period}-${index}`,
      periodLabel: entry.periodLabel ?? `Match #${entry.period}`,
      opponentLabel: opponent ? `vs ${opponent}` : 'Opponent unknown',
      values,
    };
  });

  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;


  // ---- Phase 6.16: the four analytics cards ----
  //
  // ONE CALL FOR ALL FOUR, identical in every sport's adapter, because every
  // one is a function of this candidate's own history and line. See
  // `analyticsRoles.ts` for why they are shared rather than per-sport.
  //
  // `peers` COMES FROM `snapshot.candidates`, NOT the `candidates` argument.
  // The argument is already scoped to this subject, so using it would compare
  // the player against himself and the pool would be one. That exact mistake
  // was made once on tennis's `opponentUnit` and caught only by opening the
  // page -- same shape, same fix.
  const analyticsRoles = buildAnalyticsRoles({
    history: active.history,
    line: active.line,
    wantOver: directionMark(active.category) !== 'U',
    statLabel: active.dimensionLabel ?? active.dimension,
    peers: (snapshot?.candidates ?? [])
      .filter((c) => c.dimension === active.dimension && c.subjectId !== active.subjectId)
      .map((c) => ({ history: c.history })),
  });

  return {
    ...analyticsRoles,
    opponentUnit,
    binarySplit,
    careerH2H,
    subject: {
      subjectId: active.subjectId,
      name: active.subjectName,
      headshotUrl: undefined,
      teamAbbr: undefined,
      teamLogoUrl: undefined,
      position: undefined,
      rankPrefix: '',
      opponentAbbr,
      opponentLogoUrl: undefined,
      gameStartTime: todaysGame?.firstPitch ?? null,
      gameStatus: null,
    },
    candidates,
    market: active.dimension,
    chips,
    windows,
    roundScores: null,
    chart,
    gamelog: scoped.length > 0 || active.history.length > 0 ? { columns, rows, cardBadges: columns } : null,
    propOddsBoard,
    model: null,
    hitterStats: null,
    formWindows: active.supportingSplits ?? null,
    lineControl: { kind: 'stepper', line, baseLine, wantOver },
    liveGame: null,
    liveMatchup: null,
    // No matchup card yet — tennis is a player-vs-player sport (no team
    // position groups), and no ranked-player list exists in this codebase
    // yet for a "pick any opponent" head-to-head picker (see
    // docs/matchup-card-rebuild-gameplan-2026-08-23.md §6/§9 phase 5).
    matchupExplorer: null,
    seasonStatsCard: null,
    golfFormHoles: null,
    nflSeasonStats: null,
    // No per-player live stat source for tennis beyond set/game score
    // (which lives on the match, not a per-player "stat" a line can
    // target) — `statistics[]` (serve stats) was confirmed empty on every
    // real match checked while building Part 1's TennisLiveTab.
    liveLineTracker: null,
  };
}
