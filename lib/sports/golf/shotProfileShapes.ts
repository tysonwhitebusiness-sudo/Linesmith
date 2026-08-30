/**
 * The database-free half of golf's shot profile — Phase 6.13's last two role
 * cells, `usageMix` and `spatialGrid`.
 *
 * Split out for the reason `targetMapShapes.ts` and `pitchProfileShapes.ts`
 * are: `shotProfile.ts` value-imports `pgAll` and client-reachable code must
 * not.
 *
 * ================== THE LIE IS `from`, AND IT IS THE AXIS =================
 *
 * The source has a column literally named `lie` and it is the string "NA" on
 * every one of a real tournament's 10,222 rows. The vocabulary lives in
 * `from`/`to`, which the loader stores as `from_lie`/`to_lie`. Measured, not
 * assumed.
 *
 * PROXIMITY IS `left`, THE DISTANCE REMAINING AFTER THE SHOT — not the shot's
 * own length. "Proximity by lie" is a question about where you finish, and a
 * 280-yard drive that ends in the trees is a bad shot with a big `distance`.
 *
 * PUTTS ARE EXCLUDED FROM THE GRID AND INCLUDED IN THE MIX, and the split is
 * deliberate. A putt's proximity is measured in feet against an approach's
 * tens of yards, so putting them in one grid makes every approach band read as
 * "far" — but roughly 40% of a round's strokes ARE putts, so dropping them
 * from the mix would misdescribe where the work happens. Each card says which
 * it counts.
 * =========================================================================
 */

import type { SpatialGridRole, UsageMixRole } from '@/lib/sports/shared/playerRoles';
import { MIDDOT, fmt } from '@/components/charts/tokens';

export interface GolfShotRow {
  fromLie: string | null;
  leftYds: number | null;
  distanceYds: number | null;
  isPutt: boolean;
}

/**
 * PGA's lie codes, in the order a hole is actually played. Anything not listed
 * is folded into "Other" rather than dropped — an unfamiliar code is still a
 * real shot, and silently discarding it would make the shares wrong.
 */
const LIE_LABELS: Record<string, string> = {
  OTB: 'Tee',
  OFW: 'Fairway',
  OIR: 'Light rough',
  ORO: 'Rough',
  OGS: 'Greenside sand',
  OST: 'Fairway sand',
  ONA: 'Native area',
  OCO: 'Collar',
  OGR: 'Green',
};
const LIE_ORDER = ['OTB', 'OFW', 'OIR', 'ORO', 'OGS', 'OST', 'ONA', 'OCO', 'OGR'];

/** Proximity bands in YARDS. The first is roughly "inside ten feet". */
const PROXIMITY_BANDS: Array<{ key: string; label: string; max: number }> = [
  { key: 'p1', label: 'Inside 3 yd', max: 3 },
  { key: 'p2', label: '3–10 yd', max: 10 },
  { key: 'p3', label: '10–30 yd', max: 30 },
  { key: 'p4', label: 'Over 30 yd', max: Number.POSITIVE_INFINITY },
];

function lieLabel(code: string): string {
  return LIE_LABELS[code] ?? 'Other';
}

function bandFor(leftYds: number): number {
  return PROXIMITY_BANDS.findIndex((b) => leftYds < b.max);
}

/**
 * ROLE 2 · `usageMix` — where this player's strokes are played from.
 *
 * `null` when nothing has a lie on record. Counts EVERY shot including putts;
 * see the header for why that differs from the grid.
 */
export function toGolfUsageMix(rows: readonly GolfShotRow[]): UsageMixRole | null {
  const byLie = new Map<string, { shots: number; leftSum: number; leftCount: number }>();
  let total = 0;
  for (const r of rows) {
    if (!r.fromLie) continue;
    total += 1;
    const acc = byLie.get(r.fromLie) ?? { shots: 0, leftSum: 0, leftCount: 0 };
    acc.shots += 1;
    // Mean proximity carries its OWN count: not every shot records a
    // remaining distance, so quoting the shot count beside it would overstate
    // the sample. Same rule MLB's mix documents for xwOBA.
    if (r.leftYds != null && Number.isFinite(r.leftYds)) {
      acc.leftSum += r.leftYds;
      acc.leftCount += 1;
    }
    byLie.set(r.fromLie, acc);
  }
  if (total === 0) return null;

  const slices = [...byLie.entries()]
    .sort((a, b) => {
      const ia = LIE_ORDER.indexOf(a[0]);
      const ib = LIE_ORDER.indexOf(b[0]);
      // Known lies in playing order; unknown codes after them, by volume.
      if (ia === -1 && ib === -1) return b[1].shots - a[1].shots;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map(([code, v]) => ({
      key: code,
      label: lieLabel(code),
      share: (v.shots / total) * 100,
      value: v.leftCount > 0 ? v.leftSum / v.leftCount : undefined,
      valueLabel: 'avg left',
      decimals: 1,
      valueSample: v.leftCount,
    }));

  return {
    title: 'Shots by lie',
    slices,
    valueFormat: fmt.one,
    sampleSize: total,
    emptyMessage: 'No shot lies on record for this player.',
  };
}

/**
 * ROLE 3 · `spatialGrid` — proximity by lie.
 *
 * Rows are lies, columns are how close the shot finished. `null` when no
 * non-putt shot has both a lie and a remaining distance.
 */
export function toGolfProximityGrid(rows: readonly GolfShotRow[]): SpatialGridRole | null {
  const approaches = rows.filter(
    (r) => !r.isPutt && r.fromLie && r.leftYds != null && Number.isFinite(r.leftYds),
  );
  if (approaches.length === 0) return null;

  // Only lies this player actually played from — an empty row for every code
  // in the vocabulary would be nine rows of nothing on most cards.
  const lies = LIE_ORDER.filter((code) => approaches.some((r) => r.fromLie === code));
  const extras = [...new Set(approaches.map((r) => r.fromLie!).filter((c) => !LIE_ORDER.includes(c)))];
  const rowCodes = [...lies, ...extras];
  if (rowCodes.length === 0) return null;

  const counts = new Map<string, number[]>(rowCodes.map((c) => [c, PROXIMITY_BANDS.map(() => 0)]));
  for (const r of approaches) {
    const band = bandFor(r.leftYds!);
    if (band === -1) continue;
    counts.get(r.fromLie!)![band] += 1;
  }

  const cells = rowCodes.map((code) => {
    const row = counts.get(code)!;
    const rowTotal = row.reduce((s, n) => s + n, 0);
    return row.map((n, i) => ({
      key: `${code}-${i}`,
      // Share WITHIN the lie, not of all shots: the question is "from the
      // rough, how often does he finish close", and a share of the whole round
      // would answer "how often is he in the rough" instead.
      value: rowTotal > 0 ? (n / rowTotal) * 100 : null,
      sampleSize: n,
    }));
  });

  const bandedTotal = approaches.length;
  return {
    title: 'Proximity by lie',
    cells,
    rowLabels: rowCodes.map(lieLabel),
    columnLabels: PROXIMITY_BANDS.map((b) => b.label),
    format: fmt.pct0,
    unit: 'of shots from that lie',
    caption: [
      `${bandedTotal.toLocaleString()} approach shots`,
      // Says out loud that putts are not here, because the mix beside it
      // counts them and the two totals will not agree.
      'putts excluded',
    ].join(` ${MIDDOT} `),
    emptyMessage: 'No approach shots on record for this player.',
  };
}
