/**
 * Visual language for a single history result.
 *
 * Golf's convention is carried over exactly — circle for birdie-or-better,
 * square for bogey-or-worse, plain for par. Other sports get an equivalent
 * simple language rather than golf's iconography forced onto them.
 */

export type MarkShape = 'circle' | 'square' | 'plain' | 'dot' | 'hollow' | 'cross';
export type MarkTone = 'good' | 'bad' | 'neutral';

export interface MarkStyle {
  shape: MarkShape;
  tone: MarkTone;
}

const MARKS: Record<string, MarkStyle> = {
  // Golf
  birdie: { shape: 'circle', tone: 'good' },
  par: { shape: 'plain', tone: 'neutral' },
  bogey: { shape: 'square', tone: 'bad' },

  // MLB — batting
  hit: { shape: 'dot', tone: 'good' },
  'no-hit': { shape: 'hollow', tone: 'neutral' },

  // MLB — pitching (a run allowed is the bad outcome)
  run: { shape: 'cross', tone: 'bad' },
  'no-run': { shape: 'dot', tone: 'good' },
};

export function markFor(category: string): MarkStyle {
  return MARKS[category] ?? { shape: 'plain', tone: 'neutral' };
}

export const TONE_CLASS: Record<MarkTone, string> = {
  good: 'text-good border-good',
  bad: 'text-bad border-bad',
  neutral: 'text-ink-muted border-line',
};
