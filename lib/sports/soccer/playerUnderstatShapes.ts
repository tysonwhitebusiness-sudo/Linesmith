/**
 * Soccer's own player-page section, as data: a forward's or midfielder's
 * "Chances & finishing" and a keeper's "Shot-stopping" (R6.3). Spec:
 * `docs/design/phase-g2/src/sports/soccer-tennis-golf.js`. Source: Understat,
 * through `playerUnderstat.ts` — database-free here, so client code may import
 * it.
 *
 * WHAT UNDERSTAT ACTUALLY GIVES, measured 2026-09-15 against the live site:
 * a 654-player index for 2026, and per player every shot with `X`, `Y`, `xG`,
 * `result`, `situation` and `shotType` plus every match with minutes, goals,
 * xG, assists, xA and key passes — 700 shots over eight seasons for Haaland,
 * 515 for Cunha, 1,296 for Salah. So the shot map is a parse, not an
 * integration.
 *
 * ============ EPL ONLY, AND A KEEPER IS NOT A SHOOTER =====================
 *
 * Understat covers the big five leagues, so MLS has no shot coordinates at all
 * (`americanSocceranalysis.ts` carries none) and the section says so rather
 * than drawing an empty pitch.
 *
 * A goalkeeper resolves in the index like anyone else and comes back with a
 * shot list that is nonsense for this card: Jordan Pickford's is exactly one
 * shot, an own goal in 2023. So a keeper gets G2's own state — post-shot xG,
 * claims, sweeper actions and distribution are not held — rather than a map of
 * his own goal.
 * ==========================================================================
 */

