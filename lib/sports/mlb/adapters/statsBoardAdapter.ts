/**
 * Phase 5.8 — MLB's adapter onto the shared stats board.
 *
 * Imports `StatsBoardData` from the NHL file rather than redeclaring it, per
 * CLAUDE.md: the sport ported first owns the interface. Adding MLB required ONE
 * change to `StatsBoard.tsx` and it was not a sport branch — the board had
 * hard-coded "Ice time"/"min" for the volume column, which is NHL's answer to a
 * question every sport answers differently. That became `volumeLabel`/
 * `volumeUnit` on the market. A batter's chances are plate appearances and a
 * pitcher's are outs; rendering either as minutes would have been silently,
 * confidently wrong.
 *
 * BATTERS AND PITCHERS SHARE ONE TAB STRIP, ordered batters first, with the
 * side named in any label that would otherwise be ambiguous ("Strikeouts
 * (batter)" against "Strikeouts (pitcher)"). They are different populations but
 * they are not different UI: each is a ranked list of players by a projected
 * count, which is exactly what the board already renders.
 */
import type {
  StatsBoardData,
  StatsBoardMarket,
  StatsBoardRow,
} from '@/lib/sports/nhl/adapters/statsBoardAdapter';

export type { StatsBoardData, StatsBoardMarket, StatsBoardRow };

export interface MlbProjectionApiRow {
  subjectId: string;
  subjectName: string | null;
  teamAbbr: string | null;
  gameId: string;
  dimension: string;
  projection: number | null;
  modelProb: number | null;
  line: number | null;
  volume: number | null;
  sampleSize: number | null;
}

/**
 * Display metadata per MLB market — LABELS ONLY, never a gate.
 *
 * The gate is `model_calibration.active`, enforced by the serving job, exactly
 * as for NHL. An earlier version of the NHL map doubled as a gate and went
 * stale the moment the model was re-fitted; this one does not repeat that.
 *
 * `volumeLabel`/`volumeUnit` differ by SIDE, which is the real distinction: a
 * batter's chances are plate appearances, a pitcher's are outs recorded.
 */
const BAT = { volumeLabel: 'Plate appearances', volumeUnit: 'PA' };
const PIT = { volumeLabel: 'Outs recorded', volumeUnit: 'outs' };

const MLB_MARKETS: Record<
  string,
  { label: string; unit: string; volumeLabel: string; volumeUnit: string }
> = {
  hits: { label: 'Hits', unit: 'hits', ...BAT },
  'total-bases': { label: 'Total bases', unit: 'bases', ...BAT },
  'hits-runs-rbis': { label: 'Hits + runs + RBIs', unit: 'H+R+RBI', ...BAT },
  rbis: { label: 'RBIs', unit: 'RBIs', ...BAT },
  runs: { label: 'Runs scored', unit: 'runs', ...BAT },
  singles: { label: 'Singles', unit: 'singles', ...BAT },
  doubles: { label: 'Doubles', unit: 'doubles', ...BAT },
  triples: { label: 'Triples', unit: 'triples', ...BAT },
  'home-runs': { label: 'Home runs', unit: 'HR', ...BAT },
  walks: { label: 'Walks', unit: 'walks', ...BAT },
  'batter-strikeouts': { label: 'Strikeouts (batter)', unit: 'K', ...BAT },
  'stolen-bases': { label: 'Stolen bases', unit: 'SB', ...BAT },
  'pitcher-strikeouts': { label: 'Strikeouts (pitcher)', unit: 'K', ...PIT },
  'pitcher-hits-allowed': { label: 'Hits allowed', unit: 'hits', ...PIT },
  'pitcher-walks-allowed': { label: 'Walks allowed', unit: 'walks', ...PIT },
  'pitcher-outs': { label: 'Outs recorded', unit: 'outs', ...PIT },
  'earned-runs': { label: 'Earned runs', unit: 'ER', ...PIT },
};

// Batters first, then pitchers; within each, the markets a reader is most
// likely to be looking for.
const MARKET_ORDER = [
  'hits',
  'total-bases',
  'hits-runs-rbis',
  'home-runs',
  'rbis',
  'runs',
  'singles',
  'doubles',
  'triples',
  'walks',
  'batter-strikeouts',
  'stolen-bases',
  'pitcher-strikeouts',
  'pitcher-outs',
  'pitcher-hits-allowed',
  'earned-runs',
  'pitcher-walks-allowed',
];

export function toMlbStatsBoardData(
  rows: MlbProjectionApiRow[],
  asOf: string | null,
): StatsBoardData {
  const byMarket = new Map<string, StatsBoardRow[]>();

  for (const r of rows) {
    if (!MLB_MARKETS[r.dimension]) continue;
    if (r.projection == null) continue;
    const list = byMarket.get(r.dimension) ?? [];
    list.push({
      subjectId: r.subjectId,
      subjectName: r.subjectName ?? r.subjectId,
      teamAbbr: r.teamAbbr,
      gameId: r.gameId,
      projection: r.projection,
      probability: r.modelProb,
      line: r.modelProb == null ? null : r.line,
      volume: r.volume,
      sampleSize: r.sampleSize ?? 0,
    });
    byMarket.set(r.dimension, list);
  }

  const markets: StatsBoardMarket[] = [];
  for (const key of MARKET_ORDER) {
    const list = byMarket.get(key);
    if (!list || list.length === 0) continue;
    // The board's whole claim is the ordering, so the sort IS the product.
    list.sort((a, b) => b.projection - a.projection);
    const meta = MLB_MARKETS[key];
    markets.push({
      key,
      label: meta.label,
      unit: meta.unit,
      volumeLabel: meta.volumeLabel,
      volumeUnit: meta.volumeUnit,
      // The serving job writes a probability for all of a market's rows or none
      // of them, so the first row is the market's state, not a sample.
      hasProbability: list[0].probability != null,
      rows: list,
    });
  }

  return {
    sport: 'mlb',
    sportLabel: 'MLB',
    asOf,
    markets,
    emptyReason:
      markets.length > 0
        ? null
        : 'No MLB projections right now. The season runs late March through October.',
  };
}
