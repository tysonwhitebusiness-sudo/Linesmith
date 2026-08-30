/**
 * The database-free half of NHL's shot profile — Phase 6.7's shapes and grid.
 *
 * SPLIT OUT FOR THE REASON `pitchProfileShapes.ts` IS. `shotProfile.ts`
 * value-imports `pgAll`; anything a `'use client'` component reaches must not,
 * or Next bundles `pg` for the browser and every page importing it dies with
 * `Module not found: Can't resolve 'dns'`. That happened twice in Phase 6,
 * survived six commits, and passed `tsc` plus every unit test both times.
 * `tests/client-bundle-boundary.test.ts` enforces the split.
 *
 * ============ THE COORDINATE TRAP, MEASURED ON REAL ROWS ===================
 *
 * `x_coord` runs -100..100 with the goals at +/-89, and **its sign depends on
 * which end the shooting team is attacking**. Both teams shoot in every period
 * and they attack opposite ends, so a naive average over a season lands near
 * zero and a shot map folds into a symmetric blur centred on the red line.
 *
 * Measured on one real ingested game: mean `x` by period ran -12, -10, +16, -3,
 * -32 — all near centre ice, all meaningless — while mean `|x|` was a steady
 * 53-70, and offensive-zone shots averaged **|x| = 59**, about thirty feet out
 * from the goal line. The absolute value is the real signal.
 *
 * So normalisation is a 180-degree ROTATION, not just `abs(x)`: switching ends
 * mirrors both axes, so a shot at (-73, 11) is the same shot as (73, -11).
 * Negating only x would mirror the rink left-to-right and put a right-wing shot
 * on the left wing.
 * ===========================================================================
 *
 * BLOCKED SHOTS CARRY THE BLOCKING TEAM AS `team_id`, observed rather than
 * assumed: blocked-shot rows come back with `zone_code = 'D'`, which only makes
 * sense from the defending side, while shots on goal read 'O'. `shooter_id` is
 * still the shooter, so a per-player map is correct — but anything keying a
 * shot map on `team_id` must exclude blocked shots or it will credit them to
 * the defence.
 */

/** One shot as the table stores it, before normalisation. */
export interface NhlShotRow {
  eventType: string;
  xCoord: number | null;
  yCoord: number | null;
  /** The NHL API's own vocabulary: wrist, snap, slap, tip-in, backhand, deflected. */
  shotType?: string | null;
}

export interface ShotZoneCell {
  key: string;
  /** Shots from this cell as a percentage of all placed shots. */
  share: number;
  shots: number;
  goals: number;
  onGoal: number;
}

export interface NhlShotProfile {
  /** Row-major 3x3: rows are distance bands (closest first), columns left→right. */
  cells: ShotZoneCell[][];
  rowLabels: string[];
  columnLabels: string[];
  totalShots: number;
  totalGoals: number;
  onGoal: number;
  /**
   * Shot-type mix — NHL's `usageMix`.
   *
   * COUNTED OVER EVERY SHOT, INCLUDING UNPLACED ONES, deliberately unlike the
   * grid beside it: a shot the feed did not locate still has a type, and
   * dropping it would report a total the player did not take.
   */
  shotTypes: Array<{ type: string; shots: number; goals: number }>;
}

/** The goal line, in the API's own units. */
const GOAL_LINE_X = 89;
/** Slot / high slot / point, as distance from the goal line in feet. */
const CLOSE_FT = 25;
const MID_FT = 45;
/** The width of the offensive slot, in the API's y units (rink half-width 42.5). */
const SLOT_Y = 12;

const ROW_LABELS = ['Slot', 'High slot', 'Point'];
const COLUMN_LABELS = ['Left', 'Centre', 'Right'];

/**
 * A shot normalised to one attacking end.
 *
 * `null` when either coordinate is missing — a shot with no location is not a
 * shot at the centre of the rink, and defaulting would pile phantom attempts
 * into one cell where they read as a real tendency.
 */
export function normaliseShot(x: number | null, y: number | null): { x: number; y: number } | null {
  if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  // 180-degree rotation, not a left-right mirror. See the header.
  return x < 0 ? { x: -x, y: -y } : { x, y };
}

/** 0 = slot, 1 = high slot, 2 = point, by distance from the goal line. */
function rowFor(x: number): number {
  const distance = Math.abs(GOAL_LINE_X - x);
  if (distance <= CLOSE_FT) return 0;
  if (distance <= MID_FT) return 1;
  return 2;
}

function columnFor(y: number): number {
  if (y < -SLOT_Y) return 0;
  if (y <= SLOT_Y) return 1;
  return 2;
}

/**
 * `null` when nothing is placeable — an empty 3x3 under a "Shot location"
 * heading says less than no card at all.
 */
export function toNhlShotProfile(rows: readonly NhlShotRow[]): NhlShotProfile | null {
  const cells: ShotZoneCell[][] = ROW_LABELS.map((_, r) =>
    COLUMN_LABELS.map((__, c) => ({ key: `${r}-${c}`, share: 0, shots: 0, goals: 0, onGoal: 0 })),
  );

  let total = 0;
  let goals = 0;
  let onGoal = 0;

  const byType = new Map<string, { shots: number; goals: number }>();
  for (const row of rows) {
    // Counted BEFORE the placement guard -- see `shotTypes` on the interface.
    const st = typeof row.shotType === 'string' && row.shotType ? row.shotType : 'unknown';
    const acc = byType.get(st) ?? { shots: 0, goals: 0 };
    acc.shots += 1;
    if (row.eventType === 'goal') acc.goals += 1;
    byType.set(st, acc);

    const p = normaliseShot(row.xCoord, row.yCoord);
    if (!p) continue;
    const cell = cells[rowFor(p.x)][columnFor(p.y)];
    cell.shots += 1;
    total += 1;
    // The feed's own vocabulary. A goal IS a shot on goal, which is how every
    // hockey shooting percentage is defined — counting them separately would
    // understate the on-goal rate by exactly the goals.
    if (row.eventType === 'goal') {
      cell.goals += 1;
      goals += 1;
    }
    if (row.eventType === 'goal' || row.eventType === 'shot-on-goal') {
      cell.onGoal += 1;
      onGoal += 1;
    }
  }

  if (total === 0) return null;
  for (const row of cells) for (const cell of row) cell.share = (cell.shots / total) * 100;

  return {
    cells,
    rowLabels: ROW_LABELS,
    columnLabels: COLUMN_LABELS,
    totalShots: total,
    totalGoals: goals,
    onGoal,
    shotTypes: [...byType.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.shots - a.shots),
  };
}
