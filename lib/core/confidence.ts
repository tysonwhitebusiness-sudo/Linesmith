/**
 * Turns a model probability for the side actually picked (always ≥ 50%,
 * since a "pick" is by definition whichever side the model favors) into a
 * letter grade and a whole-percent confidence — the same scale used for
 * moneyline winner picks and total (O/U) leans, so a "B+" reads the same way
 * in both places.
 *
 * Tiers are deliberately generous at the top: MLB moneyline win
 * probabilities rarely clear 75% (a huge favorite still loses ~1 game in 4),
 * so a scale borrowed from a coin-flip-adjacent sport would leave every pick
 * bunched in the bottom two grades.
 */
export interface ConfidenceGrade {
  letter: string;
  pct: number;
}

const TIERS: Array<[minPct: number, letter: string]> = [
  [85, 'A+'],
  [75, 'A'],
  [68, 'B+'],
  [62, 'B'],
  [56, 'C+'],
  [0, 'C'],
];

export function gradeConfidence(probOfPickedSide: number): ConfidenceGrade {
  const pct = Math.round(Math.min(0.999, Math.max(0.5, probOfPickedSide)) * 100);
  const letter = TIERS.find(([min]) => pct >= min)?.[1] ?? 'C';
  return { letter, pct };
}
