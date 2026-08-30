/**
 * The database-free half of NFL's target map — Phase 6.8's shapes and grid.
 *
 * Split out for the reason `pitchProfileShapes.ts` is: `targetMap.ts`
 * value-imports `pgAll` and client-reachable code must not.
 *
 * ============ THE GRID IS DEPTH x FIELD SIDE, AND BOTH ARE REAL ===========
 *
 * nflverse gives `pass_location` (left/middle/right) and `pass_length`
 * (short/deep) directly, and the two together are exactly the target map. The
 * split is not arbitrary — measured over a real season's 17,848 targets, short
 * passes averaged 3.2-6.1 air yards and deep passes 24.2-24.9. Those are two
 * genuinely different plays, not a threshold someone picked.
 *
 * ROWS ARE DEEP-FIRST so the grid reads like the field seen from the
 * quarterback: downfield at the top, at the line underneath. Reversing it puts
 * a bomb below a screen and inverts the picture a reader builds.
 *
 * A NEGATIVE AIR-YARD IS A SCREEN AND IS REAL — 3,192 of that season's targets.
 * Nothing here clamps it; the depth band comes from nflverse's own
 * `pass_length`, so a screen sits in `short` where it belongs while its air
 * yards stay negative in the caption's average.
 *
 * ROUTE MIX IS NOT HERE, and cannot be built from this release. The task pairs
 * "target maps and route mix"; play-by-play carries no route running. That
 * needs NFL Next Gen Stats, which is a different source with different terms.
 * ===========================================================================
 */

export interface NflTargetRow {
  passLocation: string | null;
  passLength: string | null;
  airYards: number | null;
  complete: boolean | null;
}

export interface TargetMapCell {
  key: string;
  /** Targets in this cell as a percentage of all placed targets. */
  share: number;
  targets: number;
  completions: number;
  /** Catch rate in this cell, 0-100. `null` when the cell is empty. */
  catchPct: number | null;
}

export interface NflTargetMap {
  /** Row-major: [deep, short] x [left, middle, right]. */
  cells: TargetMapCell[][];
  rowLabels: string[];
  columnLabels: string[];
  totalTargets: number;
  totalCompletions: number;
  /** Mean air yards over targets that carried one. `null` when none did. */
  meanAirYards: number | null;
  /** Targets nflverse did not locate — counted, never placed. */
  unplaced: number;
}

/**
 * The positions a target map describes.
 *
 * `nfl_target_events.receiver_id` is who CAUGHT the pass, so this is not a
 * cost optimisation: seven quarterbacks on one real slate had 2025 target rows
 * (Caleb Williams had two, both caught), and without this gate each would get
 * a card headed "Target map" showing the trick plays thrown TO him — which
 * reads as his passing chart and means the opposite. A card that is real but
 * inverts its own title is worse than no card.
 *
 * Kept beside the grid rather than in the component so `tests/nfl-target-map`
 * can check it against `MARKETS_BY_POSITION`, the independent list that
 * decides who gets receiving markets at all.
 */
export const TARGET_MAP_POSITIONS = ['WR', 'TE', 'RB', 'FB'] as const;

const ROWS = ['deep', 'short'];
const COLUMNS = ['left', 'middle', 'right'];
const ROW_LABELS = ['Deep', 'Short'];
const COLUMN_LABELS = ['Left', 'Middle', 'Right'];

/**
 * `null` when nothing is placeable — an empty grid under a "Target map"
 * heading says less than no card.
 */
export function toNflTargetMap(rows: readonly NflTargetRow[]): NflTargetMap | null {
  const cells: TargetMapCell[][] = ROWS.map((r, ri) =>
    COLUMNS.map((c, ci) => ({ key: `${ri}-${ci}`, share: 0, targets: 0, completions: 0, catchPct: null })),
  );

  let placed = 0;
  let completions = 0;
  let unplaced = 0;
  let airSum = 0;
  let airCount = 0;

  for (const row of rows) {
    if (row.airYards != null && Number.isFinite(row.airYards)) {
      airSum += row.airYards;
      airCount += 1;
    }
    const ri = ROWS.indexOf((row.passLength ?? '').toLowerCase());
    const ci = COLUMNS.indexOf((row.passLocation ?? '').toLowerCase());
    // A target nflverse could not locate is a real target whose position is
    // unknown. Defaulting it to "short middle" — the busiest cell — would make
    // every receiver look more of a possession target than they are.
    if (ri === -1 || ci === -1) {
      unplaced += 1;
      continue;
    }
    const cell = cells[ri][ci];
    cell.targets += 1;
    placed += 1;
    if (row.complete) {
      cell.completions += 1;
      completions += 1;
    }
  }

  if (placed === 0) return null;
  for (const row of cells) {
    for (const cell of row) {
      cell.share = (cell.targets / placed) * 100;
      cell.catchPct = cell.targets > 0 ? (cell.completions / cell.targets) * 100 : null;
    }
  }

  return {
    cells,
    rowLabels: ROW_LABELS,
    columnLabels: COLUMN_LABELS,
    totalTargets: placed,
    totalCompletions: completions,
    meanAirYards: airCount > 0 ? airSum / airCount : null,
    unplaced,
  };
}
