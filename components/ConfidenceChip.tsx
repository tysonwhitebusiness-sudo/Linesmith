/**
 * The letter+% confidence badge, shared by every surface that shows a Line
 * Buddy Pick (game detail, the overview cards, Today's Picks, diagnostics)
 * so a "B+" reads the same way everywhere. Filled with a real color — not a
 * neutral chip with small text — so confidence is visible at a glance.
 *
 * Reads off the same shared heat ramp every other quality-score surface
 * uses (ScanCard, StatCells, OddsChip, PropScoreBadge) rather than its own
 * independent HSL calculation — one ramp, one meaning for "how strong".
 */

import { heatFill } from '@/lib/ui/heat';
import { Chip } from './Chip';

export interface ConfidenceChipProps {
  letter: string;
  pct: number;
  size?: 'sm' | 'md';
}

export function ConfidenceChip({ letter, pct, size = 'md' }: ConfidenceChipProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <Chip
      shape="pill"
      size={size}
      style={{ backgroundColor: heatFill(clamped / 100), color: '#fff' }}
      className="font-semibold shadow-sm"
      title={`${pct}% confidence`}
    >
      {letter} · {pct}%
    </Chip>
  );
}

export default ConfidenceChip;
