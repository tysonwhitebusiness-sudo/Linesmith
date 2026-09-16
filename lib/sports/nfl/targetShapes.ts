/**
 * NFL's own player-page section, as data: the receiver's "Usage & depth" and
 * the quarterback's "Where he throws" (R6.2). Spec:
 * `docs/design/phase-g2/src/sports/football.js`. Source: `nfl_target_events`,
 * one row per located pass, written from nflverse play-by-play by Python's
 * `ingestNflPbpJob`.
 *
 * Database-free, so client code may import it; the read lives in `targets.ts`.
 *
 * ============ THE CHART IS ONE DOT PER PASS, NOT A SIX-CELL GRID ===========
 *
 * Phase 6.8 aggregated these same rows into a 2x3 share grid (deep/short ×
 * left/middle/right) for the prop block. The grid threw away the air yards it
 * was built from: a 4-yard curl and a 19-yard dig are both "short", and the
 * reader could not see a receiver's depth change across a season. G2 draws
 * every located target at its own air yards, which the rows carry (17,748 of
 * 17,848 in 2024 have one), with the zone table beside it for the shares.
 * ===========================================================================
 *
 * INTERCEPTIONS ARE NOT SHOWN, and the column is not missing by accident:
 * `nfl_target_events.interception` exists and is FALSE on every row of every
 * season (0 of 36,375, measured 2026-09-15) because `write_nfl_target_events`
 * writes 13 columns and that is not one of them. G2's INT column and its
 * red-ringed dot are therefore not buildable here; showing an all-zero INT
 * column would read as "never intercepted" rather than "not held". Routed as
 * R6-F11.
 */

import { sectionOpeningSeason, type ResearchCard, type ResearchSection } from '@/lib/sports/shared/playerResearchShapes';

/** One located pass: season, week, air yards, side, depth band, YAC, caught, touchdown. */
export type NflTarget = [number, number, number | null, string | null, string | null, number | null, boolean, boolean];

export interface NflTargetsPayload {
  gsisId: string;
  role: 'receiver' | 'passer';
  /** Seasons with rows, ascending. */
  seasons: number[];
  targets: NflTarget[];
  asOf: string | null;
}

export interface NflTargetsInput {
  /** The page's scope season (`research.splits.defaultSeason`); opens here when the source holds it. Set by the adapter. */
  scopeSeason?: number | null;
  /** The season the section shows; `null` opens on the latest held. */
  season: number | null;
  data: NflTargetsPayload | null;
  loading: boolean;
  error: string | null;
  /** Why there is no data, when the sport holds none for this player at all. */
  emptyReason?: string;
}

const SIDES = ['left', 'middle', 'right'] as const;
const BANDS = ['deep', 'short'] as const;

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (n: number, d: number): number | null => (d ? (100 * n) / d : null);

/**
 * Lateral position for a dot, in [-1, 1]. nflverse gives the side, not an x
 * coordinate, so the column is real and the spread inside it is not: points are
 * scattered deterministically (same player, same picture every render) and the
 * caption says the spread within a column means nothing.
 */
