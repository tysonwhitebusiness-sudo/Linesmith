/**
 * Soccer's shot map — Phase 6.9, and it needs no new endpoint.
 *
 * The task describes fetching "Understat's match/shot endpoints". Measured:
 * `/getPlayerData/{id}`, which `fetchUnderstatPlayerMatches` ALREADY calls and
 * caches for its `matches` array, returns a `shots` array in the same payload —
 * 1,296 of them for Salah, each carrying `X`, `Y`, `xG`, `result`, `situation`,
 * `shotType` and `season`. So this is a parse, not an integration.
 *
 * COVERAGE CAVEAT, and it is the task's own: Understat is **big-five-leagues
 * only**. EPL gets a shot map; MLS is sourced from American Soccer Analysis
 * (`americanSocceranalysis.ts`) and has no shot coordinates at all. The MLS tab
 * must therefore render no grid rather than an empty one, which is what a
 * `null` role already does.
 *
 * ============ THE COORDINATES, AND WHY THE BANDS ARE WHERE THEY ARE ========
 *
 * `X` and `Y` are normalised 0-1 over a 105m x 68m pitch, with the attacking
 * goal ALWAYS at X=1 regardless of which side the player was on — Salah's own
 * shots span X 0.454-0.996, entirely in the attacking half, which is what
 * confirms the normalisation rather than assuming it.
 *
 * The bands are real pitch geometry, not round numbers:
 *
 *   Penalty box depth 16.5m  ->  X >= (105 - 16.5) / 105 = 0.843
 *   Penalty box width 40.3m  ->  Y in 0.204 .. 0.796, thirds at 0.401 / 0.599
 *
 * so the rows are "inside the box", "just outside", "long range", and the
 * columns are the box's own left/central/right thirds extended across the
 * pitch. A grid on arbitrary thirds would put the penalty spot on a boundary.
 * ===========================================================================
 *
 * WHAT THE CELLS SHOW IS SHOT SHARE, NOT xG. Mean xG per cell is very nearly a
 * function of the cell itself — that is what an expected-goals model computes —
 * so it reads almost identically for every player and answers nothing. Where a
 * player actually shoots from is specific to them, and is what "shot location"
 * means. The mean xG and conversion travel in the caption, where they are
 * context rather than the subject.
 *
 * No database import: this is a pure transform, imported by a client-reachable
 * adapter.
 */

/** One shot as Understat reports it. Every numeric field arrives as a string. */
export interface UnderstatShot {
  X: string | number;
  Y: string | number;
  xG: string | number;
  result: string;
  season?: string;
  /** Understat's own vocabulary: Head, LeftFoot, RightFoot, OtherBodyPart. */
  shotType?: string;
}

export interface ShotGridCell {
  key: string;
  /** Shots from this cell as a percentage of all shots placed. */
  share: number;
  shots: number;
  goals: number;
  /** Mean xG of shots from this cell. `null` when the cell is empty. */
  meanXg: number | null;
}

export interface ShotGrid {
  /** Row-major, 3x3: rows are distance bands (closest first), columns left→right. */
  cells: ShotGridCell[][];
  rowLabels: string[];
  columnLabels: string[];
  totalShots: number;
  totalGoals: number;
  /** Mean xG across every placed shot. `null` when there are none. */
  meanXg: number | null;
  /** Seasons the shots span, ascending. */
  seasons: string[];
  /**
   * Shot type mix — soccer's `usageMix`. Understat's own vocabulary
   * ('Head', 'LeftFoot', 'RightFoot', 'OtherBodyPart'), counted from the same
   * shots the grid places.
   *
   * COUNTED OVER PLACED SHOTS ONLY, so the shares sum to 100 against
   * `totalShots` and agree with the grid beside them. A shot with unusable
   * coordinates is dropped from both, not from one.
   */
  shotTypes: Array<{ type: string; shots: number; goals: number; xgSum: number; xgCount: number }>;
}

/**
 * A 0-1 pitch coordinate, or `null` if the value cannot be one.
 *
 * `Number('')` IS 0, AND 0 IS FINITE. A bare `Number.isFinite` guard therefore
 * accepts an empty coordinate and places the shot on the player's own goal
 * line, in the long-range band — a real shooting tendency invented out of a
 * blank field. Caught by a test, not by reading the code.
 *
 * The range check earns its keep for the same reason: Understat normalises to
 * 0-1, so anything outside it is a parse failure rather than an unusual shot.
 */
