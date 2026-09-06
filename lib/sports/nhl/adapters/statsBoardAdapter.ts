/**
 * Phase 4.10 — the canonical `StatsBoardData` interface, plus NHL's adapter
 * onto it.
 *
 * NHL declares the type because NHL is the first sport onto this board. That
 * follows the rule in CLAUDE.md — the sport ported first owns the interface,
 * every other sport imports it from here rather than redeclaring it — with the
 * ownership landing on NHL instead of MLB purely because of build order.
 *
 * THE INTERFACE ENCODES THE TWO-BAR SPLIT IN ITS TYPES, not in a comment. A
 * ranking is a relative claim and rests on ordering; a displayed probability is
 * an absolute claim about the world and rests on calibration. So `projection`
 * is required on every row and `probability` is `number | null`, and a null
 * means "this market earned a ranking but not a percentage" — the same signal
 * `prop_model_cache.model_prob` carries in the database. There is no boolean
 * flag alongside it, because a flag can disagree with the data and a null
 * cannot.
 *
 * As measured 2026-09-05, all six NHL markets rank and four carry a
 * probability; assists and blocked shots rank without one (calibration gaps
 * 0.090 and 0.058 against a 0.05 tolerance).
 *
 * WHAT IS DELIBERATELY ABSENT AND MUST STAY ABSENT: edge, market probability,
 * implied probability, prop score, grade, expected value, price. Those are
 * claims about someone else's price and they are gated on a bar nothing in this
 * project has cleared (4.7 failed at t=+3.03). A field for any of them added
 * here is how a stats board silently becomes a betting board without passing
 * its gate — §9d's line, crossed from the inside. `tests/stats-board-no-edge.test.ts`
 * asserts this rather than trusting the comment.
 */

/** One player's projection in one market. */
export interface StatsBoardRow {
  subjectId: string;
  subjectName: string;
  teamAbbr: string | null;
  gameId: string;
  /** The ranked quantity — e.g. 2.7 shots on goal. Always present. */
  projection: number;
  /**
   * Calibrated probability of clearing `line`, or null when this market's
   * calibration gap exceeded tolerance. Null is the instruction "rank this row,
   * show no percentage", not missing data.
   */
  probability: number | null;
  /** The line `probability` is measured against. Null whenever probability is. */
  line: number | null;
  /**
   * Projected CHANCES behind the number — minutes in NHL, plate appearances or
   * outs in MLB. Evidence, not decoration. What it means is named by the
   * market's `volumeLabel`/`volumeUnit`, never assumed by the component.
   */
  volume: number | null;
  /** Games of history the projection rests on. Drives the confidence display. */
  sampleSize: number;
  /**
   * League-wide P(stat > `line`) for this market, measured by the serving job
   * over the same history the projection was built from. The anchor Scan's
   * cross-market ranking subtracts (`lib/sports/propRanking.ts`).
   *
   * NOT `prop_model_cache.league_rate`, which is the engine's per-CHANCE rate
   * (hits per plate appearance) and is not a probability — see migration
   * 20260906120000. Null exactly when `probability` is: with no line there is
   * no "over" to have a league rate of.
   */
  leagueBaseline: number | null;
}

export interface StatsBoardMarket {
  /** Slug shared by the fit, `model_calibration`, and `prop_model_cache`. */
  key: string;
  label: string;
  /** Unit shown after the projection, e.g. "shots". */
  unit: string;
  /**
   * What `StatsBoardRow.volume` MEANS in this market, as a column header and a
   * unit — "Ice time"/"min" in NHL, "Plate appearances"/"PA" for an MLB batter,
   * "Outs"/"outs" for a pitcher.
   *
   * These exist because the board originally hard-coded NHL's answer. That was
   * invisible while NHL was the only sport and wrong the moment MLB arrived:
   * a batter's chances are plate appearances, and rendering "3.7 min" under a
   * heading of "Ice time" would have been confidently, silently false. The
   * convention (CLAUDE.md §4) forbids a `sport === 'x'` branch inside a shared
   * component — it does not forbid replacing a hard-coded assumption with data,
   * which is what this is.
   */
  volumeLabel: string;
  volumeUnit: string;
  /** True when every row in this market carries a calibrated probability. */
  hasProbability: boolean;
  rows: StatsBoardRow[];
}