function lateral(side: string | null, i: number): number | null {
  const col = SIDES.indexOf((side ?? '') as (typeof SIDES)[number]);
  if (col === -1) return null;
  const centre = [-0.66, 0, 0.66][col];
  // A cheap deterministic hash of the row index, in [-0.5, 0.5).
  const jitter = (((i * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.46;
  return centre + jitter;
}

/**
 * Which rows are this player's: a quarterback's are the passes he threw, a
 * receiver's (including a back or a tight end) the ones thrown to him. A
 * defender has neither. `null` also for a position the bio does not give,
 * where guessing would show a quarterback his trick-play targets.
 */
export function nflTargetRole(positionAbbr: string | null | undefined): 'receiver' | 'passer' | null {
  const pos = (positionAbbr ?? '').toUpperCase();
  if (pos === 'QB') return 'passer';
  return (['WR', 'TE', 'RB', 'FB', 'HB'] as string[]).includes(pos) ? 'receiver' : null;
}

/**
 * The same fallback the page's columns already make when a bio carries no
 * position: `footballResearchSpec` reads the box scores instead
 * ("quarterback", "receiver", "running back", "defender"). Without this a
 * player whose ESPN bio omits a position got the quarterback's own columns and
 * no section at all, which reads as "nothing to show" rather than "no
 * position".
 */
export function nflTargetRoleFromKind(kind: string): 'receiver' | 'passer' | null {
  if (kind === 'quarterback') return 'passer';
  return kind === 'receiver' || kind === 'running back' ? 'receiver' : null;
}

export function nflTargetsSection(input: NflTargetsInput): ResearchSection {
  const role = input.data?.role ?? 'receiver';
  const receiver = role === 'receiver';
  const seasons = input.data?.seasons ?? [];
  const season = seasons.length ? sectionOpeningSeason(seasons, input.season, input.scopeSeason) : (input.season ?? null);
  const base = {
    id: receiver ? 'usage' : 'depth',
    navLabel: receiver ? 'Usage' : 'Where he throws',
    title: receiver ? 'Usage & depth' : 'Where he throws',
    sub: 'every located pass, nflverse play-by-play',
    ...(seasons.length ? { season: { value: season ?? seasons[seasons.length - 1], options: [...seasons].reverse().map((s) => ({ value: s, label: String(s) })) } } : {}),
  };
  if (input.loading) return { ...base, rows: [], state: { kind: 'loading' } };
  if (input.error) return { ...base, rows: [], state: { kind: 'error', message: input.error } };
  if (!input.data || input.data.targets.length === 0 || season == null) {
    return {
      ...base,
      rows: [],
      state: {
        kind: 'empty',
        title: receiver ? 'No located targets on record' : 'No located passes on record',
        reason: input.emptyReason ?? 'The play-by-play holds 2024 onwards; this player has no located pass in it.',
      },
    };
  }

  const all = input.data.targets;
  const rows = all.filter((t) => t[0] === season);
  const located = rows.filter((t) => t[2] != null && t[3] != null);
  const noun = receiver ? 'targets' : 'passes';

  const groups = [
    { key: 'caught', label: receiver ? 'Caught' : 'Complete', count: located.filter((t) => t[6] && !t[7]).length },
    { key: 'incomplete', label: 'Incomplete', count: located.filter((t) => !t[6]).length },
    { key: 'touchdown', label: 'Touchdown', count: located.filter((t) => t[7]).length },
  ].filter((g) => g.count > 0);

  const chart: ResearchCard = {
    kind: 'scatter',
    key: 'field',
    title: receiver ? 'Target chart' : 'Pass chart',
    scope: `${season} · ${located.length} located ${noun}`,
    caption: 'Height is air yards from the line of scrimmage; the column is the field side. Spread within a column is for legibility, not a real position.',
    surface: 'field',
    points: located.map((t, i) => [t[6] ? (t[7] ? 'touchdown' : 'caught') : 'incomplete', lateral(t[3], i) ?? 0, t[2] ?? 0] as [string, number, number]),
    groups,
    defaultVisible: groups.map((g) => g.key),
  };

  const zone: ResearchCard = {
    kind: 'table',
    key: 'zones',
    title: 'By zone',
    scope: `${season} · depth and side`,
    labelHeader: 'Zone',
    columns: [
      { key: 'n', label: receiver ? 'Tgt' : 'Att', decimals: 0 },
      { key: 'share', label: 'Share', decimals: 0, format: 'percent' },
      { key: 'caught', label: receiver ? 'Catch %' : 'Comp %', decimals: 0 },
      { key: 'air', label: 'Air yds', decimals: 1 },
      { key: 'yac', label: 'YAC', decimals: 1 },
      { key: 'td', label: 'TD', decimals: 0 },
    ],
    rows: BANDS.flatMap((band) =>
      SIDES.map((side) => {
        const cell = located.filter((t) => (t[4] ?? '').toLowerCase() === band && (t[3] ?? '').toLowerCase() === side);
        const caught = cell.filter((t) => t[6]);
        return {
          key: `${band}-${side}`,
          label: `${band[0].toUpperCase()}${band.slice(1)} ${side}`,
          values: {
            n: cell.length,
            share: pct(cell.length, located.length),
            caught: pct(caught.length, cell.length),
            air: mean(cell.map((t) => t[2]).filter((v): v is number => v != null)),
            // YAC exists only on a catch: over every target it would read as
            // "yards after a catch he did not make".
            yac: mean(caught.map((t) => t[5]).filter((v): v is number => v != null)),
            td: cell.filter((t) => t[7]).length,
          },
        };
      }),
    ),
    emptyText: `No located ${noun} this season.`,
  };

  const bySeason: ResearchCard = {
    kind: 'table',
    key: 'bySeason',
    title: receiver ? 'Target profile by season' : 'Passing depth profile by season',
    scope: 'every season held',
    info: 'aDOT is the average depth of target: air yards from the line of scrimmage, including a screen’s negative ones.',
    caption: 'Interceptions: not held (the play-by-play rows the app stores carry no interception flag).',
    labelHeader: 'Season',
    columns: [
      { key: 'n', label: receiver ? 'Targets' : 'Attempts', decimals: 0 },
      { key: 'adot', label: 'aDOT', decimals: 1 },
      { key: 'deep', label: 'Deep %', decimals: 1 },
      { key: 'caught', label: receiver ? 'Catch %' : 'Comp %', decimals: 1 },
      { key: 'yac', label: 'YAC / catch', decimals: 1 },
      { key: 'td', label: 'TD', decimals: 0 },
    ],
    rows: [...seasons].reverse().map((s) => {
      const rs = all.filter((t) => t[0] === s);
      const caught = rs.filter((t) => t[6]);
      return {
        key: String(s),
        label: String(s),
        values: {
          n: rs.length,
          adot: mean(rs.map((t) => t[2]).filter((v): v is number => v != null)),
          deep: pct(rs.filter((t) => (t[4] ?? '').toLowerCase() === 'deep').length, rs.length),
          caught: pct(caught.length, rs.length),
          yac: mean(caught.map((t) => t[5]).filter((v): v is number => v != null)),
          td: rs.filter((t) => t[7]).length,
        },
      };
    }),
    emptyText: 'No seasons held.',
  };

  const unlocated = rows.length - located.length;
  return {
    ...base,
    rows: [[chart, zone], [bySeason]],
    state: { kind: 'ready' },
    note: unlocated > 0 ? `${unlocated} of this season's ${rows.length} ${noun} carry no location and are left off the chart; they count in the season table.` : undefined,
    source: { label: 'Target data', detail: 'nfl_target_events (nflverse play-by-play)', asOf: input.data.asOf },
  };
}

/** CFB's quarterbacks: the efficiency data G2 shows is not held. */
export function cfbEfficiencySection(): ResearchSection {
  return {
    id: 'depth',
    navLabel: 'Efficiency',
    title: 'Efficiency',
    rows: [],
    state: {
      kind: 'empty',
      title: 'Not held for college football',
      reason:
        'Pass depth and efficiency (PPA/EPA-style) are published by CFBD, which this app calls for schedules and team data but does not ingest play-by-play from. NFL play-by-play comes from nflverse, which has no college feed.',
    },
  };
}
