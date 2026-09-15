/**
 * MLB's own player-page sections, as data (R6.1b hitter; R6.1c adds the
 * pitcher). Spec: `docs/design/phase-g2/src/sports/mlb.js`, the hitter's
 * "Contact quality & approach". Source: the R5a Statcast rollup
 * (`mlb_statcast_player_season` through `/api/mlb/statcast/player`).
 *
 * Differences from G2, all on purpose:
 *   - regular season only and one copy per pitch (R5a), so G2's
 *     spring-inclusive 2026 numbers are a little larger (Witt: 393 balls in
 *     play in G2, fewer here);
 *   - percentiles for every season the rollup holds, not 2026 only, with sweet
 *     spot and barrel-style rate beside G2's four;
 *   - every home run carries its distance (G2 said "dropped at ingest").
 */

import { fmt } from '@/components/charts/tokens';
import { pitchTypeLabel } from '@/lib/sports/mlb/pitchProfileShapes';
import type { PlayerStatcastRow, PlayerStatcastSeason, ZoneRow } from '@/lib/sports/mlb/statcastRollupShapes';
import type { SpatialGridRole } from '@/lib/sports/shared/playerRoles';
import type { ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';

export interface MlbStatcastInput {
  season: number;
  /** Seasons the rollup can hold (2025 onwards), newest first. */
  seasons: number[];
  batting: PlayerStatcastRow | null;
  pitching: PlayerStatcastRow | null;
  loading: boolean;
  error: string | null;
}

const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const n1 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1));
/** Savant leaves a few pitches untyped; the rollup keys them "?". */
const pitchName = (code: string | null | undefined) => (!code || code === '?' ? 'Unclassified' : pitchTypeLabel(code));

function rolling(values: Array<number | null>, w: number): number[] {
  return values.map((_, i) => {
    if (i + 1 < Math.min(w, 3)) return NaN;
    const win = values.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => v != null);
    return win.length ? win.reduce((a, b) => a + b, 0) / win.length : NaN;
  });
}

/** The zone map's views for a hitter: xwOBA on contact, swing rate, whiff rate. Chase zones 11-14 draw outside the box. */
function zoneViews(zones: Record<string, ZoneRow>, perspective: 'hitter' | 'pitcher'): Array<{ key: string; label: string; role: SpatialGridRole }> {
  const grid = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ];
  const view = (metric: 'xwoba' | 'swing' | 'whiff' | 'share', label: string, measure: SpatialGridRole['measure'], format: (v: number) => string, lowerIsBetter: boolean): { key: string; label: string; role: SpatialGridRole } => ({
    key: metric,
    label,
    role: {
      title: 'Strike zone',
      surface: 'zone',
      measure,
      cells: grid.map((row) => row.map((z) => ({ key: z, value: zones[z]?.[metric] ?? null, sampleSize: zones[z]?.n ?? null }))),
      outside: ['11', '12', '13', '14'].map((z) => ({ key: z, value: zones[z]?.[metric] ?? null, sampleSize: zones[z]?.n ?? null })),
      format,
      unit: metric === 'xwoba' ? 'xwOBA' : '',
      caption:
        metric === 'xwoba'
          ? "catcher's view · xwOBA on balls in play · corners are chase zones"
          : `catcher's view · ${label.toLowerCase()} of pitches in each zone · darker = more`,
      lowerIsBetter,
      emptyMessage: 'No located pitches this season.',
    },
  });
  const pct = (v: number) => `${Math.round(v)}%`;
  return perspective === 'hitter'
    ? [view('xwoba', 'xwOBA on contact', 'judged', fmt.rate3, false), view('swing', 'Swing %', 'share', pct, false), view('whiff', 'Whiff %', 'share', pct, false)]
    : [view('share', 'Location share', 'share', pct, false), view('whiff', 'Whiff %', 'share', pct, false), view('xwoba', 'xwOBA allowed', 'judged', fmt.rate3, true)];
}

