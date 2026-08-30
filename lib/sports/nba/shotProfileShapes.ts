/**
 * The database-free half of NBA's shot profile — Phase 6.7's shapes and grid.
 *
 * Split out for the reason `pitchProfileShapes.ts` and `nhl/shotProfileShapes.ts`
 * are: `shotProfile.ts` value-imports `pgAll`, and anything a `'use client'`
 * component reaches must not. `tests/client-bundle-boundary.test.ts` enforces it.
 *
 * ============ GEOMETRY, ESTABLISHED FROM GROUND TRUTH ======================
 *
 * The basket is at (25, 0) and the units are FEET. That was not assumed — it
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
const RIM_X = 25;
const RIM_Y = 0;

/** Distance bands, in feet. The restricted area, the paint, mid-range, and beyond the arc. */
const BANDS: Array<{ label: string; max: number }> = [
  { label: 'At the rim', max: 4 },
  { label: 'Paint', max: 15 },
  { label: 'Mid-range', max: 22 },
  { label: 'Three-point', max: Number.POSITIVE_INFINITY },
];

const COLUMN_LABELS = ['Share'];

export function shotDistance(x: number, y: number): number {
  return Math.hypot(x - RIM_X, y - RIM_Y);
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
    const d = shotDistance(r.xCoord, r.yCoord);
    const bandIndex = BANDS.findIndex((b) => d <= b.max);
    const cell = cells[bandIndex === -1 ? BANDS.length - 1 : bandIndex][0];
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