function pitchCoord(raw: string | number): number | null {
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n;
}

/** Penalty box depth, as a fraction of pitch length from the attacking goal. */
const BOX_X = (105 - 16.5) / 105;
/** Just outside the box — a band wide enough to hold real long-range attempts. */
const OUTSIDE_X = 0.75;
/** The penalty box's own left/central/right thirds, as pitch-width fractions. */
const LEFT_Y = 0.401;
const RIGHT_Y = 0.599;

const ROW_LABELS = ['In the box', 'Box edge', 'Long range'];
const COLUMN_LABELS = ['Left', 'Central', 'Right'];

/** 0 = in the box, 1 = box edge, 2 = long range. */
function rowFor(x: number): number {
  if (x >= BOX_X) return 0;
  if (x >= OUTSIDE_X) return 1;
  return 2;
}

/**
 * Left/central/right FROM THE ATTACKING PLAYER'S VIEW.
 *
 * Understat's Y increases across the pitch in a fixed direction, so this is a
 * stable mapping, but which side a reader calls "left" depends on where they
 * imagine standing. The caption says which; the grid does not guess.
 */
function columnFor(y: number): number {
  if (y < LEFT_Y) return 0;
  if (y <= RIGHT_Y) return 1;
  return 2;
}

/**
 * `null` when there are no usable shots — an empty 3x3 under a "Shot location"
 * heading says less than no card, and MLS reaches exactly that state.
 */
export function toShotGrid(shots: readonly UnderstatShot[]): ShotGrid | null {
  const cells: ShotGridCell[][] = ROW_LABELS.map((_, r) =>
    COLUMN_LABELS.map((__, c) => ({ key: `${r}-${c}`, share: 0, shots: 0, goals: 0, meanXg: null })),
  );

  let total = 0;
  let goals = 0;
  let xgSum = 0;
  let xgCount = 0;
  const xgByCell = new Map<string, { sum: number; n: number }>();
  const seasons = new Set<string>();
  const byType = new Map<string, { shots: number; goals: number; xgSum: number; xgCount: number }>();

  for (const s of shots) {
    const x = pitchCoord(s.X);
    const y = pitchCoord(s.Y);
    // A shot with unusable coordinates is dropped rather than defaulted to the
    // centre, which would pile every bad row into one cell and read as a real
    // tendency.
    if (x == null || y == null) continue;

    const cell = cells[rowFor(x)][columnFor(y)];
    cell.shots += 1;
    total += 1;
    // Understat's own vocabulary — 'Goal' is the only scoring result; the rest
    // are MissedShots, SavedShot, BlockedShot, ShotOnPost.
    if (s.result === 'Goal') {
      cell.goals += 1;
      goals += 1;
    }
    if (s.season) seasons.add(String(s.season));

    // Counted INSIDE the placed-shot branch so the mix and the grid always
    // describe the same set of shots.
    const shotType = typeof s.shotType === 'string' && s.shotType ? s.shotType : 'Unknown';
    const tacc = byType.get(shotType) ?? { shots: 0, goals: 0, xgSum: 0, xgCount: 0 };
    tacc.shots += 1;
    if (s.result === 'Goal') tacc.goals += 1;
    const typeXg = Number(s.xG);
    if (Number.isFinite(typeXg)) {
      tacc.xgSum += typeXg;
      tacc.xgCount += 1;
    }
    byType.set(shotType, tacc);

    const xg = Number(s.xG);
    if (Number.isFinite(xg)) {
      xgSum += xg;
      xgCount += 1;
      const acc = xgByCell.get(cell.key) ?? { sum: 0, n: 0 };
      acc.sum += xg;
      acc.n += 1;
      xgByCell.set(cell.key, acc);
    }
  }

  if (total === 0) return null;

  for (const row of cells) {
    for (const cell of row) {
      cell.share = (cell.shots / total) * 100;
      const acc = xgByCell.get(cell.key);
      cell.meanXg = acc && acc.n > 0 ? acc.sum / acc.n : null;
    }
  }

  return {
    cells,
    rowLabels: ROW_LABELS,
    columnLabels: COLUMN_LABELS,
    totalShots: total,
    totalGoals: goals,
    meanXg: xgCount > 0 ? xgSum / xgCount : null,
    seasons: [...seasons].sort(),
    shotTypes: [...byType.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.shots - a.shots),
  };
}