function hitterCards(S: PlayerStatcastSeason, season: number): ResearchCard[][] {
  const pct = S.percentiles;
  const pool = pct ? `among ${pct.pool} hitters with ${pct.minBip}+ balls in play` : undefined;
  const power: ResearchCard = {
    kind: 'percentiles',
    key: 'power',
    title: 'Power profile',
    scope: pct ? `${season} · league percentile` : `${season} · below the qualifier`,
    info: pct
      ? `Percentiles ${pool}. Higher is more of the stat.`
      : 'Too few balls in play this season for a league percentile; the values stand on their own.',
    caption: `${S.bip.toLocaleString()} balls in play · ${S.pitches.toLocaleString()} pitches seen`,
    rows: [
      { key: 'maxEV', label: 'Max exit velo', valueText: S.maxEV == null ? '—' : `${n1(S.maxEV)} mph`, percentile: pct?.maxEV ?? null, direction: 'higher', info: pool },
      { key: 'p90EV', label: '90th pct exit velo', valueText: S.p90EV == null ? '—' : `${n1(S.p90EV)} mph`, percentile: pct?.p90EV ?? null, direction: 'higher', info: pool },
      { key: 'avgEV', label: 'Avg exit velo', valueText: S.avgEV == null ? '—' : `${n1(S.avgEV)} mph`, percentile: pct?.avgEV ?? null, direction: 'higher', info: pool },
      { key: 'hardHit', label: 'Hard-hit rate', valueText: S.hardHit == null ? '—' : `${n1(S.hardHit)}%`, percentile: pct?.hardHit ?? null, direction: 'higher', info: '95+ mph' },
      { key: 'sweetSpot', label: 'Sweet-spot rate', valueText: S.sweetSpot == null ? '—' : `${n1(S.sweetSpot)}%`, percentile: pct?.sweetSpot ?? null, direction: 'higher', info: 'launch angle 8-32°' },
      { key: 'barrelish', label: 'Barrel-style rate', valueText: S.barrelish == null ? '—' : `${n1(S.barrelish)}%`, percentile: pct?.barrelish ?? null, direction: 'higher', info: "98+ mph at 26-30°, not Savant's barrel definition" },
    ],
  };
  const ev: ResearchCard = {
    kind: 'histogram',
    key: 'evHist',
    title: 'Exit velocity distribution',
    scope: `${season} · every ball in play`,
    highlightLabel: 'hard-hit, 95+ mph',
    bars: S.evHist.map((b) => ({ key: String(b.lo), axisLabel: b.lo % 10 === 0 ? String(b.lo) : '', value: b.n, highlight: b.lo >= 95, tip: `${b.n} balls · ${b.lo}–${b.lo + 2} mph` })),
  };
  const trend = S.trend;
  const byGame: ResearchCard = {
    kind: 'series',
    key: 'evByGame',
    title: 'Exit velocity by game',
    scope: `${season} · game average and hardest hit`,
    values: rolling(trend.map((t) => t.avg), 10),
    context: trend.map((t) => (t.max == null ? NaN : t.max)),
    xLabels: trend.map((t, i) => (i === 0 || t.date.slice(5, 7) !== trend[i - 1].date.slice(5, 7) ? new Date(`${t.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : '')),
    reference: { value: 95, label: '95 mph' },
    zeroBased: false,
    min: 60,
    max: 120,
    decimals: 0,
    unit: 'mph',
    tips: trend.map((t) => [`${n1(t.max)} mph · hardest this game`, `${n1(t.avg)} mph · average of ${t.n} balls`, longDate(t.date)]),
    legend: [
      { label: 'Game average, 10-game rolling', dark: true },
      { label: 'Hardest ball each game', dark: false },
    ],
  };
  const byPitch: ResearchCard = {
    kind: 'table',
    key: 'pitchTypes',
    title: 'Results by pitch type',
    scope: `${season} · 25+ pitches seen`,
    labelHeader: 'Pitch',
    columns: [
      { key: 'n', label: 'Seen', decimals: 0 },
      { key: 'usage', label: 'Share', decimals: 1, format: 'percent' },
      { key: 'whiff', label: 'Whiff %', decimals: 1 },
      { key: 'xwoba', label: 'xwOBA', decimals: 3, format: 'rate3' },
      { key: 'ev', label: 'EV', decimals: 1 },
    ],
    rows: [...S.pitchTypes].sort((a, b) => b.n - a.n).map((p) => ({ key: p.type, label: pitchName(p.type), values: { n: p.n, usage: p.usage, whiff: p.whiff, xwoba: p.xwoba, ev: p.ev } })),
    emptyText: 'No pitch type seen 25 times this season.',
  };
  const zone: ResearchCard = { kind: 'surface', key: 'zone', title: 'Strike zone', scope: `${season} · full season`, views: zoneViews(S.zones, 'hitter') };
  const hands: ResearchCard = {
    kind: 'table',
    key: 'hands',
    title: 'vs left- and right-handed pitchers',
    scope: `${season} · plate appearances`,
    labelHeader: 'vs',
    columns: [
      { key: 'pa', label: 'PA', decimals: 0 },
      { key: 'avg', label: 'AVG', decimals: 3, format: 'rate3' },
      { key: 'slg', label: 'SLG', decimals: 3, format: 'rate3' },
      { key: 'hr', label: 'HR', decimals: 0 },
      { key: 'kPct', label: 'K %', decimals: 1 },
      { key: 'bbPct', label: 'BB %', decimals: 1 },
      { key: 'xwobacon', label: 'xwOBAcon', decimals: 3, format: 'rate3', info: 'Expected wOBA on contact' },
    ],
    rows: (['L', 'R'] as const)
      .filter((k) => S.splitsByHand[k])
      .map((k) => ({ key: k, label: k === 'L' ? 'LHP' : 'RHP', values: { ...S.splitsByHand[k]! } })),
    emptyText: 'No plate appearances by pitcher hand this season.',
  };
  const homers: ResearchCard = {
    kind: 'table',
    key: 'homeRuns',
    title: 'Home runs',
    scope: `${season} · ${S.hrList.length}`,
    labelHeader: 'Date',
    columns: [
      { key: 'ev', label: 'EV', decimals: 1 },
      { key: 'la', label: 'LA', decimals: 0, info: 'Launch angle, degrees' },
      { key: 'pitch', label: 'Pitch', decimals: 0 },
      { key: 'velo', label: 'mph', decimals: 1, info: 'Pitch speed' },
      { key: 'distance', label: 'Distance', decimals: 0, info: "Feet, from Savant's projected distance" },
    ],
    rows: [...S.hrList]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((h, i) => ({ key: `${h.date}-${i}`, label: shortDate(h.date), values: { ev: h.ev, la: h.la, pitch: h.pitch ? pitchName(h.pitch) : null, velo: h.velo, distance: h.distance } })),
    emptyText: 'No home runs this season.',
  };
  return [[power, ev], [byGame], [byPitch, zone], [hands, homers]];
}

/**
 * How much of the season the pitch corpus holds, against the box scores.
 *
 * MEASURED 2026-09-15 (R6-F7): 281 of 2,229 regular-season 2026 games in
 * `corpus/mlb_pitch_events` hold fewer than three pitches per plate
 * appearance — partly ingested — in every month, and 2025 is the same. Judge's
 * 2026 rollup holds 261 of his 283 plate appearances and 14 of his 18 home runs;
 * Witt, Ramírez and others sit at 91-94%. Every Statcast number here is over
 * what is held, so the section says how much that is rather than letting a
 * home-run count quietly disagree with the season table above it.
 */
function coverageNote(S: PlayerStatcastSeason, historyPA: number | null, season: number): string | undefined {
  const held = (S.splitsByHand.L?.pa ?? 0) + (S.splitsByHand.R?.pa ?? 0);
  if (!historyPA || held >= historyPA * 0.99) return undefined;
  return `Statcast holds ${held.toLocaleString()} of this player's ${historyPA.toLocaleString()} plate appearances in ${season} (${Math.round((100 * held) / historyPA)}%): some games are only partly in the pitch data, so counts such as home runs can be below the season line.`;
}

/** "Contact quality & approach" for a hitter. `historyPA` is the season's plate appearances from the box scores, for the coverage note. */
export function mlbHitterSection(input: MlbStatcastInput, historyPA: number | null = null): ResearchSection {
  const base = {
    id: 'contact',
    navLabel: 'Contact quality',
    title: 'Contact quality & approach',
    sub: 'Statcast, regular season',
    season: { value: input.season, options: input.seasons.map((s) => ({ value: s, label: String(s) })) },
  };
  if (input.loading) return { ...base, rows: [], state: { kind: 'loading' } };
  if (input.error) return { ...base, rows: [], state: { kind: 'error', message: input.error } };
  const row = input.batting;
  if (!row) {
    return {
      ...base,
      rows: [],
      state: { kind: 'empty', title: `No Statcast batting for ${input.season}`, reason: 'The rollup holds regular-season pitches from 2025 on; this player saw none in this season.' },
    };
  }
  return {
    ...base,
    rows: hitterCards(row.payload, input.season),
    state: { kind: 'ready' },
    note: coverageNote(row.payload, historyPA, input.season),
    source: { label: 'Statcast', detail: 'mlb_statcast_player_season (Baseball Savant pitches, regular season)', asOf: row.asOf },
  };
}
