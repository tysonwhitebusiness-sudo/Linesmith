/**
 * NFL's grade struct -> the shared `UnitGrade[]`. Phase 6.1, MOVED HERE 6.13.
 *
 * WHY THIS IS ITS OWN FILE. It lived in `nflTeamGrades.ts`, which imports
 * `readSnapshotCache`/`writeSnapshotCache` from `lib/db/client.ts` — and that
 * pulls in `pg`, which needs `dns`/`fs`/`net`/`tls`. Before 6.1 the NFL
 * adapters only did `import type { TeamGrade }` from that module, which the
 * compiler erases. 6.1 added a VALUE import (`toNflUnitGrades`), and a value
 * import is not erased: it dragged `pg` into the client bundle and every page
 * importing `GameDetail.tsx` 500ed with `Module not found: Can't resolve 'dns'`.
 *
 * `tsc --noEmit` passes that without complaint — it is a bundling boundary,
 * not a type error — and so do all 103 unit tests. Only a real build or a
 * running dev server surfaces it, which is why it survived until the dev
 * server was free to start.
 *
 * **The rule: a `'use client'` component, or anything it imports, must never
 * take a VALUE import from a module that reaches the database.** Types are
 * fine; functions are not. This file holds only the pure conversion, so it is
 * safe to import from anywhere.
 */

import type { TeamGrades } from './nflTeamGrades';
import type { UnitGrade } from '@/lib/sports/shared/unitGrades';

/**
 * The nine NFL units, in the order they render — previously
 * `GameDetail.tsx`'s `GRADE_ROWS` constant, which typed its keys as
 * `keyof TeamGrades` and so could only ever list NFL's.
 *
 * `short` decides which units appear in the compact header chip row; the three
 * that carry one are exactly the three `TeamDetail.tsx` used to hardcode as
 * `<GradeChip label="OFF">`/`"DEF"`/`"ST"`.
 */
export const NFL_UNITS: ReadonlyArray<{ key: keyof TeamGrades; label: string; short?: string }> = [
  { key: 'offense', label: 'Offense', short: 'OFF' },
  { key: 'defense', label: 'Defense', short: 'DEF' },
  { key: 'specialTeams', label: 'Special teams', short: 'ST' },
  { key: 'passingOffense', label: 'Passing offense' },
  { key: 'rushingOffense', label: 'Rushing offense' },
  { key: 'receivingOffense', label: 'Receiving offense' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'linebackers', label: 'Linebackers' },
  { key: 'dLine', label: 'D-line' },
];

/**
 * NFL's struct -> the shared ordered array. A unit NFL computed as `null`
 * (not enough ranked players in that pool) is dropped rather than emitted with
 * a placeholder grade, matching the "never fabricate a field to satisfy the
 * type" rule — the grades table renders an em-dash for a unit one side lacks,
 * same as it did before.
 *
 * Returns `null` for no grades at all, so `data.unitGrades ? <Section/> : null`
 * still reads as "this sport has no grading model".
 */
export function toNflUnitGrades(grades: TeamGrades | null | undefined): UnitGrade[] | null {
  if (!grades) return null;
  const out: UnitGrade[] = [];
  for (const unit of NFL_UNITS) {
    const g = grades[unit.key];
    if (!g) continue;
    out.push({
      key: unit.key,
      label: unit.label,
      ...(unit.short ? { short: unit.short } : {}),
      grade: g.grade,
      composite: g.composite,
      rank: g.rank,
      poolSize: g.poolSize,
    });
  }
  return out.length > 0 ? out : null;
}
