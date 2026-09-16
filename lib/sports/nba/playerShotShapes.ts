/**
 * NBA's own player-page section, as data: "Shot profile" (R6.5). Spec:
 * `docs/design/phase-g2/src/sports/hoops-hockey.js` (`nbaShotChart`).
 * Database-free, so client code may import it.
 *
 * ============ WHERE THE HOOP IS, MEASURED ON REAL ROWS =====================
 *
 * `nba_shot_events` stores `x_coord` 0-50 across the court and `y_coord` from
 * the RIM, not from the baseline. That is not what the NBA's own public
 * coordinate system does, and getting it wrong silently bends the arc.
 *
 * Measured over all 220,723 rows of the 2026 season by putting the hoop in
 * three places and asking what the closest 3-pointer was — a corner three is
 * 22 ft from the centre of the rim by rule, so the right origin is the one
 * where no 3-pointer is any closer than that:
 *
 *   hoop (25, 5.25): closest 3pt 18.8 ft, 11,516 threes inside 21 ft — impossible
 *   hoop (25, 4.00): closest 3pt 20.0 ft,    516 threes inside 21 ft — impossible
 *   hoop (25, 0.00): closest 3pt 22.0 ft,      0 threes inside 21 ft — exact
 *
 * So the rim is the ORIGIN: `y` is feet out from it. The made rate by 5 ft band
 * then reads as basketball does — 60% / 54% / 43% / 38% / 36% / 32% — which is
 * the second confirmation.
 *
 * ============ WHAT THE TABLE HOLDS ========================================
 *
 * Field-goal attempts only: `point_value` is 2 or 3 and never 1, so free
 * throws are not here and no card may imply they are. 219,873 rows for 2025
 * and 220,723 for 2026, every one of them placed — the plan's premise that
 * these are "2024-25 only" is out of date (measured 2026-09-15).
 * =========================================================================
 */

import { sectionOpeningSeason, type ResearchCard, type ResearchSection } from '@/lib/sports/shared/playerResearchShapes';

/** One field-goal attempt as the table stores it. */
export interface NbaShot {
  date: string;
  season: number;
  /** 0-50 across the court. */
  x: number | null;
  /** Feet out from the centre of the rim. */
  y: number | null;
  pointValue: number | null;
  made: boolean;
  /** ESPN's own vocabulary: "Pullup Jump Shot", "Driving Layup Shot", … */
  shotType: string | null;
  opponent: string | null;
}

export interface NbaShotsPayload {
  shooterId: number;
  seasons: number[];
  shots: NbaShot[];
  asOf: string | null;
}

export interface NbaShotsInput {
  /** The page's scope season (`research.splits.defaultSeason`); opens here when the source holds it. Set by the adapter. */
  scopeSeason?: number | null;
  season: number | null;
  data: NbaShotsPayload | null;
  loading: boolean;
  error: string | null;
  emptyReason?: string;
}

/** The rim is the origin; a corner three is 22 ft from it and the arc is 23.75. */
export const HOOP = { x: 25, y: 0 } as const;
const CORNER_3 = 22;
const ARC_3 = 23.75;
/** The restricted area, where a layup is not a jump shot. */
const RESTRICTED = 4;
/** The paint is 16 ft wide and runs 19 ft from the baseline — 13.75 out from the rim. */
const PAINT_HALF_WIDTH = 8;
const PAINT_OUT = 13.75;

export const shotDistance = (s: Pick<NbaShot, 'x' | 'y'>): number | null =>
  s.x == null || s.y == null ? null : Math.sqrt((s.x - HOOP.x) ** 2 + (s.y - HOOP.y) ** 2);

/**
 * The five zones a shot chart is read in. A corner three is told from an
 * above-the-break three by where it is, not by its distance: the corner line is
 * closer to the rim, which is the whole reason the shot is worth taking.
 */
