import type { UnitGrade } from '@/lib/sports/shared/unitGrades';

/**
 * A unit's letter-grade chip.
 *
 * Was NFL-only (`TeamGrade`, the nine-field `TeamGrades` struct's member type)
 * — Phase 6.1 retyped it to the sport-neutral `UnitGrade`, so MLB's Hitting
 * and Pitching chips render through the same component with no sport check.
 *
 * `label` is optional and falls back to the unit's own `short` (the compact
 * header row) or `label`. Passing it explicitly stays supported for the one
 * caller that wants a chip with no text of its own (the stat-group heading,
 * which already prints the group name beside it).
 */
export function GradeChip({ label, grade }: { label?: string; grade: UnitGrade | null }) {
  if (!grade) return null;
  const text = label ?? grade.short ?? grade.label;
  return (
    <span
      className="lb-chip bg-ink/5 text-[10px] font-semibold text-ink-muted"
      title={`${grade.label}: rank ${grade.rank} of ${grade.poolSize}`}
    >
      {text ? `${text} ` : ''}
      {grade.grade}
    </span>
  );
}
