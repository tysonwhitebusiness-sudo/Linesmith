import type { TeamGrade } from '@/lib/sports/nfl/nflTeamGrades';

/**
 * NFL's unit-grade chip (OFF/DEF/ST letter grades) — extracted out of
 * `NflGameHeroCard.tsx` so it survives that file's deletion once NFL's hero
 * card moves onto the generic `GameHeroCard` (its own `renderBadges` slot).
 * Also used directly by `NflTeamDetail.tsx`, unrelated to the hero card.
 */
export function GradeChip({ label, grade }: { label: string; grade: TeamGrade | null }) {
  if (!grade) return null;
  return (
    <span className="lb-chip bg-ink/5 text-[10px] font-semibold text-ink-muted" title={`${label}: rank ${grade.rank} of ${grade.poolSize}`}>
      {label} {grade.grade}
    </span>
  );
}