export type NbaZone = 'restricted' | 'paint' | 'mid' | 'corner3' | 'break3';
const ZONE_LABEL: Record<NbaZone, string> = {
  restricted: 'Restricted area',
  paint: 'Paint (non-RA)',
  mid: 'Mid-range',
  corner3: 'Corner 3',
  break3: 'Above the break 3',
};

export function shotZone(s: NbaShot): NbaZone | null {
  const d = shotDistance(s);
  if (d == null || s.x == null || s.y == null) return null;
  // Trust the league's own point value over the geometry: it is what scored.
  const three = s.pointValue === 3 || d >= CORNER_3 - 0.5;
  if (three) return s.y <= 8.94 && d < ARC_3 + 1.5 ? 'corner3' : 'break3';
  if (d <= RESTRICTED) return 'restricted';
  if (Math.abs(s.x - HOOP.x) <= PAINT_HALF_WIDTH && s.y <= PAINT_OUT) return 'paint';
  return 'mid';
}

/**
 * ESPN names dozens of shots; the families are what a reader compares. Order
 * is the order the card lists them in.
 */
const FAMILIES: Array<{ key: string; label: string; test: (t: string) => boolean }> = [
  { key: 'dunk', label: 'Dunk', test: (t) => t.includes('dunk') },
  { key: 'layup', label: 'Layup', test: (t) => t.includes('layup') || t.includes('finger roll') },
  { key: 'tip', label: 'Tip / putback', test: (t) => t.includes('tip') || t.includes('putback') },
  { key: 'hook', label: 'Hook', test: (t) => t.includes('hook') },
  { key: 'floater', label: 'Floater', test: (t) => t.includes('floating') },
  { key: 'pullup', label: 'Pull-up', test: (t) => t.includes('pullup') || t.includes('pull-up') },
  { key: 'stepback', label: 'Step back', test: (t) => t.includes('step back') || t.includes('stepback') },
  { key: 'fadeaway', label: 'Fadeaway', test: (t) => t.includes('fade') },
  { key: 'jumper', label: 'Jump shot', test: (t) => t.includes('jump') },
];

export function shotFamily(shotType: string | null): { key: string; label: string } {
  const t = (shotType ?? '').toLowerCase();
  for (const f of FAMILIES) if (f.test(t)) return { key: f.key, label: f.label };
  return { key: 'other', label: shotType ? 'Other' : 'Unspecified' };
}

const pct = (n: number, d: number): number | null => (d ? (100 * n) / d : null);