import type { ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';

/** One shot, trimmed to what the page draws: season, minute, x, y, xG, result, situation, body part. */
export type UnderstatShotRow = [number, number, number, number, number, string, string, string];

export interface UnderstatMatchRow {
  date: string;
  season: number;
  opponent: string | null;
  isHome: boolean | null;
  minutes: number;
  goals: number;
  shots: number;
  xG: number;
  assists: number;
  xA: number;
  keyPasses: number;
}

export interface SoccerUnderstatPayload {
  understatId: string;
  /** Understat's own spelling of the name the index matched. */
  name: string;
  teamTitle: string;
  seasons: number[];
  shots: UnderstatShotRow[];
  matches: UnderstatMatchRow[];
  asOf: string | null;
}

export interface SoccerChancesInput {
  /** The season the section shows; `null` opens on every season held. */
  season: number | null;
  data: SoccerUnderstatPayload | null;
  loading: boolean;
  error: string | null;
  /** Why there is nothing, when the source does not cover this player at all. */
  emptyReason?: string;
}

const SITUATIONS: Array<[string, string]> = [
  ['OpenPlay', 'Open play'],
  ['SetPiece', 'Set piece'],
  ['FromCorner', 'Corner'],
  ['Penalty', 'Penalty'],
  ['DirectFreekick', 'Free kick'],
];

/** "RightFoot" → "Right foot"; Understat's own vocabulary is camel case. */
function spaced(v: string): string {
  const s = v.replace(/([A-Z])/g, ' $1').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const seasonLabel = (s: number) => `${s}-${String(s + 1).slice(2)}`;

export function soccerChancesSection(input: SoccerChancesInput): ResearchSection {
  const seasons = input.data?.seasons ?? [];
  const base = {
    id: 'chances',
    navLabel: 'Chances',
    title: 'Chances & finishing',
    sub: 'Understat, every shot held',
    ...(seasons.length
      ? {
          season: {
            value: input.season ?? seasons[seasons.length - 1],
            options: [...seasons].reverse().map((s) => ({ value: s, label: seasonLabel(s) })),
          },
        }
      : {}),
  };
  if (input.loading) return { ...base, rows: [], state: { kind: 'loading' } };
  if (input.error) return { ...base, rows: [], state: { kind: 'error', message: input.error } };
  if (!input.data || input.data.shots.length === 0) {
    return {
      ...base,
      rows: [],
      state: {
        kind: 'empty',
        title: 'No shots on record',
        reason: input.emptyReason ?? 'Understat covers the big five leagues; it holds no shots for this player.',
      },
    };
  }

  const season = input.season ?? seasons[seasons.length - 1];
  const all = input.data.shots;
  const shots = all.filter((s) => s[0] === season);
  const goals = shots.filter((s) => s[5] === 'Goal');
  const xg = sum(shots.map((s) => s[4]));
  const groups = SITUATIONS.map(([key, label]) => ({ key, label, count: shots.filter((s) => s[6] === key).length })).filter((g) => g.count > 0);

  const map: ResearchCard = {
    kind: 'scatter',
    key: 'shots',
    title: 'Shot map',
    scope: `${seasonLabel(season)} · ${shots.length} shots`,
    caption: 'Every shot at its own place on the attacking half. The dot grows with the chance it was worth (xG); a goal is filled green.',
    surface: 'pitch',
    // Understat's X runs 0 (own goal line) to 1 (attacking goal) and Y across
    // the pitch; the chart draws the attacking half only, goal at the top.
    points: shots.map((s) => [s[6], s[3], s[2]] as [string, number, number]),
    weights: shots.map((s) => s[4]),
    emphasis: shots.map((s) => s[5] === 'Goal'),
    tips: shots.map((s) => [`${s[4].toFixed(2)} xG · ${spaced(s[5])}`, `${spaced(s[6])} · ${spaced(s[7])} · ${s[1]}'`]),
    legend: [
      { label: 'Goal', dark: false },
      { label: 'No goal', dark: true },
    ],
    groups,
    defaultVisible: groups.map((g) => g.key),
  };

  const byPart: ResearchCard = {
    kind: 'table',
    key: 'finishing',
    title: 'Finishing',
    scope: `${seasonLabel(season)} · by body part`,
    info: 'xG is the chance quality Understat assigns each shot. Goals minus xG is finishing: positive means more goals than the chances were worth.',
    caption: `${shots.length} shots · ${goals.length} goals · ${xg.toFixed(1)} xG · ${goals.length - xg >= 0 ? '+' : ''}${(goals.length - xg).toFixed(1)} vs xG · ${shots.length ? ((100 * goals.length) / shots.length).toFixed(1) : '0'}% converted`,
    labelHeader: 'Body part',
    columns: [
      { key: 'n', label: 'Shots', decimals: 0 },
      { key: 'g', label: 'Goals', decimals: 0 },
      { key: 'xg', label: 'xG', decimals: 1 },
      { key: 'per', label: 'xG / shot', decimals: 2 },
      { key: 'diff', label: 'G − xG', decimals: 1 },
    ],
    rows: [...new Set(shots.map((s) => s[7]))]
      .map((part) => {
        const rs = shots.filter((s) => s[7] === part);
        const g = rs.filter((s) => s[5] === 'Goal').length;
        const x = sum(rs.map((s) => s[4]));
        return { key: part, label: spaced(part), values: { n: rs.length, g, xg: x, per: rs.length ? x / rs.length : null, diff: g - x } };
      })
      .sort((a, b) => (b.values.n as number) - (a.values.n as number)),
    emptyText: 'No shots this season.',
  };

  // G2 draws the last 60 matches on a 10-match rolling average, across seasons
  // rather than inside one: finishing form is the thing, and a season boundary
  // does not interrupt it.
  const recent = [...input.data.matches].sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
  const rolling = (values: number[], w: number) =>
    values.map((_, i) => (i + 1 < w ? Number.NaN : sum(values.slice(i + 1 - w, i + 1)) / w));
  const goalsVsXg: ResearchCard = {
    kind: 'series',
    key: 'goalsVsXg',
    title: 'Goals vs expected goals',
    scope: `last ${recent.length} matches · 10-match rolling`,
    caption: 'Above the grey line is scoring more than the chances were worth.',
    values: rolling(recent.map((m) => m.goals), 10),
    context: rolling(recent.map((m) => m.xG), 10),
    xLabels: recent.map((m, i) => (i === 0 || m.season !== recent[i - 1].season ? seasonLabel(m.season) : '')),
    zeroBased: true,
    decimals: 2,
    unit: 'per match',
    tips: recent.map((m) => [`${m.goals} goals · ${m.xG.toFixed(2)} xG`, `${m.isHome === false ? '@' : 'vs'} ${m.opponent ?? '—'} · ${m.minutes}'`]),
    legend: [
      { label: 'Goals, 10-match average', dark: true },
      { label: 'xG, 10-match average', dark: false },
    ],
  };

  const per90: ResearchCard = {
    kind: 'table',
    key: 'per90',
    title: 'Per 90 by season',
    scope: 'every season held',
    labelHeader: 'Season',
    columns: [
      { key: 'apps', label: 'Apps', decimals: 0 },
      { key: 'min', label: 'Min', decimals: 0 },
      { key: 'g', label: 'G', decimals: 0 },
      { key: 'xg', label: 'xG', decimals: 1 },
      { key: 'a', label: 'A', decimals: 0 },
      { key: 'xa', label: 'xA', decimals: 1 },
      { key: 'kp', label: 'Key passes', decimals: 0 },
      { key: 'g90', label: 'G/90', decimals: 2 },
      { key: 'xg90', label: 'xG/90', decimals: 2 },
      { key: 'sh90', label: 'Sh/90', decimals: 1 },
    ],
    rows: [...seasons]
      .reverse()
      .map((s) => {
        const ms = input.data!.matches.filter((m) => m.season === s);
        const min = sum(ms.map((m) => m.minutes));
        const per90of = (v: number) => (min ? (90 * v) / min : null);
        return {
          key: String(s),
          label: seasonLabel(s),
          values: {
            apps: ms.length,
            min,
            g: sum(ms.map((m) => m.goals)),
            xg: sum(ms.map((m) => m.xG)),
            a: sum(ms.map((m) => m.assists)),
            xa: sum(ms.map((m) => m.xA)),
            kp: sum(ms.map((m) => m.keyPasses)),
            g90: per90of(sum(ms.map((m) => m.goals))),
            xg90: per90of(sum(ms.map((m) => m.xG))),
            sh90: per90of(sum(ms.map((m) => m.shots))),
          },
        };
      })
      .filter((r) => (r.values.apps as number) > 0),
    emptyText: 'No matches held.',
  };

  return {
    ...base,
    rows: [[map, byPart], [goalsVsXg], [per90]],
    state: { kind: 'ready' },
    note:
      input.data.name && input.data.teamTitle
        ? `Understat matched this player as ${input.data.name} (${input.data.teamTitle}) by name; it publishes no id this app can join on.`
        : undefined,
    source: { label: 'Chances and shots', detail: 'Understat player data, fetched per player and cached', asOf: input.data.asOf },
  };
}

/** A goalkeeper's section: what shot-stopping needs and this app does not hold (G2's own state). */
export function soccerKeeperSection(): ResearchSection {
  return {
    id: 'keeping',
    navLabel: 'Shot-stopping',
    title: 'Shot-stopping',
    rows: [],
    state: {
      kind: 'empty',
      title: 'Expected goals faced is not held',
      reason:
        'Post-shot xG, claims, sweeper actions and distribution need a source this app does not use; Understat publishes shots taken, not shots faced. The saves, goals conceded and clean sheets above are real.',
    },
  };
}
