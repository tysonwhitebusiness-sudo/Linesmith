/**
 * `PlayerDetail.tsx` adapter — soccer half.
 *
 * Deliberately thin compared to MLB/NFL's adapters: soccer has no per-match
 * history source today (see `lib/sports/soccer/adapter.ts`'s header — every
 * candidate arrives with `history: []`), no grading/ranking model, and no
 * per-player season-stats source wired yet (Understat/MLS gaps, per
 * docs/soccer-gameplan-2026-08-22.md §5). `windows`/`gamelog`/`matchups`/
 * `model` all stay `null` — a real, honest "not built yet" state per
 * CLAUDE.md's adapter rule 2, not a placeholder pretending to be data.
 *
 * `propOddsBoard` is real and functional: it's driven by `prop_odds` rows
 * directly (already fetched by `usePropOdds`), not by the missing history
 * engine, so real book prices/movement show correctly even with zero
 * windows above them.
 */

import type { PickCandidate, SportSnapshot } from '@/lib/core/types';
import { candidateDimensionToMarketKey } from '@/lib/odds/props/entityResolution';
import type { PropOddsRow } from '@/lib/db/client';
import type { ChipDef, PlayerDetailChart, PlayerDetailData, PropOddsBoardProps } from '@/lib/sports/mlb/adapters/playerDetailAdapter';

export interface SoccerPlayerDetailInput {
  candidates: PickCandidate[];
  market?: string;
  snapshot: SportSnapshot | null;
  propOdds?: { rows: PropOddsRow[]; userSportsbook: string };
}

export function toPlayerDetailData(input: SoccerPlayerDetailInput): PlayerDetailData | null {
  const { candidates, market, snapshot, propOdds } = input;

  const active = candidates.find((c) => c.dimension === market) ?? candidates[0];
  if (!active) return null;

  const meta = (active.subjectMeta ?? {}) as Record<string, unknown>;
  const teamAbbr = typeof meta.team === 'string' ? meta.team : undefined;
  const opponentAbbr = typeof meta.opponent === 'string' ? meta.opponent : undefined;
  const headshotUrl = typeof meta.headshotUrl === 'string' ? meta.headshotUrl : undefined;
  const teamLogoUrl = typeof meta.teamLogoUrl === 'string' ? meta.teamLogoUrl : undefined;
  const opponentLogoUrl = typeof meta.opponentLogoUrl === 'string' ? meta.opponentLogoUrl : undefined;

  const games = ((snapshot?.context?.other as Record<string, unknown> | undefined)?.games ?? []) as Array<{
    gamePk: string;
    firstPitch?: string;
  }>;
  const todaysGame = games.find((g) => String(g.gamePk) === String(meta.gamePk));

  const baseLine = active.line ?? 0.5;
  const wantOver = true; // every soccer market here is "did/will this happen", not a two-sided over/under pick.

  const chips: ChipDef[] = opponentAbbr ? [{ key: 'opponent', label: `vs ${opponentAbbr}` }] : [];

  // No per-match history source exists yet (adapter.ts's header) — an
  // honest "0 games in scope" chart, not a fabricated distribution.
  const chart: PlayerDetailChart = {
    kind: 'distribution',
    title: '0 games in scope',
    subtitle: 'No per-match history source yet for soccer',
    data: [],
    line: baseLine,
    wantOver,
  };

  const activeMarketKey = candidateDimensionToMarketKey(active.dimension);
  const propOddsBoard: PropOddsBoardProps | null =
    activeMarketKey && propOdds
      ? { allRows: propOdds.rows, subjectId: active.subjectId, marketKey: activeMarketKey, line: active.line ?? null, userSportsbook: propOdds.userSportsbook }
      : null;

  return {
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
    windows: null,
    roundScores: null,
    chart,
    gamelog: null,
    propOddsBoard,
    model: null,
    hitterStats: null,
    formWindows: active.supportingSplits ?? null,
    lineControl: { kind: 'stepper', line: baseLine, baseLine, wantOver },
    liveGame: null,
    liveMatchup: null,
    matchups: null,
    seasonStatsCard: null,
    mlbContextMatchup: null,
    golfFormHoles: null,
    nflMatchup: null,
    nflSeasonStats: null,
  };
}
