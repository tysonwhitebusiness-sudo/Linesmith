/**
 * How each factor's raw value reads. The job stores two percentages already
 * multiplied by 100 and one as a fraction; printed bare, "4.57" under HR/PA
 * reads as four home runs a plate appearance. TS-only, because it is display.
 */
export const FACTOR_FORMAT: Record<string, 'pct' | 'fraction-pct'> = {
  hr_per_pa: 'pct',
  vs_hand_hr_pa: 'pct',
  team_share: 'pct',
  barrel_pct: 'pct',
  opp_k_pct: 'pct',
  opp_staff_hr_rate: 'fraction-pct',
};

/**
 * PLAIN UNITS (slate-polish v4, operator-approved 2026-09-26): a number the
 * reader can say out loud, so a column needs no explainer under it. "1.25"
 * under Park had to be decoded; "+25%" is runs against an average park. Only
 * factors whose stored scale was measured get a unit — the rest print bare
 * rather than carry a guessed one.
 */
const PLAIN: Record<string, (v: number) => string> = {
  // A run-scoring factor, 1.00 = average.
  park_factor: (v) => {
    const d = Math.round((v - 1) * 100);
    return d === 0 ? 'Avg' : `${d > 0 ? '+' : '−'}${Math.abs(d)}%`;
  },
  // The share of games the opposing staff allows a homer, stored as a fraction.
  opp_staff_hr_rate: (v) => `${Math.round(v * 100)}%`,
  // Signed: positive is blowing out, negative in.
  wind_out: (v) => (v > 0.5 ? `${Math.round(v)} mph` : v < -0.5 ? `${Math.round(Math.abs(v))} mph in` : 'Calm'),
  temp_f: (v) => `${Math.round(v)}°`,
  slg_vs_hand: (v) => v.toFixed(3).replace(/^0/, ''),
  avg_hr_dist: (v) => `${Math.round(v)} ft`,
};

export function formatFactor(key: string, v: number | null | undefined): string {
  if (v == null) return '—';
  const plain = PLAIN[key];
  if (plain) return plain(v);
  const f = FACTOR_FORMAT[key];
  if (f === 'pct') return `${v.toFixed(1)}%`;
  if (f === 'fraction-pct') return `${(v * 100).toFixed(1)}%`;
  return Math.abs(v) >= 10 ? v.toFixed(1) : Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/**
 * VISIBLE SOURCE CREDIT, required by licence. TML-Database and the Tennis
 * Abstract Match Charting Project are both CC BY-NC-SA 4.0, and "BY" means
 * attribution wherever the data is SHOWN — a tooltip naming TML was not that.
 * The Charting Project's own README: "Attribution is required. Non-commercial
 * use only." Keyed by ranking id so a card prints the credit for exactly the
 * data it drew. `tests/tennis-stats.test.ts` pins both.
 */
export const SOURCE_CREDIT: Record<string, string> = {
  'tennis-serve-return':
    'Serve data: TML-Database and the Tennis Abstract Match Charting Project, both based on the work of Jeff Sackmann, CC BY-NC-SA 4.0.',
  'tennis-surface-record': 'Serve data: TML-Database, based on the work of Jeff Sackmann, CC BY-NC-SA 4.0.',
};
