/**
 * GET /api/picks/game-history?sport=mlb
 *
 * The Linesmith Pick lock system's read side — the record (moneyline + O/U
 * win-loss) and the full per-game row list, shared by the diagnostics pick
 * history table and the Scan page's top-of-page record badge.
 */

import { NextResponse } from 'next/server';
import { gamePickRecord, listGamePickHistory, type GamePickRow } from '@/lib/db/client';
import { gradeConfidence, type ConfidenceGrade } from '@/lib/core/confidence';
import { americanToDecimalOdds, stakeSuggestion, type StakeSuggestion } from '@/lib/core/kelly';
import { easternDate } from '@/lib/sports/mlb/statsapi';

export const dynamic = 'force-dynamic';

interface MoneylinePickView {
  pickSide: 'home' | 'away' | null;
  pickTeamName: string | null;
  price: number | null;
  confidence: ConfidenceGrade | null;
  /** 90% confidence interval for `confidence.pct`'s underlying probability — null when no fitted model with a covariance matrix was active at capture time. */
  probLower: number | null;
  probUpper: number | null;
  /** Half-Kelly stake suggestion (fraction of bankroll) — null when no price was ever attached, so there's no payout to size against. */
  stake: StakeSuggestion | null;
  locked: boolean;
  late: boolean;
  changed: boolean;
  initialTeamName: string | null;
  outcome: 'win' | 'loss' | null;
}

interface TotalPickView {
  pickSide: 'over' | 'under' | null;
  line: number | null;
  price: number | null;
  confidence: ConfidenceGrade | null;
  /** 90% confidence interval for `confidence.pct`'s underlying probability — null when no fitted total model with a covariance matrix was active at capture time. */
  probLower: number | null;
  probUpper: number | null;
  /** Half-Kelly stake suggestion — null when no price was ever attached. Added once the total model got its own confidence interval (see gameModel.ts's computeTotalConfidenceInterval); mirrors the moneyline stake exactly. */
  stake: StakeSuggestion | null;
  locked: boolean;
  late: boolean;
  changed: boolean;
  initialSide: 'over' | 'under' | null;
  initialLine: number | null;
  outcome: 'win' | 'loss' | null;
}

interface GamePickView {
  gameId: string;
  matchup: string | null;
  awayTeamId: number | null;
  homeTeamId: number | null;
  awayTeamName: string | null;
  homeTeamName: string | null;
  commenceTime: string | null;
  finalScore: { home: number; away: number } | null;
  moneyline: MoneylinePickView;
  total: TotalPickView;
}

function teamName(row: GamePickRow, side: 'home' | 'away' | null): string | null {
  if (!side) return null;
  return side === 'home' ? row.homeTeamName : row.awayTeamName;
}

function toView(row: GamePickRow): GamePickView {
  const mlSide = row.mlFinalSide ?? row.mlInitialSide;
  const mlProb = row.mlFinalProb ?? row.mlInitialProb;
  const mlPrice = row.mlFinalPrice ?? row.mlInitialPrice;
  const mlProbLower = row.mlFinalProbLower ?? row.mlInitialProbLower;
  const mlProbUpper = row.mlFinalProbUpper ?? row.mlInitialProbUpper;
  const mlStake = mlProb != null && mlPrice != null ? stakeSuggestion(mlProb, mlProbLower, americanToDecimalOdds(mlPrice)) : null;
  const totalSide = row.totalFinalSide ?? row.totalInitialSide;
  const totalLine = row.totalFinalLine ?? row.totalInitialLine;
  const totalProb = row.totalFinalProb ?? row.totalInitialProb;
  const totalPrice = row.totalFinalPrice ?? row.totalInitialPrice;
  const totalProbLower = row.totalFinalProbLower ?? row.totalInitialProbLower;
  const totalProbUpper = row.totalFinalProbUpper ?? row.totalInitialProbUpper;
  const totalStake = totalProb != null && totalPrice != null ? stakeSuggestion(totalProb, totalProbLower, americanToDecimalOdds(totalPrice)) : null;

  return {
    gameId: row.gameId,
    matchup: row.matchup,
    awayTeamId: row.awayTeamId,
    homeTeamId: row.homeTeamId,
    awayTeamName: row.awayTeamName,
    homeTeamName: row.homeTeamName,
    commenceTime: row.commenceTime,
    finalScore: row.finalHomeScore != null && row.finalAwayScore != null ? { home: row.finalHomeScore, away: row.finalAwayScore } : null,
    moneyline: {
      pickSide: mlSide,
      pickTeamName: teamName(row, mlSide),
      price: mlPrice,
      confidence: mlProb != null ? gradeConfidence(mlProb) : null,
      probLower: mlProbLower,
      probUpper: mlProbUpper,
      stake: mlStake,
      locked: row.mlFinalCapturedAt != null,
      late: row.mlFinalCapturedAt != null ? row.mlFinalLate : row.mlInitialLate,
      changed: row.mlInitialSide != null && row.mlFinalSide != null && row.mlInitialSide !== row.mlFinalSide,
      initialTeamName: teamName(row, row.mlInitialSide),
      outcome: row.mlOutcome,
    },
    total: {
      pickSide: totalSide,
      line: totalLine,
      price: totalPrice,
      confidence: totalProb != null ? gradeConfidence(totalProb) : null,
      probLower: totalProbLower,
      probUpper: totalProbUpper,
      stake: totalStake,
      locked: row.totalFinalCapturedAt != null,
      late: row.totalFinalCapturedAt != null ? row.totalFinalLate : row.totalInitialLate,
      changed: row.totalInitialSide != null && row.totalFinalSide != null && row.totalInitialSide !== row.totalFinalSide,
      initialSide: row.totalInitialSide,
      initialLine: row.totalInitialLine,
      outcome: row.totalOutcome,
    },
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sport = params.get('sport') ?? 'mlb';
  const date = params.get('date'); // YYYY-MM-DD exact match — kept for the Scan page's single-day badge
  const from = params.get('from'); // YYYY-MM-DD, inclusive
  const to = params.get('to'); // YYYY-MM-DD, inclusive
  const record = await gamePickRecord(sport);
  let rows = (await listGamePickHistory(sport)).map(toView);
  if (date) {
    rows = rows.filter((r) => r.commenceTime && easternDate(new Date(r.commenceTime)) === date);
  } else if (from || to) {
    rows = rows.filter((r) => {
      if (!r.commenceTime) return false;
      const d = easternDate(new Date(r.commenceTime));
      return (!from || d >= from) && (!to || d <= to);
    });
  }
  return NextResponse.json({ record, rows });
}
