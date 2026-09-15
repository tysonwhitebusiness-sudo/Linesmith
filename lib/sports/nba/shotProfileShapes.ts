/**
 * The database-free half of NBA's shot profile — Phase 6.7's shapes and grid.
 *
 * Split out for the reason `pitchProfileShapes.ts` and `nhl/shotProfileShapes.ts`
 * are: `shotProfile.ts` value-imports `pgAll`, and anything a `'use client'`
 * component reaches must not. `tests/client-bundle-boundary.test.ts` enforces it.
 *
 * ============ GEOMETRY, ESTABLISHED FROM GROUND TRUTH ======================
 *
 * The units are FEET, and the basket was first placed at (25, 0) (corrected to
 * (25, 1) in R2, below). That was not assumed — it
 * was measured against the one distance in basketball whose real value is
 * known: on a real game's 195 attempts, three-pointers averaged **26.6 feet**
 * from (25, 0) and two-pointers **12.9**, against a three-point line of 22 feet
 * in the corners and 23.75 at the top. An origin or scale that was wrong would
 * not produce those two numbers.
 *
 * The bands below follow from that, and from how basketball is actually
 * described: the restricted area is ~4 feet, the paint runs to the free-throw
 * line at 15, and the three-point line sits at 22-23.75.
 *
 * R2 CORRECTED TWO THINGS (G2 data findings, `docs/design/phase-g2/PLAN.md`):
 *
 *  1. **The rim is at y ≈ 1, not 0.** Fitted in G2 with the arc below: 99.8%
 *     of MADE shots classify to their stored `point_value` with the rim at
 *     (25, 1). The 6.7 averages above could not separate one foot.
 *  2. **Every MISS was stored with `point_value` 2.** A missed three was
 *     indistinguishable from a missed two in the column, so a miss's value
 *     comes from the arc; a make keeps its stored value. R5c fixed the column
 *     at ingest with this same arc and corrected the stored 2024-25 rows
 *     (59,235 missed threes), so for a placed shot the stored value and this
 *     derivation now agree; the derivation stays so the chart does not depend
 *     on every writer having been right. The three-point band
 *     is now "worth three", not "farther than 22 feet": an above-the-break
 *     long two at 22.5 feet is a two, and it used to be counted as a three.
 *
 * The arc constants are the fitted ones the G2 tools use
 * (`build_team_data.py` `nba_zone`, translated out of its shifted y): three
 * when 23.25+ feet from the rim, or in the corner (21.5+ feet off centre and
 * within 8.75 feet of the rim's y).
 *
 * A shot with no location does NOT land at the rim. ESPN's missing-coordinate
 * sentinel is rejected at ingest, so those arrive as NULL and are excluded from
 * the grid rather than defaulted — see `nba_shots.py`.
 * ===========================================================================
 */

export interface NbaShotRow {
  xCoord: number | null;
  yCoord: number | null;
  pointValue: number | null;
  made: boolean;
  /** ESPN's own description: "Jump Shot", "Driving Layup Shot", "Step Back Jump Shot". */
  shotType?: string | null;
}

export interface NbaShotCell {
  key: string;
  /** Attempts from this band as a percentage of all placed attempts. */
  share: number;
  attempts: number;
  made: number;
  /** Field-goal percentage in this band, 0-100. `null` when the band is empty. */
  fgPct: number | null;
}

export interface NbaShotProfile {
  /** One row per distance band, closest first — a single column each. */
  cells: NbaShotCell[][];
  rowLabels: string[];
  columnLabels: string[];
  totalAttempts: number;
  totalMade: number;
  /** Attempts with no recorded location, excluded from the grid but counted here. */
  unlocated: number;
  /**
   * Shot-type mix — NBA's `usageMix`.
   *
   * COUNTED OVER EVERY ATTEMPT, INCLUDING UNLOCATED ONES, and that is a
   * deliberate difference from the grid beside it. A shot ESPN did not place
   * still has a type, and dropping it from the mix would report a different
   * total than the player actually took. The adapter says which denominator it
   * is using; the two cards do not have to agree on a number they are not
   * both measuring.
   */
  shotTypes: Array<{ type: string; attempts: number; made: number }>;
}