export interface StatsBoardData {
  sport: string;
  sportLabel: string;
  /** The slate these projections are for. Null when there is no slate. */
  asOf: string | null;
  markets: StatsBoardMarket[];
  /**
   * Why the board is empty, when it is. An offseason is a real answer and the
   * board says so rather than rendering as a broken page.
   */
  emptyReason: string | null;
}

/** Raw row as the API returns it, straight from `prop_model_cache`. */
export interface NhlProjectionApiRow {
  subjectId: string;
  subjectName: string | null;
  teamAbbr: string | null;
  gameId: string;
  dimension: string;
  projection: number | null;
  modelProb: number | null;
  line: number | null;
  projectedToi: number | null;
  sampleSize: number | null;
  leagueBaseline: number | null;
}

/**
 * Display metadata per NHL market — LABELS ONLY. This is not a gate.
 *
 * THE GATE LIVES IN EXACTLY ONE PLACE: `model_calibration.active`, enforced by
 * the serving job. A market whose ordering stops being monotone stops being
 * written, so it leaves the board without anyone editing this file. A second
 * gate here would be a second thing to keep in sync, and two gates that can
 * disagree are worse than one — the failure this whole phase kept hitting.
 *
 * An earlier version of this map DID double as a gate, excluding `hits` and
 * `blocked-shots` because their ordering had been measured backwards. That
 * measurement was an artifact of the walk-forward building history from prop
 * rows only (18.8 games per player) while serving used every game (553.8). Once
 * both sides built history the same way, BOTH markets ordered cleanly — hits
 * 1.60 -> 1.87 -> 2.20 -> 2.43 -> 2.83, blocked shots 1.56 -> 1.68 -> 1.72 ->
 * 1.86 -> 2.02. Hard-coding that stale verdict here is exactly what this map no
 * longer does.
 */
const NHL_MARKETS: Record<string, { label: string; unit: string }> = {
  'shots-on-goal': { label: 'Shots on goal', unit: 'shots' },
  points: { label: 'Points', unit: 'points' },
  assists: { label: 'Assists', unit: 'assists' },
  goals: { label: 'Goals', unit: 'goals' },
  hits: { label: 'Hits', unit: 'hits' },
  'blocked-shots': { label: 'Blocked shots', unit: 'blocks' },
};

const MARKET_ORDER = [
  'shots-on-goal',
  'points',
  'assists',
  'goals',
  'hits',
  'blocked-shots',
];

export function toNhlStatsBoardData(
  rows: NhlProjectionApiRow[],
  asOf: string | null,
): StatsBoardData {
  const byMarket = new Map<string, StatsBoardRow[]>();

  for (const r of rows) {
    if (!NHL_MARKETS[r.dimension]) continue;
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
      volume: r.projectedToi,
      sampleSize: r.sampleSize ?? 0,
      leagueBaseline: r.modelProb == null ? null : r.leagueBaseline,
    });
    byMarket.set(r.dimension, list);
  }

  const markets: StatsBoardMarket[] = [];
  for (const key of MARKET_ORDER) {
    const list = byMarket.get(key);
    if (!list || list.length === 0) continue;
    // The board's whole claim is the ordering, so the sort IS the product.
    list.sort((a, b) => b.projection - a.projection);
    markets.push({
      key,
      label: NHL_MARKETS[key].label,
      unit: NHL_MARKETS[key].unit,
      volumeLabel: 'Ice time',
      volumeUnit: 'min',
      // Every row in a market shares a calibration verdict — the serving job
      // writes a probability for all of a market's rows or none of them — so
      // reading the first row is not a sample, it is the market's own state.
      hasProbability: list[0].probability != null,
      rows: list,
    });
  }

  return {
    sport: 'nhl',
    sportLabel: 'NHL',
    asOf,
    markets,
    emptyReason:
      markets.length > 0
        ? null
        : 'No NHL projections right now. The season runs October through April.',
  };
}