export function nbaShotSection(input: NbaShotsInput): ResearchSection {
  const seasons = input.data?.seasons ?? [];
  const base = {
    id: 'shots',
    navLabel: 'Shot profile',
    title: 'Shot profile',
    sub: 'every field-goal attempt',
    ...(seasons.length
      ? { season: { value: sectionOpeningSeason(seasons, input.season, input.scopeSeason), options: [...seasons].reverse().map((s) => ({ value: s, label: `${s - 1}-${String(s).slice(2)}` })) } }
      : {}),
  };
  if (input.loading) return { ...base, rows: [], state: { kind: 'loading' } };
  if (input.error) return { ...base, rows: [], state: { kind: 'error', message: input.error } };
  if (!input.data || input.data.shots.length === 0) {
    return {
      ...base,
      rows: [],
      state: { kind: 'empty', title: 'No shots held', reason: input.emptyReason ?? 'The shot feed holds no attempts for this player.' },
    };
  }

  const season = sectionOpeningSeason(seasons, input.season, input.scopeSeason);
  const all = input.data.shots.filter((s) => s.season === season);
  const located = all.filter((s) => s.x != null && s.y != null);

  // Groups are the shot families, most common first, which is also the colour order.
  const counts = new Map<string, { label: string; count: number }>();
  for (const s of located) {
    const f = shotFamily(s.shotType);
    const at = counts.get(f.key) ?? { label: f.label, count: 0 };
    at.count += 1;
    counts.set(f.key, at);
  }
  const groups = [...counts.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count);

  const made = located.filter((s) => s.made).length;
  const chart: ResearchCard = {
    kind: 'scatter',
    key: 'chart',
    title: 'Shot chart',
    scope: `${located.length} attempts · ${made} made`,
    caption: 'The rim is at the top; height is feet out from it. A filled dot is a make.',
    surface: 'court',
    points: located.map((s) => [shotFamily(s.shotType).key, s.x as number, s.y as number] as [string, number, number]),
    emphasis: located.map((s) => s.made),
    tips: located.map((s) => [
      `${s.made ? 'Made' : 'Missed'} ${s.pointValue ?? 2}-pointer`,
      `${shotFamily(s.shotType).label}${shotDistance(s) != null ? ` · ${(shotDistance(s) as number).toFixed(0)} ft` : ''}`,
      `${s.opponent ? `vs ${s.opponent} · ` : ''}${s.date.slice(0, 10)}`,
    ]),
    legend: [
      { label: 'Made', dark: false },
      { label: 'Missed', dark: true },
    ],
    groups,
    defaultVisible: groups.map((g) => g.key),
  };

  const zoneOrder: NbaZone[] = ['restricted', 'paint', 'mid', 'corner3', 'break3'];
  const byZone: ResearchCard = {
    kind: 'table',
    key: 'zones',
    title: 'By zone',
    scope: `${located.length} located attempts`,
    info: 'Points per shot counts what the attempt was worth: a 35% three (1.05) beats a 45% long two (0.90).',
    labelHeader: 'Zone',
    columns: [
      { key: 'n', label: 'FGA', decimals: 0 },
      { key: 'm', label: 'FGM', decimals: 0 },
      { key: 'fg', label: 'FG %', decimals: 1 },
      { key: 'share', label: 'Share', decimals: 0, format: 'percent' },
      { key: 'pps', label: 'Pts / shot', decimals: 2 },
    ],
    rows: zoneOrder
      .map((z) => {
        const ms = located.filter((s) => shotZone(s) === z);
        const m = ms.filter((s) => s.made);
        return {
          key: z,
          label: ZONE_LABEL[z],
          values: {
            n: ms.length,
            m: m.length,
            fg: pct(m.length, ms.length),
            share: pct(ms.length, located.length),
            pps: ms.length ? m.reduce((a, s) => a + (s.pointValue ?? 2), 0) / ms.length : null,
          },
        };
      })
      .filter((r) => (r.values.n as number) > 0),
    emptyText: 'No located attempts this season.',
  };

  const byType: ResearchCard = {
    kind: 'table',
    key: 'types',
    title: 'By shot type',
    scope: `${all.length} attempts`,
    caption: 'Counted over every attempt, including the ones the feed did not place.',
    labelHeader: 'Type',
    columns: [
      { key: 'n', label: 'FGA', decimals: 0 },
      { key: 'm', label: 'FGM', decimals: 0 },
      { key: 'fg', label: 'FG %', decimals: 1 },
      { key: 'share', label: 'Share', decimals: 0, format: 'percent' },
    ],
    rows: (() => {
      const byKey = new Map<string, { label: string; n: number; m: number }>();
      for (const s of all) {
        const f = shotFamily(s.shotType);
        const at = byKey.get(f.key) ?? { label: f.label, n: 0, m: 0 };
        at.n += 1;
        if (s.made) at.m += 1;
        byKey.set(f.key, at);
      }
      return [...byKey.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .map(([key, v]) => ({
          key,
          label: v.label,
          values: { n: v.n, m: v.m, fg: pct(v.m, v.n), share: pct(v.n, all.length) },
        }));
    })(),
    emptyText: 'No attempts this season.',
  };

  const unplaced = all.length - located.length;
  return {
    ...base,
    rows: [[chart, byZone], [byType]],
    state: { kind: 'ready' },
    note:
      unplaced > 0
        ? `${located.length} of ${all.length} attempts carry a location; the ${unplaced} that do not are counted in "By shot type" only.`
        : undefined,
    source: { label: 'Shot profile', detail: 'nba_shot_events (ESPN play-by-play)', asOf: input.data.asOf },
  };
}