/** Basket position, in the feed's own units. */
export const RIM_X = 25;
export const RIM_Y = 1;

const ARC_FEET = 23.25;
const CORNER_OFF_CENTRE_FEET = 21.5;
const CORNER_MAX_Y = RIM_Y + 8.75;

/** Distance bands for twos, in feet, then everything worth three. */
const BANDS: Array<{ label: string; max: number }> = [
  { label: 'At the rim', max: 4 },
  { label: 'Paint', max: 15 },
  { label: 'Mid-range', max: Number.POSITIVE_INFINITY },
  { label: 'Three-point', max: Number.POSITIVE_INFINITY },
];
const THREE_BAND = BANDS.length - 1;

const COLUMN_LABELS = ['Share'];

export function shotDistance(x: number, y: number): number {
  return Math.hypot(x - RIM_X, y - RIM_Y);
}

/** Beyond the three-point line, from location alone. */
export function isBeyondArc(x: number, y: number): boolean {
  return shotDistance(x, y) >= ARC_FEET || (Math.abs(x - RIM_X) >= CORNER_OFF_CENTRE_FEET && y <= CORNER_MAX_Y);
}

/**
 * What the attempt was worth. A make keeps its stored `point_value`; a miss is
 * always stored as 2, so its value comes from the arc.
 */
export function shotValue(row: { xCoord: number; yCoord: number; made: boolean; pointValue: number | null }): 2 | 3 {
  if (row.made && (row.pointValue === 2 || row.pointValue === 3)) return row.pointValue;
  return isBeyondArc(row.xCoord, row.yCoord) ? 3 : 2;
}

/**
 * `null` when nothing is placeable. An unlocated attempt is counted in
 * `unlocated` and excluded from the bands — it is a real shot whose location
 * we do not know, which is different from both "no shot" and "a shot at the rim".
 */
export function toNbaShotProfile(rows: readonly NbaShotRow[]): NbaShotProfile | null {
  const cells: NbaShotCell[][] = BANDS.map((b, i) => [
    { key: `${i}`, share: 0, attempts: 0, made: 0, fgPct: null },
  ]);

  let placed = 0;
  let made = 0;
  let unlocated = 0;
  const byType = new Map<string, { attempts: number; made: number }>();

  for (const r of rows) {
    // Counted BEFORE the placement guard -- see `shotTypes` on the interface
    // for why the mix and the grid deliberately use different denominators.
    const st = typeof r.shotType === 'string' && r.shotType ? r.shotType : 'Unknown';
    const acc = byType.get(st) ?? { attempts: 0, made: 0 };
    acc.attempts += 1;
    if (r.made) acc.made += 1;
    byType.set(st, acc);

    if (r.xCoord == null || r.yCoord == null || !Number.isFinite(r.xCoord) || !Number.isFinite(r.yCoord)) {
      unlocated += 1;
      continue;
    }
    const bandIndex =
      shotValue({ xCoord: r.xCoord, yCoord: r.yCoord, made: r.made, pointValue: r.pointValue }) === 3
        ? THREE_BAND
        : BANDS.findIndex((b) => shotDistance(r.xCoord!, r.yCoord!) <= b.max);
    const cell = cells[bandIndex][0];
    cell.attempts += 1;
    placed += 1;
    if (r.made) {
      cell.made += 1;
      made += 1;
    }
  }

  if (placed === 0) return null;
  for (const row of cells) {
    for (const cell of row) {
      cell.share = (cell.attempts / placed) * 100;
      cell.fgPct = cell.attempts > 0 ? (cell.made / cell.attempts) * 100 : null;
    }
  }

  return {
    cells,
    rowLabels: BANDS.map((b) => b.label),
    columnLabels: COLUMN_LABELS,
    totalAttempts: placed,
    totalMade: made,
    unlocated,
    shotTypes: [...byType.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.attempts - a.attempts),
  };
}
