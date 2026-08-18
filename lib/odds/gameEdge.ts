/**
 * G6's edge math, factored out once it was needed a third time (Game Detail's
 * picks panel, Player Detail's Game Odds card, now the Teams page): de-vig the
 * two-sided market price, compare against the game model's own probability.
 */

import { americanToDecimal } from './display';
import { devigTwoWay } from './devig';
import { computeTotalModel, type MoneylineResult } from '../sports/mlb/gameModel';

export interface MoneylineEdge {
  away: number;
  home: number;
  awayModelProb: number;
  homeModelProb: number;
  awayMarketProb: number;
  homeMarketProb: number;
}

export function computeMoneylineEdge(
  gameModel: MoneylineResult | null | undefined,
  moneyline: { away?: number | null; home?: number | null } | null | undefined,
): MoneylineEdge | null {
  if (!gameModel || moneyline?.away == null || moneyline?.home == null) return null;
  const devigged = devigTwoWay(americanToDecimal(moneyline.away), americanToDecimal(moneyline.home));
  if (!devigged) return null;
  return {
    away: gameModel.awayWinProb - devigged.a,
    home: gameModel.homeWinProb - devigged.b,
    awayModelProb: gameModel.awayWinProb,
    homeModelProb: gameModel.homeWinProb,
    awayMarketProb: devigged.a,
    homeMarketProb: devigged.b,
  };
}

export interface TotalEdge {
  over: number;
  under: number;
  overModelProb: number;
  underModelProb: number;
  overMarketProb: number;
  underMarketProb: number;
}

export function computeTotalEdge(
  gameModel: MoneylineResult | null | undefined,
  total: { point?: number | null; overPrice?: number | null; underPrice?: number | null } | null | undefined,
): TotalEdge | null {
  if (!gameModel || total?.point == null || total?.overPrice == null || total?.underPrice == null) return null;
  const model = computeTotalModel({
    homeExpectedRuns: gameModel.homeExpectedRuns,
    awayExpectedRuns: gameModel.awayExpectedRuns,
    line: total.point,
  });
  const devigged = devigTwoWay(americanToDecimal(total.overPrice), americanToDecimal(total.underPrice));
  if (!devigged) return null;
  return {
    over: model.overProb - devigged.a,
    under: 1 - model.overProb - devigged.b,
    overModelProb: model.overProb,
    underModelProb: 1 - model.overProb,
    overMarketProb: devigged.a,
    underMarketProb: devigged.b,
  };
}
