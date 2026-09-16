/**
 * The shape of one Understat shot, and what its coordinates mean.
 *
 * ============ THE COORDINATES ============================================
 *
 * `X` and `Y` are normalised 0-1 over a 105m x 68m pitch, with the attacking
 * goal ALWAYS at X=1 regardless of which side the player was on — Salah's own
 * shots span X 0.454-0.996, entirely in the attacking half, which is what
 * confirms the normalisation rather than assuming it. Real geometry on that
 * scale, which `components/charts/PitchScatter.tsx` draws:
 *
 *   Penalty box depth 16.5m  ->  X >= (105 - 16.5) / 105 = 0.843
 *   Penalty box width 40.3m  ->  Y in 0.204 .. 0.796
 *   Six-yard box             ->  X >= 0.948, Y in 0.366 .. 0.634
 *   Penalty spot 11m out     ->  X = 0.895
 *
 * A NEGATIVE-SPACE SHOT IS REAL: an own goal sits at the wrong end (Jordan
 * Pickford's only "shot" is one, at X 0.03), which is why the player page's
 * read keeps the attacking half and a keeper gets no shot map at all.
 *
 * ROUTE MIX AND THE 3x3 GRID ARE GONE. Phase 6.9 aggregated these shots into a
 * nine-cell share grid for the prop block; R6.3's "Chances & finishing" draws
 * every shot at its own place, so the grid (`toShotGrid`) and its test were
 * deleted rather than left as a second, coarser answer.
 * ========================================================================
 */

export interface UnderstatShot {
  X: string | number;
  Y: string | number;
  xG: string | number;
  result: string;
  season?: string;
  /** Understat's own vocabulary: Head, LeftFoot, RightFoot, OtherBodyPart. */
  shotType?: string;
}
