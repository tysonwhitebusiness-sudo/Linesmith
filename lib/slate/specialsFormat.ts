/**
 * How each factor's raw value reads. The job stores two percentages already
 * multiplied by 100 and one as a fraction; printed bare, "4.57" under HR/PA
 * reads as four home runs a plate appearance. TS-only, because it is display.
 */
export const FACTOR_FORMAT: Record<string, 'pct' | 'fraction-pct'> = {
  hr_per_pa: 'pct',
  vs_hand_hr_pa: 'pct',
  team_share: 'pct',
  opp_staff_hr_rate: 'fraction-pct',
};

export function formatFactor(key: string, v: number | null | undefined): string {
  if (v == null) return '—';
  const f = FACTOR_FORMAT[key];
  if (f === 'pct') return `${v.toFixed(1)}%`;
  if (f === 'fraction-pct') return `${(v * 100).toFixed(1)}%`;
  return Math.abs(v) >= 10 ? v.toFixed(1) : Number.isInteger(v) ? String(v) : v.toFixed(2);
}
